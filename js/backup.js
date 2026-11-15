// Device backup file (data integrity stage 5): every job with its photos, revisions and audit trail, the tank
// registry and the company settings, in one .tfibackup.json file. No browser APIs here, so the tests run it in Node.
//
// File:  {"format":"tank-floor-inspector-backup","version":1,"created":…,"appVersion":…,"schema":…,
//         "settings":{…},"tanks":[…],"jobs":[{"job":{…},"photos":[…],"revisions":[…],"audit":[…]},…],"hash":"…"}
// It is written in pieces (one photo at a time), so a device with thousands of photos never needs one huge string.
// Checksum: every piece (the header, the settings, each tank, each job, photo, revision and audit entry) is
// hashed as written; "hash" is the SHA-256 of those hashes in order. Reading the file back and re-serialising
// each piece gives the same text, so any changed, missing or extra byte in the data is detected.
// Equipment lists travel inside each job (there is no separate equipment store).
import { sha256 } from './util.js';

export const BACKUP_FORMAT = 'tank-floor-inspector-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_TYPES = [{ description: 'Tank Floor Inspector backup', accept: { 'application/json': ['.json'] } }];

/** File name for a backup made on `at` (auto backups get their own prefix so only they are pruned). */
export const backupName = (at, auto = false) => `tfi-backup_${auto ? 'auto_' : ''}${new Date(at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.tfibackup.json`;

/**
 * The backup file in pieces. src supplies the data:
 *   { created, appVersion, schema, settings, tanks: [..], jobIds: [..], getJob(id), photoKeys(id), getPhoto(key),
 *     revisions(id), audit(id) }   (the getters may be async)
 * Yields strings; when the generator finishes, out.hash, out.counts and out.bytes are filled in.
 */
export async function* backupPieces(src, out = {}) {
  const hashes = [], counts = { jobs: 0, photos: 0, revisions: 0, audit: 0, tanks: 0 };
  let bytes = 0;
  const piece = async (v) => { const t = JSON.stringify(v); hashes.push(await sha256(t)); return t; };
  const emit = (t) => { bytes += new TextEncoder().encode(t).length; return t; };
  const header = { format: BACKUP_FORMAT, version: BACKUP_VERSION, created: new Date(src.created).toISOString(), appVersion: src.appVersion, schema: src.schema };
  yield emit((await piece(header)).slice(0, -1) + ',"settings":' + (await piece(src.settings || {})) + ',"tanks":[');
  let first = true;
  for (const t of src.tanks || []) { yield emit((first ? '' : ',') + (await piece(t))); first = false; counts.tanks++; }
  yield emit('],"jobs":[');
  let firstJob = true;
  for (const id of src.jobIds) {
    const job = await src.getJob(id); if (!job) continue;
    yield emit((firstJob ? '' : ',') + '{"job":' + (await piece(job)) + ',"photos":['); firstJob = false; counts.jobs++;
    let f = true;
    for (const k of await src.photoKeys(id)) {
      const p = await src.getPhoto(k); if (!p) continue;
      yield emit((f ? '' : ',') + (await piece(p))); f = false; counts.photos++;
    }
    yield emit('],"revisions":[');
    f = true;
    for (const r of await src.revisions(id)) { yield emit((f ? '' : ',') + (await piece(r))); f = false; counts.revisions++; }
    yield emit('],"audit":[');
    f = true;
    for (const a of await src.audit(id)) { yield emit((f ? '' : ',') + (await piece(a))); f = false; counts.audit++; }
    yield emit(']}');
  }
  out.hash = await sha256(hashes.join('\n'));
  out.counts = counts;
  yield emit('],"hash":' + JSON.stringify(out.hash) + '}');
  out.bytes = bytes;
}

