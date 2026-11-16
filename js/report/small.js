// Small tank report (stage S3): the short report for small-diameter tanks, in the order of the small tank template —
// job information, tank static data, inspection summary, code and non-code recommendations, NDE scope and results,
// inspection intervals, thickness and corrosion rates, the external / internal / insulation items, then follow-up
// and sign-off. Built inside the same report frame as the full report (cover, document control, contents, page
// set-up, header and footer). Values come from js/smallcalc.js; nothing is calculated here.
// Clause numbers only: no standards text is reproduced.
import { assembleReport, layoutOf, numbering } from './frame.js';
import { vm } from './front.js';
import { smallCalc, rlText } from '../smallcalc.js';
import { GROUPS, ITEMS, RATING_LABEL, SETTLE_BASIS, FIT, titleOf } from '../small.js';
import { SECTIONS, PRIORITY_LABEL } from '../sections.js';
import { ROLE_LABEL, certState } from '../personnel.js';
import { fmt, fmtRate, unitLabel } from '../units.js';
import { esc as h } from '../util.js';
import { CORRECTIONS } from '../calc.js';

/** Chapters of the small report, in the template's order. */
export const SMALL_CHAPTERS = [
  ['job', 'Job information'], ['static', 'Tank static data'], ['summary', 'Inspection summary'],
  ['code', 'Code required recommendations'], ['noncode', 'Non-code recommendations'], ['nde', 'NDE scope and summary of results'],
  ['intervals', 'Inspection intervals'], ['thick', 'Thickness and corrosion rates'],
  ['ext', 'External inspection'], ['int', 'Internal inspection'], ['insul', 'Insulation'], ['follow', 'Follow-up and sign-off']
];

