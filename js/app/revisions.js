// Revisions (data integrity stage 8): immutable, checksummed snapshots of a job. Written on file save, stage change,
// Complete (with the frozen report), restore, import, migration, before an overwrite, and as a daily checkpoint.
// Never changed once written. Core module: saving (persist.js) writes the checkpoints.
import { APP_VERSION, S } from './state.js';
import { db } from '../db.js';
import { STAGE_LABEL, uid } from '../model.js';
import { BOOKKEEPING } from '../revdiff.js';
import { sha256 } from '../util.js';


/** What each kind of revision is called in the Revisions panel. */
export const REASON_LABEL = {
  'file-save': 'Saved to a file', stage: 'Stage changed', issued: 'Issued (report frozen)', restore: 'Restored', import: 'Opened from a file',
  migration: 'Before an update', 'before-replace': 'Before being replaced', checkpoint: 'Daily checkpoint', manual: 'Saved by hand',
};

/** Who is making changes on this device: the inspector name from Settings and a per-install id.
 *  Shaped so a signed-in identity (Microsoft Entra ID) can replace it later. */
export async function whoAmI() {
  let id = await db.getMeta('installId').catch(() => null);
  if (!id) { id = 'dev-' + uid(); await db.setMeta('installId', id).catch(() => {}); }
  return { name: S.company?.inspector || '', id, method: 'device' };
}

/** Add an immutable revision of a job (the job as given, without photos). extra: more fields for the record
 *  (the frozen report of an issued revision). */
export async function addRevision(job, reason, note = '', extra = {}) {
  const keys = await db.jobPhotoKeys(job.id).catch(() => []);
  return db.addRevision({ jobId: job.id, rev: job.rev || 0, at: Date.now(), by: await whoAmI(), reason, note, appVersion: APP_VERSION, schema: job.schema || 1, hash: await sha256(job), job, photoIds: keys, ...extra });
}


export { BOOKKEEPING } from '../revdiff.js';
/** Checksum of a job's content: the same inspection data gives the same value whatever its file revision. */
export async function contentHash(job) {
  const c = { ...job }; for (const k of BOOKKEEPING) delete c[k];
  return sha256(c);
}

const checkpointDay = new Map(); // jobId → the day a checkpoint is known to exist (this session)
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
/** Before the first change of the day reaches the device: keep the job as it was (once per job per day). */
export async function checkpointIfDue(jobId) {
  const today = dayOf(Date.now());
  if (checkpointDay.get(jobId) === today) return null;
  checkpointDay.set(jobId, today);
  const revs = await db.jobRevisions(jobId);
  if (revs.some((r) => r.reason === 'checkpoint' && dayOf(r.at) === today)) return null;
  const stored = await db.getJob(jobId); if (!stored) return null;
  // nothing to keep if the newest revision already holds the stored job exactly (e.g. the copy kept just before a migration)
  const last = revs.reduce((a, r) => (!a || r.n > a.n ? r : a), null);
  if (last && last.hash === (await sha256(stored))) return null;
  return addRevision(stored, 'checkpoint', 'The job as it was before the first change of the day');
}

/** A revision of the job with its new stage. */
export function stageRevision(job, from, to, note = '') {
  return addRevision(job, 'stage', `${STAGE_LABEL[from] || from || '—'} → ${STAGE_LABEL[to] || to}${note ? ': ' + note : ''}`).catch((e) => console.warn('Revision', e));
}

/** A Complete job is locked (data integrity stage 8): its inputs are read-only until it is reopened with a reason. */
export const isLocked = (job) => job?.status?.stage === 'complete';
