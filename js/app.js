// Tank Floor Inspector — main application.
import { db, requestPersistence, dbConfig } from './db.js';
import { pendingSteps } from './migrations.js';
import { createSaver, saveErrorText } from './saver.js';
import { createJournal, recoveryDiff } from './journal.js';
import { checkIntegrity, SAFE_REPAIRS } from './integrity.js';
import { lite } from './db.js';
import { sha256 } from './util.js';
import { u, toMm, inVal, fmt, fmtRate, num, UNITS } from './units.js';
import { buildLayout, stackSections, suggestCount, halfChord, plateAt, toLocal, itemFloor, angleOf, refCornerName, datumName, orientName } from './geometry.js';
import { api653, RESULTS, RESULT_SHORT, czLimitAuto, plateNominal, NZ_CONN, NZ_CONN_SHORT, UT_CLOCK, nozzleUT, nozzleWall, statusText } from './calc.js';
import { renderMapSVG, MapController } from './map.js';
import { ROOF_NOTE, ROOF_TYPES, hasFixed, hasFloating, floatingLayout, plateUT, pointStatus } from './roof.js';
import { download, indicationsCSV, platesCSV, nozzlesCSV, shellCSV, roofCSV, settleCSV, svgForExport, svgToPng, fileBase } from './export.js';
import { legendHTML, buildDefReport } from './report.js';
import { patchList, patchOf } from './patches.js';
import { newJob, migrate, nextNo, uid, setPath, STAGES, STAGE_LABEL, defaultStatus, copyPhotos, SCHEMA, FILE_VERSION, migrationNotes } from './model.js';
import { makeDemo } from './demo.js';
import { defaultShell, defaultZones, autoLocCount, autoPlateCount, utLocations, coursesWithElev, courseAt, coursePlates, shellHeight, courseSummary, readingElevations, zoneCount, getReading, fmtElev, zKey, rolloutSVG, SHELL_SVG_STYLE, SPACING_MM } from './shell.js';
import { buildLoader, readLoader, loaderAreas } from './loader.js';
import { sealEval, activeStds } from './seal.js';
import { MATERIALS, CODES, editionsFor, supplementsFor, jointOptions, jointLabel, PSI_MPA } from './tables.js';
import { designBasis, fillFromT, annularReq, defaultJoint } from './design.js';
import { SECTIONS, SEC, CHILDREN, viewPlace, childView, findings, allDefs, numberDefs, STATUS_TEXT, NDE_METHODS, NDE_RESULTS, CONDITIONS, PRIORITIES, PRIORITY_LABEL, STATUSES, typicalNDE, typicalObs, newObs, newNDE, newRec } from './sections.js';
import { EQ_TYPES, EQ_LABEL, EQ_DETAIL_PH, newEquip, suggestEquip, equipName, equipLine, calState, equipUse, useByMethod } from './equipment.js';
import { SCOPE, SCOPE_HINT, inScope, scopeText, tankFromJob, newTank, jobFromTank, editJobFor, diffFromTank, tankKeyOf, normKey } from './registry.js';
import { newRow, rowsFromGrid, rowsCentreBlock, coverage, newPlate, newMeasuredSection, measuredFromDrawing } from './builder.js';
import { esc as h } from './util.js';
import { $, $$, toast, askConfirm, askChoice } from './ui.js';
import { jobCard, indCount } from './cards.js';
import { S, APP_VERSION, RESULT_OPTS, VT_COND, COATING, UT_METHOD, REPAIR_METHOD, NZ_TYPES, nzPrefix, nextMark, FT_TYPES } from './app/state.js';
import { readInput, field, focusSel } from './app/fields.js';
import { views, childViews, after, configureNav, go, renderAll, renderNav, renderView } from './app/nav.js';
import { onAction, onChange } from './app/actions.js';
import './views/codetables.js';
import './views/report.js';
import { refreshSettle } from './views/settle.js';
import { refreshRoof, rStatus } from './views/roof.js';
import { configureHost } from './app/host.js';


/* ---------------------------------------------------------------- state ---- */

/* The floor layout and the API 653 results are rebuilt only when their inputs change, so typing in the
   shell, roof or settlement pages doesn't recalculate the whole floor. Inputs: buildLayout reads tank,
   layout and plates; api653 also reads calc, indications and the shell courses (critical-zone limit). */
const RC = { job: null, inds: null, lay: null, calc: null };
function recompute() {
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
const saver = createSaver({ write: writeCurrent, onState: showSaveState });
/* Crash recovery (stage 3): a synchronous copy of the open job until its device write commits. */
const journal = createJournal({ aliveMs: globalThis.__tfiAliveMs || 10000 });
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
  await db.putJob(job);
  renderFileState();
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
const VIEW_AREA = { map: 'Floor', inds: 'Floor', plates: 'Floor', api: 'Floor', shell: 'Shell', roofF: 'Roof', roofL: 'Roof', seal: 'Roof', nozzles: 'Nozzles', settle: 'Settlement', setup: 'Tank setup', equip: 'Equipment', summary: 'Findings and report', defs: 'Findings and report', report: 'Findings and report' };
function scheduleSave() {
  if (!S.job) return;
  const j = S.job; j.updated = Date.now();
  if (!j.regEdit) {
    j.edits = (j.edits || 0) + 1;
    const area = VIEW_AREA[S.view] || 'Other'; if (!(j.editAreas || []).includes(area)) j.editAreas = [...(j.editAreas || []), area];
  }
  if (!j.regEdit && !journal.put(j) && !journalWarned) { journalWarned = true; toast('Crash protection is paused: the browser refused to store a recovery copy (storage full). Changes are still saved to the device as normal.'); }
  saver.touch();
  showFileState();
}
/** Changes not yet in the job file: { n, areas, known } (known = false for jobs from before the count existed). */
function fileChanges(j) {
  if (!j) return { n: 0, areas: [], known: true };
  // the count decides; jobs from before the count existed fall back to the timestamps
  const n = j.edits || 0, dirty = n > 0 || (j.edits === undefined && !!j.rev && (j.updated || 0) > (j.savedAt || 0));
  if (!dirty) return { n: 0, areas: [], known: true };
  return { n, areas: j.editAreas || [], known: n > 0 };
}
const changesText = (c) => (c.known ? `${c.n} change${c.n === 1 ? '' : 's'}` : 'changes');
/** Write the open job now even if nothing was marked changed (after setting fields that must not
 *  count as an edit, such as the revision stamp). */
function writeNow() { if (!S.job) return Promise.resolve(true); saver.touch(); return saver.flush(); }
/** Write now. Resolves true when every change is on the device. */
async function flushSave() { return saver.flush(); }
/** Before leaving the open job: make sure it is on the device; if it can't be saved, say so and stay. */
async function leaveJobOk() {
  if (await flushSave()) return true;
  toast(`Your latest changes could not be saved to this device (${saveErrorText(saver.error)}), so the job stays open. Free some space or close other app windows, then try again.`, { label: 'Try again', fn: () => saver.flush() });
  return false;
}
function renderFileState() { if ($('#fileState')) renderHeader(); }
function setSaveState(t) { const el = $('#saveState'); if (el) { el.textContent = t; el.dataset.state = t; } }

function commit() { recompute(); scheduleSave(); }

/** S.jobs holds light job cards (no readings; db.lite). Fetch the full job with db.getJob when needed. */
async function loadJobs() { S.jobs = (await db.allCards()).sort((a, b) => (b.updated || 0) - (a.updated || 0)); }
async function loadTanks() { S.tanks = (await db.allTanks()).sort((a, b) => tankKeyOf(a).localeCompare(tankKeyOf(b), undefined, { numeric: true })); }

/* ---------------------------------------------------------- history (data integrity upgrade) --- */

/** Who is making changes on this device: the inspector name from Settings and a per-install id.
 *  Shaped so a signed-in identity (Microsoft Entra ID) can replace it later. */
async function whoAmI() {
  let id = await db.getMeta('installId').catch(() => null);
  if (!id) { id = 'dev-' + uid(); await db.setMeta('installId', id).catch(() => {}); }
  return { name: S.company?.inspector || '', id, method: 'device' };
}

/** Add an immutable revision of a stored job (the job as given, without photos). */
async function addRevision(job, reason, note = '') {
  const keys = await db.jobPhotoKeys(job.id).catch(() => []);
  return db.addRevision({ jobId: job.id, rev: job.rev || 0, at: Date.now(), by: await whoAmI(), reason, note, appVersion: APP_VERSION, schema: job.schema || 1, hash: await sha256(job), job, photoIds: keys });
}

/** After the history stores are added, give every existing job one baseline revision (once). */
async function baselineRevisions() {
  if (await db.getMeta('baseline:v4')) return;
  for (const c of S.jobs) {
    if (await db.revisionCount(c.id)) continue;
    const j = await db.getJob(c.id); if (!j) continue;
    await addRevision(j, 'migration', 'Baseline at upgrade to the data integrity version');
  }
  await db.setMeta('baseline:v4', Date.now());
}

/** Changes left in the recovery journal by a tab that closed before they reached the device. */
async function recoverAfterCrash() {
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
      restored++;
    }
    if (choice === 'restore' || choice === 'discard') journal.remove(e.job.id); // no answer (dialog dismissed): ask again next time
  }
  if (restored) { await loadJobs(); toast(`Restored the changes to ${restored} job${restored > 1 ? 's' : ''}.`); }
}

/* ---------------------------------------------------------- integrity check (stage 4) --- */

/** Check the device database. full = also open every photo and verify every revision checksum.
 *  quiet = the background check at start-up: only speaks up if something is wrong. Never changes data. */
async function runIntegrity(full = true, quiet = false) {
  S.integrity = { ...(S.integrity || {}), running: true }; renderIntegrity();
  try {
    const [jobs, cards, photos, revisions, tanks, metaKeys] = await Promise.all([db.allJobs(), db.allCards(), db.photoIndex(full), full ? db.allRevisions() : db.revisionHeads(), db.allTanks(), db.metaKeys()]);
    const problems = await checkIntegrity({ jobs, cards, photos, revisions, tanks, metaKeys }, { hash: full ? sha256 : null, lite, yieldEvery: 5 });
    S.integrity = { at: Date.now(), full, problems, counts: { jobs: jobs.length, photos: photos.length, revisions: revisions.length } };
    await db.setMeta('integrity:last', { at: S.integrity.at, full, n: problems.length, errors: problems.filter((p) => p.severity === 'error').length });
    if (quiet && problems.length) toast(`The data check found ${problems.length} problem${problems.length > 1 ? 's' : ''} on this device.`, { label: 'Review', fn: () => { go('jobs'); setTimeout(() => $('#integrityRes')?.scrollIntoView(), 50); } });
  } catch (e) { S.integrity = { at: Date.now(), error: String(e.message || e), problems: [] }; }
  renderIntegrity();
  return S.integrity;
}
function integrityHTML() {
  const I = S.integrity; if (!I || I.running) return I?.running ? '<p class="muted small">Checking…</p>' : '';
  if (I.error) return `<p class="bad small">The check could not run: ${h(I.error)}</p>`;
  if (!I.problems.length) return `<p class="ok small">No problems found (${I.counts.jobs} jobs, ${I.counts.photos} photos, ${I.counts.revisions} revisions${I.full ? ', checksums verified' : ''}).</p>`;
  const safe = I.problems.filter((p) => SAFE_REPAIRS.has(p.repair)).length;
  return `<ul class="integrity-list">${I.problems.map((p, i) => `<li class="${p.severity}"><b>${p.severity === 'error' ? 'Problem' : 'Warning'}:</b> ${h(p.message)}${p.repair === 'delete-photo' ? ` <button class="btn sm ghost danger" data-act="integrity-fix" data-i="${i}">Delete photo…</button>` : p.repair ? ` <button class="btn sm" data-act="integrity-fix" data-i="${i}">Repair</button>` : ''}</li>`).join('')}</ul>
    ${safe ? `<button class="btn sm primary" data-act="integrity-fix-safe">Repair the ${safe} safe problem${safe > 1 ? 's' : ''}</button>` : ''}<p class="muted small">Safe repairs only rebuild the job list or forget file links. Nothing else is changed or deleted without asking.</p>`;
}
function renderIntegrity() {
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

function dbFailed(e) {
  document.querySelector('#main')?.insertAdjacentHTML('afterbegin', `<section class="card"><h2>The device database could not be opened</h2><p>${h(String(e?.message || e))}</p><p class="muted">If the app was being updated, the update was stopped and your data is unchanged. Close other Tank Floor Inspector windows and reload. If this keeps happening, do not clear the browser data — contact support with this message.</p></section>`);
}

async function openJob(id, view = 'map') {
  if (S.job && S.job.id !== id && !(await leaveJobOk())) return;
  const j = await db.getJob(id);
  if (!j) return toast('Job not found');
  const notes = migrationNotes(j), steps = pendingSteps(j).length, log = [];
  let mj;
  try {
    if (steps) await addRevision(j, 'migration', `Before migration from schema ${j.schema || 1} to ${SCHEMA}`);
    mj = migrate(j, { log, appVersion: APP_VERSION });
  } catch (e) {
    // the stored job is untouched (migrate works on a copy); record the failure and don't open it
    await db.logMigrations([{ kind: 'job-error', jobId: id, from: j.schema || 1, to: SCHEMA, at: Date.now(), app: APP_VERSION, error: String(e.message || e) }]).catch(() => {});
    return toast(`This job could not be updated to the current version (${e.message}). It has not been changed; save a backup and report the problem.`);
  }
  if (log.length) db.logMigrations(log).catch(() => {});
  S.job = mj;
  S.photos = await db.jobPhotos(id);
  const fh = await db.getMeta('fh:' + id).catch(() => null);
  S.fileName = fh?.name || null;
  S.sel = S.selPlate = S.selFeature = null; S.mode = 'select'; S.vb = null;
  recompute();
  await db.setMeta('lastJob', id);
  go(S.job.tank.diameter ? view : 'setup');
  if (notes.length) { scheduleSave(); showMigrationNotes(notes); }
}

function showMigrationNotes(notes) { toast('This job was updated from an older version of the app. ' + notes.join(' '), { label: 'OK', fn: () => {} }); }

async function createJob(job) {
  await db.putJob(job);
  checkStorage();
  await loadJobs();
  await openJob(job.id, job.tank.diameter ? 'map' : 'setup');
}

/* ---------------------------------------------------------------- shell ---- */

window.tfi = { go: (v) => go(v), zoom: (x, y, r) => { S.mapCtl?.focus(x, y, r); drawMap(); }, job: () => S.job, commit: () => { commit(); renderView(); } }; // used by the automated tests

/** The job file status in the header: revision, and changes saved on this device but not yet in the file. */
function showFileState() {
  const j = S.job, reg = !!j?.regEdit, fs = $('#fileState');
  if (!fs) return;
  fs.hidden = !j || reg;
    const c = fileChanges(j);
    fs.textContent = j ? (j.rev ? (c.n || !c.known ? `Rev ${j.rev} · ${changesText(c)} not in the file` : revText(j)) : `Not saved to a file${c.n ? ' · ' + changesText(c) : ''}`) : '';
    fs.dataset.state = j && (!j.rev || c.n || !c.known) ? 'dirty' : 'clean';
    fs.title = (j?.rev ? `${revText(j, true)}${S.fileName ? ' to ' + S.fileName : ''}` : 'Save file… keeps a copy in OneDrive and starts the revision count')
      + (c.n || !c.known ? `\nSaved on this device. Not yet in the job file: ${changesText(c)}${c.areas.length ? ' (' + c.areas.join(', ') + ')' : ''} — press Save to put them in the file.` : '');
}

function renderHeader() {
  const j = S.job, reg = !!j?.regEdit;
  if (reg) $('#jobTitle').innerHTML = `<b>${h(j.info.tankId || 'New tank')} <em class="stg st-reg">Registry</em></b><span>${h([j.info.client, j.info.site, 'editing the tank data'].filter(Boolean).join(' · '))}</span>`;
  else $('#jobTitle').innerHTML = j ? `<b>${h(j.info.tankId || 'Untitled tank')}${j.rev ? ` <em class="rev">Rev ${j.rev}</em>` : ''}${j.status?.stage ? ` <em class="stg st-${j.status.stage}">${h(STAGE_LABEL[j.status.stage])}</em>` : ''}</b><span>${h([j.info.client, j.info.site, j.info.inspDate].filter(Boolean).join(' · '))}</span>` : '<span>No job open</span>';
  showFileState();
  $('#exportMenu').hidden = !j || reg;
  $('#saveFileBtn').hidden = !j || reg;
  const rb = $('.top-acts [data-go="report"]'); if (rb) rb.hidden = reg;
  $('#saveFileBtn').title = S.fileName ? `Save to ${S.fileName} (Ctrl+S)` : 'Save this job to a file, e.g. in OneDrive (Ctrl+S)';
  $('#saveFileBtn').textContent = S.fileName ? 'Save' : 'Save file…';
  $('#installBtn').hidden = !S.installEvt;
}

/* ------------------------------------------------------------------ dashboard */
// All tanks on this device and in a linked folder (e.g. the team's OneDrive jobs folder), by stage.

const canDir = () => 'showDirectoryPicker' in window && window.self === window.top;
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Light summary of a job for the dashboard (works on raw stored jobs and on jobs read from files). */

async function dashInit() {
  const D = S.dash;
  if (!D.dir) D.dir = await db.getMeta('dashDir').catch(() => null);
  if (D.dir) { try { D.perm = await D.dir.queryPermission({ mode: 'readwrite' }); } catch { D.perm = 'denied'; } }
  if (D.dir && D.perm === 'granted' && !D.scanned && !D.scanning) await scanFolder();
}

async function scanFolder() {
  const D = S.dash; if (!D.dir) return;
  D.scanning = true; if (S.view === 'dash') renderView();
  const files = new Map();
  // Job files can be tens of MB (photos). Each file's card is cached by path, modified time and size,
  // so a rescan only reads the files that changed since the last one.
  const cache = (await db.getMeta('scanCache').catch(() => null)) || {}, seen = {};
  const walk = async (dir, path, depth) => {
    for await (const [name, hnd] of dir.entries()) {
      if (hnd.kind === 'directory') { if (depth < 2 && !name.startsWith('.')) await walk(hnd, path + name + '/', depth + 1); continue; }
      if (!/\.json$/i.test(name)) continue;
      try {
        const f = await hnd.getFile(), p = path + name, c = cache[p];
        let id, card;
        if (c && c.m === f.lastModified && c.s === f.size) ({ id, card } = c);
        else {
          if (!(await f.slice(0, 80).text()).includes('"tank-floor-inspector"')) { seen[p] = { m: f.lastModified, s: f.size, id: null }; continue; }
          const data = JSON.parse(await f.text());
          if (data.format !== 'tank-floor-inspector' || !data.job?.id) { seen[p] = { m: f.lastModified, s: f.size, id: null }; continue; }
          id = data.job.id; card = jobCard(data.job);
        }
        seen[p] = { m: f.lastModified, s: f.size, id, card };
        if (!id) continue;
        const prev = files.get(id);
        if (!prev || card.updated > prev.card.updated) files.set(id, { name, path: p, fh: hnd, card, modified: f.lastModified });
      } catch { /* not readable — skip */ }
    }
  };
  try { await walk(D.dir, '', 0); D.files = files; D.scanned = true; D.scannedAt = Date.now(); await db.setMeta('scanCache', seen).catch(() => {}); }
  catch (e) { toast('Could not read the folder: ' + e.message); }
  D.scanning = false;
  if (S.view === 'dash') renderView();
}

async function linkFolder() {
  if (!canDir()) { toast('Linking a folder needs the installed app in Chrome or Edge.'); return; }
  try {
    const dir = await window.showDirectoryPicker({ id: 'tank-jobs-folder', mode: 'readwrite', startIn: 'documents' });
    S.dash.dir = dir; S.dash.perm = 'granted'; S.dash.scanned = false; await db.setMeta('dashDir', dir);
    await scanFolder();
  } catch (e) { if (e.name !== 'AbortError') toast('Could not link the folder: ' + e.message); }
}

/** Write a job's stage back into its folder file without changing its revision. */
async function writeStageToFile(id, stage, at = Date.now()) {
  const D = S.dash; let fh = D.files.get(id)?.fh || null;
  if (!fh) { fh = await db.getMeta('fh:' + id).catch(() => null); }
  if (!fh) return false;
  try {
    let perm = await fh.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await fh.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
    if (perm !== 'granted') return false;
    const data = JSON.parse(await (await fh.getFile()).text());
    if (data.format !== 'tank-floor-inspector' || data.job?.id !== id) return false;
    // Change only the stage, and add to the file's own history rather than replacing it.
    const old = data.job.status || {};
    if (old.stage === stage) return true;
    data.job.status = { ...old, stage, history: [...(old.history || []), { stage, at }].slice(-50) };
    const w = await fh.createWritable(); await w.write(JSON.stringify(data)); await w.close();
    const e = D.files.get(id); if (e) e.card = jobCard(data.job);
    return true; // (the scan cache sees the new modified time and re-reads this file next time)
  } catch (e) { console.warn('stage write failed', e); return false; }
}

async function setStage(id, stage) {
  const now = Date.now();
  if (S.job?.id === id) {
    if (S.job.status.stage === stage) return;
    S.job.status.stage = stage; (S.job.status.history = S.job.status.history || []).push({ stage, at: now });
    commit(); await flushSave(); renderHeader();
  } else {
    const j = await db.getJob(id);
    if (j) {
      j.status = { ...defaultStatus(), ...(j.status || jobCard(j)) };
      if (j.status.stage === stage) return;
      j.status.stage = stage; j.status.history = [...(j.status.history || []), { stage, at: now }]; j.updated = now;
      await db.putJob(j);
    }
  }
  const f = S.dash.files.get(id);
  if (f || (await db.getMeta('fh:' + id).catch(() => null))) {
    const ok = await writeStageToFile(id, stage, now);
    if (!ok && f) toast('Stage changed on this device; the folder file could not be updated.');
  }
  await loadJobs(); if (S.view === 'dash') renderView();
  toast(`${(S.jobs.find((j) => j.id === id)?.info?.tankId) || f?.card.tankId || 'Tank'} → ${STAGE_LABEL[stage]}`);
}

async function openFromDash(id) {
  const local = S.jobs.find((j) => j.id === id), f = S.dash.files.get(id);
  if (f && (!local || f.card.updated > (local.updated || 0) + 1000)) {
    const nid = await importJobFile(await f.fh.getFile());
    if (nid) { await rememberFile(nid, f.fh, true); if (S.job?.id === nid) { S.fileName = f.name; renderHeader(); } }
    return;
  }
  if (local) { await openJob(id, 'setup'); if (f) { await rememberFile(id, f.fh, false); S.fileName = f.name; renderHeader(); } }
}

function dashRows() {
  const D = S.dash, rows = new Map();
  for (const j of S.jobs) rows.set(j.id, { ...jobCard(S.job?.id === j.id ? S.job : j), where: 'device' });
  for (const [id, f] of D.files) {
    const r = rows.get(id);
    if (!r) rows.set(id, { ...f.card, where: 'folder', file: f.path });
    else { const newer = f.card.updated > r.updated + 1000; rows.set(id, { ...(newer ? f.card : r), where: 'both', file: f.path, fileNewer: newer, stage: newer ? f.card.stage : r.stage }); }
  }
  let list = [...rows.values()];
  const q = D.q.trim().toLowerCase();
  if (q) list = list.filter((r) => [r.tankId, r.client, r.site, r.reportNo, r.inspector, r.reviewer].join(' ').toLowerCase().includes(q));
  const key = (r) => (r.stage === 'upcoming' ? r.planned || r.inspDate || '9' : r.due || r.inspDate || '9');
  return list.sort((a, b) => key(a).localeCompare(key(b)) || a.tankId.localeCompare(b.tankId, undefined, { numeric: true }));
}

function viewDash() {
  const D = S.dash, rows = dashRows(), today = todayISO();
  const by = Object.fromEntries(STAGES.map(([k]) => [k, rows.filter((r) => r.stage === k)]));
  const fmtD = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const card = (r) => {
    const late = r.due && r.due < today && r.stage !== 'complete';
    const dates = [r.stage === 'upcoming' ? (r.planned ? `Planned ${fmtD(r.planned)}` : '') : r.inspDate ? `Inspected ${fmtD(r.inspDate)}` : '', r.due ? `<span class="${late ? 'bad' : ''}">Due ${fmtD(r.due)}${late ? ' — overdue' : ''}</span>` : ''].filter(Boolean).join(' · ');
    return `<div class="tcard${S.job?.id === r.id ? ' cur' : ''}${late ? ' late' : ''}" draggable="true" data-dash="${r.id}">
      <div class="tc-top"><b>${h(r.tankId)}</b>${r.rev ? `<span class="muted small">Rev ${r.rev}</span>` : ''}</div>
      <div class="small">${h([r.client, r.site].filter(Boolean).join(' · ')) || '<span class="muted">No client / site</span>'}</div>
      ${dates ? `<div class="small">${dates}</div>` : ''}
      ${r.inspector || r.reviewer ? `<div class="small muted">${r.inspector ? 'Insp. ' + h(r.inspector) : ''}${r.reviewer ? ' · Review ' + h(r.reviewer) : ''}</div>` : ''}
      <div class="tc-chips">${r.condition ? `<span class="cchip ${/Not fit|Further/.test(r.condition) ? 'bad' : /repairs/.test(r.condition) ? 'warn' : 'ok'}">${h(r.condition.replace('Fit for continued service', 'Fit for service'))}</span>` : ''}${r.open ? `<span class="cchip ${r.pri ? 'bad' : 'warn'}">${r.open} open deficienc${r.open === 1 ? 'y' : 'ies'}${r.pri ? ` · ${r.pri} P1/P2` : ''}</span>` : ''}
        <span class="cchip loc" title="${h(r.file || '')}">${r.where === 'device' ? 'This device' : r.where === 'folder' ? 'Folder' : 'Device + folder'}</span>${r.fileNewer ? '<span class="cchip warn" title="The folder file was changed more recently than the copy on this device">Folder copy newer</span>' : ''}</div>
      <div class="tc-acts"><select data-stage-of="${r.id}" aria-label="Stage">${STAGES.map(([k, l]) => `<option value="${k}" ${r.stage === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn sm primary" data-act="dash-open" data-id="${r.id}">Open</button></div></div>`;
  };
  const folderBar = !canDir() ? `<span class="muted small">Folder linking works in the installed app (Chrome / Edge). Showing tanks on this device.</span>`
    : !D.dir ? `<button class="btn" data-act="dash-link">Link jobs folder…</button><span class="muted small">Pick the shared folder (e.g. OneDrive) where the job files are saved.</span>`
      : D.perm !== 'granted' ? `<button class="btn primary" data-act="dash-reconnect">Reconnect ${h(D.dir.name)}</button><span class="muted small">The browser asks again each session before the app can read the folder.</span><button class="btn sm ghost" data-act="dash-link">Change folder…</button>`
        : `<span class="small">Folder <b>${h(D.dir.name)}</b> · ${D.scanning ? 'scanning…' : `${D.files.size} job file${D.files.size === 1 ? '' : 's'}`}</span><button class="btn sm" data-act="dash-rescan" ${D.scanning ? 'disabled' : ''}>Rescan</button><button class="btn sm ghost" data-act="dash-link">Change folder…</button>`;
  const tiles = STAGES.map(([k, l]) => `<button class="stile st-${k}${D.stage === k ? ' on' : ''}" data-act="dash-stage" data-k="${k}"><b>${by[k].length}</b><span>${l}</span></button>`).join('');
  const body = D.mode === 'list'
    ? `<section class="card"><div class="tblwrap"><table class="grid dlist"><thead><tr><th>Tank</th><th>Client / site</th><th>Stage</th><th>Planned / inspected</th><th>Due</th><th>Inspector</th><th>Reviewer</th><th>Condition</th><th class="n">Open def.</th><th>Where</th><th></th></tr></thead><tbody>
        ${rows.filter((r) => !D.stage || r.stage === D.stage).map((r) => `<tr class="${r.due && r.due < today && r.stage !== 'complete' ? 'is-bad' : ''}"><td><b>${h(r.tankId)}</b>${r.rev ? `<br><small class="muted">Rev ${r.rev}</small>` : ''}</td><td>${h(r.client)}<br><small class="muted">${h(r.site)}</small></td><td><select data-stage-of="${r.id}">${STAGES.map(([k, l]) => `<option value="${k}" ${r.stage === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td><td>${fmtD(r.stage === 'upcoming' ? r.planned : r.inspDate)}</td><td>${fmtD(r.due)}</td><td>${h(r.inspector)}</td><td>${h(r.reviewer)}</td><td class="small">${h(r.condition)}</td><td class="n">${r.open || '—'}${r.pri ? ` <small class="bad">(${r.pri} P1/P2)</small>` : ''}</td><td class="small">${r.where === 'device' ? 'Device' : r.where === 'folder' ? 'Folder' : 'Both'}${r.fileNewer ? ' <b class="warn-txt">· folder newer</b>' : ''}</td><td><button class="btn sm primary" data-act="dash-open" data-id="${r.id}">Open</button></td></tr>`).join('') || '<tr><td colspan="11" class="empty">No tanks.</td></tr>'}
      </tbody></table></div></section>`
    : `<div class="board">${STAGES.filter(([k]) => !D.stage || D.stage === k).map(([k, l]) => `<div class="bcol st-${k}" data-drop="${k}"><div class="bcol-h"><b>${l}</b><em>${by[k].length}</em></div>${by[k].map(card).join('') || '<p class="muted small bempty">Drag a tank here</p>'}</div>`).join('')}</div>`;
  return `<div class="page wide dash"><div class="page-head"><div><h1>Dashboard</h1><p class="muted">Every tank on this device and in the linked jobs folder, by stage. Drag a card to another column, or use its stage list. Stage changes are written to the job file in the folder so everyone sees them.</p></div>
    <div class="acts"><button class="btn primary" data-act="job-new">New tank</button><button class="btn" data-act="job-open-file">Open job file…</button></div></div>
    <div class="folderbar">${folderBar}</div>
    <div class="stiles">${tiles}</div>
    <div class="dash-tools"><input type="search" id="dashQ" placeholder="Search tank, client, site, inspector…" value="${h(D.q)}"><div class="seg"><button class="btn sm${D.mode === 'board' ? ' on' : ''}" data-act="dash-mode" data-k="board">Board</button><button class="btn sm${D.mode === 'list' ? ' on' : ''}" data-act="dash-mode" data-k="list">List</button></div>${D.stage ? `<button class="btn sm ghost" data-act="dash-stage" data-k="${D.stage}">Show all stages</button>` : ''}</div>
    ${body}</div>`;
}
after.dash = async () => { const before = S.dash.scanned; await dashInit(); if (!before && S.dash.scanned && S.view === 'dash') renderView(); };

document.addEventListener('dragstart', (e) => { const c = e.target.closest?.('[data-dash]'); if (!c) return; e.dataTransfer.setData('text/plain', c.dataset.dash); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
document.addEventListener('dragend', (e) => { e.target.closest?.('[data-dash]')?.classList.remove('dragging'); $$('.bcol.over').forEach((x) => x.classList.remove('over')); });
document.addEventListener('dragover', (e) => { const col = e.target.closest?.('[data-drop]'); if (!col) return; e.preventDefault(); $$('.bcol.over').forEach((x) => x !== col && x.classList.remove('over')); col.classList.add('over'); });
document.addEventListener('drop', (e) => { const col = e.target.closest?.('[data-drop]'); if (!col) return; e.preventDefault(); col.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); if (id) setStage(id, col.dataset.drop); });
document.addEventListener('input', (e) => { if (e.target.id === 'dashQ') { S.dash.q = e.target.value; clearTimeout(S.dash.qt); S.dash.qt = setTimeout(() => { const pos = e.target.selectionStart; renderView(); const n = $('#dashQ'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } } }, 200); } });


/* -------------------------------------------------------------- tank registry */
// Tanks entered once; each inspection starts from a copy of the tank's data.

/** All inspections of a tank: jobs on this device plus job files in the linked folder. */
function tankInspections(tid) {
  const rows = new Map();
  for (const j of S.jobs) if (j.tankRef === tid) rows.set(j.id, { ...jobCard(S.job?.id === j.id ? S.job : j), where: 'device' });
  for (const [id, f] of S.dash.files) if (f.card.tankRef === tid && !rows.has(id)) rows.set(id, { ...f.card, where: 'folder' });
  return [...rows.values()].sort((a, b) => (b.inspDate || b.planned || '').localeCompare(a.inspDate || a.planned || ''));
}
/** Jobs with a tank ID that are not yet linked to the registry. */
const unlinkedJobs = () => S.jobs.filter((j) => !j.tankRef && (j.info?.tankId || '').trim() && !S.tanks.some((t) => t.id === j.tankRef));

function viewReg() {
  const R = S.reg, q = R.q.trim().toLowerCase(), today = todayISO();
  const fmtD = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const list = S.tanks.filter((t) => !q || [t.info?.client, t.info?.site, t.info?.tankId, t.info?.location].join(' ').toLowerCase().includes(q));
  const groups = new Map();
  for (const t of list) {
    const c = t.info?.client || 'No client', st = t.info?.site || 'No site';
    if (!groups.has(c)) groups.set(c, new Map());
    const g = groups.get(c); if (!g.has(st)) g.set(st, []); g.get(st).push(t);
  }
  const roofTxt = (t) => (ROOF_TYPES.find(([k]) => k === t.roof?.type) || [])[1] || '';
  const card = (t) => {
    const ins = tankInspections(t.id), last = ins[0], open = R.open.has(t.id), T = t.tank || {};
    const facts = [t.tank?.diameter ? `Ø ${fmt(T.diameter, 'big', t)}` : 'Diameter not set', T.bottomType, t.layout?.annular ? 'annular ring' : '', t.roof?.type && t.roof.type !== 'none' ? roofTxt(t) : '', (t.shell?.courses || []).length ? `${t.shell.courses.length} courses` : '', (t.nozzles || []).length ? `${t.nozzles.length} nozzles` : '', T.yearBuilt ? `built ${T.yearBuilt}` : ''].filter(Boolean).join(' · ');
    const insRows = ins.map((r) => `<tr><td>${r.inspDate ? fmtD(r.inspDate) : r.planned ? 'Planned ' + fmtD(r.planned) : '—'}</td><td>${h(r.reportNo)}</td><td class="small">${h(r.scope ? scopeText(r.scope) : 'Full')}</td><td><span class="stg st-${r.stage}">${h(STAGE_LABEL[r.stage] || '')}</span>${r.due && r.due < today && r.stage !== 'complete' ? ' <small class="bad">overdue</small>' : ''}</td><td class="small">${h(r.condition)}</td><td class="n">${r.open || '—'}</td><td class="small muted">${r.where === 'folder' ? 'Folder' : 'Device'}</td><td><button class="btn sm" data-act="dash-open" data-id="${r.id}">Open</button></td></tr>`).join('');
    return `<div class="tank-card">
      <div class="tk-head"><div><b class="tk-id">${h(t.info?.tankId || 'Unnamed tank')}</b>${t.info?.location ? ` <span class="muted small">${h(t.info.location)}</span>` : ''}<div class="muted small">${h(facts)}</div></div>
        <div class="acts"><button class="btn sm primary" data-act="reg-insp" data-id="${t.id}">New inspection</button><button class="btn sm" data-act="reg-edit" data-id="${t.id}">Edit tank data</button>
        <details class="menu"><summary class="btn sm ghost icon" title="More">⋯</summary><div class="menu-pop right"><button data-act="reg-dup" data-id="${t.id}">Duplicate tank (same design)</button><button data-act="reg-del" data-id="${t.id}" class="danger-txt">Delete from registry</button></div></details></div></div>
      <button class="tk-ins-toggle" data-act="reg-toggle" data-id="${t.id}">${open ? '▾' : '▸'} ${ins.length ? `${ins.length} inspection${ins.length > 1 ? 's' : ''} · last ${last.inspDate ? fmtD(last.inspDate) : last.planned ? 'planned ' + fmtD(last.planned) : 'not dated'} · <span class="stg st-${last.stage}">${h(STAGE_LABEL[last.stage] || '')}</span>` : 'No inspections yet'}</button>
      ${open && ins.length ? `<div class="tblwrap"><table class="grid small"><thead><tr><th>Date</th><th>Report</th><th>Scope</th><th>Stage</th><th>Condition</th><th class="n">Open def.</th><th>Where</th><th></th></tr></thead><tbody>${insRows}</tbody></table></div>` : ''}
    </div>`;
  };
  const body = [...groups].map(([c, sites]) => `<section class="reg-client"><h2>${h(c)}</h2>${[...sites].map(([st, ts]) => `<div class="reg-site"><h3>${h(st)} <em>${ts.length}</em></h3>${ts.map(card).join('')}</div>`).join('')}</section>`).join('');
  const un = unlinkedJobs();
  return `<div class="page wide reg"><div class="page-head"><div><h1>Tank registry</h1><p class="muted">Each tank's static data — identity, construction, floor layout, nozzles, shell courses, roof and settlement set-up — entered once. <b>New inspection</b> copies it into a new job with the scope you choose; the job keeps its own copy, so reports always show the tank as inspected.</p></div>
      <div class="acts"><button class="btn primary" data-act="reg-new">Add tank</button></div></div>
    ${un.length ? `<div class="callout info reg-mig"><span><b>${un.length} job${un.length > 1 ? 's' : ''}</b> on this device ${un.length > 1 ? 'are' : 'is'} not in the registry yet. Build tank records from them — jobs for the same client, site and tank ID are grouped under one tank, using the most recent job's data.</span><button class="btn sm primary" data-act="reg-build">Build registry from jobs</button></div>` : ''}
    <div class="dash-tools"><input type="search" id="regQ" placeholder="Search client, site, tank…" value="${h(R.q)}"><span class="muted small">${S.tanks.length} tank${S.tanks.length === 1 ? '' : 's'}</span></div>
    ${body || `<div class="card empty">${S.tanks.length ? 'No tanks match the search.' : 'No tanks in the registry yet. <b>Add tank</b> to enter one, or build the registry from your existing jobs.'}</div>`}
  </div>`;
}
document.addEventListener('input', (e) => { if (e.target.id === 'regQ') { S.reg.q = e.target.value; clearTimeout(S.reg.qt); S.reg.qt = setTimeout(() => { const pos = e.target.selectionStart; renderView(); const n = $('#regQ'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } } }, 200); } });
after.reg = async () => { const before = S.dash.scanned; await dashInit(); if (!before && S.dash.scanned && S.view === 'reg') renderView(); };

async function openTankEdit(tid, view = 'setup') {
  if (S.job && !(await leaveJobOk())) return;
  const t = await db.getTank(tid); if (!t) return toast('Tank not found');
  S.job = editJobFor(t); S.job.info.location = t.info?.location || ''; S.job.info.tankNotes = t.info?.notes || '';
  S.photos = []; S.fileName = null; S.sel = S.selPlate = S.selFeature = null; S.mode = 'select'; S.vb = null;
  recompute(); go(view);
}

async function addTank(fromJob = null) {
  const t = fromJob ? tankFromJob(fromJob) : newTank(S.jobs[0]?.units || 'imperial');
  await db.putTank(t); await loadTanks();
  return t;
}

/** Link every unlinked job to a tank record (one per client + site + tank ID). */
async function buildRegistry() {
  const un = unlinkedJobs(); if (!un.length) return;
  const byKey = new Map();
  for (const j of un) { const k = normKey(j.info.client, j.info.site, j.info.tankId); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(j); }
  let made = 0, linked = 0;
  for (const [k, js] of byKey) {
    let t = S.tanks.find((x) => tankKeyOf(x) === k);
    if (!t) {
      const latest = js.slice().sort((a, b) => (b.info.inspDate || '').localeCompare(a.info.inspDate || '') || (b.updated || 0) - (a.updated || 0))[0];
      t = tankFromJob(migrate(await db.getJob(latest.id))); await db.putTank(t); S.tanks.push(t); made++;
    }
    for (const j of js) { const full = await db.getJob(j.id); full.tankRef = t.id; await db.putJob(full); if (S.job?.id === j.id) S.job.tankRef = t.id; linked++; }
  }
  await loadJobs(); await loadTanks(); renderView();
  toast(`${made} tank${made === 1 ? '' : 's'} added, ${linked} job${linked === 1 ? '' : 's'} linked.`);
}

/** Dialog: start an inspection of a registry tank. */
async function newInspectionDlg(tid) {
  const t = await db.getTank(tid); if (!t) return;
  const ins = tankInspections(tid).filter((r) => r.where === 'device');
  const lastCard = ins.find((r) => r.inspDate) || ins[0];
  const last = lastCard ? migrate(await db.getJob(lastCard.id)) : null;
  const sug = new Set(last?.scope || ['floor', 'nozzles', 'found', ...(t.shell?.courses?.length ? ['shell'] : []), ...(hasFixed(t) ? ['froof'] : []), ...(hasFloating(t) ? ['flroof'] : [])]);
  const lastTxt = last ? `${last.info.inspDate || 'undated'}${last.info.reportNo ? ', ' + last.info.reportNo : ''}` : '';
  const dlg = $('#dlg');
  $('#dlgBody').innerHTML = `<form class="ni-dlg" method="dialog">
    <div class="ed-head"><h2>New inspection — ${h(t.info?.tankId || 'tank')}</h2><button aria-label="Close" type="button" class="btn sm ghost" data-ni="close">✕</button></div>
    <p class="muted small">${h([t.info?.client, t.info?.site].filter(Boolean).join(' · '))}</p>
    <h3>Scope</h3><div class="ni-scope">${SCOPE.map(([k, l]) => `<label class="chk"><input type="checkbox" name="scope" value="${k}" ${sug.has(k) ? 'checked' : ''}><span><b>${l}</b><small class="muted"> ${SCOPE_HINT[k] || ''}</small></span></label>`).join('')}</div>
    <h3>Floor layout</h3><div class="ni-floor">
      <label class="chk"><input type="radio" name="floor" value="last" ${last ? 'checked' : 'disabled'}><span><b>As found at the last inspection</b><small class="muted"> ${last ? `${h(lastTxt)} — includes plate corrections and patches recorded then` : 'no earlier inspection on this device'}</small></span></label>
      <label class="chk"><input type="radio" name="floor" value="registry" ${last ? '' : 'checked'}><span><b>Registry layout</b><small class="muted"> the floor as stored for this tank</small></span></label>
      <label class="chk"><input type="radio" name="floor" value="new"><span><b>New floor — start a blank layout</b><small class="muted"> the floor has been replaced; keeps the tank, shell and nozzles</small></span></label>
    </div>
    <h3>Job</h3><div class="fgrid">
      <label class="fld"><span class="lbl">Planned inspection date</span><span class="ctl"><input type="date" name="planned"></span></label>
      <label class="fld"><span class="lbl">Report due</span><span class="ctl"><input type="date" name="due"></span></label>
      <label class="fld"><span class="lbl">Report no.</span><span class="ctl"><input name="reportNo" autocomplete="off"></span></label>
      <label class="fld"><span class="lbl">Work order</span><span class="ctl"><input name="workOrder" autocomplete="off"></span></label>
      <label class="fld"><span class="lbl">API 653 inspector</span><span class="ctl"><input name="inspector" value="${h(last?.info?.inspector || '')}" autocomplete="off"></span></label>
      <label class="fld"><span class="lbl">Product</span><span class="ctl"><input name="product" value="${h(last?.info?.product || '')}" autocomplete="off"></span></label>
    </div>
    ${last ? `<label class="chk"><input type="checkbox" name="equip" checked><span>Copy MFL / UT equipment from the last inspection (check serials and calibration dates)</span></label>` : ''}
    <p class="ni-err bad small" hidden></p>
    <div class="acts end"><button type="button" class="btn" data-ni="close">Cancel</button><button type="button" class="btn primary" data-ni="go">Create inspection</button></div>
  </form>`;
  const form = $('.ni-dlg', dlg);
  form.onclick = async (e) => {
    const b = e.target.closest('[data-ni]'); if (!b) return;
    if (b.dataset.ni === 'close') { dlg.close(); return; }
    const fd = new FormData(form), scope = fd.getAll('scope');
    if (!scope.length) { const er = $('.ni-err', form); er.textContent = 'Pick at least one item for the scope.'; er.hidden = false; return; }
    const j = jobFromTank(t, { scope, floorSrc: fd.get('floor') || 'registry', last, copyEquip: fd.get('equip') === 'on', info: { reportNo: fd.get('reportNo') || '', workOrder: fd.get('workOrder') || '', inspector: fd.get('inspector') || '', product: fd.get('product') || '' } });
    j.status.planned = fd.get('planned') || ''; j.status.due = fd.get('due') || '';
    if (j.status.planned) j.info.inspDate = j.status.planned;
    dlg.close();
    await createJob(j);
    toast(`Inspection created for ${t.info?.tankId || 'the tank'} — ${scopeText(scope)}`);
  };
  dlg.showModal();
}

/** Push a job's static data (layout, nozzles, courses…) back to its registry tank. */
async function updateRegistryFromJob() {
  const j = S.job; if (!j?.tankRef) return;
  const prev = await db.getTank(j.tankRef);
  if (!prev) { if (!(await askConfirm('The registry tank for this job is not on this device. Add this tank to the registry from this job?', { ok: 'Add to registry' }))) return; }
  const diff = prev ? diffFromTank(j, prev) : [];
  if (prev && !diff.length) { toast('The registry already matches this inspection.'); return; }
  if (prev && !(await askConfirm(`Update the registry record for ${prev.info?.tankId || 'this tank'} with this inspection's data?\n\nChanges: ${diff.join(', ')}.\n\nEarlier inspections keep their own copies.`, { ok: 'Update registry' }))) return;
  const t = tankFromJob(j, prev || { id: j.tankRef }); await db.putTank(t); await loadTanks(); renderView(); toast('Registry updated.');
}

/* ------------------------------------------------------------- jobs view --- */

function viewJobs() {
  // the open job's card may lag behind its latest change: show the open job's own values
  const rows = S.jobs.map((c) => (S.job?.id === c.id ? { ...c, rev: S.job.rev, savedAt: S.job.savedAt, updated: S.job.updated, edits: S.job.edits, editAreas: S.job.editAreas } : c)).map((j) => `<tr class="${S.job?.id === j.id ? 'cur' : ''}">
    <td><b>${h(j.info?.tankId || 'Untitled')}</b><br><small>${h(j.info?.reportNo || '')}</small></td>
    <td>${h(j.info?.client)}<br><small>${h(j.info?.site)}</small></td>
    <td>${h(j.info?.inspDate)}</td><td class="n">${indCount(j)}</td>
    <td>${j.rev ? `<b>Rev ${j.rev}</b><br><small>saved ${new Date(j.savedAt).toLocaleString()}</small>${(() => { const c = fileChanges(j); return c.n || !c.known ? `<br><small class="warn-txt" title="${h(c.areas.join(', '))}">${changesText(c)} not in the file</small>` : ''; })()}` : (fileChanges(j).n ? `<small class="warn-txt">not saved to a file · ${changesText(fileChanges(j))}</small>` : '<small class="muted">not saved to a file</small>')}</td>
    <td><small>${new Date(j.updated || j.created).toLocaleString()}</small></td>
    <td class="acts"><button class="btn sm primary" data-act="job-open" data-id="${j.id}">Open</button>
      <button class="btn sm" data-act="job-dup" data-id="${j.id}">Duplicate</button>
      <button class="btn sm" data-act="job-save" data-id="${j.id}">Save file</button>
      <button class="btn sm danger ghost" data-act="job-del" data-id="${j.id}">Delete</button></td></tr>`).join('');
  const c = S.company;
  return `<div class="page">
    <div class="page-head"><div><h1>Inspection jobs</h1><p class="muted">Each job is one tank floor. Jobs are kept in this browser and work offline. Use <b>Save file</b> to put a job in OneDrive (or any shared folder), and <b>Open job file</b> to load it on another computer.</p></div>
      <div class="acts"><button class="btn primary" data-act="job-new">New job</button><button class="btn" data-act="job-demo">Load demo tank</button>
      <button class="btn" data-act="job-open-file">Open job file…</button>
      <input type="file" id="openFileInput" accept=".json,application/json" data-act="job-import" hidden></div></div>
    <div class="card"><table class="grid jobs"><thead><tr><th>Tank</th><th>Client / site</th><th>Date</th><th>Ind.</th><th>Revision</th><th>Last changed</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty">No jobs yet. Start a new job or load the demo tank.</td></tr>'}</tbody></table></div>
    <div class="grid2">
      <section class="card"><h2>Report header</h2><p class="muted">Shown on every report from this device.</p>
        <label class="fld"><span class="lbl">Company name</span><span class="ctl"><input data-cb="name" value="${h(c.name)}"></span></label>
        <label class="fld"><span class="lbl">Details (address, phone, certification)</span><span class="ctl"><textarea data-cb="details" rows="3">${h(c.details)}</textarea></span></label>
        <label class="fld"><span class="lbl">Report footer note</span><span class="ctl"><input data-cb="footer" value="${h(c.footer)}"></span></label>
        <div class="logo-row">${c.logo ? `<img src="${c.logo}" alt="logo">` : '<span class="muted">No logo</span>'}
          <label class="btn sm">Choose logo<input type="file" accept="image/*" data-act="logo" hidden></label>${c.logo ? '<button class="btn sm ghost" data-act="logo-clear">Remove</button>' : ''}</div>
      </section>
      <section class="card"><h2>This device</h2>
        <label class="fld"><span class="lbl">Inspector name on this device</span><span class="ctl"><input data-cb="inspector" value="${h(c.inspector || '')}" placeholder="Recorded with each saved revision and change"></span></label>
        <p id="storageInfo" class="muted">Checking storage…</p>
        <p class="muted small" id="migInfo"></p>
        <div class="integrity"><div class="acts"><button class="btn sm" data-act="integrity-run">Check data on this device</button><span class="muted small" id="integrityLast"></span></div><div id="integrityRes">${integrityHTML()}</div></div>
        <p class="muted">Install the app from the browser's address bar (or the Install button above) so it opens full-window and works without a connection.</p>
        <button class="btn sm" data-act="persist">Ask browser to keep data permanently</button>
      </section>
    </div></div>`;
}
after.jobs = async () => {
  if (!S.integrity) { const last = await db.getMeta('integrity:last').catch(() => null); const l = $('#integrityLast'); if (l && last) l.textContent = `Last checked ${new Date(last.at).toLocaleString()}: ${last.n ? last.n + ' problem' + (last.n > 1 ? 's' : '') : 'no problems'}`; } else renderIntegrity();
  try {
    const log = await db.migrationLog(), mi = $('#migInfo');
    if (mi) { const last = log.filter((x) => x.kind === 'db').at(-1), errs = log.filter((x) => x.kind === 'job-error'); mi.textContent = `Database version ${last?.to ?? '—'}${last ? ` (upgraded ${new Date(last.at).toLocaleDateString()})` : ''} · ${log.filter((x) => x.kind === 'job').length} job updates logged${errs.length ? ` · ${errs.length} job update${errs.length > 1 ? 's' : ''} failed` : ''}.`; }
  } catch { /* history not available */ }
  const el = $('#storageInfo');
  try {
    const est = await navigator.storage?.estimate?.();
    const pers = await navigator.storage?.persisted?.();
    const full = est?.quota ? est.usage / est.quota : 0;
    if (el && est) {
      el.textContent = `Using ${(est.usage / 1048576).toFixed(1)} MB of ${(est.quota / 1048576 / 1024).toFixed(1)} GB available (${Math.round(full * 100)} %). Storage is ${pers ? 'persistent' : 'best-effort (browser may clear it if disk is low)'}.`
        + (full > STORAGE_WARN ? ' Nearly full: save jobs to files and delete finished ones from this device.' : '');
      el.classList.toggle('warn-txt', full > STORAGE_WARN);
    }
  } catch { if (el) el.textContent = ''; }
};

/* Storage: ask the browser to keep the data (no prompt in Chrome / Edge for an installed app) and warn
   before the device runs out of room, since a failed write can't save new readings or photos. */
const STORAGE_WARN = 0.8;
let storageWarned = false;
async function checkStorage() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await requestPersistence();
    const est = await navigator.storage?.estimate?.();
    if (est?.quota && est.usage / est.quota > STORAGE_WARN && !storageWarned) {
      storageWarned = true;
      toast(`Storage on this device is ${Math.round((est.usage / est.quota) * 100)} % full. Save jobs to files and delete finished ones (Jobs page).`, { label: 'Jobs', fn: () => go('jobs') });
    }
  } catch { /* storage API unavailable */ }
}

