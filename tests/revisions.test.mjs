// Revisions (data integrity stage 8): the comparison (js/revdiff.js) and the content checksum (js/app/revisions.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diffJobs, BOOKKEEPING } from '../js/revdiff.js';
import { contentHash, isLocked } from '../js/app/revisions.js';

const demo = () => JSON.parse(readFileSync(new URL('./fixtures/demo.json', import.meta.url), 'utf8'));
const rowsOf = (a, b) => diffJobs(a, b).map((r) => [r.area, r.item, r.field, r.before, r.after]);

test('compare: the same job has no differences, whatever its key order or file bookkeeping', () => {
  const a = demo(), b = structuredClone(a);
  b.rev = 9; b.savedAt = 1; b.updated = 2; b.edits = 3; b.editAreas = ['Floor']; b.revisions = [{ rev: 9 }]; b.status.history.push({ stage: 'x' });
  assert.deepEqual(diffJobs(a, b), []);
  assert.deepEqual(diffJobs(a, Object.fromEntries(Object.entries(structuredClone(a)).reverse())), []);
});

test('compare: changed fields are listed by area and item, with the values before and after', () => {
  const a = demo(), b = structuredClone(a);
  b.info.client = 'New client'; b.indications[0].utMin = 3.3; b.plates['r-6c0'].scan = 'scanned'; b.shell.courses[0].tNom = 9;
  assert.deepEqual(rowsOf(a, b), [
    ['Job', '', 'client', a.info.client, 'New client'],
    ['Plate', 'r-6c0', 'scan', 'partial', 'scanned'],
    ['Indication', a.indications[0].no, 'utMin', String(a.indications[0].utMin), '3.3'],
    ['Shell', 'Course 1', 'tNom', String(a.shell.courses[0].tNom), '9'],
  ]);
});

test('compare: items are matched by id, so added, removed and moved items are told apart', () => {
  const a = demo(), b = structuredClone(a);
  const removed = b.indications.splice(1, 1)[0];
  b.indications.reverse(); // moving items is not a change
  b.indications.push({ id: 'new1', no: '099', plate: 'r0c0' });
  b.secs.floor.obs = [...(b.secs.floor.obs || []), { id: 'o9', item: 'Sump', cond: 'poor' }];
  assert.deepEqual(rowsOf(a, b), [
    ['Indication', removed.no, '(item)', 'present', 'removed'],
    ['Indication', '099', '(item)', '—', 'added'],
    ['Section', 'Floor › Sump', '(item)', '—', 'added'],
  ]);
});

test('compare: shell UT readings keyed by elevation are shown with their station and elevation', () => {
  const a = demo(), b = structuredClone(a);
  const st = Object.keys(b.shell.rd)[0], z = Object.keys(b.shell.rd[st])[0];
  b.shell.rd[st][z] = 1;
  assert.deepEqual(rowsOf(a, b), [['Shell', `UT readings (station › elevation) › ${st}`, z, String(a.shell.rd[st][z]), '1']]);
});

test('content checksum: ignores the file bookkeeping, sees every inspection change', async () => {
  const a = demo(), b = structuredClone(a);
  for (const k of BOOKKEEPING) b[k] = 'changed';
  assert.equal(await contentHash(a), await contentHash(b));
  b.indications[0].utMin = 1;
  assert.notEqual(await contentHash(a), await contentHash(b));
});

test('locking: a job is locked exactly when it is Complete', () => {
  const j = demo();
  for (const stage of ['upcoming', 'inspection', 'reporting', 'review']) { j.status.stage = stage; assert.equal(isLocked(j), false); }
  j.status.stage = 'complete'; assert.equal(isLocked(j), true);
  assert.equal(isLocked(null), false);
});
