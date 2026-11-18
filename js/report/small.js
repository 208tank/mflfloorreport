// Small tank report (S3, laid out again in v3.34): the short report for small-diameter tanks, laid out like the small
// tank Word template. Page 1 is the inspection summary — a job / tank static data grid, then one summary table: summary,
// code required and non-code recommendations, NDE scope and results, inspection intervals, thickness and corrosion
// rates. Then the external, internal and insulation checklists as Item | Condition | Comments tables with their
// supporting tables, and follow-up and sign-off; appendices as needed (S4). Built in the full report's frame (cover,
// document control with the contents on one page, header and footer). Values come from js/smallcalc.js.
// Clause numbers only: no standards text is reproduced.
import { assembleReport, layoutOf, numbering, sheetHTML, legendList, swatch } from './frame.js';
import { block, step, calcFloor } from './calcapp.js';
import { smallCalc, rlText } from '../smallcalc.js';
import { courseSummary, coursesWithElev, utLocations, getReading, readingElevations } from '../shell.js';
import { fixedSVG, hasFixed, pointStatus } from '../roof.js';
import { nozzleUT, nozzleWall, UT_CLOCK } from '../calc.js';
import { personName } from '../personnel.js';
import { ITEMS, RATING_LABEL, SETTLE_BASIS, FIT, titleOf } from '../small.js';
import { SECTIONS, PRIORITY_LABEL } from '../sections.js';
import { ROLE_LABEL, certState } from '../personnel.js';
import { fmt, fmtRate, unitLabel } from '../units.js';
import { esc as h } from '../util.js';
import { CORRECTIONS } from '../calc.js';
import { patchList } from '../patches.js';
import { floorParts } from './floor.js';
import { hasFloorUT } from '../floorut.js';

/** Chapters of the small report, in the template's order. */
/** Appendices of the small report (each printed only when it has content). */
export const SMALL_APPENDICES = [['photos', 'Photographs'], ['ut', 'NDE — UT thickness'], ['mfl', 'NDE — MFL floor inspection'], ['calc', 'Calculations — thickness, intervals and settlement'], ['calcfloor', 'Calculation — floor minimum remaining thickness (API 653 §4.4.5)']];

/** Shell and nozzle UT plan: the shell circle viewed from above, the UT stations with their minimum reading, and the
 *  nozzles at their angle (clockwise from 0° at the top). Scaled to a 200-unit box. */
export function shellPlanSVG(job, { stations = [], mins = new Map(), fmtT = (v) => String(v), zero = 'N' } = {}) {
  const R = 70, c = 100, P = (r, a) => [c + r * Math.sin((a * Math.PI) / 180), c - r * Math.cos((a * Math.PI) / 180)];
  const e = (x) => String(x ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]);
  const o = [`<circle cx="${c}" cy="${c}" r="${R}" fill="#fff" stroke="#1d232b" stroke-width="1.4"/>`, `<path d="M${c - 4} ${c}H${c + 4}M${c} ${c - 4}V${c + 4}" stroke="#66707c" stroke-width=".6"/>`];
  for (const [a, l] of [[0, zero || '0°'], [90, '90°'], [180, '180°'], [270, '270°']]) { const [x, y] = P(R + 27, a); o.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="6" text-anchor="middle" dominant-baseline="central" fill="#1d232b" font-weight="700">${e(l)}</text>`); }
  for (const st of stations) {
    const [x1, y1] = P(R - 6, st.angle), [x2, y2] = P(R + 6, st.angle), [lx, ly] = P(R - 15, st.angle), m = mins.get(st.key);
    o.push(`<g class="sp-st"><line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#0f766e" stroke-width="1.2"/><circle cx="${P(R, st.angle)[0].toFixed(1)}" cy="${P(R, st.angle)[1].toFixed(1)}" r="2.2" fill="#0f766e"/>` +
      `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="4.6" text-anchor="middle" dominant-baseline="central" fill="#0f766e" font-weight="700">${e(st.label)}</text>` +
      (m != null ? `<text x="${lx.toFixed(1)}" y="${(ly + 5.5).toFixed(1)}" font-size="3.8" text-anchor="middle" fill="#3a434e">${e(fmtT(m))}</text>` : '') + '</g>');
  }
  for (const n of job.nozzles || []) {
    const a = +n.angle; if (!Number.isFinite(a)) continue;
    const [x, y] = P(R, a), [tx, ty] = P(R + 12, a);
    o.push(`<g class="sp-nz"><line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#1d232b" stroke-width=".8"/>` +
      `<polygon points="${[0, 60, 120, 180, 240, 300].map((d) => `${(tx + 4.6 * Math.cos((d * Math.PI) / 180)).toFixed(1)},${(ty + 4.6 * Math.sin((d * Math.PI) / 180)).toFixed(1)}`).join(' ')}" fill="#fff" stroke="#1d232b" stroke-width=".7"/>` +
      `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="3.6" text-anchor="middle" dominant-baseline="central" fill="#1d232b" font-weight="700">${e(n.mark)}</text></g>`);
  }
  return `<svg class="sm-plan" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${o.join('')}</svg>`;
}

export const SMALL_CHAPTERS = [
  ['summary', 'Inspection summary'], ['ext', 'External inspection'], ['int', 'Internal inspection'], ['insul', 'Insulation'], ['follow', 'Follow-up and sign-off']
];

const rating = (r) => (r ? `<span class="sm-rate r-${r}">${h(RATING_LABEL[r]).toUpperCase()}</span>` : '<span class="sm-rate">NOT RATED</span>');
const yrs = (v) => (v == null ? '—' : String(Math.round(v * 10) / 10));

