// Duplicate import detection (data integrity stage 7): js/duplicates.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyImport } from '../js/duplicates.js';

const demo = () => JSON.parse(readFileSync(new URL('./fixtures/demo.json', import.meta.url), 'utf8'));
function device(jobs, photos = {}) {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return { getJob: async (id) => byId.get(id), photoKeys: async (id) => photos[id] || [], cards: jobs };
}

test('duplicates: the same job with the same photos is already on this device', async () => {
  const j = demo();
  const r = await classifyImport({ job: structuredClone(j), photoIds: ['p1', 'p2'] }, device([j], { [j.id]: ['p2', 'p1'] }));
  assert.equal(r.kind, 'same');
});

test('duplicates: the same job id with different data or different photos goes to the replace / keep both step', async () => {
  const j = demo(), f = structuredClone(j); f.info.client = 'Changed';
  assert.equal((await classifyImport({ job: f, photoIds: [] }, device([j]))).kind, 'differs');
  assert.equal((await classifyImport({ job: structuredClone(j), photoIds: ['p1'] }, device([j], { [j.id]: [] }))).kind, 'differs');
  assert.equal((await classifyImport({ job: structuredClone(j), photoIds: [] }, device([j], { [j.id]: ['p9'] }))).kind, 'differs');
  // key order alone is not a difference
  const reordered = Object.fromEntries(Object.entries(structuredClone(j)).reverse());
  assert.equal((await classifyImport({ job: reordered, photoIds: [] }, device([j]))).kind, 'same');
});

test('duplicates: another job for the same tank and inspection date is a possible duplicate', async () => {
  const j = demo(), f = structuredClone(j); f.id = 'other-id';
  f.info.client = `  ${j.info.client.toUpperCase()} `; // spacing and case don't matter, as in the registry
  const r = await classifyImport({ job: f, photoIds: [] }, device([j]));
  assert.equal(r.kind, 'possible');
  assert.deepEqual(r.matches.map((c) => c.id), [j.id]);
});

test('duplicates: a different date, tank or site — or no inspection date — is a new job', async () => {
  const j = demo();
  const variants = [(f) => { f.info.inspDate = '2020-01-01'; }, (f) => { f.info.tankId = 'TK-999'; }, (f) => { f.info.site = 'Elsewhere'; }];
  for (const change of variants) {
    const f = structuredClone(j); f.id = 'other-id'; change(f);
    assert.equal((await classifyImport({ job: f, photoIds: [] }, device([j]))).kind, 'new');
  }
  const a = structuredClone(j), b = structuredClone(j); a.info.inspDate = ''; b.id = 'other-id'; b.info.inspDate = '';
  assert.equal((await classifyImport({ job: b, photoIds: [] }, device([a]))).kind, 'new', 'no date: nothing to compare');
  assert.equal((await classifyImport({ job: b, photoIds: [] }, device([]))).kind, 'new');
});

test('duplicates: earlier imports of the same file are returned newest first', async () => {
  const j = demo();
  const r = await classifyImport({ job: j, photoIds: [] }, device([]), [{ at: 1, result: 'opened' }, { at: 3, result: 'cancelled' }, { at: 2, result: 'refused' }]);
  assert.deepEqual(r.opened.map((x) => x.at), [3, 2, 1]);
});
