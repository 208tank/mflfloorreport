// Saving the open job (refactoring step 14): recalculation, the save queue and the crash-recovery journal,
// the change count, commit, the checks before leaving a job, loading the jobs list and tank registry,
// device storage, and saving before a reload. The header is updated through configurePersist (set by app.js),
// because the header in turn shows this module's change count.
import { S } from './state.js';
import { go, renderAll } from './nav.js';
import { checkpointIfDue, contentHash, isLocked } from './revisions.js';
import { auditWrite, hasAuditBase, recordWrite, setAuditBase } from './auditlog.js';
import { api653 } from '../calc.js';
import { db, requestPersistence } from '../db.js';
import { buildLayout } from '../geometry.js';
import { createJournal } from '../journal.js';
import { tankFromJob, tankKeyOf } from '../registry.js';
import { createSaver, saveErrorText } from '../saver.js';
import { $, toast } from '../ui.js';

/** Header updates the save state triggers: header = redraw the header; fileState = the job file badge only. */
const ui = { header: () => {}, fileState: () => {} };
export function configurePersist(h) { Object.assign(ui, h); }

/* The floor layout and the API 653 results are rebuilt only when their inputs change, so typing in the
   shell, roof or settlement pages doesn't recalculate the whole floor. Inputs: buildLayout reads tank,
   layout and plates; api653 also reads calc, indications and the shell courses (critical-zone limit). */
const RC = { job: null, inds: null, lay: null, calc: null };
export function recompute() {
  if (!S.job) { S.layout = null; S.calc = null; RC.job = null; return; }
  const j = S.job, same = RC.job === j && RC.inds === j.indications;
  const { rd, ...shell } = j.shell || {};
  const layKey = JSON.stringify([j.tank, j.layout, j.plates]);
  if (!same || !S.layout || layKey !== RC.lay) { S.layout = buildLayout(j); RC.lay = layKey; RC.calc = null; }
  const calcKey = JSON.stringify([j.calc, j.indications, shell]);
  if (!same || !S.calc || calcKey !== RC.calc) { S.calc = api653(j, S.layout); RC.calc = calcKey; }
  RC.job = j; RC.inds = j.indications;
}

/* Automatic saving (saver.js): one write at a time, retried on failure, never silent. */
export const saver = createSaver({ write: writeCurrent, onState: showSaveState });
/* Crash recovery (stage 3): a synchronous copy of the open job until its device write commits. */
export const journal = createJournal({ aliveMs: globalThis.__tfiAliveMs || 10000 });
journal.heartbeat(); setInterval(() => journal.heartbeat(), Math.max(200, (globalThis.__tfiAliveMs || 10000) / 3));
let journalWarned = false;
async function writeCurrent() {
  const job = S.job; if (!job) return;
  if (job.regEdit) {
    const prev = await db.getTank(job.regEdit), t = tankFromJob(job, prev);
    t.info.location = job.info.location || ''; t.info.notes = job.info.tankNotes || '';
    await db.putTank(t); await loadTanks();
    return;
  }
  if (isLocked(job) && (await refusedAsLocked(job))) return;
  await checkpointIfDue(job.id).catch((e) => console.warn('Checkpoint', e)); // stage 8: never blocks the save
  const w = auditWrite(job, hasAuditBase(job.id) ? null : await db.getJob(job.id)); // stage 9: what this write changes
  await db.putJob(job);
  await recordWrite(w).catch((e) => console.warn('Audit', e)); // never blocks the save
  renderFileState();
}
/** The Complete lock's backstop (stage 8b): a Complete job whose stored copy is Complete too may only change in its
 *  bookkeeping (file revision, save times, the issued record). Anything else that got past the screens is refused:
 *  the stored job is put back on screen and the unsaved change is dropped. */
async function refusedAsLocked(job) {
  const stored = await db.getJob(job.id);
  if (!isLocked(stored) || (await contentHash(stored)) === (await contentHash(job))) return false;
  console.warn('Refused a change to a Complete job');
  journal.clear(job.id);
  if (S.job === job) { S.job = stored; setAuditBase(stored); recompute(); renderAll(); }
  toast('This job is Complete, so that change was not saved. Reopen it first.');
  return true;
}
let saveErrToast = 0;
function showSaveState(st, err) {
  const reg = !!S.job?.regEdit;
  if (st === 'saved' && S.job && !reg && !saver.pending()) journal.clear(S.job.id);
  const txt = { idle: '', pending: 'Saving…', saving: 'Saving…', saved: reg ? 'Saved to registry' : 'Saved locally', retrying: 'Not saved — retrying', error: 'Not saved' }[st] ?? '';
  setSaveState(txt);
  if ((st === 'retrying' || st === 'error') && Date.now() - saveErrToast > 8000) {
    saveErrToast = Date.now();
    toast(`Could not save ${reg ? 'the tank' : 'to this device'}: ${saveErrorText(err)}. ${st === 'retrying' ? 'Trying again…' : 'Your changes are kept on screen; the app tries again with your next change.'}`, st === 'error' ? { label: 'Try again', fn: () => saver.flush() } : undefined);
  }
}
/* Unsaved change detection (stage 2): each committed change is counted, with the area it was made in,
   until the job is next saved to a file. */