/* ------------------------------------------------------------ setup view --- */

function viewSetup() {
  const j = S.job, L = j.layout, hasInd = j.indications.length > 0, reg = !!j.regEdit;
  const regT = j.tankRef ? S.tanks.find((t) => t.id === j.tankRef) : null, diff = regT ? diffFromTank(j, regT) : [];
  const scopeCard = reg ? '' : `<section class="card scope-card"><h2>Scope &amp; registry</h2>
      <div class="scope-chips">${SCOPE.map(([k, l]) => `<label class="chk chip-chk"><input type="checkbox" data-act="scope-tog" data-k="${k}" ${inScope(j, k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <p class="muted small">Items not in scope are hidden from the menu and left out of the report.</p>
      ${regT ? `<div class="reg-link"><span>From the registry: <b>${h(regT.info?.tankId || 'tank')}</b>${diff.length ? ` · <span class="warn-txt">differs from the registry: ${h(diff.join(', '))}</span>` : ' · <span class="muted">matches the registry</span>'}</span>
          <span class="acts">${diff.length ? '<button class="btn sm" data-act="reg-update">Update registry from this inspection</button>' : ''}<button class="btn sm ghost" data-act="reg-edit" data-id="${regT.id}">Open registry tank</button></span></div>`
        : j.tankRef ? `<div class="reg-link"><span class="muted">Linked to a registry tank that is not on this device.</span><span class="acts"><button class="btn sm" data-act="reg-update">Add to registry from this job</button></span></div>`
        : `<div class="reg-link"><span class="muted">Not in the tank registry.</span><span class="acts"><button class="btn sm" data-act="reg-from-job">Add this tank to the registry</button></span></div>`}
    </section>`;
  const idCard = `<section class="card"><h2>Tank identity</h2><div class="fgrid">
        ${field('Client', 'info.client')}${field('Facility / site', 'info.site')}
        ${field('Tank ID', 'info.tankId')}${field('Location / area', 'info.location', 'text', { ph: 'e.g. north tank farm, unit 3' })}
        ${field('0° reference label', 'info.zeroRef', 'text', { ph: 'e.g. N, manway, inlet' })}<div></div>
        ${field('Notes about this tank', 'info.tankNotes', 'area', { rows: 2, cls: 'span2' })}
      </div></section>`;
  return `<div class="page">
  <div class="page-head"><div><h1>${reg ? 'Registry — tank data' : 'Tank setup'}</h1><p class="muted">${reg ? 'The tank as stored in the registry: construction, floor layout, nozzles (Floor map / Nozzles), shell courses, roof and settlement set-up. New inspections start from this. Changes save automatically.' : 'Tank details, plate layout and equipment. The floor map updates as you type.'}</p></div>
    <div class="acts">${reg ? '<button class="btn" data-act="reg-done">Done</button>' : ''}<button class="btn primary" data-go="map">Go to floor map →</button></div></div>
  <div class="setup-grid">
    <div class="setup-forms">
      ${scopeCard}${reg ? idCard : `<section class="card"><h2>Inspection</h2><div class="fgrid">
        ${field('Client', 'info.client')}${field('Facility / site', 'info.site')}
        ${field('Tank ID', 'info.tankId')}${field('Product', 'info.product')}
        ${field('Report no.', 'info.reportNo')}${field('Work order', 'info.workOrder')}
        ${field('Inspection date', 'info.inspDate', 'date')}${field('0° reference label', 'info.zeroRef', 'text', { ph: 'e.g. N, manway, inlet' })}
        ${field('MFL operator', 'info.mflTech')}${field('UT technician', 'info.utTech')}
        ${field('API 653 inspector', 'info.inspector')}${field('Date of UT readings', 'info.utDate', 'text', { ph: 'from the UT loader sheet' })}
        ${field('Job stage', 'status.stage', 'sel', { options: STAGES })}${field('Peer reviewer', 'status.reviewer')}
        ${field('Planned inspection date', 'status.planned', 'date')}${field('Report due', 'status.due', 'date')}
      </div></section>`}

      <section class="card"><h2>Tank</h2><div class="fgrid">
        ${field('Units', 'units', 'sel', { options: Object.entries(UNITS).map(([k, v]) => [k, v.label]) })}
        ${field('Diameter', 'tank.diameter', 'big')}
        ${field('Bottom plate nominal t', 'tank.tBottom', 't')}
        ${field('Annular plate nominal t', 'tank.tAnnular', 't', { ph: 'same as bottom' })}
        ${field('Bottom construction', 'tank.bottomType', 'sel', { options: ['Lap welded', 'Butt welded', 'Lap welded with annular ring', 'Other'] })}
        ${field('Product-side coating', 'tank.coating', 'sel', { options: ['None', 'Thin film', 'Thick film (reinforced > 0.05 in)', 'Unknown'] })}
        ${field('Year built', 'tank.yearBuilt')}${field('Last internal inspection', 'tank.lastInternal')}
        ${field('Cathodic protection', 'tank.cp', 'bool')}${field('Leak detection / release prevention barrier', 'tank.rpb', 'bool')}
      </div></section>

      <section class="card"><h2>Construction &amp; design</h2><div class="fgrid">
        ${field('Construction code', 'tank.code', 'sel', { options: CODES })}
        ${field('Code edition', 'tank.edition', 'sel', { options: ['', ...editionsFor(S.job.tank.code || 'Unknown')].map((x) => [x, x || '—']) })}
        ${field('Supplement / revision / addendum', 'tank.supp', 'sel', { options: ['', ...supplementsFor(S.job.tank.edition)].map((x) => [x, x || '—']) })}
        ${reg ? '' : `${field('Product specific gravity G', 'tank.sg', 'num', { ph: 'e.g. 0.85', hint: 'Needed for the shell t-min calculation (highest SG stored)' })}
        ${field(`Max. operating temperature (${S.job.units === 'metric' ? '°C' : '°F'})`, 'tank.opTemp', 'num', { hint: 'Patch plates are not permitted in the critical zone over 200 °F / 93 °C' })}
        ${field('Maximum fill height', 'tank.fillH', 'big', { ph: shellHeight(S.job) ? fmt(shellHeight(S.job), 'big', S.job, false) + ' (shell height)' : '' })}`}
        <p class="muted small span2">The code and edition set the joint efficiencies offered for the shell courses (API 653 Table 4.2: ${h(jointOptions(S.job.tank.code, S.job.tank.edition).group)}). Materials, stresses and Young's modulus come from the reference tables (<button class="linkbtn" data-go="ref">Code tables</button>).</p>
      </div></section>

      <section class="card"><h2>Plate layout</h2>
        ${hasInd ? '<p class="callout warn">This job has indications. They are stored as plate + X/Y, so changing the layout or numbering moves them on the map. Check them afterwards.</p>' : ''}
        <div class="fgrid">
        ${field('Layout method', 'layout.mode', 'sel', { cls: 'span2', options: [['grid', 'Automatic grid — standard plates in staggered rows'], ['custom', 'Row by row — enter the number of plates in each row (centre blocks, sketch plates)'], ['measured', 'Plate by plate — enter each plate’s measured length and width']] })}
        ${field('Standard plate width (row spacing)', 'layout.plateW', 'big')}${field('Standard plate length', 'layout.plateL', 'big')}
        ${field('Rows run', 'layout.orient', 'sel', { options: [['h', 'Left – right (horizontal plates)'], ['v', 'Top – bottom (vertical plates)']] })}
        ${L.mode !== 'grid' ? '<div></div>' : `${field('Row stagger', 'layout.stagger', 'sel', { options: [['0', 'None (aligned)'], ['0.5', '½ plate'], ['0.3333333333', '⅓ plate'], ['0.25', '¼ plate']], attrs: 'data-num="1"' })}
        ${field('Centre a row on the tank centreline', 'layout.centerRow', 'bool')}`}
        ${field('Annular ring', 'layout.annular', 'bool')}
        ${L.annular ? `${field('Annular width inside shell', 'layout.annW', 'small')}${field('Annular segments', 'layout.annN', 'num')}
          ${field('First segment starts at', 'layout.annStart', 'num', { unit: '°' })}${field('Annular label prefix', 'layout.annPrefix')}` : ''}
        ${field('Plate numbering', 'layout.scheme', 'sel', { options: [['letters', 'Row letter + plate number (A1, A2…)'], ['sequential', 'Sequential (1, 2, 3…)']] })}
        ${L.scheme === 'sequential' ? field('Number prefix', 'layout.seqPrefix') : field('Separator', 'layout.sep', 'text', { ph: 'none, or e.g. -' })}
        ${field('Reverse row order', 'layout.revRows', 'bool')}${field('Reverse plate order in rows', 'layout.revPlates', 'bool')}
        ${field('Default datum corner for X/Y', 'layout.refCorner', 'sel', { options: [['BL', 'Bottom-left'], ['TL', 'Top-left'], ['BR', 'Bottom-right'], ['TR', 'Top-right']] })}
        ${field('Ignore slivers smaller than', 'layout.minAreaPct', 'num', { unit: '% of plate' })}
        </div>
        <p class="muted small">${L.mode !== 'grid' ? 'Edit the rows in the Floor builder below. Blank sizes use the standard plate size. ' : ''}Rows are lettered from the ${L.orient === 'v' ? 'left' : 'top'} of the drawing. X is horizontal and Y is vertical on the drawing, from each plate's datum — by default its ${refCornerName(L.refCorner)} corner. Set a different corner, or a plate's measured length, width and orientation, by clicking the plate on the Floor map or on the Plates page.</p>
      </section>

      ${L.mode !== 'grid' ? `<section class="card" id="builderCard">${L.mode === 'measured' ? measuredHTML() : builderHTML()}</section>` : ''}

      <section class="card" id="shellBuild">${shellBuildHTML()}</section>
      <section class="card" id="nozzleCard" data-design="1">${nozzleTableHTML(true)}</section>

      ${reg ? '' : `<section class="card eq-moved"><div class="sp-head"><h2>Equipment</h2><button class="btn sm" data-go="equip">Equipment list →</button></div><p class="muted small">${(S.job.equipment || []).length ? `${S.job.equipment.length} item${S.job.equipment.length === 1 ? '' : 's'} listed: ${h(S.job.equipment.slice(0, 4).map(equipName).join(', '))}${S.job.equipment.length > 4 ? '…' : ''}.` : 'No equipment listed yet.'} Equipment now has its own page; pick the items used under each section's NDE methods.</p></section>
      <section class="card"><h2>Notes</h2>${field('General notes for the report', 'info.notes', 'area', { rows: 4 })}</section>`}
    </div>
    <aside class="setup-preview card"><div class="sp-head"><h2>Layout preview</h2><span id="spStats" class="muted small"></span></div><div id="spMap" class="sp-map"></div>
      <p class="muted small sp-key"><i class="k-seam"></i> bottom-course shell seams · nozzles outside the shell</p></aside>
  </div></div>`;
}
after.setup = () => refreshSetupPreview();

/* ---------------------------------------------------------- floor builder */

function builderHTML() {
  const L = S.job.layout, rows = L.rows || [], B = u(S.job).big;
  const { list } = stackSections(L);
  const pos = new Map(list.map((x) => [x.sec.id, x]));
  const Ri = S.layout.Ri;
  const cov = coverage(S.job);
  const gapMsg = (g, where) => (g > 25 ? `${fmt(g, 'big', S.job)} of floor not covered at the ${where} — add a row or shift the rows` : '');
  const msgs = [gapMsg(cov.gapTop, L.orient === 'v' ? 'left' : 'top'), gapMsg(cov.gapBottom, L.orient === 'v' ? 'right' : 'bottom')].filter(Boolean);
  const f = (r, k, kind, ph = '', extra = '') => `<input data-rowf="${k}" data-row="${r.id}" data-kind="${kind}" ${kind === 'num' ? 'inputmode="numeric"' : 'inputmode="decimal"'} value="${h(kind === 'num' ? r[k] ?? '' : inVal(r[k], kind, S.job))}" placeholder="${h(ph)}" ${extra}>`;
  let letter = 0;
  const body = rows.map((r, i) => {
    const pp = pos.get(r.id), lab = rowLetter(letter++);
    const sug = pp && r.type === 'row' ? suggestCount(Ri, pp.va, pp.vb, +r.len || L.plateL) : null;
    const plates = S.layout.plates.filter((p) => p.rowId === r.id).length;
    return `<tr class="bt-${r.type}">
      <td><b>${lab}</b></td>
      <td>${r.type === 'block' ? '<span class="chip blk">Block</span>' : '<span class="chip rw">Row</span>'}</td>
      <td>${f(r, 'h', 'big', '', 'title="' + (r.type === 'block' ? 'Plate length (block depth)' : 'Row width (plate width)') + '"')}</td>
      <td><div class="cnt"><button aria-label="One plate fewer" class="btn sm icon" data-act="row-n" data-row="${r.id}" data-d="-1" title="One plate fewer">−</button>${f(r, 'n', 'num')}<button aria-label="One plate more" class="btn sm icon" data-act="row-n" data-row="${r.id}" data-d="1" title="One plate more">+</button>${sug && sug !== +r.n ? `<button class="sug" data-act="row-sug" data-row="${r.id}" data-v="${sug}" title="Fits the chord with full plates in the middle">fits ${sug}</button>` : ''}</div></td>
      <td>${r.type === 'block' ? f(r, 'w', 'big', inVal(L.plateW, 'big', S.job), 'title="Plate width"') : f(r, 'len', 'big', inVal(L.plateL, 'big', S.job), 'title="Full plate length"')}</td>
      <td>${f(r, 'off', 'big', '0', 'title="Shift plates along the row (stagger)"')}</td>
      <td>${r.type === 'block' ? `${f(r, 'sideH', 'big', inVal(L.plateW, 'big', S.job), 'title="Side sketch-plate row width" class="sm"')} × ${f(r, 'sideN', 'num', '1', 'title="Plates per side row" class="xs"')}` : '<span class="muted small">—</span>'}</td>
      <td class="n muted">${plates}</td>
      <td class="rowacts">
        <button aria-label="Move up" class="btn sm icon ghost" data-act="row-move" data-row="${r.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
        <button aria-label="Move down" class="btn sm icon ghost" data-act="row-move" data-row="${r.id}" data-d="1" ${i === rows.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
        <button aria-label="Insert a row above" class="btn sm icon ghost" data-act="row-add" data-at="${i}" data-type="row" title="Insert a row above">⊕</button>
        <button aria-label="Delete" class="btn sm icon ghost danger" data-act="row-del" data-row="${r.id}" title="Delete">✕</button></td></tr>`;
  }).join('');
  return `<div class="sp-head"><h2>Floor builder</h2><span class="muted small">${S.layout.plates.filter((p) => p.kind === 'floor').length} bottom plates</span></div>
    <p class="muted small">Sections run ${L.orient === 'v' ? 'left to right' : 'top to bottom'}. A <b>row</b> is a strip of ${L.orient === 'v' ? 'vertical' : 'horizontal'} plates: give the number of plates and the middle ones are full length, with sketch plates at each end cut to the shell. A <b>block</b> is a set of full-length plates laid across the rows (e.g. vertical plates in the centre); the gaps to the shell beside it are filled with sketch-plate rows.</p>
    <div class="acts builder-tpl"><span class="muted small">Start from:</span>
      <button class="btn sm" data-act="rows-template" data-t="grid">Standard rows</button>
      <button class="btn sm" data-act="rows-template" data-t="block">Centre block + sketch plates</button></div>
    <div class="tblwrap"><table class="grid builder"><thead><tr><th></th><th>Type</th><th title="Row: plate width. Block: plate length.">Width (${B})</th><th>Plates</th><th title="Row: full plate length. Block: plate width.">Length (${B})</th><th title="Shift plates along the row">Offset</th><th title="Block only: side sketch-plate row width × plates per row">Sides</th><th class="n">Drawn</th><th></th></tr></thead>
    <tbody>${body || '<tr><td colspan="9" class="empty">No rows yet. Pick a starting layout or add a row.</td></tr>'}</tbody></table></div>
    <div class="acts"><button class="btn sm" data-act="row-add" data-at="${rows.length}" data-type="row">+ Row</button><button class="btn sm" data-act="row-add" data-at="${rows.length}" data-type="block">+ Block</button>
      <span class="spacer"></span>${field('Shift all rows', 'layout.stackOff', 'big', { cls: 'inline', ph: '0' })}</div>
    <p class="small ${msgs.length ? 'warn-txt' : 'muted'}">Rows total ${fmt(cov.total, 'big', S.job)} across a ${fmt(cov.span, 'big', S.job)} floor${msgs.length ? ': ' + msgs.join('; ') + '.' : ' — the whole floor is covered (the outer rows are cut to the shell).'}</p>`;
}
const rowLetter = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/** Re-render the builder after the current event, keeping keyboard focus on the same field. */
function refreshBuilder() {
  setTimeout(() => {
    const c = $('#builderCard');
    if (c) {
      const a = document.activeElement, key = a && c.contains(a) ? focusSel(a) : null, pos = a?.selectionStart, typed = a && a.value !== undefined && a.value !== a.defaultValue ? a.value : null;
      c.innerHTML = S.job.layout.mode === 'measured' ? measuredHTML() : builderHTML();
      if (key) { const n = c.querySelector(key); if (n && typed !== null && n.value !== typed) { n.value = typed; n.dataset.restored = '1'; } if (n) { n.focus(); try { if (pos != null && typed === null) n.setSelectionRange(0, n.value.length); } catch { /* */ } } }
    }
    refreshSetupPreview();
  }, 0);
}
/* ---------------------------------------------------- plate-by-plate builder */

function measuredHTML() {
  const L = S.job.layout, secs = L.mrows || [], B = u(S.job).big;
  const { list } = stackSections(L), pos = new Map(list.map((x) => [x.sec.id, x]));
  const Ri = S.layout.Ri, cov = coverage(S.job);
  const labelOf = new Map(S.layout.plates.filter((p) => p.plId).map((p) => [p.plId, p.label]));
  const inp = (attrs, val, ph, title, cls = '') => `<input ${attrs} data-kind="big" inputmode="decimal" value="${h(inVal(val, 'big', S.job))}" placeholder="${h(ph)}" title="${h(title)}" class="${cls}">`;
  const gap = (g, where) => (g > 25 ? `${fmt(g, 'big', S.job)} of floor not covered at the ${where}` : '');
  const msgs = [gap(cov.gapTop, L.orient === 'v' ? 'left' : 'top'), gap(cov.gapBottom, L.orient === 'v' ? 'right' : 'bottom')].filter(Boolean);
  const body = secs.map((sec, i) => {
    const pp = pos.get(sec.id), blk = sec.type === 'block';
    const lenOf = (pl) => (blk ? (+pl.wid > 0 ? +pl.wid : L.plateW) : (+pl.len > 0 ? +pl.len : L.plateL));
    const tot = (sec.plates || []).reduce((a, pl) => a + lenOf(pl), 0);
    const chord = pp ? 2 * halfChord(Ri, pp.va, pp.vb) : 0;
    const sa = `data-sec="${sec.id}"`;
    const chips = (sec.plates || []).map((pl, k) => `<span class="pchip${labelOf.has(pl.id) ? '' : ' out'}" title="${labelOf.has(pl.id) ? '' : 'Outside the shell — not drawn'}"><b>${h(labelOf.get(pl.id) || '–')}</b>
        ${blk ? inp(`data-mpf="wid" ${sa} data-pl="${pl.id}"`, pl.wid, inVal(L.plateW, 'big', S.job), 'Width') + '<i>×</i>' + inp(`data-mpf="len" ${sa} data-pl="${pl.id}"`, pl.len, inVal(sec.h, 'big', S.job), 'Length (blank = block depth)')
          : inp(`data-mpf="len" ${sa} data-pl="${pl.id}"`, pl.len, inVal(L.plateL, 'big', S.job), 'Length') + '<i>×</i>' + inp(`data-mpf="wid" ${sa} data-pl="${pl.id}"`, pl.wid, inVal(sec.h, 'big', S.job), 'Width (blank = row width)')}
        <button aria-label="Remove plate" class="x" data-act="mp-del" ${sa} data-pl="${pl.id}" title="Remove plate">✕</button></span>`).join('');
    return `<div class="msec ${blk ? 'blk' : ''}">
      <div class="msec-head"><b class="lt">${rowLetter(i)}</b>${blk ? '<span class="chip blk">Block</span>' : '<span class="chip rw">Row</span>'}
        <label>${blk ? 'Depth' : 'Row width'} ${inp(`data-secf="h" ${sa}`, sec.h, '', blk ? 'Block depth (plate length)' : 'Row width (plate width)')}</label>
        <label>Offset ${inp(`data-secf="off" ${sa}`, sec.off, '0', 'Shift plates along the row')}</label>
        ${blk ? `<label>Side rows ${inp(`data-secf="sideH" ${sa}`, sec.sideH, inVal(L.plateW, 'big', S.job), 'Side sketch-plate row width')} × <input data-secf="sideN" ${sa} data-kind="num" inputmode="numeric" value="${h(sec.sideN ?? 1)}" title="Plates per side row" class="xs"></label>` : ''}
        ${(() => { const out = (sec.plates || []).filter((pl) => !labelOf.has(pl.id)).length; return `<span class="tot ${out || (chord && tot < chord - 25) ? 'warn-txt' : 'muted'}">${blk ? 'widths' : 'lengths'} ${fmt(tot, 'big', S.job)}${chord ? ` · floor ${fmt(chord, 'big', S.job)}` : ''}${out ? ` · <b>${out} plate${out > 1 ? 's' : ''} outside the shell</b>` : ''}</span>`; })()}
        <span class="rowacts"><button aria-label="Move up" class="btn sm icon ghost" data-act="msec-move" ${sa} data-d="-1" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button><button aria-label="Move down" class="btn sm icon ghost" data-act="msec-move" ${sa} data-d="1" ${i === secs.length - 1 ? 'disabled' : ''} title="Move down">↓</button><button aria-label="Insert a row above" class="btn sm icon ghost" data-act="msec-add" data-at="${i}" data-type="row" title="Insert a row above">⊕</button><button aria-label="Delete" class="btn sm icon ghost danger" data-act="msec-del" ${sa} title="Delete">✕</button></span></div>
      <div class="pchips">${chips}<button class="btn sm" data-act="mp-add" ${sa}>+ Plate</button></div></div>`;
  }).join('');
  return `<div class="sp-head"><h2>Floor builder — plate by plate</h2><span class="muted small">${S.layout.plates.filter((p) => p.kind === 'floor').length} bottom plates</span></div>
    <p class="muted small">Sections run ${L.orient === 'v' ? 'left to right' : 'top to bottom'}. In a <b>row</b>, enter each plate’s length × width (${B}) in order ${L.orient === 'v' ? 'top to bottom' : 'left to right'}; plates are laid end to end and centred on the floor (use Offset to slide them). End plates longer than the floor are cut at the shell. In a <b>block</b>, enter each plate’s width × length laid side by side; the gaps beside the block are filled with sketch-plate rows. Blank width = row width; blank length = standard length (row) or block depth (block). <b>+ Plate</b> copies the previous plate’s size.</p>
    <div class="acts builder-tpl"><span class="muted small">Start from:</span><button class="btn sm" data-act="mtpl" data-t="drawing">Copy from automatic / row-by-row layout</button></div>
    <div class="msecs">${body || '<p class="empty muted">No rows yet. Copy the current layout or add a row.</p>'}</div>
    <div class="acts"><button class="btn sm" data-act="msec-add" data-at="${secs.length}" data-type="row">+ Row</button><button class="btn sm" data-act="msec-add" data-at="${secs.length}" data-type="block">+ Block</button>
      <span class="spacer"></span>${field('Shift all rows', 'layout.stackOff', 'big', { cls: 'inline', ph: '0' })}</div>
    <p class="small ${msgs.length ? 'warn-txt' : 'muted'}">Rows total ${fmt(cov.total, 'big', S.job)} across a ${fmt(cov.span, 'big', S.job)} floor${msgs.length ? ': ' + msgs.join('; ') + '.' : '.'}</p>`;
}

const missingPlates = () => (S.job.layout.mrows || []).reduce((a, sec) => a + (sec.plates || []).filter((pl) => !S.layout.plates.some((p) => p.plId === pl.id)).length, 0);
function measuredChange(fn) {
  const before = S.layout, miss0 = S.job.layout.mode === 'measured' ? missingPlates() : 0;
  fn(S.job.layout.mrows = S.job.layout.mrows || []);
  commit(); relocateOrphans(before);
  if (S.job.layout.mode === 'measured' && missingPlates() > miss0) toast('The plates in that row are now longer than the floor, so a plate at the end falls outside the shell. Check the lengths or remove a plate.');
  if (S.view === 'setup') refreshBuilder();
  if (S.view === 'map') { drawMap(); renderSide(); }
  renderNav();
}
const findSec = (id) => (S.job.layout.mrows || []).find((x) => x.id === id);

/** After a layout change, move indications / features whose plate no longer exists onto whatever plate now covers that spot. */
function relocateOrphans(before) {
  if (!before?.plates?.length) return 0;
  let moved = 0, lost = 0;
  for (const it of [...S.job.indications, ...S.job.features]) {
    if (!it.plate || S.layout.byKey.has(it.plate) || it.x == null || it.y == null) continue;
    const f = itemFloor(before, it); if (!f) continue;
    const p = plateAt(S.layout, f.x, f.y);
    if (!p) { lost++; continue; }
    const l = toLocal(S.layout, p, f.x, f.y);
    it.plate = p.key; it.x = Math.round(Math.max(0, l.X) * 10) / 10; it.y = Math.round(Math.max(0, l.Y) * 10) / 10; moved++;
  }
  if (moved) { recompute(); scheduleSave(); }
  if (moved || lost) toast(`${moved ? `${moved} item${moved > 1 ? 's' : ''} moved to the plate now at ${moved > 1 ? 'their' : 'its'} location (X/Y recalculated).` : ''}${lost ? ` ${lost} could not be placed — check them.` : ''}`);
  return moved;
}

function builderChange(fn) {
  const before = S.layout;
  fn(S.job.layout.rows = S.job.layout.rows || []);
  commit(); relocateOrphans(before);
  if (S.view === 'setup') refreshBuilder();
  if (S.view === 'map') { drawMap(); renderSide(); }
  renderNav();
}
function refreshSetupPreview() {
  const box = $('#spMap'); if (!box) return;
  box.innerHTML = renderMapSVG(S.job, S.layout, { calc: S.calc, floorOf: (ft) => itemFloor(S.layout, ft), plateLabels: true, indLabels: false });
  const fl = S.layout.plates.filter((p) => p.kind === 'floor'), an = S.layout.plates.length - fl.length;
  const ro = $('#spRoll'); if (ro) ro.innerHTML = rolloutSVG(S.job);
  $('#spStats').textContent = S.layout.R ? `${fl.length} bottom plates (${fl.filter((p) => p.cut).length} cut)${an ? `, ${an} annular` : ''}` : '';
}

/* -------------------------------------------------------------- map view --- */

function viewMap() {
  const chips = RESULT_OPTS.map(([k, v]) => `<button class="chip r-${k}${S.filter.has(k) ? ' on' : ''}" data-act="filter" data-r="${k}" title="${v}">${RESULT_SHORT[k]}<em>${S.job.indications.filter((i) => (i.result || 'pending') === k).length}</em></button>`).join('');
  return `<div class="mapview">
    <div class="maptools">
      <div class="seg">
        <button class="btn sm${S.mode === 'select' ? ' on' : ''}" data-act="mode" data-mode="select" title="Select / pan (Esc)">Select</button>
        <button class="btn sm${S.mode === 'add' ? ' on' : ''}" data-act="mode" data-mode="add" title="Click the map to add an indication (N). Hold Shift to add several.">+ Indication <kbd>N</kbd></button>
        <button class="btn sm${S.mode === 'feature' ? ' on' : ''}" data-act="mode" data-mode="feature" title="Click the map to add a floor feature">+ Feature</button>
        <button class="btn sm${S.mode === 'nozzle' ? ' on' : ''}" data-act="mode" data-mode="nozzle" title="Click at the shell to add a nozzle at that angle">+ Nozzle</button>
        <button class="btn sm${S.mode === 'datum' ? ' on' : ''}" data-act="mode" data-mode="datum" title="Click inside a plate, in the corner the X/Y was measured from (D)">Set datum <kbd>D</kbd></button>
        <select id="ftType" class="sm" title="Feature type">${FT_TYPES.map(([k, v]) => `<option value="${k}" ${S.ftType === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="seg chips">${chips}</div>
      <div class="seg">
        <label class="chk sm"><input type="checkbox" data-act="toggle" data-k="plateLabels" ${S.plateLabels ? 'checked' : ''}><span>Plate labels</span></label>
        <label class="chk sm"><input type="checkbox" data-act="toggle" data-k="indLabels" ${S.indLabels ? 'checked' : ''}><span>Ind. no.</span></label>
        <label class="chk sm"><input type="checkbox" data-act="toggle" data-k="showDatums" ${S.showDatums ? 'checked' : ''}><span>Datums</span></label>
        <label class="chk sm"><input type="checkbox" data-act="toggle" data-k="showCZ" ${S.showCZ ? 'checked' : ''}><span>Critical zone</span></label>
        <label class="chk sm"><input type="checkbox" data-act="toggle" data-k="showPatches" ${S.showPatches ? 'checked' : ''}><span>Patches</span></label>
      </div>
      <div class="seg zoom"><button aria-label="Zoom out" class="btn sm icon" data-act="zoom-out" title="Zoom out">−</button><button aria-label="Zoom in" class="btn sm icon" data-act="zoom-in" title="Zoom in">+</button><button class="btn sm" data-act="zoom-fit" title="Fit (F)">Fit</button></div>
    </div>
    <div class="mapbox" id="mapbox" data-mode="${S.mode}"></div>
    <div class="mapstatus"><span id="hoverInfo">Scroll to zoom · drag to pan</span><span id="modeHint"></span></div>
  </div>
  <aside class="side" id="side"></aside>`;
}
after.map = () => {
  S.mapCtl = new MapController($('#mapbox'), { onClick: mapClick, onHover: mapHover, rerender: drawMap });
  if (S.vb && S.vbR === S.layout.R) { S.mapCtl.vb = S.vb; S.mapCtl.r = S.layout.R; }
  const orig = S.mapCtl.setVB.bind(S.mapCtl);
  S.mapCtl.setVB = (vb) => { orig(vb); S.vb = vb; S.vbR = S.layout.R; };
  drawMap();
  renderSide();
  const fit = S.mapCtl.fit.bind(S.mapCtl);
  S.mapCtl.fit = () => { S.vb = null; fit(); };
};

function drawMap() {
  const box = $('#mapbox'); if (!box) return;
  box.innerHTML = renderMapSVG(S.job, S.layout, {
    calc: S.calc, selected: S.sel, selPlate: S.selPlate, selFeature: S.selFeature, selNozzle: S.selNozzle,
    plateLabels: S.plateLabels, indLabels: S.indLabels, filter: S.filter, showCZ: S.showCZ, showPatches: S.showPatches,
    showDatums: S.showDatums || S.mode === 'datum', datumFocus: focusPlate(),
    floorOf: (ft) => itemFloor(S.layout, ft)
  });
  box.dataset.mode = S.mode;
  S.mapCtl?.afterRender();
  const hint = { nozzle: 'Click at the shell where the nozzle is — its angle is taken from the click · Esc to stop', datum: 'Click inside a plate, in the corner the X/Y was measured from · Esc to stop', select: '', add: 'Click a plate to place an indication · Shift-click to keep adding · Esc to stop', feature: 'Click to place the feature · Esc to stop', place: 'Click the map to set this indication\'s location · Esc to cancel' }[S.mode];
  const mh = $('#modeHint'); if (mh) mh.textContent = hint || '';
}

function focusPlate() {
  if (S.selPlate) return S.selPlate;
  if (S.sel) return curInd()?.plate || null;
  if (S.selFeature) return S.job.features.find((f) => f.id === S.selFeature)?.plate || null;
  return null;
}

function roundLocal(v) { const st = S.job.units === 'metric' ? 5 : 6.35; return Math.max(0, Math.round(v / st) * st) || 0; }

function mapHover(fp) {
  const el = $('#hoverInfo'); if (!el) return;
  if (!fp) { el.textContent = 'Scroll to zoom · drag to pan'; return; }
  if (S.mode === 'nozzle') { el.innerHTML = `Shell angle <b>${(Math.round(angleOf(fp.x, fp.y) * 2) / 2).toFixed(1)}°</b>`; return; }
  const p = plateAt(S.layout, fp.x, fp.y);
  const r = Math.hypot(fp.x, fp.y);
  if (!p) { el.textContent = r > S.layout.R ? 'Outside shell' : 'No plate here'; return; }
  const { X, Y } = toLocal(S.layout, p, fp.x, fp.y);
  el.innerHTML = `<b>${h(p.label)}</b> &nbsp;X ${fmt(X, 'small', S.job)} &nbsp;Y ${fmt(Y, 'small', S.job)} <span class="muted">&nbsp;·&nbsp; r ${fmt(r, 'big', S.job)} &nbsp;θ ${angleOf(fp.x, fp.y).toFixed(1)}° &nbsp;to shell ${S.layout.R - r > 914 ? fmt(S.layout.R - r, 'big', S.job) : fmt(S.layout.R - r, 'small', S.job)}</span>`;
}

function mapClick(fp, hit) {
  if (!fp) return;
  const p = plateAt(S.layout, fp.x, fp.y);
  if (S.mode === 'nozzle') {
    const ang = Math.round(angleOf(fp.x, fp.y) * 2) / 2 % 360;
    const nz = { id: uid(), mark: nextMark('Nozzle'), type: 'Nozzle', angle: ang, size: null, elev: null, service: '' };
    S.job.nozzles = S.job.nozzles || []; S.job.nozzles.push(nz);
    S.selNozzle = nz.id; S.sel = S.selPlate = S.selFeature = null;
    if (!hit.shift) S.mode = 'select';
    $$('[data-act="mode"]').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
    commit(); drawMap(); renderSide();
    setTimeout(() => $('#side [data-nb="type"]')?.focus(), 30);
    return;
  }
  if (S.mode === 'datum') {
    if (!p) return toast('Click inside a plate, in the corner used as the datum.');
    if (p.kind === 'annular') {
      const a = angleOf(fp.x, fp.y), d0 = Math.abs(((a - p.a0 + 540) % 360) - 180), d1 = Math.abs(((a - p.a1 + 540) % 360) - 180);
      applyDatum(p.key, d1 < d0 ? 'end' : 'start');
    } else {
      const cx = (p.bb.x0 + p.bb.x1) / 2, cy = (p.bb.y0 + p.bb.y1) / 2;
      applyDatum(p.key, (fp.y <= cy ? 'B' : 'T') + (fp.x <= cx ? 'L' : 'R'));
    }
    S.selPlate = p.key; S.sel = S.selFeature = null;
    drawMap(); renderSide();
    return;
  }
  if (S.mode === 'add' || S.mode === 'place' || S.mode === 'feature') {
    if (!p) return toast('That point is not on a plate.');
    const { X, Y } = toLocal(S.layout, p, fp.x, fp.y);
    const loc = { plate: p.key, x: roundLocal(X), y: roundLocal(Y) };
    if (S.mode === 'add') {
      const ind = { id: uid(), no: nextNo(S.job), ...loc, result: 'pending', repair: 'auto', created: Date.now() };
      S.job.indications.push(ind);
      S.sel = ind.id; S.selPlate = S.selFeature = null;
      if (!hit.shift) S.mode = 'select';
      commit(); renderNav();
      $$('[data-act="mode"]').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
      drawMap(); renderSide(true);
      return;
    }
    if (S.mode === 'place') {
      const ind = curInd(); if (ind) Object.assign(ind, loc);
      S.mode = 'select'; commit(); drawMap(); renderSide();
      return;
    }
    const ft = { id: uid(), type: S.ftType, label: '', ...loc, sizeA: S.ftType === 'sump' ? toMm(36, 'small', { units: 'imperial' }) : S.ftType === 'column' ? 254 : 609.6 };
    if (S.job.units === 'metric') ft.sizeA = S.ftType === 'sump' ? 900 : S.ftType === 'column' ? 250 : 600;
    S.job.features.push(ft);
    S.selFeature = ft.id; S.sel = S.selPlate = null; S.mode = 'select';
    $$('[data-act="mode"]').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
    commit(); drawMap(); renderSide();
    return;
  }
  S.sel = hit.ind || null;
  S.selNozzle = !S.sel ? hit.nozzle || null : null;
  S.selFeature = !S.sel && !S.selNozzle ? hit.feature || null : null;
  S.selPlate = !S.sel && !S.selFeature && !S.selNozzle && p ? p.key : null;
  drawMap(); renderSide();
}

/**
 * Record which corner (or annular seam) of a plate the X/Y offsets were measured from.
 * X/Y values stay exactly as entered; they are now read from the new corner.
 */
function applyDatum(key, c) {
  const o = (S.job.plates[key] = { ...(S.job.plates[key] || {}) });
  const prev = o.datumC;
  delete o.datumX; delete o.datumY;
  if (!c || c === 'default' || c === 'start' || c === (S.job.layout.refCorner || 'BL')) delete o.datumC; else o.datumC = c;
  if (prev === o.datumC) return;
  commit();
  if (S.view === 'plates') refreshPlateTable();
  const p = S.layout.byKey.get(key);
  toast(`Datum for ${p.label}: ${datumName(p)}`);
}

const curInd = () => S.job?.indications.find((i) => i.id === S.sel);

function renderSide(focusFirst) {
  const side = $('#side'); if (!side) return;
  if (S.sel && curInd()) side.innerHTML = indEditor(curInd(), 'side');
  else if (S.selNozzle) side.innerHTML = nozzleEditor();
  else if (S.selFeature) side.innerHTML = featureEditor();
  else if (S.selPlate) side.innerHTML = plateEditor(S.selPlate);
  else side.innerHTML = sideOverview();
  if (focusFirst) setTimeout(() => $('[data-ib="mflPct"]', side)?.focus(), 30);
}

function sideOverview() {
  const inds = S.job.indications.slice().sort(byNo);
  const c = S.calc;
  return `<div class="side-pad">
    <h2>Floor overview</h2>
    <div class="mini-kpis">
      <div><b>${inds.length}</b><span>Indications</span></div>
      <div><b>${c.repairs.length}</b><span>Repairs</span></div>
      <div><b>${inds.filter((i) => (i.result || 'pending') === 'pending').length}</b><span>Pending</span></div>
    </div>
    ${c.regions.map((r) => `<div class="reg-line ${r.ok === false ? 'bad' : 'ok'}"><span>${h(r.label)}</span><b>MRT ${fmt(r.MRT, 't', S.job)}</b><small>min ${fmt(r.limit, 't', S.job)}</small></div>`).join('')}
    ${legendHTML()}
    <p class="muted small">Press <kbd>N</kbd> then click a plate to add an MFL indication. Click a plate to edit its thickness or scan coverage.</p>
    <div class="ind-list">${inds.map((i) => { const a = c.per.get(i.id) || {}; return `<button class="ind-row" data-act="sel-ind" data-id="${i.id}"><span class="dot r-${i.result || 'pending'}"></span><b>${h(i.no)}</b><span>${h(a.plate?.label ?? '?')}</span><span class="n">${a.rem != null ? fmt(a.rem, 't', S.job) : (i.mflPct != null ? i.mflPct + '%' : '')}</span><span class="st st-${(a.status || '').replace(/\W+/g, '-')}">${h(a.status === 'n/a' ? '' : a.status)}</span></button>`; }).join('') || '<p class="muted">No indications yet.</p>'}</div>
  </div>`;
}

const byNo = (a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true });

/* -------------------------------------------------------- indication editor */

function plateDatalist() { return `<datalist id="plateList">${S.layout.plates.map((p) => `<option value="${h(p.label)}">`).join('')}</datalist>`; }

function indEditor(ind, where) {
  const a = S.calc.per.get(ind.id) || {};
  const f = (label, key, kind = 'text', extra = {}) => field(label, key, kind, { ...extra, attr: 'data-ib', value: ind[key] });
  const inds = S.job.indications.slice().sort(byNo), idx = inds.findIndex((i) => i.id === ind.id);
  const photos = S.photos.filter((p) => p.indId === ind.id);
  const nomPh = a.tNom != null ? inVal(a.tNom, 't', S.job) : '';
  return `<div class="ed" data-ed="ind" data-id="${ind.id}" data-where="${where}">
    <div class="ed-head">
      <div class="ed-title"><span class="dot r-${ind.result || 'pending'}"></span><span>Indication</span><input class="ed-no" data-ib="no" data-kind="text" value="${h(ind.no)}" aria-label="Indication number"></div>
      <div class="acts">
        <button aria-label="Previous" class="btn sm icon" data-act="ind-nav" data-d="-1" ${idx <= 0 ? 'disabled' : ''} title="Previous">‹</button>
        <button class="btn sm icon" data-act="ind-nav" data-d="1" ${idx >= inds.length - 1 ? 'disabled' : ''} title="Next">›</button>
        <button aria-label="Close (Esc)" class="btn sm icon ghost" data-act="ind-close" title="Close (Esc)">✕</button>
      </div>
    </div>
    ${plateDatalist()}
    <fieldset><legend>Location</legend><div class="fgrid g3">
      ${field('Plate', 'plate', 'plate', { attr: 'data-ib', value: a.plate?.label ?? '', list: 'plateList', cls: a.plate ? '' : 'invalid' })}
      ${f('X', 'x', 'small')}${f('Y', 'y', 'small')}
    </div>
    <div class="loc-info" data-part="loc">${locInfo(a)}</div>
    <div class="acts"><button class="btn sm" data-act="ind-pick">Pick on map</button>${where !== 'side' ? '<button class="btn sm" data-act="ind-show">Show on map</button>' : '<button class="btn sm" data-act="ind-zoom">Zoom to</button>'}</div>
    </fieldset>
    <fieldset><legend>MFL</legend><div class="fgrid g3">
      ${f('Signal / amplitude', 'mflSignal')}${f('Est. wall loss', 'mflPct', 'num', { unit: '%' })}${f('Scan / pass ref', 'scanRef')}
      ${f('Indication length (optional)', 'len', 'small')}${f('Indication width (optional)', 'wid', 'small')}
    </div></fieldset>
    <fieldset><legend>Prove-up</legend><div class="fgrid">
      ${f('Result', 'result', 'sel', { options: RESULT_OPTS, cls: 'span2' })}
      ${f('UT min. remaining', 'utMin', 't')}${f('UT local nominal', 'utNom', 't', { ph: nomPh })}
      ${f('UT method', 'utMethod', 'sel', { options: UT_METHOD })}${f('VT pit depth (product side)', 'vtDepth', 't')}
      ${f('VT condition', 'vtCond', 'sel', { options: VT_COND })}${f('Coating condition', 'coating', 'sel', { options: COATING })}
    </div></fieldset>
    <div class="ed-sum" data-part="sum">${summaryBox(a)}</div>
    <fieldset><legend>Repair &amp; remarks</legend><div class="fgrid">
      ${f('Repair', 'repair', 'sel', { options: [['auto', 'Auto (API 653 calc)'], ['yes', 'Yes'], ['no', 'No']] })}${f('Repair method', 'repairMethod', 'sel', { options: REPAIR_METHOD })}
      ${(() => { const pp = patchOf(patchList(S.job, S.layout, S.calc), ind.id); return pp ? `<p class="small span2 patch-note"><b>${h(pp.id)}</b> ${pp.auto ? 'auto patch' : 'patch'} ${fmt(pp.L, 'small', S.job, false)} × ${fmt(pp.W, 'small', S.job)}${pp.kind === 'tomb' ? ' (radial × along the shell)' : ''}${pp.inds.length > 1 ? ` — combined with ${pp.inds.filter((x) => x.id !== ind.id).map((x) => h(x.no)).join(', ')}` : ''}${pp.kind === 'tomb' ? ' · tombstone, sides at 90° to the shell' : ''}. Type a size below to override.${pp.checks.length ? `<br><b>Critical zone (API 653 §9.11.1.2): <span class="${pp.status === 'Fails' ? 'bad' : pp.status === 'OK' ? 'ok' : 'warn-txt'}">${pp.status}</span></b><br>${pp.checks.map((k) => `${k.ok === true ? '✓' : k.ok === false ? '✕' : '?'} ${h(k.item)} — <span class="muted">${h(k.note)}</span>`).join('<br>')}` : ''}</p>` : ''; })()}
      ${f('Repair / patch plate length', 'repLen', 'small', { ph: S.job.calc.autoPatch !== false && S.calc.per.get(ind.id)?.repair ? 'auto' : '' })}${f('Repair / patch plate width', 'repWid', 'small', { ph: S.job.calc.autoPatch !== false && S.calc.per.get(ind.id)?.repair ? 'auto' : '' })}
      ${f('Patch plate thickness', 'repT', 't')}${f('Repair ID / patch no.', 'repId', 'text', { ph: 'e.g. P-3, or shared patch' })}
      ${f('Cause of soil-side corrosion removed (repaired area leaves UPᵣ — API 653 §4.4.5.1 Note 1)', 'causeRemoved', 'bool', { cls: 'span2' })}
      ${f('Comments', 'comments', 'area', { rows: 2, cls: 'span2' })}
    </div></fieldset>
    <fieldset><legend>Photos</legend>
      <div class="photos-ed">${photos.map((p) => `<figure><img src="${p.dataUrl}" alt="" data-act="photo-view" data-id="${p.id}"><input data-photo-cap="${p.id}" value="${h(p.caption)}" placeholder="Caption"><button aria-label="Delete photo" class="btn sm ghost danger" data-act="photo-del" data-id="${p.id}" title="Delete photo">✕</button></figure>`).join('')}
      <label class="photo-add"><input type="file" accept="image/*" multiple data-act="photo-add" hidden><span>+ Add photo</span></label></div>
    </fieldset>
    <div class="ed-foot"><button class="btn sm" data-act="ind-dup">Duplicate</button><button class="btn sm danger ghost" data-act="ind-del">Delete indication</button></div>
  </div>`;
}

function locInfo(a) {
  if (!a.plate) return '<span class="bad">Enter a valid plate label (see the Plates page) or pick on the map.</span>';
  if (!a.floor) return '';
  return `From ${h(a.plate.label)} datum: ${h(datumName(a.plate))}<br>r ${fmt(a.r, 'big', S.job)} · θ ${angleOf(a.floor.x, a.floor.y).toFixed(1)}° · ${a.distShell > 914 ? fmt(a.distShell, 'big', S.job) : fmt(a.distShell, 'small', S.job)} from shell${a.critical ? ' <span class="chip cz">Critical zone</span>' : ''}${a.plate.kind === 'annular' ? ' · <span class="muted">annular: X along shell, Y in from shell</span>' : ''}`;
}

function summaryBox(a) {
  const st = a.status || '';
  const cls = st === 'OK' ? 'ok' : st.startsWith('repair') || st === 'below MRT' ? 'bad' : '';
  return `<div class="sum-grid">
    <div><span>Nominal</span><b>${fmt(a.tNom, 't', S.job)}</b></div>
    <div><span>Remaining</span><b>${fmt(a.rem, 't', S.job)}</b><small>${h(a.src || '')}</small></div>
    <div><span>Wall loss</span><b>${a.lossPct != null ? a.lossPct.toFixed(0) + '%' : '—'}</b><small>${a.loss != null ? fmt(a.loss, 't', S.job) : ''}</small></div>
    <div><span>At next insp.</span><b>${fmt(a.projected, 't', S.job)}</b><small>min ${fmt(a.limit, 't', S.job)}</small></div>
  </div><div class="sum-status ${cls}">${h(st === 'OK' ? 'Acceptable for next interval' + (a.est ? ' (MFL estimate — provisional)' : '') : statusText(a))}${a.issues?.bad?.length ? `<br><small class="bad">Not used: ${h(a.issues.bad.join('; '))}</small>` : ''}${a.nearCZ ? '<br><small>Near the critical zone — enter the length / width to check (§3.11)</small>' : ''}</div>`;
}

function refreshEditorParts(root) {
  const ind = S.job.indications.find((i) => i.id === root.dataset.id); if (!ind) return;
  const a = S.calc.per.get(ind.id) || {};
  $('[data-part="loc"]', root).innerHTML = locInfo(a);
  $('[data-part="sum"]', root).innerHTML = summaryBox(a);
  const pf = $('[data-ib="plate"]', root); pf?.closest('.fld')?.classList.toggle('invalid', !a.plate);
  const dot = $('.ed-title .dot', root); if (dot) dot.className = 'dot r-' + (ind.result || 'pending');
  const un = $('[data-ib="utNom"]', root); if (un && a.tNom != null) un.placeholder = inVal(plateNominal(S.job, a.plate), 't', S.job);
}

/* ---------------------------------------------------- feature & plate edit */

function nozzleEditor() {
  const nz = (S.job.nozzles || []).find((x) => x.id === S.selNozzle); if (!nz) return sideOverview();
  const f = (label, key, kind = 'text', extra = {}) => field(label, key, kind, { ...extra, attr: 'data-nb', value: nz[key], attrs: `data-id="${nz.id}"` });
  return `<div class="ed" data-ed="nozzle" data-id="${nz.id}"><div class="ed-head"><div class="ed-title"><span>Shell nozzle</span><b>${h(nz.mark || '')}</b></div><div class="acts"><button aria-label="Close" class="btn sm icon ghost" data-act="close-sel">✕</button></div></div>
    <div class="fgrid">
      ${f('Mark', 'mark')}${f('Type', 'type', 'sel', { options: NZ_TYPES })}
      ${f('Angle (clockwise from 0°)', 'angle', 'num', { unit: '°' })}${f('Size (nominal / opening)', 'size', 'small')}
      ${f('Elevation to centreline', 'elev', 'small', { hint: 'Above the tank bottom' })}${f('Service / description', 'service', 'text', { ph: 'e.g. Inlet, 4" drain' })}
      ${f('Connection', 'conn', 'sel', { options: NZ_CONN, cls: 'span2' })}
      ${f('Notes', 'notes', 'area', { rows: 2, cls: 'span2' })}
    </div>
    <fieldset><legend>Neck UT</legend><div class="fgrid g3">
      ${f('Schedule / class', 'sched', 'text', { ph: 'e.g. Sch 40, STD, XS' })}${(() => { const w = nozzleWall({ ...nz, tNom: null, tMin: null }, S.job); return f('Nominal wall', 'tNom', 't', { ph: w.tNom ? inVal(w.tNom, 't', S.job) : '', hint: w.tNom ? 'Blank = ' + w.src : '' }) + f('Retirement thickness (engineer)', 'tMin', 't', { ph: w.tMin ? inVal(w.tMin, 't', S.job) : '', hint: w.tMin ? 'Blank = construction minimum only (nominal less 12.5 % mill tolerance) — not an acceptance value' : '' }); })()}
    </div>
    <div class="ut-clock">${UT_CLOCK.map(([k, lab]) => field(`${lab} o’clock`, k, 't', { attr: 'data-nb', value: nz[k], attrs: `data-id="${nz.id}"` })).join('')}</div>
    <div class="ut-extra">${(nz.utx || []).map((r) => `<div class="utx-row"><input data-nbx="loc" data-id="${nz.id}" data-rid="${r.id}" data-kind="text" value="${h(r.loc || '')}" placeholder="Location, e.g. flange side 12"><span class="ctl"><input data-nbx="t" data-id="${nz.id}" data-rid="${r.id}" data-kind="t" inputmode="decimal" value="${h(inVal(r.t, 't', S.job))}"><i class="unit">${u(S.job).small}</i></span><button aria-label="Remove reading" class="btn sm icon ghost danger" data-act="utx-del" data-id="${nz.id}" data-rid="${r.id}" title="Remove reading">✕</button></div>`).join('')}
      <button class="btn sm" data-act="utx-add" data-id="${nz.id}">+ Reading</button></div>
    <div class="nz-ut" data-part="nzut">${nozzleUTBox(nz)}</div>
    </fieldset>
    <p class="muted small">Nozzles are located by angle around the shell, measured clockwise from 0° ${h(S.job.info.zeroRef || '')}. All nozzles are listed in Tank setup → Shell nozzles and in the report.</p>
    <div class="ed-foot"><span></span><button class="btn sm danger ghost" data-act="nozzle-del" data-id="${nz.id}">Delete nozzle</button></div></div>`;
}

function refreshNozzleUT(nz) {
  const b = $(`[data-ed="nozzle"][data-id="${nz.id}"] [data-part="nzut"]`); if (b) b.innerHTML = nozzleUTBox(nz);
  const r = nozzleUT(nz, S.job);
  const m = $(`[data-part="min-${nz.id}"]`); if (m) m.textContent = r.count ? fmt(r.min, 't', S.job, false) : '—';
  const st = $(`[data-part="st-${nz.id}"]`); if (st) { st.innerHTML = `<span class="st ${r.status === 'OK' ? 'st-OK' : r.status ? 'st-below-MRT' : ''}">${r.status || ''}</span>`; st.closest('tr')?.classList.toggle('is-bad', r.status === 'Below t-min'); }
}

function nozzleUTBox(nz) {
  const r = nozzleUT(nz, S.job);
  if (!r.count) return '<span class="muted small">No UT readings yet.</span>';
  return `<div class="sum-grid three"><div><span>Min. reading</span><b>${fmt(r.min, 't', S.job)}</b><small>${r.count} reading${r.count > 1 ? 's' : ''}</small></div>
    <div><span>Wall loss</span><b>${r.lossPct != null ? r.lossPct.toFixed(0) + '%' : '—'}</b><small>${(() => { const w = nozzleWall(nz, S.job); return w.tNom ? 'vs ' + fmt(w.tNom, 't', S.job) + (w.nomTbl ? ' (table)' : '') : 'enter nominal'; })()}</small></div>
    <div><span>Status</span><b class="${r.status === 'OK' ? 'ok' : r.status ? 'bad' : ''}">${r.status || '—'}</b><small>${(() => { const w = nozzleWall(nz, S.job); return w.tMin ? 't-min ' + fmt(w.tMin, 't', S.job) + (w.minTbl ? ' (table)' : '') : 'enter t-min'; })()}</small></div></div>`;
}

function nozzleTableHTML(design = false) {
  const list = (S.job.nozzles || []);
  const U = u(S.job), Cc = Math.PI * (+S.job.tank?.diameter || 0);
  const arcIn = (n) => `<input data-nb="arc" data-id="${n.id}" data-kind="big" inputmode="decimal" class="num" value="${h(Cc > 0 && Number.isFinite(+n.angle) && n.angle !== null && n.angle !== '' ? inVal((+n.angle / 360) * Cc, 'big', S.job) : '')}" ${Cc > 0 ? '' : 'disabled title="Enter the tank diameter first"'}>`;
  const inp = (n, k, kind, extra = '') => kind === 'sel'
    ? `<select data-nb="${k}" data-id="${n.id}" data-kind="text">${NZ_TYPES.map((t) => `<option ${n[k] === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`
    : kind === 'conn'
      ? `<select data-nb="${k}" data-id="${n.id}" data-kind="text">${NZ_CONN.map(([v, l]) => `<option value="${v}" ${(n[k] || '') === v ? 'selected' : ''}>${v ? NZ_CONN_SHORT[v] : '—'}</option>`).join('')}</select>`
      : `<input data-nb="${k}" data-id="${n.id}" data-kind="${kind}" ${kind !== 'text' ? 'inputmode="decimal" class="num"' : ''} value="${h(kind === 'small' || kind === 't' ? inVal(n[k], kind, S.job) : n[k] ?? '')}" ${(k === 'tNom' || k === 'tMin') && !(n[k] > 0) ? (() => { const w = nozzleWall(n, S.job); const v = k === 'tNom' ? w.tNom : w.tMin; return v ? `placeholder="${inVal(v, 't', S.job)}" title="From the nozzle table: ${h(w.src)}"` : ''; })() : ''} ${extra}>`;
  if (design) return `<div class="sp-head"><h2>Nozzles</h2><span class="muted small">${list.length} on the shell</span></div>
    <p class="muted small">Position each nozzle by <b>angle</b> or by <b>distance around the shell</b>, both clockwise from the 0° datum (${h(S.job.info.zeroRef || 'set the 0° reference label above')}) — enter either one and the other follows. Elevation is to the nozzle centreline above the bottom. Nozzles are drawn on the floor drawing and the shell roll-out; neck UT readings are entered on the Nozzles page during an inspection.</p>
    <div class="tblwrap"><table class="grid nozzles"><thead><tr><th>Mark</th><th>Type</th><th>Connection</th><th>Angle (°)</th><th title="Distance around the shell, clockwise from the datum">From datum (${U.big})</th><th>Size (${U.small})</th><th>Elev. (${U.small})</th><th>Schedule</th><th>Nom. wall</th><th>t-min</th><th>Service / description</th><th></th></tr></thead><tbody>
    ${list.slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0)).map((n) => `<tr><td>${inp(n, 'mark', 'text', 'class="mk"')}</td><td>${inp(n, 'type', 'sel')}</td><td>${inp(n, 'conn', 'conn')}</td><td>${inp(n, 'angle', 'num')}</td><td>${arcIn(n)}</td><td>${inp(n, 'size', 'small')}</td><td>${inp(n, 'elev', 'small')}</td><td>${inp(n, 'sched', 'text', 'class="sch"')}</td><td>${inp(n, 'tNom', 't')}</td><td>${inp(n, 'tMin', 't')}</td><td>${inp(n, 'service', 'text')}</td><td><button aria-label="Delete" class="btn sm icon ghost danger" data-act="nozzle-del" data-id="${n.id}" title="Delete">✕</button></td></tr>`).join('') || '<tr><td colspan="12" class="empty">No nozzles yet. Add them here, or place them by clicking around the shell on the floor drawing.</td></tr>'}
    </tbody></table></div>
    <div class="acts"><button class="btn sm" data-act="nozzle-add">+ Nozzle</button><button class="btn sm" data-act="nozzle-place">Place on the floor drawing…</button></div>`;
  return `<div class="sp-head"><h2>Shell nozzles</h2><span class="muted small">${list.length} on the shell</span></div>
    <p class="muted small">Angle is clockwise from 0° (${h(S.job.info.zeroRef || 'the 0° reference')}). Neck UT readings at 12, 3, 6 and 9 o’clock; add more readings by clicking the nozzle on the Floor map. Thickness in ${U.small}.</p>
    <div class="tblwrap"><table class="grid nozzles"><thead><tr><th>Mark</th><th>Type</th><th>Connection</th><th>Angle (°)</th><th>Size (${U.small})</th><th>Elev. (${U.small})</th><th>Schedule</th><th>Nom. wall</th><th>t-min</th>${UT_CLOCK.map(([, l]) => `<th>${l}:00</th>`).join('')}<th>Min</th><th>Status</th><th>Service / description</th><th></th></tr></thead><tbody>
    ${list.slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0)).map((n) => { const r = nozzleUT(n, S.job); return `<tr class="${r.status === 'Below t-min' ? 'is-bad' : ''}"><td>${inp(n, 'mark', 'text', 'class="mk"')}</td><td>${inp(n, 'type', 'sel')}</td><td>${inp(n, 'conn', 'conn')}</td><td>${inp(n, 'angle', 'num')}</td><td>${inp(n, 'size', 'small')}</td><td>${inp(n, 'elev', 'small')}</td><td>${inp(n, 'sched', 'text', 'class="sch"')}</td><td>${inp(n, 'tNom', 't')}</td><td>${inp(n, 'tMin', 't')}</td>${UT_CLOCK.map(([k]) => `<td>${inp(n, k, 't')}</td>`).join('')}<td class="n" data-part="min-${n.id}">${r.count ? fmt(r.min, 't', S.job, false) + ((n.utx || []).length ? `<sup title="Includes ${(n.utx || []).length} extra reading(s)">+${(n.utx || []).length}</sup>` : '') : '—'}</td><td data-part="st-${n.id}"><span class="st ${r.status === 'OK' ? 'st-OK' : r.status ? 'st-below-MRT' : ''}">${r.status || ''}</span></td><td>${inp(n, 'service', 'text')}</td><td><button aria-label="Delete" class="btn sm icon ghost danger" data-act="nozzle-del" data-id="${n.id}" title="Delete">✕</button></td></tr>`; }).join('') || '<tr><td colspan="17" class="empty">No nozzles yet.</td></tr>'}
    </tbody></table></div>
    <div class="acts"><button class="btn sm" data-act="nozzle-add">+ Nozzle</button><button class="btn sm" data-act="exp-noz">Export CSV</button></div>`;
}

function featureEditor() {
  const ft = S.job.features.find((x) => x.id === S.selFeature); if (!ft) return sideOverview();
  const p = S.layout.byKey.get(ft.plate);
  const f = (label, key, kind = 'text', extra = {}) => field(label, key, kind, { ...extra, attr: 'data-fb', value: ft[key] });
  return `<div class="ed" data-ed="feature" data-id="${ft.id}"><div class="ed-head"><div class="ed-title"><span>Floor feature</span></div><div class="acts"><button aria-label="Close" class="btn sm icon ghost" data-act="close-sel">✕</button></div></div>
    ${plateDatalist()}
    <div class="fgrid">
      ${f('Type', 'type', 'sel', { options: FT_TYPES })}${f('Label', 'label')}
      ${field('Plate', 'plate', 'plate', { attr: 'data-fb', value: p?.label ?? '', list: 'plateList', cls: p ? '' : 'invalid' })}<div></div>
      ${f('X', 'x', 'small')}${f('Y', 'y', 'small')}
      ${f(ft.type === 'column' || ft.type === 'sump' ? 'Diameter' : 'Length', 'sizeA', 'small')}${ft.type === 'column' || ft.type === 'sump' ? '<div></div>' : f('Width', 'sizeB', 'small')}
      ${f('Notes', 'notes', 'area', { rows: 2, cls: 'span2' })}
    </div>
    <div class="ed-foot"><button class="btn sm danger ghost" data-act="feature-del">Delete feature</button></div></div>`;
}

function plateEditor(key) {
  const p = S.layout.byKey.get(key); if (!p) return sideOverview();
  const o = S.job.plates[key] || {};
  const inds = S.job.indications.filter((i) => i.plate === key).sort(byNo);
  const nom = p.kind === 'annular' ? S.job.tank.tAnnular ?? S.job.tank.tBottom : S.job.tank.tBottom;
  return `<div class="ed" data-ed="plate" data-key="${key}"><div class="ed-head"><div class="ed-title"><span>Plate</span><b>${h(p.label)}</b></div><div class="acts"><button aria-label="Close" class="btn sm icon ghost" data-act="close-sel">✕</button></div></div>
    <p class="muted small">${p.kind === 'annular' ? 'Annular segment' : p.cut ? 'Cut (sketch) plate' : 'Full plate'} · ${fmt(p.bb.x1 - p.bb.x0, 'big', S.job)} × ${fmt(p.bb.y1 - p.bb.y0, 'big', S.job)} · auto label ${h(p.autoLabel)}</p>
    <div class="fgrid">
      ${field('Label', 'label', 'text', { attr: 'data-pb', value: o.label ?? '', ph: p.autoLabel, attrs: `data-key="${key}"` })}
      ${field('MFL scan', 'scan', 'sel', { attr: 'data-pb', value: o.scan || 'scanned', options: [['scanned', 'Scanned'], ['partial', 'Partially scanned'], ['not', 'Not scanned']], attrs: `data-key="${key}"` })}
      ${field('Nominal t', 'tNom', 't', { attr: 'data-pb', value: o.tNom, ph: inVal(nom, 't', S.job), attrs: `data-key="${key}"` })}
      ${field('UT min (general)', 'utMin', 't', { attr: 'data-pb', value: o.utMin, attrs: `data-key="${key}"` })}
      ${field('Notes', 'notes', 'area', { attr: 'data-pb', value: o.notes, rows: 2, cls: 'span2', attrs: `data-key="${key}"` })}
    </div>
    ${p.plId ? (() => { const sec = findSec(p.rowId); if (!sec) return ''; const pl = sec.plates.find((x) => x.id === p.plId); const idx = sec.plates.indexOf(pl); const blk = sec.type === 'block'; const sa = `data-sec="${sec.id}" data-pl="${pl.id}"`;
      return `<fieldset><legend>Measured plate · ${blk ? 'block' : 'row'} ${h(rowLetter(p.row ?? 0))}, plate ${idx + 1} of ${sec.plates.length}</legend><div class="fgrid">
        <label class="fld"><span class="lbl">Length</span><span class="ctl"><input data-mpf="len" ${sa} data-kind="big" inputmode="decimal" value="${h(inVal(pl.len, 'big', S.job))}" placeholder="${h(inVal(blk ? sec.h : S.job.layout.plateL, 'big', S.job))}"><i class="unit">${u(S.job).big}</i></span></label>
        <label class="fld"><span class="lbl">Width</span><span class="ctl"><input data-mpf="wid" ${sa} data-kind="big" inputmode="decimal" value="${h(inVal(pl.wid, 'big', S.job))}" placeholder="${h(inVal(blk ? S.job.layout.plateW : sec.h, 'big', S.job))}"><i class="unit">${u(S.job).big}</i></span></label></div>
        <div class="acts"><button class="btn sm" data-act="mp-add" data-sec="${sec.id}" data-at="${idx}">Insert plate before</button><button class="btn sm" data-act="mp-add" data-sec="${sec.id}" data-at="${idx + 1}">Insert after</button><button class="btn sm ghost danger" data-act="mp-del" ${sa}>Remove plate</button></div>
        <p class="muted small">Edit the whole row in Tank setup → Floor builder.</p></fieldset>`; })() : ''}
    ${p.rowId && S.job.layout.mode === 'custom' ? (() => { const r = (S.job.layout.rows || []).find((x) => x.id === p.rowId); if (!r) return ''; const cnt = S.layout.plates.filter((q) => q.rowId === r.id && q.part !== 'side').length;
      return `<fieldset><legend>${r.type === 'block' ? 'Block' : 'Row'} ${h(rowLetter(p.row ?? 0))}</legend><div class="acts row-step">
        <span>${r.type === 'block' ? 'Full-length plates in block' : 'Plates in this row'}: <b>${r.n}</b>${cnt !== +r.n ? ` <span class="muted small">(${cnt} drawn)</span>` : ''}</span>
        <button aria-label="One plate fewer" class="btn sm icon" data-act="row-n" data-row="${r.id}" data-d="-1" title="One plate fewer">−</button><button aria-label="One plate more" class="btn sm icon" data-act="row-n" data-row="${r.id}" data-d="1" title="One plate more">+</button></div>
        <p class="muted small">${p.part === 'side' ? 'This is a side sketch plate of the block. ' : ''}Edit row widths, plate lengths and offsets in Tank setup → Floor builder.</p></fieldset>`; })() : ''}
    ${p.kind === 'annular' || p.plId ? '' : `<fieldset><legend>Plate size &amp; orientation</legend><div class="fgrid g3">
      ${field('Length', 'len', 'big', { attr: 'data-pb', value: o.len, ph: inVal(p.std.len, 'big', S.job), attrs: `data-key="${key}"` })}
      ${field('Width', 'wid', 'big', { attr: 'data-pb', value: o.wid, ph: inVal(p.std.wid, 'big', S.job), attrs: `data-key="${key}"` })}
      ${field('Orientation', 'orient', 'sel', { attr: 'data-pb', value: o.orient || '', options: [['', `Standard (${orientName(p.std.orient).toLowerCase()})`], ['h', 'Horizontal'], ['v', 'Vertical']], attrs: `data-key="${key}"` })}
      </div>
      <p class="muted small">${p.resized ? `Drawn ${fmt(p.size.len, 'big', S.job)} × ${fmt(p.size.wid, 'big', S.job)}, ${orientName(p.size.orient).toLowerCase()}, from its ${refCornerName(p.datum.c)} corner.` : 'Uses the standard plate size.'} Horizontal = length runs left–right on the drawing. Blank fields use the standard size from Tank setup.</p>
      ${p.resized ? `<div class="acts"><button class="btn sm ghost" data-act="plate-size-reset" data-key="${key}">Reset to standard size</button></div>` : ''}
    </fieldset>`}
    <fieldset><legend>Datum (X/Y origin)</legend>
      ${p.kind === 'annular' ? `<div class="datum-pick ann">
          <button class="btn sm${!p.datumEnd ? ' on' : ''}" data-act="datum-set" data-key="${key}" data-c="start">Start seam · X clockwise</button>
          <button class="btn sm${p.datumEnd ? ' on' : ''}" data-act="datum-set" data-key="${key}" data-c="end">End seam · X counter-clockwise</button></div>`
        : `<div class="datum-pick">${['TL', 'TR', 'BL', 'BR'].map((c) => `<button class="btn sm${p.datum.c === c ? ' on' : ''}" data-act="datum-set" data-key="${key}" data-c="${c}">${refCornerName(c)}</button>`).join('')}</div>`}
      <p class="small">Current: <b>${h(datumName(p))}</b>${p.datum?.own || p.datumOwn ? '' : ' <span class="muted">(job default)</span>'}</p>
      <div class="acts">${p.datum?.own || p.datumOwn ? `<button class="btn sm ghost" data-act="datum-set" data-key="${key}" data-c="default">Use job default</button>` : ''}</div>
    </fieldset>
    <h3>Indications on this plate</h3>
    <div class="ind-list">${inds.map((i) => `<button class="ind-row" data-act="sel-ind" data-id="${i.id}"><span class="dot r-${i.result || 'pending'}"></span><b>${h(i.no)}</b><span>X ${fmt(i.x, 'small', S.job)}</span><span>Y ${fmt(i.y, 'small', S.job)}</span></button>`).join('') || '<p class="muted small">None.</p>'}</div>
    <p class="muted small">${p.kind === 'annular' ? 'Annular X is measured along the shell from the datum seam; Y is measured in from the shell.' : 'X is horizontal and Y vertical on the drawing, measured from the datum corner.'}</p></div>`;
}

/* ------------------------------------------------------- indications view */

function filteredInds() {
  const q = S.search.trim().toLowerCase();
  let list = S.job.indications.filter((i) => (S.resFilter === 'all' || (i.result || 'pending') === S.resFilter || (S.resFilter === 'repair' && S.calc.per.get(i.id)?.repair)));
  if (q) list = list.filter((i) => { const a = S.calc.per.get(i.id); return [i.no, a?.plate?.label, i.comments, i.vtCond, RESULTS[i.result || 'pending']].join(' ').toLowerCase().includes(q); });
  const k = S.sort.key, d = S.sort.dir;
  const val = (i) => { const a = S.calc.per.get(i.id) || {}; return { no: i.no, plate: a.plate?.label, mfl: i.mflPct, res: i.result, ut: i.utMin, vt: i.vtDepth, rem: a.rem, loss: a.lossPct, proj: a.projected, st: a.status }[k]; };
  return list.sort((a, b) => { const va = val(a), vb = val(b); if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1; return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })) * d; });
}

function viewInds() {
  const th = (k, label, cls = '') => `<th class="sortable ${cls}${S.sort.key === k ? ' sorted' : ''}" data-act="sort" data-k="${k}">${label}${S.sort.key === k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const U = u(S.job);
  return `<div class="page wide">
    <div class="page-head"><div><h1>Indications</h1><p class="muted">MFL calls with UT and VT prove-up. Click a row to edit. Thickness in ${U.small}.</p></div>
      <div class="acts"><button class="btn primary" data-act="ind-new">New indication</button><button class="btn" data-act="exp-ind">Export CSV</button><button class="btn" data-act="utl-down" title="Excel sheet for the UT technician">UT loader ↓</button><button class="btn" data-act="utl-up" title="Upload the completed UT loader sheet">UT loader ↑</button></div></div>
    <div class="toolbar"><input type="search" placeholder="Search no., plate, remarks…" value="${h(S.search)}" data-act="search" class="search">
      <select data-act="resfilter">${[['all', 'All results'], ...RESULT_OPTS, ['repair', 'Repairs only']].map(([k, v]) => `<option value="${k}" ${S.resFilter === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <span class="muted small" id="indCount"></span></div>
    <div class="card flush"><table class="grid inds"><thead><tr>${th('no', 'No.')}${th('plate', 'Plate')}<th class="n">X</th><th class="n">Y</th>${th('mfl', 'MFL %', 'n')}${th('res', 'Result')}${th('ut', 'UT min', 'n')}${th('vt', 'VT pit', 'n')}${th('rem', 'Remaining', 'n')}${th('loss', 'Loss %', 'n')}${th('proj', 't at Oᵣ', 'n')}${th('st', 'Status')}<th>Remarks</th></tr></thead><tbody id="indBody"></tbody></table></div>
  </div>`;
}
after.inds = () => refreshIndTable();
function refreshIndTable() {
  const body = $('#indBody'); if (!body) return;
  const list = filteredInds();
  body.innerHTML = list.map((i) => {
    const a = S.calc.per.get(i.id) || {};
    return `<tr data-act="open-ind" data-id="${i.id}" class="${a.repair ? 'is-rep' : ''}${a.status === 'below MRT' ? ' is-bad' : ''}">
      <td><b>${h(i.no)}</b>${a.critical ? ' <span class="chip cz">CZ</span>' : ''}</td><td>${a.plate ? h(a.plate.label) : '<span class="bad">?</span>'}</td>
      <td class="n">${fmt(i.x, 'small', S.job, false)}</td><td class="n">${fmt(i.y, 'small', S.job, false)}</td><td class="n">${i.mflPct ?? '—'}</td>
      <td><span class="chip r-${i.result || 'pending'}">${RESULT_SHORT[i.result || 'pending']}</span></td>
      <td class="n">${fmt(i.utMin, 't', S.job, false)}</td><td class="n">${fmt(i.vtDepth, 't', S.job, false)}</td>
      <td class="n">${fmt(a.rem, 't', S.job, false)}${a.src && a.src !== 'UT' ? `<sup title="${h(a.src)}">${a.src === 'MFL estimate' ? 'M' : 'V'}</sup>` : ''}</td>
      <td class="n">${a.lossPct != null ? a.lossPct.toFixed(0) : '—'}</td><td class="n">${fmt(a.projected, 't', S.job, false)}</td>
      <td><span class="st st-${(a.status || '').replace(/\W+/g, '-')}">${h(a.status === 'n/a' ? '' : a.status)}</span></td><td class="rem">${h([i.vtCond, i.comments].filter(Boolean).join('; '))}</td></tr>`;
  }).join('') || '<tr><td colspan="13" class="empty">No indications match.</td></tr>';
  const c = $('#indCount'); if (c) c.textContent = `${list.length} of ${S.job.indications.length}`;
}

function openIndDialog(id) {
  const ind = S.job.indications.find((i) => i.id === id); if (!ind) return;
  S.sel = id;
  const dlg = $('#dlg');
  $('#dlgBody').innerHTML = indEditor(ind, 'dialog');
  if (!dlg.open) dlg.showModal();
}

/* ------------------------------------------------------------ plates view */

function viewPlates() {
  return `<div class="page wide">
    <div class="page-head"><div><h1>Plates</h1><p class="muted">Override labels, nominal thickness and MFL scan coverage for individual plates.</p></div>
      <div class="acts"><button class="btn" data-act="scan-all" data-v="scanned">Mark all scanned</button><button class="btn" data-act="exp-plates">Export CSV</button></div></div>
    <div class="toolbar"><input type="search" placeholder="Filter plates…" value="${h(S.plateSearch)}" data-act="plate-search" class="search"></div>
    <div class="card flush"><table class="grid plates"><thead><tr><th>Plate</th><th>Type</th><th class="n">Drawn (${u(S.job).big})</th><th>Length (${u(S.job).big})</th><th>Width (${u(S.job).big})</th><th>Orientation</th><th>Label override</th><th>Nominal t (${u(S.job).small})</th><th>UT min (${u(S.job).small})</th><th>MFL scan</th><th>Datum</th><th class="n">Ind.</th><th>Notes</th></tr></thead><tbody id="plateBody"></tbody></table></div></div>`;
}
after.plates = () => refreshPlateTable();
function refreshPlateTable() {
  const body = $('#plateBody'); if (!body) return;
  const q = S.plateSearch.trim().toLowerCase();
  const counts = new Map(); for (const i of S.job.indications) counts.set(i.plate, (counts.get(i.plate) || 0) + 1);
  body.innerHTML = S.layout.plates.filter((p) => !q || p.label.toLowerCase().includes(q)).map((p) => {
    const o = S.job.plates[p.key] || {};
    const nom = p.kind === 'annular' ? S.job.tank.tAnnular ?? S.job.tank.tBottom : S.job.tank.tBottom;
    const k = `data-key="${p.key}"`;
    return `<tr><td><b>${h(p.label)}</b></td><td>${p.kind === 'annular' ? 'Annular' : (p.cut ? 'Cut' : 'Full') + (p.resized ? ' · measured' : '')}</td>
      <td class="n">${fmt(p.bb.x1 - p.bb.x0, 'big', S.job, false)} × ${fmt(p.bb.y1 - p.bb.y0, 'big', S.job, false)}</td>
      ${p.kind === 'annular' ? '<td></td><td></td><td></td>' : `<td><input class="num" data-pb="len" data-kind="big" ${k} inputmode="decimal" value="${h(inVal(o.len, 'big', S.job))}" placeholder="${h(inVal(p.std.len, 'big', S.job))}"></td>
      <td><input class="num" data-pb="wid" data-kind="big" ${k} inputmode="decimal" value="${h(inVal(o.wid, 'big', S.job))}" placeholder="${h(inVal(p.std.wid, 'big', S.job))}"></td>
      <td><select data-pb="orient" data-kind="text" ${k}>${[['', 'Standard'], ['h', 'Horizontal'], ['v', 'Vertical']].map(([v, l]) => `<option value="${v}" ${(o.orient || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>`}
      <td><input data-pb="label" data-kind="text" ${k} value="${h(o.label ?? '')}" placeholder="${h(p.autoLabel)}"></td>
      <td><input data-pb="tNom" data-kind="t" ${k} inputmode="decimal" value="${h(inVal(o.tNom, 't', S.job))}" placeholder="${h(inVal(nom, 't', S.job))}"></td>
      <td><input data-pb="utMin" data-kind="t" ${k} inputmode="decimal" value="${h(inVal(o.utMin, 't', S.job))}"></td>
      <td><select data-pb="scan" data-kind="text" ${k}>${[['scanned', 'Scanned'], ['partial', 'Partial'], ['not', 'Not scanned']].map(([v, l]) => `<option value="${v}" ${(o.scan || 'scanned') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td>${datumSelect(p)}</td>
      <td class="n">${counts.get(p.key) || ''}</td><td><input data-pb="notes" data-kind="text" ${k} value="${h(o.notes ?? '')}"></td></tr>`;
  }).join('');
}

function datumSelect(p) {
  const opts = p.kind === 'annular' ? [['start', 'Start seam'], ['end', 'End seam']] : [['TL', 'Top-left'], ['TR', 'Top-right'], ['BL', 'Bottom-left'], ['BR', 'Bottom-right']];
  const cur = p.kind === 'annular' ? (p.datumEnd ? 'end' : 'start') : p.datum.c;
  return `<select data-act="datum-sel" data-key="${p.key}">${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}

/* --------------------------------------------------------------- API view */

function viewApi() {
  const met = S.job.units === 'metric';
  const v = (mm) => (met ? `${mm.toFixed(2)} mm` : `${(mm / 25.4).toFixed(3)} in`);
  const f = (label, key, kind, extra = {}) => field(label, 'calc.' + key, kind, extra);
  return `<div class="page">
  <div class="page-head"><div><h1>API 653 bottom evaluation</h1><p class="muted">Minimum remaining thickness at the next internal inspection (API 653, 5th ed. Addendum 4 (2025), §4.4.5). Check the limits against the edition in force and the tank's design.</p></div></div>
  ${findingsBox('floor')}
  <div class="api-grid">
    <section class="card"><h2>Inputs</h2><div class="fgrid">
      ${f('Oᵣ — years to next internal inspection', 'Or', 'num', { unit: 'yr', hint: `§6.4.2.2.1: at most ${S.job.tank.rpb ? 30 : 20} years${S.job.tank.rpb ? ' (with RPB)' : ' (30 with an RPB)'}` })}
      ${f('Tank age (years) — UPᵣ basis', 'years', 'num', { unit: 'yr', hint: 'API 653 §4.4.5.1: UPᵣ is a linear rate over the age of the tank' })}
      ${f('StPᵣ basis (optional)', 'stprYears', 'num', { unit: 'yr', ph: 'tank age', hint: 'e.g. years since the coating or the last inspection' })}
      ${f('MFL threshold', 'mflThresholdPct', 'num', { unit: '% of nominal', hint: 'API 653 §4.4.5.1 Note 1: UPᵣ uses the lesser of the threshold and the thinnest unrepaired area' })}
      ${f('Min. remaining — bottom plates', 'mrtBottom', 't')}
      ${f('Min. remaining — annular plates', 'mrtAnnular', 't', { ph: S.calc?.ann?.tbl != null ? inVal(S.calc.ann.tbl, 't', S.job) : '', hint: 'Blank = Table 4.5 / API 650 Table 5.1 value + CA (§4.4.6)' })}
      ${f('Annular corrosion allowance', 'annCA', 't', { hint: 'Added to the table value (§4.4.6.2)' })}<div></div>
      ${(() => { const a = annularReq(S.job); if (!a) return '<p class="muted small span2">Annular plate minimum (API 653 Table 4.5 / API 650 Table 5.1b): enter the shell courses (course 1 nominal t), the maximum fill height and the product SG to calculate it.</p>'; return `<p class="small span2 ann-req">${h(a.table)}: S<sub>b</sub> = ${Math.round(a.Sb).toLocaleString()} psi with course 1 t = ${fmt(+S.job.shell.courses[0].tNom, 't', S.job)} → minimum annular plate <b>${a.over ? 'beyond the table — engineering evaluation' : fmt(a.tmm, 't', S.job)}</b> ${!a.over ? `<button class="btn sm" data-act="ann-apply" data-v="${a.tmm}">Use for annular plates</button>` : ''}<br><span class="muted">${(S.job.tank.sg ?? 1) >= 1 ? 'SG ≥ 1: S<sub>b</sub> = 2.6 D (H − 1) G / t' : 'SG &lt; 1: S<sub>b</sub> = 2.34 D (H − 1) / t'}, interpolated between stress columns.</span></p>`; })()}
      <div class="span2 presets"><span class="muted small">Bottom limit presets:</span>
        <button class="btn sm" data-act="mrt-preset" data-v="2.54">${v(2.54)} — no leak detection / containment</button>
        <button class="btn sm" data-act="mrt-preset" data-v="1.27">${v(1.27)} — with leak detection &amp; containment</button>
        <button class="btn sm" data-act="mrt-preset" data-v="1.27">${v(1.27)} — reinforced lining &gt; 0.05 in</button></div>
      <h3 class="span2" style="margin:8px 0 0">Repair patch plates</h3>
      ${f('Auto patch repair indications', 'autoPatch', 'bool', { value: S.job.calc.autoPatch !== false, cls: 'span2' })}
      ${f('Default patch length', 'patchL', 'small', { ph: met ? '300' : '12' })}${f('Default patch width', 'patchW', 'small', { ph: met ? '300' : '12' })}
      ${f('Extend past the corrosion by at least', 'patchMargin', 'small', { hint: 'API 653 §9.11.1.1 c: 2 in' })}${f('Patch plate thickness', 'patchT', 't', { hint: 'Critical zone: 1/4 in max.' })}<p class="muted small" id="patchSum">${(() => { const pl = patchList(S.job, S.layout, S.calc); return pl.length ? `${pl.length} patch${pl.length > 1 ? 'es' : ''}: ${pl.map((p) => `${p.id} ${fmt(p.L, 'small', S.job, false)} × ${fmt(p.W, 'small', S.job)}${p.kind === 'tomb' ? ' tombstone' : ''}${p.status !== 'OK' ? ' (' + p.status.toLowerCase() + ')' : ''}`).join(', ')}` : 'No patches.'; })()}</p>
      ${f('Critical zone width (from shell)', 'czDist', 'small')}
      ${f('Critical zone limit', 'czLimit', 't', { ph: inVal(czLimitAuto(S.job), 't', S.job), hint: `Blank = §4.4.5.4: the smaller of ${met ? '3 mm' : '0.118 in'} and ½ course 1 t-min, not less than ${met ? '2.5 mm' : '0.10 in'}` })}
      ${f('Reason for an entered critical zone limit', 'czLimitReason', 'text', { ph: 'e.g. isolated pitting, Table 4.4' })}
      ${f('Lower shell course t-min', 'shellTmin', 't', { hint: 'Optional, for the critical zone limit' })}
      ${field('Shell toughness (critical-zone patch spacing)', 'tank.shellTough', 'sel', { options: [['', 'Unknown — §9.11.1.2 g applies'], ['known', 'Known (meets API 650 toughness)']] })}
      ${field('Bottom projection beyond the shell — thickness at the outside weld toe', 'tank.projT', 't', { hint: 'API 653 §4.4.5.7: at least 0.10 in (2.5 mm)' })}
      ${field('Bottom projection beyond the shell — width', 'tank.projW', 'small', { hint: 'API 653 §4.4.5.7: at least 3/8 in (10 mm)' })}
      ${f('Product side coated, coating life ≥ Oᵣ (StPᵣ = 0)', 'coated', 'bool', { cls: 'span2' })}
      ${f('Coating basis confirmed by the engineer despite recorded product-side pitting', 'coatConfirmed', 'bool', { cls: 'span2' })}
      ${f('Effective cathodic protection (UPᵣ = 0)', 'cp', 'bool', { cls: 'span2' })}
      ${f('Oᵣ set by an RBI assessment (§6.4.2.2.2)', 'rbi', 'bool', { cls: 'span2' })}
      ${f('Include pending MFL calls using the MFL % estimate (as soil side)', 'includeUnverified', 'bool', { cls: 'span2' })}
      ${field('StPᵣ override', 'calc.stprOverride', 't', { unit: u(S.job).rateUnit, ph: 'calculated' })}
      ${field('UPᵣ override', 'calc.uprOverride', 't', { unit: u(S.job).rateUnit, ph: 'calculated' })}
    </div></section>
    <section class="card" id="apiResults"></section>
  </div></div>`;
}
after.api = () => refreshApi();
function refreshApi() {
  const el = $('#apiResults'); if (!el) return;
  const ps = $('#patchSum'); if (ps) { const pl = patchList(S.job, S.layout, S.calc); ps.textContent = pl.length ? `${pl.length} patch${pl.length > 1 ? 'es' : ''}: ${pl.map((p) => `${p.id} ${fmt(p.L, 'small', S.job, false)} × ${fmt(p.W, 'small', S.job)}${p.kind === 'tomb' ? ' tombstone' : ''}${p.status !== 'OK' ? ' (' + p.status.toLowerCase() + ')' : ''}`).join(', ')}` : 'No patches.'; }
  const c = S.calc, t = (mm) => fmt(mm, 't', S.job), tn = (mm) => fmt(mm, 't', S.job, false);
  const reps = S.job.indications.filter((i) => c.per.get(i.id)?.repair || c.per.get(i.id)?.status === 'below MRT').sort(byNo);
  el.innerHTML = `<h2>Results</h2>
    <p class="formula">MRT = min(RT<sub>bc</sub>, RT<sub>ip</sub>) − O<sub>r</sub>(StP<sub>r</sub> + UP<sub>r</sub>)</p>
    <div class="rates"><div><span>StP<sub>r</sub> product side</span><b>${fmtRate(c.StPr, S.job)}</b><small>${c.stSrc === 'override' ? 'entered' : c.C.coated && !c.stSrc ? 'coated → 0' : c.stSrc ? 'from ' + h(c.stSrc.no) + (c.stYears !== c.years ? ` over ${c.stYears} yr` : '') : 'no product side loss'}</small></div>
      <div><span>UP<sub>r</sub> soil side</span><b>${fmtRate(c.UPr, S.job)}</b><small>${c.C.cp ? 'effective CP → 0' : c.upSrc === 'override' ? 'entered' : c.upSrc === 'threshold' ? `MFL threshold ${c.C.mflThresholdPct} %` : c.upSrc ? 'from ' + h(c.upSrc.no) : 'no soil side loss'}</small></div>
      <div><span>Loss over O<sub>r</sub></span><b>${t(c.Or * c.K)}</b><small>${c.Or} yr × combined rate</small></div></div>
    <table class="grid"><thead><tr><th>Area (${u(S.job).small})</th><th class="n">RT<sub>ip</sub></th><th class="n">RT<sub>bc</sub></th><th class="n">MRT</th><th class="n">Min.</th><th class="n">Max. O<sub>r</sub></th><th></th></tr></thead><tbody>
    ${c.regions.map((r) => `<tr><td>${h(r.label)}</td><td class="n">${tn(r.RTip)}</td><td class="n">${tn(r.RTbc)}</td><td class="n"><b>${tn(r.MRT)}</b></td><td class="n">${tn(r.limit)}</td><td class="n">${r.OrMax == null ? '—' : Number.isFinite(r.OrMax) ? Math.max(0, r.OrMax).toFixed(1) + ' yr' : '∞'}</td><td class="${r.ok ? 'ok' : r.ok === false ? 'bad' : ''}">${r.notEvaluated ? 'Not evaluated' : r.ok == null ? '—' : r.ok ? (r.provisional ? `✓ Provisional (${r.provisional} on MFL estimates)` : '✓ OK') : '✕ Fails'}</td></tr>`).join('')}
    </tbody></table>
    <p class="muted small">Limits: bottom ${t(c.mBot)}${S.layout.Ri < S.layout.R ? ` · annular ${t(c.mAnn)} (${h(c.ann.src)})` : ''} · critical zone ${t(c.czLim)} (${c.C.czLimit != null ? 'entered' + (c.C.czLimitReason ? ': ' + h(c.C.czLimitReason) : '') : '§4.4.5.4'})${c.projection ? ` · bottom projection ${c.projection.ok === true ? '✓' : c.projection.ok === false ? '✕' : '?'} (§4.4.5.7)` : ''}</p>
    <p class="muted small">Any unrepaired location thinner than <b>${t(c.regions[0]?.tReq)}</b> today (bottom plates) will be below the minimum after ${c.Or} years at the current rates. Locations set to Repair "Auto" are marked for repair worst-first until the rest pass; rates are then re-derived from what is left unrepaired.</p>
    ${c.warnings.length ? `<ul class="warn">${c.warnings.map((w) => `<li>${h(w)}</li>`).join('')}</ul>` : ''}
    <h3>Repairs (${reps.length})</h3>
    <div class="ind-list">${reps.map((i) => { const a = c.per.get(i.id); return `<button class="ind-row" data-act="open-ind" data-id="${i.id}"><span class="dot r-${i.result}"></span><b>${h(i.no)}</b><span>${h(a.plate?.label)}</span><span class="n">${t(a.rem)}</span><span class="st st-${a.status.replace(/\W+/g, '-')}">${h(statusText(a))}</span></button>`; }).join('') || '<p class="muted small">No repairs required.</p>'}</div>`;
}

/* ------------------------------------------------------------- shell UT view */

function viewShell() {
  return `<div class="page wide shell-page"><div class="page-head"><div><h1>Shell UT</h1><p class="muted">Shell course thickness readings at standard UT stations around the circumference, with a shell roll-out showing the station lines.</p></div>
    <div class="acts"><button class="btn" data-act="utl-down" title="Excel sheet for the UT technician">UT loader ↓</button><button class="btn" data-act="utl-up" title="Upload the completed UT loader sheet">UT loader ↑</button><button class="btn" data-act="exp-shell">Export CSV</button><button class="btn" data-act="exp-shell-svg">Roll-out (SVG)</button></div></div>
    <div id="shellBody">${shellBodyHTML()}</div></div>`;
}

function shellBodyHTML() {
  const job = S.job, sh = job.shell || defaultShell(job.units), U = u(job);
  const courses = coursesWithElev(job), locs = utLocations(job), sum = courseSummary(job);
  const D = +job.tank?.diameter || 0, C = Math.PI * D, auto = autoLocCount(job), H = shellHeight(job);
  const top = courses.slice().reverse();
  const cin = (c, k, kind, ph = '', cls = '') => { const raw = k === 'tMin' ? c.tMinSet : c[k]; if (k === 'tMin' && !ph && c.tMinCalc) ph = inVal(c.tMinCalc, 't', job); return `<input data-shc="${k}" data-course="${c.id}" data-kind="${kind}" inputmode="decimal" value="${h(kind === 'num' ? raw ?? '' : inVal(raw, kind, job))}" placeholder="${h(ph)}" class="${cls}" ${k === 'tMin' && c.tMinCalc && !c.tMinSet ? 'title="Calculated: API 653 §4.3.3.1 a) — type a value to override"' : ''}>`; };
  const st = (s) => (s.status ? `<span class="st ${s.status === 'OK' ? 'st-OK' : 'st-below-MRT'}">${s.status}</span>` : '');
  const sm = new Map(sum.map((x) => [x.id, x]));
  const zs = readingElevations(job);
  const autoN = autoPlateCount(job);

  // readings grid: elevation rows bottom → top, grouped by course
  let grid = '';
  if (courses.length && zs.length) {
    let cur = null;
    const rows = [];
    for (const z of zs) {
      const c = courseAt(courses, z);
      if (c && c.id !== cur) {
        cur = c.id; const s = sm.get(c.id);
        rows.push(`<tr class="crow"><td colspan="${locs.length + 2}"><b>Course ${c.no}</b> <span class="muted small">${fmtElev(c.z0, job)} – ${fmtElev(c.z1, job)} · nominal ${fmt(c.tNom, 't', job)} · t-min ${fmt(c.tMin, 't', job)} · min reading <b>${s.min != null ? fmt(s.min, 't', job) : '—'}</b></span> ${st(s)}</td></tr>`);
      }
      const vals = locs.map((l) => getReading(job, l.key, z)).filter((v) => v !== null);
      const rmin = vals.length ? Math.min(...vals) : null;
      const extra = (sh.extraZ || []).some((e) => zKey(e) === zKey(z));
      rows.push(`<tr><td class="el">${fmtElev(z, job)}${extra ? ` <button aria-label="Remove this extra elevation" class="x" data-act="z-del" data-z="${zKey(z)}" title="Remove this extra elevation">✕</button>` : ''}</td>${locs.map((l) => { const v = getReading(job, l.key, z); const bad = v != null && c?.tMin > 0 && v < c.tMin - 1e-9; return `<td class="${bad ? 'bad-cell' : ''}"><input data-shut="${l.key}" data-z="${zKey(z)}" data-kind="t" ${bad ? 'aria-invalid="true" title="Below t-min" ' : ''}inputmode="decimal" value="${h(inVal(v, 't', job))}"></td>`; }).join('')}<td class="n">${rmin != null ? fmt(rmin, 't', job, false) : ''}</td></tr>`);
    }
    grid = rows.join('');
  }

  return `<div class="shell-grid">
    <section class="card"><div class="sp-head"><h2>Shell courses &amp; plates</h2><span class="muted small">${courses.length} course${courses.length === 1 ? '' : 's'} · ${fmt(H, 'big', job)} high</span></div>
      <div class="tblwrap"><table class="grid courses"><thead><tr><th>Course</th><th>Height (${U.big})</th><th>Nominal t (${U.small})</th><th>t-min (${U.small})</th><th title="Number of shell plates in the course">Plates</th><th title="Angle of the first vertical seam">1st seam (°)</th><th title="Optional: plate length; the last plate is the closure plate">Plate length (${U.big})</th><th class="n">Min. reading</th><th>Status</th><th></th></tr></thead><tbody>
      ${top.map((c, k) => { const s = sm.get(c.id); const cp = coursePlates(job, c, c.no - 1); return `<tr class="${s.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${c.no}</b>${c.no === 1 ? ' <span class="muted small">bottom</span>' : ''}</td><td>${cin(c, 'h', 'big')}</td><td>${cin(c, 'tNom', 't')}</td><td>${cin(c, 'tMin', 't')}</td><td>${cin(c, 'pn', 'num', String(c.plen ? cp.n : autoN), 'xs')}</td><td>${cin(c, 'seam0', 'num', (Math.round(cp.seam0 * 10) / 10).toString(), 'xs')}</td><td>${cin(c, 'plen', 'big', fmt(cp.plates[0]?.len, 'big', job, false))}</td><td class="n">${s.min != null ? fmt(s.min, 't', job, false) : '—'}<small class="muted"> ${s.count}</small></td><td>${st(s)}</td><td><button aria-label="Delete course" class="btn sm icon ghost danger" data-act="course-del" data-course="${c.id}" title="Delete course">✕</button></td></tr>`; }).join('') || `<tr><td colspan="10" class="empty">No courses yet. Add them from the bottom course up, or start with <button class="btn sm" data-act="courses-std" data-n="5">5 courses</button> <button class="btn sm" data-act="courses-std" data-n="6">6 courses</button> <button class="btn sm" data-act="courses-std" data-n="8">8 courses</button></td></tr>`}
      </tbody></table></div>
      <div class="acts"><button class="btn sm" data-act="course-add">+ Course on top</button></div>
      <p class="muted small">Course 1 is the bottom course. Plates: give the number of plates (equal lengths), or a plate length (full plates from the first seam, the last one is the closure plate). Blank first seam staggers alternate courses by half a plate. t-min is calculated to API 653 §4.3.3.1 a) (grey) once the product SG is entered — see the shell evaluation below; type a value to override it.</p></section>

    <div class="shell-side">
    <section class="card"><h2>UT stations</h2>
      <p class="small">${D > 0 ? `Circumference ${fmt(C, 'big', job)} ÷ ${fmt(SPACING_MM, 'big', job)} = ${(C / SPACING_MM).toFixed(1)} → standard <b>${auto}</b> stations (minimum 4, maximum 8, one per 32 ft of circumference), equally spaced.` : 'Enter the tank diameter in Tank setup.'}</p>
      <div class="fgrid">${field('Number of stations', 'shell.nLoc', 'num', { ph: `${auto} (standard)`, hint: 'Leave blank for the standard count' })}${field('First station at', 'shell.start', 'num', { unit: '°', ph: '0' })}</div>
      <div class="loc-list">${locs.map((l) => `<span class="loc-chip"><b>${l.label}</b> ${l.angle.toFixed(1)}° <small>${fmt(l.arc, 'big', job)}</small></span>`).join('')}</div></section>

    <section class="card"><div class="sp-head"><h2>Reading elevations</h2><span class="muted small">${zs.length} per station · ${zs.length * locs.length} readings</span></div>
      <p class="muted small">Readings are taken at each station at these elevations above the bottom. Each zone gives a reading every <i>step</i> from <i>start</i> to <i>end</i> (blank end = top of the shell). Values in ${U.small}.</p>
      <table class="grid zones"><thead><tr><th>From</th><th>To</th><th>Every</th><th class="n">Readings</th><th></th></tr></thead><tbody>
      ${(sh.zones || []).map((zn) => `<tr><td><input data-zf="start" data-zone="${zn.id}" data-kind="small" inputmode="decimal" value="${h(inVal(zn.start, 'small', job))}"></td><td><input data-zf="end" data-zone="${zn.id}" data-kind="small" inputmode="decimal" value="${h(inVal(zn.end, 'small', job))}" placeholder="top"></td><td><input data-zf="step" data-zone="${zn.id}" data-kind="small" inputmode="decimal" value="${h(inVal(zn.step, 'small', job))}"></td><td class="n">${zoneCount(job, zn)}<br><small class="muted">${fmtElev(+zn.start || 0, job)}${zn.end != null ? ' – ' + fmtElev(+zn.end, job) : ' – top'}</small></td><td><button aria-label="Remove zone" class="btn sm icon ghost danger" data-act="zone-del" data-zone="${zn.id}" title="Remove zone">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No zones.</td></tr>'}
      </tbody></table>
      <div class="acts"><button class="btn sm" data-act="zone-add">+ Zone</button><button class="btn sm" data-act="zones-std">Standard: every 1 in to 2 ft, then every 1 ft</button></div>
      <div class="acts extra-z"><label class="fld inline"><span class="lbl">Add one elevation</span><span class="ctl"><input id="extraZ" data-kind="small" inputmode="decimal" placeholder="${U.small}"><i class="unit">${U.small}</i></span></label><button class="btn sm" data-act="z-add">Add</button></div></section>
    </div>
  </div>

  ${courses.length ? `<section class="card"><div class="sp-head"><h2>UT readings</h2><span class="muted small">thickness in ${U.small} · Tab moves across, Enter moves up the station</span></div>
    <div class="tblwrap rd-wrap"><table class="grid readings"><thead><tr><th>Elevation</th>${locs.map((l) => `<th class="n">${l.label}<br><small>${l.angle.toFixed(1)}°</small></th>`).join('')}<th class="n">Row min</th></tr></thead><tbody>${grid || `<tr><td colspan="${locs.length + 2}" class="empty">Set up reading elevations to start.</td></tr>`}</tbody></table></div></section>` : ''}

  ${shellEvalHTML()}

  <section class="card"><div class="sp-head"><h2>Shell roll-out</h2><span class="muted small">plates, UT stations, dimensions and nozzles</span></div>
    <div class="ro-wrap" id="roWrap">${rolloutSVG(job)}</div></section>`;
}

/** API 653 4.3.3 shell evaluation card: material, joint efficiency, allowable stresses, t-min, fill and hydrotest heights. */
function shellEvalHTML() {
  const job = S.job, U = u(job), met = job.units === 'metric', B = designBasis(job), sh = job.shell || {};
  const courses = coursesWithElev(job); if (!courses.length) return '';
  const sm = new Map(courseSummary(job).map((x) => [x.id, x]));
  const jo = jointOptions(job.tank.code, job.tank.edition), dj = defaultJoint(job);
  const ps = (psi) => (psi == null ? '—' : met ? (psi / PSI_MPA).toFixed(0) : Math.round(psi).toLocaleString());
  const su = met ? 'MPa' : 'psi';
  const matSel = (val, attrs, blank) => `<select ${attrs} data-kind="text">${blank ? `<option value="">${blank}</option>` : ''}${MATERIALS.map((m) => `<option ${val === m[0] ? 'selected' : ''}>${h(m[0])}</option>`).join('')}</select>`;
  const jSel = (val, attrs, blank) => `<select ${attrs} data-kind="text">${blank ? `<option value="">${blank}</option>` : ''}${jo.options.map(([k, l]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>`;
  const sIn = (c, k, val) => `<input data-shs="${k}" data-course="${c.id}" inputmode="decimal" class="xs" value="${c[k] != null ? (met ? +(c[k] / PSI_MPA).toFixed(1) : c[k]) : ''}" placeholder="${ps(val)}">`;
  let prodMin = null, hydMin = null;
  const rows = courses.slice().reverse().map((c) => {
    const d = c.d, s = sm.get(c.id), f = s.min != null ? fillFromT(job, d, s.min) : { prod: null, hydro: null };
    if (f.prod != null && (prodMin === null || f.prod < prodMin.v)) prodMin = { v: f.prod, c: c.no };
    if (f.hydro != null && (hydMin === null || f.hydro < hydMin.v)) hydMin = { v: f.hydro, c: c.no };
    return `<tr class="${s.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${c.no}</b></td><td>${matSel(c.matl || '', `data-shc="matl" data-course="${c.id}"`, 'Same as all')}</td>
      <td>${jSel(c.joint || '', `data-shc="joint" data-course="${c.id}"`, 'Same as all')}</td><td class="n">${d.Ej}</td>
      <td>${sIn(c, 'Y', d.Y)}</td><td>${sIn(c, 'T', d.T)}</td><td class="n">${ps(d.Sd)}</td><td class="n">${ps(d.St)}</td>
      <td class="n">${fmt(Math.max(0, B.fill - c.z0), 'big', job, false)}</td><td class="n">${c.tMinCalc ? fmt(c.tMinCalc, 't', job, false) : '—'}</td><td class="n"><b>${c.tMin ? fmt(c.tMin, 't', job, false) : '—'}</b>${c.tMinSet ? '<sup title="Entered">E</sup>' : ''}</td>
      <td class="n">${s.min != null ? fmt(s.min, 't', job, false) : '—'}</td><td>${s.status ? `<span class="st ${s.status === 'OK' ? 'st-OK' : 'st-below-MRT'}">${s.status}</span>` : ''}</td>
      <td class="n">${f.prod != null ? fmt(f.prod, 'big', job, false) : '—'}</td><td class="n">${f.hydro != null ? fmt(f.hydro, 'big', job, false) : '—'}</td></tr>`;
  }).join('');
  return `<section class="card shell-eval"><div class="sp-head"><h2>Shell evaluation — API 653 4.3.3</h2><span class="muted small">${h(job.tank.code || 'Code not set')}${job.tank.edition ? ', ' + h(job.tank.edition) : ''} · G ${B.G ?? '—'} · fill ${fmt(B.fill, 'big', job)} · D ${fmt(B.D, 'big', job)}</span></div>
    ${!(B.G > 0) ? '<p class="callout warn">Enter the product specific gravity (and the maximum fill height if it is not the full shell height) in Tank setup → Construction &amp; design to calculate t-min.</p>' : ''}
    <div class="fgrid g4">
      <label class="fld"><span class="lbl">Shell material (all courses)</span><span class="ctl">${matSel(sh.matl || '', 'data-bind="shell.matl"', 'Unknown (30,000 / 55,000 psi)')}</span></label>
      <label class="fld span2"><span class="lbl">Joint (all courses) — ${h(jo.group)}</span><span class="ctl">${jSel(sh.joint || '', 'data-bind="shell.joint"', `Default: ${jointLabel(dj)}`)}</span></label>
      ${field('Product SG', 'tank.sg', 'num')}
    </div>
    <div class="tblwrap"><table class="grid seval"><thead><tr><th>Course</th><th>Material</th><th>Joint</th><th class="n">E</th><th>Y (${su})</th><th>T (${su})</th><th class="n">Sd (${su})</th><th class="n">St (${su})</th><th class="n">Liquid above course (${U.big})</th><th class="n">t-min calc</th><th class="n">t-min used</th><th class="n">Min. reading</th><th>Status</th><th class="n" title="Product fill height this course's minimum reading supports">Max fill (${U.big})</th><th class="n" title="API 653 4.3.3.2 hydrostatic test height from this course's minimum reading">Hydrotest Ht (${U.big})</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="small">${prodMin ? `Maximum product fill height from the minimum readings: <b>${fmt(prodMin.v, 'big', job)}</b> (course ${prodMin.c})` : ''}${hydMin ? ` · hydrostatic test height: <b>${fmt(hydMin.v, 'big', job)}</b> (course ${hydMin.c})` : ''}${prodMin && prodMin.v < B.fill - 1 ? ` · <b class="bad">below the maximum fill height ${fmt(B.fill, 'big', job)}</b>` : ''}</p>
    <p class="muted small">t-min = 2.6 (H − 1) D G / (S E), not less than 0.100 in (SI: 4.9 D (H − 0.3) G / (S E), not less than 2.5 mm) (API 653 §4.3.3.1 a). Single readings are compared with the t-min at their elevation (§4.3.3.1 b) and evaluated per §4.3.2 when below it. S = product design stress from Table 4.1 — lower two courses use the smaller of 0.80Y / 0.429T, upper courses 0.88Y / 0.472T; riveted 21,000 psi. E from Table 4.2 (welded, by code and edition) or Table 4.3 (riveted). Hydrotest Ht = St E t / (2.6 D) + 1 (4.3.3.2). Fill and test heights use each course's minimum reading and are measured from the tank bottom. Y / T: type to override the table. Stresses in ${su}.</p>
  </section>`;
}


/** Tank setup: shell courses as designed — height, thickness, plates per course and seam offset from the datum. */
function shellBuildHTML() {
  const job = S.job, U = u(job), courses = coursesWithElev(job), H = shellHeight(job), Cc = Math.PI * (+job.tank?.diameter || 0), autoN = autoPlateCount(job);
  const inp = (c, k, kind, ph = '', cls = '') => `<input data-shc="${k}" data-course="${c.id}" data-kind="${kind}" inputmode="decimal" value="${h(kind === 'num' ? c[k] ?? '' : inVal(c[k], kind, job))}" placeholder="${h(ph)}" class="${cls}">`;
  const rows = courses.slice().reverse().map((c) => {
    const cp = coursePlates(job, c, c.no - 1), set = c.seam0 !== null && c.seam0 !== undefined && c.seam0 !== '';
    const arcV = set && Cc > 0 ? inVal((+c.seam0 / 360) * Cc, 'big', job) : '';
    const arcPh = Cc > 0 ? inVal((cp.seam0 / 360) * Cc, 'big', job) : '';
    const closure = cp.plates.find((p) => p.closure);
    return `<tr><td><b>${c.no}</b>${c.no === 1 ? ' <span class="muted small">bottom</span>' : ''}</td><td>${inp(c, 'h', 'big')}</td><td>${inp(c, 'tNom', 't')}</td>
      <td>${inp(c, 'pn', 'num', String(c.plen ? cp.n : autoN), 'xs')}</td>
      <td><input data-shc="seam0arc" data-course="${c.id}" data-kind="big" inputmode="decimal" value="${h(arcV)}" placeholder="${h(arcPh)}" ${Cc > 0 ? '' : 'disabled title="Enter the tank diameter first"'}></td>
      <td>${inp(c, 'seam0', 'num', (Math.round(cp.seam0 * 10) / 10).toString(), 'xs')}</td>
      <td>${inp(c, 'plen', 'big', cp.plates[0] ? inVal(cp.plates[0].len, 'big', job) : '')}</td>
      <td class="small muted">${cp.n ? `${cp.n} × ${fmt(cp.plates[0]?.len, 'big', job)}${closure ? `<br>closure ${fmt(closure.len, 'big', job)}` : ''}` : '—'}</td>
      <td><button aria-label="Delete course" class="btn sm icon ghost danger" data-act="course-del" data-course="${c.id}" title="Delete course">✕</button></td></tr>`;
  }).join('');
  return `<div class="sp-head"><h2>Shell</h2><span class="muted small">${courses.length} course${courses.length === 1 ? '' : 's'}${H > 0 ? ' · ' + fmt(H, 'big', job) + ' high' : ''}${Cc > 0 ? ' · circumference ' + fmt(Cc, 'big', job) : ''}</span></div>
    <p class="muted small">Build the shell from the bottom course up. For each course give the height, nominal thickness and the plates — either the <b>number of plates</b> (equal lengths) or a <b>plate length</b> (full plates from the first seam; the last is the closure plate). Locate the <b>first vertical seam</b> by its distance around the shell or its angle, clockwise from the 0° datum (${h(job.info.zeroRef || 'set the 0° reference label above')}). Blank = alternate courses staggered by half a plate. Grey values are what will be used.</p>
    <div class="tblwrap"><table class="grid courses build"><thead><tr><th>Course</th><th>Height (${U.big})</th><th>Nominal t (${U.small})</th><th>Plates</th><th title="Distance around the shell from the datum to the first vertical seam, clockwise">1st seam from datum (${U.big})</th><th>1st seam (°)</th><th>Plate length (${U.big})</th><th>Plates in course</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="9" class="empty">No courses yet. Start with <button class="btn sm" data-act="courses-std" data-n="5">5 courses</button> <button class="btn sm" data-act="courses-std" data-n="6">6 courses</button> <button class="btn sm" data-act="courses-std" data-n="8">8 courses</button> or add them one at a time.</td></tr>`}</tbody></table></div>
    <div class="acts"><button class="btn sm" data-act="course-add">+ Course on top</button>${courses.length ? `<span class="spacer"></span><button class="btn sm ghost" data-act="courses-fill" title="Copy the bottom course's number of plates and plate length to empty courses above">Copy course 1 plates up</button>` : ''}</div>
    ${courses.length ? `<div class="sp-head sp-ro"><h3>Shell roll-out</h3><span class="muted small">viewed from outside, clockwise from the 0° datum · plates, seams and nozzles</span></div><div id="spRoll" class="ro-wrap">${rolloutSVG(job)}</div>
    <p class="muted small">Materials, joint efficiency and t-min are set on the Shell page.</p>` : ''}`;
}

/** Re-render a block, keeping keyboard focus on the same input. */
function rerenderKeep(c, html) {
  const a = document.activeElement, key = a && c.contains(a) ? focusSel(a) : null;
  c.innerHTML = html;
  if (key) { const n = c.querySelector(key); if (n) { n.focus(); try { n.select(); } catch { /* */ } } }
}
function refreshShell() {
  setTimeout(() => {
    const sb = $('#shellBuild'); if (sb) { rerenderKeep(sb, shellBuildHTML()); refreshSetupPreview(); }
    const c = $('#shellBody'); if (!c) return;
    const a = document.activeElement, key = a && c.contains(a) ? focusSel(a) : null, typed = a && a.value !== undefined && a.value !== a.defaultValue ? a.value : null;
    c.innerHTML = shellBodyHTML();
    if (key) { const n = c.querySelector(key); if (n && typed !== null && n.value !== typed) { n.value = typed; n.dataset.restored = '1'; } if (n) { n.focus(); try { if (typed === null) n.select(); else n.setSelectionRange(n.value.length, n.value.length); } catch { /* */ } } }
  }, 0);
}


/* ------------------------------------------------------------ tank sections */

function crumbHTML(pl) {
  const sec = SEC.get(pl.sec), ch = CHILDREN.find(([c]) => c === pl.child)?.[1];
  const tabs = pl.child === 'nde' ? `<div class="sec-tabs">${[['nde:' + pl.sec, 'NDE scope'], ...sec.nde].map(([v, l]) => `<button class="sec-tab${S.view === v ? ' on' : ''}" data-go="${v}">${l}</button>`).join('')}</div>` : '';
  return `<div class="crumb${pl.child === 'nde' && S.view === 'map' ? ' over-map' : ''}"><span>${h(sec.label)}</span><b>›</b><span>${ch}</span>${tabs}</div>`;
}
const secData = (k) => (S.job.secs[k] = S.job.secs[k] || { nde: [], obs: [], recs: [] });
const secPhotos = (k) => S.photos.filter((p) => p.sec === k).sort((a, b) => (a.n || 0) - (b.n || 0) || a.created - b.created);
const photoNo = (p) => `${(SEC.get(p.sec)?.label || '').replace(/\s.*/, '').slice(0, 2).toUpperCase()}-${p.n || '?'}`;
const condChip = (c) => (c ? `<span class="cond c-${c}">${(CONDITIONS.find(([k]) => k === c) || [])[1]}</span>` : '');

function sxIn(kind, sec, it, f, type = 'text', extra = '') {
  const v = it[f] ?? '';
  if (type === 'area') return `<textarea data-sx="${kind}" data-sec="${sec}" data-iid="${it.id}" data-f="${f}" rows="2" ${extra}>${h(v)}</textarea>`;
  return `<input data-sx="${kind}" data-sec="${sec}" data-iid="${it.id}" data-f="${f}" ${type === 'date' ? 'type="date"' : ''} value="${h(v)}" ${extra}>`;
}
function sxSel(kind, sec, it, f, opts) {
  return `<select data-sx="${kind}" data-sec="${sec}" data-iid="${it.id}" data-f="${f}">${opts.map((o) => { const [k, l] = Array.isArray(o) ? o : [o, o || '—']; return `<option value="${h(k)}" ${String(it[f] ?? '') === String(k) ? 'selected' : ''}>${h(l)}</option>`; }).join('')}</select>`;
}
function secHead(sec, title, sub, acts = '') {
  return `<div class="page-head"><div><h1>${h(SEC.get(sec).label)} — ${title}</h1><p class="muted">${sub}</p></div><div class="acts">${acts}</div></div>`;
}

/* NDE scope */
function viewNDE() {
  const k = viewPlace(S.view).sec, sec = SEC.get(k), d = secData(k), F = findings(S.job, S.layout, S.calc)[k];
  const rows = d.nde.map((it) => `<tr><td>${sxSel('nde', k, it, 'method', NDE_METHODS)}</td><td>${sxIn('nde', k, it, 'extent', 'text', 'placeholder="Extent / coverage"')}</td><td>${sxIn('nde', k, it, 'proc', 'text', 'placeholder="Procedure / technique"')}</td><td>${sxIn('nde', k, it, 'tech', 'text', 'placeholder="Technician, level"')}</td><td>${sxIn('nde', k, it, 'date', 'date')}</td><td>${eqPicker(k, it)}</td><td>${sxSel('nde', k, it, 'result', NDE_RESULTS)}</td><td>${sxIn('nde', k, it, 'notes', 'text', 'placeholder="Results / notes"')}</td><td><button aria-label="Remove" class="btn sm icon ghost danger" data-act="sx-del" data-kind="nde" data-sec="${k}" data-iid="${it.id}" title="Remove">✕</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">No NDE methods set up yet.</td></tr>';
  return `<div class="page wide">${secHead(k, 'NDE', 'Set up the NDE methods for this part of the tank and record their results. Enter the readings on the data pages (tabs above).')}
    <section class="card"><div class="sp-head"><h2>NDE methods and results</h2><span class="muted small">${d.nde.length} method${d.nde.length === 1 ? '' : 's'}</span></div>
      <div class="tblwrap"><table class="grid sxt nde-t"><thead><tr><th>Method</th><th>Extent / coverage</th><th>Procedure / technique</th><th>Technician</th><th>Date</th><th>Equipment</th><th>Result</th><th>Notes</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="acts row-acts"><button class="btn sm" data-act="sx-add" data-kind="nde" data-sec="${k}">+ Method</button><button class="btn sm" data-act="sx-typ" data-kind="nde" data-sec="${k}">Add typical methods</button></div></section>
    ${sec.nde.length ? `<section class="card"><h2>Data entry</h2><div class="nde-links">${sec.nde.map(([v, l]) => `<button class="btn" data-go="${v}">${l} →</button>`).join('')}</div>
      ${F.lines.length ? `<h3>Results so far</h3><ul class="flist">${F.lines.map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p class="muted small">No results entered yet.</p>'}</section>` : `<section class="card"><p class="muted">No instrument data pages for this section — record the inspection under NDE methods, Observations and Photos.</p></section>`}
  </div>`;
}


/* ---------------------------------------------------------------- equipment */
// One list per job. NDE methods (per section) pick the items they used; the report pulls the details.

function eqChips(it) {
  const by = new Map((S.job.equipment || []).map((e) => [e.id, e]));
  const sel = (it.equip || []).map((id) => by.get(id)).filter(Boolean);
  const d = S.job.info.inspDate;
  return sel.length ? sel.map((e) => `<span class="eq-chip ${calState(e, d)}" title="${h(EQ_LABEL[e.type] + ' — ' + equipLine(e))}">${h(equipName(e))}${e.serial ? `<small> ${h(e.serial)}</small>` : ''}</span>`).join('') : '<span class="muted">Select…</span>';
}
function eqPicker(sec, it) {
  const list = S.job.equipment || [], have = new Set(it.equip || []);
  const groups = EQ_TYPES.filter(([t]) => list.some((e) => e.type === t));
  return `<details class="eqpick" data-iid="${it.id}"><summary>${eqChips(it)}</summary><div class="eqpop">
    ${list.length ? groups.map(([t, l]) => `<div class="eq-grp">${h(l)}</div>${list.filter((e) => e.type === t).map((e) => `<label class="chk"><input type="checkbox" data-eqpick="${e.id}" data-sec="${sec}" data-iid="${it.id}" ${have.has(e.id) ? 'checked' : ''}><span>${h(equipName(e))}${e.serial ? ` <small class="muted">S/N ${h(e.serial)}</small>` : ''}${calState(e, S.job.info.inspDate) === 'expired' ? ' <small class="bad">cal. expired</small>' : ''}</span></label>`).join('')}`).join('')
      : '<p class="muted small">No equipment listed for this job yet.</p>'}
    <div class="eq-pop-foot"><button class="btn sm ghost" data-go="equip">Edit equipment list →</button></div></div></details>`;
}

function viewEquip() {
  const j = S.job, list = j.equipment || [], use = equipUse(j, SECTIONS, inScope), d = j.info.inspDate;
  const typeSel = (e) => `<select data-eq="type" data-id="${e.id}">${EQ_TYPES.map(([k, l]) => `<option value="${k}" ${e.type === k ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>`;
  const inp = (e, f, ph = '', type = 'text', cls = '') => `<input data-eq="${f}" data-id="${e.id}" ${type === 'date' ? 'type="date"' : ''} value="${h(e[f] ?? '')}" placeholder="${h(ph)}" class="${cls}">`;
  const cs = (e) => { const c = calState(e, d); return c === 'expired' ? '<span class="st st-below-MRT">Expired</span>' : c === 'soon' ? '<span class="st st-warn">Due ≤ 30 days</span>' : ''; };
  const rows = list.map((e) => `<tr class="${calState(e, d) === 'expired' ? 'is-bad' : ''}">
      <td>${typeSel(e)}</td><td>${inp(e, 'make', 'Make')}</td><td>${inp(e, 'model', 'Model / description')}</td><td>${inp(e, 'serial', 'Serial / ID', 'text', 'sn')}</td>
      <td>${inp(e, 'calDate', '', 'date')}</td><td>${inp(e, 'calDue', '', 'date')}${cs(e)}</td>
      <td>${inp(e, 'details', EQ_DETAIL_PH[e.type] || 'Settings / details')}${e.type === 'mfl' ? `<label class="eq-thr">Reporting threshold ${inp(e, 'threshold', '%', 'text', 'xs')} %</label>` : ''}</td>
      <td class="small eq-use">${useByMethod(use.get(e.id)).map((u) => `<div>${h(u)}</div>`).join('') || '<span class="muted">Not picked yet</span>'}</td>
      <td><button aria-label="Duplicate (e.g. a second probe)" class="btn sm icon ghost" data-act="eq-dup" data-id="${e.id}" title="Duplicate (e.g. a second probe)">⧉</button><button aria-label="Remove" class="btn sm icon ghost danger" data-act="eq-del" data-id="${e.id}" title="Remove">✕</button></td></tr>`).join('');
  const others = S.jobs.filter((x) => x.id !== j.id && (x.equipment || []).length);
  const unassigned = list.filter((e) => !use.has(e.id)).length;
  return `<div class="page wide eq-page"><div class="page-head"><div><h1>Equipment</h1><p class="muted">List every instrument, probe, block and tool on this job once. Under each section's <b>NDE</b> page, pick the items each method used — the report lists the equipment with serials and calibration, and shows it against each method.</p></div>
    <div class="acts">${others.length ? `<select id="eqCopyFrom"><option value="">Copy from another job…</option>${others.map((x) => `<option value="${x.id}">${h([x.info?.tankId, x.info?.reportNo, x.info?.inspDate].filter(Boolean).join(' · ') || 'Job')} (${x.equipment.length})</option>`).join('')}</select>` : ''}</div></div>
    <section class="card"><div class="sp-head"><h2>Equipment list</h2><span class="muted small">${list.length} item${list.length === 1 ? '' : 's'}${unassigned && list.length ? ` · ${unassigned} not picked under any NDE method` : ''}</span></div>
      <div class="tblwrap"><table class="grid eq-t"><thead><tr><th>Type</th><th>Make</th><th>Model / description</th><th>Serial no.</th><th>Calibrated</th><th>Cal. due</th><th>Settings / details</th><th>Used for</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" class="empty">No equipment yet — add it with the buttons below.</td></tr>'}</tbody></table></div>
      <div class="eq-add"><span class="muted small">Add:</span>${EQ_TYPES.filter(([k]) => k !== 'other').slice(0, 10).map(([k, l]) => `<button class="btn sm" data-act="eq-add" data-type="${k}">+ ${h(l.replace(/ \\(.*\\)$/, ''))}</button>`).join('')}<button class="btn sm" data-act="eq-add" data-type="other">+ Other</button></div>
    </section>
    <section class="card"><h2>Picked by section</h2>
      ${SECTIONS.filter((s) => inScope(j, s.key)).map((s) => { const nde = secData(s.key).nde; return `<div class="eq-sec"><b>${h(s.label)}</b> ${nde.length ? nde.map((n) => `<span class="eq-m">${h(n.method)}: ${(n.equip || []).length ? (n.equip || []).map((id) => list.find((e) => e.id === id)).filter(Boolean).map((e) => h(equipName(e))).join(', ') : '<span class="muted">none picked</span>'}</span>`).join('') : '<span class="muted small">no NDE methods yet</span>'} <button class="btn sm ghost" data-go="nde:${s.key}">NDE →</button></div>`; }).join('')}
      <p class="muted small">When you choose a method on an NDE page, matching equipment from this list is picked automatically (e.g. MFL floor scan → MFL scanner and reference plate; UT thickness → gauge, probe and block). Adjust it there.</p></section>
  </div>`;
}

/* Observations */
function viewObs() {
  const k = viewPlace(S.view).sec, d = secData(k), ph = secPhotos(k);
  const rows = d.obs.map((o, i) => { const lp = ph.filter((p) => p.obs === o.id); return `<div class="obs-row c-${o.cond || 'x'}"><div class="obs-no">${i + 1}</div>
    <div class="obs-main"><div class="obs-top">${sxIn('obs', k, o, 'item', 'text', 'class="obs-item" placeholder="Item / component"')}${sxIn('obs', k, o, 'loc', 'text', 'placeholder="Location"')}${sxSel('obs', k, o, 'cond', CONDITIONS)}<button aria-label="Remove" class="btn sm icon ghost danger" data-act="sx-del" data-kind="obs" data-sec="${k}" data-iid="${o.id}" title="Remove">✕</button></div>
    ${sxIn('obs', k, o, 'text', 'area', 'placeholder="Observation"')}
    ${lp.length ? `<div class="obs-ph">${lp.map((p) => `<button class="thumb" data-act="ph-open" data-id="${p.id}" title="${h(p.caption || photoNo(p))}">${photoFig(p, true)}<span>${photoNo(p)}</span></button>`).join('')}</div>` : ''}
    <div class="obs-acts"><button class="linkbtn" data-act="obs-rec" data-sec="${k}" data-iid="${o.id}">→ Make a recommendation</button></div></div></div>`; }).join('') || '<p class="muted">No observations yet. Add your own, or start from the typical items for this part of the tank.</p>';
  return `<div class="page">${secHead(k, 'Observations', 'Record what you saw. Rate each item; items rated poor are flagged on the Analysis and Recommendations pages. Link photos from the Photos page.')}
    <section class="card">${rows}<div class="acts row-acts"><button class="btn sm" data-act="sx-add" data-kind="obs" data-sec="${k}">+ Observation</button><button class="btn sm" data-act="sx-typ" data-kind="obs" data-sec="${k}">Add typical items</button></div></section></div>`;
}

/* Photos */
function annoSVG(p, cls = 'anno') {
  const W = 1000, H = Math.round(1000 * ((p.h || 3) / (p.w || 4)));
  const sw = 6, out = [`<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah-${p.id}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5 0 10z" fill="context-stroke"/></marker></defs>`];
  for (const a of p.anno || []) {
    const c = a.c || '#ff2d2d';
    if (a.t === 'arrow') out.push(`<line x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" marker-end="url(#ah-${p.id})"/>`);
    else if (a.t === 'ell') out.push(`<ellipse cx="${a.x}" cy="${a.y}" rx="${Math.abs(a.rx)}" ry="${Math.abs(a.ry)}" fill="none" stroke="${c}" stroke-width="${sw}"/>`);
    else if (a.t === 'rect') out.push(`<rect x="${Math.min(a.x, a.x + a.w)}" y="${Math.min(a.y, a.y + a.h)}" width="${Math.abs(a.w)}" height="${Math.abs(a.h)}" fill="none" stroke="${c}" stroke-width="${sw}"/>`);
    else if (a.t === 'pen') out.push(`<polyline points="${a.pts.map((q) => q.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`);
    else if (a.t === 'text') out.push(`<text x="${a.x}" y="${a.y}" font-size="${a.s || 44}" font-family="system-ui,Arial,sans-serif" font-weight="700" fill="${c}" stroke="#000" stroke-width="1.5" paint-order="stroke">${h(a.txt)}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}
function photoFig(p, small = false) { return `<span class="phfig${small ? ' sm' : ''}"><img src="${p.dataUrl}" alt="">${(p.anno || []).length ? annoSVG(p) : ''}</span>`; }

function viewPhotos() {
  const k = viewPlace(S.view).sec, d = secData(k), ph = secPhotos(k);
  const cards = ph.map((p) => `<figure class="phcard">
      <button class="phbtn" data-act="ph-anno" data-id="${p.id}" title="Annotate">${photoFig(p)}</button>
      <div class="phmeta"><b>${photoNo(p)}</b><input data-ph="${p.id}" data-f="caption" value="${h(p.caption || '')}" placeholder="Caption">
        <textarea data-ph="${p.id}" data-f="comment" rows="2" placeholder="Comment">${h(p.comment || '')}</textarea>
        <label class="small muted">Observation <select data-ph="${p.id}" data-f="obs"><option value="">—</option>${d.obs.map((o, i) => `<option value="${o.id}" ${p.obs === o.id ? 'selected' : ''}>${i + 1}. ${h(o.item || 'Observation')}</option>`).join('')}</select></label>
        <label class="chk small"><input type="checkbox" data-ph="${p.id}" data-f="inReport" ${p.inReport !== false ? 'checked' : ''}><span>In report</span></label>
        <div class="acts"><button class="btn sm" data-act="ph-anno" data-id="${p.id}">Annotate</button><button class="btn sm ghost danger" data-act="ph-del" data-id="${p.id}">Delete</button></div></div></figure>`).join('');
  return `<div class="page wide">${secHead(k, 'Photos', 'Add photos, caption and comment them, and mark them up with arrows, circles, boxes and text. Photos are numbered in the order added.',
    `<label class="btn primary">+ Add photos<input type="file" accept="image/*" multiple data-act="ph-add" data-sec="${k}" hidden></label>`)}
    ${cards ? `<div class="phgrid">${cards}</div>` : '<section class="card"><p class="muted">No photos yet. Use “Add photos” — on a tablet or phone this opens the camera.</p></section>'}</div>`;
}

/* photo annotation editor */
const ANNO_COLORS = ['#ff2d2d', '#ffd400', '#22c55e', '#1f6feb', '#ffffff', '#111111'];
function openAnno(id) {
  const p = S.photos.find((x) => x.id === id); if (!p) return;
  const st = { tool: 'arrow', c: ANNO_COLORS[0], anno: JSON.parse(JSON.stringify(p.anno || [])), draft: null };
  const dlg = $('#dlg'), W = 1000, H = Math.round(1000 * ((p.h || 3) / (p.w || 4)));
  const paint = () => {
    const tmp = { ...p, anno: st.draft ? [...st.anno, st.draft] : st.anno };
    $('#annoLayer').innerHTML = annoSVG(tmp, 'anno edit');
    $$('#annoTools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === st.tool));
    $$('#annoTools [data-col]').forEach((b) => b.classList.toggle('on', b.dataset.col === st.c));
  };
  $('#dlgBody').innerHTML = `<div class="anno-dlg"><div class="ed-head"><h2>Annotate ${photoNo(p)}</h2><button aria-label="Close" class="btn sm ghost" data-anno="close">✕</button></div>
    <div class="anno-tools" id="annoTools">${[['arrow', '↗ Arrow'], ['ell', '◯ Circle'], ['rect', '▭ Box'], ['pen', '✎ Pen'], ['text', 'T Text']].map(([t, l]) => `<button class="btn sm" data-tool="${t}">${l}</button>`).join('')}
      <span class="spacer"></span>${ANNO_COLORS.map((c) => `<button class="swatch" data-col="${c}" style="background:${c}" title="${c}"></button>`).join('')}
      <span class="spacer"></span><button class="btn sm" data-anno="undo">Undo</button><button class="btn sm" data-anno="clear">Clear</button></div>
    <div class="anno-stage"><img src="${p.dataUrl}" alt=""><div id="annoLayer"></div></div>
    <div class="ed-foot"><span class="muted small">Drag on the photo to draw. Text: click where the label goes.</span><span><button class="btn" data-anno="close">Cancel</button> <button class="btn primary" data-anno="save">Save</button></span></div></div>`;
  dlg.classList.add('wide-dlg'); if (!dlg.open) dlg.showModal();
  paint();
  const layer = $('#annoLayer');
  const pt = (e) => { const r = layer.getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)]; };
  layer.onpointerdown = (e) => {
    const [x, y] = pt(e);
    if (st.tool === 'text') { askText('Label text').then((txt) => { if (txt) { st.anno.push({ t: 'text', x, y, txt, c: st.c, s: 44 }); paint(); } }); return; }
    layer.setPointerCapture(e.pointerId);
    st.draft = st.tool === 'arrow' ? { t: 'arrow', x1: x, y1: y, x2: x, y2: y, c: st.c } : st.tool === 'ell' ? { t: 'ell', x, y, rx: 0, ry: 0, c: st.c, x0: x, y0: y } : st.tool === 'rect' ? { t: 'rect', x, y, w: 0, h: 0, c: st.c } : { t: 'pen', pts: [[x, y]], c: st.c };
    paint();
  };
  layer.onpointermove = (e) => {
    const d = st.draft; if (!d) return; const [x, y] = pt(e);
    if (d.t === 'arrow') { d.x2 = x; d.y2 = y; } else if (d.t === 'ell') { d.x = (d.x0 + x) / 2; d.y = (d.y0 + y) / 2; d.rx = (x - d.x0) / 2; d.ry = (y - d.y0) / 2; } else if (d.t === 'rect') { d.w = x - d.x; d.h = y - d.y; } else d.pts.push([x, y]);
    paint();
  };
  layer.onpointerup = () => {
    const d = st.draft; st.draft = null; if (!d) return;
    const tiny = d.t === 'arrow' ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 8 : d.t === 'ell' ? Math.abs(d.rx) + Math.abs(d.ry) < 6 : d.t === 'rect' ? Math.abs(d.w) + Math.abs(d.h) < 8 : d.pts.length < 2;
    if (!tiny) { if (d.t === 'ell') { delete d.x0; delete d.y0; d.x = Math.round(d.x); d.y = Math.round(d.y); d.rx = Math.round(d.rx); d.ry = Math.round(d.ry); } st.anno.push(d); }
    paint();
  };
  $('#annoTools').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.tool) st.tool = b.dataset.tool; if (b.dataset.col) st.c = b.dataset.col; if (b.dataset.anno === 'undo') st.anno.pop(); if (b.dataset.anno === 'clear') st.anno = []; paint(); };
  $('#dlgBody').querySelectorAll('[data-anno="close"]').forEach((b) => (b.onclick = () => { dlg.close(); dlg.classList.remove('wide-dlg'); }));
  $('#dlgBody').querySelector('[data-anno="save"]').onclick = async () => { p.anno = st.anno; await db.putPhoto(p); dlg.close(); dlg.classList.remove('wide-dlg'); renderView(); toast('Annotations saved.'); };
}
function askText(label) {
  return new Promise((resolve) => {
    const d = $('#confirmDlg');
    d.innerHTML = `<form method="dialog" class="cf"><p>${h(label)}</p><input id="askTxt" autocomplete="off"><div class="acts"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok">OK</button></div></form>`;
    d.showModal(); setTimeout(() => $('#askTxt')?.focus(), 30);
    d.onclose = () => resolve(d.returnValue === 'ok' ? $('#askTxt')?.value.trim() : null);
  });
}
async function imgDims(dataUrl) { return new Promise((res) => { const im = new Image(); im.onload = () => res([im.naturalWidth, im.naturalHeight]); im.onerror = () => res([4, 3]); im.src = dataUrl; }); }

/* Analysis */
function findingsBox(k) {
  const F = findings(S.job, S.layout, S.calc)[k];
  return `<section class="card"><div class="sp-head"><h2>Findings</h2><span class="sres-chip s-${F.status}">${STATUS_TEXT[F.status]}</span></div>
    ${F.lines.length ? `<ul class="flist">${F.lines.map((x) => `<li>${x}</li>`).join('')}</ul>` : '<p class="muted small">No results yet.</p>'}
    ${F.items.length ? `<h3>Items needing action</h3><ul class="flist bad">${F.items.map((it) => `<li><b>${PRIORITY_LABEL[it.priority] || ''}</b> — ${h(it.finding)}</li>`).join('')}</ul><div class="acts"><button class="btn sm" data-go="recs:${k}">Go to recommendations →</button></div>` : ''}</section>`;
}
function viewAnalysis() {
  const k = viewPlace(S.view).sec;
  let body = '';
  if (k === 'shell') body = shellEvalHTML() || '<section class="card"><p class="muted">Add the shell courses on the Shell UT page.</p></section>';
  else if (k === 'froof' || k === 'flroof') body = roofAnalysisHTML(k);
  else if (k === 'nozzles') body = nozzleAnalysisHTML();
  else if (k === 'settle') body = `<section class="card"><p class="muted small">The full calculations, charts and tables are on the <button class="linkbtn" data-go="settle">Settlement survey</button> page.</p></section>`;
  else if (k === 'found') body = `<section class="card"><h2>Foundation condition</h2>${(() => { const obs = secData('found').obs; return obs.length ? `<table class="grid small"><thead><tr><th>Item</th><th>Location</th><th>Condition</th><th>Observation</th></tr></thead><tbody>${obs.map((o) => `<tr><td>${h(o.item)}</td><td>${h(o.loc)}</td><td>${condChip(o.cond)}</td><td>${h(o.text)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No foundation observations yet.</p>'; })()}<p class="muted small">Foundation evaluation per API 653 4.5 (and Annex B for settlement). There are no thickness calculations for the foundation.</p></section>`;
  return `<div class="page wide">${secHead(k, 'Analysis', 'Calculated results and the findings that need action.')}${findingsBox(k)}${body}</div>`;
}
after['sec:an'] = () => {};
function roofAnalysisHTML(k) {
  const job = S.job;
  if (k === 'froof') {
    if (!hasFixed(job)) return '<section class="card"><p class="muted">No fixed roof.</p></section>';
    const pts = (job.roof.fixed.pts || []).map((p) => ({ p, s: pointStatus(job, p) }));
    return `<section class="card"><h2>Fixed roof readings</h2><table class="grid small"><thead><tr><th>Point</th><th class="n">Angle</th><th class="n">Reading</th><th class="n">Loss</th><th>Status</th></tr></thead><tbody>${pts.map(({ p, s }) => `<tr class="${s.status === 'Below t-min' ? 'is-bad' : ''}"><td>${h(p.label)}</td><td class="n">${p.angle ?? '—'}°</td><td class="n">${fmt(s.t, 't', job)}</td><td class="n">${s.lossPct != null ? s.lossPct.toFixed(0) + '%' : '—'}</td><td>${rStatus(s.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No readings.</td></tr>'}</tbody></table><p class="muted small">t-min ${fmt(job.roof.fixed.tMin, 't', job)} (API 653 §4.2.1.2). ${h(ROOF_NOTE)}</p></section>`;
  }
  if (!hasFloating(job)) return '<section class="card"><p class="muted">No floating roof.</p></section>';
  const res = activeStds(job.roof.seal).map((sk) => { const ev = sealEval(job, sk); return `<tr class="${ev.overall === 'Not compliant' ? 'is-bad' : ''}"><td>${h(ev.L.name)}</td><td><b>${ev.overall}</b></td><td class="small">${ev.fails ? h(ev.repair) : ''}</td></tr>`; }).join('');
  const lay = floatingLayout(job), deck = lay.plates.filter((p) => p.kind !== 'annular').map((p) => ({ p, s: plateUT(job, p) })).filter((x) => x.s.min != null).sort((a, b) => a.s.min - b.s.min).slice(0, 10);
  return `<section class="card"><h2>Rim seal compliance</h2><table class="grid small"><tbody>${res || '<tr><td class="empty">No standard selected.</td></tr>'}</tbody></table><p class="muted small">Details on the <button class="linkbtn" data-go="seal">Rim seal</button> page.</p></section>
    <section class="card"><h2>Thinnest deck plates</h2><table class="grid small"><thead><tr><th>Plate</th><th class="n">Min.</th><th class="n">Loss</th><th>Status</th></tr></thead><tbody>${deck.map(({ p, s }) => `<tr class="${s.status === 'Below t-min' ? 'is-bad' : ''}"><td>${h(p.label)}</td><td class="n">${fmt(s.min, 't', job)}</td><td class="n">${s.lossPct != null ? s.lossPct.toFixed(0) + '%' : '—'}</td><td>${rStatus(s.status)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No readings.</td></tr>'}</tbody></table></section>`;
}
function nozzleAnalysisHTML() {
  const job = S.job, list = (job.nozzles || []).slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0));
  return `<section class="card"><h2>Nozzle neck evaluation</h2><table class="grid small"><thead><tr><th>Mark</th><th>Type</th><th class="n">Size</th><th class="n">Nominal</th><th class="n">t-min</th><th class="n">Min. reading</th><th class="n">Loss</th><th>Status</th></tr></thead><tbody>
    ${list.map((n) => { const r = nozzleUT(n, job), w = nozzleWall(n, job); return `<tr class="${r.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${h(n.mark)}</b></td><td>${h(n.type)}</td><td class="n">${fmt(n.size, 'small', job)}</td><td class="n">${fmt(w.tNom, 't', job, false)}${w.nomTbl ? '<sup>T</sup>' : ''}</td><td class="n">${fmt(w.tMin, 't', job, false)}${w.minTbl ? '<sup>T</sup>' : ''}</td><td class="n">${r.count ? fmt(r.min, 't', job, false) : '—'}</td><td class="n">${r.lossPct != null ? r.lossPct.toFixed(0) + '%' : '—'}</td><td>${rStatus(r.status)}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">No nozzles.</td></tr>'}
    </tbody></table><p class="muted small"><sup>T</sup> from the nozzle neck table for the construction code (Code tables).</p></section>`;
}

/* Recommendations */
function viewRecs() {
  const k = viewPlace(S.view).sec, d = secData(k), F = findings(S.job, S.layout, S.calc)[k], ph = secPhotos(k);
  const used = new Set(d.recs.map((r) => r.auto).filter(Boolean));
  const sugg = F.items.filter((it) => !used.has(it.key));
  const rows = d.recs.map((r) => `<div class="rec-row p-${r.priority}${r.status === 'Closed' ? ' closed' : ''}">
    <div class="rec-top"><b class="rec-no">${r.def ? h(r.no || 'D-?') : 'Rec.'}</b>${sxSel('recs', k, r, 'priority', PRIORITIES)}${sxIn('recs', k, r, 'due', 'text', 'placeholder="Due / timing" class="due"')}${sxSel('recs', k, r, 'status', STATUSES)}
      <label class="chk small"><input type="checkbox" data-sx="recs" data-sec="${k}" data-iid="${r.id}" data-f="def" ${r.def ? 'checked' : ''}><span>Deficiency</span></label><button aria-label="Remove" class="btn sm icon ghost danger" data-act="sx-del" data-kind="recs" data-sec="${k}" data-iid="${r.id}" title="Remove">✕</button></div>
    <div class="rec-grid"><label>Finding / deficiency${sxIn('recs', k, r, 'finding', 'area')}</label><label>Recommended action${sxIn('recs', k, r, 'action', 'area')}</label></div>
    <div class="rec-bot">${sxIn('recs', k, r, 'loc', 'text', 'placeholder="Location"')}${sxIn('recs', k, r, 'ref', 'text', 'placeholder="Code reference"')}<select data-sx="recs" data-sec="${k}" data-iid="${r.id}" data-f="photo"><option value="">Photo —</option>${ph.map((p) => `<option value="${p.id}" ${r.photo === p.id ? 'selected' : ''}>${photoNo(p)} ${h(p.caption || '')}</option>`).join('')}</select></div></div>`).join('') || '<p class="muted">No recommendations yet.</p>';
  return `<div class="page wide">${secHead(k, 'Recommendations', 'Recommended repairs and actions. Items ticked as deficiencies get a number (D-001…) and appear in the Deficiencies list and the client deficiency report.')}
    ${sugg.length ? `<section class="card sugg"><div class="sp-head"><h2>Suggested from the analysis</h2><button class="btn sm primary" data-act="rec-all" data-sec="${k}">Add all</button></div>${sugg.map((it) => `<div class="sugg-row"><span class="pchip p-${it.priority}">${it.priority}</span><span>${h(it.finding)}${it.action ? `<br><small class="muted">${h(it.action)}</small>` : ''}</span><button class="btn sm" data-act="rec-from" data-sec="${k}" data-key="${h(it.key)}">Add</button></div>`).join('')}</section>` : ''}
    <section class="card">${rows}<div class="acts row-acts"><button class="btn sm" data-act="sx-add" data-kind="recs" data-sec="${k}">+ Recommendation</button></div></section></div>`;
}

/* Nozzles page */
function viewNozzles() {
  return `<div class="page wide"><div class="page-head"><div><h1>Nozzles</h1><p class="muted">Shell nozzles, connections and neck UT readings. Nozzles also show on the floor map and the shell roll-out.</p></div>
    <div class="acts"><button class="btn" data-act="utl-down">UT loader ↓</button><button class="btn" data-act="utl-up">UT loader ↑</button></div></div>
    <section class="card" id="nozzleCard">${nozzleTableHTML()}</section></div>`;
}

/* ------------------------------------------------------------ executive summary */
const CONDITION_OPTS = ['', 'Fit for continued service', 'Fit for continued service after the listed repairs', 'Not fit for service until repaired', 'Further evaluation required'];
function viewSummary() {
  const job = S.job, F = findings(job, S.layout, S.calc), defs = allDefs(job), open = defs.filter((d) => d.status !== 'Closed');
  const rows = SECTIONS.map((s) => { const f = F[s.key], n = open.filter((d) => d.sec === s.key).length; return `<tr><td><button class="linkbtn" data-go="${childView(s.key, 'an')}">${h(s.label)}</button></td><td><span class="sres-chip s-${f.status}">${STATUS_TEXT[f.status]}</span></td><td class="small">${f.lines.slice(0, 3).join('<br>') || '<span class="muted">—</span>'}</td><td class="n">${n ? `<button class="linkbtn" data-go="defs">${n}</button>` : '—'}</td></tr>`; }).join('');
  const pri = open.filter((d) => ['P1', 'P2'].includes(d.priority));
  return `<div class="page wide"><div class="page-head"><div><h1>Executive summary</h1><p class="muted">The first page of the report: overall condition, scope, summary of findings and priority items. The component table updates from the inspection data.</p></div>
    <div class="acts"><button class="btn" data-go="defs">Deficiencies</button><button class="btn primary" data-go="report">Report</button></div></div>
    <section class="card"><div class="fgrid">
      ${field('Overall condition', 'summary.condition', 'sel', { options: CONDITION_OPTS.map((x) => [x, x || '—']), cls: 'span2' })}
      ${field('Return to service', 'summary.rts', 'text', { ph: 'e.g. after P1 / P2 repairs are complete' })}${field('Next external inspection', 'summary.nextExt', 'text', { ph: 'date or interval' })}
      ${field('Next internal inspection', 'summary.nextInt', 'text', { ph: S.calc?.Or ? `e.g. ${S.calc.Or} years (bottom MRT)` : '' })}${field('Next UT thickness inspection', 'summary.nextUT', 'text')}
    </div></section>
    <section class="card"><div class="sp-head"><h2>Condition by component</h2><span class="muted small">${open.length} open deficienc${open.length === 1 ? 'y' : 'ies'}</span></div>
      <div class="tblwrap"><table class="grid"><thead><tr><th>Component</th><th>Condition</th><th>Key results</th><th class="n">Open deficiencies</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="card"><div class="sp-head"><h2>Scope</h2><button class="btn sm" data-act="sum-draft" data-f="scope">Draft from the NDE set-up</button></div>${field('', 'summary.scope', 'area', { rows: 4, ph: 'What was inspected and how' })}</section>
    <section class="card"><div class="sp-head"><h2>Summary of findings</h2><button class="btn sm" data-act="sum-draft" data-f="narrative">Draft from the findings</button></div>${field('', 'summary.narrative', 'area', { rows: 8, ph: 'Main findings and conclusions' })}</section>
    ${pri.length ? `<section class="card"><h2>Priority items (P1 / P2)</h2><ul class="flist bad">${pri.map((d) => `<li><b>${h(d.no || '')}</b> ${h(d.secLabel)}: ${h(d.finding)}${d.action ? ` — <i>${h(d.action)}</i>` : ''}</li>`).join('')}</ul></section>` : ''}
  </div>`;
}
function draftSummary(f) {
  const job = S.job, I = job.info, F = findings(job, S.layout, S.calc);
  if (f === 'scope') {
    const parts = SECTIONS.map((s) => { const m = secData(s.key).nde; return m.length ? `${s.label}: ${m.map((x) => x.method + (x.extent ? ' (' + x.extent + ')' : '')).join(', ')}.` : ''; }).filter(Boolean);
    return `${job.info.inspDate ? 'On ' + job.info.inspDate + ', ' : ''}an API 653 inspection of tank ${I.tankId || ''}${I.site ? ' at ' + I.site : ''} was carried out.${parts.length ? '\n' + parts.join('\n') : ''}`;
  }
  const defs = allDefs(job).filter((d) => d.status !== 'Closed');
  const lines = SECTIONS.map((s) => { const x = F[s.key]; if (x.status === 'none') return ''; return `${s.label}: ${STATUS_TEXT[x.status].toLowerCase()}. ${x.lines.slice(0, 2).map((l) => l.replace(/<[^>]+>/g, '')).join(' ')}`; }).filter(Boolean);
  return `${lines.join('\n')}${defs.length ? `\n\n${defs.length} deficienc${defs.length === 1 ? 'y is' : 'ies are'} listed in the deficiency report, ${defs.filter((d) => ['P1', 'P2'].includes(d.priority)).length} of them to be completed before return to service.` : ''}`;
}

function viewDefs() {
  const job = S.job; numberDefs(job);
  const f = S.defFilter || 'open';
  let defs = allDefs(job); const all = defs.length;
  if (f === 'open') defs = defs.filter((d) => d.status !== 'Closed'); else if (f === 'closed') defs = defs.filter((d) => d.status === 'Closed');
  const rows = defs.map((d) => `<tr class="p-${d.priority}${d.status === 'Closed' ? ' closed' : ''}"><td><b>${h(d.no || '')}</b></td><td><button class="linkbtn" data-go="recs:${d.sec}">${h(d.secLabel)}</button>${d.loc ? `<br><small class="muted">${h(d.loc)}</small>` : ''}</td><td class="small">${h(d.finding)}</td><td class="small">${h(d.action)}</td>
    <td>${sxSel('recs', d.sec, d, 'priority', PRIORITIES.map(([k]) => [k, k]))}</td><td>${sxIn('recs', d.sec, d, 'due', 'text', 'class="due"')}</td><td>${sxSel('recs', d.sec, d, 'status', STATUSES)}${d.closedOn ? `<br><small class="muted">${h(d.closedOn)}</small>` : ''}</td><td>${sxIn('recs', d.sec, d, 'client', 'text', 'placeholder="Client comment / work order"')}</td>
    <td class="small muted">${d.history?.length ? h(d.history[d.history.length - 1].date) : ''}</td></tr>`).join('') || `<tr><td colspan="9" class="empty">${all ? 'Nothing in this filter.' : 'No deficiencies yet — tick “Deficiency” on a recommendation, or add them from the Recommendations pages.'}</td></tr>`;
  const S2 = job.summary;
  return `<div class="page wide"><div class="page-head"><div><h1>Deficiencies</h1><p class="muted">Every recommendation marked as a deficiency, from all parts of the tank. Update status and client comments here, then issue the deficiency report to the client.</p></div>
    <div class="acts"><button class="btn" data-act="exp-defs">Export CSV</button><button class="btn" data-act="def-issue">Issue update${S2.defRev ? ' ' + (S2.defRev + 1) : ''}</button><button class="btn primary" data-go="defrep">Deficiency report</button></div></div>
    <section class="card"><div class="sp-head"><div class="seg">${[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => `<button class="btn sm${f === k ? ' on' : ''}" data-act="def-filter" data-k="${k}">${l}</button>`).join('')}</div><span class="muted small">${all} total · last issued ${h(S2.issued || '—')}${S2.defRev ? ' (update ' + S2.defRev + ')' : ''}</span></div>
      <div class="tblwrap"><table class="grid deflog"><thead><tr><th>No.</th><th>Component</th><th>Deficiency</th><th>Recommended action</th><th>Priority</th><th>Due</th><th>Status</th><th>Client comment</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table></div></section></div>`;
}
function viewDefRep() {
  return `<div class="report-tools no-print"><div><h1>Deficiency report</h1><p class="muted small">For updating the client. Print or save as PDF.</p></div><div class="acts"><button class="btn" data-go="defs">← Deficiencies</button><button class="btn primary" data-act="print">Print / Save PDF</button></div></div>
    <div class="report-preview" id="defRoot"></div>`;
}
after.defrep = () => { numberDefs(S.job); $('#defRoot').innerHTML = buildDefReport(S.job, S.company, S.photos); };


/* --------------------------------------------------------------- events --- */

/* Button actions (data-act), registered with the action registry (js/app/actions.js). */
const _phanno = async (el, id, e, act) => {
  openAnno(id); return;
};
const _recfrom = async (el, id, e, act) => {
  {
    const k = el.dataset.sec, F = findings(S.job, S.layout, S.calc)[k], d = secData(k), used = new Set(d.recs.map((r) => r.auto));
    const items = F.items.filter((it) => !used.has(it.key) && (act === 'rec-all' || it.key === el.dataset.key));
    for (const it of items) d.recs.push(newRec({ finding: it.finding.replace(/<[^>]+>/g, ''), loc: it.loc, action: it.action, priority: it.priority, ref: it.ref, auto: it.key, def: it.priority !== 'P5' }));
    numberDefs(S.job); commit(); renderView(); renderNav(); return;
  }
};
onAction({
  'job-new': async (el, id, e, act) => {
    { const j = newJob(); return createJob(j); }
  },
  'reg-new': async (el, id, e, act) => {
    { const t = await addTank(); return openTankEdit(t.id); }
  },
  'reg-edit': async (el, id, e, act) => {
    return openTankEdit(id);
  },
  'reg-done': async (el, id, e, act) => {
    { if (!(await leaveJobOk())) return; S.job = null; S.photos = []; recompute(); go('reg'); return; }
  },
  'reg-insp': async (el, id, e, act) => {
    return newInspectionDlg(id);
  },
  'reg-toggle': async (el, id, e, act) => {
    { S.reg.open.has(id) ? S.reg.open.delete(id) : S.reg.open.add(id); renderView(); return; }
  },
  'reg-build': async (el, id, e, act) => {
    return buildRegistry();
  },
  'reg-dup': async (el, id, e, act) => {
    {
      const t = await db.getTank(id); if (!t) return;
      const c = { ...JSON.parse(JSON.stringify(t)), id: uid(), created: Date.now(), updated: Date.now() };
      c.info.tankId = (c.info.tankId || 'Tank') + ' (copy)'; await db.putTank(c); await loadTanks(); return openTankEdit(c.id);
    }
  },
  'reg-del': async (el, id, e, act) => {
    {
      const t = S.tanks.find((x) => x.id === id), n = tankInspections(id).length;
      if (!(await askConfirm(`Delete ${t?.info?.tankId || 'this tank'} from the registry?${n ? `\n\nIts ${n} inspection${n > 1 ? 's' : ''} are kept; they just won't be linked to a registry tank.` : ''}`, { ok: 'Delete tank', danger: true }))) return;
      await db.deleteTank(id); await loadTanks(); renderView(); return;
    }
  },
  'reg-from-job': async (el, id, e, act) => {
    {
      if (!S.job) return;
      const dupe = S.tanks.find((x) => tankKeyOf(x) === normKey(S.job.info.client, S.job.info.site, S.job.info.tankId));
      if (dupe && await askConfirm(`${dupe.info.tankId} at ${dupe.info.site || 'this site'} is already in the registry. Link this job to it?`, { ok: 'Link to it', cancel: 'Add as a new tank' })) { S.job.tankRef = dupe.id; commit(); renderView(); toast('Linked to the registry tank.'); return; }
      const t = await addTank(S.job); S.job.tankRef = t.id; commit(); renderView(); toast('Tank added to the registry.'); return;
    }
  },
  'reg-update': async (el, id, e, act) => {
    return updateRegistryFromJob();
  },
  'scope-tog': async (el, id, e, act) => {
    {
      if (!S.job) return;
      const all = SCOPE.map(([k]) => k), cur = new Set(Array.isArray(S.job.scope) ? S.job.scope : all);
      el.checked ? cur.add(el.dataset.k) : cur.delete(el.dataset.k);
      if (!cur.size) { el.checked = true; toast('Keep at least one item in scope.'); return; }
      S.job.scope = all.filter((k) => cur.has(k)); commit(); renderNav(); return;
    }
  },
  'job-demo': async (el, id, e, act) => {
    { const j = makeDemo(); return createJob(j); }
  },
  'job-open': async (el, id, e, act) => {
    return openJob(id);
  },
  'job-dup': async (el, id, e, act) => {
    {
      const j = migrate(await db.getJob(id)); const old = j.id;
      j.id = uid(); j.created = j.updated = Date.now(); j.info.tankId = (j.info.tankId || 'Tank') + ' (copy)';
      await db.replaceJob(j, copyPhotos(j, await db.jobPhotos(old)));
      await loadJobs(); renderView(); toast('Job duplicated'); return;
    }
  },
  'job-del': async (el, id, e, act) => {
    {
      const j = S.jobs.find((x) => x.id === id);
      if (!(await askConfirm(`Delete ${j?.info?.tankId || 'this job'} and its photos from this device? This cannot be undone.`, { ok: 'Delete job', danger: true }))) return;
      await db.deleteJob(id); if (S.job?.id === id) { S.job = null; recompute(); }
      await loadJobs(); renderAll(); return;
    }
  },
  'job-save': async (el, id, e, act) => {
    return saveJobFile(id);
  },
  'job-open-file': async (el, id, e, act) => {
    return openJobFile();
  },
  'file-save': async (el, id, e, act) => {
    return saveJobFile();
  },
  'file-save-as': async (el, id, e, act) => {
    return saveJobFile(S.job?.id, true);
  },
  'logo-clear': async (el, id, e, act) => {
    S.company.logo = null; await db.setMeta('company', S.company); renderView(); return;
  },
  'app-reload': async (el, id, e, act) => {
    return appReload();
  },
  'integrity-run': async (el, id, e, act) => {
    await runIntegrity(true); return;
  },
  'integrity-fix': async (el, id, e, act) => {
    { const p = S.integrity?.problems?.[+el.dataset.i]; if (p && (await repairProblem(p))) { await loadJobs(); await runIntegrity(true); } return; }
  },
  'integrity-fix-safe': async (el, id, e, act) => {
    { for (const p of (S.integrity?.problems || []).filter((x) => SAFE_REPAIRS.has(x.repair))) await repairProblem(p); await loadJobs(); await runIntegrity(true); toast('Safe repairs done.'); return; }
  },
  'persist': async (el, id, e, act) => {
    { const ok = await requestPersistence(); toast(ok ? 'Storage is now persistent.' : 'The browser did not grant persistent storage (installing the app usually helps).'); after.jobs(); return; }
  },
  'mode': async (el, id, e, act) => {
    setMode(el.dataset.mode); return;
  },
  'datum-set': async (el, id, e, act) => {
    {
      const c = el.dataset.c;
      applyDatum(el.dataset.key, c);
      if (S.view === 'map') { drawMap(); renderSide(); } return;
    }
  },
  'datum-pick': async (el, id, e, act) => {
    setMode('datum'); return;
  },
  'mp-add': async (el, id, e, act) => {
    {
      let newId = null;
      measuredChange(() => {
        const sec = findSec(el.dataset.sec); if (!sec) return;
        sec.plates = sec.plates || [];
        const at = el.dataset.at != null ? +el.dataset.at : sec.plates.length;
        const prev = sec.plates[Math.max(0, at - 1)];
        const pl = newPlate(prev?.len ?? null, prev?.wid ?? null); newId = pl.id;
        sec.plates.splice(at, 0, pl);
      });
      setTimeout(() => { const n = document.querySelector(`#builderCard input[data-pl="${newId}"]`); n?.focus(); n?.select?.(); }, 30);
      return;
    }
  },
  'mp-del': async (el, id, e, act) => {
    return measuredChange(() => { const sec = findSec(el.dataset.sec); if (sec) sec.plates = (sec.plates || []).filter((x) => x.id !== el.dataset.pl); if (S.selPlate && !S.layout.byKey.has(S.selPlate)) S.selPlate = null; });
  },
  'msec-add': async (el, id, e, act) => {
    return measuredChange((secs) => secs.splice(+el.dataset.at, 0, newMeasuredSection(S.job, el.dataset.type)));
  },
  'msec-del': async (el, id, e, act) => {
    {
      const sec = findSec(el.dataset.sec); if (!sec) return;
      if (!(await askConfirm(`Delete this ${sec.type === 'block' ? 'block' : 'row'} and its ${(sec.plates || []).length} plates?`, { ok: 'Delete', danger: true }))) return;
      return measuredChange((secs) => { const i = secs.indexOf(sec); if (i >= 0) secs.splice(i, 1); });
    }
  },
  'msec-move': async (el, id, e, act) => {
    return measuredChange((secs) => { const i = secs.findIndex((x) => x.id === el.dataset.sec), j = i + +el.dataset.d; if (i >= 0 && j >= 0 && j < secs.length) [secs[i], secs[j]] = [secs[j], secs[i]]; });
  },
  'mtpl': async (el, id, e, act) => {
    {
      if ((S.job.layout.mrows || []).length && !(await askConfirm('Replace all plate-by-plate rows with sizes copied from the automatic or row-by-row layout?', { ok: 'Replace' }))) return;
      return measuredChange(() => { S.job.layout.mrows = measuredFromDrawing({ ...S.job, layout: { ...S.job.layout, mode: (S.job.layout.rows || []).length ? 'custom' : 'grid' } }); });
    }
  },
  'row-n': async (el, id, e, act) => {
    return builderChange((rows) => { const r = rows.find((x) => x.id === el.dataset.row); if (r) r.n = Math.max(0, (+r.n || 0) + +el.dataset.d); });
  },
  'row-sug': async (el, id, e, act) => {
    return builderChange((rows) => { const r = rows.find((x) => x.id === el.dataset.row); if (r) r.n = +el.dataset.v; });
  },
  'row-add': async (el, id, e, act) => {
    return builderChange((rows) => rows.splice(+el.dataset.at, 0, newRow(S.job, el.dataset.type)));
  },
  'row-del': async (el, id, e, act) => {
    {
      const r = S.job.layout.rows.find((x) => x.id === el.dataset.row);
      const n = S.job.indications.filter((i) => S.layout.byKey.get(i.plate)?.rowId === r?.id).length;
      if (n && !(await askConfirm(`${n} indication${n > 1 ? 's are' : ' is'} on this row. They will move to whatever plate covers their spot after the row is deleted.`, { ok: 'Delete row', danger: true }))) return;
      return builderChange((rows) => { const i = rows.findIndex((x) => x.id === el.dataset.row); if (i >= 0) rows.splice(i, 1); });
    }
  },
  'row-move': async (el, id, e, act) => {
    return builderChange((rows) => { const i = rows.findIndex((x) => x.id === el.dataset.row), j = i + +el.dataset.d; if (i >= 0 && j >= 0 && j < rows.length) [rows[i], rows[j]] = [rows[j], rows[i]]; });
  },
  'rows-template': async (el, id, e, act) => {
    {
      if ((S.job.layout.rows || []).length && !(await askConfirm('Replace the current rows with this starting layout? Indications stay where they are on the floor and are moved onto the new plates.', { ok: 'Replace rows' }))) return;
      return builderChange(() => { S.job.layout.rows = el.dataset.t === 'block' ? rowsCentreBlock(S.job) : rowsFromGrid(S.job); });
    }
  },
  'plate-size-reset': async (el, id, e, act) => {
    {
      const o = S.job.plates[el.dataset.key]; if (o) { delete o.len; delete o.wid; delete o.orient; }
      commit(); if (S.view === 'map') { drawMap(); renderSide(); } else refreshPlateTable(); return;
    }
  },
  'filter': async (el, id, e, act) => {
    { const r = el.dataset.r; S.filter.has(r) ? S.filter.delete(r) : S.filter.add(r); el.classList.toggle('on'); drawMap(); return; }
  },
  'zoom-in': async (el, id, e, act) => {
    S.mapCtl?.zoom(1 / 1.4); return;
  },
  'zoom-out': async (el, id, e, act) => {
    S.mapCtl?.zoom(1.4); return;
  },
  'zoom-fit': async (el, id, e, act) => {
    S.mapCtl?.fit(); return;
  },
  'sel-ind': async (el, id, e, act) => {
    if (S.view === 'map') { S.sel = id; S.selPlate = S.selFeature = null; drawMap(); renderSide(); } else openIndDialog(id);
      return;
  },
  'open-ind': async (el, id, e, act) => {
    if (S.view === 'map') { S.sel = id; drawMap(); renderSide(); } else openIndDialog(id); return;
  },
  'close-sel': async (el, id, e, act) => {
    S.sel = S.selPlate = S.selFeature = S.selNozzle = null; drawMap(); renderSide(); return;
  },
  'ind-close': async (el, id, e, act) => {
    closeEditor(el); return;
  },
  'ind-nav': async (el, id, e, act) => {
    {
      const inds = S.job.indications.slice().sort(byNo); const i = inds.findIndex((x) => x.id === S.sel);
      const nx = inds[i + +el.dataset.d]; if (!nx) return;
      S.sel = nx.id;
      if (el.closest('dialog')) openIndDialog(nx.id); else { drawMap(); renderSide(); }
      return;
    }
  },
  'ind-pick': async (el, id, e, act) => {
    {
      const d = $('#dlg'); if (d.open) d.close();
      if (S.view !== 'map') go('map');
      setMode('place'); return;
    }
  },
  'ind-show': async (el, id, e, act) => {
    { $('#dlg').close(); go('map'); zoomToInd(); return; }
  },
  'ind-zoom': async (el, id, e, act) => {
    zoomToInd(); return;
  },
  'ind-dup': async (el, id, e, act) => {
    {
      const ind = curInd(); if (!ind) return;
      const c = { ...structuredClone(ind), id: uid(), no: nextNo(S.job), created: Date.now() };
      S.job.indications.push(c); S.sel = c.id; commit(); renderNav();
      if (el.closest('dialog')) { openIndDialog(c.id); refreshIndTable(); } else { drawMap(); renderSide(); }
      toast(`Duplicated as ${c.no}`); return;
    }
  },
  'ind-del': async (el, id, e, act) => {
    {
      const ind = curInd(); if (!ind || !(await askConfirm(`Delete indication ${ind.no}?`, { ok: 'Delete', danger: true }))) return;
      S.job.indications = S.job.indications.filter((i) => i.id !== ind.id);
      for (const p of S.photos.filter((p) => p.indId === ind.id)) await db.deletePhoto(p.id);
      S.photos = S.photos.filter((p) => p.indId !== ind.id);
      S.sel = null; commit(); renderNav();
      if (el.closest('dialog')) { $('#dlg').close(); refreshIndTable(); } else { drawMap(); renderSide(); }
      return;
    }
  },
  'ind-new': async (el, id, e, act) => {
    {
      const ind = { id: uid(), no: nextNo(S.job), plate: '', x: null, y: null, result: 'pending', repair: 'auto', created: Date.now() };
      S.job.indications.push(ind); commit(); renderNav(); refreshIndTable(); openIndDialog(ind.id);
      setTimeout(() => $('#dlg [data-ib="plate"]')?.focus(), 50); return;
    }
  },
  'utx-add': async (el, id, e, act) => {
    {
      const nz = (S.job.nozzles || []).find((x) => x.id === id); if (!nz) return;
      nz.utx = nz.utx || []; const r = { id: uid(), loc: '', t: null }; nz.utx.push(r); commit(); renderSide();
      setTimeout(() => $(`#side [data-nbx="loc"][data-rid="${r.id}"]`)?.focus(), 30); return;
    }
  },
  'utx-del': async (el, id, e, act) => {
    {
      const nz = (S.job.nozzles || []).find((x) => x.id === id); if (!nz) return;
      nz.utx = (nz.utx || []).filter((x) => x.id !== el.dataset.rid); commit(); renderSide(); drawMap(); return;
    }
  },
  'nozzle-add': async (el, id, e, act) => {
    {
      const nz = { id: uid(), mark: nextMark('Nozzle'), type: 'Nozzle', angle: null, size: null, elev: null, service: '' };
      S.job.nozzles = S.job.nozzles || []; S.job.nozzles.push(nz); commit();
      const c = $('#nozzleCard'); if (c) c.innerHTML = nozzleTableHTML(c.dataset.design === '1');
      setTimeout(() => $(`#nozzleCard input[data-nb="angle"][data-id="${nz.id}"]`)?.focus(), 30); return;
    }
  },
  'nozzle-del': async (el, id, e, act) => {
    {
      const nz = (S.job.nozzles || []).find((x) => x.id === id); if (!nz) return;
      if (!(await askConfirm(`Delete nozzle ${nz.mark || ''}?`, { ok: 'Delete', danger: true }))) return;
      S.job.nozzles = S.job.nozzles.filter((x) => x.id !== id); if (S.selNozzle === id) S.selNozzle = null; commit();
      if (S.view === 'map') { drawMap(); renderSide(); }
      const c = $('#nozzleCard'); if (c) { c.innerHTML = nozzleTableHTML(c.dataset.design === '1'); if (S.view === 'setup') refreshSetupPreview(); }
      return;
    }
  },
  'utl-down': async (el, id, e, act) => {
    {
      const areas = loaderAreas(S.job);
      if (!areas.length) { toast('Nothing to load yet — set up the shell courses, nozzles, roof or floor indications first.'); return; }
      if (!(await flushSave())) { toast('The UT loader was not made: the latest changes could not be saved to this device first.'); return; }
      try { const blob = await buildLoader(S.job); download(fileBase(S.job) + '_UT-loader.xlsx', blob); toast(`UT loader sheet downloaded (${areas.join(', ')}). Give it to the UT technician.`); }
      catch (err) { toast('Could not build the loader sheet: ' + err.message); }
      return;
    }
  },
  'utl-up': async (el, id, e, act) => {
    $('#utlInput').click(); return;
  },
  'exp-roof': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_roof-ut.csv', roofCSV(S.job), 'text/csv');
  },
  'exp-settle': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_settlement.csv', settleCSV(S.job), 'text/csv');
  },
  'exp-shell': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_shell-ut.csv', shellCSV(S.job), 'text/csv');
  },
  'exp-shell-svg': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_shell-rollout.svg', rolloutSVG(S.job, { print: true }).replace(/(<svg[^>]*>)/, '$1' + SHELL_SVG_STYLE), 'image/svg+xml');
  },
  'course-add': async (el, id, e, act) => {
    {
      const sh = (S.job.shell = S.job.shell || defaultShell()); sh.courses = sh.courses || [];
      const last = sh.courses[sh.courses.length - 1];
      const c = { id: uid(), h: last?.h ?? (S.job.units === 'metric' ? 2400 : 2438.4), tNom: last?.tNom ?? null, tMin: last?.tMin ?? null };
      sh.courses.push(c); commit(); refreshShell(); return;
    }
  },
  'course-del': async (el, id, e, act) => {
    {
      const sh = S.job.shell; const c = sh?.courses?.find((x) => x.id === el.dataset.course); if (!c) return;
      if (!(await askConfirm('Delete this course? The courses above it move down, and readings stay at their elevations.', { ok: 'Delete', danger: true }))) return;
      sh.courses = sh.courses.filter((x) => x.id !== c.id); commit(); refreshShell(); return;
    }
  },
  'zone-add': async (el, id, e, act) => {
    {
      const sh = S.job.shell; sh.zones = sh.zones || [];
      const last = sh.zones[sh.zones.length - 1];
      const ft = S.job.units === 'metric' ? 300 : 304.8;
      sh.zones.push({ id: uid(), start: last && last.end != null ? +last.end + (+last.step || ft) : 0, end: null, step: last?.step ?? ft });
      commit(); refreshShell(); return;
    }
  },
  'zone-del': async (el, id, e, act) => {
    { const sh = S.job.shell; sh.zones = (sh.zones || []).filter((z) => z.id !== el.dataset.zone); commit(); refreshShell(); return; }
  },
  'zones-std': async (el, id, e, act) => {
    {
      if ((S.job.shell.zones || []).length && !(await askConfirm('Replace the reading zones with the standard pattern (every 1 in up to 2 ft, then every 1 ft to the top)? Readings already entered are kept.', { ok: 'Use standard' }))) return;
      S.job.shell.zones = defaultZones(S.job.units); commit(); refreshShell(); return;
    }
  },
  'z-add': async (el, id, e, act) => {
    {
      const inp = $('#extraZ'); const v = toMm(inp?.value, 'small', S.job);
      if (v === null || v < 0) { toast('Enter an elevation above the bottom.'); return; }
      const H = shellHeight(S.job); if (H > 0 && v > H) { toast('That is above the top of the shell.'); return; }
      const sh = S.job.shell; sh.extraZ = sh.extraZ || []; if (!sh.extraZ.some((e) => zKey(e) === zKey(v))) sh.extraZ.push(+zKey(v));
      commit(); refreshShell(); return;
    }
  },
  'z-del': async (el, id, e, act) => {
    {
      const sh = S.job.shell, zk = el.dataset.z;
      const has = Object.values(sh.rd || {}).some((m) => m?.[zk] != null);
      if (has && !(await askConfirm(`Remove the elevation ${fmtElev(+zk, S.job)} and its readings?`, { ok: 'Remove', danger: true }))) return;
      sh.extraZ = (sh.extraZ || []).filter((e) => zKey(e) !== zk); for (const m of Object.values(sh.rd || {})) if (m) delete m[zk];
      commit(); refreshShell(); return;
    }
  },
  'courses-std': async (el, id, e, act) => {
    {
      const sh = (S.job.shell = S.job.shell || defaultShell());
      const n = Math.max(1, Math.round(+el.dataset.n || 5)), ch = S.job.units === 'metric' ? 2400 : 2438.4;
      if ((sh.courses || []).length && !(await askConfirm('Replace the current courses?', { ok: 'Replace' }))) return;
      sh.courses = Array.from({ length: n }, () => ({ id: uid(), h: ch, tNom: null, tMin: null })); commit(); refreshShell(); return;
    }
  },
  'eq-add': async (el, id, e, act) => {
    {
      const e = newEquip(el.dataset.type || 'other'); (S.job.equipment = S.job.equipment || []).push(e);
      // pick it for existing methods that use this type and have nothing of that type yet
      for (const sx of SECTIONS) for (const n of secData(sx.key).nde) if (suggestEquip([e], n.method).length && !(n.equip || []).some((id) => S.job.equipment.find((x) => x.id === id)?.type === e.type)) n.equip = [...(n.equip || []), e.id];
      commit(); renderView(); setTimeout(() => $(`[data-eq="make"][data-id="${e.id}"]`)?.focus(), 30); return;
    }
  },
  'eq-dup': async (el, id, e, act) => {
    {
      const src = (S.job.equipment || []).find((x) => x.id === id); if (!src) return;
      const e = newEquip(src.type, { ...src, id: undefined, serial: '' }); e.id = newEquip().id;
      S.job.equipment.splice(S.job.equipment.indexOf(src) + 1, 0, e); commit(); renderView(); setTimeout(() => $(`[data-eq="serial"][data-id="${e.id}"]`)?.focus(), 30); return;
    }
  },
  'eq-del': async (el, id, e, act) => {
    {
      const e = (S.job.equipment || []).find((x) => x.id === id); if (!e) return;
      const used = equipUse(S.job, SECTIONS).get(id) || [];
      if (!(await askConfirm(`Remove ${equipName(e)}${e.serial ? ' (S/N ' + e.serial + ')' : ''} from the equipment list?${used.length ? `\n\nIt is picked for: ${used.join('; ')}.` : ''}`, { ok: 'Remove', danger: true }))) return;
      S.job.equipment = S.job.equipment.filter((x) => x.id !== id);
      for (const sx of SECTIONS) for (const n of secData(sx.key).nde) if (n.equip) n.equip = n.equip.filter((x) => x !== id);
      commit(); renderView(); return;
    }
  },
  'courses-fill': async (el, id, e, act) => {
    {
      const cs = S.job.shell?.courses || [], c1 = cs[0]; if (!c1) return;
      for (const c of cs.slice(1)) { for (const k of ['pn', 'plen']) if ((c[k] === null || c[k] === undefined || c[k] === '') && c1[k] != null) c[k] = c1[k]; }
      commit(); refreshShell(); toast('Course 1 plates copied to the courses above (where empty).'); return;
    }
  },
  'nozzle-place': async (el, id, e, act) => {
    {
      if (!(S.job.tank?.diameter > 0)) { toast('Enter the tank diameter first.'); return; }
      go('map'); setMode('nozzle'); toast('Click around the shell to place each nozzle (Shift-click to keep placing). Set its details in the panel.'); return;
    }
  },
  'exp-noz': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_nozzles.csv', nozzlesCSV(S.job), 'text/csv');
  },
  'feature-del': async (el, id, e, act) => {
    {
      S.job.features = S.job.features.filter((f) => f.id !== S.selFeature); S.selFeature = null; commit(); drawMap(); renderSide(); return;
    }
  },
  'photo-del': async (el, id, e, act) => {
    {
      if (!(await askConfirm('Delete this photo?', { ok: 'Delete', danger: true }))) return;
      await db.deletePhoto(id); S.photos = S.photos.filter((p) => p.id !== id); rerenderEditor(el); return;
    }
  },
  'photo-view': async (el, id, e, act) => {
    { const p = S.photos.find((x) => x.id === id); if (p) { const w = window.open(); w?.document.write(`<title>${h(p.caption || 'Photo')}</title><img src="${p.dataUrl}" style="max-width:100%">`); } return; }
  },
  'sort': async (el, id, e, act) => {
    { const k = el.dataset.k; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 }; renderView(); return; }
  },
  'scan-all': async (el, id, e, act) => {
    { if (!(await askConfirm('Mark every plate as scanned?', { ok: 'Mark all scanned' }))) return; for (const p of S.layout.plates) { S.job.plates[p.key] = { ...(S.job.plates[p.key] || {}), scan: 'scanned' }; } commit(); refreshPlateTable(); return; }
  },
  'sx-add': async (el, id, e, act) => {
    {
      const k = el.dataset.sec, kind = el.dataset.kind, it = kind === 'nde' ? newNDE() : kind === 'obs' ? newObs() : newRec();
      secData(k)[kind].push(it); if (kind === 'recs') numberDefs(S.job); commit(); renderView(); renderNav();
      setTimeout(() => $(`[data-iid="${it.id}"][data-f="${kind === 'nde' ? 'extent' : kind === 'obs' ? 'item' : 'finding'}"]`)?.focus(), 40); return;
    }
  },
  'sx-del': async (el, id, e, act) => {
    {
      const k = el.dataset.sec, kind = el.dataset.kind, d = secData(k);
      if (kind === 'recs' && !(await askConfirm('Remove this recommendation?', { ok: 'Remove', danger: true }))) return;
      d[kind] = d[kind].filter((x) => x.id !== el.dataset.iid);
      if (kind === 'obs') for (const p of S.photos.filter((p) => p.obs === el.dataset.iid)) { delete p.obs; await db.putPhoto(p); }
      commit(); renderView(); renderNav(); return;
    }
  },
  'sx-typ': async (el, id, e, act) => {
    {
      const k = el.dataset.sec, kind = el.dataset.kind, d = secData(k);
      const have = new Set(d[kind].map((x) => (kind === 'nde' ? x.method : x.item)));
      const add = (kind === 'nde' ? typicalNDE(k) : typicalObs(k)).filter((x) => !have.has(kind === 'nde' ? x.method : x.item));
      if (kind === 'nde') for (const x of add) x.equip = suggestEquip(S.job.equipment, x.method);
      d[kind].push(...add); commit(); renderView(); renderNav(); toast(add.length ? `Added ${add.length} item${add.length > 1 ? 's' : ''}.` : 'The typical items are already there.'); return;
    }
  },
  'rec-from': _recfrom,
  'rec-all': _recfrom,
  'obs-rec': async (el, id, e, act) => {
    {
      const k = el.dataset.sec, o = secData(k).obs.find((x) => x.id === el.dataset.iid); if (!o) return;
      const ph = S.photos.find((p) => p.obs === o.id);
      secData(k).recs.push(newRec({ finding: [o.item, o.text].filter(Boolean).join(': '), loc: o.loc, priority: o.cond === 'poor' ? 'P3' : 'P4', photo: ph?.id || '', obs: o.id }));
      numberDefs(S.job); commit(); go('recs:' + k); return;
    }
  },
  'ph-anno': _phanno,
  'ph-open': _phanno,
  'ph-del': async (el, id, e, act) => {
    {
      if (!(await askConfirm('Delete this photo and its annotations?', { ok: 'Delete', danger: true }))) return;
      await db.deletePhoto(id); S.photos = S.photos.filter((p) => p.id !== id); S.job.updated = Date.now(); scheduleSave(); renderView(); renderNav(); return;
    }
  },
  'sum-draft': async (el, id, e, act) => {
    {
      const f = el.dataset.f;
      if ((S.job.summary[f] || '').trim() && !(await askConfirm('Replace the current text with a new draft?', { ok: 'Replace' }))) return;
      S.job.summary[f] = draftSummary(f); commit(); renderView(); return;
    }
  },
  'def-filter': async (el, id, e, act) => {
    S.defFilter = el.dataset.k; renderView(); return;
  },
  'def-issue': async (el, id, e, act) => {
    {
      const S2 = S.job.summary; S2.defRev = (S2.defRev || 0) + 1; S2.issued = new Date().toISOString().slice(0, 10); commit(); toast(`Deficiency report update ${S2.defRev} issued ${S2.issued}.`); go('defrep'); return;
    }
  },
  'exp-defs': async (el, id, e, act) => {
    {
      numberDefs(S.job);
      const rows = [['No.', 'Component', 'Location', 'Deficiency', 'Recommended action', 'Priority', 'Due', 'Status', 'Closed', 'Client comment', 'Code reference', 'History']];
      for (const d of allDefs(S.job)) rows.push([d.no || '', d.secLabel, d.loc || '', d.finding || '', d.action || '', d.priority, d.due || '', d.status, d.closedOn || '', d.client || '', d.ref || '', (d.history || []).map((x) => x.date + ' ' + x.status).join('; ')]);
      return download(fileBase(S.job) + '_deficiencies.csv', '\ufeff' + rows.map((r) => r.map((v) => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\r\n'), 'text/csv');
    }
  },
  'dash-link': async (el, id, e, act) => {
    return linkFolder();
  },
  'dash-reconnect': async (el, id, e, act) => {
    { try { S.dash.perm = await S.dash.dir.requestPermission({ mode: 'readwrite' }); } catch { S.dash.perm = 'denied'; } if (S.dash.perm === 'granted') { S.dash.scanned = false; await scanFolder(); } else renderView(); return; }
  },
  'dash-rescan': async (el, id, e, act) => {
    S.dash.scanned = false; return scanFolder();
  },
  'dash-open': async (el, id, e, act) => {
    return openFromDash(id);
  },
  'dash-mode': async (el, id, e, act) => {
    S.dash.mode = el.dataset.k; renderView(); return;
  },
  'dash-stage': async (el, id, e, act) => {
    S.dash.stage = S.dash.stage === el.dataset.k ? '' : el.dataset.k; renderView(); return;
  },
  'nav-sec': async (el, id, e, act) => {
    {
      const k = el.dataset.sec, pl = viewPlace(S.view);
      if (S.navOpen.has(k)) { S.navOpen.delete(k); renderNav(); return; }
      S.navOpen.add(k);
      if (pl?.sec === k) { renderNav(); return; }
      go(S.ndeTab[k] || 'nde:' + k); return;
    }
  },
  'ann-apply': async (el, id, e, act) => {
    S.job.calc.mrtAnnular = +el.dataset.v; commit(); renderView(); return;
  },
  'mrt-preset': async (el, id, e, act) => {
    S.job.calc.mrtBottom = +el.dataset.v; commit(); renderView(); return;
  },
  'exp-ind': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_indications.csv', indicationsCSV(S.job, S.layout, S.calc), 'text/csv');
  },
  'exp-plates': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_plates.csv', platesCSV(S.job, S.layout, S.calc), 'text/csv');
  },
  'exp-svg': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_floor-map.svg', svgForExport(printMap()), 'image/svg+xml');
  },
  'exp-png': async (el, id, e, act) => {
    { const b = await svgToPng(svgForExport(printMap())); return download(fileBase(S.job) + '_floor-map.png', b); }
  },
  'exp-json': async (el, id, e, act) => {
    return saveJobFile(S.job.id, true);
  },
  'install': async (el, id, e, act) => {
    { if (S.installEvt) { S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; renderHeader(); } return; }
  }
});

function printMap() { return renderMapSVG(S.job, S.layout, { calc: S.calc, print: true, floorOf: (ft) => itemFloor(S.layout, ft) }); }

function closeEditor(el) {
  if (el.closest('dialog')) { $('#dlg').close(); return; }
  S.sel = null; drawMap(); renderSide();
}
function rerenderEditor(el) {
  const ind = curInd(); if (!ind) return;
  if (el.closest('dialog')) openIndDialog(ind.id); else renderSide();
}
function setMode(m) {
  if (m === 'place' && !S.sel) m = 'select';
  S.mode = m;
  $$('[data-act="mode"]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m || (m === 'place' && b.dataset.mode === 'add')));
  drawMap();
}
function zoomToInd() {
  const a = S.calc.per.get(S.sel); if (!a?.floor || !S.mapCtl) return;
  S.mapCtl.focus(a.floor.x, a.floor.y, S.layout.R * 0.5); drawMap(); renderSide();
}

/* Change handlers (input bindings), registered in their original order (js/app/actions.js). */
onChange([
  { order: 10, when: (el, act) => el.matches('[data-bind]'), run: async (el, e, act) => {
    {
    const path = el.dataset.bind;
    let v = readInput(el);
    if (el.dataset.num) v = +v;
    if (path === 'layout.annN' && v !== null) v = Math.max(1, Math.round(v));
    const before = S.layout;
    if (path === 'layout.mode' && v === 'measured' && !(S.job.layout.mrows || []).length) S.job.layout.mrows = measuredFromDrawing(S.job);
    if (path === 'status.stage' && S.job.status?.stage !== v) (S.job.status.history = S.job.status.history || []).push({ stage: v, at: Date.now() });
    setPath(S.job, path, v);
    if (path === 'status.stage') { commit(); renderHeader(); writeStageToFile(S.job.id, v); }
    if (path === 'layout.mode' && v === 'custom' && !(S.job.layout.rows || []).length) { recompute(); S.job.layout.rows = rowsFromGrid(S.job); }
    commit();
    if (path.startsWith('layout.') || path === 'tank.diameter') relocateOrphans(before);
    if (path === 'tank.code' && !editionsFor(v || 'Unknown').includes(S.job.tank.edition)) { S.job.tank.edition = ''; S.job.tank.supp = ''; }
    if (path === 'tank.edition' && !supplementsFor(v).includes(S.job.tank.supp)) S.job.tank.supp = '';
    const structural = path === 'tank.code' || path === 'tank.edition' || path === 'units' || path === 'layout.annular' || path === 'layout.scheme' || path === 'layout.orient' || path === 'layout.refCorner' || path === 'layout.mode';
    if (S.view === 'setup' && !structural && (path === 'tank.diameter' || path === 'info.zeroRef')) { const sb = $('#shellBuild'), nc = $('#nozzleCard'); setTimeout(() => { if (sb) rerenderKeep(sb, shellBuildHTML()); if (nc) rerenderKeep(nc, nozzleTableHTML(true)); }, 0); }
    if (S.view === 'setup') { if (structural) renderView(); else if (S.job.layout.mode !== 'grid' && path.startsWith('layout.')) refreshBuilder(); else refreshSetupPreview(); renderHeader(); }
    else if (S.view === 'api') refreshApi();
    else if (S.view === 'shell') refreshShell();
    else if (['roofF', 'roofL', 'seal'].includes(S.view)) refreshRoof();
    else if (S.view === 'settle') { if (path === 'settle.eu') renderView(); else refreshSettle(); }
    if (path === 'units') renderAll();
    return;
  }
  } },
  { order: 140, when: (el, act) => el.matches('[data-shs]'), run: async (el, e, act) => {
    {
    const c = S.job.shell?.courses?.find((x) => x.id === el.dataset.course); if (!c) return;
    const v = num(el.value), k = el.dataset.shs;
    if (v !== null && v <= 0) { toast('Enter a positive stress.'); return; }
    if (v === null) delete c[k]; else c[k] = S.job.units === 'metric' ? v * PSI_MPA : v;
    commit(); refreshShell(); return;
  }
  } },
  { order: 150, when: (el, act) => el.matches('[data-shc="matl"]') || el.matches('[data-shc="joint"]'), run: async (el, e, act) => {
    {
    const c = S.job.shell?.courses?.find((x) => x.id === el.dataset.course); if (!c) return;
    if (el.value) c[el.dataset.shc] = el.value; else delete c[el.dataset.shc];
    commit(); refreshShell(); return;
  }
  } },
  { order: 160, when: (el, act) => el.matches('[data-shc]'), run: async (el, e, act) => {
    {
    const c = S.job.shell?.courses?.find((x) => x.id === el.dataset.course); if (!c) return;
    let v = readInput(el); const k = el.dataset.shc;
    if (v !== null && v < 0 && k !== 'seam0') { toast('Values can’t be negative.'); return; }
    if (k === 'seam0arc') {
      const Cc = Math.PI * (+S.job.tank?.diameter || 0); if (!(Cc > 0)) return;
      if (v === null) delete c.seam0; else c.seam0 = Math.round(((((v / Cc) * 360) % 360 + 360) % 360) * 100) / 100;
      commit(); refreshShell(); return;
    }
    if (k === 'seam0' && v !== null) v = ((v % 360) + 360) % 360;
    if (k === 'pn' && v !== null) v = Math.max(1, Math.round(v));
    if (v === null) { if (k === 'h') return; delete c[k]; } else c[k] = v;
    commit(); refreshShell(); return;
  }
  } },
  { order: 170, when: (el, act) => el.matches('[data-shut]'), run: async (el, e, act) => {
    {
    const sh = S.job.shell; sh.rd = sh.rd || {};
    const m = (sh.rd[el.dataset.shut] = sh.rd[el.dataset.shut] || {});
    const v = readInput(el);
    if (v !== null && v < 0) { toast('Readings can’t be negative.'); return; }
    if (v === null) delete m[el.dataset.z]; else m[el.dataset.z] = v;
    commit(); refreshShell(); return;
  }
  } },
  { order: 180, when: (el, act) => el.matches('[data-zf]'), run: async (el, e, act) => {
    {
    const zn = S.job.shell?.zones?.find((x) => x.id === el.dataset.zone); if (!zn) return;
    const v = readInput(el), k = el.dataset.zf;
    if (v !== null && v < 0) { toast('Values can’t be negative.'); return; }
    if (k === 'step' && v !== null && v <= 0) { toast('The step must be more than zero.'); return; }
    zn[k] = v;
    const n = readingElevations(S.job).length;
    if (n > 1500) toast(`That gives ${n} elevations per station — check the step.`);
    commit(); refreshShell(); return;
  }
  } },
  { order: 190, when: (el, act) => el.matches('[data-nb]'), run: async (el, e, act) => {
    {
    const nz = (S.job.nozzles || []).find((x) => x.id === el.dataset.id); if (!nz) return;
    let k = el.dataset.nb; let v = readInput(el);
    if (k === 'arc') {
      const Cc = Math.PI * (+S.job.tank?.diameter || 0); if (!(Cc > 0)) return;
      k = 'angle'; v = v === null ? null : Math.round(((((v / Cc) * 360) % 360 + 360) % 360) * 100) / 100;
    }
    if (k === 'angle' && v !== null) v = ((v % 360) + 360) % 360;
    if (k === 'type' && (!nz.mark || /^(N|MH|CO)\d+$/.test(nz.mark)) && nzPrefix(v) !== nzPrefix(nz.type)) nz.mark = nextMark(v);
    if (v === null || v === '') delete nz[k]; else nz[k] = v;
    commit();
    refreshNozzleUT(nz);
    if (S.view === 'map') { drawMap(); if (k === 'mark' || k === 'type') renderSide(); }
    if (S.view === 'setup' || S.view === 'nozzles') { const c = $('#nozzleCard'); if (c && (k === 'angle' || k === 'type' || k === 'mark' || el.dataset.nb === 'arc')) setTimeout(() => { c.innerHTML = nozzleTableHTML(c.dataset.design === '1'); }, 0); if (S.view === 'setup') refreshSetupPreview(); }
    return;
  }
  } },
  { order: 200, when: (el, act) => el.matches('[data-nbx]'), run: async (el, e, act) => {
    {
    const nz = (S.job.nozzles || []).find((x) => x.id === el.dataset.id); const r = nz?.utx?.find((x) => x.id === el.dataset.rid); if (!r) return;
    const v = readInput(el); if (v === null || v === '') delete r[el.dataset.nbx]; else r[el.dataset.nbx] = v;
    commit(); refreshNozzleUT(nz); if (S.view === 'map') drawMap(); return;
  }
  } },
  { order: 210, when: (el, act) => el.matches('[data-secf]'), run: async (el, e, act) => {
    {
    const k = el.dataset.secf; let v = readInput(el);
    if (k === 'sideN') v = v === null ? 1 : Math.max(1, Math.round(v));
    measuredChange(() => { const sec = findSec(el.dataset.sec); if (!sec) return; if (v === null || v === '') { if (k === 'h') return; delete sec[k]; } else sec[k] = v; });
    return;
  }
  } },
  { order: 220, when: (el, act) => el.matches('[data-mpf]'), run: async (el, e, act) => {
    {
    const k = el.dataset.mpf, v = readInput(el);
    measuredChange(() => { const pl = findSec(el.dataset.sec)?.plates?.find((x) => x.id === el.dataset.pl); if (!pl) return; pl[k] = v > 0 ? v : null; });
    return;
  }
  } },
  { order: 230, when: (el, act) => el.matches('[data-rowf]'), run: async (el, e, act) => {
    {
    const k = el.dataset.rowf; let v = readInput(el);
    if (k === 'n' || k === 'sideN') v = v === null ? null : Math.max(k === 'n' ? 0 : 1, Math.round(v));
    builderChange((rows) => { const r = rows.find((x) => x.id === el.dataset.row); if (!r) return; if (v === null || v === '') { if (k === 'h' || k === 'n') return; delete r[k]; } else r[k] = v; });
    return;
  }
  } },
  { order: 240, when: (el, act) => el.matches('[data-ib]'), run: async (el, e, act) => {
    return onIndField(el);
  } },
  { order: 250, when: (el, act) => el.matches('[data-pb]'), run: async (el, e, act) => {
    {
    const key = el.dataset.key, k = el.dataset.pb;
    const o = (S.job.plates[key] = { ...(S.job.plates[key] || {}) });
    const v = readInput(el);
    if (v === null || v === '') delete o[k]; else o[k] = v;
    commit();
    const big = k === 'label' || k === 'len' || k === 'wid' || k === 'orient';
    if (S.view === 'map') { drawMap(); if (big) renderSide(); }
    if (big && S.view === 'plates') refreshPlateTable();
    return;
  }
  } },
  { order: 260, when: (el, act) => el.matches('[data-fb]'), run: async (el, e, act) => {
    {
    const ft = S.job.features.find((f) => f.id === el.closest('[data-ed]').dataset.id); if (!ft) return;
    const k = el.dataset.fb;
    if (k === 'plate') { const p = findPlate(el.value); el.closest('.fld').classList.toggle('invalid', !p); if (!p) return; ft.plate = p.key; }
    else { const v = readInput(el); if ((k === 'x' || k === 'y') && v !== null && v < 0) { toast(`${k.toUpperCase()} can't be negative.`); return; } ft[k] = v; }
    commit(); drawMap(); if (k === 'type') renderSide(); return;
  }
  } },
  { order: 270, when: (el, act) => el.matches('[data-cb]'), run: async (el, e, act) => {
    { S.company[el.dataset.cb] = el.value; await db.setMeta('company', S.company); return; }
  } },
  { order: 280, when: (el, act) => el.matches('[data-stage-of]'), run: async (el, e, act) => {
    { setStage(el.dataset.stageOf, el.value); return; }
  } },
  { order: 290, when: (el, act) => el.matches('[data-ph]'), run: async (el, e, act) => {
    {
    const p = S.photos.find((x) => x.id === el.dataset.ph); if (!p) return;
    const f = el.dataset.f; p[f] = el.type === 'checkbox' ? el.checked : el.value;
    await db.putPhoto(p); S.job.updated = Date.now(); scheduleSave(); if (f === 'obs') renderView(); return;
  }
  } },
  { order: 300, when: (el, act) => el.matches('[data-eq]'), run: async (el, e, act) => {
    {
    const e = (S.job.equipment || []).find((x) => x.id === el.dataset.id); if (!e) return;
    e[el.dataset.eq] = el.value.trim(); commit();
    if (el.tagName === 'SELECT' || el.type === 'date') renderView();
    return;
  }
  } },
  { order: 310, when: (el, act) => el.matches('[data-eqpick]'), run: async (el, e, act) => {
    {
    const it = secData(el.dataset.sec).nde.find((x) => x.id === el.dataset.iid); if (!it) return;
    const set = new Set(it.equip || []); el.checked ? set.add(el.dataset.eqpick) : set.delete(el.dataset.eqpick);
    it.equip = (S.job.equipment || []).map((e) => e.id).filter((x) => set.has(x)); commit();
    const sm = el.closest('details')?.querySelector('summary'); if (sm) sm.innerHTML = eqChips(it);
    return;
  }
  } },
  { order: 320, when: (el, act) => el.id === 'eqCopyFrom' && el.value, run: async (el, e, act) => {
    {
    const src = await db.getJob(el.value); el.value = '';
    if (!src?.equipment?.length) return;
    const have = new Set((S.job.equipment || []).map((e) => [e.type, e.serial, e.model].join('|')));
    const add = src.equipment.filter((e) => !have.has([e.type, e.serial, e.model].join('|'))).map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: newEquip().id }));
    S.job.equipment = [...(S.job.equipment || []), ...add];
    for (const sx of SECTIONS) for (const n of secData(sx.key).nde) if (!(n.equip || []).length) n.equip = suggestEquip(S.job.equipment, n.method);
    commit(); renderView(); toast(add.length ? `${add.length} item${add.length === 1 ? '' : 's'} copied — check the calibration dates.` : 'Those items are already on the list.'); return;
  }
  } },
  { order: 330, when: (el, act) => el.matches('[data-sx]'), run: async (el, e, act) => {
    {
    const list = secData(el.dataset.sec)[el.dataset.sx] || [], it = list.find((x) => x.id === el.dataset.iid); if (!it) return;
    const f = el.dataset.f, v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.sx === 'nde' && f === 'method' && !(it.equip || []).length) it.equip = suggestEquip(S.job.equipment, v);
    if (f === 'status' && it.status !== v) { it.history = it.history || []; const d = new Date().toISOString().slice(0, 10); it.history.push({ date: d, status: v }); if (v === 'Closed') it.closedOn = d; else delete it.closedOn; }
    it[f] = v;
    if (f === 'def' && v) numberDefs(S.job);
    commit();
    if (el.tagName === 'SELECT' || el.type === 'checkbox') { renderView(); renderNav(); }
    return;
  }
  } },
  { order: 340, when: (el, act) => el.matches('[data-photo-cap]'), run: async (el, e, act) => {
    { const p = S.photos.find((x) => x.id === el.dataset.photoCap); if (p) { p.caption = el.value; await db.putPhoto(p); } return; }
  } },
  { order: 350, when: (el, act) => act === 'toggle', run: async (el, e, act) => {
    { S[el.dataset.k] = el.checked; drawMap(); return; }
  } },
  { order: 370, when: (el, act) => act === 'datum-sel', run: async (el, e, act) => {
    { applyDatum(el.dataset.key, el.value); return; }
  } },
  { order: 380, when: (el, act) => act === 'resfilter', run: async (el, e, act) => {
    { S.resFilter = el.value; refreshIndTable(); return; }
  } },
  { order: 390, when: (el, act) => el.id === 'ftType', run: async (el, e, act) => {
    { S.ftType = el.value; setMode('feature'); return; }
  } },
  { order: 400, when: (el, act) => act === 'utl-file', run: async (el, e, act) => {
    { const f = el.files[0]; el.value = ''; if (f) uploadLoader(f); return; }
  } },
  { order: 410, when: (el, act) => act === 'job-import', run: async (el, e, act) => {
    return importJobFile(el.files[0]).finally(() => (el.value = ''));
  } },
  { order: 420, when: (el, act) => act === 'logo', run: async (el, e, act) => {
    { const f = el.files[0]; if (!f) return; S.company.logo = await resizeImage(f, 600, 'image/png'); await db.setMeta('company', S.company); renderView(); return; }
  } },
  { order: 430, when: (el, act) => act === 'ph-add', run: async (el, e, act) => {
    {
    const k = el.dataset.sec; let n = Math.max(0, ...S.photos.filter((p) => p.sec === k).map((p) => p.n || 0));
    for (const f of el.files) {
      try { const dataUrl = await resizeImage(f, 1800); const [w, hh] = await imgDims(dataUrl); const p = { id: uid(), jobId: S.job.id, sec: k, n: ++n, dataUrl, w, h: hh, caption: '', comment: '', anno: [], created: Date.now() }; await db.putPhoto(p); S.photos.push(p); }
      catch { toast('Could not read ' + f.name); }
    }
    el.value = ''; S.job.updated = Date.now(); scheduleSave(); renderView(); renderNav(); checkStorage(); return;
  }
  } },
  { order: 440, when: (el, act) => act === 'photo-add', run: async (el, e, act) => {
    {
    const ind = S.job.indications.find((i) => i.id === el.closest('[data-ed]').dataset.id); if (!ind) return;
    for (const f of el.files) {
      try { const dataUrl = await resizeImage(f, 1600); const p = { id: uid(), jobId: S.job.id, indId: ind.id, dataUrl, caption: '', created: Date.now() }; await db.putPhoto(p); S.photos.push(p); }
      catch (err) { toast('Could not read ' + f.name); }
    }
    rerenderEditor(el); checkStorage(); return;
  }
  } }
]);

// a value typed while the page was refreshing is put back into the new field; commit it when the field is left
document.addEventListener('focusout', (e) => {
  const el = e.target;
  if (el?.dataset?.restored) { delete el.dataset.restored; if (el.value !== el.defaultValue) el.dispatchEvent(new Event('change', { bubbles: true })); }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.act === 'search') { S.search = el.value; refreshIndTable(); }
  if (el.dataset.act === 'plate-search') { S.plateSearch = el.value; refreshPlateTable(); }
});

