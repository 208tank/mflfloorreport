// Data integrity stage 9: the audit trail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditChanges, auditRows, entryIntact, filterRows, makeEntry, verifyAudit } from '../js/audit.js';
import { validateJobFile } from '../js/validate.js';
import { checkIntegrity } from '../js/integrity.js';
import { sha256 } from '../js/util.js';

const demo = () => JSON.parse(readFileSync(new URL('./fixtures/demo.json', import.meta.url), 'utf8'));
const BY = { name: 'A. Inspector', id: 'dev-1', method: 'device' };

async function chain(n, jobId = 'j1') {
  const out = []; let prev = null;
  for (let i = 0; i < n; i++) { const e = await makeEntry({ jobId, at: 1000 + i, by: BY, source: 'edit', changes: [{ area: 'Job', item: '', field: 'client', path: 'info.client', before: 'v' + i, after: 'v' + (i + 1) }] }, prev); e.seq = i + 1; out.push(e); prev = e.hash; }
  return out;
}

test('each kind of change gives the right rows, with whole values and the content of added and removed items', () => {
  const a = demo(), b = structuredClone(a);
  b.info.client = 'New client';
  b.indications[0].mflPct = 55;
  const gone = b.indications.splice(1, 1)[0];
  b.indications.push({ id: 'new1', no: 'X9', mflPct: 20 });
  b.info.notes = 'x'.repeat(300);
  b.rev = 9; b.savedAt = 5; b.edits = 3; // bookkeeping: never logged
  const rows = auditChanges(a, b), by = (f) => rows.filter(f);
  assert.deepEqual(by((r) => r.field === 'client').map((r) => [r.area, r.path, r.before, r.after]), [['Job', 'info.client', a.info.client, 'New client']]);
  const m = by((r) => r.field === 'mflPct')[0];
  assert.equal(m.after, 55); assert.equal(m.path, `indications.${a.indications[0].id}.mflPct`); assert.equal(m.area, 'Indication');
  const removed = by((r) => r.field === '(item)' && r.after === null)[0];
  assert.equal(JSON.parse(removed.before).id, gone.id, 'a removed item keeps its content');
  const added = by((r) => r.field === '(item)' && r.before === null)[0];
  assert.deepEqual(JSON.parse(added.after), { id: 'new1', no: 'X9', mflPct: 20 });
  assert.equal(by((r) => r.field === 'notes')[0].after.length, 300, 'values are not shortened');
  assert.ok(!rows.some((r) => ['rev', 'savedAt', 'edits'].includes(r.field)));
});

test('the chain: intact entries verify; an edited entry and a missing one are found', async () => {
  const c = await chain(5);
  assert.deepEqual(await verifyAudit(c), []);
  const edited = structuredClone(c); edited[2].changes[0].after = 'tampered';
  assert.deepEqual((await verifyAudit(edited)).map((p) => [p.kind, p.entry.seq]), [['changed', 3]]);
  const gap = c.filter((e) => e.seq !== 3);
  assert.deepEqual((await verifyAudit(gap)).map((p) => [p.kind, p.entry.seq]), [['gap', 4]]);
  const who = structuredClone(c); who[0].by.name = 'Someone else';
  assert.equal((await verifyAudit(who))[0].kind, 'changed', 'who made it is covered too');
});

test('entries merged from another device form a tree, which verifies; a copy under a new job id stays valid', async () => {
  const here = await chain(3), there = [await makeEntry({ jobId: 'j1', at: 2000, by: BY, source: 'edit', changes: [] }, here[1].hash)];
  assert.deepEqual(await verifyAudit([...here, ...there]), []);
  assert.ok(await entryIntact({ ...here[0], jobId: 'copy' }));
});

test('rows, filters and order for the Audit trail screen', async () => {
  const c = await chain(3);
  c.push(await makeEntry({ jobId: 'j1', at: 5000, by: BY, source: 'import', note: 'Opened from a.json', changes: [] }, c[2].hash));
  const rows = auditRows(c);
  assert.equal(rows[0].source, 'import'); assert.equal(rows[0].field, '', 'an entry with no field changes still shows');
  assert.equal(rows.length, 4);
  assert.equal(filterRows(rows, { source: 'edit' }).length, 3);
  assert.equal(filterRows(rows, { area: 'Job', text: 'CLIENT' }).length, 3);
  assert.equal(filterRows(rows, { text: 'mflPct' }).length, 0);
});

test('job files: intact audit entries are kept, changed ones are a warning', async () => {
  const c = await chain(3); c[1].note = 'changed later';
  const v = await validateJobFile({ format: 'tank-floor-inspector', version: 2, job: demo(), photos: [], audit: c }, { schema: 4, fileVersion: 2 });
  assert.equal(v.audit.length, 2); assert.match(v.warnings.join('\n'), /1 of the file’s 3 audit entries does not match its checksum and is not kept/);
});

test('the integrity check reports an edited or missing audit entry', async () => {
  const job = demo(), c = await chain(4, job.id);
  const base = { jobs: [job], cards: [], photos: [], revisions: [], tanks: [], metaKeys: [] };
  const clean = await checkIntegrity({ ...base, audit: c }, { hash: sha256 });
  assert.ok(!clean.some((p) => p.code.startsWith('audit')));
  const bad = await checkIntegrity({ ...base, audit: [c[0], { ...c[1], note: 'x' }, c[3]] }, { hash: sha256 });
  assert.deepEqual(bad.filter((p) => p.code.startsWith('audit')).map((p) => p.code).sort(), ['audit-gap', 'audit-hash']);
});

test('a 1,000-indication job: working out one edit’s changes and its entry stays fast', async () => {
  const a = demo(), proto = a.indications[0];
  a.indications = Array.from({ length: 1000 }, (_, i) => ({ ...structuredClone(proto), id: 'i' + i, no: 'I' + i, mflPct: i % 80 }));
  const b = structuredClone(a); b.indications[500].mflPct = 99;
  auditChanges(a, b); // warm up
  const t0 = performance.now(), N = 20;
  let e;
  for (let i = 0; i < N; i++) { const snap = structuredClone(b); e = await makeEntry({ jobId: 'j', at: i, by: BY, source: 'edit', changes: auditChanges(a, snap) }, null); }
  const ms = (performance.now() - t0) / N;
  assert.equal(e.changes.length, 1); assert.equal(e.changes[0].item, 'I500');
  assert.ok(ms < 60, `one edit took ${ms.toFixed(1)} ms`);
  console.log(`# audit work for one edit of a 1,000-indication job: ${ms.toFixed(1)} ms`);
});
