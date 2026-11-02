// Tank Floor Inspector — main application.
import { db, requestPersistence } from './db.js';
import { u, toMm, inVal, fmt, fmtRate, unitLabel, num, UNITS } from './units.js';
import { buildLayout, stackSections, suggestCount, halfChord, plateAt, toLocal, itemFloor, angleOf, refCornerName, datumName, orientName } from './geometry.js';
import { api653, RESULTS, RESULT_SHORT, czLimitAuto, plateNominal, NZ_CONN, NZ_CONN_SHORT, UT_CLOCK, nozzleUT } from './calc.js';
import { renderMapSVG, MapController } from './map.js';
import { ROOF_TYPES, FIXED_TYPES, FIXED_SUPPORT, FLOAT_TYPES, PT5, PT5_SHORT, PONT_COND, hasFixed, hasFloating, floatingLayout, roofDiameter, autoPontCount, plateUT, pointStatus, floatingSVG, fixedSVG } from './roof.js';
import { download, indicationsCSV, platesCSV, nozzlesCSV, shellCSV, roofCSV, settleCSV, svgForExport, svgToPng, fileBase } from './export.js';
import { buildReport, legendHTML } from './report.js';
import { newJob, migrate, nextNo, uid, getPath, setPath } from './model.js';
import { makeDemo } from './demo.js';
import { defaultShell, defaultZones, autoLocCount, autoPlateCount, utLocations, coursesWithElev, courseAt, coursePlates, shellHeight, courseSummary, readingElevations, zoneCount, getReading, fmtElev, zKey, rolloutSVG, SHELL_SVG_STYLE, SPACING_MM } from './shell.js';
import { buildLoader, readLoader, loaderAreas } from './loader.js';
import { SEAL_STDS, PRIMARY_TYPES, SECONDARY_TYPES, SEAL_CHECKS, newGap, gapSummary, cm2mToIn2ft, sealEval, activeStds, nextDue } from './seal.js';
import { WELDS, ELEV_UNITS, PSI_PER_MPA, DEP_K, newEdge, newDep, stations, stationCount, autoN, settleHeight, settleCalc, slopeText, edgeEval, depEval, EDGE_NOTE, settlePlanSVG, settleChartSVG } from './settle.js';
import { newRow, rowsFromGrid, rowsCentreBlock, coverage, newPlate, newMeasuredSection, measuredFromDrawing } from './builder.js';

const APP_VERSION = '2.6.0';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  jobs: [], job: null, layout: null, calc: null, photos: [], company: {},
  view: 'jobs', sel: null, selPlate: null, selFeature: null, selNozzle: null, mode: 'select', ftType: 'column',
  plateLabels: true, indLabels: true, showCZ: true, showDatums: true, filter: new Set(Object.keys(RESULTS)),
  search: '', resFilter: 'all', sort: { key: 'no', dir: 1 }, plateSearch: '',
  reportOpts: { photos: true, plates: false, provenOnly: false, plateLabels: true, datums: true },
  mapCtl: null, vb: null, roofSel: null, roofPt: null, roofAdd: false, roofVB: { fixed: null, floating: null }, installEvt: null, saving: false
};