const findPlate = (label) => { const q = String(label || '').trim().toLowerCase(); return S.layout.plates.find((p) => p.label.toLowerCase() === q) || null; };

function onIndField(el) {
  const root = el.closest('[data-ed]');
  const ind = S.job.indications.find((i) => i.id === root.dataset.id); if (!ind) return;
  const k = el.dataset.ib;
  if (k === 'plate') {
    const p = findPlate(el.value);
    el.closest('.fld').classList.toggle('invalid', !p);
    if (!p) { toast(`No plate called "${el.value}"`); return; }
    ind.plate = p.key;
  } else {
    const v = readInput(el);
    if ((k === 'x' || k === 'y') && v !== null && v < 0) {
      el.closest('.fld').classList.add('invalid');
      toast(`${k.toUpperCase()} can't be negative. Measure it from the plate's datum corner (${datumName(S.layout.byKey.get(ind.plate) || { kind: 'floor', datum: { c: S.job.layout.refCorner || 'BL' } })}).`);
      return;
    }
    const bad = k === 'mflPct' && v !== null && (v < 0 || v > 100) ? 'MFL wall loss must be between 0 and 100 %.'
      : ['utMin', 'vtDepth', 'utNom', 'len', 'wid'].includes(k) && v !== null && v < 0 ? 'The value can\'t be negative.' : null;
    if (bad) { el.closest('.fld')?.classList.add('invalid'); toast(bad); return; }
    el.closest('.fld')?.classList.remove('invalid');
    if (v === null || v === '') delete ind[k]; else ind[k] = v;
  }
  ind.updated = Date.now();
  commit();
  refreshEditorParts(root);
  if (S.view === 'map') { drawMap(); if (k === 'no' || k === 'result') { const ov = $('#side .ind-list'); if (ov) renderSide(); } }
  if (S.view === 'inds') refreshIndTable();
  if (S.view === 'api') refreshApi();
  if (k === 'no') renderNav();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('input[data-shut]')) {
    e.preventDefault();
    const inputs = $$(`#shellBody input[data-shut="${CSS.escape(e.target.dataset.shut)}"]`);
    const i = inputs.indexOf(e.target), next = inputs[e.shiftKey ? i - 1 : i + 1];
    const cur = e.target;
    if (next) { next.focus(); next.select(); } // leaving the field fires its change event
    else if (cur.value !== cur.defaultValue) cur.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  const typing = e.target.matches('input, textarea, select');
  if (e.key === 'Escape') {
    if ($('#dlg').open || $('#confirmDlg').open) return;
    if (S.view === 'map') {
      if (S.mode !== 'select') { setMode('select'); return; }
      if (typing) { e.target.blur(); return; }
      if (S.sel || S.selPlate || S.selFeature || S.selNozzle) { S.sel = S.selPlate = S.selFeature = S.selNozzle = null; drawMap(); renderSide(); }
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && S.job) { e.preventDefault(); if (typing) e.target.blur(); setTimeout(() => saveJobFile(S.job.id, e.shiftKey), 0); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (S.view === 'map') {
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setMode(S.mode === 'add' ? 'select' : 'add'); }
    else if (e.key === 'd' || e.key === 'D') setMode(S.mode === 'datum' ? 'select' : 'datum');
    else if (e.key === 'f' || e.key === 'F') S.mapCtl?.fit();
    else if (e.key === '+' || e.key === '=') S.mapCtl?.zoom(1 / 1.4);
    else if (e.key === '-') S.mapCtl?.zoom(1.4);
  }
});

