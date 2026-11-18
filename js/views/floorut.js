// Floor → UT readings (schema 7): selected areas located from a plate datum, critical zone scans around the
// circumference (with lower shell scans at the same places, if chosen) and five readings per plate.
// The rules are in floorut.js; the API 653 evaluation (calc.js) uses the readings as remaining thickness.
import { S } from '../app/state.js';
import { field, focusSel, readInput } from '../app/fields.js';
import { defineView, renderNav } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { commit } from '../app/persist.js';
import { download, fileBase, floorUTCSV } from '../export.js';
import {
  AREA_SIDES, AREA_TYPES, areaIssues, czLastGap, czOrphans, czStations, nextAreaNo, plateOrphans, plateReadings, PT5_KEYS, shellScans, shellScanTmin
} from '../floorut.js';
import { uid } from '../model.js';
import { PT5 } from '../roof.js';
import { $, askConfirm, toast } from '../ui.js';
import { fmt, inVal, u } from '../units.js';
import { esc as h } from '../util.js';

const T = (v) => (v == null ? '—' : fmt(v, 't', S.job, false));
const blank = (v) => v === null || v === undefined || v === '';
const stChip = (st) => (!st ? '' : `<span class="st ${st === 'OK' ? 'st-OK' : st === 'not evaluated' || /Evaluate/.test(st) ? 'st-pending' : 'st-below-MRT'}">${h(st === 'below MRT' ? 'Below MRT' : st === 'not evaluated' ? 'Not evaluated' : st)}</span>`);
const ptOf = (id) => (S.calc?.ut?.pts || []).find((q) => q.id === id) || null;
const findPlate = (label) => { const q = String(label || '').trim().toLowerCase(); return S.layout.plates.find((p) => p.label.toLowerCase() === q || p.key.toLowerCase() === q) || null; };

function viewFloorUT() {
  return `<div class="page wide flut-page"><div class="page-head"><div><h1>Floor UT readings</h1>
    <p class="muted">UT thickness of selected areas, critical zone scans at the shell (and lower shell scans at the same places), and five readings per plate. Readings in ${u(S.job).small}; the API 653 evaluation uses them as remaining thickness.</p></div>
    <div class="acts"><button class="btn" data-act="utl-down" title="Excel sheet for the UT technician">UT loader ↓</button><button class="btn" data-act="utl-up" title="Upload the completed UT loader sheet">UT loader ↑</button><button class="btn" data-act="exp-flut">Export CSV</button></div></div>
    <div id="flutBody">${bodyHTML()}</div></div>`;
}

/** Redraw after the change event, once focus has moved on (Tab / Enter); a value being typed is kept. */
export function refreshFloorUT() {
  setTimeout(() => {
    const c = $('#flutBody'); if (!c || !S.job) return;
    const a = document.activeElement, key = a && c.contains(a) ? focusSel(a) : null, typed = a && a.value !== undefined && a.value !== a.defaultValue ? a.value : null;
    c.innerHTML = bodyHTML();
    if (key) { const n = c.querySelector(key); if (n && typed !== null && n.value !== typed) { n.value = typed; n.dataset.restored = '1'; } if (n) { n.focus({ preventScroll: true }); try { if (typed === null) n.select(); else n.setSelectionRange(n.value.length, n.value.length); } catch { /* */ } } }
  }, 0);
}

