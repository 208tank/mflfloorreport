// Data integrity stage 12: revision pruning keeps 15 checkpoints and 5 others, and never a file-save or issued one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binToEmpty, KEEP, planPrune } from '../js/prune.js';

const make = (spec) => { let n = 0; return spec.flatMap(([reason, k]) => Array.from({ length: k }, () => ({ id: 'j:' + ++n, n, reason }))); };

test('keeps the newest 15 checkpoints and 5 other revisions', () => {
  const revs = make([['checkpoint', 20], ['stage', 4], ['import', 3], ['before-replace', 2]]);
  const drop = planPrune(revs), ids = new Set(drop.map((r) => r.id));
  const kept = revs.filter((r) => !ids.has(r.id));
  assert.equal(kept.filter((r) => r.reason === 'checkpoint').length, 15);
  assert.equal(kept.filter((r) => r.reason !== 'checkpoint').length, 5);
  assert.deepEqual(drop.filter((r) => r.reason === 'checkpoint').map((r) => r.n), [5, 4, 3, 2, 1], 'the oldest checkpoints go');
  assert.ok(kept.filter((r) => r.reason !== 'checkpoint').every((r) => r.n >= 25), 'the newest others stay');
});

test('revisions saved to a job file and issued reports are never removed, and do not count', () => {
  const revs = make([['file-save', 30], ['issued', 3], ['stage', 7], ['checkpoint', 2]]);
  const drop = planPrune(revs);
  assert.ok(drop.every((r) => r.reason === 'stage'));
  assert.equal(drop.length, 2);
});

test('the job’s issued revision is kept whatever its reason', () => {
  const revs = make([['stage', 10]]);
  assert.ok(!planPrune(revs, { issuedN: 1 }).some((r) => r.n === 1));
});

test('nothing to remove under the limits; the limits are as decided', () => {
  assert.deepEqual(planPrune(make([['checkpoint', 15], ['stage', 5]])), []);
  assert.deepEqual(KEEP, { checkpoint: 15, other: 5 });
});

test('a removed photo is emptied from the bin only when no remaining revision shows it', () => {
  assert.deepEqual(binToEmpty(['a', 'b', 'c'], [{ photoIds: ['a'] }, { photoIds: ['c', 'x'] }]), ['b']);
  assert.deepEqual(binToEmpty([], [{ photoIds: ['a'] }]), []);
});