$('#dlg').addEventListener('close', () => { if (S.view === 'inds') refreshIndTable(); });

/* ------------------------------------------------------- import / export */

/* Job files: one .json file per job (data + photos) that can live in OneDrive, SharePoint, a USB stick…
   Chrome / Edge write straight to the chosen file and remember it, so later saves update the same file.
   Other browsers download a copy instead. */
const FILE_TYPES = [{ description: 'Tank floor inspection', accept: { 'application/json': ['.json'] } }];
const canPick = () => 'showSaveFilePicker' in window && window.self === window.top;

/** Build the file for the next revision without changing the stored job yet.
 *  The file is produced in pieces (header + job, then one photo at a time, then the rest) so a job with
 *  hundreds of photos never needs one huge string in memory. The bytes are exactly what
 *  JSON.stringify({ format, version, saved, rev, job, photos, tank?, appVersion }) gives. */
async function jobFile(id) {
  // never write a file from stale data: every change must be on the device first
  if (S.job?.id === id && !(await flushSave())) throw Object.assign(new Error(`your latest changes could not be saved to this device (${saveErrorText(saver.error)})`), { name: 'NotSavedError' });
  const stored = await db.getJob(id); const keys = await db.jobPhotoKeys(id);
  const at = Date.now();
  const stamp = { rev: (stored.rev || 0) + 1, savedAt: at };
  const job = { ...stored, ...stamp, updated: at, edits: 0, editAreas: [], revisions: [...(stored.revisions || []), { rev: stamp.rev, at }].slice(-100) };
  // what the file contains: the stored job as read here. applyStamp keeps counting anything changed after it.
  const counted = { edits: stored.edits || 0, updated: stored.updated || 0 };
  const tank = stored.tankRef ? await db.getTank(stored.tankRef).catch(() => null) : null;
  const head = JSON.stringify({ format: 'tank-floor-inspector', version: FILE_VERSION, saved: new Date(at).toISOString(), rev: stamp.rev }).slice(0, -1) + ',"job":' + JSON.stringify(job) + ',"photos":[';
  const tail = ']' + (tank ? ',"tank":' + JSON.stringify(tank) : '') + ',"appVersion":' + JSON.stringify(APP_VERSION) + '}';
  async function* chunks() {
    yield head;
    let first = true;
    for (const k of keys) {
      const p = await db.getPhoto(k); if (!p) continue;
      yield (first ? '' : ',') + JSON.stringify(p); first = false;
    }
    yield tail;
  }
  return { job, stamp, chunks, counted };
}

