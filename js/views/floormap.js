// Floor map: the drawing, zoom and selection, datums, the side panel and its editors for indications,
// features, plates and nozzles, and the indication editor dialog (refactoring step 12).
import { byNo, COATING, FT_TYPES, nextMark, NZ_TYPES, REPAIR_METHOD, RESULT_OPTS, S, UT_METHOD, VT_COND } from '../app/state.js';
import { field, readInput } from '../app/fields.js';
import { lockedNow } from '../app/lock.js';
import { defineView, go, redraw, renderNav } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { checkStorage, commit, photoRoomOk } from '../app/persist.js';
import { resizeImage } from '../app/images.js';
import { nozzleWall, NZ_CONN, plateNominal, RESULT_SHORT, statusText, UT_CLOCK } from '../calc.js';
import { db } from '../db.js';
import { angleOf, datumName, itemFloor, orientName, plateAt, refCornerName, toLocal } from '../geometry.js';
import { MapController, renderMapSVG } from '../map.js';
import { nextNo, uid } from '../model.js';
import { patchList, patchOf } from '../patches.js';
import { legendHTML } from '../report.js';
import { $, $$, askConfirm, toast } from '../ui.js';
import { fmt, inVal, toMm, u } from '../units.js';
import { esc as h } from '../util.js';
import { refreshApi } from './api.js';
import { refreshIndTable, refreshPlateTable } from './floorlists.js';
import { addArea } from './floorut.js';
import { nozzleUTBox } from './nozzles.js';
import { findSec, rowLetter } from './setup.js';

function viewMap() {
  const chips = RESULT_OPTS.map(([k, v]) => `<button class="chip r-${k}${S.filter.has(k) ? ' on' : ''}" data-act="filter" data-r="${k}" title="${v}">${RESULT_SHORT[k]}<em>${S.job.indications.filter((i) => (i.result || 'pending') === k).length}</em></button>`).join('');
  return `<div class="mapview">
    <div class="maptools">
      <div class="seg">
        <button class="btn sm${S.mode === 'select' ? ' on' : ''}" data-act="mode" data-mode="select" title="Select / pan (Esc)">Select</button>
        <button class="btn sm${S.mode === 'add' ? ' on' : ''}" data-act="mode" data-mode="add" title="Click the map to add an indication (N). Hold Shift to add several.">+ Indication <kbd>N</kbd></button>
        <button class="btn sm${S.mode === 'feature' ? ' on' : ''}" data-act="mode" data-mode="feature" title="Click the map to add a floor feature">+ Feature</button>
        <button class="btn sm${S.mode === 'nozzle' ? ' on' : ''}" data-act="mode" data-mode="nozzle" title="Click at the shell to add a nozzle at that angle">+ Nozzle</button>
        <button class="btn sm${S.mode === 'utarea' ? ' on' : ''}" data-act="mode" data-mode="utarea" title="Click the map to add a UT area centred there (readings on Floor → UT readings)">+ UT area</button>
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
        <label class="chk sm"><input type="checkbox" data-act="toggle" data-k="showUT" ${S.showUT ? 'checked' : ''}><span>UT</span></label>
      </div>
      <div class="seg zoom"><button aria-label="Zoom out" class="btn sm icon" data-act="zoom-out" title="Zoom out">−</button><button aria-label="Zoom in" class="btn sm icon" data-act="zoom-in" title="Zoom in">+</button><button class="btn sm" data-act="zoom-fit" title="Fit (F)">Fit</button></div>
    </div>
    <div class="mapbox" id="mapbox" data-mode="${S.mode}"></div>
    <div class="mapstatus"><span id="hoverInfo">Scroll to zoom · drag to pan</span><span id="modeHint"></span></div>
  </div>
  <aside class="side" id="side"></aside>`;
}
const afterMap = () => {
  S.mapCtl = new MapController($('#mapbox'), { onClick: mapClick, onHover: mapHover, rerender: drawMap });
  if (S.vb && S.vbR === S.layout.R) { S.mapCtl.vb = S.vb; S.mapCtl.r = S.layout.R; }
  const orig = S.mapCtl.setVB.bind(S.mapCtl);
  S.mapCtl.setVB = (vb) => { orig(vb); S.vb = vb; S.vbR = S.layout.R; };
  drawMap();
  renderSide();
  const fit = S.mapCtl.fit.bind(S.mapCtl);
  S.mapCtl.fit = () => { S.vb = null; fit(); };
};

