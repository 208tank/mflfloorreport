// Tank Floor Inspector — main application.
import { db, requestPersistence } from './db.js';
import { u, toMm, inVal, fmt, fmtRate, unitLabel, num, UNITS } from './units.js';
import { buildLayout, stackSections, suggestCount, halfChord, plateAt, toLocal, itemFloor, angleOf, refCornerName, datumName, orientName } from './geometry.js';
import { api653, RESULTS, RESULT_SHORT, czLimitAuto, plateNominal } from './calc.js';
import { renderMapSVG, MapController } from './map.js';
import { download, indicationsCSV, platesCSV, nozzlesCSV, svgForExport, svgToPng, fileBase } from './export.js';
import { buildReport, legendHTML } from './report.js';
import { newJob, migrate, nextNo, uid, getPath, setPath } from './model.js';
import { makeDemo } from './demo.js';
import { newRow, rowsFromGrid, rowsCentreBlock, coverage, newPlate, newMeasuredSection, measuredFromDrawing } from './builder.js';

const APP_VERSION = '1.8.0';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  jobs: [], job: null, layout: null, calc: null, photos: [], company: {},
  view: 'jobs', sel: null, selPlate: null, selFeature: null, selNozzle: null, mode: 'select', ftType: 'column',
  plateLabels: true, indLabels: true, showCZ: true, showDatums: true, filter: new Set(Object.keys(RESULTS)),
  search: '', resFilter: 'all', sort: { key: 'no', dir: 1 }, plateSearch: '',
  reportOpts: { photos: true, plates: false, provenOnly: false, plateLabels: true, datums: true },
  mapCtl: null, vb: null, installEvt: null, saving: false
};

const VIEWS = [
  ['jobs', 'Jobs', 'M4 5h16M4 12h16M4 19h10'],
  ['setup', 'Tank setup', 'M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
  ['map', 'Floor map', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3v18'],
  ['inds', 'Indications', 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'],
  ['plates', 'Plates', 'M3 4h8v7H3zM13 4h8v7h-8zM3 13h8v7H3zM13 13h8v7h-8z'],
  ['api', 'API 653', 'M5 4h14v16H5zM9 8h6M9 12h6M9 16h3'],
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
  const fn = { jobs: viewJobs, setup: viewSetup, map: viewMap, inds: viewInds, plates: viewPlates, api: viewApi, report: viewReport }[S.view];
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
        ${field('API 653 inspector', 'info.inspector', 'text', { cls: 'span2' })}
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
      const a = document.activeElement, key = a && c.contains(a) ? focusSel(a) : null, pos = a?.selectionStart;
      c.innerHTML = S.job.layout.mode === 'measured' ? measuredHTML() : builderHTML();
      if (key) { const n = c.querySelector(key); if (n) { n.focus(); try { if (pos != null) n.setSelectionRange(0, n.value.length); } catch { /* */ } } }
    }
    refreshSetupPreview();
  }, 0);
}
function focusSel(el) {
  const attrs = ['data-rowf', 'data-row', 'data-secf', 'data-sec', 'data-mpf', 'data-pl', 'data-bind', 'data-act'];
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
      ${f('Notes', 'notes', 'area', { rows: 2, cls: 'span2' })}
    </div>
    <p class="muted small">Nozzles are located by angle around the shell, measured clockwise from 0° ${h(S.job.info.zeroRef || '')}. All nozzles are listed in Tank setup → Shell nozzles and in the report.</p>
    <div class="ed-foot"><span></span><button class="btn sm danger ghost" data-act="nozzle-del" data-id="${nz.id}">Delete nozzle</button></div></div>`;
}

function nozzleTableHTML() {
  const list = (S.job.nozzles || []);
  const U = u(S.job);
  const inp = (n, k, kind, extra = '') => kind === 'sel'
    ? `<select data-nb="${k}" data-id="${n.id}" data-kind="text">${NZ_TYPES.map((t) => `<option ${n[k] === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`
    : `<input data-nb="${k}" data-id="${n.id}" data-kind="${kind}" ${kind !== 'text' ? 'inputmode="decimal" class="num"' : ''} value="${h(kind === 'small' ? inVal(n[k], 'small', S.job) : n[k] ?? '')}" ${extra}>`;
  return `<div class="sp-head"><h2>Shell nozzles</h2><span class="muted small">${list.length} on the shell</span></div>
    <p class="muted small">Angle is clockwise from 0° (${h(S.job.info.zeroRef || 'the 0° reference')}). You can also add a nozzle on the Floor map with <b>+ Nozzle</b> and a click at the shell.</p>
    <div class="tblwrap"><table class="grid nozzles"><thead><tr><th>Mark</th><th>Type</th><th>Angle (°)</th><th>Size (${U.small})</th><th>Elev. (${U.small})</th><th>Service / description</th><th></th></tr></thead><tbody>
    ${list.slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0)).map((n) => `<tr><td>${inp(n, 'mark', 'text', 'class="mk"')}</td><td>${inp(n, 'type', 'sel')}</td><td>${inp(n, 'angle', 'num')}</td><td>${inp(n, 'size', 'small')}</td><td>${inp(n, 'elev', 'small')}</td><td>${inp(n, 'service', 'text')}</td><td><button class="btn sm icon ghost danger" data-act="nozzle-del" data-id="${n.id}" title="Delete">✕</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No nozzles yet.</td></tr>'}
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
      <div class="acts"><button class="btn primary" data-act="ind-new">New indication</button><button class="btn" data-act="exp-ind">Export CSV</button></div></div>
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
    if (path === 'units') renderAll();
    return;
  }
  if (el.matches('[data-nb]')) {
    const nz = (S.job.nozzles || []).find((x) => x.id === el.dataset.id); if (!nz) return;
    const k = el.dataset.nb; let v = readInput(el);
    if (k === 'angle' && v !== null) v = ((v % 360) + 360) % 360;
    if (k === 'type' && (!nz.mark || /^(N|MH|CO)\d+$/.test(nz.mark)) && nzPrefix(v) !== nzPrefix(nz.type)) nz.mark = nextMark(v);
    if (v === null || v === '') delete nz[k]; else nz[k] = v;
    commit();
    if (S.view === 'map') { drawMap(); if (k === 'mark' || k === 'type') renderSide(); }
    if (S.view === 'setup') { const c = $('#nozzleCard'); if (c && (k === 'angle' || k === 'type' || k === 'mark')) setTimeout(() => { c.innerHTML = nozzleTableHTML(); }, 0); refreshSetupPreview(); }
    return;
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
