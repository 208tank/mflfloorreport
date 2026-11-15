// Baseline revisions, crash recovery and the device data check (refactoring step 6; revisions themselves are in
// js/app/revisions.js). The data check's panel is on the
// Jobs screen (Settings); its buttons are handled here. Audit logging (data integrity stage 9) will join this module.
import { S } from '../app/state.js';
import { go } from '../app/nav.js';
import { onAction } from '../app/actions.js';
import { journal, loadJobs } from '../app/persist.js';
import { addRevision } from '../app/revisions.js';
import { logChange } from '../app/auditlog.js';
import { db, lite } from '../db.js';
import { checkIntegrity, SAFE_REPAIRS } from '../integrity.js';
import { recoveryDiff } from '../journal.js';
import { migrate } from '../model.js';
import { $, askChoice, askConfirm, toast } from '../ui.js';
import { esc as h, sha256 } from '../util.js';

/** After the history stores are added, give every existing job one baseline revision (once). */
export async function baselineRevisions() {
  if (await db.getMeta('baseline:v4')) return;
  for (const c of S.jobs) {
    if (await db.revisionCount(c.id)) continue;
    const j = await db.getJob(c.id); if (!j) continue;
    await addRevision(j, 'migration', 'Baseline at upgrade to the data integrity version');
  }
  await db.setMeta('baseline:v4', Date.now());
}

/** Changes left in the recovery journal by a tab that closed before they reached the device. */
export async function recoverAfterCrash() {
  let restored = 0;
  for (const e of journal.orphans()) {
    if (e.broken) { journal.remove(e.key.slice('tfi-journal:'.length)); continue; }
    const stored = await db.getJob(e.job.id), d = recoveryDiff(e, stored);
    if (d.action !== 'offer') { journal.remove(e.job.id); continue; }
    const name = e.job.info?.tankId || 'Untitled tank';
    const choice = await askChoice(`The app closed before some changes reached this device.\n\n${name}${e.job.info?.client ? ' — ' + e.job.info.client : ''}\n${d.n} change${d.n === 1 ? '' : 's'}${d.areas.length ? ' (' + d.areas.join(', ') + ')' : ''}, last made ${new Date(d.at).toLocaleString()}.\n\nRestore them? The job as it is on the device now is kept as a revision either way.`, [['discard', 'Discard these changes', 'danger'], ['restore', 'Restore them', 'primary']]);
    if (choice === 'restore') {
      await addRevision(stored, 'before-replace', 'Before restoring changes after an unexpected close');
      await db.putJob(migrate(e.job));
      await addRevision(migrate(e.job), 'restore', 'Recovered after an unexpected close').catch((err) => console.warn('Revision', err));
      await logChange(stored.id, stored, migrate(e.job), 'recovery', 'Changes that had not reached the device when the app closed').catch((err) => console.warn('Audit', err));
      restored++;
    }
    if (choice === 'restore' || choice === 'discard') journal.remove(e.job.id); // no answer (dialog dismissed): ask again next time
  }
  if (restored) { await loadJobs(); toast(`Restored the changes to ${restored} job${restored > 1 ? 's' : ''}.`); }
}

/** Check the device database. full = also open every photo and verify every revision checksum.
 *  quiet = the background check at start-up: only speaks up if something is wrong. Never changes data. */
