// Inspector and admin roles (v3.40.0, schema 8). No browser APIs, so the tests run it in Node.
//
// Two levels: inspectors create jobs and edit them until they are sent to Peer review; from then on (Peer review,
// Admin review, Complete) only an admin can edit the job, change its stage or unlock it for the inspector. An admin
// is whoever has entered the admin PIN on this device in this session (admin mode). There is no server: this is a
// workflow lock inside the app, recorded in each job's stage history and audit trail, not protection against
// someone editing a job file by hand.
//
// The PIN is kept only as a hash: in the company settings of each device (meta 'company', adminPin) and in each job
// that has reached Peer review (job.adminPin), so a device that opens such a job learns the PIN from it, and a PIN
// set on another device does not unlock it.
import { sha256 } from './util.js';

/** Stages at which the job is read-only for inspectors. */
export const LOCK_STAGES = new Set(['review', 'admin', 'complete']);
export const inspectorLocked = (job) => LOCK_STAGES.has(job?.status?.stage);

export const pinHash = (pin) => sha256('tfi-admin-pin:' + String(pin ?? '').trim());
export const pinOk = (pin) => /^\S{4,}$/.test(String(pin ?? '').trim());

/** Is this session an admin for this job? (admin mode on, and the job, if it carries a PIN, has the one entered.) */
export function adminFor(job, session) {
  return !!session?.on && (!job?.adminPin || job.adminPin === session.hash);
}

/** Why a stage change is not allowed for this person, or '' when it is. */
export function stageChangeRefusal(from, to, admin) {
  if (admin || from === to) return '';
  if (LOCK_STAGES.has(from)) return 'This job is in ' + (from === 'review' ? 'Peer review' : from === 'admin' ? 'Admin review' : 'Complete') + ': only an admin can change its stage or unlock it for editing.';
  if (to === 'admin' || to === 'complete') return 'Only an admin can move a job to Admin review or Complete. Send it to Peer review when the report is ready.';
  return '';
}

/** What a stage change means, for the confirmation and the history: 'submit' (inspector hands it over), 'unlock'
 *  (an admin hands it back to the inspector), 'reopen' (out of Complete) or ''. */
export function stageChangeKind(from, to) {
  if (from === 'complete' && to !== 'complete') return 'reopen';
  if (!LOCK_STAGES.has(from) && LOCK_STAGES.has(to)) return 'submit';
  if (LOCK_STAGES.has(from) && !LOCK_STAGES.has(to)) return 'unlock';
  return '';
}
