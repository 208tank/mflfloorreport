// Tank section screens — NDE scope, observations, photos (with the annotation editor), analysis and
// recommendations — and the equipment list they pick from (refactoring step 9).
import { S, secData, secPhotos } from '../app/state.js';
import { sxIn, sxSel } from '../app/fields.js';
import { after, childViews, defineView, go, renderNav, renderView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { host } from '../app/host.js';
import { imgDims, resizeImage } from '../app/images.js';
import { nozzleUT, nozzleWall } from '../calc.js';
import { db } from '../db.js';
import { calState, EQ_DETAIL_PH, EQ_LABEL, EQ_TYPES, equipLine, equipName, equipUse, newEquip, suggestEquip, useByMethod } from '../equipment.js';
import { uid } from '../model.js';
import { inScope } from '../registry.js';
import { floatingLayout, hasFixed, hasFloating, plateUT, pointStatus, ROOF_NOTE } from '../roof.js';
import { activeStds, sealEval } from '../seal.js';
import { CHILDREN, CONDITIONS, findings, NDE_METHODS, NDE_RESULTS, newNDE, newObs, newRec, numberDefs, PRIORITIES, PRIORITY_LABEL, SEC, SECTIONS, STATUS_TEXT, STATUSES, typicalNDE, typicalObs, viewPlace } from '../sections.js';
import { $, $$, askConfirm, toast } from '../ui.js';
import { fmt } from '../units.js';
import { esc as h } from '../util.js';
import { rStatus } from '../views/roof.js';
import { shellEvalHTML } from '../views/shell.js';

export function crumbHTML(pl) {
  const sec = SEC.get(pl.sec), ch = CHILDREN.find(([c]) => c === pl.child)?.[1];
  const tabs = pl.child === 'nde' ? `<div class="sec-tabs">${[['nde:' + pl.sec, 'NDE scope'], ...sec.nde].map(([v, l]) => `<button class="sec-tab${S.view === v ? ' on' : ''}" data-go="${v}">${l}</button>`).join('')}</div>` : '';
  return `<div class="crumb${pl.child === 'nde' && S.view === 'map' ? ' over-map' : ''}"><span>${h(sec.label)}</span><b>›</b><span>${ch}</span>${tabs}</div>`;
}
const photoNo = (p) => `${(SEC.get(p.sec)?.label || '').replace(/\s.*/, '').slice(0, 2).toUpperCase()}-${p.n || '?'}`;
const condChip = (c) => (c ? `<span class="cond c-${c}">${(CONDITIONS.find(([k]) => k === c) || [])[1]}</span>` : '');

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

/* Analysis */
export function findingsBox(k) {
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

const _phanno = async (el, id, e, act) => {
  openAnno(id); return;
};
const _recfrom = async (el, id, e, act) => {
  {
    const k = el.dataset.sec, F = findings(S.job, S.layout, S.calc)[k], d = secData(k), used = new Set(d.recs.map((r) => r.auto));
    const items = F.items.filter((it) => !used.has(it.key) && (act === 'rec-all' || it.key === el.dataset.key));
    for (const it of items) d.recs.push(newRec({ finding: it.finding.replace(/<[^>]+>/g, ''), loc: it.loc, action: it.action, priority: it.priority, ref: it.ref, auto: it.key, def: it.priority !== 'P5' }));
    numberDefs(S.job); host.commit(); renderView(); renderNav(); return;
  }
};

defineView('equip', viewEquip);
Object.assign(childViews, { nde: viewNDE, obs: viewObs, photos: viewPhotos, an: viewAnalysis, recs: viewRecs });

onAction({
  'rec-from': _recfrom,
  'rec-all': _recfrom,
  'ph-anno': _phanno,
  'ph-open': _phanno,
  'sx-add': async (el, id, e, act) => {
    {
      const k = el.dataset.sec, kind = el.dataset.kind, it = kind === 'nde' ? newNDE() : kind === 'obs' ? newObs() : newRec();
      secData(k)[kind].push(it); if (kind === 'recs') numberDefs(S.job); host.commit(); renderView(); renderNav();
      setTimeout(() => $(`[data-iid="${it.id}"][data-f="${kind === 'nde' ? 'extent' : kind === 'obs' ? 'item' : 'finding'}"]`)?.focus(), 40); return;
    }
  },
  'sx-del': async (el, id, e, act) => {
    {
      const k = el.dataset.sec, kind = el.dataset.kind, d = secData(k);
      if (kind === 'recs' && !(await askConfirm('Remove this recommendation?', { ok: 'Remove', danger: true }))) return;
      d[kind] = d[kind].filter((x) => x.id !== el.dataset.iid);
      if (kind === 'obs') for (const p of S.photos.filter((p) => p.obs === el.dataset.iid)) { delete p.obs; await db.putPhoto(p); }
      host.commit(); renderView(); renderNav(); return;
    }
  },
  'sx-typ': async (el, id, e, act) => {
    {
      const k = el.dataset.sec, kind = el.dataset.kind, d = secData(k);
      const have = new Set(d[kind].map((x) => (kind === 'nde' ? x.method : x.item)));
      const add = (kind === 'nde' ? typicalNDE(k) : typicalObs(k)).filter((x) => !have.has(kind === 'nde' ? x.method : x.item));
      if (kind === 'nde') for (const x of add) x.equip = suggestEquip(S.job.equipment, x.method);
      d[kind].push(...add); host.commit(); renderView(); renderNav(); toast(add.length ? `Added ${add.length} item${add.length > 1 ? 's' : ''}.` : 'The typical items are already there.'); return;
    }
  },
  'obs-rec': async (el, id, e, act) => {
    {
      const k = el.dataset.sec, o = secData(k).obs.find((x) => x.id === el.dataset.iid); if (!o) return;
      const ph = S.photos.find((p) => p.obs === o.id);
      secData(k).recs.push(newRec({ finding: [o.item, o.text].filter(Boolean).join(': '), loc: o.loc, priority: o.cond === 'poor' ? 'P3' : 'P4', photo: ph?.id || '', obs: o.id }));
      numberDefs(S.job); host.commit(); go('recs:' + k); return;
    }
  },
  'ph-del': async (el, id, e, act) => {
    {
      if (!(await askConfirm('Delete this photo and its annotations?', { ok: 'Delete', danger: true }))) return;
      await db.deletePhoto(id); S.photos = S.photos.filter((p) => p.id !== id); S.job.updated = Date.now(); host.scheduleSave(); renderView(); renderNav(); return;
    }
  },
  'eq-add': async (el, id, e, act) => {
    {
      const e = newEquip(el.dataset.type || 'other'); (S.job.equipment = S.job.equipment || []).push(e);
      // pick it for existing methods that use this type and have nothing of that type yet
      for (const sx of SECTIONS) for (const n of secData(sx.key).nde) if (suggestEquip([e], n.method).length && !(n.equip || []).some((id) => S.job.equipment.find((x) => x.id === id)?.type === e.type)) n.equip = [...(n.equip || []), e.id];
      host.commit(); renderView(); setTimeout(() => $(`[data-eq="make"][data-id="${e.id}"]`)?.focus(), 30); return;
    }
  },
  'eq-dup': async (el, id, e, act) => {
    {
      const src = (S.job.equipment || []).find((x) => x.id === id); if (!src) return;
      const e = newEquip(src.type, { ...src, id: undefined, serial: '' }); e.id = newEquip().id;
      S.job.equipment.splice(S.job.equipment.indexOf(src) + 1, 0, e); host.commit(); renderView(); setTimeout(() => $(`[data-eq="serial"][data-id="${e.id}"]`)?.focus(), 30); return;
    }
  },
  'eq-del': async (el, id, e, act) => {
    {
      const e = (S.job.equipment || []).find((x) => x.id === id); if (!e) return;
      const used = equipUse(S.job, SECTIONS).get(id) || [];
      if (!(await askConfirm(`Remove ${equipName(e)}${e.serial ? ' (S/N ' + e.serial + ')' : ''} from the equipment list?${used.length ? `\n\nIt is picked for: ${used.join('; ')}.` : ''}`, { ok: 'Remove', danger: true }))) return;
      S.job.equipment = S.job.equipment.filter((x) => x.id !== id);
      for (const sx of SECTIONS) for (const n of secData(sx.key).nde) if (n.equip) n.equip = n.equip.filter((x) => x !== id);
      host.commit(); renderView(); return;
    }
  }
});

onChange([
  { order: 290, when: (el, act) => el.matches('[data-ph]'), run: async (el, e, act) => {
    {
    const p = S.photos.find((x) => x.id === el.dataset.ph); if (!p) return;
    const f = el.dataset.f; p[f] = el.type === 'checkbox' ? el.checked : el.value;
    await db.putPhoto(p); S.job.updated = Date.now(); host.scheduleSave(); if (f === 'obs') renderView(); return;
  }
  } },
  { order: 300, when: (el, act) => el.matches('[data-eq]'), run: async (el, e, act) => {
    {
    const e = (S.job.equipment || []).find((x) => x.id === el.dataset.id); if (!e) return;
    e[el.dataset.eq] = el.value.trim(); host.commit();
    if (el.tagName === 'SELECT' || el.type === 'date') renderView();
    return;
  }
  } },
  { order: 310, when: (el, act) => el.matches('[data-eqpick]'), run: async (el, e, act) => {
    {
    const it = secData(el.dataset.sec).nde.find((x) => x.id === el.dataset.iid); if (!it) return;
    const set = new Set(it.equip || []); el.checked ? set.add(el.dataset.eqpick) : set.delete(el.dataset.eqpick);
    it.equip = (S.job.equipment || []).map((e) => e.id).filter((x) => set.has(x)); host.commit();
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
    host.commit(); renderView(); toast(add.length ? `${add.length} item${add.length === 1 ? '' : 's'} copied — check the calibration dates.` : 'Those items are already on the list.'); return;
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
    host.commit();
    if (el.tagName === 'SELECT' || el.type === 'checkbox') { renderView(); renderNav(); }
    return;
  }
  } },
  { order: 430, when: (el, act) => act === 'ph-add', run: async (el, e, act) => {
    {
    const k = el.dataset.sec; let n = Math.max(0, ...S.photos.filter((p) => p.sec === k).map((p) => p.n || 0));
    for (const f of el.files) {
      try { const dataUrl = await resizeImage(f, 1800); const [w, hh] = await imgDims(dataUrl); const p = { id: uid(), jobId: S.job.id, sec: k, n: ++n, dataUrl, w, h: hh, caption: '', comment: '', anno: [], created: Date.now() }; await db.putPhoto(p); S.photos.push(p); }
      catch { toast('Could not read ' + f.name); }
    }
    el.value = ''; S.job.updated = Date.now(); host.scheduleSave(); renderView(); renderNav(); host.checkStorage(); return;
  }
  } }
]);