export async function runIntegrity(full = true, quiet = false) {
  S.integrity = { ...(S.integrity || {}), running: true }; renderIntegrity();
  try {
    const [jobs, cards, photos, revisions, tanks, metaKeys, audit] = await Promise.all([db.allJobs(), db.allCards(), db.photoIndex(full), full ? db.allRevisions() : db.revisionHeads(), db.allTanks(), db.metaKeys(), full ? db.allAudit() : null]);
    const problems = await checkIntegrity({ jobs, cards, photos, revisions, tanks, metaKeys, audit }, { hash: full ? sha256 : null, lite, yieldEvery: 5 });
    S.integrity = { at: Date.now(), full, problems, counts: { jobs: jobs.length, photos: photos.length, revisions: revisions.length } };
    await db.setMeta('integrity:last', { at: S.integrity.at, full, n: problems.length, errors: problems.filter((p) => p.severity === 'error').length });
    if (quiet && problems.length) toast(`The data check found ${problems.length} problem${problems.length > 1 ? 's' : ''} on this device.`, { label: 'Review', fn: () => { go('jobs'); setTimeout(() => $('#integrityRes')?.scrollIntoView(), 50); } });
  } catch (e) { S.integrity = { at: Date.now(), error: String(e.message || e), problems: [] }; }
  renderIntegrity();
  return S.integrity;
}

export function integrityHTML() {
  const I = S.integrity; if (!I || I.running) return I?.running ? '<p class="muted small">Checking…</p>' : '';
  if (I.error) return `<p class="bad small">The check could not run: ${h(I.error)}</p>`;
  if (!I.problems.length) return `<p class="ok small">No problems found (${I.counts.jobs} jobs, ${I.counts.photos} photos, ${I.counts.revisions} revisions${I.full ? ', checksums verified' : ''}).</p>`;
  const safe = I.problems.filter((p) => SAFE_REPAIRS.has(p.repair)).length;
  return `<ul class="integrity-list">${I.problems.map((p, i) => `<li class="${p.severity}"><b>${p.severity === 'error' ? 'Problem' : 'Warning'}:</b> ${h(p.message)}${p.repair === 'delete-photo' ? ` <button class="btn sm ghost danger" data-act="integrity-fix" data-i="${i}">Delete photo…</button>` : p.repair ? ` <button class="btn sm" data-act="integrity-fix" data-i="${i}">Repair</button>` : ''}</li>`).join('')}</ul>
    ${safe ? `<button class="btn sm primary" data-act="integrity-fix-safe">Repair the ${safe} safe problem${safe > 1 ? 's' : ''}</button>` : ''}<p class="muted small">Safe repairs only rebuild the job list or forget file links. Nothing else is changed or deleted without asking.</p>`;
}

export function renderIntegrity() {
  const el = $('#integrityRes'); if (el) el.innerHTML = integrityHTML();
  const l = $('#integrityLast'); if (l && S.integrity?.at) l.textContent = `Last checked ${new Date(S.integrity.at).toLocaleString()}${S.integrity.full ? ' (full)' : ' (quick, at start-up)'}`;
}

async function repairProblem(p) {
  if (p.repair === 'rebuild-card') { const j = await db.getJob(p.jobId); if (j) await db.putCard(j); }
  else if (p.repair === 'remove-card') await db.deleteCard(p.id);
  else if (p.repair === 'remove-meta') await db.deleteMeta(p.id);
  else if (p.repair === 'delete-photo') {
    if (!(await askConfirm('Delete this photo? It belongs to a job that is no longer on this device, and no revision refers to it. This cannot be undone.', { ok: 'Delete photo', danger: true }))) return false;
    await db.deletePhoto(p.id);
  } else return false;
  const log = (await db.getMeta('integrity:log')) || [];
  await db.setMeta('integrity:log', [...log, { at: Date.now(), code: p.code, repair: p.repair, id: p.id || p.jobId }].slice(-200));
  return true;
}

onAction({
  'integrity-run': async (el, id, e, act) => {
    await runIntegrity(true); return;
  },
  'integrity-fix': async (el, id, e, act) => {
    { const p = S.integrity?.problems?.[+el.dataset.i]; if (p && (await repairProblem(p))) { await loadJobs(); await runIntegrity(true); } return; }
  },
  'integrity-fix-safe': async (el, id, e, act) => {
    { for (const p of (S.integrity?.problems || []).filter((x) => SAFE_REPAIRS.has(x.repair))) await repairProblem(p); await loadJobs(); await runIntegrity(true); toast('Safe repairs done.'); return; }
  }
});
