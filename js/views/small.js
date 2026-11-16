// Small tank checklist (schema 6): one screen in the small report's order — job information, tank static data,
// summary, recommendations (code required or not), NDE scope, intervals, thickness, the 16 external / internal /
// insulation items with their tables, then follow-up and sign-off. Values the full inspection already holds
// (shell courses, roof UT, nozzles, floor indications, settlement survey) are shown beside each item, read-only.
import { S, secData } from '../app/state.js';
import { field, valOf, unitFor } from '../app/fields.js';
import { defineView, renderAll, renderView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { commit } from '../app/persist.js';
import { db } from '../db.js';
import { getPath } from '../model.js';
import { SECTIONS, SEC } from '../sections.js';
import { hasFixed } from '../roof.js';
import { hasSettle } from '../settle.js';
import { fmt } from '../units.js';
import { $, toast } from '../ui.js';
import { esc as h } from '../util.js';
import {
  FIT, GROUPS, INTERVAL_BASIS, INTERVALS, ITEMS, RATINGS, SETTLE_BASIS, TEMPLATES, TITLES,
  newDevice, newEdge, parseDiameter, progress, smallMaxD, suggestSmall, isSmall
} from '../small.js';

const P = 'small.';
/** A bare table input bound to a job path. */
function cell(path, kind = 'text', ph = '') {
  const v = getPath(S.job, path);
  const im = ['big', 'small', 't', 'num'].includes(kind) ? 'inputmode="decimal"' : '';
  return `<input data-bind="${h(path)}" data-kind="${kind}" ${im} value="${h(valOf(v, kind))}" placeholder="${h(ph)}" autocomplete="off">`;
}
const unit = (kind) => { const u = unitFor(kind, {}); return u ? ` (${u})` : ''; };
const T = (v) => (v == null || v === '' ? '—' : fmt(v, 't', S.job));
const link = (view, text) => `<button class="linkbtn" data-go="${view}">${h(text)}</button>`;

/* ------------------------------------------------------------------ what the job already holds --- */

function existing(it) {
  const j = S.job, out = [];
  const courses = j.shell?.courses || [], nz = j.nozzles || [], R = j.roof || {};
  switch (it.k) {
    case 'x-proj': out.push(`Bottom nominal ${T(j.tank.tBottom)}`); break;
    case 'x-shell': case 'i-shell': out.push(courses.length ? `${courses.length} course${courses.length > 1 ? 's' : ''} · ${link('shell', 'Shell UT')}` : `No shell courses set up · ${link('setup', 'Tank setup')}`); break;
    case 'x-roof': case 'i-roof': out.push(hasFixed(j) ? `${(R.fixed?.pts || []).length} UT points · ${link('roofF', 'Fixed roof UT')}` : `No fixed roof set up · ${link('roofF', 'Fixed roof')}`); break;
    case 'x-noz': case 'i-noz': out.push(`${nz.length} nozzle${nz.length === 1 ? '' : 's'} · ${link('nozzles', 'Nozzle UT')}`); break;
    case 'i-floor': out.push(`${(j.indications || []).length} indication${(j.indications || []).length === 1 ? '' : 's'} · ${link('map', 'Floor map')}`); break;
    case 'x-settle': case 'i-edge': if (hasSettle(j)) out.push(`Settlement survey entered · ${link('settle', 'Settlement survey')}`); break;
  }
  const n = (secData(it.sec).recs || []).length;
  if (n) out.push(`${n} recommendation${n > 1 ? 's' : ''} under ${link('recs:' + it.sec, SEC.get(it.sec).label)}`);
  return out.length ? `<p class="sm-have small muted">${out.join(' · ')}</p>` : '';
}

/* -------------------------------------------------------------------------------- item tables --- */

function projTable() {
  const rows = S.job.small.proj.map((r, i) => `<tr><th>${h(r.loc)}</th><td>${cell(`${P}proj.${i}.t`, 't')}</td><td>${cell(`${P}proj.${i}.len`, 'small')}</td></tr>`).join('');
  return `<table class="grid sm-tbl"><thead><tr><th>Location</th><th>Thickness${unit('t')}</th><th>Projection${unit('small')}</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function oppTable() {
  const rows = S.job.small.opp.map((r, i) => `<tr><td>${cell(`${P}opp.${i}.dev`, 'text', 'e.g. gauge hatch, PVRV')}</td><td>${cell(`${P}opp.${i}.serial`)}</td><td>${cell(`${P}opp.${i}.press`, 'text', 'setting')}</td><td>${cell(`${P}opp.${i}.vac`, 'text', 'setting')}</td><td>${cell(`${P}opp.${i}.svc`, 'text', 'date')}</td>
    <td><button class="btn sm icon ghost danger" aria-label="Remove" data-act="sm-del" data-list="opp" data-id="${r.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No devices listed.</td></tr>';
  return `<table class="grid sm-tbl"><thead><tr><th>Device</th><th>Serial no.</th><th>Pressure</th><th>Vacuum</th><th>Last serviced</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="acts row-acts"><button class="btn sm" data-act="sm-add" data-list="opp">+ Device</button></div>`;
}
function tiltTable() {
  const s = S.job.small;
  const rows = s.tilt.map((r, i) => `<tr><th>${h(r.loc)}</th><td>${cell(`${P}tilt.${i}.elev`, 'small')}</td><td>${cell(`${P}tilt.${i}.lean`, 'small')}</td></tr>`).join('');
  return `<div class="fgrid">${field('Settlement / tilt basis', P + 'basis.settle', 'sel', { options: SETTLE_BASIS })}${field('Level length', P + 'level', 'big', { hint: 'Out-of-plumb readings are taken over this length' })}</div>
    <table class="grid sm-tbl"><thead><tr><th>Station</th><th>Shell-base elevation${unit('small')}</th><th>Out of plumb over the level${unit('small')}</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">Elevations from a level and rod at the shell base; out of plumb measured outward-positive. ${s.basis.settle === '653' ? 'API 653 Annex B uses the full settlement survey (Settlement section).' : ''}</p>
    ${limitsHTML('tilt')}`;
}
function edgeTable() {
  const rows = S.job.small.edge.map((r, i) => `<tr><td>${cell(`${P}edge.${i}.st`)}</td><td>${cell(`${P}edge.${i}.max`, 'small')}</td><td>${cell(`${P}edge.${i}.bo`, 'small')}</td>
    <td><button class="btn sm icon ghost danger" aria-label="Remove" data-act="sm-del" data-list="edge" data-id="${r.id}">✕</button></td></tr>`).join('');
  return `<table class="grid sm-tbl"><thead><tr><th>Station</th><th>Maximum settlement${unit('small')}</th><th>Breakover from shell${unit('small')}</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="acts row-acts"><button class="btn sm" data-act="sm-add" data-list="edge">+ Station</button></div>${limitsHTML('edge')}`;
}
/** Entered limits. Blank fields mean no entered limit: the built-in API 653 check is used where there is one. */
function limitsHTML(which) {
  const b = S.job.small.basis.settle, x = P + 'lim.';
  const refs = field('Source of entered limits', x + (which === 'tilt' ? 'refs' : 'edgeRefs'), 'text', { ph: b === '12r1' ? 'API 12R1 clause / table numbers' : 'e.g. company standard, clause', hint: 'Clause or table numbers only — do not copy the standard’s text.' });
  if (which === 'tilt') return `<div class="fgrid">${field('Twist trigger (out of plane)', x + 'twist', 'small', { ph: 'blank: reported only', hint: 'Above this, a full Annex B survey is recommended.' })}${field('Out-of-plumb limit', x + 'plumb', 'small', { ph: b === '12r1' ? 'from API 12R1' : 'blank: API 653 §10.5.2.1' })}${refs}</div>`;
  return `<div class="fgrid">${field('Edge settlement limit', x + 'edge', 'small', { ph: b === '12r1' ? 'from API 12R1' : b === 'small' ? 'e.g. company rule' : 'blank: API 653 Annex B' })}${field('Applies within (from the shell)', x + 'edgeDist', 'small', { ph: 'optional' })}${refs}</div>`;
}
const TABLE = { proj: projTable, opp: oppTable, tilt: tiltTable, edge: edgeTable };

/* -------------------------------------------------------------------------------------- items --- */

function itemHTML(it, n) {
  const v = S.job.small.items[it.k] || {}, r = v.rating || '';
  const seg = RATINGS.map(([k, l]) => `<button class="btn sm${r === k ? ' on r-' + k : ''}" data-act="sm-rate" data-k="${it.k}" data-v="${k}" aria-pressed="${r === k}">${l}</button>`).join('');
  return `<section class="card sm-item${r ? ' rated r-' + r : ''}" id="sm-${it.k}"><div class="sp-head"><h3>${n} ${h(it.label)}</h3><div class="seg">${seg}</div></div>
    ${existing(it)}
    ${field('Comments', `${P}items.${it.k}.text`, 'area', { rows: 2, value: v.text || '', ph: 'Condition, findings, location' })}
    ${it.table ? `<div class="sm-table">${TABLE[it.table]()}</div>` : ''}</section>`;
}

/* --------------------------------------------------------------------------------------- page --- */

function viewSmall() {
  const j = S.job, s = j.small;
  if (!isSmall(j)) return `<div class="page"><h1>Small tank checklist</h1><p class="muted">This job uses the full report. Choose the small tank report under ${link('setup', 'Tank setup → Report')} to use this checklist.</p></div>`;
  const allRecs = SECTIONS.flatMap((x) => (secData(x.key).recs || []).map((r) => ({ r, sec: x })));
  const recRows = allRecs.map(({ r, sec }) => `<tr><td><label class="chk"><input type="checkbox" data-sx="recs" data-sec="${sec.key}" data-iid="${r.id}" data-f="code" ${r.code ? 'checked' : ''}><span>Code required</span></label></td>
    <td class="small">${h(r.finding || '—')}${r.action ? `<br><i class="muted">${h(r.action)}</i>` : ''}</td><td class="small">${link('recs:' + sec.key, sec.label)}</td><td class="small">${h(r.ref || '')}</td></tr>`).join('')
    || `<tr><td colspan="4" class="empty">No recommendations yet. Add them under each section's Recommendations page.</td></tr>`;
  const nCode = allRecs.filter((x) => x.r.code).length;
  const nde = SECTIONS.flatMap((x) => (secData(x.key).nde || []).map((m) => `<tr><td>${h(x.label)}</td><td>${h(m.method)}</td><td class="small">${h(m.extent || '')}</td><td class="small">${h(m.result || '')}</td></tr>`)).join('')
    || '<tr><td colspan="4" class="empty">No NDE methods entered yet (each section’s NDE scope).</td></tr>';
  const ivRows = INTERVALS.map(([k, l]) => `<tr><th>${l}</th><td>${cell(`${P}intOv.${k}Done`, 'text', 'calculated')}</td><td>${cell(`${P}intOv.${k}Not`, 'text', 'calculated')}</td></tr>`).join('');
  const r12 = s.basis.intervals === '12r1' ? `<div class="fgrid">${field('UT thickness: maximum (years)', P + 'r12int.ut', 'num')}${field('In service: maximum (years)', P + 'r12int.ext', 'num')}${field('Out of service: maximum (years)', P + 'r12int.int', 'num')}${field('Source', P + 'r12int.refs', 'text', { ph: 'API 12R1 clause numbers', hint: 'Clause numbers only — do not copy the standard’s text.' })}</div>` : '';
  const courses = j.shell?.courses || [], shellNom = courses.length ? Math.min(...courses.map((c) => +c.tNom).filter((x) => x > 0)) : null;
  const groups = GROUPS.map(([g, label], gi) => {
    const its = ITEMS.filter((i) => i.grp === g); let m = 0;
    return `<h2 class="sm-grp">${9 + gi} ${label}</h2>${its.map((it) => itemHTML(it, g === 'insul' ? '' : `${9 + gi}.${++m}`)).join('')}`;
  }).join('');
  return `<div class="page sm-page"><div class="page-head"><div><h1>Small tank checklist</h1><p class="muted">Everything the small tank report needs, in the report's order. ${progress(j)} of ${ITEMS.length} items rated. Values already entered elsewhere in the job are shown beside each item.</p></div>
    <div class="acts"><button class="btn primary" data-go="report">Report</button></div></div>

    <section class="card"><h2>1 Job information</h2><div class="fgrid">
      ${field('Report title', P + 'title', 'sel', { options: TITLES, cls: 'span2' })}
      ${field('Client', 'info.client')}${field('Inspection date', 'info.inspDate', 'date')}
      ${field('Job number', 'info.jobNo')}${field('P.O. number', 'info.poNo')}
      ${field('Work order', 'info.workOrder')}${field('Report number', 'info.reportNo')}
      ${field('Facility / LSD', 'info.site')}${field('Area', 'info.location')}
    </div></section>

    <section class="card"><h2>2 Tank static data</h2><div class="fgrid">
      ${field('Tank number', 'info.tankId')}${field('Serial number', 'tank.serialNo')}
      ${field('Manufacturer', 'tank.maker')}${field('Year built', 'tank.yearBuilt')}
      ${field('Diameter', 'tank.diameter', 'big')}${field('Height', 'tank.height', 'big')}
      ${field('Capacity', 'tank.capacity', 'text', { ph: 'e.g. 400 bbl' })}<label class="fld"><span class="lbl">Code of construction</span><span class="ctl ro">${h([j.tank.code, j.tank.edition].filter(Boolean).join(', ') || '—')}</span><small>${link('setup', 'Tank setup')}</small></label>
      ${field('Floor material', 'tank.matFloor')}<label class="fld"><span class="lbl">Floor nominal</span><span class="ctl ro">${T(j.tank.tBottom)}</span></label>
      ${field('Shell material', 'tank.matShell')}<label class="fld"><span class="lbl">Shell nominal</span><span class="ctl ro">${shellNom ? T(shellNom) + (courses.length > 1 ? ' (thinnest course)' : '') : '—'}</span></label>
      ${field('Roof material', 'tank.matRoof')}<label class="fld"><span class="lbl">Roof nominal</span><span class="ctl ro">${T(j.roof?.fixed?.tNom)}</span></label>
    </div></section>

    <section class="card"><h2>3 Inspection summary</h2>${field('', 'summary.narrative', 'area', { rows: 5, ph: 'Main findings and conclusions' })}</section>

    <section class="card"><div class="sp-head"><h2>4–5 Recommendations</h2><span class="muted small">${nCode} code required · ${allRecs.length - nCode} non-code</span></div>
      <p class="muted small">Tick <b>Code required</b> for recommendations the code requires; the rest print under non-code recommendations.</p>
      <div class="tblwrap"><table class="grid"><thead><tr><th>Code</th><th>Recommendation</th><th>Section</th><th>Reference</th></tr></thead><tbody>${recRows}</tbody></table></div></section>

    <section class="card"><h2>6 NDE scope</h2><div class="tblwrap"><table class="grid"><thead><tr><th>Section</th><th>Method</th><th>Extent</th><th>Result</th></tr></thead><tbody>${nde}</tbody></table></div></section>

    <section class="card"><h2>7 Inspection intervals</h2><div class="fgrid">${field('Interval rules', P + 'basis.intervals', 'sel', { options: INTERVAL_BASIS })}</div>${r12}
      <table class="grid sm-tbl"><thead><tr><th></th><th>Recommendations completed</th><th>Not completed</th></tr></thead><tbody>${ivRows}</tbody></table>
      <p class="muted small">Leave blank to use the calculated interval; anything typed here (a date or years) replaces it in the report.</p></section>

    <section class="card"><h2>8 Thickness and corrosion rates</h2><div class="tblwrap"><table class="grid sm-tbl"><thead><tr><th>Component</th><th>T-nominal</th><th>Readings</th></tr></thead><tbody>
      <tr><th>Floor</th><td>${T(j.tank.tBottom)}</td><td>${link('map', 'Floor map')}</td></tr>
      <tr><th>Shell</th><td>${shellNom ? T(shellNom) : '—'}</td><td>${link('shell', 'Shell UT')}</td></tr>
      <tr><th>Roof</th><td>${T(j.roof?.fixed?.tNom)}</td><td>${link('roofF', 'Fixed roof UT')}</td></tr></tbody></table></div>
      <p class="muted small">T-actual, years in service, corrosion rate, T-min and remaining life are worked out from the UT readings.</p></section>

    ${groups}

    <section class="card"><h2>12 Follow-up and sign-off</h2><div class="fgrid">
      ${field('Preparatory work for the next inspection', P + 'followup', 'area', { rows: 3, cls: 'span2' })}
      ${field('Equipment suitable for continued service?', P + 'fit', 'sel', { options: FIT })}${field('Conditions / note', P + 'fitNote')}
    </div><p class="muted small">Inspectors and technicians, with their certifications, come from the ${link('setup', 'Personnel list')}.</p></section>
  </div>`;
}
defineView('small', viewSmall);

/* ------------------------------------------------------------------------ setup: template card --- */

/** The Report card on Tank setup: template, title, and the suggestion for small tanks. */
export function templateCardHTML() {
  const j = S.job, sug = suggestSmall(j, S.company), mm = smallMaxD(S.company), lim = j.units === 'metric' ? `${+(mm / 1000).toFixed(2)} m` : `${+(mm / 304.8).toFixed(1)} ft`;
  return `<h2>Report</h2>${sug ? `<div class="sm-suggest"><span>This tank is under ${h(lim)} across — the <b>small tank report</b> is suggested.</span><span class="acts"><button class="btn sm primary" data-act="tpl-set" data-v="small">Use the small tank report</button><button class="btn sm" data-act="tpl-set" data-v="full">Keep the full report</button></span></div>` : ''}
    <div class="fgrid">${field('Report template', 'template', 'sel', { options: [['', 'Not chosen — full report'], ...TEMPLATES] })}${isSmall(j) ? field('Report title', P + 'title', 'sel', { options: TITLES }) : '<div></div>'}</div>
    ${isSmall(j) ? `<p class="muted small">Fill in the ${link('small', 'Small tank checklist')}.</p>` : ''}`;
}
export function refreshTemplateCard() { const c = $('#tplCard'); if (c) c.innerHTML = templateCardHTML(); }

/* ------------------------------------------------------------------------------------ actions --- */

const LISTS = { opp: () => newDevice(), edge: () => newEdge(S.job.small.edge.length + 1) };
onAction({
  'tpl-set': (el) => { S.job.template = el.dataset.v; commit(); renderAll(); if (el.dataset.v === 'small') toast('Small tank report chosen — the checklist is in the menu.'); },
  'sm-rate': (el) => {
    const k = el.dataset.k, items = S.job.small.items, cur = items[k] || { rating: '', text: '' };
    items[k] = { ...cur, rating: cur.rating === el.dataset.v ? '' : el.dataset.v };
    commit(); renderView();
  },
  'sm-add': (el) => { const l = el.dataset.list; S.job.small[l].push(LISTS[l]()); commit(); renderView(); },
  'sm-del': (el) => { const l = el.dataset.list; S.job.small[l] = S.job.small[l].filter((x) => x.id !== el.dataset.id); commit(); renderView(); }
});

/* the threshold for suggesting the small template (Settings → This device) */
onChange([
  { order: 155, when: (el) => el.matches('[data-smallmax]'), run: async (el) => {
    const v = el.value.trim() === '' ? null : parseDiameter(el.value);
    if (el.value.trim() !== '' && v == null) { toast('Type a diameter, e.g. 40 ft or 12 m.'); el.value = smallMaxText(); return; }
    if (v == null) delete S.company.smallMaxD; else S.company.smallMaxD = v;
    await db.setMeta('company', S.company); el.value = smallMaxText();
  } }
]);
export const smallMaxText = () => { const mm = smallMaxD(S.company); return `${Math.round(mm / 304.8 * 100) / 100} ft`; };

