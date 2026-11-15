// Stage changes (data integrity stage 8b): every way of changing a job's stage — the Setup field, the Dashboard
// board, the header's Reopen button — goes through here, so each one keeps a revision, Complete freezes the
// report, and leaving Complete asks for a reason. Core module.
import { APP_VERSION, S } from './state.js';
import { commit, flushSave, writeNow } from './persist.js';
import { renderHeader } from './header.js';
import { onAction } from './actions.js';
import { writeStageToFile } from './folder.js';
import { renderAll } from './nav.js';
import { addRevision, isLocked, stageRevision } from './revisions.js';
import { api653 } from '../calc.js';
import { jobCard } from '../cards.js';
import { db } from '../db.js';
import { buildLayout } from '../geometry.js';
import { defaultStatus, migrate, STAGE_LABEL } from '../model.js';
import { buildReport } from '../report.js';
import { askText } from '../ui.js';
import { sha256 } from '../util.js';

/** The report of a job as it would be printed now. For the open job the screen's own layout, results and photos are
 *  used; for any other job they are worked out from the stored copy. */
export async function reportHTMLOf(job, opts = S.reportOpts) {
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
  const opts = { ...S.reportOpts }, html = await reportHTMLOf(job, opts), at = Date.now();
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
  let reason = '';
  if (isLocked(job)) { reason = await askReopenReason(job); if (reason === null) return false; }
  const now = Date.now();
  job.status.stage = to;
  (job.status.history = job.status.history || []).push(reason ? { stage: to, at: now, reason } : { stage: to, at: now });
  if (open) { commit(); await flushSave(); } else { job.updated = now; await db.putJob(job); }
  if (to === 'complete') {
    await issue(job, from).catch((e) => console.warn('Issue', e));
    if (open) await writeNow(); else await db.putJob(job);
  } else {
    await stageRevision(job, from, to, reason ? 'Reopened: ' + reason : '');
  }
  if (open) renderHeader();
  return true;
}

/* The header's Reopen button: back to Peer review, which stays editable. */
onAction({
  'reopen': async () => {
    if (!S.job || !(await changeStage(S.job, 'review'))) return;
    writeStageToFile(S.job.id, 'review'); renderAll();
  },
});
