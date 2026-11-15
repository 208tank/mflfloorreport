// Tank Floor Inspector — main application.
import { db, requestPersistence, dbConfig } from './db.js';
import { pendingSteps } from './migrations.js';
import { createSaver, saveErrorText } from './saver.js';
import { createJournal } from './journal.js';
import { u, toMm, inVal, fmt } from './units.js';
import { buildLayout, plateAt, toLocal, itemFloor, angleOf, refCornerName, datumName, orientName } from './geometry.js';
import { api653, RESULT_SHORT, plateNominal, NZ_CONN, UT_CLOCK, nozzleWall, statusText } from './calc.js';
import { renderMapSVG, MapController } from './map.js';
import { download, indicationsCSV, platesCSV, nozzlesCSV, shellCSV, roofCSV, settleCSV, svgForExport, svgToPng, fileBase } from './export.js';
import { legendHTML } from './report.js';
import { patchList, patchOf } from './patches.js';
import { newJob, migrate, nextNo, uid, setPath, STAGE_LABEL, copyPhotos, SCHEMA, FILE_VERSION, migrationNotes } from './model.js';
import { makeDemo } from './demo.js';
import { rolloutSVG, SHELL_SVG_STYLE } from './shell.js';
import { buildLoader, readLoader, loaderAreas } from './loader.js';
import { editionsFor, supplementsFor } from './tables.js';
import { viewPlace, allDefs, numberDefs } from './sections.js';
import { tankFromJob, tankKeyOf } from './registry.js';
import { rowsFromGrid, measuredFromDrawing } from './builder.js';
import { esc as h } from './util.js';
import { $, $$, toast, askConfirm, askChoice } from './ui.js';
import { indCount } from './cards.js';
import { S, APP_VERSION, byNo, RESULT_OPTS, VT_COND, COATING, UT_METHOD, REPAIR_METHOD, NZ_TYPES, nextMark, FT_TYPES } from './app/state.js';
import { readInput, field, rerenderKeep } from './app/fields.js';
import { resizeImage } from './app/images.js';
import { views, after, configureNav, go, renderAll, renderNav, renderView } from './app/nav.js';
import { onAction, onChange } from './app/actions.js';
import './views/codetables.js';
import './views/report.js';
import { refreshSettle } from './views/settle.js';
import { refreshRoof } from './views/roof.js';
import { refreshShell, shellBuildHTML } from './views/shell.js';
import { nozzleTableHTML, nozzleUTBox } from './views/nozzles.js';
import { writeStageToFile } from './app/folder.js';
import './views/dashboard.js';
import './views/registry.js';
import { crumbHTML } from './views/sections.js';
import './views/summary.js';
import { refreshIndTable, refreshPlateTable } from './views/floorlists.js';
import { refreshApi } from './views/api.js';
import { refreshSetupPreview, refreshBuilder, relocateOrphans, rowLetter, findSec } from './views/setup.js';
import { addRevision, baselineRevisions, recoverAfterCrash, runIntegrity, integrityHTML, renderIntegrity } from './views/history.js';
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

/** Who is making changes on this device: the inspector name from Settings and a per-install id.
 *  Shaped so a signed-in identity (Microsoft Entra ID) can replace it later. */




/** Check the device database. full = also open every photo and verify every revision checksum.
 *  quiet = the background check at start-up: only speaks up if something is wrong. Never changes data. */

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

/* --------------------------------------------------------------- events --- */

/* Button actions (data-act), registered with the action registry (js/app/actions.js). */
onAction({
  'job-new': async (el, id, e, act) => {
    { const j = newJob(); return createJob(j); }
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
  'exp-defs': async (el, id, e, act) => {
    {
      numberDefs(S.job);
      const rows = [['No.', 'Component', 'Location', 'Deficiency', 'Recommended action', 'Priority', 'Due', 'Status', 'Closed', 'Client comment', 'Code reference', 'History']];
      for (const d of allDefs(S.job)) rows.push([d.no || '', d.secLabel, d.loc || '', d.finding || '', d.action || '', d.priority, d.due || '', d.status, d.closedOn || '', d.client || '', d.ref || '', (d.history || []).map((x) => x.date + ' ' + x.status).join('; ')]);
      return download(fileBase(S.job) + '_deficiencies.csv', '\ufeff' + rows.map((r) => r.map((v) => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\r\n'), 'text/csv');
    }
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
function openIndDialog(id) {
  const ind = S.job.indications.find((i) => i.id === id); if (!ind) return;
  S.sel = id;
  const dlg = $('#dlg');
  $('#dlgBody').innerHTML = indEditor(ind, 'dialog');
  if (!dlg.open) dlg.showModal();
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
  { order: 340, when: (el, act) => el.matches('[data-photo-cap]'), run: async (el, e, act) => {
    { const p = S.photos.find((x) => x.id === el.dataset.photoCap); if (p) { p.caption = el.value; await db.putPhoto(p); } return; }
  } },
  { order: 350, when: (el, act) => act === 'toggle', run: async (el, e, act) => {
    { S[el.dataset.k] = el.checked; drawMap(); return; }
  } },
  { order: 370, when: (el, act) => act === 'datum-sel', run: async (el, e, act) => {
    { applyDatum(el.dataset.key, el.value); return; }
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
Object.assign(views, { jobs: viewJobs, map: viewMap, });
configureHost({ commit: () => commit(), scheduleSave: () => scheduleSave(), checkStorage: () => checkStorage(), recompute: () => recompute(), loadJobs: () => loadJobs(), loadTanks: () => loadTanks(), createJob: (j) => createJob(j), leaveJobOk: () => leaveJobOk(), journal, flushSave: () => flushSave(), renderHeader: () => renderHeader(), openJob: (id, v) => openJob(id, v), importJobFile: (f) => importJobFile(f), rememberFile: (id, fh, w) => rememberFile(id, fh, w), drawMap: () => drawMap(), renderSide: () => renderSide(), setMode: (m) => setMode(m), refreshSetupPreview: () => refreshSetupPreview() });
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