/** After a successful save, record the new revision on the stored job (and the open one). */
async function applyStamp(id, job, counted = { edits: 0, updated: 0 }) {
  // changes made while the file was being written are not in it: keep counting them
  const keep = (cur) => {
    const later = Math.max(0, (cur.edits || 0) - counted.edits), after = (cur.updated || 0) > counted.updated;
    return { rev: job.rev, savedAt: job.savedAt, updated: after ? cur.updated : job.updated, revisions: job.revisions, edits: after ? Math.max(later, 1) : 0, editAreas: after ? cur.editAreas || [] : [] };
  };
  if (S.job?.id === id) {
    Object.assign(S.job, keep(S.job));
    await writeNow(); renderHeader();
  } else {
    const stored = await db.getJob(id);
    await db.putJob({ ...stored, ...keep(stored) });
  }
  await loadJobs();
  if (S.view === 'jobs') renderView();
}

function revText(j, long = false) {
  if (!j?.rev) return long ? 'Not saved to a file yet' : '';
  const d = new Date(j.savedAt);
  const when = long ? d.toLocaleString() : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `Rev ${j.rev} · saved ${when}`;
}
const unsavedSinceRev = (j) => { const c = fileChanges(j); return !!j?.rev && (c.n > 0 || !c.known); };

async function fileHandle(id, write) {
  const hnd = await db.getMeta('fh:' + id).catch(() => null);
  if (!hnd) return null;
  const mode = { mode: write ? 'readwrite' : 'read' };
  try {
    if ((await hnd.queryPermission(mode)) === 'granted' || (await hnd.requestPermission(mode)) === 'granted') return hnd;
  } catch { /* handle no longer valid */ }
  return null;
}