export const SMALL_CSS = `
.rp2 .sm-rate{display:inline-block;min-width:4.2em;text-align:center;font-weight:700;font-size:8.5px;letter-spacing:.04em;padding:0 5px;border:1px solid #8a939e;border-radius:3px;color:#3a434e}
.rp2 .sm-rate.r-good{border-color:#15803d;color:#15803d}.rp2 .sm-rate.r-fair{border-color:#a16207;color:#a16207}.rp2 .sm-rate.r-poor{border-color:#b91c1c;color:#fff;background:#b91c1c}.rp2 .sm-rate.r-na{color:#66707c}
.rp2 .sm-ok{color:#15803d}.rp2 .sm-bad{color:#b91c1c;font-weight:700}.rp2 .sm-warn{color:#a16207}
.rp2.rp-small h2.rp-ch{font-size:14px;border-bottom:1.5px solid #1d232b;margin:20px 0 8px}
.rp2.rp-small h3.rp-s{font-size:11px;border-bottom:0;margin:12px 0 4px;color:#1d232b}
.rp2.rp-small .rp-chap{break-before:auto}
.rp2 table.sm-head{width:100%;border-collapse:collapse;font-size:10px;margin:0 0 10px}
.rp2 table.sm-head td,.rp2 table.sm-head th{border:1px solid #b9c0c8;padding:3px 6px;text-align:left;vertical-align:top}
.rp2 table.sm-head th{background:#eef1f4;font-weight:600;color:#3a434e;width:14%;white-space:nowrap}
.rp2 table.sm-head tr.cap th{background:#1d232b;color:#fff;text-transform:uppercase;letter-spacing:.06em;font-size:9px}
.rp2 table.sm-sum{width:100%;border-collapse:collapse;font-size:10px}
.rp2 table.sm-sum>tbody>tr>th{width:22%;background:#eef1f4;text-align:left;vertical-align:top;padding:5px 6px;border:1px solid #b9c0c8;font-weight:600}
.rp2 table.sm-sum>tbody>tr>td{border:1px solid #b9c0c8;padding:5px 6px;vertical-align:top}
.rp2 table.sm-sum p{margin:0 0 4px}.rp2 table.sm-sum ol,.rp2 table.sm-sum ul{margin:0;padding-left:16px}.rp2 table.sm-sum li{margin:0 0 2px}
.rp2 table.sm-in{width:100%;border-collapse:collapse;font-size:9.5px}.rp2 table.sm-in th,.rp2 table.sm-in td{border-bottom:1px solid #dfe3e8;padding:2px 4px;text-align:left}.rp2 table.sm-in th{color:#3a434e;font-weight:600}.rp2 table.sm-in .n{text-align:right}
.rp2 table.sm-chk{width:100%;border-collapse:collapse;font-size:10px}.rp2 table.sm-chk th,.rp2 table.sm-chk td{border:1px solid #b9c0c8;padding:4px 6px;text-align:left;vertical-align:top}
.rp2 table.sm-chk thead th{background:#eef1f4;font-size:9px;text-transform:uppercase;letter-spacing:.04em}.rp2 table.sm-chk td.c{width:5.5em;text-align:center}.rp2 table.sm-chk td.i{width:30%;font-weight:600}
.rp2 table.sm-chk td.x{color:#8a939e}
.rp2 .sm-sig td{height:26px}
.rp2.rp-small .rp-toc td:first-child{white-space:nowrap;padding-right:10px}
.rp2 p.sm-n{font-size:8.5px;color:#5b6470;margin:3px 0 8px}
.rp2 .dwg-kv.sm-ind td,.rp2 .dwg-kv.sm-ind th,.rp2 .dwg-kv.sm-nzk td,.rp2 .dwg-kv.sm-nzk th{padding:0 3px;font-size:7px;white-space:nowrap}.rp2 svg.sm-plan{width:100%;height:100%}
@media print{.report.rp-small .rp-chap{break-before:auto}.report.rp-small .rp-front + .rp-chap,.report.rp-small #ch-ext{break-before:page}.report.rp-small .rp-chap table{break-inside:avoid}.report.rp-small .rp-front + .rp-front{break-before:auto;margin-top:26px}.report.rp-small table.sm-sum>tbody>tr,.report.rp-small table.sm-chk tr,.report.rp-small table.sm-head{break-inside:avoid}}
`;
const stCls = (t) => (/Exceeds|Below|Fails|Unfit/.test(t || '') ? 'sm-bad' : /NDE|Beyond|No limit|Reported|not recorded|Incomplete|No Annex/i.test(t || '') ? 'sm-warn' : /Acceptable|OK|Meets/.test(t || '') ? 'sm-ok' : '');
const st = (t) => `<span class="${stCls(t)}">${h(t || '—')}</span>`;

/**
 * The small report. Same arguments as buildReport; `opts` carries the front-matter switches, drawing options and the
 * document-control history.
 */
