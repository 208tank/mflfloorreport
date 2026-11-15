// Settlement screen: API 653 Annex B shell survey, edge settlement survey, edge areas and bottom depressions
// (refactoring step 3). Calculations are in settle.js; this module draws the screen and handles its inputs.
import { S } from '../app/state.js';
import { field, focusSel, readInput } from '../app/fields.js';
import { defineView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { commit } from '../app/persist.js';
import { uid } from '../model.js';
import { autoN, depEval, EDGE_NOTE, edgeCurve, edgeEval, ELEV_UNITS, epOffsets, kRoofFixed, newDep, newEdge, profileEval, profileSVG, PSI_PER_MPA, settleCalc, settleChartSVG, settlePlanSVG, slopeText, stations, WELDS, xKey } from '../settle.js';
import { shellHeight } from '../shell.js';
import { edgeAllow as edgeAllowT } from '../tables.js';
import { $, $$, askConfirm, toast } from '../ui.js';
import { fmt, inVal, num, u } from '../units.js';
import { esc as h } from '../util.js';

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
      ${res('Out-of-plumbness at top of shell (tilt × H)', `${fS(F.plumb)} ${sU}`, `≤ ${fS(F.plumbLim)} ${sU}`, c.tiltOk, 'Compared with API 653 §10.5.2.1 (a reconstruction tolerance): 1/100 of shell height, 5 in max')}
      ${res('… API 650 new-construction tolerance', `${fS(F.plumb)} ${sU}`, `${fS(F.plumb650)} ${sU}`, null, 'API 650 §7.5.2: 1/200 of height — reference only')}
      ${res('Max out-of-plane deflection |S|', F.maxS !== null ? `${fS(Math.abs(F.maxS))} ${sU} <small class="muted">(stn ${F.maxAt})</small>` : '—', c.Smax !== null ? `≤ ${fS(c.Smax)} ${sU}` : '<span class="muted">needs H, Y, E</span>', c.oopOk, 'B.3.2.1: Smax = 11·L²·Y / (2·E·H)')}
      ${res('Max measured difference (high − low)', `${fS(F.diff)} ${sU}`, '', null, 'Information')}
    </tbody></table>
    ${c.arcs?.arcs?.length ? `<h3>B.3.2.2 arc method <span class="muted small">(for information only — not used for acceptance until the engineer confirms the B.3.2.2 cap)</span></h3>
    <table class="grid sres settle-res"><thead><tr><th>Arc (stations)</th><th class="n">Arc length</th><th class="n">Max. settlement</th><th class="n">Allowable</th><th></th></tr></thead><tbody>
    ${c.arcs.arcs.map((a) => `<tr class="${a.ok === false ? 'is-bad' : ''}"><td>${a.from} → ${a.to} <small class="muted">${a.n} spaces${a.at ? ', max at stn ' + a.at : ''}</small></td><td class="n">${fmt(a.Sarc, 'big', job)}</td><td class="n"><b>${fS(Math.abs(a.maxDef))} ${sU}</b></td><td class="n">${a.allow != null ? '≤ ' + fS(a.allow) + ' ' + sU : '—'}</td><td>${a.ok === true ? '<span class="st st-OK">OK</span>' : a.ok === false ? '<span class="st st-below-MRT">Fails</span>' : ''}</td></tr>`).join('')}
    </tbody></table>
    <p class="muted small">${c.arcs.fold ? 'Fold pattern: settlement arcs of 50 % of the circumference (B.2.2.5.3)' : `Arcs run between successive high points${c.arcs.manual ? ' (as entered)' : ''}`}; settlement is the drop below the straight line joining the arc ends, measured ${c.arcs.fromTilt ? 'from the tilt plane (B.2.2.5.2, Figure B.5)' : 'from the measured elevations (B.2.2.5.1)'}. Allowable = min(K · S<sub>arc</sub> · (D / H) · (Y / E), 4 in) with K = ${c.arcs.K ?? 'n/a'} (${c.arcs.fixed ? 'fixed roof' : 'open top'}, D ${fmt(c.D, 'big', job)}), Y = ${Math.round(c.Y * 145.0377).toLocaleString()} psi, E = ${(c.E * 145.0377 / 1e6).toFixed(1)} × 10⁶ psi (${h(c.Esrc || c.Ysrc || '')}). ${c.arcs.K === null ? '<b>No K value for this diameter and roof type — engineering evaluation required.</b>' : ''}</p>` : ''}` : '<p class="muted">Enter at least 4 station readings to evaluate the shell settlement.</p>';
  const warn = c.warnings.length ? `<div class="warnbox">${c.warnings.map((w) => `<p>${h(w)}</p>`).join('')}</div>` : '';

  const ein = (x, k, kind, extra = '') => `<input data-se="edge" data-eid="${x.id}" data-f="${k}" data-kind="${kind}" ${kind === 'text' ? '' : 'inputmode="decimal"'} value="${h(kind === 'num' || kind === 'text' ? x[k] ?? '' : inVal(x[k], kind, job))}" ${extra}>`;
  const din = (x, k, kind, extra = '') => `<input data-se="dep" data-eid="${x.id}" data-f="${k}" data-kind="${kind}" ${kind === 'text' ? '' : 'inputmode="decimal"'} value="${h(kind === 'num' || kind === 'text' ? x[k] ?? '' : inVal(x[k], kind, job))}" ${extra}>`;
  const stt = (s) => `<span class="st ${s === 'Acceptable' ? 'st-OK' : s === 'Exceeds' ? 'st-below-MRT' : s === 'NDE required' ? 'st-warn' : ''}">${s}</span>`;
  const edgeRows = st.edge.map((x, i) => { const ev = edgeEval(x, S.job); return `<tr class="${ev.status === 'Exceeds' ? 'is-bad' : ev.status === 'NDE required' ? 'is-warn' : ''}"><td><b>E${i + 1}</b></td><td>${ein(x, 'angle', 'num')}</td><td>${ein(x, 'arc', 'big', 'placeholder="opt."')}</td><td>${ein(x, 'R', 'big')}</td><td>${ein(x, 'B', 'small')}</td>
    <td><select data-se="edge" data-eid="${x.id}" data-f="weld" data-kind="text">${WELDS.map(([k, l]) => `<option value="${k}" ${x.weld === k ? 'selected' : ''}>${h(l)}</option>`).join('')}</select></td><td>${x.weld === 'angle' ? ein(x, 'alpha', 'num', 'placeholder="0–90"') : '<span class="muted">—</span>'}</td>
    ${(() => { const cv = edgeCurve(job, +x.R || 0); return `<td>${ein(x, 'Bew', 'small', cv.Bew != null ? `placeholder="${fS(cv.Bew)}"` : '')}</td><td>${ein(x, 'Be', 'small', cv.Be != null ? `placeholder="${fS(cv.Be)}"` : x.weld === 'par' ? 'placeholder="opt."' : '')}</td>`; })()}<td class="n"><b>${ev.allow != null ? fmt(ev.allow, 'small', job, false) : '—'}</b></td><td class="n">${ev.pct != null ? ev.pct.toFixed(0) + '%' : '—'}</td><td title="${h(ev.basis)}">${stt(ev.status)}</td><td>${ein(x, 'notes', 'text', 'class="note"')}</td><td><button aria-label="Remove" class="btn sm icon ghost danger" data-act="se-del" data-k="edge" data-eid="${x.id}" title="Remove">✕</button></td></tr>`; }).join('') || '<tr><td colspan="14" class="empty">No edge settlement recorded.</td></tr>';
  const edgeNotes = [...new Set(st.edge.map((x) => edgeEval(x, S.job).status).filter((s) => s === 'NDE required' || s === 'Exceeds'))].map((s) => `<p class="small"><b>${s}:</b> ${h(EDGE_NOTE[s])}</p>`).join('');
  const depRows = st.dep.map((x, i) => { const ev = depEval(x, job); return `<tr class="${ev.status === 'Exceeds' ? 'is-bad' : ''}"><td><b>D${i + 1}</b></td><td>${din(x, 'angle', 'num')}</td><td>${din(x, 'r', 'big')}</td><td>${din(x, 'R', 'big')}</td><td>${din(x, 'B', 'small')}</td><td class="n"><b>${ev.allow != null ? fmt(ev.allow, 'small', job, false) : '—'}</b></td><td class="n">${ev.pct != null ? ev.pct.toFixed(0) + '%' : '—'}</td><td>${stt(ev.status)}</td><td>${din(x, 'notes', 'text', 'class="note"')}</td><td><button aria-label="Remove" class="btn sm icon ghost danger" data-act="se-del" data-k="dep" data-eid="${x.id}" title="Remove">✕</button></td></tr>`; }).join('') || '<tr><td colspan="10" class="empty">No bottom depressions recorded.</td></tr>';

  return `<section class="card"><div class="sp-head"><h2>Shell settlement survey</h2><span class="muted small">${c.n}/${c.N} stations read · <b class="${stCls}">${c.status}</b></span></div>
    <div class="fgrid g4">${field('Survey date', 'settle.date', 'date')}${field('Surveyed by', 'settle.surveyor')}${field('Instrument', 'settle.instrument', 'text', { ph: 'e.g. level, total station' })}${field('Benchmark', 'settle.benchmark')}
      ${field('Liquid level at survey', 'settle.level', 'text', { ph: 'e.g. empty / 32 ft' })}${field('Number of stations', 'settle.n', 'num', { ph: `${autoN(job)} (API 653)`, hint: `N = D/10 ft, even, ≥ 8, spacing ≤ 32 ft · spacing now ${c.L ? fmt(c.L, 'big', job) : '—'}` })}${field('Station 1 at', 'settle.start', 'num', { unit: '°', ph: '0' })}${field('Reading units', 'settle.eu', 'sel', { options: met ? [['mm', 'mm'], ['m', 'm']] : [['in', 'inches'], ['ft', 'feet (decimal)'], ['mm', 'mm']] })}
      ${field('Readings are rod readings (larger = lower)', 'settle.rod', 'bool')}${field('Shell height H', 'settle.H', 'big', { ph: shH ? fmt(shH, 'big', job, false) + ' (shell courses)' : '' })}
      ${field('Y and E from the shell course 1 material (Table 4.1; E for carbon steel)', 'settle.yeAuto', 'bool', { value: st.yeAuto !== false })}
      ${field('Fold pattern about a diameter (B.2.2.5.3: arc = 50 % of the circumference)', 'settle.fold', 'bool')}
      ${field('Out-of-plane subset — every nth station', 'settle.subStep', 'num', { ph: 'auto', hint: 'B.2.2.4 NOTE: Si / Smax on a subset spaced ≤ 32 ft when extra points are taken' })}${field('B.3.2.2 K value for', 'settle.kRoof', 'sel', { options: [['auto', `Auto — ${kRoofFixed(job) ? 'fixed roof' : 'open top / floating roof'}`], ['open', 'Open top / floating roof'], ['fixed', 'Fixed roof']] })}
      <label class="fld"><span class="lbl">Shell yield strength Y</span><span class="ctl"><input data-sts="Y" inputmode="decimal" value="${st.yeAuto !== false ? '' : stress(st.Y)}" placeholder="${stress(c.Y)}" ${st.yeAuto !== false ? 'disabled' : ''}><i class="unit">${met ? 'MPa' : 'psi'}</i></span><small>${st.yeAuto !== false ? h(c.Ysrc) : '30,000 psi (207 MPa) if unknown'}</small></label>
      <label class="fld"><span class="lbl">Young's modulus E</span><span class="ctl"><input data-sts="E" inputmode="decimal" value="${st.yeAuto !== false ? '' : stress(st.E)}" placeholder="${stress(c.E)}" ${st.yeAuto !== false ? 'disabled' : ''}><i class="unit">${met ? 'MPa' : 'psi'}</i></span><small>Table 4.1: 29,400,000 psi (202,706 MPa)</small></label>
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
  ${edgeSurveyHTML(c)}
  <section class="card"><div class="sp-head"><h2>Other edge settlement areas</h2><span class="muted small">Areas found between stations · API 653 B.2.3 / B.3.4 · tank diameter ${fmt(D, 'big', job)}</span></div>
    <div class="tblwrap"><table class="grid sedge"><thead><tr><th></th><th>Angle (°)</th><th title="Length of the settled area along the shell (drawing only)">Arc (${U.big})</th><th title="Radial width of the settled area from the shell">R (${U.big})</th><th title="Settlement measured per Fig. B.6 / B.7">B (${sU})</th><th>Bottom weld in area</th><th title="Weld angle to the tank radius: 0° = perpendicular to shell, 90° = parallel">α (°)</th><th title="Blank = from the Fig. B.11 table at R">Bew (${sU})</th><th title="Blank = from the Fig. B.12 table at R">Be (${sU})</th><th class="n">Allowable</th><th class="n">B / allow</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>${edgeRows}</tbody></table></div>
    <div class="acts row-acts"><button class="btn sm" data-act="se-add" data-k="edge">+ Edge settlement area</button></div>
    ${edgeNotes}
    <p class="muted small">Measure B from a projection of the unsettled bottom (Fig. B.6; for cone-up / cone-down bottoms follow Fig. B.7), over the radial width R. <b>Bew</b> (Fig. B.11, bottom lap weld within ±20° of parallel to the shell) and <b>Be</b> (Fig. B.12, no weld, butt welds, or lap weld within ±20° of perpendicular) come from the built-in table at R for this tank diameter when left blank (grey). Lap welds at another angle α to the tank radius: B = Be − (Be − Bew)·sin α (B.3.4.4). Any area may be screened against Bew first. At 75 % of the allowable or more, examine the welds by VT and MT/PT (B.3.4.1). The curves assume 1/4 in (6 mm) bottoms and apply to 5/16–3/8 in (8–10 mm).</p>
  </section>
  <section class="card"><div class="sp-head"><h2>Bottom depressions / bulges</h2><span class="muted small">API 653 B.2.5 / B.3.3 · remote from the shell</span></div>
    <div class="tblwrap"><table class="grid sedge"><thead><tr><th></th><th>Angle (°)</th><th>From centre (${U.big})</th><th title="Radius of the inscribed circle of the depression">R (${U.big})</th><th>Depth B (${sU})</th><th class="n">Allowable ${met ? '0.031·R' : '0.37·R'}</th><th class="n">B / allow</th><th>Status</th><th>Notes</th><th></th></tr></thead><tbody>${depRows}</tbody></table></div>
    <div class="acts row-acts"><button class="btn sm" data-act="se-add" data-k="dep">+ Depression / bulge</button></div>
    <p class="muted small">BB = ${met ? '0.031·R (SI form of B.3.3)' : '0.37·R (BB in inches, R in feet; SI form 0.031·R)'} for single-pass lap-welded bottoms, smooth depressions with no sharp creases or buckled welds, and plate meeting the minimum bottom thickness. Check that floating roof supports are not affected.</p>
  </section>`;
}
/** Distance from the shell as 0'-6" / 2'-0" (imperial) or mm. */
function fmtOff(x) {
  if (S.job.units === 'metric') return `${Math.round(x)}`;
  const inch = Math.round((x / 25.4) * 100) / 100;
  if (inch < 12) return `${inch}"`;
  const ft = Math.floor(inch / 12 + 1e-9), r = Math.round((inch - ft * 12) * 100) / 100;
  return `${ft}'-${r}"`;
}