/** Check a parsed backup file. Returns { ok, error?, counts }. Nothing is changed. */
export async function verifyBackup(data, { schema } = {}) {
  const bad = (error) => ({ ok: false, error });
  if (!data || typeof data !== 'object') return bad('it is not a backup file.');
  if (data.format !== BACKUP_FORMAT) return bad(data.format === 'tank-floor-inspector' ? 'it is a job file, not a backup. Open it with Jobs → Open job file….' : 'it is not a Tank Floor Inspector backup file.');
  if (!(data.version >= 1)) return bad('its version is missing.');
  if (data.version > BACKUP_VERSION || (schema && data.schema > schema)) return bad(`it was made by a newer version of the app${data.appVersion ? ' (v' + data.appVersion + ')' : ''}. Update the app (reload it), then restore again.`);
  if (!Array.isArray(data.jobs) || !Array.isArray(data.tanks) || typeof data.hash !== 'string') return bad('parts of it are missing — it may be damaged or incomplete.');
  const hashes = [];
  const add = async (v) => hashes.push(await sha256(JSON.stringify(v)));
  const { format, version, created, appVersion, schema: sch } = data;
  await add({ format, version, created, appVersion, schema: sch });
  await add(data.settings || {});
  for (const t of data.tanks) await add(t);
  const counts = { jobs: 0, photos: 0, revisions: 0, audit: 0, tanks: data.tanks.length };
  for (const e of data.jobs) {
    if (!e?.job?.id || !Array.isArray(e.photos) || !Array.isArray(e.revisions) || !Array.isArray(e.audit)) return bad('a job in it is incomplete — the file may be damaged.');
    if (schema && (e.job.schema || 1) > schema) return bad('a job in it was saved by a newer version of the app. Update the app (reload it), then restore again.');
    await add(e.job); counts.jobs++;
    for (const p of e.photos) { await add(p); counts.photos++; }
    for (const r of e.revisions) { await add(r); counts.revisions++; }
    for (const a of e.audit) { await add(a); counts.audit++; }
  }
  if ((await sha256(hashes.join('\n'))) !== data.hash) return bad('its checksum does not match — the file has been changed or damaged since it was made.');
  return { ok: true, counts };
}

/**
 * Compare each job and tank in a backup with the device. device = { jobs: Map(id → { job, photoIds:Set }), tanks: Map(id → tank) }.
 * Returns { jobs: [{ id, entry, status: 'new'|'same'|'differs', device?, newer? }], tanks: [{ id, tank, status }] }.
 * 'same' = identical job data and the same photos. newer = 'backup' | 'device' | 'unknown' by last change.
 */
export async function planRestore(data, device) {
  const jobs = [];
  for (const entry of data.jobs) {
    const id = entry.job.id, d = device.jobs.get(id);
    if (!d) { jobs.push({ id, entry, status: 'new' }); continue; }
    const same = (await sha256(entry.job)) === (await sha256(d.job)) && entry.photos.length === d.photoIds.size && entry.photos.every((p) => d.photoIds.has(p.id));
    const bu = entry.job.updated || 0, du = d.job.updated || 0;
    jobs.push({ id, entry, status: same ? 'same' : 'differs', device: d.job, newer: bu > du ? 'backup' : du > bu ? 'device' : 'unknown' });
  }
  const tanks = [];
  for (const t of data.tanks) {
    const d = device.tanks.get(t.id);
    tanks.push({ id: t.id, tank: t, status: !d ? 'new' : (await sha256(t)) === (await sha256(d)) ? 'same' : 'differs' });
  }
  return { jobs, tanks };
}

/**
 * A backup entry rewritten as a separate copy ("keep both"): new job id, new photo ids (with the job's photo links
 * updated), revisions and audit entries moved to the new job. ids = { job: newId, photo: (oldId) → newId }.
 */
export function entryAsCopy(entry, ids) {
  const job = JSON.parse(JSON.stringify(entry.job));
  job.id = ids.job; job.info = { ...job.info, tankId: (job.info?.tankId || 'Tank') + ' (from backup)' };
  const pmap = new Map(entry.photos.map((p) => [p.id, ids.photo(p.id)]));
  for (const sec of Object.values(job.secs || {})) for (const r of sec.recs || []) if (r.photo && pmap.has(r.photo)) r.photo = pmap.get(r.photo);
  const photos = entry.photos.map((p) => ({ ...p, id: pmap.get(p.id), jobId: job.id }));
  const revisions = entry.revisions.map((r) => ({ ...r, jobId: job.id, id: `${job.id}:${r.n}`, job: r.job ? { ...r.job, id: job.id } : r.job, photoIds: (r.photoIds || []).map((k) => pmap.get(k) || k) }));
  const audit = entry.audit.map(({ seq, ...a }) => ({ ...a, jobId: job.id }));
  return { job, photos, revisions, audit };
}