export function buildSmallReport(job, layout, calc, company, photos, opts = {}, X = {}) {
  const I = job.info || {}, T = job.tank || {}, S = job.small, R = smallCalc(job, layout, calc), N = numbering();
  const t = (v) => fmt(v, 't', job, false), sm = (v) => (v == null ? '—' : fmt(v, 'small', job, false)), big = (v) => (v == null ? '—' : fmt(v, 'big', job));
  const U = { t: unitLabel('small', job), big: unitLabel('big', job), rate: unitLabel('rate', job) };
  const courses = job.shell?.courses || [], shellNom = courses.map((c) => +c.tNom).filter((x) => x > 0);
  const recs = SECTIONS.flatMap((x) => (job.secs?.[x.key]?.recs || []).map((r) => ({ r, sec: x })));

  const recList = (list) => (list.length ? `<ol>${list.map(({ r, sec }) => `<li>${h(r.finding)}${r.action ? ` — <i>${h(r.action)}</i>` : ''} <small>(${h(sec.label)}${r.priority ? ', ' + h(PRIORITY_LABEL[r.priority] || r.priority) : ''}${r.due ? ', due ' + h(r.due) : ''}${r.def && r.no ? ', ' + h(r.no) : ''})</small></li>`).join('')}</ol>` : 'None.');
  const para = (txt, empty) => { const x = String(txt || '').trim(); return x ? x.split(/\n{2,}/).map((p) => `<p>${h(p).replace(/\n/g, '<br>')}</p>`).join('') : `<p>${empty}</p>`; };
  const fit = (FIT.find(([k]) => k === S.fit) || [])[1];

  /* ---- 1 Inspection summary: header grid and the one-page summary table (as page 1 of the template) ---- */
  const summaryCh = () => {
    const c4 = (pairs) => `<tr>${pairs.map(([k, v]) => `<th>${k}</th><td>${v === '' || v == null ? '—' : v}</td>`).join('')}</tr>`;
    const head = `<table class="sm-head"><tbody>
      <tr class="cap"><th colspan="4">Job information</th></tr>
      ${c4([['Client', h(I.client)], ['Inspection date', h(I.inspDate)]])}${c4([['Facility / LSD', h(I.site)], ['Report number', h(I.reportNo)]])}
      ${c4([['Area', h(I.location)], ['Job number', h(I.jobNo)]])}${c4([['Product / service', h([I.product, I.service].filter(Boolean).join(' · '))], ['P.O. / W.O.', h([I.poNo, I.workOrder].filter(Boolean).join(' / '))]])}
      <tr class="cap"><th colspan="4">Tank static data</th></tr>
      ${c4([['Tank number', h(I.tankId)], ['Serial number', h(T.serialNo)]])}${c4([['Manufacturer', h(T.maker)], ['Year built', h(T.yearBuilt)]])}
      ${c4([['Code of construction', h([T.code, T.edition].filter(Boolean).join(', '))], ['Capacity', h(T.capacity)]])}${c4([['Diameter', big(T.diameter)], ['Height', big(T.height)]])}
      ${c4([['Floor', `${h(T.matFloor || '—')}, ${t(T.tBottom)} ${U.t}`], ['Shell', `${h(T.matShell || '—')}, ${shellNom.length ? shellNom.map((x) => t(x)).join(' / ') : '—'} ${U.t}`]])}
      ${c4([['Roof', `${h(T.matRoof || '—')}, ${t(job.roof?.fixed?.tNom)} ${U.t}`], ['Bottom', h(T.bottomType)]])}</tbody></table>`;
    // NDE completed
    const nde = SECTIONS.flatMap((x) => (job.secs?.[x.key]?.nde || []).map((m) => `<li><b>${h(x.label)}:</b> ${h(m.method)}${m.extent ? ', ' + h(m.extent) : ''}${m.result ? ' — ' + h(m.result) : ''}</li>`));
    const inds = job.indications || [], proven = inds.filter((i) => ['ps', 'ss', 'both'].includes(i.result)).length;
    const res = [];
    if (inds.length) res.push(`MFL: ${inds.length} indication${inds.length > 1 ? 's' : ''}, ${proven} proven up as corrosion; floor minimum remaining ${t(R.thick.floor.tAct)} ${U.t}.`);
    if (R.thick.courses.length) res.push(`Shell UT minimum ${t(Math.min(...R.thick.courses.map((c) => c.tAct)))} ${U.t}.`);
    if (R.thick.roof) res.push(`Roof UT minimum ${t(R.thick.roof.tAct)} ${U.t}${R.thick.roof.holes ? `, ${R.thick.roof.holes} hole(s)` : ''}.`);
    // intervals
    const Iv = R.intervals, cell = (x) => (x.override ? `<b>${h(x.override)}</b> <small>(entered)</small>` : x.years == null ? `<small>${h(x.src)}</small>` : `<b>${h(x.date || '—')}</b> (${yrs(x.years)} yr)`);
    const ivT = `<table class="sm-in"><thead><tr><th></th><th>Recommendations completed</th><th>Not completed</th></tr></thead><tbody>${[['ut', 'UT thickness'], ['ext', 'In service (external)'], ['int', 'Out of service (internal)']].map(([k, l]) => `<tr><td>${l}</td><td>${cell(Iv[k].done)}</td><td>${cell(Iv[k].not)}</td></tr>`).join('')}</tbody></table><p class="sm-n">${Iv.basis === '12r1' ? 'API 12R1 maximum intervals as entered, not past the remaining life' : 'API 653 §6.3.3.2 (UT), §6.3.2.1 (external), §6.4.2 (internal)'}; from the inspection date. Working in the calculations appendix.</p>`;
    // thickness
    const X = R.thick, F = X.floor;
    const tr = (x, l) => (x ? `<tr><td>${l}</td><td class="n">${t(x.tNom)}</td><td class="n">${t(x.tAct)}</td><td class="n">${x.years ?? '—'}</td><td class="n">${fmtRate(x.cr, job, false)}</td><td class="n">${t(x.tMin)}</td><td class="n"><b>${rlText(x.rl, x.cr)}</b></td></tr>` : `<tr><td>${l}</td><td colspan="6">No readings</td></tr>`);
    const thT = `<table class="sm-in"><thead><tr><th></th><th class="n">T-nom</th><th class="n">T-act</th><th class="n">Years</th><th class="n">CR (${U.rate})</th><th class="n">T-min</th><th class="n">RL (yr)</th></tr></thead><tbody>${tr(F.tAct == null ? null : F, 'Floor (as found)')}${tr(X.shell, X.shell ? `Shell (course ${X.shell.course})` : 'Shell')}${tr(X.roof, 'Roof')}</tbody></table><p class="sm-n">Thickness in ${U.t}. 30 + = no measurable loss or over 30 years.${F.rlAfter != null && F.rlAfter !== F.rl ? ` Floor after the recommended repairs: RL ${rlText(F.rlAfter, F.cr)} years.` : ''} Working in the calculations appendix.</p>`;
    const code = recs.filter((x) => x.r.code), non = recs.filter((x) => !x.r.code);
    return `<section>${head}<table class="sm-sum"><tbody>
      <tr><th>Inspection summary</th><td>${para(job.summary?.narrative, 'No summary entered.')}${fit ? `<p><b>${h(fit)}${S.fitNote ? ' — ' + h(S.fitNote) : ''}.</b></p>` : ''}</td></tr>
      <tr><th>Code required recommendations</th><td>${recList(code)}</td></tr>
      <tr><th>Non-code recommendations</th><td>${recList(non)}</td></tr>
      <tr><th>NDE scope and results</th><td>${nde.length ? `<ul>${nde.join('')}</ul>` : 'No NDE methods recorded.'}${res.length ? `<p style="margin-top:4px">${res.join(' ')}</p>` : ''}</td></tr>
      <tr><th>Inspection intervals</th><td>${ivT}</td></tr>
      <tr><th>Thickness and corrosion rates</th><td>${thT}</td></tr></tbody></table></section>`;
  };

  /* ---- supporting tables ---- */
  const projT = () => {
    const P = R.proj; if (!P.some((p) => p.t != null || p.w != null)) return '';
    const m = P[0];
    return `${N.sub('Floor projections and shell-to-floor weld')}<table class="grid small"><thead><tr><th>Location</th><th class="n">Thickness (${U.t})</th><th class="n">Projection (${U.t})</th><th>API 653 §4.4.5.7</th></tr></thead><tbody>${P.map((p) => `<tr><td>${h(p.loc)}</td><td class="n">${t(p.t)}</td><td class="n">${sm(p.w)}</td><td>${p.ok == null ? '—' : st(p.ok ? 'Meets' : p.tOk === false ? 'Below minimum thickness' : 'Below minimum width')}</td></tr>`).join('')}</tbody></table>
      ${m ? `<p class="sm-n">Minimum ${t(m.tMin)} ${U.t} thick and ${sm(m.wMin)} ${U.t} wide.</p>` : ''}`;
  };
  const oppT = () => (S.opp.length ? `${N.sub('Over-pressure and vacuum protection')}<table class="grid small"><thead><tr><th>Device</th><th>Serial no.</th><th>Pressure</th><th>Vacuum</th><th>Last serviced</th></tr></thead><tbody>${S.opp.map((d) => `<tr><td>${h(d.dev)}</td><td>${h(d.serial)}</td><td>${h(d.press)}</td><td>${h(d.vac)}</td><td>${h(d.svc)}</td></tr>`).join('')}</tbody></table>` : '');
  const tiltT = () => {
    const X = R.tilt, P = X.planar, b = (SETTLE_BASIS.find(([k]) => k === X.basis) || [])[1];
    const haveSt = S.tilt.some((x) => x.elev != null || x.lean != null);
    if (!haveSt && X.basis !== '653') return '';
    const res = [];
    if (X.basis === '653') { const f = X.annexB?.fit; if (f) res.push(['Out of plumb at the top of the shell', `${sm(f.plumb)} ${U.t}`, `limit ${sm(f.plumbLim)} ${U.t} (API 653 §10.5.2.1)`]); }
    if (P.slope !== undefined) {
      res.push(['Planar tilt', `${sm(P.diff)} ${U.t} across the diameter`, P.lowDeg == null ? 'level' : `low side at ${Math.round(P.lowDeg)}° from 0° (${h(I.zeroRef || 'N')})`]);
      res.push(['Twist (out of plane)', `±${sm(Math.abs(P.twist))} ${U.t}`, X.twistTrig != null && X.basis !== '653' ? `trigger ${sm(X.twistTrig)} ${U.t}${X.twistOk === false ? ' — <b>full API 653 Annex B survey recommended</b>' : ''}` : 'reported only']);
      res.push(['Loss of freeboard, low side', `${sm(P.freeboard)} ${U.t}`, P.drain ? `the low side is ${P.drain.rel} drain ${h(P.drain.mark)}` : '']);
    }
    if (X.basis !== '653') res.push(['Out of plumb', X.plumb == null ? '—' : `<b>${sm(X.plumb)} ${U.t}</b>`, X.plumbLim == null ? 'no limit entered' : `limit ${sm(X.plumbLim)} ${U.t} (${h(X.limSrc)})`]);
    const stn = haveSt ? `<table class="grid small"><thead><tr><th>Station</th><th class="n">Shell-base elevation (${U.t})</th><th class="n">Out of plumb over ${big(S.level)} (${U.t})</th></tr></thead><tbody>${S.tilt.map((x) => `<tr><td>${h(x.loc)}</td><td class="n">${sm(x.elev)}</td><td class="n">${sm(x.lean)}</td></tr>`).join('')}</tbody></table>` : '';
    return `${N.sub('Settlement and tilt')}<p>Basis: ${h(b)}${X.refs ? ` (${h(X.refs)})` : ''}. Result: <b>${st(X.status)}</b>.</p>${stn}
      <table class="grid small"><tbody>${res.map(([a, v, c]) => `<tr><th>${a}</th><td>${v}</td><td>${c}</td></tr>`).join('')}</tbody></table>
      ${X.basis === 'small' ? '<p class="sm-n">Small-tank planar method (tank treated as rigid; not API 653 Annex B). Method in the calculations appendix.</p>' : ''}`;
  };
  const edgeT = () => {
    const E = R.edge;
    if (!S.edge.some((x) => x.max != null)) return '';
    return `${N.sub('Edge settlement')}<table class="grid small"><thead><tr><th>Station</th><th class="n">Max. settlement (${U.t})</th><th class="n">Breakover from shell (${U.t})</th><th class="n">Limit (${U.t})</th><th>Status</th></tr></thead><tbody>${E.rows.map((r) => `<tr><td>${h(r.st)}</td><td class="n">${sm(r.B)}</td><td class="n">${sm(r.R)}</td><td class="n">${sm(r.allow)}</td><td>${st(r.status)}</td></tr>`).join('')}</tbody></table>
      <p class="sm-n">${E.src ? `Limit: ${h(E.src)}${E.dist != null && E.basis !== '653' ? `, where the breakover is within ${sm(E.dist)} ${U.t} of the shell` : ''}.` : 'No limit entered: readings reported only.'}${E.basis === '653' ? ' Lap welds taken as parallel to the shell.' : ''}</p>`;
  };

  /* ---- 2–4 checklist tables (as the template), then the supporting tables ---- */
  const chk = (grp) => `<table class="sm-chk"><thead><tr><th>Item</th><th>Condition</th><th>Comments</th></tr></thead><tbody>${ITEMS.filter((x) => x.grp === grp).map((it) => {
    const v = S.items[it.k] || {}, txt = String(v.text || '').trim();
    return `<tr><td class="i">${h(it.label)}</td><td class="c">${rating(v.rating)}</td><td${txt ? '' : ' class="x"'}>${txt ? h(txt).replace(/\n/g, '<br>') : '—'}</td></tr>`;
  }).join('')}</tbody></table>`;
  const extCh = () => `<section>${chk('ext')}${projT()}${oppT()}${tiltT()}</section>`;
  const intCh = () => `<section>${chk('int')}${edgeT()}</section>`;
  const insulCh = () => `<section>${chk('insul')}</section>`;

  /* ---- 5 Follow-up and sign-off ---- */
  const followCh = () => {
    const people = (job.personnel || []).filter((p) => p.name);
    return `<section><table class="sm-sum"><tbody>
      <tr><th>Preparatory work for the next inspection</th><td>${para(S.followup, 'None noted.')}</td></tr>
      <tr><th>Equipment suitable for continued service?</th><td><b>${fit ? h(fit) : 'Not stated.'}</b>${S.fitNote ? ' ' + h(S.fitNote) : ''}</td></tr></tbody></table>
      ${N.sub('Inspectors and technicians')}${people.length ? `<table class="grid small sm-sig"><thead><tr><th>Name</th><th>Role</th><th>Certification</th><th>Expiry</th><th>Signature</th></tr></thead><tbody>${people.map((p) => { const c = certState(p, I.inspDate); return `<tr><td>${h(p.name)}${p.company ? `<br><small>${h(p.company)}</small>` : ''}</td><td>${h(ROLE_LABEL[p.role] || p.role)}${p.method ? ` (${h(p.method)})` : ''}</td><td>${h([p.cert, p.certNo, p.level ? 'Level ' + p.level : ''].filter(Boolean).join(' · '))}</td><td>${h(p.expiry || '')}${c === 'expired' ? ' <b class="sm-bad">expired</b>' : ''}</td><td></td></tr>`; }).join('')}</tbody></table>` : '<p>No personnel listed (Tank setup → Personnel).</p>'}</section>`;
  };

  /* ---- appendices (S4) ---- */
  const SI = { company, client: I.client, site: I.site, tankId: I.tankId, reportNo: I.reportNo, rev: job.rev ? 'Rev ' + job.rev : 'Draft', revDate: job.savedAt ? new Date(job.savedAt).toISOString().slice(0, 10) : '', status: job.status?.stage === 'complete' ? 'ISSUED' : 'DRAFT', drawnBy: personName(job, 'insp653') || job.status?.inspector, checkedBy: job.status?.reviewer };
  const base0 = layoutOf(opts), drawCls = (base0.drawOrient === 'portrait' ? 'port' : 'land') + (base0.drawPaper === 'tabloid' ? ' lg' : '');
  const inds = (job.indications || []).slice().sort((a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));

  const photosApp = () => {
    const secPh = SECTIONS.flatMap((x) => (photos || []).filter((p) => p.sec === x.key && p.inReport !== false).sort((a, b) => (a.n || 0) - (b.n || 0)));
    const indPh = opts.photos === false ? [] : inds.flatMap((i) => (photos || []).filter((p) => p.indId === i.id).map((p, k) => ({ p, i, k })));
    if (!X.fig || (!secPh.length && !indPh.length)) return '';
    const rows = [];
    if (secPh.length) rows.push(`<div class="photos2">${secPh.map((p) => X.fig(p, true, job)).join('')}</div>${N.figure('Inspection photographs (number · component · location · caption)')}`);
    if (indPh.length) rows.push(`<div class="photos2">${indPh.map(({ p, i, k }) => `<figure class="phr ph2">${X.phBox(p)}<figcaption><b>Photo ${X.indPhotoNo(i, k)}</b> · Floor · indication ${h(i.no)} · ${h(p.caption || '')}</figcaption></figure>`).join('')}</div>${N.figure('Floor indication photographs (indication number and letter)')}`);
    return `<section>${rows.join('')}</section>`;
  };

  const utApp = () => {
    const out = [], sheets = [], locs = utLocations(job), cs = courseSummary(job), cw = coursesWithElev(job), zs = readingElevations(job);
    // minimum reading per course and station
    const minAt = (c, l) => { let m = null; for (const z of zs) { if (z < c.z0 - 1e-6 || z >= c.z1 - 1e-6) continue; const v = getReading(job, l.key, z); if (v !== null && (m === null || v < m)) m = v; } return m; };
    const hasShell = cs.some((c) => c.min !== null), nz = (job.nozzles || []).slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0)), nzRead = nz.filter((n) => nozzleUT(n, job).count);
    if (hasShell || nzRead.length) {
      const stMin = new Map(locs.map((l) => [l.key, cw.map((c) => minAt(c, l)).filter((v) => v !== null).reduce((a, b) => (a === null || b < a ? b : a), null)]));
      const nzRows = nz.map((n) => { const u = nozzleUT(n, job), w = nozzleWall(n, job); return `<tr><td><b>${h(n.mark)}</b></td><td>${h([n.type, n.service].filter(Boolean).join(' · '))}</td><td class="n">${fmt(n.size, 'small', job, false)}</td><td>${h(n.sched || '')}</td><td class="n">${t(w.tNom)}</td>${UT_CLOCK.map(([k]) => `<td class="n">${t(n[k])}</td>`).join('')}<td class="n"><b>${t(u.min)}</b></td></tr>`; }).join('');
      sheets.push(() => sheetHTML(N, SI, { cls: drawCls, figure: 'External shell and nozzle UT — plan', view: 'Shell and nozzles — plan view from above', scale: 'Not to scale',
        drawing: shellPlanSVG(job, { stations: locs, mins: stMin, fmtT: (v) => fmt(v, 't', job, false), zero: I.zeroRef }), wrap: 'roof-print',
        data: [['Diameter', big(T.diameter)], ['Shell height', big(T.height)], ['Courses', String(cw.length)], ['UT stations', String(locs.length)], ['Minimum shell reading', hasShell ? `${t(Math.min(...cs.filter((c) => c.min !== null).map((c) => c.min)))} ${U.t}` : '—'], ['Nozzles', String(nz.length)]],
        blocks: nz.length && nz.length <= 14 ? [['Nozzles', `<table class="dwg-kv sm-nzk"><tr><th>No.</th><th>Description</th><th>Size</th><th>Min</th></tr>${nz.map((n) => `<tr><td>${h(n.mark)}</td><td>${h(n.type || '')}</td><td>${fmt(n.size, 'small', job, false)}</td><td>${t(nozzleUT(n, job).min)}</td></tr>`).join('')}</table>`]] : [],
        legend: legendList([[swatch.dot('#0f766e'), 'Shell UT station, minimum reading below the label'], [swatch.dot('#fff', '#1d232b'), 'Nozzle (mark in the hexagon)']]),
        notes: [`Angles clockwise from 0° (${h(I.zeroRef || 'N')}) at the top.`, `Thickness in ${U.t}.`, 'Readings by course and station, and nozzle neck readings, are tabulated in this appendix.'] }));
      if (hasShell) out.push(`<section>${N.table('Shell UT readings — minimum by course and station')}<table class="grid small"><thead><tr><th>Course</th><th class="n">T-nom</th>${locs.map((l) => `<th class="n">${h(l.label)}<br><small>${Math.round(l.angle)}°</small></th>`).join('')}<th class="n">Min</th></tr></thead><tbody>${cw.slice().reverse().map((c) => { const s2 = cs.find((x) => x.id === c.id); return `<tr><td>${c.no}</td><td class="n">${t(c.tNom)}</td>${locs.map((l) => `<td class="n">${t(minAt(c, l))}</td>`).join('')}<td class="n"><b>${t(s2?.min)}</b></td></tr>`; }).join('')}</tbody></table><p class="note">The thinnest reading in each course at each station, in ${U.t}; top course first. Every reading taken is kept in the job.</p></section>`);
      if (nz.length) out.push(`<section>${N.table('Nozzle schedule and neck UT')}<table class="grid small"><thead><tr><th>No.</th><th>Description</th><th class="n">Size</th><th>Sch.</th><th class="n">Nominal</th>${UT_CLOCK.map(([, l]) => `<th class="n">${l} o’clock</th>`).join('')}<th class="n">Min</th></tr></thead><tbody>${nzRows}</tbody></table><p class="note">Thickness in ${U.t}; clock positions looking at the nozzle from outside the tank.</p></section>`);
    }
    if (hasFixed(job) && (job.roof.fixed.pts || []).length) {
      const Fx = job.roof.fixed, pts = Fx.pts;
      sheets.push(() => sheetHTML(N, SI, { cls: drawCls, figure: 'Fixed roof UT — plan', view: 'Fixed roof plan — viewed from above', scale: 'Not to scale',
        drawing: fixedSVG(job, { stations: locs, fmtT: (v) => fmt(v, 't', job, false) }), wrap: 'roof-print',
        data: [['Roof', h(Fx.kind)], ['Support', h(Fx.support)], ['Nominal plate t', t(Fx.tNom)], ['t-min', t(Fx.tMin)], ['UT points', String(pts.length)]],
        legend: legendList([[swatch.dot('#0f766e'), 'UT point at or above t-min'], [swatch.dot('#b91c1c'), 'UT point below t-min'], [swatch.dot('#fff', '#5b6470'), 'Not read'], [swatch.line('#0f766e', '4 2'), 'Shell UT station line']]),
        notes: [`Thickness in ${U.t}; each point shows its label and reading.`, `Points located by angle (clockwise from 0° ${h(I.zeroRef || '')}) and distance from the centre.`] }));
      out.push(`<section>${N.table('Fixed roof UT readings')}<table class="grid small"><thead><tr><th>Point</th><th class="n">Angle</th><th class="n">From centre</th><th class="n">Reading</th><th>Status</th></tr></thead><tbody>${pts.map((p) => { const ps = pointStatus(job, p); return `<tr><td><b>${h(p.label)}</b></td><td class="n">${p.angle != null ? (+p.angle).toFixed(0) + '°' : '—'}</td><td class="n">${big(p.r)}</td><td class="n">${t(p.t)}</td><td>${st(ps.status)}</td></tr>`; }).join('')}</tbody></table></section>`);
    }
    // tables first, then the drawing sheets (a sheet starts its own page, so it closes the appendix)
    return out.join('') + sheets.map((f) => f()).join('');
  };

  const mflApp = () => {
    const utPart = hasFloorUT(job) ? floorParts({ job, layout, calc, N, patches: [] }).ut() : ''; // schema 7: floor UT survey
    if ((!inds.length && !utPart) || !X.floorMap) return '';
    const per = calc.per, side = (i) => ({ ps: 'TS', ss: 'BS', both: 'TS + BS' })[i.result] || (i.result === 'nri' ? 'NRI' : i.result === 'pending' || !i.result ? 'Pending' : 'Other');
    const list = inds.map((i) => { const a = per.get(i.id) || {}; return `<tr><td>${h(i.no)}</td><td>${fmt(i.x, 'small', job, false)}</td><td>${fmt(i.y, 'small', job, false)}</td><td>${side(i)}</td><td>${t(a.rem)}</td></tr>`; }).join('');
    const listTbl = `<table class="dwg-kv sm-ind"><tr><th>No.</th><th>X</th><th>Y</th><th>TS/BS</th><th>T-act</th></tr>${list}</table>`;
    const onSheet = inds.length <= 22, patches = patchList(job, layout, calc);
    const full = `<section>${N.table('MFL indications and UT prove-up')}<table class="grid small"><thead><tr><th>No.</th><th>Plate</th><th class="n">X</th><th class="n">Y</th><th class="n">MFL %</th><th>TS / BS</th><th class="n">UT min</th><th class="n">VT pit</th><th class="n">T-act</th><th>Repair</th></tr></thead><tbody>${inds.map((i) => { const a = per.get(i.id) || {}; return `<tr class="${a.repair ? 'is-rep' : ''}"><td>${h(i.no)}</td><td>${h(a.plate?.label ?? '?')}</td><td class="n">${fmt(i.x, 'small', job, false)}</td><td class="n">${fmt(i.y, 'small', job, false)}</td><td class="n">${i.mflPct ?? '—'}</td><td>${side(i)}</td><td class="n">${t(i.utMin)}</td><td class="n">${t(i.vtDepth)}</td><td class="n">${t(a.rem)}</td><td>${a.repair ? 'Yes' : a.status === 'below MRT' ? '<b>Below limit</b>' : ''}</td></tr>`; }).join('')}</tbody></table><p class="note">Dimensions in ${U.t}. TS = top side (product side); BS = bottom side (soil side).</p></section>`;
    const sheet = sheetHTML(N, SI, { cls: drawCls, figure: 'Floor internal — MFL indications and UT prove-up', view: 'Floor plan — viewed from above', scale: 'As shown by the scale bar',
      drawing: X.floorMap(), wrap: 'map-wrap',
      data: [['Diameter', big(T.diameter)], ['Bottom nominal t', `${t(T.tBottom)} ${U.t}`], ['Plates', String(layout.plates.length)], ['MFL indications', String(inds.length)], ['Patch plates', String(patches.length)]],
      blocks: onSheet ? [['Indications', listTbl]] : [],
      legend: X.legendHTML ? X.legendHTML() : '',
      notes: [`X / Y in ${U.t} from each plate's datum corner. TS = top side (product side); BS = bottom side (soil side). T-act = remaining thickness used in the evaluation.`, `0° ${h(I.zeroRef || '')}; angles clockwise.`, ...(onSheet ? [] : ['The indication list is tabulated before this sheet.'])] });
    return (inds.length ? full : '') + (utPart ? `<section>${utPart}</section>` : '') + sheet;
  };

  const calcApp = () => {
    const Rr = R.thick, rate = (v) => fmtRate(v, job, true), mm = (v) => `${t(v)} ${U.t}`;
    const lifeStep = (x, lbl) => (x && x.cr != null ? step(`${lbl} — CR`, '(T-nom − T-act) / years', `(${t(x.tNom)} − ${t(x.tAct)}) / ${x.years}`, rate(x.cr)) + step(`${lbl} — RL`, '(T-act − T-min) / CR', `(${t(x.tAct)} − ${t(x.tMin)}) / ${fmtRate(x.cr, job, false)}`, `${rlText(x.rl, x.cr)} years`) : '');
    const Iv = R.intervals, sh = Rr.shell;
    const ivSteps = Iv.basis === '653' && sh && sh.cr ? step('UT thickness', 'lesser of 15 and RCA / 2N', `RCA = ${t(sh.tAct)} − ${t(sh.tMin)} = ${t(sh.rca)}; ${t(sh.rca)} / (2 × ${fmtRate(sh.cr, job, false)})`, `${yrs(Iv.ut.done.years)} years`) + step('External', 'lesser of 5 and RCA / 4N', `${t(sh.rca)} / (4 × ${fmtRate(sh.cr, job, false)})`, `${yrs(Iv.ext.done.years)} years`) : '';
    const P = R.tilt.planar, D = T.diameter;
    const tiltSteps = P.slope !== undefined ? step('Tilt, E–W', '(E − W) / D', `(${sm(P.z.E)} − ${sm(P.z.W)}) / ${big(D)}`, P.sx.toExponential(3)) + step('Tilt, N–S', '(N − S) / D', `(${sm(P.z.N)} − ${sm(P.z.S)}) / ${big(D)}`, P.sy.toExponential(3)) +
      step('Height difference', '√(sx² + sy²) × D', '', mm(P.diff)) + step('Twist', '[(N + S) − (E + W)] / 4', `[(${sm(P.z.N)} + ${sm(P.z.S)}) − (${sm(P.z.E)} + ${sm(P.z.W)})] / 4`, mm(P.twist)) +
      (P.plumbElev != null ? step('Out of plumb (elevations)', 'tilt × H', '', mm(P.plumbElev)) : '') + (P.leanMax != null ? step('Out of plumb (level)', 'largest reading / level length × H', '', mm(P.leanMax)) : '') + step('Freeboard loss', 'height difference / 2', '', mm(P.freeboard)) : '';
    return `<section>${block(N, { name: 'Small tank calculations',
      inputs: [['Tank age (years)', String(R.years ?? '—'), 'S', 'API 653 page'], ['Floor nominal', mm(T.tBottom), 'S', 'Tank setup'], ['Shell nominal (governing course)', sh ? mm(sh.tNom) : '—', 'S', 'Shell courses'], ['Shell T-act (governing course)', sh ? mm(sh.tAct) : '—', 'M', 'Shell UT'], ['Roof nominal / T-min', Rr.roof ? `${mm(Rr.roof.tNom)} / ${mm(Rr.roof.tMin)}` : '—', 'S', 'Fixed roof'], ['Diameter / shell height', `${big(D)} / ${big(T.height)}`, 'S', 'Tank setup'], ['Settlement basis', h((SETTLE_BASIS.find(([k]) => k === S.basis.settle) || [])[1]), 'S', 'Small tank checklist'], ['Interval rules', Iv.basis === '12r1' ? 'API 12R1 (entered)' : 'API 653', 'S', 'Small tank checklist']],
      assumptions: ['Corrosion is taken as uniform over the years in service (linear rate from nominal).', 'The floor uses the API 653 §4.4.5 evaluation with every repair set to No (as found) and with the recommended repairs (after).', ...(S.basis.settle === 'small' ? ['Planar method: the tank is treated as a rigid body; four stations at 0°, 90°, 180° and 270° from the 0° reference.'] : [])],
      refs: ['API 653 §4.3.3.1 (shell t-min)', '§4.2.1.2 (roof)', '§4.4.5 (floor)', '§6.3.2.1 (external interval)', '§6.3.3.2 (UT interval)', '§6.4.2 (internal interval)', '§10.5.2.1 (out of plumb)', ...(S.basis.settle === '653' ? ['Annex B'] : []), ...(S.basis.settle === '12r1' || Iv.basis === '12r1' ? ['API 12R1 (values entered from the user’s copy)'] : [])],
      working: `${lifeStep(Rr.shell, `Shell course ${sh?.course ?? ''}`)}${lifeStep(Rr.roof, 'Fixed roof')}${Rr.floor.tAct != null ? step('Floor — RL as found', '(RT − limit) / (StPᵣ + UPᵣ)', `(${t(Rr.floor.tAct)} − ${t(Rr.floor.tMin)}) / ${fmtRate(Rr.floor.cr, job, false)}`, `${rlText(Rr.floor.rl, Rr.floor.cr)} years`) : ''}${ivSteps}${tiltSteps}`,
      results: [['Shell remaining life', sh ? `${rlText(sh.rl, sh.cr)} years` : '—', '—', ''], ['UT thickness interval', `${yrs(Iv.ut.done.years)} years`, Iv.ut.done.src, ''], ['External interval', `${yrs(Iv.ext.done.years)} years`, Iv.ext.done.src, ''], ['Internal interval (completed / not)', `${yrs(Iv.int.done.years)} / ${yrs(Iv.int.not.years)} years`, Iv.int.done.src, ''], ['Out of plumb', R.tilt.plumb == null ? '—' : mm(R.tilt.plumb), R.tilt.plumbLim == null ? '—' : `${mm(R.tilt.plumbLim)} (${h(R.tilt.limSrc)})`, st(R.tilt.status)], ['Edge settlement', h(R.edge.status), R.edge.src ? h(R.edge.src) : '—', st(R.edge.status)]] })}</section>`;
  };

  const floorCalcApp = () => (inds.length ? `<section>${calcFloor({ job, layout, calc, N })}</section>` : '');

  const chapterBody = { summary: summaryCh, ext: extCh, int: intCh, insul: insulCh, follow: followCh };
  const base = layoutOf(opts);
  // front matter: cover, then document control and contents together on one page; no value key (no marks in the body)
  const LY = { ...base, front: base.front.filter((f) => f.id !== 'key'), chapters: SMALL_CHAPTERS.map(([id, title]) => ({ id, title, on: true })), appendices: SMALL_APPENDICES.map(([id, title]) => ({ id, title, on: !(opts.layout?.off || []).includes('small-' + id) })) };
  const appendixBody = { photos: photosApp, ut: utApp, mfl: mflApp, calc: calcApp, calcfloor: floorCalcApp };
  return assembleReport({ job, company, opts, layout: LY, N, chapterBody, appendixBody, extraCSS: SMALL_CSS, cls: 'rp-small', tocLists: false,
    cover: { title: titleOf(job), sub: R.intervals.basis === '12r1' ? 'API 12R1 / API 653' : 'API 653' },
    footer: `<footer class="rp-foot">${job.rev ? `${h(I.tankId || '')} Rev ${job.rev} (${h(new Date(job.savedAt).toLocaleDateString())}). ` : ''}${h(company.footer || '')} Small tank report. Calculations per API 653 (§4.4.5 floor, §4.3.3 shell, §6.3 and §6.4 intervals) with corrections ${h(CORRECTIONS)}${S.basis.settle === '12r1' || S.basis.intervals === '12r1' ? '; API 12R1 values as entered by the inspector' : ''}; verify limits against the editions in force.</footer>` });
}