function bodyHTML() {
  const job = S.job, F = job.floorUT, pts = S.calc?.ut?.pts || [];
  const below = pts.filter((q) => q.status === 'below MRT').length, minPt = pts.length ? pts.reduce((m, q) => (q.t < m.t ? q : m)) : null;
  const sh = shellScans(job), shBad = sh.filter((x) => x.status && x.status !== 'OK').length;
  const sum = `<section class="card"><div class="sum-grid four">
    <div><span>Readings</span><b>${pts.length}</b><small>${(F.areas || []).length} areas · ${F.cz?.on ? czStations(job).length + ' CZ scans' : 'no CZ scans'} · ${F.plates?.on ? 'plate readings on' : 'plate readings off'}</small></div>
    <div><span>Thinnest</span><b>${minPt ? T(minPt.t) : '—'}</b><small>${minPt ? h(minPt.label) + (minPt.plate ? ' · ' + h(minPt.plate.label) : '') : 'no readings yet'}</small></div>
    <div><span>Below MRT at Oᵣ</span><b class="${below ? 'bad' : pts.length ? 'ok' : ''}">${pts.length ? below : '—'}</b><small>against the area's API 653 limit</small></div>
    <div><span>Lower shell scans</span><b class="${shBad ? 'bad' : sh.some((x) => x.t !== null) ? 'ok' : ''}">${F.cz?.on && F.cz.shell ? (shBad ? shBad + ' below t-min' : sh.filter((x) => x.t !== null).length + ' read') : 'off'}</b><small>${F.cz?.on && F.cz.shell ? 'vs course 1 t-min ' + T(shellScanTmin(job).tMin) : 'switch on under critical zone scans'}</small></div>
  </div><p class="muted small">Readings with no known side of loss set the remaining thickness (RT) of their area; an area marked product side or soil side also sets StPᵣ / UPᵣ from its loss. UT readings are not repaired automatically: a reading below the minimum is listed on the API 653 page — record the repair as an indication, or shorten Oᵣ.</p></section>`;
  return sum + areasHTML() + czHTML() + platesHTML();
}

/* ------------------------------------------------------------------------- selected areas --- */