function edgeSurveyHTML(c) {
  const job = S.job, st = job.settle, ep = st.ep, U = u(job), met = job.units === 'metric', sU = U.small;
  const eu = ELEV_UNITS[st.eu] || ELEV_UNITS.in, offs = epOffsets(job), sts = stations(job);
  const fS = (mm) => (mm === null || mm === undefined ? '—' : met ? mm.toFixed(1) : (mm / 25.4).toFixed(2));
  const P = new Map(sts.map((x) => [x.i, profileEval(job, x.i)]));
  if (!S.epSel || !P.has(S.epSel)) S.epSel = (sts.find((x) => P.get(x.i).R > 0) || sts[0])?.i || 1;
  const stt = (s) => `<span class="st ${s === 'Acceptable' ? 'st-OK' : s === 'Exceeds' ? 'st-below-MRT' : s === 'NDE required' ? 'st-warn' : s === 'No edge settlement' ? 'st-OK' : 'st-no-action'}">${s}</span>`;
  const head = sts.map((x) => `<th class="n"><button class="linkbtn${S.epSel === x.i ? ' on' : ''}" data-act="ep-sel" data-i="${x.i}" title="${x.angle.toFixed(1)}° — show profile">${x.i}</button><br><small class="muted">${Math.round(x.angle)}°</small></th>`).join('');
  const rows = offs.map((x) => `<tr><td class="el">${fmtOff(x)}</td>${sts.map((t) => { const v = ep.rd?.[t.i]?.[xKey(x)], p = P.get(t.i), inZ = p.R > 0 && x < p.R - 1e-6; return `<td class="${inZ ? (p.status === 'Exceeds' ? 'bad-cell' : 'zone-cell') : ''}${S.epSel === t.i ? ' selcol' : ''}"><input data-ep="${t.i}" data-x="${xKey(x)}" data-kind="num" ${inZ && p.status === 'Exceeds' ? 'aria-invalid="true" title="Exceeds the allowable" ' : ''}inputmode="decimal" value="${v == null ? '' : +(v / eu[0]).toFixed(eu[2])}"></td>`; }).join('')}</tr>`).join('');
  const sumRow = (lab, fn) => `<tr class="ep-sum"><td class="el">${lab}</td>${sts.map((t) => `<td class="n${S.epSel === t.i ? ' selcol' : ''}">${fn(P.get(t.i))}</td>`).join('')}</tr>`;
  const so = (i) => ep.st?.[i] || {};
  const sel = (i, f, opts, v) => `<select data-eps="${i}" data-f="${f}" data-kind="text">${opts.map(([k, l]) => `<option value="${h(k)}" ${String(v ?? '') === String(k) ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>`;
  const sin = (i, f, kind, ph = '', cls = '') => `<input data-eps="${i}" data-f="${f}" data-kind="${kind}" inputmode="decimal" value="${h(kind === 'small' ? inVal(so(i)[f], 'small', job) : so(i)[f] ?? '')}" placeholder="${h(ph)}" class="${cls}">`;
  const res = sts.map((t) => {
    const p = P.get(t.i), o = so(t.i);
    const rOpts = [['', p.auto && p.R ? `Auto (${fmtOff(p.R)})` : p.auto ? 'Auto (none)' : 'Auto'], ...offs.filter((x) => x > 0).map((x) => [x, fmtOff(x)])];
    return `<tr class="${p.status === 'Exceeds' ? 'is-bad' : p.status === 'NDE required' ? 'is-warn' : ''}${S.epSel === t.i ? ' sel' : ''}"><td><button class="linkbtn" data-act="ep-sel" data-i="${t.i}">${t.i}</button></td><td class="n">${t.angle.toFixed(1)}°</td>
      <td>${sel(t.i, 'Rov', rOpts, o.Rov ?? '')}</td><td class="n"><b>${p.R > 0 ? fS(p.B) : p.status === 'No edge settlement' ? '0' : '—'}</b></td>
      <td>${sel(t.i, 'weld', WELDS, o.weld || 'par')}</td><td>${(o.weld || 'par') === 'angle' ? sin(t.i, 'alpha', 'num', '0–90') : '<span class="muted">—</span>'}</td>
      <td>${sin(t.i, 'Bew', 'small', p.Bew != null && p.BewSrc && p.BewSrc !== 'entered' ? fS(p.Bew) : '')}</td><td>${sin(t.i, 'Be', 'small', p.Be != null && p.BeSrc && p.BeSrc !== 'entered' ? fS(p.Be) : '')}</td>
      <td class="n"><b>${p.ev?.allow != null ? fS(p.ev.allow) : '—'}</b></td><td class="n">${p.ev?.pct != null ? p.ev.pct.toFixed(0) + '%' : '—'}</td><td>${stt(p.status)}</td><td>${sin(t.i, 'notes', 'text', '', 'note')}</td></tr>`;
  }).join('');
  const cur = P.get(S.epSel);
  const curveRows = (st.curve || []).map((r) => `<tr><td><input data-cv="${r.id}" data-f="R" data-kind="big" inputmode="decimal" value="${h(inVal(r.R, 'big', job))}"></td><td><input data-cv="${r.id}" data-f="Bew" data-kind="small" inputmode="decimal" value="${h(inVal(r.Bew, 'small', job))}"></td><td><input data-cv="${r.id}" data-f="Be" data-kind="small" inputmode="decimal" value="${h(inVal(r.Be, 'small', job))}"></td><td><button aria-label="Remove" class="btn sm icon ghost danger" data-act="cv-del" data-cid="${r.id}" title="Remove">✕</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No curve values yet.</td></tr>';
  const nRead = sts.filter((t) => P.get(t.i).n).length, worst = ['Exceeds', 'NDE required'].find((k) => sts.some((t) => P.get(t.i).status === k));
  return `<section class="card ep-card"><div class="sp-head"><h2>Edge settlement survey</h2><span class="muted small">Radial readings inward from the shell at each of the ${sts.length} settlement stations · ${nRead} read${worst ? ` · <b class="${worst === 'Exceeds' ? 'bad' : 'warn-txt'}">${sts.filter((t) => P.get(t.i).status === worst).length} ${worst === 'Exceeds' ? 'exceed allowable' : 'need NDE'}</b>` : ''}</span></div>
    <div class="ep-top">
      <div><h3>Reading spacing (from the shell)</h3>
        <table class="grid epz"><thead><tr><th>From (${sU})</th><th>To (${sU})</th><th>Every (${sU})</th><th></th></tr></thead><tbody>${(ep.zones || []).map((z) => `<tr><td><input data-epz="1" data-zid="${z.id}" data-f="start" data-kind="small" inputmode="decimal" value="${h(inVal(z.start, 'small', job))}"></td><td><input data-epz="1" data-zid="${z.id}" data-f="end" data-kind="small" inputmode="decimal" value="${h(inVal(z.end, 'small', job))}"></td><td><input data-epz="1" data-zid="${z.id}" data-f="step" data-kind="small" inputmode="decimal" value="${h(inVal(z.step, 'small', job))}"></td><td><button aria-label="Remove" class="btn sm icon ghost danger" data-act="epz-del" data-zid="${z.id}" title="Remove">✕</button></td></tr>`).join('')}</tbody></table>
        <div class="acts row-acts"><button class="btn sm" data-act="epz-add">+ Spacing</button>${field('Reading at the shell (0)', 'settle.ep.at0', 'bool', { cls: 'inline-chk' })}</div>
        <div class="fgrid">${field('Breakover tolerance', 'settle.ep.tol', 'small', { hint: 'A reading this far below the unsettled-bottom line starts the settled zone' })}</div>
        <p class="muted small">${offs.length} readings per station: ${offs.map(fmtOff).join(', ')}${met ? ' mm' : ''}. Readings use the same units as the shell survey (${eu[1]}${st.rod ? ', rod readings' : ''}).</p>
      </div>
      <div><h3>Allowable edge settlement for this tank</h3>
        ${field('Bew / Be from', 'settle.curveMode', 'sel', { options: [['api', 'Built-in API 653 Fig. B.11 / B.12 table'], ['manual', 'My own values (enter below)']] })}
        ${(st.curveMode || 'api') === 'api' ? (() => { const Dft = (+job.tank.diameter || 0) / 304.8, Rs = [1.5, 2, 3, 4, 5, 6]; const v = (R, k) => { const a = edgeAllowT(Dft, R); return a[k] == null ? '—' : fS(a[k] * 25.4); }; return `<table class="grid epz"><thead><tr><th>R (ft)</th>${Rs.map((R) => `<th class="n">${R}</th>`).join('')}</tr></thead><tbody><tr><td>Bew (${sU})</td>${Rs.map((R) => `<td class="n">${v(R, 'Bew')}</td>`).join('')}</tr><tr><td>Be (${sU})</td>${Rs.map((R) => `<td class="n">${v(R, 'Be')}</td>`).join('')}</tr></tbody></table>
          <p class="muted small">Values for a ${fmt(+job.tank.diameter || 0, 'big', job)} tank from the tabulated Fig. B.11 (Bew, lap weld ∥ shell) and Fig. B.12 (Be, ⊥ shell / butt / no weld) curves for D = 20–160 ft, interpolated in D and R; 2 in up to R = 1.5 ft; D over 160 ft uses the 160 ft curve; R over 6 ft is beyond the curves (enter values for that station). Values typed in a station row override the table.</p>`; })() : `
        <table class="grid epz"><thead><tr><th>R (${U.big})</th><th>Bew (${sU})</th><th>Be (${sU})</th><th></th></tr></thead><tbody>${curveRows}</tbody></table>
        <div class="acts row-acts"><button class="btn sm" data-act="cv-add">+ R value</button></div>
        ${field('Source', 'settle.curveSrc', 'text', { ph: 'e.g. API 653 5th ed. Add. 3, Fig. B.11 / B.12' })}
        <p class="muted small">Read Bew (Fig. B.11) and Be (Fig. B.12) for a ${fmt(+job.tank.diameter || 0, 'big', job)} tank at a few values of R; the app interpolates them at each station's R. Values typed in a station row override the curve.</p>`}
      </div>
    </div>
    <h3>Readings (${eu[1]})</h3>
    <div class="tblwrap ep-wrap"><table class="grid epgrid"><thead><tr><th>From shell</th>${head}</tr></thead><tbody>${rows}
      ${sumRow('R', (p) => (p.R > 0 ? fmtOff(p.R) : p.status === 'No edge settlement' ? '—' : ''))}${sumRow(`B (${sU})`, (p) => (p.R > 0 ? fS(p.B) : p.status === 'No edge settlement' ? '0' : ''))}${sumRow('Status', (p) => (p.n ? stt(p.status === 'No edge settlement' ? 'None' : p.status === 'NDE required' ? 'NDE' : p.status) : ''))}</tbody></table></div>
    <p class="muted small">Enter goes down the station's readings, then on to the next station. Shaded cells are inside the settled zone (shell to breakover).</p>
    <div class="ep-mid"><div class="prof-box">${profileSVG(job, cur, { fmt: (v) => fS(v), fmtX: fmtOff, fmtR: fmtOff, title: `Station ${cur.i} (${(sts.find((x) => x.i === cur.i)?.angle ?? 0).toFixed(1)}°)`, xLabel: `Distance from shell${met ? ' (mm)' : ''} — bottom profile (solid) and projection of the unsettled bottom (dashed)` })}</div>
      <p class="muted small">The unsettled bottom is the straight line through the outer readings, so a cone-up or cone-down slope is allowed for (Fig. B.7). Walking in toward the shell, the breakover is the last reading within the tolerance of that line; <b>R</b> is its distance from the shell and <b>B</b> is the largest drop of the bottom below the projected line between the shell and the breakover (Fig. B.6). Pick a different breakover in the table if the automatic one is wrong.</p></div>
    <h3>Results by station</h3>
    <div class="tblwrap"><table class="grid sedge epres"><thead><tr><th>Stn</th><th class="n">Angle</th><th>Breakover R</th><th class="n">B (${sU})</th><th>Bottom weld in area</th><th>α (°)</th><th>Bew (${sU})</th><th>Be (${sU})</th><th class="n">Allowable</th><th class="n">B / allow</th><th>Status</th><th>Notes</th></tr></thead><tbody>${res}</tbody></table></div>
    <p class="muted small">Grey values in Bew / Be come from the table / curve above; for angled lap welds α is the weld's angle to the tank radius (≤ 20° → Be, ≥ 70° → Bew, between: B = Be − (Be − Bew)·sin α). NDE required: 75 % of allowable or more — VT and MT/PT of the shell-to-bottom and bottom welds in the area, VT of welds within 12 in (300 mm) of the breakover (B.3.4.1–2).</p>
  </section>`;
}

const H_TXT = (c, job) => (c.H > 0 ? fmt(c.H, 'big', job) : '—');

export function refreshSettle() {
  setTimeout(() => {
    const c = $('#settleBody'); if (!c) return;
    const a = document.activeElement, key = a && c.contains(a) ? focusSel(a) : null, typed = a && a.value !== undefined && a.value !== a.defaultValue ? a.value : null;
    c.innerHTML = settleBodyHTML();
    if (key) { const n = c.querySelector(key); if (n && typed !== null && n.value !== typed) { n.value = typed; n.dataset.restored = '1'; } if (n) { n.focus({ preventScroll: true }); try { if (typed === null) n.select(); else n.setSelectionRange(n.value.length, n.value.length); } catch { /* */ } } }
  }, 0);
}

defineView('settle', viewSettle);

onAction({
  'ep-sel': async (el, id, e, act) => {
    S.epSel = +el.dataset.i; refreshSettle(); return;
  },
  'epz-add': async (el, id, e, act) => {
    { const zs = S.job.settle.ep.zones; const last = zs[zs.length - 1]; const st = +(last?.step) || (S.job.units === 'metric' ? 300 : 304.8); const a = last?.end != null ? +last.end + st : 0; zs.push({ id: uid(), start: a, end: a + st * 4, step: st }); commit(); refreshSettle(); return; }
  },
  'epz-del': async (el, id, e, act) => {
    { const ep = S.job.settle.ep; ep.zones = ep.zones.filter((z) => z.id !== el.dataset.zid); commit(); refreshSettle(); return; }
  },
  'cv-add': async (el, id, e, act) => {
    { const cv = (S.job.settle.curve = S.job.settle.curve || []); const r = { id: uid(), R: null, Bew: null, Be: null }; cv.push(r); commit(); refreshSettle(); setTimeout(() => $(`#settleBody input[data-cv="${r.id}"][data-f="R"]`)?.focus(), 40); return; }
  },
  'cv-del': async (el, id, e, act) => {
    { S.job.settle.curve = S.job.settle.curve.filter((r) => r.id !== el.dataset.cid); commit(); refreshSettle(); return; }
  },
  'se-add': async (el, id, e, act) => {
    { const L = el.dataset.k === 'edge' ? S.job.settle.edge : S.job.settle.dep; const x = el.dataset.k === 'edge' ? newEdge() : newDep(); L.push(x); commit(); refreshSettle(); setTimeout(() => $(`#settleBody input[data-eid="${x.id}"][data-f="angle"]`)?.focus(), 40); return; }
  },
  'se-del': async (el, id, e, act) => {
    { const k = el.dataset.k; S.job.settle[k] = S.job.settle[k].filter((x) => x.id !== el.dataset.eid); commit(); refreshSettle(); return; }
  },
  'st-clear': async (el, id, e, act) => {
    { if (!(await askConfirm('Clear all settlement station readings?', { ok: 'Clear', danger: true }))) return; S.job.settle.el = {}; commit(); refreshSettle(); return; }
  }
});

