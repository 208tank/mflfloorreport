// Tank Floor Inspector — main application.
import { db, requestPersistence, dbConfig } from './db.js';
import { pendingSteps } from './migrations.js';
import { createSaver, saveErrorText } from './saver.js';
import { createJournal } from './journal.js';
import { buildLayout, itemFloor } from './geometry.js';
import { api653 } from './calc.js';
import { renderMapSVG } from './map.js';
import { download, indicationsCSV, platesCSV, nozzlesCSV, shellCSV, roofCSV, settleCSV, svgForExport, svgToPng, fileBase } from './export.js';
import { newJob, migrate, uid, setPath, STAGE_LABEL, copyPhotos, SCHEMA, FILE_VERSION, migrationNotes } from './model.js';
import { makeDemo } from './demo.js';
import { rolloutSVG, SHELL_SVG_STYLE } from './shell.js';
import { buildLoader, readLoader, loaderAreas } from './loader.js';
import { editionsFor, supplementsFor } from './tables.js';
import { viewPlace, allDefs, numberDefs } from './sections.js';
import { tankFromJob, tankKeyOf } from './registry.js';
import { rowsFromGrid, measuredFromDrawing } from './builder.js';
import { esc as h } from './util.js';
import { $, toast, askConfirm, askChoice } from './ui.js';
import { indCount } from './cards.js';
import { S, APP_VERSION } from './app/state.js';
import { readInput, rerenderKeep } from './app/fields.js';
import { resizeImage } from './app/images.js';
import { views, after, configureNav, go, renderAll, renderNav, renderView } from './app/nav.js';
import { onAction, onChange } from './app/actions.js';
import './views/codetables.js';
import './views/report.js';
import { refreshSettle } from './views/settle.js';
import { refreshRoof } from './views/roof.js';
import { refreshShell, shellBuildHTML } from './views/shell.js';
import { nozzleTableHTML } from './views/nozzles.js';
import { writeStageToFile } from './app/folder.js';
import './views/dashboard.js';
import './views/registry.js';
import { crumbHTML } from './views/sections.js';
import './views/summary.js';
import { drawMap, renderSide, setMode } from './views/floormap.js';
import { refreshApi } from './views/api.js';
import { refreshSetupPreview, refreshBuilder, relocateOrphans } from './views/setup.js';
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
  { order: 270, when: (el, act) => el.matches('[data-cb]'), run: async (el, e, act) => {
    { S.company[el.dataset.cb] = el.value; await db.setMeta('company', S.company); return; }
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
]);

// a value typed while the page was refreshing is put back into the new field; commit it when the field is left
document.addEventListener('focusout', (e) => {
  const el = e.target;
  if (el?.dataset?.restored) { delete el.dataset.restored; if (el.value !== el.defaultValue) el.dispatchEvent(new Event('change', { bubbles: true })); }
});




document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea, select');
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && S.job) { e.preventDefault(); if (typing) e.target.blur(); setTimeout(() => saveJobFile(S.job.id, e.shiftKey), 0); return; }
});


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
Object.assign(views, { jobs: viewJobs, });
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