function areasHTML() {
  const job = S.job, areas = job.floorUT.areas || [], U = u(job);
  const inp = (a, f, kind = 't', extra = '') => `<input data-fua="${a.id}" data-f="${f}" data-kind="${kind}" ${kind === 'text' ? '' : 'inputmode="decimal"'} value="${h(kind === 'text' ? a[f] ?? '' : inVal(a[f], kind, job))}" ${extra}>`;
  const sel = (a, f, opts) => `<select data-fua="${a.id}" data-f="${f}" data-kind="text">${opts.map(([k, l]) => `<option value="${k}" ${(a[f] || '') === k ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>`;
  const row = (a) => {
    const q = ptOf(a.id), p = S.layout.byKey.get(a.plate), iss = areaIssues(a);
    return `<tr class="${q?.status === 'below MRT' ? 'is-bad' : ''}">
      <td>${inp(a, 'no', 'text', 'class="sm-no"')}${q?.critical ? ' <span class="chip cz">CZ</span>' : ''}</td>
      <td><input data-fua="${a.id}" data-f="plate" data-kind="text" class="${a.plate && !p ? 'invalid' : ''}" value="${h(p?.label ?? a.plate ?? '')}" placeholder="Plate"></td>
      <td>${inp(a, 'x', 'small')}</td><td>${inp(a, 'y', 'small')}</td><td>${inp(a, 'len', 'small')}</td><td>${inp(a, 'wid', 'small')}</td>
      <td>${inp(a, 'tMin')}</td><td>${inp(a, 'tAvg')}</td>
      <td>${sel(a, 'type', AREA_TYPES)}${a.type === 'custom' ? inp(a, 'typeText', 'text', 'placeholder="Describe" class="mt4"') : ''}</td>
      <td>${sel(a, 'side', AREA_SIDES)}</td>
      <td class="n">${q?.lossPct != null ? q.lossPct.toFixed(0) + '%' : '—'}</td><td class="n">${q ? T(q.projected) : '—'}</td><td>${stChip(q?.status)}${iss.length ? `<br><small class="bad">${h(iss.join('; '))}</small>` : ''}</td>
      <td>${inp(a, 'notes', 'text')}</td>
      <td><button class="btn sm icon ghost" data-act="flut-area-del" data-id="${a.id}" title="Remove area" aria-label="Remove area">✕</button></td></tr>`;
  };
  return `<section class="card"><div class="sp-head"><h2>Selected areas</h2><span class="muted small">${areas.length} area${areas.length === 1 ? '' : 's'}</span><span class="spacer"></span><button class="btn sm primary" data-act="flut-area-add">+ Area</button></div>
    <p class="muted small">An area is located by its plate and the <b>centre of the area</b> measured X / Y from the plate's datum corner (as for an indication), with its length along X and width along Y. Record the minimum and average thickness and the condition. Areas can also be placed by clicking the Floor map (<i>+ UT area</i>).</p>
    ${areas.length ? `<div class="tblwrap"><table class="grid flut-areas"><thead><tr><th>No.</th><th>Plate</th><th>X (${U.small})</th><th>Y (${U.small})</th><th>Length</th><th>Width</th><th>Min</th><th>Average</th><th>Condition</th><th>Side of loss</th><th class="n">Loss</th><th class="n">t at Oᵣ</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>${areas.map(row).join('')}</tbody></table></div>` : '<p class="empty">No areas yet.</p>'}
  </section>`;
}

/* -------------------------------------------------------------------- critical zone scans --- */

function czHTML() {
  const job = S.job, C = job.floorUT.cz, U = u(job);
  const head = `<div class="sp-head"><h2>Critical zone scans</h2><span class="muted small">square scans at the shell, around the circumference</span></div>
    <div class="fgrid g4">${field('Critical zone scans', 'floorUT.cz.on', 'bool')}${C.on ? `${field('Spacing (along the shell)', 'floorUT.cz.spacing', 'big', { hint: 'set by the inspector' })}${field('First scan at', 'floorUT.cz.start', 'num', { unit: '°', ph: '0' })}${field('Scan size (square)', 'floorUT.cz.size', 'small', { hint: '6 × 6 in standard' })}${field('Lower shell scans at the same locations and size', 'floorUT.cz.shell', 'bool')}` : ''}</div>`;
  if (!C.on) return `<section class="card">${head}<p class="muted small">Switch on to record a ${fmt(C.size, 'small', job)} × ${fmt(C.size, 'small', job)} scan inside the shell every chosen distance around the tank.</p></section>`;
  const st = czStations(job), gap = czLastGap(job), orph = czOrphans(job), sh = new Map(shellScans(job).map((x) => [x.key, x])), T1 = shellScanTmin(job);
  if (!st.length) return `<section class="card">${head}<p class="callout warn">Enter the tank diameter and a spacing to lay out the scans.</p></section>`;
  const inp = (s, f, kind = 't') => `<input data-fcz="${s.key}" data-f="${f}" data-kind="${kind}" ${kind === 'text' ? '' : 'inputmode="decimal"'} value="${h(kind === 'text' ? C.rd?.[s.key]?.[f] ?? '' : inVal(C.rd?.[s.key]?.[f], kind, job))}">`;
  const row = (s) => {
    const q = ptOf('cz:' + s.key), x = sh.get(s.key);
    return `<tr class="${q?.status === 'below MRT' || (x?.status && x.status !== 'OK') ? 'is-bad' : ''}"><td><b>${s.no}</b></td><td class="n">${s.angle.toFixed(1)}°</td><td class="n">${fmt(s.s, 'big', job, false)}</td><td>${h(q?.plate?.label || '')}</td>
      <td>${inp(s, 'tMin')}</td><td>${inp(s, 'tAvg')}</td><td class="n">${q ? T(q.projected) : '—'}</td><td>${stChip(q?.status)}</td><td>${inp(s, 'note', 'text')}</td>
      ${C.shell ? `<td>${inp(s, 'sMin')}</td><td>${inp(s, 'sAvg')}</td><td>${stChip(x?.status)}</td><td>${inp(s, 'sNote', 'text')}</td>` : ''}</tr>`;
  };
  return `<section class="card">${head}
    <p class="muted small">${st.length} scans, one every ${fmt(C.spacing, 'big', job)} from ${(+C.start || 0).toFixed(1)}° clockwise${gap !== null && Math.abs(gap - C.spacing) > 1 ? `; the last gap, back to CZ-1, is ${fmt(gap, 'big', job)}` : ''}. Each scan is ${fmt(C.size, 'small', job)} square with its outer edge at the shell, so it covers the critical zone (${fmt(job.calc.czDist, 'small', job)}) and is evaluated against the critical zone limit.${C.shell ? ` Lower shell scans are the same size on course 1 just above the shell-to-bottom weld, compared with the course 1 t-min (${T(T1.tMin)} ${u(job).small}, ${h(T1.src)}).` : ''}</p>
    ${orph.length ? `<p class="callout warn">${orph.length} scan reading${orph.length > 1 ? 's are' : ' is'} at an angle that is no longer a scan (${orph.slice(0, 6).map((k) => k + '°').join(', ')}${orph.length > 6 ? ', …' : ''}) after the spacing or start changed. Change them back to see the readings, or re-enter them.</p>` : ''}
    <div class="tblwrap rd-wrap"><table class="grid flut-cz"><thead><tr><th>Scan</th><th class="n">Angle</th><th class="n">From start (${U.big})</th><th>Plate</th><th>Floor min</th><th>Floor avg</th><th class="n">t at Oᵣ</th><th>Status</th><th>Note</th>${C.shell ? '<th>Shell min</th><th>Shell avg</th><th>Shell status</th><th>Shell note</th>' : ''}</tr></thead><tbody>${st.map(row).join('')}</tbody></table></div>
  </section>`;
}

/* ------------------------------------------------------------------- five readings per plate --- */

function platesHTML() {
  const job = S.job, P = job.floorUT.plates;
  const head = `<div class="sp-head"><h2>Five readings per plate</h2><span class="muted small">four corners and the centre, as on a floating roof deck</span></div><div class="fgrid g4">${field('Five readings per plate', 'floorUT.plates.on', 'bool')}</div>`;
  if (!P.on) return `<section class="card">${head}</section>`;
  const orph = plateOrphans(job, S.layout);
  const rin = (p, k) => `<input data-fpl="${p.key}" data-pt="${k}" data-kind="t" inputmode="decimal" value="${h(inVal(P.rd?.[p.key]?.[k], 't', job))}">`;
  const q = String(S.flutPlateSearch || '').trim().toLowerCase();
  const plates = S.layout.plates.filter((p) => !q || p.label.toLowerCase().includes(q));
  const pts = S.calc?.ut?.pts || [];
  const row = (p) => {
    const x = plateReadings(job, p), mine = pts.filter((z) => z.kind === 'plate' && z.plate === p), worst = mine.length ? mine.reduce((m, z) => (z.projected < m.projected ? z : m)) : null;
    return `<tr class="${worst?.status === 'below MRT' ? 'is-bad' : ''}"><td><b>${h(p.label)}</b>${p.kind === 'annular' ? ' <small class="muted">annular</small>' : p.cut ? ' <small class="muted">cut</small>' : ''}</td>${PT5.map(([k]) => `<td>${rin(p, k)}</td>`).join('')}
      <td class="n"><b>${T(x.min)}</b></td><td class="n">${T(x.avg)}</td><td class="n">${worst ? T(worst.projected) : '—'}</td><td>${stChip(worst?.status)}</td></tr>`;
  };
  const done = S.layout.plates.filter((p) => plateReadings(job, p).count === 5).length;
  return `<section class="card">${head}
    <p class="muted small">${done} of ${S.layout.plates.length} plates fully read. The plate's thinnest reading is its general thickness in the evaluation; readings within the critical zone distance of the shell are checked against the critical zone limit. Tab moves across a row.</p>
    ${orph.length ? `<p class="callout warn">${orph.length} plate${orph.length > 1 ? 's' : ''} with readings ${orph.length > 1 ? 'are' : 'is'} no longer in the layout. Change the layout back to see them, or re-enter the readings.</p>` : ''}
    <div class="toolbar"><input type="search" placeholder="Filter plates…" value="${h(S.flutPlateSearch || '')}" data-act="flut-plate-search" class="search"></div>
    <div class="tblwrap rd-wrap"><table class="grid rplates flut-pl"><thead><tr><th>Plate</th>${PT5.map(([, l]) => `<th>${l}</th>`).join('')}<th class="n">Min</th><th class="n">Avg</th><th class="n">t at Oᵣ</th><th>Status</th></tr></thead><tbody>${plates.map(row).join('')}</tbody></table></div>
  </section>`;
}

/* ------------------------------------------------------------------------------- actions --- */

/** A new area at a plate position (also used by the Floor map's "+ UT area" mode). */
export function addArea(loc = {}) {
  const job = S.job, sz = job.units === 'metric' ? 300 : 304.8;
  const a = { id: uid(), no: nextAreaNo(job), plate: loc.plate || '', x: loc.x ?? null, y: loc.y ?? null, len: sz, wid: sz, tMin: null, tAvg: null, type: '', typeText: '', side: '', notes: '' };
  job.floorUT.areas.push(a);
  return a;
}

defineView('flut', viewFloorUT);

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset?.act === 'flut-plate-search') { S.flutPlateSearch = el.value; refreshFloorUT(); }
});

onAction({
  'flut-area-add': async () => { addArea(); commit(); refreshFloorUT(); renderNav(); setTimeout(() => $('#flutBody .flut-areas tbody tr:last-child [data-f="plate"]')?.focus(), 30); },
  'flut-area-del': async (el, id) => {
    const a = S.job.floorUT.areas.find((x) => x.id === id); if (!a) return;
    if (!blank(a.tMin) && !(await askConfirm(`Remove area ${a.no || ''} and its readings?`, { ok: 'Remove' }))) return;
    S.job.floorUT.areas = S.job.floorUT.areas.filter((x) => x !== a); commit(); refreshFloorUT();
  },
  'exp-flut': async () => download(fileBase(S.job) + '_floor-ut.csv', floorUTCSV(S.job, S.layout, S.calc), 'text/csv')
});

onChange([
  { order: 131, when: (el) => el.matches('[data-fua]'), run: async (el) => {
    const a = S.job.floorUT.areas.find((x) => x.id === el.dataset.fua); if (!a) return;
    const k = el.dataset.f;
    if (k === 'plate') {
      const p = findPlate(el.value); el.classList.toggle('invalid', !!el.value.trim() && !p);
      if (el.value.trim() && !p) { toast(`No plate “${el.value.trim()}” in the layout.`); return; }
      a.plate = p ? p.key : '';
    } else {
      const v = readInput(el);
      if (!['no', 'type', 'typeText', 'side', 'notes'].includes(k) && v !== null && v < 0) { toast('Values can’t be negative.'); return; }
      if ((k === 'len' || k === 'wid') && v !== null && v <= 0) { toast('The area size must be more than 0.'); return; }
      a[k] = v === '' ? (['type', 'side'].includes(k) ? '' : k === 'no' || k === 'notes' || k === 'typeText' ? '' : null) : v;
    }
    commit(); refreshFloorUT();
  } },
  { order: 132, when: (el) => el.matches('[data-fcz]'), run: async (el) => {
    const C = S.job.floorUT.cz; C.rd = C.rd || {};
    const key = el.dataset.fcz, k = el.dataset.f, v = readInput(el);
    if (!['note', 'sNote'].includes(k) && v !== null && v < 0) { toast('Readings can’t be negative.'); return; }
    const m = (C.rd[key] = C.rd[key] || {});
    if (v === null || v === '') delete m[k]; else m[k] = v;
    if (!Object.keys(m).length) delete C.rd[key];
    commit(); refreshFloorUT();
  } },
  { order: 133, when: (el) => el.matches('[data-fpl]'), run: async (el) => {
    const P = S.job.floorUT.plates; P.rd = P.rd || {};
    const key = el.dataset.fpl, v = readInput(el);
    if (v !== null && v < 0) { toast('Readings can’t be negative.'); return; }
    const m = (P.rd[key] = P.rd[key] || {});
    if (v === null) delete m[el.dataset.pt]; else m[el.dataset.pt] = v;
    if (!PT5_KEYS.some((k) => m[k] != null)) delete P.rd[key];
    commit(); refreshFloorUT();
  } }
]);