/** Remember the file a job lives in. synced = the job on this device now matches that file's content
 *  (just saved or just opened), so a later save can skip re-reading it if nobody has changed it since. */
async function rememberFile(id, hnd, synced) {
  await db.setMeta('fh:' + id, hnd);
  if (synced) { try { const f = await hnd.getFile(); await db.setMeta('fstamp:' + id, { m: f.lastModified, s: f.size }); } catch { /* ignore */ } }
  else await db.setMeta('fstamp:' + id, null);
}

/** Before overwriting a job file, make sure nobody else saved it since this device last did.
 *  Returns 'ok', 'copy', 'open' or 'cancel'. A stage change written from someone's Dashboard
 *  (same revision) is merged into this job instead of being overwritten. */
async function checkFileBeforeSave(id, hnd) {
  let f; try { f = await hnd.getFile(); } catch { return 'ok'; } // file gone or unreadable: writing recreates it
  const st = await db.getMeta('fstamp:' + id).catch(() => null);
  if (!f.size || (st && st.m === f.lastModified && st.s === f.size)) return 'ok';
  let data = null; try { data = JSON.parse(await f.text()); } catch { /* not JSON */ }
  const stored = await db.getJob(id);
  const when = (t) => (t ? new Date(t).toLocaleString() : 'unknown time');
  if (!data || data.format !== 'tank-floor-inspector' || !data.job) {
    return (await askChoice(`${hnd.name} is no longer a Tank Floor Inspector job file. Overwrite it, or save this job to a new file?`, [['cancel', 'Cancel'], ['copy', 'Save to a new file…', 'primary'], ['ok', 'Overwrite', 'danger-solid']])) || 'cancel';
  }
  if (data.job.id !== id) {
    return (await askChoice(`${hnd.name} now holds a different job ("${data.job.info?.tankId || 'untitled'}"). Save this job to a new file instead?`, [['cancel', 'Cancel'], ['copy', 'Save to a new file…', 'primary'], ['ok', 'Overwrite', 'danger-solid']])) || 'cancel';
  }
  const fr = data.job.rev || 0, lr = stored.rev || 0;
  if (fr > lr || (fr === lr && (data.job.savedAt || 0) !== (stored.savedAt || 0))) {
    const msg = `Someone else has saved ${hnd.name} since this device last opened or saved it.\n\n`
      + `File: Rev ${fr}, saved ${when(data.job.savedAt)}\nThis device: based on Rev ${lr}${stored.savedAt ? ', saved ' + when(stored.savedAt) : ''}, last changed ${when(stored.updated)}\n\n`
      + 'Overwriting would replace their changes with yours. Saving a copy keeps both.';
    return (await askChoice(msg, [['cancel', 'Cancel'], ['open', 'Open their version'], ['ok', 'Overwrite their changes', 'danger-solid'], ['copy', 'Save mine as a copy…', 'primary']])) || 'cancel';
  }
  // Same revision: only a Dashboard stage change can differ. Keep whichever stage was set last.
  const fh = data.job.status?.history || [], lh = stored.status?.history || [];
  if (data.job.status?.stage && (fh.at(-1)?.at || 0) > (lh.at(-1)?.at || 0)) {
    const status = { ...(stored.status || {}), stage: data.job.status.stage, history: fh };
    if (S.job?.id === id) { S.job.status = status; await writeNow(); renderHeader(); }
    else await db.putJob({ ...stored, status });
  }
  return 'ok';
}

