// Backup file format (data integrity stage 5): js/backup.js. Runs in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backupPieces, verifyBackup, planRestore, entryAsCopy, backupName, BACKUP_FORMAT } from '../js/backup.js';

const demo = JSON.parse(readFileSync(new URL('./fixtures/demo.json', import.meta.url), 'utf8'));

function device() {
  const a = structuredClone(demo); a.id = 'job-a'; a.updated = 1000;
  const b = structuredClone(demo); b.id = 'job-b'; b.info.tankId = 'TK-202'; b.updated = 2000;
  const sec = Object.keys(b.secs || {})[0];
  if (sec) { b.secs[sec].recs = [{ id: 'r1', photo: 'pb1', finding: 'x' }]; }
  const photos = { 'pa1': { id: 'pa1', jobId: 'job-a', dataUrl: 'data:image/png;base64,AAAA', caption: 'one' }, 'pb1': { id: 'pb1', jobId: 'job-b', dataUrl: 'data:image/png;base64,BBBB', caption: 'two' } };
  const revs = { 'job-a': [{ id: 'job-a:1', jobId: 'job-a', n: 1, reason: 'migration', job: { id: 'job-a' }, photoIds: ['pa1'] }], 'job-b': [] };
  const audit = { 'job-a': [{ seq: 7, jobId: 'job-a', at: 5, action: 'edit' }], 'job-b': [] };
  return {
    jobs: { 'job-a': a, 'job-b': b }, photos, revs, audit,
    src: (over = {}) => ({
      created: 1794700000000, appVersion: '3.14.0', schema: 4, settings: { name: 'Test Co' }, tanks: [{ id: 't1', info: { tankId: 'TK-101' } }],
      jobIds: ['job-a', 'job-b'], getJob: async (id) => ({ 'job-a': a, 'job-b': b })[id], photoKeys: async (id) => Object.values(photos).filter((p) => p.jobId === id).map((p) => p.id),
      getPhoto: async (k) => photos[k], revisions: async (id) => revs[id], audit: async (id) => audit[id], ...over,
    }),
  };
}
async function build(src) { const out = {}; let text = ''; for await (const c of backupPieces(src, out)) text += c; return { text, out }; }

test('backup: the pieces make one valid JSON file whose checksum verifies', async () => {
  const { src } = device();
  const { text, out } = await build(src());
  const data = JSON.parse(text);
  assert.equal(data.format, BACKUP_FORMAT);
  assert.equal(data.jobs.length, 2);
  assert.deepEqual(out.counts, { jobs: 2, photos: 2, revisions: 1, audit: 1, tanks: 1 });
  assert.equal(out.bytes, new TextEncoder().encode(text).length);
  assert.equal(data.hash, out.hash);
  const v = await verifyBackup(data, { schema: 4 });
  assert.equal(v.ok, true, v.error);
  assert.deepEqual(v.counts, out.counts);
});

test('backup: the same data always gives the same file', async () => {
  const { src } = device();
  assert.equal((await build(src())).text, (await build(src())).text);
});

test('backup: any change to the data is detected', async () => {
  const { src } = device();
  const { text } = await build(src());
  const edits = [
    (d) => { d.jobs[0].photos[0].caption = 'changed'; },
    (d) => { d.jobs[1].job.info.tankId = 'TK-999'; },
    (d) => { d.jobs.pop(); },
    (d) => { d.jobs.reverse(); },
    (d) => { d.tanks[0].info.tankId = 'X'; },
    (d) => { d.settings.name = 'Other'; },
    (d) => { d.jobs[0].revisions = []; },
    (d) => { d.created = '2020-01-01T00:00:00.000Z'; },
  ];
  for (const edit of edits) {
    const d = JSON.parse(text); edit(d);
    const v = await verifyBackup(d, { schema: 4 });
    assert.equal(v.ok, false, String(edit));
    assert.match(v.error, /checksum/);
  }
});