export function drawMap() {
  const box = $('#mapbox'); if (!box) return;
  box.innerHTML = renderMapSVG(S.job, S.layout, {
    calc: S.calc, selected: S.sel, selPlate: S.selPlate, selFeature: S.selFeature, selNozzle: S.selNozzle,
    plateLabels: S.plateLabels, indLabels: S.indLabels, filter: S.filter, showCZ: S.showCZ, showPatches: S.showPatches, showUT: S.showUT,
    showDatums: S.showDatums || S.mode === 'datum', datumFocus: focusPlate(),
    floorOf: (ft) => itemFloor(S.layout, ft)
  });
  box.dataset.mode = S.mode;
  S.mapCtl?.afterRender();
  const hint = { nozzle: 'Click at the shell where the nozzle is — its angle is taken from the click · Esc to stop', datum: 'Click inside a plate, in the corner the X/Y was measured from · Esc to stop', select: '', add: 'Click a plate to place an indication · Shift-click to keep adding · Esc to stop', feature: 'Click to place the feature · Esc to stop', utarea: 'Click a plate at the centre of the UT area · Shift-click to keep adding · Esc to stop', place: 'Click the map to set this indication\'s location · Esc to cancel' }[S.mode];
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
  if (S.mode === 'utarea') {
    if (!p) return toast('That point is not on a plate.');
    const { X, Y } = toLocal(S.layout, p, fp.x, fp.y);
    const a = addArea({ plate: p.key, x: roundLocal(X), y: roundLocal(Y) });
    if (!hit.shift) S.mode = 'select';
    $$('[data-act="mode"]').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
    commit(); drawMap();
    toast(`UT area ${a.no} added on ${p.label}. Enter its size and readings on Floor → UT readings.`, { label: 'Open', fn: () => go('flut') });
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

export function renderSide(focusFirst) {
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

export function setMode(m) {
  if (m === 'place' && !S.sel) m = 'select';
  if (lockedNow()) m = 'select'; // a Complete job: look and select only
  S.mode = m;
  $$('[data-act="mode"]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m || (m === 'place' && b.dataset.mode === 'add')));
  drawMap();
}

function zoomToInd() {
  const a = S.calc.per.get(S.sel); if (!a?.floor || !S.mapCtl) return;
  S.mapCtl.focus(a.floor.x, a.floor.y, S.layout.R * 0.5); drawMap(); renderSide();
}

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

defineView('map', viewMap, afterMap);
Object.assign(redraw, { map: drawMap, side: renderSide, mapMode: setMode });

onAction({
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
      for (const p of S.photos.filter((p) => p.indId === ind.id)) await db.binPhoto(p.id);
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
  'feature-del': async (el, id, e, act) => {
    {
      S.job.features = S.job.features.filter((f) => f.id !== S.selFeature); S.selFeature = null; commit(); drawMap(); renderSide(); return;
    }
  },
  'photo-del': async (el, id, e, act) => {
    {
      if (!(await askConfirm('Delete this photo?', { ok: 'Delete', danger: true }))) return;
      await db.binPhoto(id); S.photos = S.photos.filter((p) => p.id !== id); rerenderEditor(el); return;
    }
  },
  'photo-view': async (el, id, e, act) => {
    { const p = S.photos.find((x) => x.id === id); if (p) { const w = window.open(); w?.document.write(`<title>${h(p.caption || 'Photo')}</title><img src="${p.dataUrl}" style="max-width:100%">`); } return; }
  }
});

onChange([
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
  { order: 440, when: (el, act) => act === 'photo-add', run: async (el, e, act) => {
    {
    const ind = S.job.indications.find((i) => i.id === el.closest('[data-ed]').dataset.id); if (!ind) return;
    if (!(await photoRoomOk())) { el.value = ''; return; } // stage 12
    for (const f of el.files) {
      try { const dataUrl = await resizeImage(f, 1600); const p = { id: uid(), jobId: S.job.id, indId: ind.id, dataUrl, caption: '', created: Date.now() }; await db.putPhoto(p); S.photos.push(p); }
      catch (err) { toast('Could not read ' + f.name); }
    }
    rerenderEditor(el); checkStorage(); return;
  }
  } }
]);

/* Floor map keys: Esc leaves a mode or clears the selection; N add, D datum, F fit, + / - zoom. */
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