async function saveJobFile(id = S.job?.id, saveAs = false) {
  if (!id) return;
  if (S.job?.id === id && !(await flushSave())) { toast(`The job file was not written: your latest changes could not be saved to this device first (${saveErrorText(saver.error)}).`, { label: 'Try again', fn: () => saveJobFile(id, saveAs) }); return; }
  if (canPick()) {
    try {
      let hnd = saveAs ? null : await fileHandle(id, true);
      if (hnd) {
        const v = await checkFileBeforeSave(id, hnd);
        if (v === 'cancel') return;
        if (v === 'open') { const nid = await importJobFile(await hnd.getFile()); if (nid) await rememberFile(nid, hnd, true); return; }
        if (v === 'copy') hnd = null;
      }
      const { job, stamp, chunks, counted } = await jobFile(id);
      if (!hnd) hnd = await window.showSaveFilePicker({ suggestedName: fileBase(job) + '.json', id: 'tank-floor-jobs', startIn: 'documents', types: FILE_TYPES });
      const w = await hnd.createWritable();
      try { for await (const c of chunks()) await w.write(c); await w.close(); }
      catch (e) { await w.abort().catch(() => {}); throw e; } // abort leaves the previous file untouched
      await rememberFile(id, hnd, true);
      if (S.job?.id === id) S.fileName = hnd.name;
      await applyStamp(id, job, counted);
      toast(`Saved ${hnd.name} — Rev ${stamp.rev}`);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (e.name === 'NotSavedError') { toast('The job file was not written: ' + e.message + '.'); return; }
      console.warn('Save file failed, downloading instead', e);
    }
  }
  const { job, stamp, chunks, counted } = await jobFile(id);
  const name = fileBase(job) + '.json', parts = [];
  for await (const c of chunks()) parts.push(c);
  download(name, new Blob(parts, { type: 'application/json' }), 'application/json');
  await applyStamp(id, job, counted);
  toast(`Downloaded ${name} (Rev ${stamp.rev}). Move it into your OneDrive folder to share it.`);
}

