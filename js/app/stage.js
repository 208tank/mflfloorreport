// Stage changes (data integrity stage 8b): every way of changing a job's stage — the Setup field, the Dashboard
// board, the header's Reopen button — goes through here, so each one keeps a revision, Complete freezes the
// report, and leaving Complete asks for a reason. Core module.
import { APP_VERSION, S } from './state.js';
import { commit, flushSave, stageWrite, writeNow } from './persist.js';
import { renderHeader } from './header.js';
import { onAction } from './actions.js';
import { writeStageToFile } from './folder.js';
import { renderAll } from './nav.js';
import { addRevision, isLocked, stageRevision } from './revisions.js';
import { auditSource, logChange } from './auditlog.js';
import { api653 } from '../calc.js';
import { jobCard } from '../cards.js';
import { db } from '../db.js';
import { buildLayout } from '../geometry.js';
import { defaultStatus, migrate, STAGE_LABEL } from '../model.js';
import { buildReport } from '../report.js';
import { askConfirm, askText, toast } from '../ui.js';
import { adminName, adoptPin, isAdmin, pinForJob } from './admin.js';
import { stageChangeKind, stageChangeRefusal } from '../roles.js';
import { sha256 } from '../util.js';

/** The report of a job as it would be printed now. For the open job the screen's own layout, results and photos are
 *  used; for any other job they are worked out from the stored copy. */
/** The job's revision history for the report's document control: revisions saved to a job file and issued reports,
 *  oldest first. */
export async function reportHistory(jobId) {
  const revs = await db.jobRevisions(jobId).catch(() => []);
  return revs.filter((r) => r.reason === 'file-save' || r.reason === 'issued').sort((a, b) => a.n - b.n)
    .map((r) => ({ rev: r.rev || '', at: r.at, by: r.by?.name || '', note: r.reason === 'issued' ? 'Report issued (job Complete)' : r.note || 'Saved to a job file' }));
}

export async function reportHTMLOf(job, opts = S.reportOpts) {
  if (!opts.history) opts = { ...opts, history: await reportHistory(job.id) };
  if (S.job && job === S.job) return buildReport(job, S.layout, S.calc, S.company, S.photos, opts);
  const j = migrate(structuredClone(job)), layout = buildLayout(j);
  return buildReport(j, layout, api653(j, layout), S.company, await db.jobPhotos(j.id), opts);
}

/** Ask why a Complete job is being reopened. Resolves the reason, or null if the person cancels. */
export function askReopenReason(job) {
  return askText(`${job.info?.tankId || 'This job'} is Complete and its report has been issued. Reopening it unlocks the job for changes; the issued report is kept as it is.\n\nWhy is it being reopened?`,
    { ok: 'Reopen', label: 'Reason (kept with the job’s history)', placeholder: 'e.g. Client asked for the nozzle readings to be added' });
}

/** Freeze the report of a job that has just become Complete: an 'issued' revision holding the report exactly as
 *  printed, and job.issued pointing to it. The caller saves the job. */
async function issue(job, from) {
  const opts = { ...S.reportOpts, history: await reportHistory(job.id) }, html = await reportHTMLOf(job, opts), at = Date.now();
  const hash = await sha256(html);
  const r = await addRevision(job, 'issued', `${STAGE_LABEL[from] || from || '—'} → Complete: report issued`, { issued: { html, opts, appVersion: APP_VERSION, at, hash } });
  job.issued = { n: r.n, at, hash, appVersion: APP_VERSION };
  return r;
}

/** Change a job's stage, open or stored (the caller updates the linked folder's file). Resolves false if nothing changed (same stage, or reopening cancelled). */
export async function changeStage(jobOrId, to) {
  const open = S.job && (jobOrId === S.job || jobOrId === S.job.id);
  const job = open ? S.job : typeof jobOrId === 'string' ? await db.getJob(jobOrId) : jobOrId;
  if (!job) return false;
  if (open) job.status = job.status || {}; else job.status = { ...defaultStatus(), ...(job.status || jobCard(job)) };
  const from = job.status.stage;
  if (from === to) return false;
  await adoptPin(job);
  // v3.40: from Peer review on, only an admin changes the stage; inspectors send the job to Peer review
  const admin = isAdmin(job), refusal = stageChangeRefusal(from, to, admin);
  if (refusal) { toast(refusal); return false; }
  const kind = stageChangeKind(from, to), name = job.info?.tankId || 'this job';
  let reason = '';
  if (isLocked(job)) { reason = await askReopenReason(job); if (reason === null) return false; }
  else if (kind === 'submit' && !admin && !(await askConfirm(`Send ${name} to ${STAGE_LABEL[to]}?\n\nFrom then on it is locked for inspectors: only an admin can edit it, or unlock it for you.`, { ok: `Send to ${STAGE_LABEL[to]}` }))) return false;
  else if (kind === 'unlock') {
    reason = await askText(`Unlock ${name} for the inspector? It goes back to ${STAGE_LABEL[to]} and can be edited again.\n\nWhy is it being unlocked?`, { ok: 'Unlock', label: 'Reason (kept with the job’s history)', placeholder: 'e.g. Peer review comments to address' });
    if (reason === null) return false;
  }
  if (kind === 'submit' || admin) { const pin = pinForJob(job); if (pin && !job.adminPin) job.adminPin = pin; } // the PIN travels with the job
  const now = Date.now(), before = open ? null : structuredClone(job);
  const by = admin ? adminName() : '';
  const note = (reason ? (kind === 'unlock' ? 'Unlocked for the inspector: ' : 'Reopened: ') + reason : to === 'complete' ? 'Report issued' : '') + (by ? `${reason || to === 'complete' ? ' ' : ''}(admin: ${by})` : '');
  job.status.stage = to;
  const entry = { stage: to, at: now, ...(reason ? { reason } : {}), ...(by ? { admin: by } : {}) };
  (job.status.history = job.status.history || []).push(entry);
  if (open) { auditSource('stage', note); stageWrite.add(job.id); commit(); await flushSave(); stageWrite.delete(job.id); }
  else { job.updated = now; await db.putJob(job); await logChange(job.id, before, job, 'stage', note).catch((e) => console.warn('Audit', e)); }
  if (to === 'complete') {
    await issue(job, from).catch((e) => console.warn('Issue', e));
    if (open) await writeNow(); else await db.putJob(job);
  } else {
    await stageRevision(job, from, to, note);
  }
  if (open) renderHeader();
  return true;
}

/* The header's Reopen button (admins): back to Admin review, editable in admin mode. Unlock: back to Reporting, so the
   inspector can edit it again. */
onAction({
  'reopen': async () => {
    if (!S.job || !(await changeStage(S.job, 'admin'))) return;
    writeStageToFile(S.job.id, 'admin'); renderAll();
  },
  'unlock-insp': async () => {
    if (!S.job || !(await changeStage(S.job, 'reporting'))) return;
    writeStageToFile(S.job.id, 'reporting'); renderAll();
  },
});