const kv = (rows) => `<table class="kv">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v === '' || v == null ? '—' : v}</td></tr>`).join('')}</table>`;
const rating = (r) => (r ? `<span class="sm-rate r-${r}">${h(RATING_LABEL[r]).toUpperCase()}</span>` : '<span class="sm-rate">NOT RATED</span>');
const yrs = (v) => (v == null ? '—' : String(Math.round(v * 10) / 10));

export const SMALL_CSS = `
.rp2 .sm-rate{display:inline-block;min-width:4.5em;text-align:center;font-weight:700;font-size:9px;letter-spacing:.04em;padding:1px 6px;border:1px solid #8a939e;border-radius:3px;color:#3a434e}
.rp2 .sm-rate.r-good{border-color:#15803d;color:#15803d}.rp2 .sm-rate.r-fair{border-color:#a16207;color:#a16207}.rp2 .sm-rate.r-poor{border-color:#b91c1c;color:#fff;background:#b91c1c}.rp2 .sm-rate.r-na{color:#66707c}
.rp2 .sm-item{break-inside:avoid;margin:0 0 10px}.rp2 .sm-item .sm-ih{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.rp2 .sm-item p.sm-c{margin:3px 0 6px}.rp2 .sm-sig td{height:28px}
.rp2.rp-small .rp-chap{break-before:auto;margin-top:18px}.rp2.rp-small h2.rp-ch{break-after:avoid}
@media print{.report.rp-small .rp-chap{break-before:auto}.report.rp-small .rp-front + .rp-chap{break-before:page}.report.rp-small table.sm-cond{break-inside:avoid}}
.rp2 .sm-ok{color:#15803d}.rp2 .sm-bad{color:#b91c1c;font-weight:700}.rp2 .sm-warn{color:#a16207}
`;
const stCls = (t) => (/Exceeds|Below|Fails|Unfit/.test(t || '') ? 'sm-bad' : /NDE|Beyond|No limit|Reported|not recorded|Incomplete|No Annex/i.test(t || '') ? 'sm-warn' : /Acceptable|OK|Meets/.test(t || '') ? 'sm-ok' : '');
const st = (t) => `<span class="${stCls(t)}">${h(t || '—')}</span>`;

/**
 * The small report. Same arguments as buildReport; `opts` carries the front-matter switches, drawing options and the
 * document-control history.
 */
export function buildSmallReport(job, layout, calc, company, photos, opts = {}) {
  const I = job.info || {}, T = job.tank || {}, S = job.small, R = smallCalc(job, layout, calc), N = numbering();
  const t = (v) => fmt(v, 't', job, false), sm = (v) => (v == null ? '—' : fmt(v, 'small', job, false)), big = (v) => (v == null ? '—' : fmt(v, 'big', job));
  const U = { t: unitLabel('small', job), big: unitLabel('big', job), rate: unitLabel('rate', job) };
  const courses = job.shell?.courses || [], shellNom = courses.map((c) => +c.tNom).filter((x) => x > 0);
  const recs = SECTIONS.flatMap((x) => (job.secs?.[x.key]?.recs || []).map((r) => ({ r, sec: x })));

  const recTable = (list, title, empty) => (list.length
    ? `${N.table(title)}<table class="grid small wrap"><thead><tr><th>No.</th><th>Component</th><th>Finding${vm('O')}</th><th>Recommended action</th><th>Priority</th><th>Due</th><th>Reference</th></tr></thead><tbody>${list.map(({ r, sec }, i) => `<tr><td><b>${i + 1}</b>${r.def && r.no ? `<br><small>${h(r.no)}</small>` : ''}</td><td>${h(sec.label)}${r.loc ? `<br><small>${h(r.loc)}</small>` : ''}</td><td>${h(r.finding)}</td><td>${h(r.action)}</td><td>${h(PRIORITY_LABEL[r.priority] || r.priority || '')}</td><td>${h(r.due || '')}</td><td>${h(r.ref || '')}</td></tr>`).join('')}</tbody></table>`
    : `<p>${empty}</p>`);

  /* ---- chapters ---- */
  const jobCh = () => `<section>${kv([['Client', h(I.client)], ['Facility / LSD', h(I.site)], ['Area', h(I.location)], ['Tank number', h(I.tankId)], ['Product / service', h([I.product, I.service].filter(Boolean).join(' · '))],
    ['Job number', h(I.jobNo)], ['P.O. number', h(I.poNo)], ['Work order', h(I.workOrder)], ['Report number', h(I.reportNo)], ['Inspection date', h(I.inspDate)]])}</section>`;

  const staticCh = () => `<section>${N.table('Nameplate and design data')}${kv([['Manufacturer', h(T.maker)], ['Code of construction', h([T.code, T.edition, T.supp].filter(Boolean).join(', '))], ['Year built', h(T.yearBuilt)], ['Serial number', h(T.serialNo)],
    ['Diameter', big(T.diameter)], ['Height', big(T.height)], ['Capacity', h(T.capacity)], ['Bottom construction', h(T.bottomType)]])}
    ${N.table('Materials and nominal thickness')}<table class="grid small"><thead><tr><th>Component</th><th>Material</th><th class="n">Nominal thickness (${U.t})</th></tr></thead><tbody>
    <tr><td>Floor</td><td>${h(T.matFloor || '—')}</td><td class="n">${t(T.tBottom)}</td></tr>
    <tr><td>Shell</td><td>${h(T.matShell || '—')}</td><td class="n">${shellNom.length ? shellNom.map((x) => t(x)).join(' / ') + (shellNom.length > 1 ? ' (course 1 up)' : '') : '—'}</td></tr>
    <tr><td>Roof</td><td>${h(T.matRoof || '—')}</td><td class="n">${t(job.roof?.fixed?.tNom)}</td></tr></tbody></table></section>`;

  const summaryCh = () => {
    const narrative = String(job.summary?.narrative || '').trim();
    const fit = (FIT.find(([k]) => k === S.fit) || [])[1];
    const byGrp = GROUPS.map(([g, l]) => `<tr class="grp"><th colspan="2">${l}</th></tr>${ITEMS.filter((x) => x.grp === g).map((x) => `<tr><td>${h(x.label)}</td><td>${rating(S.items[x.k]?.rating)}</td></tr>`).join('')}`).join('');
    return `<section>${narrative ? narrative.split(/\n{2,}/).map((p) => `<p>${h(p).replace(/\n/g, '<br>')}</p>`).join('') : '<p>No summary entered.</p>'}
      ${fit ? `<p><b>${h(fit)}${S.fitNote ? ' — ' + h(S.fitNote) : ''}.</b></p>` : ''}
      ${N.table('Condition by item')}<table class="grid small sm-cond"><thead><tr><th>Item</th><th>Condition${vm('O')}</th></tr></thead><tbody>${byGrp}</tbody></table></section>`;
  };

  const codeCh = () => `<section>${recTable(recs.filter((x) => x.r.code), 'Code required recommendations', 'No code required recommendations.')}</section>`;
  const nonCodeCh = () => `<section>${recTable(recs.filter((x) => !x.r.code), 'Non-code recommendations', 'No non-code recommendations.')}</section>`;

  const ndeCh = () => {
    const rows = SECTIONS.flatMap((x) => (job.secs?.[x.key]?.nde || []).map((m) => `<tr><td>${h(x.label)}</td><td>${h(m.method)}</td><td>${h(m.extent || '')}</td><td>${h(m.result || '—')}</td><td>${h(m.notes || '')}</td></tr>`)).join('');
    const inds = job.indications || [], proven = inds.filter((i) => ['ps', 'ss', 'both'].includes(i.result)).length;
    const res = [];
    if (inds.length) res.push(`MFL floor scan: ${inds.length} indication${inds.length > 1 ? 's' : ''}, ${proven} proven up as corrosion (product side, soil side or both).`);
    const F = R.thick.floor; if (F.tAct != null) res.push(`Floor minimum remaining thickness ${t(F.tAct)} ${U.t}${vm('C')}.`);
    if (R.thick.courses.length) res.push(`Shell UT: minimum ${t(Math.min(...R.thick.courses.map((c) => c.tAct)))} ${U.t}${vm('M')} (${R.thick.courses.length} course${R.thick.courses.length > 1 ? 's' : ''}).`);
    if (R.thick.roof) res.push(`Fixed roof UT: minimum ${t(R.thick.roof.tAct)} ${U.t}${vm('M')}${R.thick.roof.holes ? `, ${R.thick.roof.holes} hole(s)` : ''}.`);
    return `<section>${N.table('NDE performed')}${rows ? `<table class="grid small wrap"><thead><tr><th>Component</th><th>Method</th><th>Extent</th><th>Result</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>No NDE methods recorded.</p>'}
      ${res.length ? `${N.sub('Summary of results')}<ul>${res.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}</section>`;
  };

  const ivCh = () => {
    const Iv = R.intervals, cell = (x) => (x.override ? `<b>${h(x.override)}</b><br><small>entered</small>` : x.years == null ? `<small>${h(x.src)}</small>` : `<b>${h(x.date || '—')}</b> (${yrs(x.years)} yr)${vm('C')}`);
    const rows = [['ut', 'UT thickness'], ['ext', 'In service (external)'], ['int', 'Out of service (internal)']].map(([k, l]) => `<tr><td>${l}</td><td>${cell(Iv[k].done)}</td><td>${cell(Iv[k].not)}</td></tr>`).join('');
    const src = [...new Set(['ut', 'ext', 'int'].flatMap((k) => [Iv[k].done, Iv[k].not]).filter((x) => !x.override).map((x) => x.src))];
    return `<section>${N.table(`Next inspections — ${Iv.basis === '12r1' ? 'API 12R1 (maximum intervals entered)' : 'API 653'}`)}<table class="grid small"><thead><tr><th>Inspection</th><th>Recommendations completed</th><th>Recommendations not completed</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">Dates count from the inspection date, ${h(I.inspDate || '—')}. ${src.map(h).join('; ')}.${['ut', 'ext', 'int'].some((k) => Iv[k].done.override || Iv[k].not.override) ? ' Entered: a date or interval entered by the inspector in place of the calculated one.' : ''}</p></section>`;
  };

  const thickCh = () => {
    const X = R.thick, F = X.floor;
    const row = (x, label) => (x ? `<tr><td>${label}</td><td class="n">${t(x.tNom)}</td><td class="n">${t(x.tAct)}${x.key === 'floor' ? vm('C') : vm('M')}</td><td class="n">${x.years ?? '—'}</td><td class="n">${fmtRate(x.cr, job, false)}${vm('C')}</td><td class="n">${t(x.tMin)}</td><td class="n"><b>${rlText(x.rl, x.cr)}</b>${vm('C')}</td></tr>`
      : `<tr><td>${label}</td><td colspan="6">No readings</td></tr>`);
    return `<section>${N.table('Thickness, corrosion rate and remaining life')}<table class="grid small"><thead><tr><th>Component</th><th class="n">T-nom (${U.t})</th><th class="n">T-act (${U.t})</th><th class="n">Years</th><th class="n">CR (${U.rate})</th><th class="n">T-min (${U.t})</th><th class="n">RL (years)</th></tr></thead><tbody>
      ${row(F.tAct == null ? null : F, 'Floor (as found)')}${row(X.shell, X.shell ? `Shell — course ${X.shell.course}` : 'Shell')}${row(X.roof, 'Fixed roof')}</tbody></table>
      ${X.courses.length > 1 ? `${N.table('Shell courses')}<table class="grid small"><thead><tr><th>Course</th><th class="n">T-nom</th><th class="n">T-act${vm('M')}</th><th class="n">CR${vm('C')}</th><th class="n">T-min</th><th class="n">RL (years)${vm('C')}</th></tr></thead><tbody>${X.courses.map((c) => `<tr><td>${c.course}</td><td class="n">${t(c.tNom)}</td><td class="n">${t(c.tAct)}</td><td class="n">${fmtRate(c.cr, job, false)}</td><td class="n">${t(c.tMin)}</td><td class="n">${rlText(c.rl, c.cr)}</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="note">CR = (T-nom − T-act) / years; RL = (T-act − T-min) / CR; 30 + = no measurable loss or a life over 30 years. Shell T-min per API 653 §4.3.3.1 unless entered; roof T-min as entered (API 653 §4.2.1.2). Floor per API 653 §4.4.5: T-act = the minimum remaining thickness RT, CR = StPᵣ + UPᵣ, T-min = the governing area's limit, RL = the largest Oᵣ it allows${F.rlAfter != null ? `; after the recommended floor repairs RL = ${rlText(F.rlAfter, F.cr)} years` : ''}.${F.notEvaluated ? ' The floor was not evaluated: no corrosion rate basis (tank age) was entered.' : ''}</p></section>`;
  };

  /* ---- item tables ---- */
  const projT = () => {
    const P = R.proj, m = P[0];
    return `${N.table('Floor projections beyond the shell')}<table class="grid small"><thead><tr><th>Location</th><th class="n">Thickness (${U.t})${vm('M')}</th><th class="n">Projection (${U.t})${vm('M')}</th><th>API 653 §4.4.5.7${vm('C')}</th></tr></thead><tbody>${P.map((p) => `<tr><td>${h(p.loc)}</td><td class="n">${t(p.t)}</td><td class="n">${sm(p.w)}</td><td>${p.ok == null ? '—' : st(p.ok ? 'Meets' : p.tOk === false ? 'Below minimum thickness' : 'Below minimum width')}</td></tr>`).join('')}</tbody></table>
      ${m ? `<p class="note">Minimum ${t(m.tMin)} ${U.t} thick at the outside weld toe and ${sm(m.wMin)} ${U.t} wide.</p>` : ''}`;
  };
  const oppT = () => (S.opp.length ? `${N.table('Over-pressure and vacuum protection')}<table class="grid small"><thead><tr><th>Device</th><th>Serial no.</th><th>Pressure</th><th>Vacuum</th><th>Last serviced</th></tr></thead><tbody>${S.opp.map((d) => `<tr><td>${h(d.dev)}</td><td>${h(d.serial)}</td><td>${h(d.press)}</td><td>${h(d.vac)}</td><td>${h(d.svc)}</td></tr>`).join('')}</tbody></table>` : '');
  const tiltT = () => {
    const X = R.tilt, P = X.planar, b = (SETTLE_BASIS.find(([k]) => k === X.basis) || [])[1];
    const stn = S.tilt.some((x) => x.elev != null || x.lean != null) ? `${N.table('Settlement and tilt readings')}<table class="grid small"><thead><tr><th>Station</th><th class="n">Shell-base elevation (${U.t})${vm('M')}</th><th class="n">Out of plumb over ${big(S.level)} (${U.t})${vm('M')}</th></tr></thead><tbody>${S.tilt.map((x) => `<tr><td>${h(x.loc)}</td><td class="n">${sm(x.elev)}</td><td class="n">${sm(x.lean)}</td></tr>`).join('')}</tbody></table>` : '';
    const rows = [];
    if (X.basis === '653') {
      const f = X.annexB?.fit;
      rows.push(['Basis', 'API 653 Annex B — full settlement survey', '']);
      if (f) rows.push(['Out of plumb at the top of the shell', `${sm(f.plumb)} ${U.t}`, `limit ${sm(f.plumbLim)} ${U.t} (API 653 §10.5.2.1)`]);
    } else rows.push(['Basis', h(b), X.refs ? h(X.refs) : '']);
    if (P.slope !== undefined) {
      rows.push(['Planar tilt', `${sm(P.diff)} ${U.t} across the diameter`, P.lowDeg == null ? 'level' : `low side at ${Math.round(P.lowDeg)}° from the 0° reference (${h(I.zeroRef || 'N')})`]);
      rows.push(['Twist (out of plane)', `±${sm(Math.abs(P.twist))} ${U.t}`, X.twistTrig != null && X.basis !== '653' ? `trigger ${sm(X.twistTrig)} ${U.t}${X.twistOk === false ? ' — <b>a full API 653 Annex B survey is recommended</b>' : ''}` : 'reported only']);
      rows.push(['Loss of freeboard on the low side', `${sm(P.freeboard)} ${U.t}`, 'for the overfill set-point']);
      if (P.drain) rows.push(['Drain', `${h(P.drain.mark)} at ${P.drain.angle}°`, `the low side is ${P.drain.rel} the drain`]);
    }
    if (X.basis !== '653') {
      if (P.plumbElev != null) rows.push(['Out of plumb from the elevations', `${sm(P.plumbElev)} ${U.t}`, 'tilt × shell height']);
      if (P.leanMax != null) rows.push(['Out of plumb from the level readings', `${sm(P.leanMax)} ${U.t}`, 'largest reading scaled to the shell height']);
      rows.push(['Out of plumb', X.plumb == null ? '—' : `<b>${sm(X.plumb)} ${U.t}</b>`, X.plumbLim == null ? 'no limit entered' : `limit ${sm(X.plumbLim)} ${U.t} (${h(X.limSrc)})`]);
    }
    rows.push(['Result', st(X.status), '']);
    return `${stn}${N.table('Settlement and tilt — results')}<table class="grid small"><tbody>${rows.map(([a, v, c]) => `<tr><th>${a}</th><td>${v}${a === 'Result' || a === 'Basis' ? '' : vm('C')}</td><td>${c}</td></tr>`).join('')}</tbody></table>
      ${X.basis === 'small' ? '<p class="note">Small-tank planar method: the tank treated as a rigid body. Plane fitted through the four shell-base elevations; twist = the departure of the four points from that plane; out of plumb = tilt × shell height, and the level readings scaled to the shell height, whichever is larger. It is not API 653 Annex B, which needs more stations; a twist over the trigger calls for an Annex B survey.</p>' : ''}`;
  };
  const edgeT = () => {
    const E = R.edge;
    if (!S.edge.some((x) => x.max != null)) return '';
    return `${N.table('Edge settlement')}<table class="grid small"><thead><tr><th>Station</th><th class="n">Maximum settlement (${U.t})${vm('M')}</th><th class="n">Breakover from shell (${U.t})${vm('M')}</th><th class="n">Limit (${U.t})</th><th>Status${vm('C')}</th></tr></thead><tbody>${E.rows.map((r) => `<tr><td>${h(r.st)}</td><td class="n">${sm(r.B)}</td><td class="n">${sm(r.R)}</td><td class="n">${sm(r.allow)}</td><td>${st(r.status)}</td></tr>`).join('')}</tbody></table>
      <p class="note">${E.src ? `Limit: ${h(E.src)}${E.dist != null && E.basis !== '653' ? `, applied where the breakover is within ${sm(E.dist)} ${U.t} of the shell` : ''}.` : 'No limit entered: readings reported only.'}${E.basis === '653' ? ' Bottom lap welds taken as parallel to the shell (the lower curve).' : ''}</p>`;
  };
  const TABLES = { proj: projT, opp: oppT, tilt: tiltT, edge: edgeT };

  const itemsCh = (grp) => () => `<section>${ITEMS.filter((x) => x.grp === grp).map((it) => {
    const v = S.items[it.k] || {}, txt = String(v.text || '').trim();
    return `${grp === 'insul' ? '' : N.sub(it.label)}<div class="sm-item"><div class="sm-ih">${grp === 'insul' ? `<b>${h(it.label)}</b>` : '<span></span>'}<span>Condition${vm('O')} ${rating(v.rating)}</span></div>
      <p class="sm-c">${txt ? h(txt).replace(/\n/g, '<br>') : '<i>No comments.</i>'}</p>${it.table ? TABLES[it.table]() : ''}</div>`;
  }).join('')}</section>`;

  const followCh = () => {
    const people = (job.personnel || []).filter((p) => p.name);
    const fit = (FIT.find(([k]) => k === S.fit) || [])[1];
    return `<section>${N.sub('Follow-up inspections — preparatory work')}<p>${String(S.followup || '').trim() ? h(S.followup).replace(/\n/g, '<br>') : 'None noted.'}</p>
      ${N.sub('Equipment suitable for continued service?')}<p><b>${fit ? h(fit) : 'Not stated.'}</b>${S.fitNote ? ' ' + h(S.fitNote) : ''}</p>
      ${N.sub('Inspectors and technicians')}${people.length ? `<table class="grid small sm-sig"><thead><tr><th>Name</th><th>Role</th><th>Certification</th><th>Expiry</th><th>Signature</th></tr></thead><tbody>${people.map((p) => { const c = certState(p, I.inspDate); return `<tr><td>${h(p.name)}${p.company ? `<br><small>${h(p.company)}</small>` : ''}</td><td>${h(ROLE_LABEL[p.role] || p.role)}${p.method ? ` (${h(p.method)})` : ''}</td><td>${h([p.cert, p.certNo, p.level ? 'Level ' + p.level : ''].filter(Boolean).join(' · '))}</td><td>${h(p.expiry || '')}${c === 'expired' ? ' <b class="sm-bad">expired</b>' : ''}</td><td></td></tr>`; }).join('')}</tbody></table>` : '<p>No personnel listed (Tank setup → Personnel).</p>'}</section>`;
  };

  const chapterBody = { job: jobCh, static: staticCh, summary: summaryCh, code: codeCh, noncode: nonCodeCh, nde: ndeCh, intervals: ivCh, thick: thickCh, ext: itemsCh('ext'), int: itemsCh('int'), insul: itemsCh('insul'), follow: followCh };
  const base = layoutOf(opts);
  const LY = { ...base, chapters: SMALL_CHAPTERS.map(([id, title]) => ({ id, title, on: true })), appendices: [] };
  void photos;
  return assembleReport({ job, company, opts, layout: LY, N, chapterBody, appendixBody: {}, extraCSS: SMALL_CSS, cls: 'rp-small', tocLists: false,
    cover: { title: titleOf(job), sub: R.intervals.basis === '12r1' ? 'API 12R1 / API 653' : 'API 653' },
    footer: `<footer class="rp-foot">${job.rev ? `${h(I.tankId || '')} Rev ${job.rev} (${h(new Date(job.savedAt).toLocaleDateString())}). ` : ''}${h(company.footer || '')} Small tank report. Calculations per API 653 (§4.4.5 floor, §4.3.3 shell, §6.3 and §6.4 intervals) with corrections ${h(CORRECTIONS)}${S.basis.settle === '12r1' || S.basis.intervals === '12r1' ? '; API 12R1 values as entered by the inspector' : ''}; verify limits against the editions in force.</footer>` });
}