async function openJobFile() {
  if (canPick()) {
    try {
      const [hnd] = await window.showOpenFilePicker({ id: 'tank-floor-jobs', types: FILE_TYPES, multiple: false });
      const id = await importJobFile(await hnd.getFile());
      if (id) { await rememberFile(id, hnd, true); if (S.job?.id === id) { S.fileName = hnd.name; renderHeader(); } }
      return;
    } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
  }
  $('#openFileInput').click();
}

async function importJobFile(file) {
  if (!file) return null;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== 'tank-floor-inspector' || !data.job) throw new Error('This is not a Tank Floor Inspector job file.');
    if ((data.version || 1) > FILE_VERSION || (data.job.schema || 1) > SCHEMA) throw new Error(`it was saved by a newer version of the app${data.appVersion ? ' (v' + data.appVersion + ')' : ''}. Reload the app to update it (this is v${APP_VERSION}), then open the file again.`);
    const notes = migrationNotes(data.job);
    const job = migrate(data.job);
    if (data.tank?.id && data.tank.id === job.tankRef && !(await db.getTank(data.tank.id))) { await db.putTank(data.tank); await loadTanks(); }
    const exists = await db.getJob(job.id);
    const oldId = job.id;
    if (exists) {
      const when = (t) => (t ? new Date(t).toLocaleString() : 'unknown');
      const newer = (job.updated || 0) >= (exists.updated || 0);
      const rv = (j) => (j.rev ? `Rev ${j.rev}` : 'no rev');
      const replace = await askConfirm(`"${job.info.tankId || 'This job'}" is already on this device.\n\nFile: ${rv(job)}, last changed ${when(job.updated)}${newer ? ' (newer)' : ''}\nThis device: ${rv(exists)}, last changed ${when(exists.updated)}${newer ? '' : ' (newer)'}${unsavedSinceRev(exists) ? ' — has changes not saved to a file' : ''}`, { ok: 'Replace with the file', cancel: 'Keep both (open as a copy)' });
      if (!replace) { job.id = uid(); job.info.tankId = (job.info.tankId || 'Tank') + ' (copy)'; }
    }
    // One transaction: the device copy is only replaced once the whole file has been written.
    const photos = job.id === oldId ? data.photos || [] : copyPhotos(job, data.photos || []);
    await db.replaceJob(job, photos, exists && job.id === oldId ? oldId : null);
    await loadJobs(); toast(`Opened ${file.name}`); await openJob(job.id); checkStorage();
    if (notes.length) showMigrationNotes(notes);
    return job.id;
  } catch (err) { toast('Could not open the file: ' + err.message); return null; }
}

async function resizeImage(file, max, type = 'image/jpeg') {
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL(type, 0.82);
}

/* ---------------------------------------------------------------- misc --- */

async function uploadLoader(file) {
  let res;
  try { res = await readLoader(S.job, await file.arrayBuffer()); }
  catch (err) { toast('Could not read the loader sheet: ' + err.message); return; }
  const lines = [];
  if (!res.jobMatch) lines.push(`This sheet was made for ${res.info.tank || 'another tank'} (a different job). Readings are matched by ID, so only items that exist in this job will be updated.`, '');
  if (res.info.tech) lines.push(`UT technician: ${res.info.tech}${res.info.date ? ' · ' + res.info.date : ''}`);
  for (const s of res.summary) lines.push(`${s.area}: ${s.added} new, ${s.changed} changed`);
  if (res.infoChanges) lines.push(`UT technician / instrument details: ${res.infoChanges} update${res.infoChanges > 1 ? 's' : ''}`);
  if (res.unmatched) lines.push(`${res.unmatched} row${res.unmatched > 1 ? 's' : ''} skipped — the item no longer exists in this job`);
  if (res.errors.length) lines.push('', `${res.errors.length} cell${res.errors.length > 1 ? 's' : ''} could not be read and will be skipped:`, ...res.errors.slice(0, 8).map((e) => '• ' + e), ...(res.errors.length > 8 ? [`• … and ${res.errors.length - 8} more`] : []));
  if (!res.total && !res.infoChanges) { toast(`${file.name}: no new or changed readings${res.errors.length ? ` (${res.errors.length} cell${res.errors.length > 1 ? 's' : ''} could not be read)` : ''}.`); return; }
  if (!(await askConfirm(`Update the report from ${file.name}?\n\n${lines.join('\n')}\n\nBlank cells in the sheet do not erase existing readings.`, { ok: `Update ${res.total} reading${res.total === 1 ? '' : 's'}` }))) return;
  res.apply();
  S.job.utLoads = [...(S.job.utLoads || []), { at: Date.now(), file: file.name, count: res.total, tech: res.info.tech || '' }].slice(-50);
  commit(); renderAll();
  toast(`Updated ${res.total} reading${res.total === 1 ? '' : 's'} from ${file.name}.`);
}

window.addEventListener('tfi-db-blocked', () => toast('Close any other Tank Floor Inspector windows or tabs to finish updating the app.'));
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; renderHeader(); });
window.addEventListener('online', () => { const n = $('#netState'); if (n) n.textContent = 'Online'; });
window.addEventListener('offline', () => { const n = $('#netState'); if (n) n.textContent = 'Offline'; });
/** Save now: commit the field being typed in (blur fires its change event), then write to the device.
 *  Runs when the app is hidden or closed, so a reading typed just before switching apps isn't lost. */
function flushNow() {
  const a = document.activeElement;
  if (a && a !== document.body && a.matches?.('input, textarea, select')) a.blur();
  if (saver.pending()) flushSave();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
window.addEventListener('pagehide', () => { flushNow(); if (!saver.pending()) journal.end(); });
// Closing while a change is not yet on the device: ask first (the browser shows its own wording).
window.addEventListener('beforeunload', (e) => { flushNow(); if (saver.pending()) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('beforeprint', () => { if (S.view !== 'report' && S.job) { S._prevView = S.view; go('report'); } });
window.addEventListener('afterprint', () => { if (S._prevView) { const v = S._prevView; S._prevView = null; go(v); } });

/** Reload into the new version, saving first so nothing typed is lost. */
async function appReload() { flushNow(); if (saver.pending() && !(await leaveJobOk())) return; location.reload(); }

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) { $('#updateBtn').hidden = false; toast('A new version is available.', { label: 'Reload', fn: appReload }); }
      });
    });
  }).catch(() => { /* offline support unavailable */ });
}

/* Screens (navigation registry, js/app/nav.js) */
Object.assign(views, { dash: viewDash, reg: viewReg, jobs: viewJobs, equip: viewEquip, setup: viewSetup, summary: viewSummary, defs: viewDefs, defrep: viewDefRep, map: viewMap, inds: viewInds, plates: viewPlates, api: viewApi, shell: viewShell, nozzles: viewNozzles, });
Object.assign(childViews, { nde: viewNDE, obs: viewObs, photos: viewPhotos, an: viewAnalysis, recs: viewRecs });
configureHost({ commit: () => commit() });
configureNav({
  header: () => renderHeader(),
  leaveRegistry: () => { if (saver.pending()) flushSave(); S.job = null; recompute(); S.photos = []; },
  crumb: (pl) => crumbHTML(pl)
});

(async function init() {
  dbConfig.appVersion = APP_VERSION;
  try { S.company = (await db.getMeta('company')) || {}; }
  catch (e) { dbFailed(e); return; }
  await loadJobs(); await loadTanks();
  await recoverAfterCrash().catch((e) => console.warn('Recovery check', e));
  setTimeout(() => baselineRevisions().catch((e) => console.warn('Baseline revisions', e)).then(() => runIntegrity(false, true)).catch((e) => console.warn('Integrity check', e)), 1500);
  const last = await db.getMeta('lastJob');
  if (last && S.jobs.some((j) => j.id === last)) await openJob(last, 'dash');
  else go('dash');
})();

window.__app = S; // handy for debugging in the console

// equipment picker: float the list above the table (tables scroll and would clip it); close on outside click / scroll
document.addEventListener('click', (e) => { for (const d of document.querySelectorAll('details.eqpick[open]')) if (!d.contains(e.target)) d.open = false; });
document.addEventListener('toggle', (e) => {
  const d = e.target; if (!d.matches?.('details.eqpick') || !d.open) return;
  const pop = d.querySelector('.eqpop'), r = d.querySelector('summary').getBoundingClientRect();
  pop.style.position = 'fixed'; pop.style.left = Math.min(r.left, innerWidth - 300) + 'px';
  const below = innerHeight - r.bottom;
  if (below < 260 && r.top > below) { pop.style.top = ''; pop.style.bottom = (innerHeight - r.top + 4) + 'px'; } else { pop.style.bottom = ''; pop.style.top = (r.bottom + 4) + 'px'; }
}, true);
document.addEventListener('scroll', (e) => { if (e.target.closest?.('.eqpop')) return; for (const d of document.querySelectorAll('details.eqpick[open]')) d.open = false; }, true);