export const VIEW_AREA = { map: 'Floor', inds: 'Floor', plates: 'Floor', api: 'Floor', shell: 'Shell', roofF: 'Roof', roofL: 'Roof', seal: 'Roof', nozzles: 'Nozzles', settle: 'Settlement', setup: 'Tank setup', equip: 'Equipment', summary: 'Findings and report', defs: 'Findings and report', report: 'Findings and report' };
export function scheduleSave() {
  if (!S.job) return;
  const j = S.job; j.updated = Date.now();
  if (!j.regEdit) {
    j.edits = (j.edits || 0) + 1;
    const area = VIEW_AREA[S.view] || 'Other'; if (!(j.editAreas || []).includes(area)) j.editAreas = [...(j.editAreas || []), area];
  }
  if (!j.regEdit && !journal.put(j) && !journalWarned) { journalWarned = true; toast('Crash protection is paused: the browser refused to store a recovery copy (storage full). Changes are still saved to the device as normal.'); }
  saver.touch();
  ui.fileState();
}
/** Changes not yet in the job file: { n, areas, known } (known = false for jobs from before the count existed). */
export function fileChanges(j) {
  if (!j) return { n: 0, areas: [], known: true };
  // the count decides; jobs from before the count existed fall back to the timestamps
  const n = j.edits || 0, dirty = n > 0 || (j.edits === undefined && !!j.rev && (j.updated || 0) > (j.savedAt || 0));
  if (!dirty) return { n: 0, areas: [], known: true };
  return { n, areas: j.editAreas || [], known: n > 0 };
}
export const changesText = (c) => (c.known ? `${c.n} change${c.n === 1 ? '' : 's'}` : 'changes');
/** Write the open job now even if nothing was marked changed (after setting fields that must not
 *  count as an edit, such as the revision stamp). */
export function writeNow() { if (!S.job) return Promise.resolve(true); saver.touch(); return saver.flush(); }
/** Write now. Resolves true when every change is on the device. */
export async function flushSave() { return saver.flush(); }
/** Before leaving the open job: make sure it is on the device; if it can't be saved, say so and stay. */
export async function leaveJobOk() {
  if (await flushSave()) return true;
  toast(`Your latest changes could not be saved to this device (${saveErrorText(saver.error)}), so the job stays open. Free some space or close other app windows, then try again.`, { label: 'Try again', fn: () => saver.flush() });
  return false;
}
function renderFileState() { if ($('#fileState')) ui.header(); }
function setSaveState(t) { const el = $('#saveState'); if (el) { el.textContent = t; el.dataset.state = t; } }

export function commit() { recompute(); scheduleSave(); }

/** S.jobs holds light job cards (no readings; db.lite). Fetch the full job with db.getJob when needed. */
export async function loadJobs() { S.jobs = (await db.allCards()).sort((a, b) => (b.updated || 0) - (a.updated || 0)); }
export async function loadTanks() { S.tanks = (await db.allTanks()).sort((a, b) => tankKeyOf(a).localeCompare(tankKeyOf(b), undefined, { numeric: true })); }

/* Storage: ask the browser to keep the data (no prompt in Chrome / Edge for an installed app) and warn
   before the device runs out of room, since a failed write can't save new readings or photos. */
export const STORAGE_WARN = 0.8;
let storageWarned = false;
export async function checkStorage() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await requestPersistence();
    const est = await navigator.storage?.estimate?.();
    if (est?.quota && est.usage / est.quota > STORAGE_WARN && !storageWarned) {
      storageWarned = true;
      toast(`Storage on this device is ${Math.round((est.usage / est.quota) * 100)} % full. Save jobs to files and delete finished ones (Jobs page).`, { label: 'Jobs', fn: () => go('jobs') });
    }
  } catch { /* storage API unavailable */ }
}

/** Save now: commit the field being typed in (blur fires its change event), then write to the device.
 *  Runs when the app is hidden or closed, so a reading typed just before switching apps isn't lost. */
export function flushNow() {
  const a = document.activeElement;
  if (a && a !== document.body && a.matches?.('input, textarea, select')) a.blur();
  if (saver.pending()) flushSave();
}

/** Reload into the new version, saving first so nothing typed is lost. */
export async function appReload() { flushNow(); if (saver.pending() && !(await leaveJobOk())) return; location.reload(); }
