// Small tank checklist (schema 6): one screen in the small report's order — job information, tank static data,
// summary, recommendations (code required or not), NDE scope, intervals, thickness, the 16 external / internal /
// insulation items with their tables, then follow-up and sign-off. Values the full inspection already holds
// (shell courses, roof UT, nozzles, floor indications, settlement survey) are shown beside each item, read-only.
import { S, secData } from '../app/state.js';
import { field, rerenderKeep, valOf, unitFor } from '../app/fields.js';
import { defineView, renderAll, renderView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { commit } from '../app/persist.js';
import { db } from '../db.js';
import { getPath } from '../model.js';
import { SECTIONS, SEC } from '../sections.js';
import { hasFixed } from '../roof.js';
import { hasSettle } from '../settle.js';
import { fmt, fmtRate } from '../units.js';
import { smallCalc, rlText } from '../smallcalc.js';
import { $, toast } from '../ui.js';
import { esc as h } from '../util.js';
import {
  FIT, GROUPS, INTERVAL_BASIS, INTERVALS, ITEMS, RATINGS, SETTLE_BASIS, TEMPLATES, TITLES,
  newDevice, newEdge, parseDiameter, progress, smallMaxD, suggestSmall, isSmall
} from '../small.js';

const P = 'small.';
let R = null; // smallCalc result for the screen being drawn
/** A bare table input bound to a job path. */
function cell(path, kind = 'text', ph = '') {
  const v = getPath(S.job, path);
  const im = ['big', 'small', 't', 'num'].includes(kind) ? 'inputmode="decimal"' : '';
  return `<input data-bind="${h(path)}" data-kind="${kind}" ${im} value="${h(valOf(v, kind))}" placeholder="${h(ph)}" autocomplete="off">`;
}
const unit = (kind) => { const u = unitFor(kind, {}); return u ? ` (${u})` : ''; };
const T = (v) => (v == null || v === '' ? '—' : fmt(v, 't', S.job));
const ST = (t) => `<span class="sm-st ${/Exceeds|Below|Fails/.test(t) ? 'bad' : /NDE|Beyond|No limit|Reported|not recorded/i.test(t) ? 'warn' : /Acceptable|OK/.test(t) ? 'ok' : ''}">${h(t)}</span>`;
const yrs = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 10) / 10} yr`);
const ivCell = (x) => (x.years === null ? `<span class="muted">${h(x.src)}</span>` : `<b>${yrs(x.years)}</b>${x.date ? ` · ${h(x.date)}` : ''}`);
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
  const rows = S.job.small.proj.map((r, i) => { const e = R.proj[i] || {}; return `<tr><th>${h(r.loc)}</th><td>${cell(`${P}proj.${i}.t`, 't')}</td><td>${cell(`${P}proj.${i}.len`, 'small')}</td><td>${e.ok === null || e.ok === undefined ? '<span class="muted">—</span>' : ST(e.ok ? 'OK' : e.tOk === false ? 'Below minimum thickness' : 'Below minimum width')}</td></tr>`; }).join('');
  const m = R.proj[0];
  return `<table class="grid sm-tbl"><thead><tr><th>Location</th><th>Thickness${unit('t')}</th><th>Projection${unit('small')}</th><th>API 653 §4.4.5.7</th></tr></thead><tbody>${rows}</tbody></table>
    ${m ? `<p class="muted small">At least ${fmt(m.tMin, 't', S.job)} thick at the outside weld toe and ${fmt(m.wMin, 'small', S.job)} wide.</p>` : ''}`;
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
    <p class="muted small">Elevations from a level and rod at the shell base (higher = larger); out of plumb measured outward-positive. ${s.basis.settle === '653' ? 'API 653 Annex B uses the full settlement survey (Settlement section).' : ''}</p>
    ${limitsHTML('tilt')}${tiltResultHTML()}`;
}
function edgeTable() {
  const E = R.edge, sm = (v) => (v == null ? '—' : fmt(v, 'small', S.job, false));
  const rows = S.job.small.edge.map((r, i) => { const e = E.rows[i] || {}; return `<tr><td>${cell(`${P}edge.${i}.st`)}</td><td>${cell(`${P}edge.${i}.max`, 'small')}</td><td>${cell(`${P}edge.${i}.bo`, 'small')}</td>
    <td class="n">${sm(e.allow)}</td><td>${e.status ? ST(e.status) : ''}</td><td class="n muted">${sm(e.ref)}</td>
    <td><button class="btn sm icon ghost danger" aria-label="Remove" data-act="sm-del" data-list="edge" data-id="${r.id}">✕</button></td></tr>`; }).join('');
  return `<table class="grid sm-tbl"><thead><tr><th>Station</th><th>Maximum settlement${unit('small')}</th><th>Breakover from shell${unit('small')}</th><th>Limit</th><th>Status</th><th title="API 653 Fig. B.11 at the breakover distance, for reference">Annex B Bew (ref.)</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="acts row-acts"><button class="btn sm" data-act="sm-add" data-list="edge">+ Station</button></div>${limitsHTML('edge')}
    <p class="muted small">${E.src ? 'Limit: ' + h(E.src) + (E.dist !== null && E.basis !== '653' ? ` — applies where the breakover is within ${fmt(E.dist, 'small', S.job)} of the shell` : '') + '. ' : ''}Annex B Bew is shown for reference${S.job.tank.diameter && S.job.tank.diameter < 20 * 304.8 ? ' (the 20 ft curve, used for a tank under 20 ft: engineering review)' : ''}.</p>`;
}
/** Entered limits. Blank fields mean no entered limit: the built-in API 653 check is used where there is one. */
function limitsHTML(which) {
  const b = S.job.small.basis.settle, x = P + 'lim.';
  if (b === '653') return '<p class="muted small">API 653 Annex B limits are built in; no limits to enter.</p>';
  const refs = field('Source of entered limits', x + (which === 'tilt' ? 'refs' : 'edgeRefs'), 'text', { ph: b === '12r1' ? 'API 12R1 clause / table numbers' : 'e.g. company standard, clause', hint: 'Clause or table numbers only — do not copy the standard’s text.' });
  if (which === 'tilt') return `<div class="fgrid">${field('Twist trigger (out of plane)', x + 'twist', 'small', { ph: 'blank: reported only', hint: 'Above this, a full Annex B survey is recommended.' })}${field('Out-of-plumb limit', x + 'plumb', 'small', { ph: b === '12r1' ? 'from API 12R1' : 'blank: API 653 §10.5.2.1' })}${refs}</div>`;
  return `<div class="fgrid">${field('Edge settlement limit', x + 'edge', 'small', { ph: b === '12r1' ? 'from API 12R1' : b === 'small' ? 'e.g. company rule' : 'blank: API 653 Annex B' })}${field('Applies within (from the shell)', x + 'edgeDist', 'small', { ph: 'optional' })}${refs}</div>`;
}
function tiltResultHTML() {
  const T2 = R.tilt, P2 = T2.planar, j = S.job, sm = (v) => fmt(v, 'small', j);
  const rows = [];
  if (T2.basis === '653') {
    const f = T2.annexB?.fit;
    rows.push(['Basis', 'API 653 Annex B — full settlement survey', `${link('settle', 'Settlement survey')}`]);
    if (f) rows.push(['Out of plumb at the top of the shell', sm(f.plumb), `limit ${sm(f.plumbLim)} (API 653 §10.5.2.1)`]);
  }
  if (P2.slope !== undefined) {
    rows.push(['Planar tilt', `${sm(P2.diff)} across the diameter`, P2.lowDeg == null ? 'level' : `low side at ${Math.round(P2.lowDeg)}° from the 0° reference`]);
    rows.push(['Twist (out of plane)', `±${sm(Math.abs(P2.twist))}`, T2.twistTrig !== null && T2.basis !== '653' ? `trigger ${sm(T2.twistTrig)}${T2.twistOk === false ? ' — full Annex B survey recommended' : ''}` : `reported only${P2.smaxRef ? ` · Annex B Sₘₐₓ with 4 stations ${sm(P2.smaxRef)} (reference only)` : ''}`]);
    rows.push(['Loss of freeboard on the low side', sm(P2.freeboard), 'check the overfill set-point']);
    if (P2.drain) rows.push(['Drain', `${h(P2.drain.mark)} at ${P2.drain.angle}°`, `the low side is ${P2.drain.rel} the drain`]);
  }
  if (T2.basis !== '653') {
    if (P2.plumbElev != null) rows.push(['Out of plumb from the elevations', sm(P2.plumbElev), 'tilt × shell height']);
    if (P2.leanMax != null) rows.push(['Out of plumb from the level readings', sm(P2.leanMax), 'largest reading scaled to the shell height']);
    rows.push(['Out of plumb used', T2.plumb === null ? '—' : sm(T2.plumb), T2.plumbLim === null ? 'no limit entered' : `limit ${sm(T2.plumbLim)} (${h(T2.limSrc)})`]);
  }
  return `<div class="sm-res"><div class="sp-head"><h4>Result</h4>${ST(T2.status)}</div><table class="kv small">${rows.map(([a, b, c]) => `<tr><th>${a}</th><td><b>${b}</b></td><td class="muted">${c}</td></tr>`).join('')}</table></div>`;
}
function thickHTML() {
  const j = S.job, T3 = R.thick, t = (v) => (v == null ? '—' : fmt(v, 't', j, false));
  const row = (x, label, link_, extra = '') => (x ? `<tr><th>${label}</th><td class="n">${t(x.tNom)}</td><td class="n">${t(x.tAct)}</td><td class="n">${x.years ?? '—'}</td><td class="n">${fmtRate(x.cr, j, false)}</td><td class="n">${t(x.tMin)}</td><td class="n"><b>${rlText(x.rl, x.cr)}</b></td><td class="small">${extra}${link_}</td></tr>`
    : `<tr><th>${label}</th><td colspan="6" class="muted">No readings</td><td class="small">${link_}</td></tr>`);
  const F = T3.floor, sh = T3.shell;
  const floorNote = F.rlAfter != null && F.rl !== F.rlAfter ? `After the repairs: ${rlText(F.rlAfter, F.cr)} yr. ` : '';
  const crs = T3.courses.length > 1 ? `<details class="small"><summary>All courses</summary><table class="grid sm-tbl"><thead><tr><th>Course</th><th class="n">T-nom</th><th class="n">T-act</th><th class="n">CR</th><th class="n">T-min</th><th class="n">RL</th></tr></thead><tbody>${T3.courses.map((c) => `<tr><td>${c.course}</td><td class="n">${t(c.tNom)}</td><td class="n">${t(c.tAct)}</td><td class="n">${fmtRate(c.cr, j, false)}</td><td class="n">${t(c.tMin)}</td><td class="n">${rlText(c.rl, c.cr)}</td></tr>`).join('')}</tbody></table></details>` : '';
  return `<div class="tblwrap"><table class="grid sm-tbl"><thead><tr><th>Component</th><th class="n">T-nom (${unitFor('t', {})})</th><th class="n">T-act</th><th class="n">Years</th><th class="n">CR (${unitFor('t', {})}/yr)</th><th class="n">T-min</th><th class="n">RL (years)</th><th></th></tr></thead><tbody>
    ${row(F.tAct === null ? null : F, 'Floor', link('api', 'API 653'), floorNote)}
    ${row(sh, sh ? `Shell (course ${sh.course})` : 'Shell', link('shell', 'Shell UT'))}
    ${row(T3.roof, 'Fixed roof', link('roofF', 'Fixed roof UT'), T3.roof?.holes ? `${T3.roof.holes} hole(s). ` : '')}</tbody></table></div>${crs}
    <div class="fgrid">${field('Years in service — shell', P + 'yrs.shell', 'num', { ph: `${R.years ?? '—'} (tank age)` })}${field('Years in service — roof', P + 'yrs.roof', 'num', { ph: `${R.years ?? '—'} (tank age)` })}</div>
    <p class="muted small">CR = (T-nom − T-act) / years; RL = (T-act − T-min) / CR, shown as 30 + when there is no loss or over 30 years. The floor uses the API 653 §4.4.5 evaluation as found: T-act = RT, CR = StPᵣ + UPᵣ, T-min = the governing area's limit, RL = the largest Oᵣ it allows. The tank age is set on the API 653 page${F.notEvaluated ? ' — <b>not set, so the floor is not evaluated</b>' : ''}.</p>`;
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
  R = smallCalc(j, S.layout, S.calc);
  const I = R.intervals;
  const ivRows = INTERVALS.map(([k, l]) => `<tr><th>${l}</th>${['Done', 'Not'].map((w) => { const x = I[k][w.toLowerCase() === 'done' ? 'done' : 'not']; return `<td><div class="sm-iv" title="${h(x.src)}">${ivCell(x)}</div>${cell(`${P}intOv.${k}${w}`, 'text', 'override (date or years)')}</td>`; }).join('')}</tr>`).join('');
  const ivSrc = [...new Set(INTERVALS.flatMap(([k]) => [I[k].done.src, I[k].not.src]))].map((x) => `<li>${h(x)}</li>`).join('');
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
      <table class="grid sm-tbl sm-ivt"><thead><tr><th></th><th>Recommendations completed</th><th>Not completed</th></tr></thead><tbody>${ivRows}</tbody></table>
      <ul class="small muted sm-src">${ivSrc}</ul>
      <p class="muted small">Dates count from the inspection date. Anything typed in an override box (a date or years) replaces the calculated interval in the report.</p></section>

    <section class="card"><h2>8 Thickness and corrosion rates</h2>${thickHTML()}</section>

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
/** Redraw the checklist after a typed value, keeping focus where the user tabbed to. */
export function refreshSmall() { setTimeout(() => { const m = $('#main'); if (m && S.view === 'small') rerenderKeep(m, viewSmall()); }, 0); } // after focus has moved on
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

