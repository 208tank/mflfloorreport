// Stage 11 — migration management: the ordered job and database steps, the migration log and checksums.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate, migrationNotes, newJob, SCHEMA } from '../js/model.js';
import { JOB_STEPS, DB_STEPS, DB_VERSION, JOB_SCHEMA, pendingSteps, upgradeDb } from '../js/migrations.js';
import { canonicalJSON, sha256 } from '../js/util.js';

const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));

test('steps are numbered in order with no gaps', () => {
  assert.deepEqual(DB_STEPS.map((s) => s.v), Array.from({ length: DB_VERSION }, (_, i) => i + 1));
  assert.deepEqual(JOB_STEPS.map((s) => s.to), Array.from({ length: JOB_SCHEMA - 1 }, (_, i) => i + 2));
  assert.equal(SCHEMA, JOB_SCHEMA);
  assert.equal(DB_VERSION, 4);
});

test('a schema 1 job runs every step in order and is logged', () => {
  const raw = fixture('legacy-schema1'), before = JSON.stringify(raw), log = [];
  const out = migrate(raw, { log, appVersion: 'test' });
  assert.deepEqual(log.map((l) => [l.from, l.to]), [[1, 2], [2, 3], [3, 4]]);
  assert.ok(log.every((l) => l.kind === 'job' && l.jobId === raw.id && l.app === 'test' && l.at > 0));
  assert.equal(out.schema, SCHEMA);
  assert.equal(JSON.stringify(raw), before, 'the stored job must not be changed by migrating it');
});

test('a current job needs no steps; migrating again changes nothing', () => {
  const once = migrate(fixture('demo')), log = [];
  assert.equal(pendingSteps(once).length, 0);
  const twice = migrate(once, { log });
  assert.equal(log.length, 0);
  assert.equal(canonicalJSON(twice), canonicalJSON(once));
  assert.deepEqual(migrationNotes(once), []);
});

test('each step only applies to jobs below its schema', () => {
  const j3 = { ...fixture('demo'), schema: 3 }, log = [];
  migrate(j3, { log });
  assert.deepEqual(log.map((l) => l.to), [4]);
  const j2 = { ...fixture('demo'), schema: 2, calc: { ...fixture('demo').calc, mrtAnnular: 2.54 } };
  assert.equal(migrate(j2).calc.mrtAnnular, null, 'step 3: old 0.10 in annular default becomes auto');
  assert.equal(migrate({ ...j2, schema: 3 }).calc.mrtAnnular, 2.54, 'step 3 does not run on schema 3 jobs');
});

test('a step that throws leaves the stored job untouched', () => {
  const raw = fixture('legacy-schema1'), before = JSON.stringify(raw);
  const steps = [...JOB_STEPS.slice(0, 1), { to: 3, name: 'broken', notes: () => [], run(out) { out.indications.length = 0; throw new Error('boom'); } }];
  assert.throws(() => migrate(raw, { steps }), /boom/);
  assert.equal(JSON.stringify(raw), before);
});

test('step notes describe only the steps a job still needs', () => {
  const raw = fixture('legacy-schema1');
  assert.ok(migrationNotes(raw).some((n) => /measured from the plate edges/.test(n)));
  assert.ok(!migrationNotes({ ...raw, schema: 2 }).some((n) => /plate edges/.test(n)));
  assert.deepEqual(migrationNotes(newJob()), []);
});

test('database steps: each version adds only its own stores, and the log records them', () => {
  // a tiny stand-in for the IndexedDB upgrade API
  const fake = (have) => {
    const stores = new Map(have.map((n) => [n, { idx: [] }])), meta = new Map();
    const store = (n) => ({ createIndex: (i) => stores.get(n).idx.push(i), get: (k) => { const r = {}; queueMicrotask(() => { r.result = meta.get(k); r.onsuccess?.(); }); return r; }, put: (v) => meta.set(v.key, v), openCursor: () => ({}) });
    const db = { objectStoreNames: { contains: (n) => stores.has(n) }, createObjectStore: (n) => { stores.set(n, { idx: [] }); return store(n); } };
    return { db, tx: { objectStore: store }, stores, meta };
  };
  const f = fake(['jobs', 'photos', 'meta', 'tanks', 'cards']);
  const done = upgradeDb(f.db, f.tx, 3, { lite: (x) => x, appVersion: 'test' });
  assert.deepEqual(done.map((d) => d.to), [4]);
  assert.deepEqual([...f.stores.keys()].slice(5), ['revisions', 'audit', 'imports']);
  assert.deepEqual(f.stores.get('revisions').idx, ['jobId', 'jobN']);
  const g = fake([]);
  assert.deepEqual(upgradeDb(g.db, g.tx, 0, { lite: (x) => x }).map((d) => d.to), [1, 2, 3, 4]);
  assert.throws(() => upgradeDb(fake(['jobs', 'photos', 'meta', 'tanks', 'cards']).db, f.tx, 3, { fail: 4 }), /step 4/);
});

test('checksums: canonical JSON ignores key order; SHA-256 matches the standard test vector', async () => {
  assert.equal(canonicalJSON({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } }), '{"a":{"d":[1,{"x":1,"y":2}]},"b":1}');
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const j = fixture('demo');
  assert.equal(await sha256(j), await sha256(JSON.parse(JSON.stringify(j))));
  assert.notEqual(await sha256(j), await sha256({ ...j, defSeq: (j.defSeq || 0) + 1 }));
});