test('backup: wrong, incomplete, damaged and newer files are refused with a reason', async () => {
  const { src } = device();
  const d = JSON.parse((await build(src())).text);
  assert.match((await verifyBackup({ format: 'tank-floor-inspector', version: 1, job: {} })).error, /job file/);
  assert.match((await verifyBackup({ format: 'something' })).error, /not a Tank Floor Inspector backup/);
  assert.match((await verifyBackup({ ...d, version: 2 }, { schema: 4 })).error, /newer version/);
  assert.match((await verifyBackup({ ...d, schema: 5 }, { schema: 4 })).error, /newer version/);
  const noHash = { ...d }; delete noHash.hash;
  assert.match((await verifyBackup(noHash)).error, /missing/);
  const broken = JSON.parse(JSON.stringify(d)); delete broken.jobs[0].photos;
  assert.match((await verifyBackup(broken)).error, /incomplete/);
  assert.equal((await verifyBackup(null)).ok, false);
});

test('backup: restore preview sorts jobs into new / same / differs and says which copy changed later', async () => {
  const dv = device();
  const data = JSON.parse((await build(dv.src())).text);
  const devB = structuredClone(dv.jobs['job-b']); devB.info.client = 'Changed on device'; devB.updated = 9000;
  const plan = await planRestore(data, {
    jobs: new Map([['job-a', { job: dv.jobs['job-a'], photoIds: new Set(['pa1']) }], ['job-b', { job: devB, photoIds: new Set(['pb1']) }]]),
    tanks: new Map([['t1', { id: 't1', info: { tankId: 'TK-101' } }]]),
  });
  assert.deepEqual(plan.jobs.map((p) => [p.id, p.status, p.newer]), [['job-a', 'same', 'unknown'], ['job-b', 'differs', 'device']]);
  assert.equal(plan.tanks[0].status, 'same');
  const empty = await planRestore(data, { jobs: new Map(), tanks: new Map() });
  assert.deepEqual(empty.jobs.map((p) => p.status), ['new', 'new']);
  assert.equal(empty.tanks[0].status, 'new');
  // a different photo set makes the job differ even when the job data is the same
  const p2 = await planRestore(data, { jobs: new Map([['job-a', { job: dv.jobs['job-a'], photoIds: new Set() }]]), tanks: new Map() });
  assert.equal(p2.jobs.find((p) => p.id === 'job-a').status, 'differs');
});

test('backup: "keep both" copies get new ids for the job and photos, with every link moved', async () => {
  const dv = device();
  const data = JSON.parse((await build(dv.src())).text);
  let n = 0;
  const b = entryAsCopy(data.jobs[1], { job: 'job-new', photo: () => 'np' + ++n });
  assert.equal(b.job.id, 'job-new');
  assert.match(b.job.info.tankId, /from backup/);
  assert.deepEqual(b.photos.map((p) => [p.id, p.jobId]), [['np1', 'job-new']]);
  const sec = Object.keys(b.job.secs || {})[0];
  if (sec) assert.equal(b.job.secs[sec].recs[0].photo, 'np1');
  const a = entryAsCopy(data.jobs[0], { job: 'job-a2', photo: () => 'qa' });
  assert.deepEqual(a.revisions.map((r) => [r.id, r.jobId, r.job.id, r.photoIds[0]]), [['job-a2:1', 'job-a2', 'job-a2', 'qa']]);
  assert.deepEqual(a.audit.map((x) => [x.seq, x.jobId]), [[undefined, 'job-a2']]);
  // the original entry is untouched
  assert.equal(data.jobs[1].job.id, 'job-b');
});

test('backup: file names sort by date, and automatic backups are told apart', () => {
  assert.equal(backupName(Date.UTC(2026, 10, 15, 7, 5)), 'tfi-backup_2026-11-15-07-05.tfibackup.json');
  assert.equal(backupName(Date.UTC(2026, 10, 15, 7, 5), true), 'tfi-backup_auto_2026-11-15-07-05.tfibackup.json');
});