const VIEWS = [
  ['jobs', 'Jobs', 'M4 5h16M4 12h16M4 19h10'],
  ['setup', 'Tank setup', 'M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
  ['map', 'Floor map', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3v18'],
  ['inds', 'Indications', 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'],
  ['plates', 'Plates', 'M3 4h8v7H3zM13 4h8v7h-8zM3 13h8v7H3zM13 13h8v7h-8z'],
  ['api', 'API 653', 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3'],
  ['shell', 'Shell UT', 'M4 5h16v14H4zM4 10h16M4 15h16M9 5v14M15 5v14'],
  ['roof', 'Roof', 'M3 11l9-7 9 7M5 10v9h14v-9M9 19v-5h6v5'],
  ['settle', 'Settlement', 'M3 7h18M3 7l3 11h12l3-11M8 12l8 3'],
  ['report', 'Report', 'M6 3h9l4 4v14H6zM14 3v5h5']
];

const RESULT_OPTS = Object.entries(RESULTS);
const VT_COND = ['', 'None visible', 'Isolated pit', 'Pitting cluster', 'General corrosion', 'Lake / area corrosion', 'Weld corrosion', 'Mechanical damage', 'Lamination / inclusion', 'Other'];
const COATING = ['', 'None', 'Intact', 'Blistered', 'Disbonded', 'Failed / missing'];
const UT_METHOD = ['', 'A-scan', 'B-scan', 'C-scan / mapping', 'Thickness gauge', 'Other'];
const REPAIR_METHOD = ['', 'Patch plate (lap welded)', 'Weld build-up', 'Insert plate', 'Plate replacement', 'Coating / lining', 'Monitor', 'Other'];
const NZ_TYPES = ['Nozzle', 'Manway', 'Inlet', 'Outlet', 'Water draw / drain', 'Clean-out door', 'Mixer', 'Level / instrument', 'Other'];
const nzPrefix = (t) => (/manway/i.test(t) ? 'MH' : /clean-out/i.test(t) ? 'CO' : 'N');
function nextMark(type) {
  const pre = nzPrefix(type); let max = 0;
  for (const n of S.job.nozzles || []) { const m = String(n.mark || '').match(new RegExp('^' + pre + '(\\d+)$')); if (m) max = Math.max(max, +m[1]); }
  return pre + (max + 1);
}
const FT_TYPES = [['column', 'Roof column'], ['sump', 'Sump'], ['patch', 'Patch plate / repair'], ['nozzle', 'Nozzle / fitting'], ['manway', 'Manway'], ['other', 'Other']];

/* ---------------------------------------------------------------- state ---- */

function recompute() {
  if (!S.job) { S.layout = null; S.calc = null; return; }
  S.layout = buildLayout(S.job);
  S.calc = api653(S.job, S.layout);
}

let saveTimer = null;
function scheduleSave() {
  S.job.updated = Date.now();
  setSaveState('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}
async function flushSave() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!S.job) return;
  try { await db.putJob(S.job); setSaveState('Saved locally'); renderFileState(); }
  catch (e) { setSaveState('Not saved'); toast('Could not save to this device: ' + e.message); }
}
function renderFileState() { if ($('#fileState')) renderHeader(); }
function setSaveState(t) { const el = $('#saveState'); if (el) { el.textContent = t; el.dataset.state = t; } }

function commit() { recompute(); scheduleSave(); }

async function loadJobs() { S.jobs = (await db.allJobs()).sort((a, b) => (b.updated || 0) - (a.updated || 0)); }

async function openJob(id, view = 'map') {
  await flushSave();
  const j = await db.getJob(id);
  if (!j) return toast('Job not found');
  S.job = migrate(j);
  S.photos = await db.jobPhotos(id);
  const fh = await db.getMeta('fh:' + id).catch(() => null);
  S.fileName = fh?.name || null;
  S.sel = S.selPlate = S.selFeature = null; S.mode = 'select'; S.vb = null;
  recompute();
  await db.setMeta('lastJob', id);
  go(S.job.tank.diameter ? view : 'setup');
}

async function createJob(job) {
  await db.putJob(job);
  await loadJobs();
  await openJob(job.id, job.tank.diameter ? 'map' : 'setup');
}

/* ---------------------------------------------------------------- shell ---- */

function go(view) {
  if (!S.job && view !== 'jobs') view = 'jobs';
  S.view = view;
  if (view !== 'map') { S.mode = 'select'; }
  renderAll();
  $('#main').scrollTop = 0;
}

function renderAll() { renderHeader(); renderNav(); renderView(); }

function renderHeader() {
  const j = S.job;
  $('#jobTitle').innerHTML = j ? `<b>${h(j.info.tankId || 'Untitled tank')}${j.rev ? ` <em class="rev">Rev ${j.rev}</em>` : ''}</b><span>${h([j.info.client, j.info.site, j.info.inspDate].filter(Boolean).join(' · '))}</span>` : '<span>No job open</span>';
  const fs = $('#fileState');
  if (fs) {
    fs.hidden = !j;
    fs.textContent = j ? (j.rev ? (unsavedSinceRev(j) ? `Rev ${j.rev} · unsaved changes` : revText(j)) : 'Not saved to a file') : '';
    fs.dataset.state = j && (!j.rev || unsavedSinceRev(j)) ? 'dirty' : 'clean';
    fs.title = j?.rev ? `${revText(j, true)}${S.fileName ? ' to ' + S.fileName : ''}` : 'Save file… keeps a copy in OneDrive and starts the revision count';
  }
  $('#exportMenu').hidden = !j;
  $('#saveFileBtn').hidden = !j;
  $('#saveFileBtn').title = S.fileName ? `Save to ${S.fileName} (Ctrl+S)` : 'Save this job to a file, e.g. in OneDrive (Ctrl+S)';
  $('#saveFileBtn').textContent = S.fileName ? 'Save' : 'Save file…';
  $('#installBtn').hidden = !S.installEvt;
}

function renderNav() {
  const counts = { inds: S.job?.indications.length, plates: S.layout?.plates.length };
  $('#nav').innerHTML = VIEWS.map(([id, label, d]) => `<button class="nav-btn${S.view === id ? ' active' : ''}" data-go="${id}" ${!S.job && id !== 'jobs' ? 'disabled' : ''}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>
    <span>${label}</span>${counts[id] ? `<em>${counts[id]}</em>` : ''}</button>`).join('') +
    `<div class="nav-foot">v${APP_VERSION}<br><span id="netState">${navigator.onLine ? 'Online' : 'Offline'}</span></div>`;
}

function renderView() {
  const main = $('#main');
  main.className = 'main view-' + S.view;
  const fn = { jobs: viewJobs, setup: viewSetup, map: viewMap, inds: viewInds, plates: viewPlates, api: viewApi, shell: viewShell, roof: viewRoof, settle: viewSettle, report: viewReport }[S.view];
  main.innerHTML = fn();
  after[S.view]?.();
}
const after = {};

/* ------------------------------------------------------------ form bits ---- */

function valOf(v, kind) {
  if (kind === 'big' || kind === 'small' || kind === 't') return inVal(v, kind, S.job);
  return v ?? '';
}
function readInput(el) {
  const k = el.dataset.kind || 'text';
  if (k === 'bool') return el.checked;
  const v = el.value.trim();
  if (k === 'big' || k === 'small' || k === 't') return toMm(v, k, S.job);
  if (k === 'num') return num(v);
  return v;
}
function unitFor(kind, extra) {
  if (extra.unit) return extra.unit;
  if (kind === 'big' || kind === 'small' || kind === 't') return unitLabel(kind === 't' ? 'small' : kind, S.job);
  return '';
}
/** Generic labelled field. attr = 'data-bind' (job path) or other binding attr. */
function field(label, key, kind = 'text', extra = {}) {
  const attr = extra.attr || 'data-bind';
  const v = extra.value !== undefined ? extra.value : getPath(S.job, key);
  const id = 'f_' + Math.random().toString(36).slice(2, 8);
  const common = `id="${id}" ${attr}="${h(key)}" data-kind="${kind}" ${extra.attrs || ''}`;
  let input;
  if (kind === 'bool') return `<label class="chk${extra.cls ? ' ' + extra.cls : ''}"><input type="checkbox" ${common} ${v ? 'checked' : ''}><span>${label}</span></label>`;
  if (kind === 'sel') input = `<select ${common}>${extra.options.map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o || '—']; return `<option value="${h(val)}" ${String(v ?? '') === String(val) ? 'selected' : ''}>${h(lab)}</option>`; }).join('')}</select>`;
  else if (kind === 'area') input = `<textarea ${common} rows="${extra.rows || 3}" placeholder="${h(extra.ph || '')}">${h(v)}</textarea>`;
  else {
    const type = kind === 'date' ? 'date' : 'text';
    const im = ['big', 'small', 't', 'num'].includes(kind) ? 'inputmode="decimal"' : '';
    input = `<input type="${type}" ${im} ${common} value="${h(valOf(v, kind))}" placeholder="${h(extra.ph ?? '')}" ${extra.list ? `list="${extra.list}"` : ''} autocomplete="off">`;
  }
  const un = unitFor(kind, extra);
  return `<label class="fld${extra.cls ? ' ' + extra.cls : ''}" for="${id}"><span class="lbl">${label}</span><span class="ctl">${input}${un ? `<i class="unit">${un}</i>` : ''}</span>${extra.hint ? `<small>${extra.hint}</small>` : ''}</label>`;
}

/* ------------------------------------------------------------- jobs view --- */

function viewJobs() {
  const rows = S.jobs.map((j) => `<tr class="${S.job?.id === j.id ? 'cur' : ''}">
    <td><b>${h(j.info?.tankId || 'Untitled')}</b><br><small>${h(j.info?.reportNo || '')}</small></td>
    <td>${h(j.info?.client)}<br><small>${h(j.info?.site)}</small></td>
    <td>${h(j.info?.inspDate)}</td><td class="n">${j.indications?.length || 0}</td>
    <td>${j.rev ? `<b>Rev ${j.rev}</b><br><small>saved ${new Date(j.savedAt).toLocaleString()}</small>${unsavedSinceRev(j) ? '<br><small class="warn-txt">changes since</small>' : ''}` : '<small class="muted">not saved to a file</small>'}</td>
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
        <p id="storageInfo" class="muted">Checking storage…</p>
        <p class="muted">Install the app from the browser's address bar (or the Install button above) so it opens full-window and works without a connection.</p>
        <button class="btn sm" data-act="persist">Ask browser to keep data permanently</button>
      </section>
    </div></div>`;
}
after.jobs = async () => {
  const el = $('#storageInfo');
  try {
    const est = await navigator.storage?.estimate?.();
    const pers = await navigator.storage?.persisted?.();
    if (el && est) el.textContent = `Using ${(est.usage / 1048576).toFixed(1)} MB of ${(est.quota / 1048576 / 1024).toFixed(1)} GB available. Storage is ${pers ? 'persistent' : 'best-effort (browser may clear it if disk is low)'}.`;
  } catch { if (el) el.textContent = ''; }
};

/* ------------------------------------------------------------ setup view --- */

function viewSetup() {
  const j = S.job, L = j.layout, hasInd = j.indications.length > 0;
  const yesno = [['true', 'Yes'], ['false', 'No']];
  return `<div class="page">
  <div class="page-head"><div><h1>Tank setup</h1><p class="muted">Tank details, plate layout and equipment. The floor map updates as you type.</p></div>
    <div class="acts"><button class="btn primary" data-go="map">Go to floor map →</button></div></div>
  <div class="setup-grid">
    <div class="setup-forms">
      <section class="card"><h2>Inspection</h2><div class="fgrid">
        ${field('Client', 'info.client')}${field('Facility / site', 'info.site')}
        ${field('Tank ID', 'info.tankId')}${field('Product', 'info.product')}
        ${field('Report no.', 'info.reportNo')}${field('Work order', 'info.workOrder')}
        ${field('Inspection date', 'info.inspDate', 'date')}${field('0° reference label', 'info.zeroRef', 'text', { ph: 'e.g. N, manway, inlet' })}
        ${field('MFL operator', 'info.mflTech')}${field('UT technician', 'info.utTech')}
        ${field('API 653 inspector', 'info.inspector')}${field('Date of UT readings', 'info.utDate', 'text', { ph: 'from the UT loader sheet' })}
      </div></section>

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

      <section class="card" id="nozzleCard">${nozzleTableHTML()}</section>

      ${L.mode !== 'grid' ? `<section class="card" id="builderCard">${L.mode === 'measured' ? measuredHTML() : builderHTML()}</section>` : ''}

      <section class="card"><h2>Equipment</h2><div class="fgrid">
        ${field('MFL scanner make', 'equip.mflMake')}${field('MFL model', 'equip.mflModel')}
        ${field('MFL serial no.', 'equip.mflSerial')}${field('MFL calibration date', 'equip.mflCal')}
        ${field('MFL reference plate', 'equip.mflRef')}${field('MFL reporting threshold', 'equip.mflThreshold', 'text', { unit: '%' })}
        ${field('MFL sensitivity / settings', 'equip.mflSettings', 'text', { cls: 'span2' })}
        ${field('UT instrument make', 'equip.utMake')}${field('UT model', 'equip.utModel')}
        ${field('UT serial no.', 'equip.utSerial')}${field('UT probe', 'equip.utProbe')}
        ${field('UT calibration block', 'equip.utBlock')}${field('VT tools', 'equip.vtTools')}
      </div></section>
      <section class="card"><h2>Notes</h2>${field('General notes for the report', 'info.notes', 'area', { rows: 4 })}</section>
    </div>
    <aside class="setup-preview card"><div class="sp-head"><h2>Layout preview</h2><span id="spStats" class="muted small"></span></div><div id="spMap" class="sp-map"></div></aside>
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
      <td><div class="cnt"><button class="btn sm icon" data-act="row-n" data-row="${r.id}" data-d="-1" title="One plate fewer">−</button>${f(r, 'n', 'num')}<button class="btn sm icon" data-act="row-n" data-row="${r.id}" data-d="1" title="One plate more">+</button>${sug && sug !== +r.n ? `<button class="sug" data-act="row-sug" data-row="${r.id}" data-v="${sug}" title="Fits the chord with full plates in the middle">fits ${sug}</button>` : ''}</div></td>
      <td>${r.type === 'block' ? f(r, 'w', 'big', inVal(L.plateW, 'big', S.job), 'title="Plate width"') : f(r, 'len', 'big', inVal(L.plateL, 'big', S.job), 'title="Full plate length"')}</td>
      <td>${f(r, 'off', 'big', '0', 'title="Shift plates along the row (stagger)"')}</td>
      <td>${r.type === 'block' ? `${f(r, 'sideH', 'big', inVal(L.plateW, 'big', S.job), 'title="Side sketch-plate row width" class="sm"')} × ${f(r, 'sideN', 'num', '1', 'title="Plates per side row" class="xs"')}` : '<span class="muted small">—</span>'}</td>
      <td class="n muted">${plates}</td>
      <td class="rowacts">
        <button class="btn sm icon ghost" data-act="row-move" data-row="${r.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
        <button class="btn sm icon ghost" data-act="row-move" data-row="${r.id}" data-d="1" ${i === rows.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
        <button class="btn sm icon ghost" data-act="row-add" data-at="${i}" data-type="row" title="Insert a row above">⊕</button>
        <button class="btn sm icon ghost danger" data-act="row-del" data-row="${r.id}" title="Delete">✕</button></td></tr>`;
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
function focusSel(el) {
  const attrs = ['data-rowf', 'data-row', 'data-secf', 'data-sec', 'data-mpf', 'data-pl', 'data-shc', 'data-shut', 'data-course', 'data-z', 'data-zf', 'data-zone', 'data-rut', 'data-pt', 'data-rpt', 'data-f', 'data-rpc', 'data-sg', 'data-gid', 'data-sck', 'data-sckn', 'data-st', 'data-se', 'data-sd', 'data-eid', 'data-sts', 'data-bind', 'data-act'];
  const parts = attrs.filter((k) => el.hasAttribute(k)).map((k) => `[${k}="${CSS.escape(el.getAttribute(k))}"]`);
  return parts.length ? el.tagName.toLowerCase() + parts.join('') : null;
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
        <button class="x" data-act="mp-del" ${sa} data-pl="${pl.id}" title="Remove plate">✕</button></span>`).join('');
    return `<div class="msec ${blk ? 'blk' : ''}">
      <div class="msec-head"><b class="lt">${rowLetter(i)}</b>${blk ? '<span class="chip blk">Block</span>' : '<span class="chip rw">Row</span>'}
        <label>${blk ? 'Depth' : 'Row width'} ${inp(`data-secf="h" ${sa}`, sec.h, '', blk ? 'Block depth (plate length)' : 'Row width (plate width)')}</label>
        <label>Offset ${inp(`data-secf="off" ${sa}`, sec.off, '0', 'Shift plates along the row')}</label>
        ${blk ? `<label>Side rows ${inp(`data-secf="sideH" ${sa}`, sec.sideH, inVal(L.plateW, 'big', S.job), 'Side sketch-plate row width')} × <input data-secf="sideN" ${sa} data-kind="num" inputmode="numeric" value="${h(sec.sideN ?? 1)}" title="Plates per side row" class="xs"></label>` : ''}
        ${(() => { const out = (sec.plates || []).filter((pl) => !labelOf.has(pl.id)).length; return `<span class="tot ${out || (chord && tot < chord - 25) ? 'warn-txt' : 'muted'}">${blk ? 'widths' : 'lengths'} ${fmt(tot, 'big', S.job)}${chord ? ` · floor ${fmt(chord, 'big', S.job)}` : ''}${out ? ` · <b>${out} plate${out > 1 ? 's' : ''} outside the shell</b>` : ''}</span>`; })()}
        <span class="rowacts"><button class="btn sm icon ghost" data-act="msec-move" ${sa} data-d="-1" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button><button class="btn sm icon ghost" data-act="msec-move" ${sa} data-d="1" ${i === secs.length - 1 ? 'disabled' : ''} title="Move down">↓</button><button class="btn sm icon ghost" data-act="msec-add" data-at="${i}" data-type="row" title="Insert a row above">⊕</button><button class="btn sm icon ghost danger" data-act="msec-del" ${sa} title="Delete">✕</button></span></div>
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
      </div>
      <div class="seg zoom"><button class="btn sm icon" data-act="zoom-out" title="Zoom out">−</button><button class="btn sm icon" data-act="zoom-in" title="Zoom in">+</button><button class="btn sm" data-act="zoom-fit" title="Fit (F)">Fit</button></div>
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
    plateLabels: S.plateLabels, indLabels: S.indLabels, filter: S.filter, showCZ: S.showCZ,
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
        <button class="btn sm icon" data-act="ind-nav" data-d="-1" ${idx <= 0 ? 'disabled' : ''} title="Previous">‹</button>
        <button class="btn sm icon" data-act="ind-nav" data-d="1" ${idx >= inds.length - 1 ? 'disabled' : ''} title="Next">›</button>
        <button class="btn sm icon ghost" data-act="ind-close" title="Close (Esc)">✕</button>
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
      ${f('Length', 'len', 'small')}${f('Width', 'wid', 'small')}
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
      ${f('Comments', 'comments', 'area', { rows: 2, cls: 'span2' })}
    </div></fieldset>
    <fieldset><legend>Photos</legend>
      <div class="photos-ed">${photos.map((p) => `<figure><img src="${p.dataUrl}" alt="" data-act="photo-view" data-id="${p.id}"><input data-photo-cap="${p.id}" value="${h(p.caption)}" placeholder="Caption"><button class="btn sm ghost danger" data-act="photo-del" data-id="${p.id}" title="Delete photo">✕</button></figure>`).join('')}
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
  </div><div class="sum-status ${cls}">${st === 'n/a' ? 'Not used in calculation' : h(st === 'repair (calc)' ? 'Repair — below MRT at next inspection' : st === 'repair' ? 'Repair — specified' : st === 'below MRT' ? 'Below MRT — repair set to No' : st === 'pending' ? 'Pending prove-up' : st === 'no action' ? 'No action' : st === 'OK' ? 'Acceptable for next interval' : st)}</div>`;
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
  return `<div class="ed" data-ed="nozzle" data-id="${nz.id}"><div class="ed-head"><div class="ed-title"><span>Shell nozzle</span><b>${h(nz.mark || '')}</b></div><div class="acts"><button class="btn sm icon ghost" data-act="close-sel">✕</button></div></div>
    <div class="fgrid">
      ${f('Mark', 'mark')}${f('Type', 'type', 'sel', { options: NZ_TYPES })}
      ${f('Angle (clockwise from 0°)', 'angle', 'num', { unit: '°' })}${f('Size (nominal / opening)', 'size', 'small')}
      ${f('Elevation to centreline', 'elev', 'small', { hint: 'Above the tank bottom' })}${f('Service / description', 'service', 'text', { ph: 'e.g. Inlet, 4" drain' })}
      ${f('Connection', 'conn', 'sel', { options: NZ_CONN, cls: 'span2' })}
      ${f('Notes', 'notes', 'area', { rows: 2, cls: 'span2' })}
    </div>
    <fieldset><legend>Neck UT</legend><div class="fgrid g3">
      ${f('Schedule / class', 'sched', 'text', { ph: 'e.g. Sch 40, STD, XS' })}${f('Nominal wall', 'tNom', 't')}${f('t-min (required)', 'tMin', 't')}
    </div>
    <div class="ut-clock">${UT_CLOCK.map(([k, lab]) => field(`${lab} o’clock`, k, 't', { attr: 'data-nb', value: nz[k], attrs: `data-id="${nz.id}"` })).join('')}</div>
    <div class="ut-extra">${(nz.utx || []).map((r) => `<div class="utx-row"><input data-nbx="loc" data-id="${nz.id}" data-rid="${r.id}" data-kind="text" value="${h(r.loc || '')}" placeholder="Location, e.g. flange side 12"><span class="ctl"><input data-nbx="t" data-id="${nz.id}" data-rid="${r.id}" data-kind="t" inputmode="decimal" value="${h(inVal(r.t, 't', S.job))}"><i class="unit">${u(S.job).small}</i></span><button class="btn sm icon ghost danger" data-act="utx-del" data-id="${nz.id}" data-rid="${r.id}" title="Remove reading">✕</button></div>`).join('')}
      <button class="btn sm" data-act="utx-add" data-id="${nz.id}">+ Reading</button></div>
    <div class="nz-ut" data-part="nzut">${nozzleUTBox(nz)}</div>
    </fieldset>
    <p class="muted small">Nozzles are located by angle around the shell, measured clockwise from 0° ${h(S.job.info.zeroRef || '')}. All nozzles are listed in Tank setup → Shell nozzles and in the report.</p>
    <div class="ed-foot"><span></span><button class="btn sm danger ghost" data-act="nozzle-del" data-id="${nz.id}">Delete nozzle</button></div></div>`;
}

function refreshNozzleUT(nz) {
  const b = $(`[data-ed="nozzle"][data-id="${nz.id}"] [data-part="nzut"]`); if (b) b.innerHTML = nozzleUTBox(nz);
  const r = nozzleUT(nz);
  const m = $(`[data-part="min-${nz.id}"]`); if (m) m.textContent = r.count ? fmt(r.min, 't', S.job, false) : '—';
  const st = $(`[data-part="st-${nz.id}"]`); if (st) { st.innerHTML = `<span class="st ${r.status === 'OK' ? 'st-OK' : r.status ? 'st-below-MRT' : ''}">${r.status || ''}</span>`; st.closest('tr')?.classList.toggle('is-bad', r.status === 'Below t-min'); }
}

function nozzleUTBox(nz) {
  const r = nozzleUT(nz);
  if (!r.count) return '<span class="muted small">No UT readings yet.</span>';
  return `<div class="sum-grid three"><div><span>Min. reading</span><b>${fmt(r.min, 't', S.job)}</b><small>${r.count} reading${r.count > 1 ? 's' : ''}</small></div>
    <div><span>Wall loss</span><b>${r.lossPct != null ? r.lossPct.toFixed(0) + '%' : '—'}</b><small>${nz.tNom ? 'vs ' + fmt(nz.tNom, 't', S.job) : 'enter nominal'}</small></div>
    <div><span>Status</span><b class="${r.status === 'OK' ? 'ok' : r.status ? 'bad' : ''}">${r.status || '—'}</b><small>${nz.tMin ? 't-min ' + fmt(nz.tMin, 't', S.job) : 'enter t-min'}</small></div></div>`;
}

function nozzleTableHTML() {
  const list = (S.job.nozzles || []);
  const U = u(S.job);
  const inp = (n, k, kind, extra = '') => kind === 'sel'
    ? `<select data-nb="${k}" data-id="${n.id}" data-kind="text">${NZ_TYPES.map((t) => `<option ${n[k] === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`
    : kind === 'conn'
      ? `<select data-nb="${k}" data-id="${n.id}" data-kind="text">${NZ_CONN.map(([v, l]) => `<option value="${v}" ${(n[k] || '') === v ? 'selected' : ''}>${v ? NZ_CONN_SHORT[v] : '—'}</option>`).join('')}</select>`
      : `<input data-nb="${k}" data-id="${n.id}" data-kind="${kind}" ${kind !== 'text' ? 'inputmode="decimal" class="num"' : ''} value="${h(kind === 'small' || kind === 't' ? inVal(n[k], kind, S.job) : n[k] ?? '')}" ${extra}>`;
  return `<div class="sp-head"><h2>Shell nozzles</h2><span class="muted small">${list.length} on the shell</span></div>
    <p class="muted small">Angle is clockwise from 0° (${h(S.job.info.zeroRef || 'the 0° reference')}). Neck UT readings at 12, 3, 6 and 9 o’clock; add more readings by clicking the nozzle on the Floor map. Thickness in ${U.small}.</p>
    <div class="tblwrap"><table class="grid nozzles"><thead><tr><th>Mark</th><th>Type</th><th>Connection</th><th>Angle (°)</th><th>Size (${U.small})</th><th>Elev. (${U.small})</th><th>Schedule</th><th>Nom. wall</th><th>t-min</th>${UT_CLOCK.map(([, l]) => `<th>${l}:00</th>`).join('')}<th>Min</th><th>Status</th><th>Service / description</th><th></th></tr></thead><tbody>
    ${list.slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0)).map((n) => { const r = nozzleUT(n); return `<tr class="${r.status === 'Below t-min' ? 'is-bad' : ''}"><td>${inp(n, 'mark', 'text', 'class="mk"')}</td><td>${inp(n, 'type', 'sel')}</td><td>${inp(n, 'conn', 'conn')}</td><td>${inp(n, 'angle', 'num')}</td><td>${inp(n, 'size', 'small')}</td><td>${inp(n, 'elev', 'small')}</td><td>${inp(n, 'sched', 'text', 'class="sch"')}</td><td>${inp(n, 'tNom', 't')}</td><td>${inp(n, 'tMin', 't')}</td>${UT_CLOCK.map(([k]) => `<td>${inp(n, k, 't')}</td>`).join('')}<td class="n" data-part="min-${n.id}">${r.count ? fmt(r.min, 't', S.job, false) + ((n.utx || []).length ? `<sup title="Includes ${(n.utx || []).length} extra reading(s)">+${(n.utx || []).length}</sup>` : '') : '—'}</td><td data-part="st-${n.id}"><span class="st ${r.status === 'OK' ? 'st-OK' : r.status ? 'st-below-MRT' : ''}">${r.status || ''}</span></td><td>${inp(n, 'service', 'text')}</td><td><button class="btn sm icon ghost danger" data-act="nozzle-del" data-id="${n.id}" title="Delete">✕</button></td></tr>`; }).join('') || '<tr><td colspan="17" class="empty">No nozzles yet.</td></tr>'}
    </tbody></table></div>
    <div class="acts"><button class="btn sm" data-act="nozzle-add">+ Nozzle</button><button class="btn sm" data-act="exp-noz">Export CSV</button></div>`;
}

function featureEditor() {
  const ft = S.job.features.find((x) => x.id === S.selFeature); if (!ft) return sideOverview();
  const p = S.layout.byKey.get(ft.plate);
  const f = (label, key, kind = 'text', extra = {}) => field(label, key, kind, { ...extra, attr: 'data-fb', value: ft[key] });
  return `<div class="ed" data-ed="feature" data-id="${ft.id}"><div class="ed-head"><div class="ed-title"><span>Floor feature</span></div><div class="acts"><button class="btn sm icon ghost" data-act="close-sel">✕</button></div></div>
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
  return `<div class="ed" data-ed="plate" data-key="${key}"><div class="ed-head"><div class="ed-title"><span>Plate</span><b>${h(p.label)}</b></div><div class="acts"><button class="btn sm icon ghost" data-act="close-sel">✕</button></div></div>
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
        <button class="btn sm icon" data-act="row-n" data-row="${r.id}" data-d="-1" title="One plate fewer">−</button><button class="btn sm icon" data-act="row-n" data-row="${r.id}" data-d="1" title="One plate more">+</button></div>
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
  const C = S.job.calc, met = S.job.units === 'metric';
  const v = (mm) => (met ? `${mm.toFixed(2)} mm` : `${(mm / 25.4).toFixed(3)} in`);
  const f = (label, key, kind, extra = {}) => field(label, 'calc.' + key, kind, extra);
  return `<div class="page">
  <div class="page-head"><div><h1>API 653 bottom evaluation</h1><p class="muted">Minimum remaining thickness at the next internal inspection (API 653 §4.4.7). Check the limits against the edition in force and the tank's design.</p></div></div>
  <div class="api-grid">
    <section class="card"><h2>Inputs</h2><div class="fgrid">
      ${f('Oᵣ — years to next internal inspection', 'Or', 'num', { unit: 'yr' })}
      ${f('Corrosion rate basis', 'years', 'num', { unit: 'yr', hint: 'Years in service, or since the last baseline' })}
      ${f('Min. remaining — bottom plates', 'mrtBottom', 't')}
      ${f('Min. remaining — annular plates', 'mrtAnnular', 't', { hint: 'See Table 4.5 where annular plates are required' })}
      <div class="span2 presets"><span class="muted small">Bottom limit presets:</span>
        <button class="btn sm" data-act="mrt-preset" data-v="2.54">${v(2.54)} — no leak detection / containment</button>
        <button class="btn sm" data-act="mrt-preset" data-v="1.27">${v(1.27)} — with leak detection &amp; containment</button>
        <button class="btn sm" data-act="mrt-preset" data-v="1.27">${v(1.27)} — reinforced lining &gt; 0.05 in</button></div>
      ${f('Critical zone width (from shell)', 'czDist', 'small')}
      ${f('Critical zone limit', 'czLimit', 't', { ph: inVal(czLimitAuto(S.job), 't', S.job), hint: 'Blank = auto: ½ original plate t or ½ shell t-min, ≥ 0.1 in' })}
      ${f('Lower shell course t-min', 'shellTmin', 't', { hint: 'Optional, for the critical zone limit' })}<div></div>
      ${f('Product side coated, coating life ≥ Oᵣ (StPᵣ = 0)', 'coated', 'bool', { cls: 'span2' })}
      ${f('Effective cathodic protection (UPᵣ = 0)', 'cp', 'bool', { cls: 'span2' })}
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
  const c = S.calc, t = (mm) => fmt(mm, 't', S.job), tn = (mm) => fmt(mm, 't', S.job, false);
  const reps = S.job.indications.filter((i) => c.per.get(i.id)?.repair || c.per.get(i.id)?.status === 'below MRT').sort(byNo);
  el.innerHTML = `<h2>Results</h2>
    <p class="formula">MRT = min(RT<sub>bc</sub>, RT<sub>ip</sub>) − O<sub>r</sub>(StP<sub>r</sub> + UP<sub>r</sub>)</p>
    <div class="rates"><div><span>StP<sub>r</sub> product side</span><b>${fmtRate(c.StPr, S.job)}</b><small>${c.C.coated ? 'coated → 0' : c.stSrc === 'override' ? 'entered' : c.stSrc ? 'from ' + h(c.stSrc.no) : 'no product side loss'}</small></div>
      <div><span>UP<sub>r</sub> soil side</span><b>${fmtRate(c.UPr, S.job)}</b><small>${c.C.cp ? 'effective CP → 0' : c.upSrc === 'override' ? 'entered' : c.upSrc ? 'from ' + h(c.upSrc.no) : 'no soil side loss'}</small></div>
      <div><span>Loss over O<sub>r</sub></span><b>${t(c.Or * c.K)}</b><small>${c.Or} yr × combined rate</small></div></div>
    <table class="grid"><thead><tr><th>Area (${u(S.job).small})</th><th class="n">RT<sub>ip</sub></th><th class="n">RT<sub>bc</sub></th><th class="n">MRT</th><th class="n">Min.</th><th class="n">Max. O<sub>r</sub></th><th></th></tr></thead><tbody>
    ${c.regions.map((r) => `<tr><td>${h(r.label)}</td><td class="n">${tn(r.RTip)}</td><td class="n">${tn(r.RTbc)}</td><td class="n"><b>${tn(r.MRT)}</b></td><td class="n">${tn(r.limit)}</td><td class="n">${r.OrMax == null ? '—' : Number.isFinite(r.OrMax) ? Math.max(0, r.OrMax).toFixed(1) + ' yr' : '∞'}</td><td class="${r.ok ? 'ok' : 'bad'}">${r.ok == null ? '—' : r.ok ? '✓ OK' : '✕ Fails'}</td></tr>`).join('')}
    </tbody></table>
    <p class="muted small">Any unrepaired location thinner than <b>${t(c.regions[0]?.tReq)}</b> today (bottom plates) will be below the minimum after ${c.Or} years at the current rates. Locations set to Repair "Auto" are marked for repair worst-first until the rest pass; rates are then re-derived from what is left unrepaired.</p>
    ${c.warnings.length ? `<ul class="warn">${c.warnings.map((w) => `<li>${h(w)}</li>`).join('')}</ul>` : ''}
    <h3>Repairs (${reps.length})</h3>
    <div class="ind-list">${reps.map((i) => { const a = c.per.get(i.id); return `<button class="ind-row" data-act="open-ind" data-id="${i.id}"><span class="dot r-${i.result}"></span><b>${h(i.no)}</b><span>${h(a.plate?.label)}</span><span class="n">${t(a.rem)}</span><span class="st st-${a.status.replace(/\W+/g, '-')}">${h(a.status)}</span></button>`; }).join('') || '<p class="muted small">No repairs required.</p>'}</div>`;
}

/* ------------------------------------------------------------------- roof view */

function viewRoof() {
  return `<div class="page wide roof-page"><div class="page-head"><div><h1>Roof</h1><p class="muted">Fixed roof and floating roof details, layout and UT readings.</p></div>
    <div class="acts"><button class="btn" data-act="utl-down" title="Excel sheet for the UT technician">UT loader ↓</button><button class="btn" data-act="utl-up" title="Upload the completed UT loader sheet">UT loader ↑</button><button class="btn" data-act="exp-roof">Export CSV</button></div></div>
    <div id="roofBody">${roofBodyHTML()}</div></div>`;
}
after.roof = () => attachRoofMaps();

const rStatus = (st) => (st ? `<span class="st ${st === 'OK' ? 'st-OK' : 'st-below-MRT'}">${st}</span>` : '');

function roofBodyHTML() {
  const job = S.job;
  const typeCard = `<section class="card"><div class="fgrid">${field('Roof type', 'roof.type', 'sel', { options: ROOF_TYPES })}
    <p class="muted small">${hasFloating(job) && hasFixed(job) ? 'Both the fixed roof and the internal floating roof are shown below.' : job.roof.type === 'none' ? 'Choose the roof type to record roof details and UT readings.' : ''}</p></div></section>`;
  return typeCard + (hasFixed(job) ? fixedCardHTML() : '') + (hasFloating(job) ? floatingCardHTML() + sealCardHTML() : '');
}

function fixedCardHTML() {
  const job = S.job, Fx = job.roof.fixed, U = u(job), pts = Fx.pts || [];
  const vals = pts.map((p) => pointStatus(job, p)).filter((x) => x.t !== null);
  const min = vals.length ? Math.min(...vals.map((x) => x.t)) : null;
  const bad = vals.filter((x) => x.status === 'Below t-min').length;
  const pin = (pt, k, kind, extra = '') => `<input data-rpt="${pt.id}" data-f="${k}" data-kind="${kind}" ${kind === 'text' ? '' : 'inputmode="decimal"'} value="${h(kind === 'text' || kind === 'num' ? pt[k] ?? '' : inVal(pt[k], kind, job))}" ${extra}>`;
  return `<section class="card"><div class="sp-head"><h2>Fixed roof</h2><span class="muted small">${pts.length} UT point${pts.length === 1 ? '' : 's'} · min ${min !== null ? fmt(min, 't', job) : '—'}${bad ? ` · <b class="bad">${bad} below t-min</b>` : ''}</span></div>
    <div class="roof-grid">
      <div class="roof-left">
        <div class="fgrid">${field('Roof', 'roof.fixed.kind', 'sel', { options: FIXED_TYPES })}${field('Support', 'roof.fixed.support', 'sel', { options: FIXED_SUPPORT })}
          ${field('Slope / dome radius', 'roof.fixed.slope', 'text', { ph: 'e.g. 3/4 in 12, 1.0 D' })}${field('Nominal plate t', 'roof.fixed.tNom', 't')}
          ${field('t-min', 'roof.fixed.tMin', 't', { hint: 'API 653 §4.2.1.2: average below 0.09 in over 100 in² — check your edition' })}<div></div>
          ${field('Notes', 'roof.fixed.notes', 'area', { rows: 2, cls: 'span2' })}</div>
        <h3>UT points</h3>
        <div class="tblwrap"><table class="grid rpts"><thead><tr><th>Point</th><th>Angle (°)</th><th>From centre (${U.big})</th><th>Reading (${U.small})</th><th>Status</th><th></th></tr></thead><tbody>
        ${pts.map((pt) => { const st = pointStatus(job, pt); return `<tr class="${S.roofPt === pt.id ? 'sel' : ''}${st.status === 'Below t-min' ? ' is-bad' : ''}"><td>${pin(pt, 'label', 'text', 'class="lbl"')}</td><td>${pin(pt, 'angle', 'num')}</td><td>${pin(pt, 'r', 'big')}</td><td>${pin(pt, 't', 't')}</td><td>${rStatus(st.status)}</td><td><button class="btn sm icon ghost danger" data-act="rpt-del" data-id="${pt.id}" title="Delete point">✕</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">No UT points yet.</td></tr>'}
        </tbody></table></div>
        <div class="acts"><button class="btn sm" data-act="rpt-add">+ Point</button><button class="btn sm" data-act="rpt-std">Standard points: edge &amp; mid-radius at each shell UT station + centre</button></div>
      </div>
      <div class="roof-right">
        <div class="rp-tools"><button class="btn sm${S.roofAdd ? ' on' : ''}" data-act="rpt-mode">+ Point on plan</button><span class="spacer"></span><button class="btn sm" data-act="roof-fit" data-k="fixed">Fit</button></div>
        <div class="mapbox rp-box" id="rpFixed" data-mode="${S.roofAdd ? 'add' : 'select'}">${fixedSVG(job, { sel: S.roofPt, stations: utLocations(job), columns: roofColumns(), fmtT: (t) => fmt(t, 't', job, false) })}</div>
        <div class="mapstatus"><span id="rpFixedHover">${S.roofAdd ? 'Click the plan where the reading was taken' : 'Scroll to zoom · drag to pan · click a point to select it'}</span></div>
      </div>
    </div></section>`;
}

function roofColumns() {
  return (S.job.features || []).filter((ft) => ft.type === 'column').map((ft) => { const p = itemFloor(S.layout, ft); return p ? { ...p, d: +ft.sizeA || 0 } : null; }).filter(Boolean);
}

function floatingCardHTML() {
  const job = S.job, F = job.roof.floating, U = u(job), lay = floatingLayout(job);
  const deck = lay.plates.filter((p) => p.kind !== 'annular'), pons = lay.plates.filter((p) => p.kind === 'annular');
  const orphan = Object.keys(F.ut || {}).filter((k) => !lay.byKey.has(k) && !k.startsWith('an') && Object.values(F.ut[k] || {}).some((v) => v != null)).length;
  const all = deck.map((p) => plateUT(job, p));
  const bad = all.filter((x) => x.status === 'Below t-min').length, done = all.filter((x) => x.count === 5).length;
  const pBad = pons.filter((p) => ['Liquid present', 'Leaking'].includes(F.pont?.[p.key]?.cond)).length;
  const sel = S.roofSel ? lay.byKey.get(S.roofSel) : null;
  const condSel = (key, cond) => `<select data-rpc="${key}" data-f="cond" data-kind="text">${PONT_COND.map((c) => `<option ${(cond || '') === c ? 'selected' : ''} value="${c}">${c || '—'}</option>`).join('')}</select>`;
  const rin = (p, k) => `<input data-rut="${p.key}" data-pt="${k}" data-kind="t" inputmode="decimal" value="${h(inVal(F.ut?.[p.key]?.[k], 't', job))}">`;
  const row = (p) => { const x = plateUT(job, p); return `<tr class="${S.roofSel === p.key ? 'sel' : ''}${x.status === 'Below t-min' ? ' is-bad' : ''}"><td><button class="linkbtn" data-act="rsel" data-key="${p.key}">${h(p.label)}</button>${p.cut ? ' <small class="muted">cut</small>' : ''}</td>${PT5.map(([k]) => `<td>${rin(p, k)}</td>`).join('')}<td class="n"><b>${x.min != null ? fmt(x.min, 't', job, false) : '—'}</b></td><td class="n">${x.lossPct != null ? x.lossPct.toFixed(0) + '%' : '—'}</td><td>${rStatus(x.status)}</td></tr>`; };
  const prow = (p) => { const pc = F.pont?.[p.key] || {}; return `<tr class="${S.roofSel === p.key ? 'sel' : ''}${['Liquid present', 'Leaking'].includes(pc.cond) ? ' is-bad' : ''}"><td><button class="linkbtn" data-act="rsel" data-key="${p.key}">${h(p.label)}</button></td><td>${condSel(p.key, pc.cond)}</td><td><input class="pnote" data-rpc="${p.key}" data-f="notes" data-kind="text" value="${h(pc.notes || '')}"></td></tr>`; };
  const nav = (list, i) => `<div class="acts"><button class="btn sm icon" data-act="rsel-nav" data-d="-1" ${i <= 0 ? 'disabled' : ''} title="Previous">‹</button><button class="btn sm icon" data-act="rsel-nav" data-d="1" ${i >= list.length - 1 ? 'disabled' : ''} title="Next">›</button><button class="btn sm icon ghost" data-act="rsel-close" title="Close">✕</button></div>`;
  let panel;
  if (!sel) panel = `<p class="muted small">Click a deck plate on the plan (or its name in the table) to enter its 5 UT readings. Click a pontoon to record its condition.</p>`;
  else if (sel.kind === 'annular') {
    const pc = F.pont?.[sel.key] || {};
    panel = `<div class="ed-head"><div class="ed-title"><span>Pontoon</span><b>${h(sel.label)}</b></div>${nav(pons, pons.indexOf(sel))}</div>
      <p class="muted small">${(sel.a0 % 360).toFixed(1)}° – ${(sel.a1 % 360).toFixed(1)}°. Pontoons are inspected for condition; no UT readings are taken on the pontoon tops.</p>
      <div class="fgrid"><label class="fld"><span class="lbl">Condition</span><span class="ctl">${condSel(sel.key, pc.cond)}</span></label><label class="fld"><span class="lbl">Notes</span><span class="ctl"><input data-rpc="${sel.key}" data-f="notes" data-kind="text" value="${h(pc.notes || '')}"></span></label></div>`;
  } else {
    const x = plateUT(job, sel);
    const cell = (k) => `<label class="u5"><span>${PT5_SHORT[k]}</span><span class="ctl">${rin(sel, k)}</span></label>`;
    panel = `<div class="ed-head"><div class="ed-title"><span>Deck plate</span><b>${h(sel.label)}</b></div>${nav(deck, deck.indexOf(sel))}</div>
      <p class="muted small">${fmt(sel.bb.x1 - sel.bb.x0, 'big', job)} × ${fmt(sel.bb.y1 - sel.bb.y0, 'big', job)}${sel.cut ? ' · cut plate' : ''}. Readings in ${U.small}.</p>
      <div class="ut5">${cell('tl')}<i></i>${cell('tr')}<i></i>${cell('c')}<i></i>${cell('bl')}<i></i>${cell('br')}</div>
      <div class="sum-grid three"><div><span>Min.</span><b>${x.min != null ? fmt(x.min, 't', job) : '—'}</b><small>${x.count}/5 readings</small></div><div><span>Loss</span><b>${x.lossPct != null ? x.lossPct.toFixed(0) + '%' : '—'}</b><small>${x.tNom ? 'vs ' + fmt(x.tNom, 't', job) : 'enter nominal'}</small></div><div><span>Status</span><b class="${x.status === 'OK' ? 'ok' : x.status ? 'bad' : ''}">${x.status || '—'}</b><small>${x.tMin ? 't-min ' + fmt(x.tMin, 't', job) : ''}</small></div></div>`;
  }
  return `<section class="card"><div class="sp-head"><h2>${job.roof.type === 'fixed-ifr' ? 'Internal floating roof' : 'External floating roof'}</h2><span class="muted small">${deck.length} deck plates · ${done}/${deck.length} fully read${bad ? ` · <b class="bad">${bad} below t-min</b>` : ''} · ${pons.length} pontoons${pBad ? ` · <b class="bad">${pBad} with liquid / leaking</b>` : ''}</span></div>
    <div class="fgrid g4">
      ${field('Roof', 'roof.floating.kind', 'sel', { options: FLOAT_TYPES })}${field('Rim gap (roof to shell)', 'roof.floating.rimGap', 'small')}
      ${field('Pontoon width (radial)', 'roof.floating.pontW', 'big', { hint: '0 = no pontoon ring' })}${field('Number of pontoons', 'roof.floating.pontN', 'num', { ph: `${autoPontCount(job)} (suggested)` })}
      ${field('First pontoon bulkhead at', 'roof.floating.pontStart', 'num', { unit: '°', ph: '0' })}${field('Deck plate width', 'roof.floating.plateW', 'big')}
      ${field('Deck plate length', 'roof.floating.plateL', 'big')}${field('Deck plates run', 'roof.floating.orient', 'sel', { options: [['h', 'Left – right'], ['v', 'Top – bottom']] })}
      ${field('Row stagger', 'roof.floating.stagger', 'sel', { options: [['0', 'None'], ['0.5', '½ plate'], ['0.3333333333', '⅓ plate'], ['0.25', '¼ plate']], attrs: 'data-num="1"' })}${field('Deck nominal t', 'roof.floating.deckNom', 't')}
      ${field('Deck t-min', 'roof.floating.deckMin', 't')}<div></div>
      ${field('Notes', 'roof.floating.notes', 'text', { cls: 'span2' })}
    </div>
    <p class="muted small">Roof diameter ${fmt(roofDiameter(job), 'big', job)} (shell less twice the rim gap). Deck plates are laid like the floor grid and cut at the pontoon ring. Each deck plate has 5 UT readings: the four corners and the centre. Pontoons record condition only.</p>
    ${orphan ? `<p class="callout warn">${orphan} plate${orphan > 1 ? 's' : ''} with readings no longer exist after a layout change. Change the layout back to see them, or re-enter the readings.</p>` : ''}
    <div class="roof-grid fl">
      <div class="roof-right">
        <div class="rp-tools"><span class="legend-mini"><i class="d ok"></i>OK <i class="d bad"></i>below t-min <i class="d empty"></i>no reading <i class="sq liq"></i>pontoon liquid / leaking</span><span class="spacer"></span><button class="btn sm" data-act="roof-fit" data-k="floating">Fit</button></div>
        <div class="mapbox rp-box" id="rpFloat">${floatingSVG(job, lay, { sel: S.roofSel })}</div>
        <div class="mapstatus"><span id="rpFloatHover">Scroll to zoom · drag to pan · click a plate</span></div>
      </div>
      <div class="roof-panel ed">${panel}</div>
    </div>
    <h3>Deck plate UT readings (${U.small})</h3>
    <div class="tblwrap rd-wrap"><table class="grid rplates"><thead><tr><th>Plate</th>${PT5.map(([k, l]) => `<th>${l}</th>`).join('')}<th class="n">Min</th><th class="n">Loss</th><th>Status</th></tr></thead><tbody>
      ${deck.map(row).join('')}
    </tbody></table></div>
    ${pons.length ? `<h3>Pontoons</h3><div class="tblwrap rd-wrap short"><table class="grid rplates pons"><thead><tr><th>Pontoon</th><th>Condition</th><th>Notes</th></tr></thead><tbody>${pons.map(prow).join('')}</tbody></table></div>` : ''}
  </section>`;
}

/* ------------------------------------------------------------- rim seal inspection */

/** Gap area per metre of diameter / gap width shown in the job's units (with the other system in brackets). */
function fmtGapArea(v) { if (v === null || v === undefined) return '—'; return S.job.units === 'metric' ? `${v.toFixed(1)} cm²/m` : `${cm2mToIn2ft(v).toFixed(2)} in²/ft <small class="muted">(${v.toFixed(1)} cm²/m)</small>`; }
function fmtGapW(cm) { if (cm === null || cm === undefined) return '—'; const big = cm >= 5; return S.job.units === 'metric' ? `${cm.toFixed(big ? 1 : 2)} cm` : `${(cm / 2.54).toFixed(big ? 1 : 3)} in <small class="muted">(${cm.toFixed(big ? 1 : 2)} cm)</small>`; }
function fmtLim(r) {
  if (r.limit === null || r.limit === undefined) return '—';
  return `${r.op} ${r.unit === 'cm2m' ? fmtGapArea(r.limit) : fmtGapW(r.limit)}`;
}

function sealCardHTML() {
  const job = S.job, seal = job.roof.seal, U = u(job), D = +job.tank.diameter || 0;
  const ifr = job.roof.type === 'fixed-ifr';
  const gapTable = (k) => {
    const sd = k === 'p' ? seal.primary : seal.secondary, sum = gapSummary(sd.gaps, D);
    const gin = (g, f, kind, extra = '') => `<input data-sg="${k}" data-gid="${g.id}" data-f="${f}" data-kind="${kind}" ${kind === 'text' ? '' : 'inputmode="decimal"'} value="${h(kind === 'small' ? inVal(g[f], 'small', job) : g[f] ?? '')}" ${extra}>`;
    return `<div class="tblwrap"><table class="grid sgaps"><thead><tr><th>#</th><th>Start angle (°)</th><th>Length (${U.small})</th><th>Max width (${U.small})</th><th>Avg width (${U.small})</th><th class="n">Area</th><th>Notes</th><th></th></tr></thead><tbody>
      ${sd.gaps.map((g, i) => { const L = +g.len, W = +(g.wAvg ?? g.wMax); const a = L > 0 && W > 0 ? (L / 10) * (W / 10) : null; return `<tr><td>${i + 1}</td><td>${gin(g, 'angle', 'num')}</td><td>${gin(g, 'len', 'small')}</td><td>${gin(g, 'wMax', 'small')}</td><td>${gin(g, 'wAvg', 'small', 'placeholder="= max"')}</td><td class="n">${a === null ? '—' : job.units === 'metric' ? a.toFixed(1) + ' cm²' : (a / 6.4516).toFixed(2) + ' in²'}</td><td>${gin(g, 'notes', 'text', 'class="note"')}</td><td><button class="btn sm icon ghost danger" data-act="sg-del" data-sg="${k}" data-gid="${g.id}" title="Remove gap">✕</button></td></tr>`; }).join('') || `<tr><td colspan="8" class="empty">${sd.noGaps ? 'No gaps found.' : 'No gaps entered.'}</td></tr>`}
      </tbody></table></div>
      <div class="acts"><button class="btn sm" data-act="sg-add" data-sg="${k}">+ Gap</button>${field('No gaps found', `roof.seal.${k === 'p' ? 'primary' : 'secondary'}.noGaps`, 'bool', { cls: 'inline-chk' })}<span class="spacer"></span><span class="muted small">${sum.n} gap${sum.n === 1 ? '' : 's'} · total ${job.units === 'metric' ? sum.areaCm2.toFixed(1) + ' cm²' : (sum.areaCm2 / 6.4516).toFixed(2) + ' in²'} · ${fmtGapArea(sum.n ? sum.perM : seal[k === 'p' ? 'primary' : 'secondary'].noGaps ? 0 : null)}</span></div>`;
  };
  const stds = activeStds(seal);
  const results = stds.map((k) => {
    const ev = sealEval(job, k), due = nextDue(job, k);
    return `<div class="seal-res ${ev.overall === 'Compliant' ? 'ok' : ev.overall === 'Not compliant' ? 'bad' : ''}">
      <div class="sr-head"><b>${h(ev.L.short)}</b><span class="chip ${ev.overall === 'Compliant' ? 'r-ok' : ev.overall === 'Not compliant' ? 'r-bad' : 'r-pending'}">${ev.overall}</span></div>
      <div class="muted small">${h(ev.L.name)}</div>
      <table class="grid sres"><tbody>${ev.rows.map((r) => `<tr><td>${h(r.item)}</td><td class="n">${r.text !== undefined ? h(r.text) : r.unit === 'cm2m' ? fmtGapArea(r.value) : fmtGapW(r.value)}</td><td class="n muted">${r.limit !== undefined ? fmtLim(r) : ''}</td><td>${r.ok === true ? '<span class="st st-OK">OK</span>' : r.ok === false ? '<span class="st st-below-MRT">Fails</span>' : '<span class="muted small">—</span>'}</td></tr>`).join('')}</tbody></table>
      ${ev.warn.length ? `<ul class="warn">${ev.warn.map((w) => `<li>${h(w)}</li>`).join('')}</ul>` : ''}
      ${ev.fails ? `<p class="small"><b>Repair:</b> ${h(ev.repair)}</p>` : ''}
      ${due.length ? `<p class="small muted"><b>Inspection frequency${seal.date ? ' / next due' : ''}:</b> ${due.map((d) => `${h(d.what)} — ${d.every}${d.due ? ` (${d.due.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })})` : ''}`).join('; ')}.</p>` : ''}
    </div>`;
  }).join('') || '<p class="muted">Select at least one standard to evaluate against.</p>';
  const chk = SEAL_CHECKS.map(([k, label]) => { const c = seal.checks?.[k] || {}; return `<tr class="${c.r === 'defect' ? 'is-bad' : ''}"><td>${h(label)}</td><td><select data-sck="${k}" data-kind="text"><option value="" ${!c.r ? 'selected' : ''}>—</option><option value="ok" ${c.r === 'ok' ? 'selected' : ''}>OK</option><option value="defect" ${c.r === 'defect' ? 'selected' : ''}>Defect</option><option value="na" ${c.r === 'na' ? 'selected' : ''}>N/A</option></select></td><td><input data-sckn="${k}" data-kind="text" value="${h(c.note || '')}" placeholder="Note"></td></tr>`; }).join('');
  const C = SEAL_STDS;
  return `<section class="card seal-card"><div class="sp-head"><h2>Rim seal inspection</h2><span class="muted small">${ifr ? 'Internal floating roof' : 'External floating roof'} · gaps are drawn on the roof plan above (primary red, secondary blue)</span></div>
    <div class="seal-std">
      <span class="lbl">Evaluate against</span>
      ${field(`${C.kb.short} — 40 CFR 60 Subpart Kb / 63 Subpart WW`, 'roof.seal.std.kb', 'bool')}
      ${field(`${C.ca.short} — SOR/2025-88`, 'roof.seal.std.ca', 'bool')}
      ${field('Custom / provincial approval (e.g. CCME PN 1180)', 'roof.seal.std.custom', 'bool')}
    </div>
    ${seal.std.custom ? `<div class="fgrid g4 custom-lim">${field('Name / permit', 'roof.seal.custom.label', 'text', { ph: 'e.g. CCME PN 1180, approval no.' })}${field('Primary gap area limit', 'roof.seal.custom.pArea', 'num', { unit: 'cm²/m' })}${field('Primary max gap width', 'roof.seal.custom.pWidth', 'num', { unit: 'cm' })}${field('Secondary gap area limit', 'roof.seal.custom.sArea', 'num', { unit: 'cm²/m' })}${field('Secondary max gap width', 'roof.seal.custom.sWidth', 'num', { unit: 'cm' })}${field('Shoe top above liquid (min)', 'roof.seal.custom.shoeAbove', 'num', { unit: 'cm' })}${field('Shoe bottom below liquid (min)', 'roof.seal.custom.shoeBelow', 'num', { unit: 'cm' })}<p class="muted small span2">Enter the limits from the CCME guideline or your provincial approval. Gap limits are compared as “not more than”.</p></div>` : ''}
    <div class="fgrid g4">
      ${field('Inspection date', 'roof.seal.date', 'date')}${field('Inspected by', 'roof.seal.inspector')}
      ${field('Roof / liquid level at measurement', 'roof.seal.level', 'text', { ph: 'e.g. 22 ft 4 in liquid level' })}${field('Notes', 'roof.seal.notes')}
    </div>
    <div class="seal-grid">
      <div class="seal-col">
        <h3>Primary seal</h3>
        <div class="fgrid g3">${field('Type', 'roof.seal.primary.type', 'sel', { options: PRIMARY_TYPES })}
          ${/shoe/i.test(seal.primary.type) ? `${field('Shoe top above liquid', 'roof.seal.primary.shoeAbove', 'small')}${field('Shoe bottom below liquid', 'roof.seal.primary.shoeBelow', 'small')}${field('Shoe height', 'roof.seal.primary.shoeHeight', 'small')}` : ''}
          ${field('Condition / notes', 'roof.seal.primary.notes', 'text', { cls: /shoe/i.test(seal.primary.type) ? 'span2' : 'span2' })}</div>
        ${gapTable('p')}
      </div>
      <div class="seal-col">
        <h3>Secondary seal</h3>
        <div class="fgrid">${field('Type', 'roof.seal.secondary.type', 'sel', { options: SECONDARY_TYPES })}${field('Condition / notes', 'roof.seal.secondary.notes')}</div>
        ${seal.secondary.type === 'None' ? '<p class="muted small">No secondary seal fitted.</p>' : gapTable('s')}
      </div>
    </div>
    <p class="muted small">Find gaps with a ${C.kb.probe} probe (Canada: ${C.ca.probe}) passed freely between the seal and the shell, with the roof floating freely and the liquid level steady. Record each gap's start angle, length along the shell and width; the area is length × average width (maximum width if no average is entered). Gap area per metre of tank diameter = total area ÷ diameter (${fmt(D, 'big', job)}).</p>
    <h3>Visual inspection</h3>
    <div class="tblwrap"><table class="grid schecks"><thead><tr><th>Item</th><th>Result</th><th>Note</th></tr></thead><tbody>${chk}</tbody></table></div>
    <h3>Results</h3>
    <div class="seal-results">${results}</div>
    <p class="muted small">Limits from 40 CFR 60.113b and 63.1063 (US EPA) and SOR/2025-88 ss. 64–65, 73–76, 91–101 and Schedule 4 (Canada). Check the version that applies to the tank, its permit or approval, and the product stored.</p>
  </section>`;
}

function refreshRoof() {
  setTimeout(() => {
    const c = $('#roofBody'); if (!c) return;
    const a = document.activeElement, key = a && c.contains(a) ? focusSel(a) : null, typed = a && a.value !== undefined && a.value !== a.defaultValue ? a.value : null;
    c.innerHTML = roofBodyHTML();
    attachRoofMaps();
    if (key) { const n = c.querySelector(key); if (n && typed !== null && n.value !== typed) { n.value = typed; n.dataset.restored = '1'; } if (n) { n.focus({ preventScroll: true }); try { if (typed === null) n.select(); else n.setSelectionRange(n.value.length, n.value.length); } catch { /* */ } } }
  }, 0);
}

function attachRoofMaps() {
  const mk = (id, k, onClick, onHover) => {
    const box = $(id); if (!box) return;
    const ctl = new MapController(box, { onClick, onHover, rerender: () => { S.roofVB[k] = null; refreshRoof(); } });
    ctl.r = +box.querySelector('svg')?.dataset.r || 0; ctl.vb = S.roofVB[k]; ctl.afterRender();
    const orig = ctl.setVB.bind(ctl); ctl.setVB = (vb) => { orig(vb); S.roofVB[k] = vb; };
  };
  mk('#rpFixed', 'fixed', roofFixedClick, (fp) => { const el = $('#rpFixedHover'); if (!el) return; if (!fp) { el.textContent = S.roofAdd ? 'Click the plan where the reading was taken' : 'Scroll to zoom · drag to pan · click a point to select it'; return; } const r = Math.hypot(fp.x, fp.y); el.innerHTML = r > S.job.tank.diameter / 2 ? 'Outside the roof' : `θ <b>${angleOf(fp.x, fp.y).toFixed(1)}°</b> · <b>${fmt(r, 'big', S.job)}</b> from centre`; });
  mk('#rpFloat', 'floating', roofFloatClick, (fp) => { const el = $('#rpFloatHover'); if (!el) return; if (!fp) { el.textContent = 'Scroll to zoom · drag to pan · click a plate'; return; } const p = plateAt(floatingLayout(S.job), fp.x, fp.y); el.innerHTML = p ? `<b>${h(p.label)}</b> ${p.kind === 'annular' ? 'pontoon' : 'deck plate'}` : 'Rim gap / outside the roof'; });
}

function roofFixedClick(fp, hit) {
  if (!fp) return;
  if (hit.feature) { S.roofPt = hit.feature; refreshRoof(); setTimeout(() => $(`#roofBody input[data-rpt="${hit.feature}"][data-f="t"]`)?.focus(), 40); return; }
  if (S.roofAdd) {
    const r = Math.hypot(fp.x, fp.y), R = S.job.tank.diameter / 2;
    if (r > R) { toast('That point is outside the roof.'); return; }
    const st = S.job.units === 'metric' ? 10 : 25.4;
    const pts = (S.job.roof.fixed.pts = S.job.roof.fixed.pts || []);
    let n = 0; for (const p of pts) { const m = String(p.label || '').match(/^R(\d+)$/); if (m) n = Math.max(n, +m[1]); }
    const pt = { id: uid(), label: 'R' + (n + 1), angle: Math.round(angleOf(fp.x, fp.y) * 2) / 2 % 360, r: Math.round(r / st) * st, t: null };
    pts.push(pt); S.roofPt = pt.id; if (!hit.shift) S.roofAdd = false;
    commit(); refreshRoof(); setTimeout(() => $(`#roofBody input[data-rpt="${pt.id}"][data-f="t"]`)?.focus(), 40); return;
  }
  S.roofPt = null; refreshRoof();
}

function roofFloatClick(fp, hit) {
  S.roofSel = hit.plate || null; refreshRoof();
  if (S.roofSel) setTimeout(() => $(`.roof-panel input[data-pt="tl"], .roof-panel select[data-rpc]`)?.focus(), 40);
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
  const cin = (c, k, kind, ph = '', cls = '') => `<input data-shc="${k}" data-course="${c.id}" data-kind="${kind}" inputmode="decimal" value="${h(kind === 'num' ? c[k] ?? '' : inVal(c[k], kind, job))}" placeholder="${h(ph)}" class="${cls}">`;
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
      rows.push(`<tr><td class="el">${fmtElev(z, job)}${extra ? ` <button class="x" data-act="z-del" data-z="${zKey(z)}" title="Remove this extra elevation">✕</button>` : ''}</td>${locs.map((l) => { const v = getReading(job, l.key, z); const bad = v != null && c?.tMin > 0 && v < c.tMin - 1e-9; return `<td class="${bad ? 'bad-cell' : ''}"><input data-shut="${l.key}" data-z="${zKey(z)}" data-kind="t" inputmode="decimal" value="${h(inVal(v, 't', job))}"></td>`; }).join('')}<td class="n">${rmin != null ? fmt(rmin, 't', job, false) : ''}</td></tr>`);
    }
    grid = rows.join('');
  }

  return `<div class="shell-grid">
    <section class="card"><div class="sp-head"><h2>Shell courses &amp; plates</h2><span class="muted small">${courses.length} course${courses.length === 1 ? '' : 's'} · ${fmt(H, 'big', job)} high</span></div>
      <div class="tblwrap"><table class="grid courses"><thead><tr><th>Course</th><th>Height (${U.big})</th><th>Nominal t (${U.small})</th><th>t-min (${U.small})</th><th title="Number of shell plates in the course">Plates</th><th title="Angle of the first vertical seam">1st seam (°)</th><th title="Optional: plate length; the last plate is the closure plate">Plate length (${U.big})</th><th class="n">Min. reading</th><th>Status</th><th></th></tr></thead><tbody>
      ${top.map((c, k) => { const s = sm.get(c.id); const cp = coursePlates(job, c, c.no - 1); return `<tr class="${s.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${c.no}</b>${c.no === 1 ? ' <span class="muted small">bottom</span>' : ''}</td><td>${cin(c, 'h', 'big')}</td><td>${cin(c, 'tNom', 't')}</td><td>${cin(c, 'tMin', 't')}</td><td>${cin(c, 'pn', 'num', String(c.plen ? cp.n : autoN), 'xs')}</td><td>${cin(c, 'seam0', 'num', (Math.round(cp.seam0 * 10) / 10).toString(), 'xs')}</td><td>${cin(c, 'plen', 'big', fmt(cp.plates[0]?.len, 'big', job, false))}</td><td class="n">${s.min != null ? fmt(s.min, 't', job, false) : '—'}<small class="muted"> ${s.count}</small></td><td>${st(s)}</td><td><button class="btn sm icon ghost danger" data-act="course-del" data-course="${c.id}" title="Delete course">✕</button></td></tr>`; }).join('') || `<tr><td colspan="10" class="empty">No courses yet. Add them from the bottom course up, or start with <button class="btn sm" data-act="courses-std" data-n="5">5 courses</button> <button class="btn sm" data-act="courses-std" data-n="6">6 courses</button> <button class="btn sm" data-act="courses-std" data-n="8">8 courses</button></td></tr>`}
      </tbody></table></div>
      <div class="acts"><button class="btn sm" data-act="course-add">+ Course on top</button></div>
      <p class="muted small">Course 1 is the bottom course. Plates: give the number of plates (equal lengths), or a plate length (full plates from the first seam, the last one is the closure plate). Blank first seam staggers alternate courses by half a plate. t-min is the minimum required thickness you enter for each course.</p></section>

    <div class="shell-side">
    <section class="card"><h2>UT stations</h2>
      <p class="small">${D > 0 ? `Circumference ${fmt(C, 'big', job)} ÷ ${fmt(SPACING_MM, 'big', job)} = ${(C / SPACING_MM).toFixed(1)} → standard <b>${auto}</b> stations (minimum 4, maximum 8, one per 32 ft of circumference), equally spaced.` : 'Enter the tank diameter in Tank setup.'}</p>
      <div class="fgrid">${field('Number of stations', 'shell.nLoc', 'num', { ph: `${auto} (standard)`, hint: 'Leave blank for the standard count' })}${field('First station at', 'shell.start', 'num', { unit: '°', ph: '0' })}</div>
      <div class="loc-list">${locs.map((l) => `<span class="loc-chip"><b>${l.label}</b> ${l.angle.toFixed(1)}° <small>${fmt(l.arc, 'big', job)}</small></span>`).join('')}</div></section>

    <section class="card"><div class="sp-head"><h2>Reading elevations</h2><span class="muted small">${zs.length} per station · ${zs.length * locs.length} readings</span></div>
      <p class="muted small">Readings are taken at each station at these elevations above the bottom. Each zone gives a reading every <i>step</i> from <i>start</i> to <i>end</i> (blank end = top of the shell). Values in ${U.small}.</p>
      <table class="grid zones"><thead><tr><th>From</th><th>To</th><th>Every</th><th class="n">Readings</th><th></th></tr></thead><tbody>
      ${(sh.zones || []).map((zn) => `<tr><td><input data-zf="start" data-zone="${zn.id}" data-kind="small" inputmode="decimal" value="${h(inVal(zn.start, 'small', job))}"></td><td><input data-zf="end" data-zone="${zn.id}" data-kind="small" inputmode="decimal" value="${h(inVal(zn.end, 'small', job))}" placeholder="top"></td><td><input data-zf="step" data-zone="${zn.id}" data-kind="small" inputmode="decimal" value="${h(inVal(zn.step, 'small', job))}"></td><td class="n">${zoneCount(job, zn)}<br><small class="muted">${fmtElev(+zn.start || 0, job)}${zn.end != null ? ' – ' + fmtElev(+zn.end, job) : ' – top'}</small></td><td><button class="btn sm icon ghost danger" data-act="zone-del" data-zone="${zn.id}" title="Remove zone">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No zones.</td></tr>'}
      </tbody></table>
      <div class="acts"><button class="btn sm" data-act="zone-add">+ Zone</button><button class="btn sm" data-act="zones-std">Standard: every 1 in to 2 ft, then every 1 ft</button></div>
      <div class="acts extra-z"><label class="fld inline"><span class="lbl">Add one elevation</span><span class="ctl"><input id="extraZ" data-kind="small" inputmode="decimal" placeholder="${U.small}"><i class="unit">${U.small}</i></span></label><button class="btn sm" data-act="z-add">Add</button></div></section>
    </div>
  </div>

  ${courses.length ? `<section class="card"><div class="sp-head"><h2>UT readings</h2><span class="muted small">thickness in ${U.small} · Tab moves across, Enter moves up the station</span></div>
    <div class="tblwrap rd-wrap"><table class="grid readings"><thead><tr><th>Elevation</th>${locs.map((l) => `<th class="n">${l.label}<br><small>${l.angle.toFixed(1)}°</small></th>`).join('')}<th class="n">Row min</th></tr></thead><tbody>${grid || `<tr><td colspan="${locs.length + 2}" class="empty">Set up reading elevations to start.</td></tr>`}</tbody></table></div></section>` : ''}

  <section class="card"><div class="sp-head"><h2>Shell roll-out</h2><span class="muted small">plates, UT stations, dimensions and nozzles</span></div>
    <div class="ro-wrap" id="roWrap">${rolloutSVG(job)}</div></section>`;
}

function refreshShell() {
  setTimeout(() => {
    const c = $('#shellBody'); if (!c) return;
    const a = document.activeElement, key = a && c.contains(a) ? focusSel(a) : null, typed = a && a.value !== undefined && a.value !== a.defaultValue ? a.value : null;
    c.innerHTML = shellBodyHTML();
    if (key) { const n = c.querySelector(key); if (n && typed !== null && n.value !== typed) { n.value = typed; n.dataset.restored = '1'; } if (n) { n.focus(); try { if (typed === null) n.select(); else n.setSelectionRange(n.value.length, n.value.length); } catch { /* */ } } }
  }, 0);
}


/* ----------------------------------------------------------- settlement view */

function viewSettle() {
  return `<div class="page wide settle-page"><div class="page-head"><div><h1>Settlement</h1><p class="muted">API 653 Annex B: shell settlement survey (planar tilt and out-of-plane settlement), edge settlement and bottom depressions.</p></div>
    <div class="acts"><button class="btn" data-act="exp-settle">Export CSV</button></div></div>
    <div id="settleBody">${settleBodyHTML()}</div></div>`;
}

function settleBodyHTML() {
  const job = S.job, st = job.settle, U = u(job), met = job.units === 'metric', D = +job.tank.diameter || 0;
  const c = settleCalc(job), F = c.fit, eu = ELEV_UNITS[st.eu] || ELEV_UNITS.in;
  const fS = (mm, sign = false) => (mm === null || mm === undefined ? '—' : (sign && mm > 0 ? '+' : '') + (met ? mm.toFixed(1) : (mm / 25.4).toFixed(2)));
  const sU = U.small, stress = (mpa) => (mpa == null ? '' : met ? String(+(+mpa).toFixed(1)) : String(Math.round(mpa * PSI_PER_MPA)));
  const shH = shellHeight(job);
  const stRow = (p) => `<tr class="${p.ok === false ? 'is-bad' : ''}"><td><b>${p.i}</b></td><td class="n">${p.angle.toFixed(1)}°</td><td><input data-st="${p.i}" data-kind="num" inputmode="decimal" value="${p.raw == null ? '' : +(p.raw / eu[0]).toFixed(eu[2])}"></td>
    <td class="n">${p.fit !== undefined ? fS(p.fit - F.a, true) : '—'}</td><td class="n">${p.z !== null && F ? fS(p.z - F.a, true) : '—'}</td><td class="n">${p.U !== undefined ? fS(p.U, true) : '—'}</td><td class="n"><b>${p.S != null ? fS(p.S, true) : '—'}</b></td><td>${p.S == null ? '' : p.ok === false ? '<span class="st st-below-MRT">Exceeds</span>' : p.ok ? '<span class="st st-OK">OK</span>' : ''}</td></tr>`;
  const res = (label, val, lim, ok, note = '') => `<tr class="${ok === false ? 'is-bad' : ''}"><td>${label}</td><td class="n"><b>${val}</b></td><td class="n">${lim}</td><td>${ok === true ? '<span class="st st-OK">OK</span>' : ok === false ? '<span class="st st-below-MRT">Fails</span>' : ''}</td><td class="muted small">${note}</td></tr>`;
  const stCls = c.status === 'Acceptable' ? 'ok' : c.status === 'Not acceptable' ? 'bad' : '';
  const results = F ? `<table class="grid sres settle-res"><thead><tr><th>Check</th><th class="n">Result</th><th class="n">Limit</th><th></th><th>Basis</th></tr></thead><tbody>
      ${res('Cosine fit R²', F.R2.toFixed(3), '≥ 0.90', c.valid, 'B.2.2.4 — fit must be valid to use B.3.2.1')}
      ${res('Planar tilt across the diameter', `${fS(F.tilt)} ${sU}`, '', null, `High side ${F.hiDeg.toFixed(0)}°, low side ${F.loDeg.toFixed(0)}° · slope ${slopeText(F.slope, job)}`)}
      ${res('Out-of-plumbness at top of shell (tilt × H)', `${fS(F.plumb)} ${sU}`, `≤ ${fS(F.plumbLim)} ${sU}`, c.tiltOk, 'API 653 §10.5.2.1: 1/100 of shell height, 5 in max')}
      ${res('… API 650 new-construction tolerance', `${fS(F.plumb)} ${sU}`, `${fS(F.plumb650)} ${sU}`, null, 'API 650 §7.5.2: 1/200 of height — reference only')}
      ${res('Max out-of-plane deflection |S|', F.maxS !== null ? `${fS(Math.abs(F.maxS))} ${sU} <small class="muted">(stn ${F.maxAt})</small>` : '—', c.Smax !== null ? `≤ ${fS(c.Smax)} ${sU}` : '<span class="muted">needs H, Y, E</span>', c.oopOk, 'B.3.2.1: Smax = 11·L²·Y / (2·E·H)')}
      ${res('Max measured difference (high − low)', `${fS(F.diff)} ${sU}`, '', null, 'Information')}
    </tbody></table>` : '<p class="muted">Enter at least 4 station readings to evaluate the shell settlement.</p>';
  const warn = c.warnings.length ? `<div class="warnbox">${c.warnings.map((w) => `<p>${h(w)}</p>`).join('')}</div>` : '';

  const ein = (x, k, kind, extra = '') => `<input data-se="edge" data-eid="${x.id}" data-f="${k}" data-kind="${kind}" ${kind === 'text' ? '' : 'inputmode="decimal"'} value="${h(kind === 'num' || kind === 'text' ? x[k] ?? '' : inVal(x[k], kind, job))}" ${extra}>`;
  const din = (x, k, kind, extra = '') => `<input data-se="dep" data-eid="${x.id}" data-f="${k}" data-kind="${kind}" ${kind === 'text' ? '' : 'inputmode="decimal"'} value="${h(kind === 'num' || kind === 'text' ? x[k] ?? '' : inVal(x[k], kind, job))}" ${extra}>`;
  const stt = (s) => `<span class="st ${s === 'Acceptable' ? 'st-OK' : s === 'Exceeds' ? 'st-below-MRT' : s === 'NDE required' ? 'st-warn' : ''}">${s}</span>`;
  const edgeRows = st.edge.map((x, i) => { const ev = edgeEval(x); return `<tr class="${ev.status === 'Exceeds' ? 'is-bad' : ev.status === 'NDE required' ? 'is-warn' : ''}"><td><b>E${i + 1}</b></td><td>${ein(x, 'angle', 'num')}</td><td>${ein(x, 'arc', 'big', 'placeholder="opt."')}</td><td>${ein(x, 'R', 'big')}</td><td>${ein(x, 'B', 'small')}</td>
    <td><select data-se="edge" data-eid="${x.id}" data-f="weld" data-kind="text">${WELDS.map(([k, l]) => `<option value="${k}" ${x.weld === k ? 'selected' : ''}>${h(l)}</option>`).join('')}</select></td><td>${x.weld === 'angle' ? ein(x, 'alpha', 'num', 'placeholder="0–90"') : '<span class="muted">—</span>'}</td>
    <td>${ein(x, 'Bew', 'small')}</td><td>${ein(x, 'Be', 'small', x.weld === 'par' ? 'placeholder="opt."' : '')}</td><td class="n"><b>${ev.allow != null ? fmt(ev.allow, 'small', job, false) : '—'}</b></td><td class="n">${ev.pct != null ? ev.pct.toFixed(0) + '%' : '—'}</td><td title="${h(ev.basis)}">${stt(ev.status)}</td><td>${ein(x, 'notes', 'text', 'class="note"')}</td><td><button class="btn sm icon ghost danger" data-act="se-del" data-k="edge" data-eid="${x.id}" title="Remove">✕</button></td></tr>`; }).join('') || '<tr><td colspan="14" class="empty">No edge settlement recorded.</td></tr>';
  const edgeNotes = [...new Set(st.edge.map((x) => edgeEval(x).status).filter((s) => s === 'NDE required' || s === 'Exceeds'))].map((s) => `<p class="small"><b>${s}:</b> ${h(EDGE_NOTE[s])}</p>`).join('');
  const depRows = st.dep.map((x, i) => { const ev = depEval(x); return `<tr class="${ev.status === 'Exceeds' ? 'is-bad' : ''}"><td><b>D${i + 1}</b></td><td>${din(x, 'angle', 'num')}</td><td>${din(x, 'r', 'big')}</td><td>${din(x, 'R', 'big')}</td><td>${din(x, 'B', 'small')}</td><td class="n"><b>${ev.allow != null ? fmt(ev.allow, 'small', job, false) : '—'}</b></td><td class="n">${ev.pct != null ? ev.pct.toFixed(0) + '%' : '—'}</td><td>${stt(ev.status)}</td><td>${din(x, 'notes', 'text', 'class="note"')}</td><td><button class="btn sm icon ghost danger" data-act="se-del" data-k="dep" data-eid="${x.id}" title="Remove">✕</button></td></tr>`; }).join('') || '<tr><td colspan="10" class="empty">No bottom depressions recorded.</td></tr>';

  return `<section class="card"><div class="sp-head"><h2>Shell settlement survey</h2><span class="muted small">${c.n}/${c.N} stations read · <b class="${stCls}">${c.status}</b></span></div>
    <div class="fgrid g4">${field('Survey date', 'settle.date', 'date')}${field('Surveyed by', 'settle.surveyor')}${field('Instrument', 'settle.instrument', 'text', { ph: 'e.g. level, total station' })}${field('Benchmark', 'settle.benchmark')}
      ${field('Liquid level at survey', 'settle.level', 'text', { ph: 'e.g. empty / 32 ft' })}${field('Number of stations', 'settle.n', 'num', { ph: `${autoN(job)} (API 653)`, hint: `N = D/10 ft, even, ≥ 8, spacing ≤ 32 ft · spacing now ${c.L ? fmt(c.L, 'big', job) : '—'}` })}${field('Station 1 at', 'settle.start', 'num', { unit: '°', ph: '0' })}${field('Reading units', 'settle.eu', 'sel', { options: met ? [['mm', 'mm'], ['m', 'm']] : [['in', 'inches'], ['ft', 'feet (decimal)'], ['mm', 'mm']] })}
      ${field('Readings are rod readings (larger = lower)', 'settle.rod', 'bool')}${field('Shell height H', 'settle.H', 'big', { ph: shH ? fmt(shH, 'big', job, false) + ' (shell courses)' : '' })}
      <label class="fld"><span class="lbl">Shell yield strength Y</span><span class="ctl"><input data-sts="Y" inputmode="decimal" value="${stress(st.Y)}"><i class="unit">${met ? 'MPa' : 'psi'}</i></span><small>Lowest course; 30,000 psi (207 MPa) if unknown</small></label>
      <label class="fld"><span class="lbl">Elastic modulus E</span><span class="ctl"><input data-sts="E" inputmode="decimal" value="${stress(st.E)}"><i class="unit">${met ? 'MPa' : 'psi'}</i></span></label>
      ${field('Notes', 'settle.notes', 'text', { cls: 'span2' })}</div>
    ${warn}
    <div class="settle-grid">
      <div class="settle-left">
        <div class="tblwrap"><table class="grid sstations"><thead><tr><th>Stn</th><th class="n">Angle</th><th>Reading (${eu[1]})</th><th class="n">Cosine fit</th><th class="n">Measured</th><th class="n">U</th><th class="n">S</th><th></th></tr></thead><tbody>${c.pts.map(stRow).join('')}</tbody></table></div>
        <p class="muted small">Fit, measured, U and S in ${sU === "in" ? "inches" : "mm"}, relative to the mean plane. U = measured − cosine fit; S = U − ½(U of the stations either side). Enter readings and press Enter to move to the next station. <button class="linkbtn" data-act="st-clear">Clear readings</button></p>
      </div>
      <div class="settle-right"><div class="setplan-box">${settlePlanSVG(job, c, { fmt: (v) => fS(v) })}</div></div>
    </div>
    <div class="setchart-box">${settleChartSVG(job, c, { fmt: (v) => fS(v), unit: sU })}</div>
    <h3>Results — API 653 Annex B</h3>${results}
    <p class="muted small">Stations are equally spaced clockwise from station 1. The optimum cosine curve a + b·cos θ + c·sin θ is fitted by least squares and represents uniform settlement plus planar (rigid-body) tilt; L = πD/N = ${c.L ? fmt(c.L, 'big', job) : '—'}, H = ${H_TXT(c, job)}. Annex B sets no numeric planar-tilt limit; out-of-plumbness is compared with API 653 §10.5.2.1. Tilt also reduces freeboard on the low side and can bind floating roofs — check those separately.</p>
  </section>
  <section class="card"><div class="sp-head"><h2>Edge settlement</h2><span class="muted small">API 653 B.2.3 / B.3.4 · tank diameter ${fmt(D, 'big', job)}</span></div>
    <div class="tblwrap"><table class="grid sedge"><thead><tr><th></th><th>Angle (°)</th><th title="Length of the settled area along the shell (drawing only)">Arc (${U.big})</th><th title="Radial width of the settled area from the shell">R (${U.big})</th><th title="Settlement measured per Fig. B.6 / B.7">B (${sU})</th><th>Bottom weld in area</th><th title="Weld angle to the tank radius: 0° = perpendicular to shell, 90° = parallel">α (°)</th><th title="Read from Fig. B.11 at R for this tank diameter">Bew (${sU})</th><th title="Read from Fig. B.12 at R for this tank diameter">Be (${sU})</th><th class="n">Allowable</th><th class="n">B / allow</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>${edgeRows}</tbody></table></div>
    <div class="acts row-acts"><button class="btn sm" data-act="se-add" data-k="edge">+ Edge settlement area</button></div>
    ${edgeNotes}
    <p class="muted small">Measure B from a projection of the unsettled bottom (Fig. B.6; for cone-up / cone-down bottoms follow Fig. B.7), over the radial width R. Read <b>Bew</b> from Fig. B.11 (bottom lap weld within ±20° of parallel to the shell) and <b>Be</b> from Fig. B.12 (no weld, butt welds, or lap weld within ±20° of perpendicular) at R for this tank diameter. Lap welds at another angle: B = Be − (Be − Bew)·sin α (B.3.4.4). Any area may be screened against Bew first. At 75 % of the allowable or more, examine the welds by VT and MT/PT (B.3.4.1). The curves assume 1/4 in (6 mm) bottoms and apply to 5/16–3/8 in (8–10 mm).</p>
  </section>
  <section class="card"><div class="sp-head"><h2>Bottom depressions / bulges</h2><span class="muted small">API 653 B.2.5 / B.3.3 · remote from the shell</span></div>
    <div class="tblwrap"><table class="grid sedge"><thead><tr><th></th><th>Angle (°)</th><th>From centre (${U.big})</th><th title="Radius of the inscribed circle of the depression">R (${U.big})</th><th>Depth B (${sU})</th><th class="n">Allowable 0.37·R</th><th class="n">B / allow</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>${depRows}</tbody></table></div>
    <div class="acts row-acts"><button class="btn sm" data-act="se-add" data-k="dep">+ Depression / bulge</button></div>
    <p class="muted small">BB = 0.37·R (BB in inches, R in feet; ${met ? `≈ ${DEP_K.toFixed(4)}·R in mm` : 'metric ≈ 0.031·R'}) for single-pass lap-welded bottoms, smooth depressions with no sharp creases or buckled welds, and plate meeting the minimum bottom thickness. Check that floating roof supports are not affected.</p>
  </section>`;
}
const H_TXT = (c, job) => (c.H > 0 ? fmt(c.H, 'big', job) : '—');

function refreshSettle() {
  setTimeout(() => {
    const c = $('#settleBody'); if (!c) return;
    const a = document.activeElement, key = a && c.contains(a) ? focusSel(a) : null, typed = a && a.value !== undefined && a.value !== a.defaultValue ? a.value : null;
    c.innerHTML = settleBodyHTML();
    if (key) { const n = c.querySelector(key); if (n && typed !== null && n.value !== typed) { n.value = typed; n.dataset.restored = '1'; } if (n) { n.focus({ preventScroll: true }); try { if (typed === null) n.select(); else n.setSelectionRange(n.value.length, n.value.length); } catch { /* */ } } }
  }, 0);
}

/* ------------------------------------------------------------ report view */

function viewReport() {
  const o = S.reportOpts;
  const chk = (k, label) => `<label class="chk sm"><input type="checkbox" data-act="ropt" data-k="${k}" ${o[k] ? 'checked' : ''}><span>${label}</span></label>`;
  return `<div class="report-tools no-print">
    <div><h1>Report</h1><p class="muted small">Print or save as PDF from the browser dialog (choose “Save as PDF”, Letter or A4, margins Default).</p></div>
    <div class="acts">${chk('photos', 'Photos')}${chk('plates', 'Plate register')}${chk('provenOnly', 'Hide false calls')}${chk('plateLabels', 'Plate labels on map')}${chk('datums', 'Datum marks')}
      <button class="btn primary" data-act="print">Print / Save PDF</button></div></div>
    <div class="report-preview" id="reportRoot"></div>`;
}
after.report = () => { $('#reportRoot').innerHTML = buildReport(S.job, S.layout, S.calc, S.company, S.photos, S.reportOpts); };

/* --------------------------------------------------------------- events --- */

document.addEventListener('click', async (e) => {
  const g = e.target.closest('[data-go]');
  if (g && !g.disabled) { go(g.dataset.go); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  const menu = el.closest('details.menu'); if (menu) menu.open = false;
  switch (act) {
    case 'job-new': { const j = newJob(); return createJob(j); }
    case 'job-demo': { const j = makeDemo(); return createJob(j); }
    case 'job-open': return openJob(id);
    case 'job-dup': {
      const j = migrate(await db.getJob(id)); const old = j.id;
      j.id = uid(); j.created = j.updated = Date.now(); j.info.tankId = (j.info.tankId || 'Tank') + ' (copy)';
      await db.putJob(j);
      for (const p of await db.jobPhotos(old)) await db.putPhoto({ ...p, id: uid(), jobId: j.id });
      await loadJobs(); renderView(); toast('Job duplicated'); return;
    }
    case 'job-del': {
      const j = S.jobs.find((x) => x.id === id);
      if (!(await askConfirm(`Delete ${j?.info?.tankId || 'this job'} and its photos from this device? This cannot be undone.`, { ok: 'Delete job', danger: true }))) return;
      await db.deleteJob(id); if (S.job?.id === id) { S.job = null; recompute(); }
      await loadJobs(); renderAll(); return;
    }
    case 'job-save': return saveJobFile(id);
    case 'job-open-file': return openJobFile();
    case 'file-save': return saveJobFile();
    case 'file-save-as': return saveJobFile(S.job?.id, true);
    case 'logo-clear': S.company.logo = null; await db.setMeta('company', S.company); renderView(); return;
    case 'persist': { const ok = await requestPersistence(); toast(ok ? 'Storage is now persistent.' : 'The browser did not grant persistent storage (installing the app usually helps).'); after.jobs(); return; }
    case 'mode': setMode(el.dataset.mode); return;
    case 'datum-set': {
      const c = el.dataset.c;
      applyDatum(el.dataset.key, c);
      if (S.view === 'map') { drawMap(); renderSide(); } return;
    }
    case 'datum-pick': setMode('datum'); return;
    case 'mp-add': {
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
    case 'mp-del': return measuredChange(() => { const sec = findSec(el.dataset.sec); if (sec) sec.plates = (sec.plates || []).filter((x) => x.id !== el.dataset.pl); if (S.selPlate && !S.layout.byKey.has(S.selPlate)) S.selPlate = null; });
    case 'msec-add': return measuredChange((secs) => secs.splice(+el.dataset.at, 0, newMeasuredSection(S.job, el.dataset.type)));
    case 'msec-del': {
      const sec = findSec(el.dataset.sec); if (!sec) return;
      if (!(await askConfirm(`Delete this ${sec.type === 'block' ? 'block' : 'row'} and its ${(sec.plates || []).length} plates?`, { ok: 'Delete', danger: true }))) return;
      return measuredChange((secs) => { const i = secs.indexOf(sec); if (i >= 0) secs.splice(i, 1); });
    }
    case 'msec-move': return measuredChange((secs) => { const i = secs.findIndex((x) => x.id === el.dataset.sec), j = i + +el.dataset.d; if (i >= 0 && j >= 0 && j < secs.length) [secs[i], secs[j]] = [secs[j], secs[i]]; });
    case 'mtpl': {
      if ((S.job.layout.mrows || []).length && !(await askConfirm('Replace all plate-by-plate rows with sizes copied from the automatic or row-by-row layout?', { ok: 'Replace' }))) return;
      return measuredChange(() => { S.job.layout.mrows = measuredFromDrawing({ ...S.job, layout: { ...S.job.layout, mode: (S.job.layout.rows || []).length ? 'custom' : 'grid' } }); });
    }
    case 'row-n': return builderChange((rows) => { const r = rows.find((x) => x.id === el.dataset.row); if (r) r.n = Math.max(0, (+r.n || 0) + +el.dataset.d); });
    case 'row-sug': return builderChange((rows) => { const r = rows.find((x) => x.id === el.dataset.row); if (r) r.n = +el.dataset.v; });
    case 'row-add': return builderChange((rows) => rows.splice(+el.dataset.at, 0, newRow(S.job, el.dataset.type)));
    case 'row-del': {
      const r = S.job.layout.rows.find((x) => x.id === el.dataset.row);
      const n = S.job.indications.filter((i) => S.layout.byKey.get(i.plate)?.rowId === r?.id).length;
      if (n && !(await askConfirm(`${n} indication${n > 1 ? 's are' : ' is'} on this row. They will move to whatever plate covers their spot after the row is deleted.`, { ok: 'Delete row', danger: true }))) return;
      return builderChange((rows) => { const i = rows.findIndex((x) => x.id === el.dataset.row); if (i >= 0) rows.splice(i, 1); });
    }
    case 'row-move': return builderChange((rows) => { const i = rows.findIndex((x) => x.id === el.dataset.row), j = i + +el.dataset.d; if (i >= 0 && j >= 0 && j < rows.length) [rows[i], rows[j]] = [rows[j], rows[i]]; });
    case 'rows-template': {
      if ((S.job.layout.rows || []).length && !(await askConfirm('Replace the current rows with this starting layout? Indications stay where they are on the floor and are moved onto the new plates.', { ok: 'Replace rows' }))) return;
      return builderChange(() => { S.job.layout.rows = el.dataset.t === 'block' ? rowsCentreBlock(S.job) : rowsFromGrid(S.job); });
    }
    case 'plate-size-reset': {
      const o = S.job.plates[el.dataset.key]; if (o) { delete o.len; delete o.wid; delete o.orient; }
      commit(); if (S.view === 'map') { drawMap(); renderSide(); } else refreshPlateTable(); return;
    }
    case 'filter': { const r = el.dataset.r; S.filter.has(r) ? S.filter.delete(r) : S.filter.add(r); el.classList.toggle('on'); drawMap(); return; }
    case 'zoom-in': S.mapCtl?.zoom(1 / 1.4); return;
    case 'zoom-out': S.mapCtl?.zoom(1.4); return;
    case 'zoom-fit': S.mapCtl?.fit(); return;
    case 'sel-ind':
      if (S.view === 'map') { S.sel = id; S.selPlate = S.selFeature = null; drawMap(); renderSide(); } else openIndDialog(id);
      return;
    case 'open-ind': if (S.view === 'map') { S.sel = id; drawMap(); renderSide(); } else openIndDialog(id); return;
    case 'close-sel': S.sel = S.selPlate = S.selFeature = S.selNozzle = null; drawMap(); renderSide(); return;
    case 'ind-close': closeEditor(el); return;
    case 'ind-nav': {
      const inds = S.job.indications.slice().sort(byNo); const i = inds.findIndex((x) => x.id === S.sel);
      const nx = inds[i + +el.dataset.d]; if (!nx) return;
      S.sel = nx.id;
      if (el.closest('dialog')) openIndDialog(nx.id); else { drawMap(); renderSide(); }
      return;
    }
    case 'ind-pick': {
      const d = $('#dlg'); if (d.open) d.close();
      if (S.view !== 'map') go('map');
      setMode('place'); return;
    }
    case 'ind-show': { $('#dlg').close(); go('map'); zoomToInd(); return; }
    case 'ind-zoom': zoomToInd(); return;
    case 'ind-dup': {
      const ind = curInd(); if (!ind) return;
      const c = { ...structuredClone(ind), id: uid(), no: nextNo(S.job), created: Date.now() };
      S.job.indications.push(c); S.sel = c.id; commit(); renderNav();
      if (el.closest('dialog')) { openIndDialog(c.id); refreshIndTable(); } else { drawMap(); renderSide(); }
      toast(`Duplicated as ${c.no}`); return;
    }
    case 'ind-del': {
      const ind = curInd(); if (!ind || !(await askConfirm(`Delete indication ${ind.no}?`, { ok: 'Delete', danger: true }))) return;
      S.job.indications = S.job.indications.filter((i) => i.id !== ind.id);
      for (const p of S.photos.filter((p) => p.indId === ind.id)) await db.deletePhoto(p.id);
      S.photos = S.photos.filter((p) => p.indId !== ind.id);
      S.sel = null; commit(); renderNav();
      if (el.closest('dialog')) { $('#dlg').close(); refreshIndTable(); } else { drawMap(); renderSide(); }
      return;
    }
    case 'ind-new': {
      const ind = { id: uid(), no: nextNo(S.job), plate: '', x: null, y: null, result: 'pending', repair: 'auto', created: Date.now() };
      S.job.indications.push(ind); commit(); renderNav(); refreshIndTable(); openIndDialog(ind.id);
      setTimeout(() => $('#dlg [data-ib="plate"]')?.focus(), 50); return;
    }
    case 'utx-add': {
      const nz = (S.job.nozzles || []).find((x) => x.id === id); if (!nz) return;
      nz.utx = nz.utx || []; const r = { id: uid(), loc: '', t: null }; nz.utx.push(r); commit(); renderSide();
      setTimeout(() => $(`#side [data-nbx="loc"][data-rid="${r.id}"]`)?.focus(), 30); return;
    }
    case 'utx-del': {
      const nz = (S.job.nozzles || []).find((x) => x.id === id); if (!nz) return;
      nz.utx = (nz.utx || []).filter((x) => x.id !== el.dataset.rid); commit(); renderSide(); drawMap(); return;
    }
    case 'nozzle-add': {
      const nz = { id: uid(), mark: nextMark('Nozzle'), type: 'Nozzle', angle: null, size: null, elev: null, service: '' };
      S.job.nozzles = S.job.nozzles || []; S.job.nozzles.push(nz); commit();
      const c = $('#nozzleCard'); if (c) c.innerHTML = nozzleTableHTML();
      setTimeout(() => $(`#nozzleCard input[data-nb="angle"][data-id="${nz.id}"]`)?.focus(), 30); return;
    }
    case 'nozzle-del': {
      const nz = (S.job.nozzles || []).find((x) => x.id === id); if (!nz) return;
      if (!(await askConfirm(`Delete nozzle ${nz.mark || ''}?`, { ok: 'Delete', danger: true }))) return;
      S.job.nozzles = S.job.nozzles.filter((x) => x.id !== id); if (S.selNozzle === id) S.selNozzle = null; commit();
      if (S.view === 'map') { drawMap(); renderSide(); }
      const c = $('#nozzleCard'); if (c) { c.innerHTML = nozzleTableHTML(); refreshSetupPreview(); }
      return;
    }
    case 'utl-down': {
      const areas = loaderAreas(S.job);
      if (!areas.length) { toast('Nothing to load yet — set up the shell courses, nozzles, roof or floor indications first.'); return; }
      await flushSave();
      try { const blob = await buildLoader(S.job); download(fileBase(S.job) + '_UT-loader.xlsx', blob); toast(`UT loader sheet downloaded (${areas.join(', ')}). Give it to the UT technician.`); }
      catch (err) { toast('Could not build the loader sheet: ' + err.message); }
      return;
    }
    case 'utl-up': $('#utlInput').click(); return;
    case 'exp-roof': return download(fileBase(S.job) + '_roof-ut.csv', roofCSV(S.job), 'text/csv');
    case 'exp-settle': return download(fileBase(S.job) + '_settlement.csv', settleCSV(S.job), 'text/csv');
    case 'se-add': { const L = el.dataset.k === 'edge' ? S.job.settle.edge : S.job.settle.dep; const x = el.dataset.k === 'edge' ? newEdge() : newDep(); L.push(x); commit(); refreshSettle(); setTimeout(() => $(`#settleBody input[data-eid="${x.id}"][data-f="angle"]`)?.focus(), 40); return; }
    case 'se-del': { const k = el.dataset.k; S.job.settle[k] = S.job.settle[k].filter((x) => x.id !== el.dataset.eid); commit(); refreshSettle(); return; }
    case 'st-clear': { if (!(await askConfirm('Clear all settlement station readings?', { ok: 'Clear', danger: true }))) return; S.job.settle.el = {}; commit(); refreshSettle(); return; }
    case 'rsel': S.roofSel = el.dataset.key; refreshRoof(); setTimeout(() => $(`.roof-panel input[data-pt="tl"], .roof-panel select[data-rpc]`)?.focus(), 40); return;
    case 'sg-add': {
      const sd = el.dataset.sg === 'p' ? S.job.roof.seal.primary : S.job.roof.seal.secondary;
      const g = newGap(); sd.gaps.push(g); sd.noGaps = false; commit(); refreshRoof();
      setTimeout(() => $(`#roofBody input[data-gid="${g.id}"][data-f="angle"]`)?.focus(), 40); return;
    }
    case 'sg-del': {
      const sd = el.dataset.sg === 'p' ? S.job.roof.seal.primary : S.job.roof.seal.secondary;
      sd.gaps = sd.gaps.filter((x) => x.id !== el.dataset.gid); commit(); refreshRoof(); return;
    }
    case 'rsel-close': S.roofSel = null; refreshRoof(); return;
    case 'rsel-nav': {
      const all = floatingLayout(S.job).plates, cur = all.find((p) => p.key === S.roofSel);
      const list = all.filter((p) => (p.kind === 'annular') === (cur?.kind === 'annular')), i = list.indexOf(cur), nx = list[i + +el.dataset.d];
      if (nx) { S.roofSel = nx.key; refreshRoof(); setTimeout(() => $(`.roof-panel input[data-pt="tl"], .roof-panel select[data-rpc]`)?.focus(), 40); } return;
    }
    case 'roof-fit': S.roofVB[el.dataset.k] = null; refreshRoof(); return;
    case 'rpt-mode': S.roofAdd = !S.roofAdd; refreshRoof(); return;
    case 'rpt-add': {
      const pts = (S.job.roof.fixed.pts = S.job.roof.fixed.pts || []);
      let n = 0; for (const p of pts) { const m = String(p.label || '').match(/^R(\d+)$/); if (m) n = Math.max(n, +m[1]); }
      const pt = { id: uid(), label: 'R' + (n + 1), angle: null, r: null, t: null }; pts.push(pt); S.roofPt = pt.id;
      commit(); refreshRoof(); setTimeout(() => $(`#roofBody input[data-rpt="${pt.id}"][data-f="angle"]`)?.focus(), 40); return;
    }
    case 'rpt-del': {
      const Fx = S.job.roof.fixed, pt = (Fx.pts || []).find((x) => x.id === id); if (!pt) return;
      if (pt.t != null && !(await askConfirm(`Delete point ${pt.label || ''} and its reading?`, { ok: 'Delete', danger: true }))) return;
      Fx.pts = Fx.pts.filter((x) => x.id !== id); if (S.roofPt === id) S.roofPt = null; commit(); refreshRoof(); return;
    }
    case 'rpt-std': {
      const D = +S.job.tank.diameter || 0; if (!(D > 0)) { toast('Enter the tank diameter first.'); return; }
      const Fx = S.job.roof.fixed;
      if ((Fx.pts || []).length && !(await askConfirm('Replace the current fixed roof UT points with the standard set? Readings on the current points will be removed.', { ok: 'Replace', danger: true }))) return;
      const R = D / 2, edge = Math.max(R * 0.5, R - (S.job.units === 'metric' ? 600 : 609.6));
      Fx.pts = [{ id: uid(), label: 'CTR', angle: 0, r: 0, t: null }];
      for (const l of utLocations(S.job)) { Fx.pts.push({ id: uid(), label: `${l.label}-E`, angle: l.angle, r: Math.round(edge), t: null }); Fx.pts.push({ id: uid(), label: `${l.label}-M`, angle: l.angle, r: Math.round(R / 2), t: null }); }
      commit(); refreshRoof(); return;
    }
    case 'exp-shell': return download(fileBase(S.job) + '_shell-ut.csv', shellCSV(S.job), 'text/csv');
    case 'exp-shell-svg': return download(fileBase(S.job) + '_shell-rollout.svg', rolloutSVG(S.job, { print: true }).replace(/(<svg[^>]*>)/, '$1' + SHELL_SVG_STYLE), 'image/svg+xml');
    case 'course-add': {
      const sh = (S.job.shell = S.job.shell || defaultShell()); sh.courses = sh.courses || [];
      const last = sh.courses[sh.courses.length - 1];
      const c = { id: uid(), h: last?.h ?? (S.job.units === 'metric' ? 2400 : 2438.4), tNom: last?.tNom ?? null, tMin: last?.tMin ?? null };
      sh.courses.push(c); commit(); refreshShell(); return;
    }
    case 'course-del': {
      const sh = S.job.shell; const c = sh?.courses?.find((x) => x.id === el.dataset.course); if (!c) return;
      if (!(await askConfirm('Delete this course? The courses above it move down, and readings stay at their elevations.', { ok: 'Delete', danger: true }))) return;
      sh.courses = sh.courses.filter((x) => x.id !== c.id); commit(); refreshShell(); return;
    }
    case 'zone-add': {
      const sh = S.job.shell; sh.zones = sh.zones || [];
      const last = sh.zones[sh.zones.length - 1];
      const ft = S.job.units === 'metric' ? 300 : 304.8;
      sh.zones.push({ id: uid(), start: last && last.end != null ? +last.end + (+last.step || ft) : 0, end: null, step: last?.step ?? ft });
      commit(); refreshShell(); return;
    }
    case 'zone-del': { const sh = S.job.shell; sh.zones = (sh.zones || []).filter((z) => z.id !== el.dataset.zone); commit(); refreshShell(); return; }
    case 'zones-std': {
      if ((S.job.shell.zones || []).length && !(await askConfirm('Replace the reading zones with the standard pattern (every 1 in up to 2 ft, then every 1 ft to the top)? Readings already entered are kept.', { ok: 'Use standard' }))) return;
      S.job.shell.zones = defaultZones(S.job.units); commit(); refreshShell(); return;
    }
    case 'z-add': {
      const inp = $('#extraZ'); const v = toMm(inp?.value, 'small', S.job);
      if (v === null || v < 0) { toast('Enter an elevation above the bottom.'); return; }
      const H = shellHeight(S.job); if (H > 0 && v > H) { toast('That is above the top of the shell.'); return; }
      const sh = S.job.shell; sh.extraZ = sh.extraZ || []; if (!sh.extraZ.some((e) => zKey(e) === zKey(v))) sh.extraZ.push(+zKey(v));
      commit(); refreshShell(); return;
    }
    case 'z-del': {
      const sh = S.job.shell, zk = el.dataset.z;
      const has = Object.values(sh.rd || {}).some((m) => m?.[zk] != null);
      if (has && !(await askConfirm(`Remove the elevation ${fmtElev(+zk, S.job)} and its readings?`, { ok: 'Remove', danger: true }))) return;
      sh.extraZ = (sh.extraZ || []).filter((e) => zKey(e) !== zk); for (const m of Object.values(sh.rd || {})) if (m) delete m[zk];
      commit(); refreshShell(); return;
    }
    case 'courses-std': {
      const sh = (S.job.shell = S.job.shell || defaultShell());
      const hTot = shellHeight(S.job);
      const n = Math.max(1, Math.round(+el.dataset.n || 5)), ch = S.job.units === 'metric' ? 2400 : 2438.4;
      if ((sh.courses || []).length && !(await askConfirm('Replace the current courses?', { ok: 'Replace' }))) return;
      sh.courses = Array.from({ length: n }, () => ({ id: uid(), h: ch, tNom: null, tMin: null })); commit(); refreshShell(); return;
    }
    case 'exp-noz': return download(fileBase(S.job) + '_nozzles.csv', nozzlesCSV(S.job), 'text/csv');
    case 'feature-del': {
      S.job.features = S.job.features.filter((f) => f.id !== S.selFeature); S.selFeature = null; commit(); drawMap(); renderSide(); return;
    }
    case 'photo-del': {
      if (!(await askConfirm('Delete this photo?', { ok: 'Delete', danger: true }))) return;
      await db.deletePhoto(id); S.photos = S.photos.filter((p) => p.id !== id); rerenderEditor(el); return;
    }
    case 'photo-view': { const p = S.photos.find((x) => x.id === id); if (p) { const w = window.open(); w?.document.write(`<title>${h(p.caption || 'Photo')}</title><img src="${p.dataUrl}" style="max-width:100%">`); } return; }
    case 'sort': { const k = el.dataset.k; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 }; renderView(); return; }
    case 'scan-all': { if (!(await askConfirm('Mark every plate as scanned?', { ok: 'Mark all scanned' }))) return; for (const p of S.layout.plates) { S.job.plates[p.key] = { ...(S.job.plates[p.key] || {}), scan: 'scanned' }; } commit(); refreshPlateTable(); return; }
    case 'mrt-preset': S.job.calc.mrtBottom = +el.dataset.v; commit(); renderView(); return;
    case 'print': window.print(); return;
    case 'exp-ind': return download(fileBase(S.job) + '_indications.csv', indicationsCSV(S.job, S.layout, S.calc), 'text/csv');
    case 'exp-plates': return download(fileBase(S.job) + '_plates.csv', platesCSV(S.job, S.layout, S.calc), 'text/csv');
    case 'exp-svg': return download(fileBase(S.job) + '_floor-map.svg', svgForExport(printMap()), 'image/svg+xml');
    case 'exp-png': { const b = await svgToPng(svgForExport(printMap())); return download(fileBase(S.job) + '_floor-map.png', b); }
    case 'exp-json': return saveJobFile(S.job.id, true);
    case 'install': { if (S.installEvt) { S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; renderHeader(); } return; }
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

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.matches('[data-bind]')) {
    const path = el.dataset.bind;
    let v = readInput(el);
    if (el.dataset.num) v = +v;
    if (path === 'layout.annN' && v !== null) v = Math.max(1, Math.round(v));
    const before = S.layout;
    if (path === 'layout.mode' && v === 'measured' && !(S.job.layout.mrows || []).length) S.job.layout.mrows = measuredFromDrawing(S.job);
    setPath(S.job, path, v);
    if (path === 'layout.mode' && v === 'custom' && !(S.job.layout.rows || []).length) { recompute(); S.job.layout.rows = rowsFromGrid(S.job); }
    commit();
    if (path.startsWith('layout.') || path === 'tank.diameter') relocateOrphans(before);
    const structural = path === 'units' || path === 'layout.annular' || path === 'layout.scheme' || path === 'layout.orient' || path === 'layout.refCorner' || path === 'layout.mode';
    if (S.view === 'setup') { if (structural) renderView(); else if (S.job.layout.mode !== 'grid' && path.startsWith('layout.')) refreshBuilder(); else refreshSetupPreview(); renderHeader(); }
    else if (S.view === 'api') refreshApi();
    else if (S.view === 'shell') refreshShell();
    else if (S.view === 'roof') refreshRoof();
    else if (S.view === 'settle') { if (path === 'settle.eu') renderView(); else refreshSettle(); }
    if (path === 'units') renderAll();
    return;
  }
  if (el.matches('[data-st]')) {
    const st = S.job.settle; st.el = st.el || {};
    const v = num(el.value), fct = (ELEV_UNITS[st.eu] || ELEV_UNITS.in)[0];
    if (v === null) delete st.el[el.dataset.st]; else st.el[el.dataset.st] = v * fct;
    commit(); refreshSettle(); return;
  }
  if (el.matches('[data-sts]')) {
    const v = num(el.value); const k = el.dataset.sts;
    S.job.settle[k] = v === null ? null : S.job.units === 'metric' ? v : v / PSI_PER_MPA;
    commit(); refreshSettle(); return;
  }
  if (el.matches('[data-se]')) {
    const L = el.dataset.se === 'edge' ? S.job.settle.edge : S.job.settle.dep;
    const x = L.find((q) => q.id === el.dataset.eid); if (!x) return;
    const k = el.dataset.f; let v = readInput(el);
    if (!['notes', 'weld'].includes(k) && v !== null && v < 0) { toast('Values can’t be negative.'); return; }
    if (k === 'angle' && v !== null) v = ((v % 360) + 360) % 360;
    if (k === 'alpha' && v !== null && v > 90) { toast('Weld angle α is 0–90°.'); return; }
    x[k] = v; commit(); refreshSettle(); return;
  }
  if (el.matches('[data-sg]')) {
    const sd = el.dataset.sg === 'p' ? S.job.roof.seal.primary : S.job.roof.seal.secondary;
    const g = sd.gaps.find((x) => x.id === el.dataset.gid); if (!g) return;
    const k = el.dataset.f; let v = readInput(el);
    if (k !== 'notes' && v !== null && v < 0) { toast('Values can’t be negative.'); return; }
    if (k === 'angle' && v !== null) v = ((v % 360) + 360) % 360;
    g[k] = v; commit(); refreshRoof(); return;
  }
  if (el.matches('[data-sck]') || el.matches('[data-sckn]')) {
    const seal = S.job.roof.seal; seal.checks = seal.checks || {};
    const k = el.dataset.sck || el.dataset.sckn, c = (seal.checks[k] = seal.checks[k] || {});
    if (el.dataset.sck) { if (el.value) c.r = el.value; else delete c.r; } else c.note = el.value;
    if (!c.r && !c.note) delete seal.checks[k];
    commit(); refreshRoof(); return;
  }
  if (el.matches('[data-rut]')) {
    const F = S.job.roof.floating; F.ut = F.ut || {};
    const m = (F.ut[el.dataset.rut] = F.ut[el.dataset.rut] || {}), v = readInput(el);
    if (v !== null && v < 0) { toast('Readings can’t be negative.'); return; }
    if (v === null) delete m[el.dataset.pt]; else m[el.dataset.pt] = v;
    commit(); refreshRoof(); return;
  }
  if (el.matches('[data-rpc]')) {
    const F = S.job.roof.floating; F.pont = F.pont || {};
    const m = (F.pont[el.dataset.rpc] = F.pont[el.dataset.rpc] || {}), v = readInput(el);
    if (v === null || v === '') delete m[el.dataset.f]; else m[el.dataset.f] = v;
    commit(); refreshRoof(); return;
  }
  if (el.matches('[data-rpt]')) {
    const pt = (S.job.roof.fixed.pts || []).find((x) => x.id === el.dataset.rpt); if (!pt) return;
    const k = el.dataset.f; let v = readInput(el);
    if (k !== 'label' && v !== null && v < 0) { toast('Values can’t be negative.'); return; }
    if (k === 'angle' && v !== null) v = ((v % 360) + 360) % 360;
    if (k === 'r' && v !== null && v > (+S.job.tank.diameter || 0) / 2) { toast('That is further from the centre than the shell.'); return; }
    pt[k] = v; commit(); refreshRoof(); return;
  }
  if (el.matches('[data-shc]')) {
    const c = S.job.shell?.courses?.find((x) => x.id === el.dataset.course); if (!c) return;
    let v = readInput(el); const k = el.dataset.shc;
    if (v !== null && v < 0 && k !== 'seam0') { toast('Values can’t be negative.'); return; }
    if (k === 'seam0' && v !== null) v = ((v % 360) + 360) % 360;
    if (k === 'pn' && v !== null) v = Math.max(1, Math.round(v));
    if (v === null) { if (k === 'h') return; delete c[k]; } else c[k] = v;
    commit(); refreshShell(); return;
  }
  if (el.matches('[data-shut]')) {
    const sh = S.job.shell; sh.rd = sh.rd || {};
    const m = (sh.rd[el.dataset.shut] = sh.rd[el.dataset.shut] || {});
    const v = readInput(el);
    if (v !== null && v < 0) { toast('Readings can’t be negative.'); return; }
    if (v === null) delete m[el.dataset.z]; else m[el.dataset.z] = v;
    commit(); refreshShell(); return;
  }
  if (el.matches('[data-zf]')) {
    const zn = S.job.shell?.zones?.find((x) => x.id === el.dataset.zone); if (!zn) return;
    const v = readInput(el), k = el.dataset.zf;
    if (v !== null && v < 0) { toast('Values can’t be negative.'); return; }
    if (k === 'step' && v !== null && v <= 0) { toast('The step must be more than zero.'); return; }
    zn[k] = v;
    const n = readingElevations(S.job).length;
    if (n > 1500) toast(`That gives ${n} elevations per station — check the step.`);
    commit(); refreshShell(); return;
  }
  if (el.matches('[data-nb]')) {
    const nz = (S.job.nozzles || []).find((x) => x.id === el.dataset.id); if (!nz) return;
    const k = el.dataset.nb; let v = readInput(el);
    if (k === 'angle' && v !== null) v = ((v % 360) + 360) % 360;
    if (k === 'type' && (!nz.mark || /^(N|MH|CO)\d+$/.test(nz.mark)) && nzPrefix(v) !== nzPrefix(nz.type)) nz.mark = nextMark(v);
    if (v === null || v === '') delete nz[k]; else nz[k] = v;
    commit();
    refreshNozzleUT(nz);
    if (S.view === 'map') { drawMap(); if (k === 'mark' || k === 'type') renderSide(); }
    if (S.view === 'setup') { const c = $('#nozzleCard'); if (c && (k === 'angle' || k === 'type' || k === 'mark')) setTimeout(() => { c.innerHTML = nozzleTableHTML(); }, 0); refreshSetupPreview(); }
    return;
  }
  if (el.matches('[data-nbx]')) {
    const nz = (S.job.nozzles || []).find((x) => x.id === el.dataset.id); const r = nz?.utx?.find((x) => x.id === el.dataset.rid); if (!r) return;
    const v = readInput(el); if (v === null || v === '') delete r[el.dataset.nbx]; else r[el.dataset.nbx] = v;
    commit(); refreshNozzleUT(nz); if (S.view === 'map') drawMap(); return;
  }
  if (el.matches('[data-secf]')) {
    const k = el.dataset.secf; let v = readInput(el);
    if (k === 'sideN') v = v === null ? 1 : Math.max(1, Math.round(v));
    measuredChange(() => { const sec = findSec(el.dataset.sec); if (!sec) return; if (v === null || v === '') { if (k === 'h') return; delete sec[k]; } else sec[k] = v; });
    return;
  }
  if (el.matches('[data-mpf]')) {
    const k = el.dataset.mpf, v = readInput(el);
    measuredChange(() => { const pl = findSec(el.dataset.sec)?.plates?.find((x) => x.id === el.dataset.pl); if (!pl) return; pl[k] = v > 0 ? v : null; });
    return;
  }
  if (el.matches('[data-rowf]')) {
    const k = el.dataset.rowf; let v = readInput(el);
    if (k === 'n' || k === 'sideN') v = v === null ? null : Math.max(k === 'n' ? 0 : 1, Math.round(v));
    builderChange((rows) => { const r = rows.find((x) => x.id === el.dataset.row); if (!r) return; if (v === null || v === '') { if (k === 'h' || k === 'n') return; delete r[k]; } else r[k] = v; });
    return;
  }
  if (el.matches('[data-ib]')) return onIndField(el);
  if (el.matches('[data-pb]')) {
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
  if (el.matches('[data-fb]')) {
    const ft = S.job.features.find((f) => f.id === el.closest('[data-ed]').dataset.id); if (!ft) return;
    const k = el.dataset.fb;
    if (k === 'plate') { const p = findPlate(el.value); el.closest('.fld').classList.toggle('invalid', !p); if (!p) return; ft.plate = p.key; }
    else { const v = readInput(el); if ((k === 'x' || k === 'y') && v !== null && v < 0) { toast(`${k.toUpperCase()} can't be negative.`); return; } ft[k] = v; }
    commit(); drawMap(); if (k === 'type') renderSide(); return;
  }
  if (el.matches('[data-cb]')) { S.company[el.dataset.cb] = el.value; await db.setMeta('company', S.company); return; }
  if (el.matches('[data-photo-cap]')) { const p = S.photos.find((x) => x.id === el.dataset.photoCap); if (p) { p.caption = el.value; await db.putPhoto(p); } return; }
  const act = el.dataset.act;
  if (act === 'toggle') { S[el.dataset.k] = el.checked; drawMap(); return; }
  if (act === 'ropt') { S.reportOpts[el.dataset.k] = el.checked; after.report(); return; }
  if (act === 'datum-sel') { applyDatum(el.dataset.key, el.value); return; }
  if (act === 'resfilter') { S.resFilter = el.value; refreshIndTable(); return; }
  if (el.id === 'ftType') { S.ftType = el.value; setMode('feature'); return; }
  if (act === 'utl-file') { const f = el.files[0]; el.value = ''; if (f) uploadLoader(f); return; }
  if (act === 'job-import') return importJobFile(el.files[0]).finally(() => (el.value = ''));
  if (act === 'logo') { const f = el.files[0]; if (!f) return; S.company.logo = await resizeImage(f, 600, 'image/png'); await db.setMeta('company', S.company); renderView(); return; }
  if (act === 'photo-add') {
    const ind = S.job.indications.find((i) => i.id === el.closest('[data-ed]').dataset.id); if (!ind) return;
    for (const f of el.files) {
      try { const dataUrl = await resizeImage(f, 1600); const p = { id: uid(), jobId: S.job.id, indId: ind.id, dataUrl, caption: '', created: Date.now() }; await db.putPhoto(p); S.photos.push(p); }
      catch (err) { toast('Could not read ' + f.name); }
    }
    rerenderEditor(el); return;
  }
});

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
  if (e.key === 'Enter' && e.target.matches?.('input[data-st]')) {
    e.preventDefault();
    const inputs = $$('#settleBody input[data-st]'), i = inputs.indexOf(e.target), next = inputs[e.shiftKey ? i - 1 : i + 1];
    const cur = e.target;
    if (next) { next.focus(); next.select(); } // leaving the field fires its change event
    else if (cur.value !== cur.defaultValue) cur.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
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

/** Build the file for the next revision without changing the stored job yet. */
async function jobFileText(id) {
  await flushSave();
  const stored = await db.getJob(id); const photos = await db.jobPhotos(id);
  const at = Date.now();
  const stamp = { rev: (stored.rev || 0) + 1, savedAt: at };
  const job = { ...stored, ...stamp, updated: at, revisions: [...(stored.revisions || []), { rev: stamp.rev, at }].slice(-100) };
  return { job, stamp, text: JSON.stringify({ format: 'tank-floor-inspector', version: 1, saved: new Date(at).toISOString(), rev: stamp.rev, job, photos }) };
}

/** After a successful save, record the new revision on the stored job (and the open one). */
async function applyStamp(id, job) {
  if (S.job?.id === id) {
    Object.assign(S.job, { rev: job.rev, savedAt: job.savedAt, updated: job.updated, revisions: job.revisions });
    await flushSave(); renderHeader();
  } else {
    const stored = await db.getJob(id);
    await db.putJob({ ...stored, rev: job.rev, savedAt: job.savedAt, updated: job.updated, revisions: job.revisions });
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
const unsavedSinceRev = (j) => j?.rev && (j.updated || 0) > (j.savedAt || 0);

async function fileHandle(id, write) {
  const hnd = await db.getMeta('fh:' + id).catch(() => null);
  if (!hnd) return null;
  const mode = { mode: write ? 'readwrite' : 'read' };
  try {
    if ((await hnd.queryPermission(mode)) === 'granted' || (await hnd.requestPermission(mode)) === 'granted') return hnd;
  } catch { /* handle no longer valid */ }
  return null;
}

async function saveJobFile(id = S.job?.id, saveAs = false) {
  if (!id) return;
  const { job, stamp, text } = await jobFileText(id);
  const name = fileBase(job) + '.json';
  if (canPick()) {
    try {
      let hnd = saveAs ? null : await fileHandle(id, true);
      if (!hnd) hnd = await window.showSaveFilePicker({ suggestedName: name, id: 'tank-floor-jobs', startIn: 'documents', types: FILE_TYPES });
      const w = await hnd.createWritable(); await w.write(text); await w.close();
      await db.setMeta('fh:' + id, hnd);
      if (S.job?.id === id) S.fileName = hnd.name;
      await applyStamp(id, job);
      toast(`Saved ${hnd.name} — Rev ${stamp.rev}`);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('Save file failed, downloading instead', e);
    }
  }
  download(name, text, 'application/json');
  await applyStamp(id, job);
  toast(`Downloaded ${name} (Rev ${stamp.rev}). Move it into your OneDrive folder to share it.`);
}

async function openJobFile() {
  if (canPick()) {
    try {
      const [hnd] = await window.showOpenFilePicker({ id: 'tank-floor-jobs', types: FILE_TYPES, multiple: false });
      const id = await importJobFile(await hnd.getFile());
      if (id) { await db.setMeta('fh:' + id, hnd); if (S.job?.id === id) { S.fileName = hnd.name; renderHeader(); } }
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
    const job = migrate(data.job);
    const exists = await db.getJob(job.id);
    const oldId = job.id;
    if (exists) {
      const when = (t) => (t ? new Date(t).toLocaleString() : 'unknown');
      const newer = (job.updated || 0) >= (exists.updated || 0);
      const rv = (j) => (j.rev ? `Rev ${j.rev}` : 'no rev');
      const replace = await askConfirm(`"${job.info.tankId || 'This job'}" is already on this device.\n\nFile: ${rv(job)}, last changed ${when(job.updated)}${newer ? ' (newer)' : ''}\nThis device: ${rv(exists)}, last changed ${when(exists.updated)}${newer ? '' : ' (newer)'}${unsavedSinceRev(exists) ? ' — has changes not saved to a file' : ''}`, { ok: 'Replace with the file', cancel: 'Keep both (open as a copy)' });
      if (replace) await db.deleteJob(oldId);
      else { job.id = uid(); job.info.tankId = (job.info.tankId || 'Tank') + ' (copy)'; }
    }
    await db.putJob(job);
    for (const p of data.photos || []) await db.putPhoto({ ...p, id: job.id === oldId ? p.id : uid(), jobId: job.id });
    await loadJobs(); toast(`Opened ${file.name}`); await openJob(job.id);
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

/** In-app confirmation dialog (works where native confirm() is blocked). Resolves true for OK. */
function askConfirm(msg, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const d = $('#confirmDlg');
    d.innerHTML = `<div class="cf"><p>${h(msg).replace(/\n/g, '<br>')}</p><div class="acts">
      <button type="button" class="btn" data-cf="no">${h(cancel)}</button>
      <button type="button" class="btn ${danger ? 'danger-solid' : 'primary'}" data-cf="yes">${h(ok)}</button></div></div>`;
    d.returnValue = '';
    d.onclick = (e) => { const b = e.target.closest('[data-cf]'); if (b) d.close(b.dataset.cf); };
    d.onclose = () => resolve(d.returnValue === 'yes');
    d.showModal();
    $('[data-cf="yes"]', d).focus();
  });
}

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${h(msg)}</span>${action ? `<button class="btn sm" id="toastAct">${h(action.label)}</button>` : ''}`;
  t.hidden = false; clearTimeout(toastTimer);
  if (action) $('#toastAct').onclick = () => { t.hidden = true; action.fn(); };
  toastTimer = setTimeout(() => (t.hidden = true), action ? 15000 : 3500);
}

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; renderHeader(); });
window.addEventListener('online', () => { const n = $('#netState'); if (n) n.textContent = 'Online'; });
window.addEventListener('offline', () => { const n = $('#netState'); if (n) n.textContent = 'Offline'; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) flushSave(); });
window.addEventListener('beforeprint', () => { if (S.view !== 'report' && S.job) { S._prevView = S.view; go('report'); } });
window.addEventListener('afterprint', () => { if (S._prevView) { const v = S._prevView; S._prevView = null; go(v); } });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is available.', { label: 'Reload', fn: () => location.reload() });
      });
    });
  }).catch(() => { /* offline support unavailable */ });
}

(async function init() {
  S.company = (await db.getMeta('company')) || {};
  await loadJobs();
  const last = await db.getMeta('lastJob');
  if (last && S.jobs.some((j) => j.id === last)) await openJob(last, 'map');
  else renderAll();
})();

window.__app = S; // handy for debugging in the console
