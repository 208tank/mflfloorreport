// Stage 4 — database integrity validation (js/integrity.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { checkIntegrity, SAFE_REPAIRS } from '../js/integrity.js';
import { lite } from '../js/db.js';
import { migrate } from '../js/model.js';
import { sha256 } from '../js/util.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const clean = async () => {
  const a = migrate(fx('demo.json')), b = { ...migrate(fx('demo.json')), id: 'job-b', info: { ...fx('demo.json').info, tankId: 'TK-202' } };
  const ind = a.indications[0];
  return {
    jobs: [a, b], cards: [lite(a), lite(b)], tanks: [],
    photos: [{ id: 'p1', jobId: a.id, indId: ind.id, ok: true }],
    revisions: [{ id: a.id + ':1', jobId: a.id, n: 1, hash: await sha256(a), job: a, photoIds: ['p1'] }],
    metaKeys: ['company', 'fh:' + a.id]
  };
};
const run = (d, full = true) => checkIntegrity(d, { hash: full ? sha256 : null, lite });
const codes = (ps) => ps.map((p) => p.code).sort();

test('every fixture job, as a clean database, has no problems other than the plate warnings its calculation also gives', async () => {
  for (const f of readdirSync(new URL('./fixtures/', import.meta.url)).filter((x) => x.endsWith('.json'))) {
    const j = migrate(fx(f));
    const ps = await run({ jobs: [j], cards: [lite(j)], photos: [], revisions: [], tanks: [], metaKeys: [] });
    // some test jobs really have indications off their layout: expect the check to agree with the calculation's own warning
    const gold = JSON.parse(readFileSync(new URL(`./golden/${f.replace('.json', '.calc.json')}`, import.meta.url), 'utf8'));
    const offLayout = gold.calc.warnings.some((w) => /no valid plate location/.test(w));
    assert.deepEqual(codes(ps), offLayout ? ['job-ind-plate'] : [], f);
  }
  assert.deepEqual(await run(await clean()), []);
});

test('job faults: no id, newer schema, not a number, duplicate indications, lost plate, missing tank', async () => {
  const d = await clean(), b = d.jobs[1];
  d.jobs.push({ info: {} });
  d.jobs.push({ ...b, id: 'newer', schema: 99 }); d.cards.push(lite({ ...b, id: 'newer', schema: 99 }));
  b.tank = { ...b.tank, diameter: 'abc' };
  b.indications = [...b.indications, { ...b.indications[0] }, { ...b.indications[1], id: 'lost', no: 'L1', plate: 'nowhere' }];
  b.tankRef = 'gone';
  d.cards[1] = lite(b);
  const c = codes(await run(d));
  for (const k of ['job-no-id', 'job-newer', 'job-number', 'job-dup-ind', 'job-ind-plate', 'job-tank']) assert.ok(c.includes(k), k);
});

test('job list faults are found and offered a safe repair', async () => {
  const d = await clean();
  d.cards = [{ ...d.cards[0], info: { ...d.cards[0].info, tankId: 'OLD NAME' } }, { id: 'ghost', info: { tankId: 'Ghost' } }];
  const ps = await run(d);
  assert.deepEqual(codes(ps), ['card-missing', 'card-orphan', 'card-stale']);
  assert.ok(ps.every((p) => SAFE_REPAIRS.has(p.repair)));
});

test('photo faults: orphan (not kept by a revision), damaged image, deleted indication', async () => {
  const d = await clean();
  d.photos.push({ id: 'orphan', jobId: 'deleted-job', ok: true }, { id: 'kept', jobId: 'deleted-job', ok: true }, { id: 'bad', jobId: d.jobs[0].id, ok: false }, { id: 'noind', jobId: d.jobs[0].id, indId: 'gone', ok: true });
  d.revisions.push({ id: 'deleted-job:1', jobId: 'deleted-job', n: 1, hash: 'x', photoIds: ['kept'] });
  const ps = await run(d, false);
  assert.deepEqual(codes(ps), ['photo-bad', 'photo-ind', 'photo-orphan']);
  const o = ps.find((p) => p.code === 'photo-orphan');
  assert.equal(o.id, 'orphan'); assert.equal(o.repair, 'delete-photo');
  assert.ok(!SAFE_REPAIRS.has('delete-photo'), 'deleting a photo is never a safe repair');
});

test('a changed revision fails its checksum (full check only); file links to deleted jobs are found', async () => {
  const d = await clean();
  d.revisions[0] = { ...d.revisions[0], job: { ...d.revisions[0].job, info: { ...d.revisions[0].job.info, client: 'Tampered' } } };
  d.metaKeys.push('fh:deleted-job', 'fstamp:deleted-job');
  assert.deepEqual(codes(await run(d, true)), ['meta-orphan', 'meta-orphan', 'rev-hash']);
  assert.deepEqual(codes(await run(d, false)), ['meta-orphan', 'meta-orphan']);
});

test('the check never changes the data it is given', async () => {
  const d = await clean(); d.cards = []; d.photos.push({ id: 'o', jobId: 'x', ok: true });
  const before = JSON.stringify(d);
  await run(d);
  assert.equal(JSON.stringify(d), before);
});