onChange([
  { order: 20, when: (el, act) => el.matches('[data-ep]'), run: async (el, e, act) => {
    {
    const ep = S.job.settle.ep; ep.rd = ep.rd || {};
    const v = num(el.value), fct = (ELEV_UNITS[S.job.settle.eu] || ELEV_UNITS.in)[0], m = (ep.rd[el.dataset.ep] = ep.rd[el.dataset.ep] || {});
    if (v === null) delete m[el.dataset.x]; else m[el.dataset.x] = v * fct;
    S.epSel = +el.dataset.ep; commit(); refreshSettle(); return;
  }
  } },
  { order: 30, when: (el, act) => el.matches('[data-eps]'), run: async (el, e, act) => {
    {
    const ep = S.job.settle.ep; ep.st = ep.st || {};
    const o = (ep.st[el.dataset.eps] = ep.st[el.dataset.eps] || {}), k = el.dataset.f;
    let v = k === 'Rov' ? (el.value === '' ? null : +el.value) : readInput(el);
    if (['alpha', 'Bew', 'Be'].includes(k) && v !== null && v < 0) { toast('Values can’t be negative.'); return; }
    if (k === 'alpha' && v !== null && v > 90) { toast('Weld angle α is 0–90°.'); return; }
    if (v === null || v === '') delete o[k]; else o[k] = v;
    S.epSel = +el.dataset.eps; commit(); refreshSettle(); return;
  }
  } },
  { order: 40, when: (el, act) => el.matches('[data-epz]'), run: async (el, e, act) => {
    {
    const z = (S.job.settle.ep.zones || []).find((q) => q.id === el.dataset.zid); if (!z) return;
    const v = readInput(el); if (v !== null && v < 0) { toast('Values can’t be negative.'); return; }
    if (el.dataset.f === 'step' && v !== null && v <= 0) { toast('Spacing must be more than 0.'); return; }
    z[el.dataset.f] = v; commit(); refreshSettle(); return;
  }
  } },
  { order: 50, when: (el, act) => el.matches('[data-cv]'), run: async (el, e, act) => {
    {
    const r = (S.job.settle.curve || []).find((q) => q.id === el.dataset.cv); if (!r) return;
    const v = readInput(el); if (v !== null && v < 0) { toast('Values can’t be negative.'); return; }
    r[el.dataset.f] = v; commit(); refreshSettle(); return;
  }
  } },
  { order: 60, when: (el, act) => el.matches('[data-st]'), run: async (el, e, act) => {
    {
    const st = S.job.settle; st.el = st.el || {};
    const v = num(el.value), fct = (ELEV_UNITS[st.eu] || ELEV_UNITS.in)[0];
    if (v === null) delete st.el[el.dataset.st]; else st.el[el.dataset.st] = v * fct;
    commit(); refreshSettle(); return;
  }
  } },
  { order: 70, when: (el, act) => el.matches('[data-sts]'), run: async (el, e, act) => {
    {
    const v = num(el.value); const k = el.dataset.sts;
    S.job.settle[k] = v === null ? null : S.job.units === 'metric' ? v : v / PSI_PER_MPA;
    commit(); refreshSettle(); return;
  }
  } },
  { order: 80, when: (el, act) => el.matches('[data-se]'), run: async (el, e, act) => {
    {
    const L = el.dataset.se === 'edge' ? S.job.settle.edge : S.job.settle.dep;
    const x = L.find((q) => q.id === el.dataset.eid); if (!x) return;
    const k = el.dataset.f; let v = readInput(el);
    if (!['notes', 'weld'].includes(k) && v !== null && v < 0) { toast('Values can’t be negative.'); return; }
    if (k === 'angle' && v !== null) v = ((v % 360) + 360) % 360;
    if (k === 'alpha' && v !== null && v > 90) { toast('Weld angle α is 0–90°.'); return; }
    x[k] = v; commit(); refreshSettle(); return;
  }
  } }
]);

/* Enter moves to the next reading (edge survey: down the station, then the next station; shell survey: next station). */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('input[data-ep]')) {
    e.preventDefault();
    const all = $$('#settleBody input[data-ep]'), order = all.slice().sort((a, b) => (+a.dataset.ep - +b.dataset.ep) || (all.indexOf(a) - all.indexOf(b)));
    const i = order.indexOf(e.target), next = order[e.shiftKey ? i - 1 : i + 1], cur = e.target;
    if (next) { next.focus(); next.select(); } else if (cur.value !== cur.defaultValue) cur.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (e.key === 'Enter' && e.target.matches?.('input[data-st]')) {
    e.preventDefault();
    const inputs = $$('#settleBody input[data-st]'), i = inputs.indexOf(e.target), next = inputs[e.shiftKey ? i - 1 : i + 1];
    const cur = e.target;
    if (next) { next.focus(); next.select(); } // leaving the field fires its change event
    else if (cur.value !== cur.defaultValue) cur.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
});
