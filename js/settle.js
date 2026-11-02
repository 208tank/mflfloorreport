// Tank settlement evaluation to API 653 Annex B.
//  - Shell settlement survey: optimum cosine curve (planar tilt) by least squares, R², out-of-plane
//    deflection Si = Ui − ½(Ui−1 + Ui+1) against Smax = 11·L²·Y / (2·E·H)  (B.2.2.4, B.3.2.1).
//  - Planar tilt: tilt across the diameter and out-of-plumbness at the top of the shell, compared with
//    API 653 §10.5.2.1 (1/100 of shell height, max 5 in) and, for reference, API 650 (1/200).
//  - Edge settlement (B.2.3 / B.3.4): B against Bew (Fig. B.11) / Be (Fig. B.12) read by the inspector,
//    interpolated for lap welds at an angle: B = Be − (Be − Bew)·sin α; 75 % NDE trigger.
//  - Localized bottom depressions remote from the shell (B.3.3): BB = 0.37·R (in, ft).
// All lengths stored in mm. Y and E stored in MPa.
import { polar } from './geometry.js';
import { shellHeight } from './shell.js';

const IN = 25.4, FT = 304.8, DEG = Math.PI / 180;
const uidS = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);
const f = (v) => (Math.round(v * 100) / 100).toString();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const PSI_PER_MPA = 145.0377;
/** Reading units for the survey: [mm per unit, label, decimals]. */
export const ELEV_UNITS = { in: [IN, 'in', 3], ft: [FT, 'ft', 4], mm: [1, 'mm', 1], m: [1000, 'm', 4] };
export const WELDS = [
  ['par', 'Lap weld ∥ shell (±20°) → Bew'],
  ['perp', 'Lap weld ⊥ shell (±20°) → Be'],
  ['none', 'No weld / butt welds → Be'],
  ['angle', 'Lap weld at angle α → interpolate']
];
export const DEP_K = (0.37 * IN) / FT; // BB = 0.37 R (in, ft) → mm per mm (≈ 0.031)

export function defaultSettle(units = 'imperial') {
  return {
    date: '', surveyor: '', instrument: '', benchmark: '', level: '', notes: '',
    n: null, start: 0, eu: units === 'metric' ? 'mm' : 'in', rod: false, el: {},
    Y: units === 'metric' ? 207 : 30000 / PSI_PER_MPA, E: units === 'metric' ? 200000 : 29e6 / PSI_PER_MPA, H: null,
    edge: [], dep: [],
    ep: defaultEP(units), curve: [], curveSrc: ''
  };
}
/** Radial edge-settlement readings at each station: offsets inward from the shell. */
export function defaultEP(units = 'imperial') {
  return {
    at0: true, tol: units === 'metric' ? 3 : IN / 8, rd: {}, st: {},
    zones: units === 'metric'
      ? [{ id: uidS(), start: 150, end: 600, step: 150 }, { id: uidS(), start: 900, end: 3000, step: 300 }]
      : [{ id: uidS(), start: 6 * IN, end: 24 * IN, step: 6 * IN }, { id: uidS(), start: 3 * FT, end: 10 * FT, step: FT }]
  };
}
export function migrateSettle(s, units) {
  const b = defaultSettle(units);
  if (!s) return b;
  return { ...b, ...s, el: s.el || {}, edge: s.edge || [], dep: s.dep || [], curve: s.curve || [], ep: { ...b.ep, ...(s.ep || {}), rd: s.ep?.rd || {}, st: s.ep?.st || {} } };
}
export const newEdge = () => ({ id: uidS(), angle: null, arc: null, R: null, B: null, weld: 'par', alpha: null, Bew: null, Be: null, notes: '' });
export const newDep = () => ({ id: uidS(), angle: null, r: null, R: null, B: null, notes: '' });

export function hasSettle(job) {
  const s = job.settle; if (!s) return false;
  return Object.values(s.el || {}).some((v) => num(v) !== null) || (s.edge || []).length > 0 || (s.dep || []).length > 0 || hasEP(job);
}

/* ------------------------------------------------------------------ stations --- */

/** API 653 B.2.2.1 / 12.5.2: N = D/10 (D in ft) rounded up to an even number, at least 8, spacing ≤ 32 ft. */
export function autoN(job) {
  const D = +job.tank?.diameter || 0;
  if (!(D > 0)) return 8;
  let n = Math.ceil(D / FT / 10 - 1e-9); if (n % 2) n++;
  n = Math.max(8, n);
  while ((Math.PI * D) / n > 32 * FT + 1e-6) n += 2;
  return n;
}
export function stationCount(job) { const n = num(job.settle?.n); return n !== null && n >= 4 ? Math.round(n) : autoN(job); }
export function stations(job) {
  const N = stationCount(job), st = num(job.settle?.start) || 0;
  return Array.from({ length: N }, (_, i) => ({ i: i + 1, angle: (((st + (360 * i) / N) % 360) + 360) % 360 }));
}
export function settleHeight(job) { const H = num(job.settle?.H); return H !== null && H > 0 ? H : shellHeight(job); }

/* --------------------------------------------------------------------- shell ---- */

function solve3(A, b) {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j < 4; j++) M[r][j] -= k * M[c][j]; }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/** Full shell settlement evaluation. Elevations in mm (higher = higher). */
export function settleCalc(job) {
  const s = job.settle || defaultSettle(job.units), D = +job.tank?.diameter || 0, H = settleHeight(job);
  const st = stations(job), N = st.length;
  const pts = st.map((x) => { const v = num(s.el?.[x.i]); return { ...x, raw: v, z: v === null ? null : s.rod ? -v : v }; });
  const have = pts.filter((p) => p.z !== null);
  const L = D > 0 ? (Math.PI * D) / N : null;
  const Y = num(s.Y), E = num(s.E);
  const Smax = L && H > 0 && Y && E ? (11 * L * L * Y) / (2 * E * H) : null;
  const out = { N, pts, n: have.length, D, H, L, Y, E, Smax, fit: null, warnings: [] };
  if (N < 8) out.warnings.push(`Only ${N} stations: API 653 asks for at least 8.`);
  if (L && L > 32 * FT + 1) out.warnings.push(`Station spacing ${(L / FT).toFixed(1)} ft is more than the 32 ft (9.8 m) maximum.`);
  if (have.length < 4) { out.status = have.length ? 'Incomplete' : 'No survey'; return out; }
  if (have.length < N) out.warnings.push(`${N - have.length} of ${N} stations have no reading.`);

  // least squares z = a + b cos θ + c sin θ
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], r = [0, 0, 0];
  for (const p of have) {
    const v = [1, Math.cos(p.angle * DEG), Math.sin(p.angle * DEG)];
    for (let i = 0; i < 3; i++) { r[i] += v[i] * p.z; for (let j = 0; j < 3; j++) A[i][j] += v[i] * v[j]; }
  }
  const sol = solve3(A, r);
  if (!sol) { out.status = 'Incomplete'; out.warnings.push('Stations do not allow a cosine fit.'); return out; }
  const [a, b, c] = sol, fitAt = (deg) => a + b * Math.cos(deg * DEG) + c * Math.sin(deg * DEG);
  const mean = have.reduce((t, p) => t + p.z, 0) / have.length;
  let Syy = 0, SSE = 0;
  for (const p of pts) {
    if (p.z === null) continue;
    p.fit = fitAt(p.angle); p.U = p.z - p.fit;
    Syy += (p.z - mean) ** 2; SSE += p.U ** 2;
  }
  const R2 = Syy > 1e-9 ? (Syy - SSE) / Syy : 1;
  // out-of-plane Si = Ui − ½(Ui−1 + Ui+1), neighbours around the circle
  let maxS = null, maxAt = null;
  pts.forEach((p, i) => {
    const pr = pts[(i - 1 + N) % N], nx = pts[(i + 1) % N];
    if (p.U === undefined || pr.U === undefined || nx.U === undefined) { p.S = null; return; }
    p.S = p.U - 0.5 * (pr.U + nx.U);
    if (maxS === null || Math.abs(p.S) > Math.abs(maxS)) { maxS = p.S; maxAt = p.i; }
    p.ok = Smax !== null ? Math.abs(p.S) <= Smax + 1e-9 : null;
  });
  const amp = Math.hypot(b, c), hiDeg = ((Math.atan2(c, b) / DEG) % 360 + 360) % 360, loDeg = (hiDeg + 180) % 360;
  const tilt = 2 * amp, slope = D > 0 ? tilt / D : null, plumb = slope !== null && H > 0 ? slope * H : null;
  const plumbLim = H > 0 ? Math.min(H / 100, 5 * IN) : null, plumb650 = H > 0 ? H / 200 : null;
  const zs = have.map((p) => p.z), diff = Math.max(...zs) - Math.min(...zs);
  out.fit = { a, b, c, fitAt, R2, amp, hiDeg, loDeg, tilt, slope, plumb, plumbLim, plumb650, maxS, maxAt, diff, mean };
  out.valid = R2 >= 0.9 - 1e-9;
  if (!out.valid) out.warnings.push(`R² = ${R2.toFixed(3)} is below 0.90: the cosine fit is not valid for the out-of-plane check (B.2.2.4). Take more readings, use a rigorous fit, or evaluate by B.3.2.2 / an engineer.`);
  out.oopOk = Smax === null || maxS === null ? null : out.valid ? Math.abs(maxS) <= Smax + 1e-9 : null;
  out.tiltOk = plumb === null ? null : plumb <= plumbLim + 1e-9;
  out.status = out.oopOk === false || out.tiltOk === false ? 'Not acceptable'
    : !out.valid ? 'Engineering evaluation required'
      : out.oopOk === null || out.tiltOk === null || have.length < N ? 'Incomplete' : 'Acceptable';
  return out;
}

/** Slope as "1 : n" and in per 10 ft / mm per m. */
export function slopeText(slope, job) {
  if (!(slope > 0)) return '—';
  const r = 1 / slope;
  return job.units === 'metric' ? `1 : ${Math.round(r)} (${(slope * 1000).toFixed(1)} mm/m)` : `1 : ${Math.round(r)} (${(slope * 120).toFixed(2)} in per 10 ft)`;
}

/* ---------------------------------------------------------------------- edge ---- */

export function edgeEval(e) {
  const B = num(e.B), Be = num(e.Be), Bew = num(e.Bew), w = e.weld || 'par';
  let allow = null, basis = '';
  if (w === 'par') { allow = Bew; basis = 'Bew (Fig. B.11)'; }
  else if (w === 'angle') {
    const al = num(e.alpha);
    if (Be !== null && Bew !== null && al !== null) { allow = Be - (Be - Bew) * Math.sin(Math.min(90, Math.max(0, al)) * DEG); basis = `Be − (Be − Bew)·sin ${al}° (B.3.4.4)`; }
  } else { allow = Be; basis = 'Be (Fig. B.12)'; }
  // screening: every area may first be checked against Bew (the lower curve)
  if (allow === null && Bew !== null && B !== null && B <= Bew + 1e-9) { allow = Bew; basis = 'Bew screening (B.3.4)'; }
  if (B === null || allow === null || !(allow > 0)) return { B, allow, basis, pct: null, status: 'Incomplete' };
  const pct = (B / allow) * 100;
  const status = B > allow + 1e-9 ? 'Exceeds' : pct >= 75 - 1e-9 ? 'NDE required' : 'Acceptable';
  return { B, allow, basis, pct, status };
}
export const EDGE_NOTE = {
  'Acceptable': 'Within allowable.',
  'NDE required': 'Over 75 % of allowable: examine shell-to-bottom and bottom welds in the settled area visually and by MT or PT, and welds within 12 in (300 mm) of the breakover visually (B.3.4.1–2).',
  'Exceeds': 'Over allowable: repair (re-level / replace bottom) or rigorous engineering evaluation (B.3.4, B.4).',
  'Incomplete': 'Enter B, R and the allowable read from Fig. B.11 / B.12.'
};

export function depEval(d) {
  const B = num(d.B), R = num(d.R);
  if (B === null || R === null || !(R > 0)) return { B, allow: null, pct: null, status: 'Incomplete' };
  const allow = DEP_K * R, pct = (B / allow) * 100;
  return { B, allow, pct, status: B > allow + 1e-9 ? 'Exceeds' : 'Acceptable' };
}

/** Overall settlement result for summaries. */
export function settleSummary(job) {
  const c = settleCalc(job), s = job.settle || {};
  const ed = [...(s.edge || []).map(edgeEval), ...stations(job).map((x) => profileEval(job, x.i).ev).filter(Boolean)], dp = (s.dep || []).map(depEval);
  const bad = c.status === 'Not acceptable' || ed.some((x) => x.status === 'Exceeds') || dp.some((x) => x.status === 'Exceeds');
  const nde = ed.some((x) => x.status === 'NDE required');
  return { c, ed, dp, bad, nde };
}

/* --------------------------------------------------- radial edge-settlement survey --- */

export const xKey = (x) => (Math.round(x * 10) / 10).toFixed(1);
/** Offsets from the shell (mm), from the spacing zones, nearest the shell first. */
export function epOffsets(job) {
  const ep = job.settle?.ep || defaultEP(job.units), set = new Map();
  if (ep.at0) set.set(xKey(0), 0);
  for (const z of ep.zones || []) {
    const a = num(z.start), b = num(z.end), st = num(z.step);
    if (a === null || a < 0) continue;
    if (b === null || !(st > 0) || b < a) { set.set(xKey(a), a); continue; }
    for (let x = a, k = 0; x <= b + 1e-6 && k < 200; x = a + st * ++k) set.set(xKey(x), x);
  }
  return [...set.values()].sort((p, q) => p - q);
}
export function hasEP(job) { return Object.values(job.settle?.ep?.rd || {}).some((m) => Object.values(m || {}).some((v) => num(v) !== null)); }

/** Linear interpolation of the allowable curve (Fig. B.11 / B.12 values entered for this tank) at R. */
export function curveAt(job, R, key) {
  const rows = (job.settle?.curve || []).filter((r) => num(r.R) !== null && num(r[key]) !== null).map((r) => [+r.R, +r[key]]).sort((a, b) => a[0] - b[0]);
  if (!rows.length || !(R > 0)) return null;
  if (R < rows[0][0] - 1e-6 || R > rows[rows.length - 1][0] + 1e-6) return rows.length === 1 && Math.abs(R - rows[0][0]) < 1e-6 ? rows[0][1] : null;
  for (let i = 0; i < rows.length - 1; i++) {
    const [r0, v0] = rows[i], [r1, v1] = rows[i + 1];
    if (R >= r0 - 1e-6 && R <= r1 + 1e-6) return r1 - r0 < 1e-9 ? v0 : v0 + ((R - r0) / (r1 - r0)) * (v1 - v0);
  }
  return rows[rows.length - 1][1];
}
function lineFit(pts) {
  const n = pts.length; if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0; for (const p of pts) { sx += p.x; sy += p.z; sxx += p.x * p.x; sxy += p.x * p.z; }
  const d = n * sxx - sx * sx; if (Math.abs(d) < 1e-9) return null;
  const m = (n * sxy - sx * sy) / d, q = (sy - m * sx) / n;
  return { m, q, at: (x) => q + m * x };
}

/**
 * Evaluate the radial profile at station i. The unsettled bottom is the straight line fitted through the
 * outer readings (so a cone-up / cone-down slope is allowed for, Fig. B.7); walking inward, the breakover
 * is the last reading within the tolerance of that line. R = breakover distance from the shell;
 * B = largest drop of the bottom below the projected line between the shell and the breakover (Fig. B.6).
 */
export function profileEval(job, i) {
  const s = job.settle || {}, ep = s.ep || {}, m = ep.rd?.[i] || {}, so = ep.st?.[i] || {};
  const pts = epOffsets(job).map((x) => { const v = num(m[xKey(x)]); return v === null ? null : { x, z: s.rod ? -v : v }; }).filter(Boolean);
  const out = { i, pts, n: pts.length, R: null, B: null, xB: null, line: null, auto: true, ev: null, status: pts.length ? 'Incomplete' : 'No readings' };
  if (pts.length < 3) return out;
  const tol = num(ep.tol) ?? IN / 8, desc = pts.slice().sort((a, b) => b.x - a.x);
  let R = null, line = null;
  const Rov = num(so.Rov);
  if (Rov !== null) {
    out.auto = false; R = Rov;
    line = lineFit(desc.filter((p) => p.x >= R - 1e-6));
  } else {
    let inc = desc.slice(0, 2); line = lineFit(inc);
    for (let k = 2; k < desc.length && line; k++) {
      const p = desc[k];
      if (line.at(p.x) - p.z > tol + 1e-9) { R = inc[inc.length - 1].x; break; }
      inc = [...inc, p]; line = lineFit(inc);
    }
  }
  if (!line) return out;
  out.line = line;
  let B = 0, xB = null;
  for (const p of pts) { if (R !== null && p.x >= R - 1e-6) continue; const d = line.at(p.x) - p.z; if (d > B) { B = d; xB = p.x; } }
  out.dev = Math.max(0, ...pts.map((p) => line.at(p.x) - p.z));
  if (R === null || !(R > 0)) { out.R = null; out.B = 0; out.status = 'No edge settlement'; return out; }
  out.R = R; out.B = B; out.xB = xB;
  const Bew = num(so.Bew) ?? curveAt(job, R, 'Bew'), Be = num(so.Be) ?? curveAt(job, R, 'Be');
  out.Bew = Bew; out.Be = Be; out.BewSrc = num(so.Bew) !== null ? 'entered' : Bew !== null ? 'curve' : null; out.BeSrc = num(so.Be) !== null ? 'entered' : Be !== null ? 'curve' : null;
  out.ev = edgeEval({ B, Bew, Be, weld: so.weld || 'par', alpha: so.alpha });
  out.status = out.ev.status;
  return out;
}

/** Radial profile chart for one station. */
export function profileSVG(job, P, opts = {}) {
  const small = !!opts.small, W = small ? 300 : 640, H = small ? 170 : 260, ml = small ? 34 : 56, mr = 10, mt = small ? 20 : 26, mb = small ? 24 : 36;
  const fm = opts.fmt || ((v) => (v / IN).toFixed(2)), fx = opts.fmtX || ((x) => (x / FT).toFixed(1));
  const o = [`<svg class="profsvg${small ? ' sm' : ''}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-size="${small ? 9.5 : 12}">`];
  const title = `${opts.title || 'Station ' + P.i}${P.R ? ` — R ${opts.fmtR ? opts.fmtR(P.R) : fx(P.R)}, B ${fm(P.B)}` : P.status === 'No edge settlement' ? ' — no edge settlement' : ''}`;
  o.push(`<text x="${ml}" y="${small ? 12 : 15}" class="pf-title${P.status === 'Exceeds' ? ' bad' : P.status === 'NDE required' ? ' warn' : ''}">${esc(title)}</text>`);
  if (P.pts.length < 2) { o.push(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="sc-empty">No readings</text></svg>`); return o.join(''); }
  const xMax = Math.max(...P.pts.map((p) => p.x)) || 1, ref = P.line ? P.line.at(0) : P.pts[0].z;
  const rel = (z) => z - ref, ys = P.pts.map((p) => rel(p.z)); if (P.line) ys.push(rel(P.line.at(0)), rel(P.line.at(xMax)));
  let lo = Math.min(...ys), hi = Math.max(...ys); const pad = (hi - lo) * 0.15 || IN / 4; lo -= pad; hi += pad;
  const X = (x) => ml + (x / xMax) * (W - ml - mr), Y = (v) => mt + (H - mt - mb) - ((v - lo) / (hi - lo)) * (H - mt - mb);
  o.push(`<rect x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H - mt - mb}" class="sc-frame"/>`);
  o.push(`<line x1="${ml}" x2="${ml}" y1="${mt - 4}" y2="${H - mb}" class="pf-shell"/>`);
  const stp = niceStep((hi - lo) / (small ? 3 : 5));
  for (let v = Math.ceil(lo / stp) * stp; v <= hi; v += stp) o.push(`<line x1="${ml}" x2="${W - mr}" y1="${f(Y(v))}" y2="${f(Y(v))}" class="sc-grid"/><text x="${ml - 4}" y="${f(Y(v) + 3)}" text-anchor="end" class="sc-ax">${fm(v)}</text>`);
  { // x labels, skipping any that would overlap the previous one (always keep the shell and the last reading)
    const gapPx = small ? 26 : 38, xs = P.pts.map((p) => p.x).sort((a, b) => a - b), last = xs[xs.length - 1];
    let prev = -1e9;
    for (const x of xs) {
      const px = X(x); if (x !== last && px - prev < gapPx) continue;
      if (x === last && px - prev < gapPx * 1.5 && prev > -1e8) o.pop();
      o.push(`<text x="${f(px)}" y="${H - mb + (small ? 11 : 14)}" text-anchor="${x === last ? 'end' : x === 0 ? 'start' : 'middle'}" class="sc-ax">${fx(x)}</text>`); prev = px;
    }
  }
  if (P.line) o.push(`<line x1="${f(X(0))}" y1="${f(Y(rel(P.line.at(0))))}" x2="${f(X(xMax))}" y2="${f(Y(rel(P.line.at(xMax))))}" class="pf-proj"/>`);
  if (P.R) o.push(`<line x1="${f(X(P.R))}" x2="${f(X(P.R))}" y1="${mt}" y2="${H - mb}" class="sc-low"/><text x="${f(X(P.R) + 3)}" y="${mt + (small ? 9 : 12)}" class="sc-lowt">R</text>`);
  o.push(`<polyline points="${P.pts.map((p) => `${f(X(p.x))},${f(Y(rel(p.z)))}`).join(' ')}" class="pf-bot"/>`);
  for (const p of P.pts) o.push(`<circle cx="${f(X(p.x))}" cy="${f(Y(rel(p.z)))}" r="${small ? 2.2 : 3.2}" class="sc-pt${P.R && p.x < P.R - 1e-6 && P.status === 'Exceeds' ? ' bad' : ''}"/>`);
  if (P.R && P.xB !== null && P.B > 0) { const x = X(P.xB); o.push(`<line x1="${f(x + 4)}" x2="${f(x + 4)}" y1="${f(Y(rel(P.line.at(P.xB))))}" y2="${f(Y(rel(P.line.at(P.xB) - P.B)))}" class="pf-b"/><text x="${f(x + 7)}" y="${f((Y(rel(P.line.at(P.xB))) + Y(rel(P.line.at(P.xB) - P.B))) / 2 + 3)}" class="pf-bt">B</text>`); }
  if (!small) o.push(`<text x="${(ml + W - mr) / 2}" y="${H - 4}" text-anchor="middle" class="sc-ax">${esc(opts.xLabel || 'Distance from shell')}</text>`);
  o.push('</svg>');
  return o.join('');
}

/* ------------------------------------------------------------------- drawings --- */

/**
 * Two-panel chart: measured elevations and the optimum cosine curve (relative to the mean plane
 * elevation), and the out-of-plane deflection S with ±Smax.
 * opts.fmt(mm) → short string in small units; opts.unit label.
 */
export function settleChartSVG(job, c, opts = {}) {
  const W = 900, Hh = 470, ml = 64, mr = 18, top = 30, h1 = 220, gap = 52, h2 = 120;
  const fm = opts.fmt || ((v) => (v / IN).toFixed(2)), unit = opts.unit || 'in';
  const X = (deg) => ml + (deg / 360) * (W - ml - mr);
  const o = [`<svg class="setchart" viewBox="0 0 ${W} ${Hh}" xmlns="http://www.w3.org/2000/svg" font-size="12">`];
  if (!c.fit) { o.push(`<text x="${W / 2}" y="${Hh / 2}" text-anchor="middle" class="sc-empty" font-size="15">Enter at least 4 station readings to fit the cosine curve</text></svg>`); return o.join(''); }
  const F = c.fit, rel = (z) => z - F.a;
  const pts = c.pts.filter((p) => p.z !== null).sort((p, q) => p.angle - q.angle);
  const vals = [...pts.map((p) => rel(p.z)), F.amp, -F.amp];
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * 0.12 || 5; lo -= pad; hi += pad;
  const Y1 = (v) => top + h1 - ((v - lo) / (hi - lo)) * h1;
  const step = niceStep((hi - lo) / 5);
  // panel 1 frame + grid
  o.push(`<rect x="${ml}" y="${top}" width="${W - ml - mr}" height="${h1}" class="sc-frame"/>`);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) o.push(`<line x1="${ml}" x2="${W - mr}" y1="${f(Y1(v))}" y2="${f(Y1(v))}" class="sc-grid${Math.abs(v) < step / 1e3 ? ' zero' : ''}"/><text x="${ml - 6}" y="${f(Y1(v) + 4)}" text-anchor="end" class="sc-ax">${fm(v)}</text>`);
  for (let a = 0; a <= 360; a += 45) o.push(`<line x1="${f(X(a))}" x2="${f(X(a))}" y1="${top}" y2="${top + h1}" class="sc-grid"/>`);
  // cosine curve
  const cp = []; for (let a = 0; a <= 360; a += 2) cp.push(`${f(X(a))},${f(Y1(rel(F.fitAt(a))))}`);
  o.push(`<polyline points="${cp.join(' ')}" class="sc-fit"/>`);
  // measured (closed loop: wrap the first station to 360)
  const mp = pts.map((p) => `${f(X(p.angle))},${f(Y1(rel(p.z)))}`); if (pts[0] && pts[0].angle < 1e-6) mp.push(`${f(X(360))},${f(Y1(rel(pts[0].z)))}`);
  o.push(`<polyline points="${mp.join(' ')}" class="sc-meas"/>`);
  for (const p of pts) o.push(`<circle cx="${f(X(p.angle))}" cy="${f(Y1(rel(p.z)))}" r="4" class="sc-pt${p.ok === false ? ' bad' : ''}"/><text x="${f(X(p.angle))}" y="${top - 8}" text-anchor="middle" class="sc-st">${p.i}</text>`);
  o.push(`<text x="${ml}" y="${top - 18}" class="sc-title" font-size="12.5" dy="-2">Elevation relative to the mean plane (${unit}) — measured ● and optimum cosine curve</text>`);
  o.push(`<text x="14" y="${top + h1 / 2}" transform="rotate(-90 14 ${top + h1 / 2})" text-anchor="middle" class="sc-ax">${unit}</text>`);
  // low side marker
  o.push(`<line x1="${f(X(F.loDeg))}" x2="${f(X(F.loDeg))}" y1="${top}" y2="${top + h1}" class="sc-low"/><text x="${f(X(F.loDeg) + 4)}" y="${top + h1 - 6}" class="sc-lowt">low side ${F.loDeg.toFixed(0)}°</text>`);
  // panel 2: S
  const t2 = top + h1 + gap, Sv = pts.map((p) => p.S).filter((v) => v !== null && v !== undefined);
  const lim = c.Smax || 0, m2 = Math.max(lim, ...Sv.map(Math.abs), 1) * 1.2;
  const Y2 = (v) => t2 + h2 / 2 - (v / m2) * (h2 / 2);
  o.push(`<rect x="${ml}" y="${t2}" width="${W - ml - mr}" height="${h2}" class="sc-frame"/>`);
  o.push(`<line x1="${ml}" x2="${W - mr}" y1="${f(Y2(0))}" y2="${f(Y2(0))}" class="sc-grid zero"/>`);
  for (let a = 0; a <= 360; a += 45) o.push(`<line x1="${f(X(a))}" x2="${f(X(a))}" y1="${t2}" y2="${t2 + h2}" class="sc-grid"/><text x="${f(X(a))}" y="${t2 + h2 + 16}" text-anchor="middle" class="sc-ax">${a}°</text>`);
  if (lim) for (const sg of [1, -1]) o.push(`<line x1="${ml}" x2="${W - mr}" y1="${f(Y2(sg * lim))}" y2="${f(Y2(sg * lim))}" class="sc-lim"/><text x="${W - mr - 4}" y="${f(Y2(sg * lim) - 4)}" text-anchor="end" class="sc-limt">${sg > 0 ? '+' : '−'}Smax ${fm(lim)}</text>`);
  const bw = Math.min(18, ((W - ml - mr) / c.N) * 0.4);
  for (const p of pts) {
    if (p.S === null || p.S === undefined) continue;
    const y0 = Y2(0), y1 = Y2(p.S);
    o.push(`<rect x="${f(X(p.angle) - bw / 2)}" y="${f(Math.min(y0, y1))}" width="${f(bw)}" height="${f(Math.max(1, Math.abs(y1 - y0)))}" class="sc-bar${p.ok === false ? ' bad' : ''}"/>`);
  }
  o.push(`<text x="${ml}" y="${t2 - 10}" class="sc-title" font-size="12.5">Out-of-plane deflection S = U − ½(U<tspan font-size="9" dy="3">i−1</tspan><tspan dy="-3"> + U</tspan><tspan font-size="9" dy="3">i+1</tspan><tspan dy="-3">) (${unit})</tspan></text>`);
  o.push(`<text x="${f((ml + W - mr) / 2)}" y="${Hh - 4}" text-anchor="middle" class="sc-ax">Angle around the shell (clockwise from 0°)</text>`);
  o.push('</svg>');
  return o.join('');
}
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/** Plan view: stations with elevation relative to the mean plane, tilt direction, edge settlement and depressions. */
export function settlePlanSVG(job, c, opts = {}) {
  const D = +job.tank?.diameter || 0;
  if (!(D > 0)) return '<svg class="setplan" viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg"><text x="200" y="100" text-anchor="middle" class="sc-empty" font-size="14">Enter the tank diameter in Tank setup</text></svg>';
  const R = D / 2, s = R / 100, M = R * 0.34, fm = opts.fmt || ((v) => (v / IN).toFixed(2));
  const zero = job.info?.zeroRef || 'N';
  const o = [`<svg class="setplan" viewBox="${f(-R - M)} ${f(-R - M)} ${f(2 * (R + M))} ${f(2 * (R + M))}" xmlns="http://www.w3.org/2000/svg">`];
  o.push(`<circle r="${f(R)}" class="sp-shell" stroke-width="${f(s * 0.8)}"/>`);
  for (let a = 0; a < 360; a += 30) { const [x1, y1] = polar(R, a), [x2, y2] = polar(R * 1.04, a), [tx, ty] = polar(R * 1.24, a); o.push(`<line x1="${f(x1)}" y1="${f(-y1)}" x2="${f(x2)}" y2="${f(-y2)}" class="sp-tick" stroke-width="${f(s * 0.4)}"/>${a % 90 === 0 ? `<text x="${f(tx)}" y="${f(-ty)}" font-size="${f(s * 5.6)}" text-anchor="middle" dominant-baseline="central" class="sp-ang${a === 0 ? ' z' : ''}">${a === 0 ? `0° ${esc(zero)}` : a + '°'}</text>` : ''}`); }
  // depressions
  for (const [i, d] of (job.settle?.dep || []).entries()) {
    const a = num(d.angle), r = num(d.r), rr = num(d.R); if (a === null || r === null || !(rr > 0)) continue;
    const [x, y] = polar(r, a), ev = depEval(d);
    o.push(`<g class="sp-dep${ev.status === 'Exceeds' ? ' bad' : ''}"><circle cx="${f(x)}" cy="${f(-y)}" r="${f(rr)}" stroke-width="${f(s * 0.5)}" stroke-dasharray="${f(s * 1.5)} ${f(s)}"/><text x="${f(x)}" y="${f(-y)}" font-size="${f(s * 5)}" text-anchor="middle" dominant-baseline="central">D${i + 1}</text></g>`);
  }
  // edge settlement areas
  for (const [i, e] of (job.settle?.edge || []).entries()) {
    const a = num(e.angle), w = num(e.R); if (a === null || !(w > 0)) continue;
    const arc = num(e.arc), half = arc > 0 ? (arc / (Math.PI * D)) * 180 : 4, Ri = Math.max(0, R - w);
    const p = [polar(R, a - half), polar(R, a + half), polar(Ri, a + half), polar(Ri, a - half)];
    const ev = edgeEval(e), [lx, ly] = polar(Ri - s * 6, a);
    o.push(`<g class="sp-edge ${ev.status === 'Exceeds' ? 'bad' : ev.status === 'NDE required' ? 'warn' : ''}"><path d="M${f(p[0][0])} ${f(-p[0][1])}A${f(R)} ${f(R)} 0 0 1 ${f(p[1][0])} ${f(-p[1][1])}L${f(p[2][0])} ${f(-p[2][1])}A${f(Ri)} ${f(Ri)} 0 0 0 ${f(p[3][0])} ${f(-p[3][1])}Z" stroke-width="${f(s * 0.4)}"/><text x="${f(lx)}" y="${f(-ly)}" font-size="${f(s * 5)}" text-anchor="middle" dominant-baseline="central">E${i + 1}</text></g>`);
  }
  // radial survey results at stations
  for (const st of stations(job)) {
    const P = profileEval(job, st.i); if (!(P.R > 0)) continue;
    const Ri = Math.max(0, R - P.R), a = st.angle, half = 3.2;
    const p = [polar(R, a - half), polar(R, a + half), polar(Ri, a + half), polar(Ri, a - half)];
    o.push(`<g class="sp-edge ${P.status === 'Exceeds' ? 'bad' : P.status === 'NDE required' ? 'warn' : ''}"><path d="M${f(p[0][0])} ${f(-p[0][1])}A${f(R)} ${f(R)} 0 0 1 ${f(p[1][0])} ${f(-p[1][1])}L${f(p[2][0])} ${f(-p[2][1])}A${f(Ri)} ${f(Ri)} 0 0 0 ${f(p[3][0])} ${f(-p[3][1])}Z" stroke-width="${f(s * 0.4)}"/></g>`);
  }
  // tilt arrow (towards the low side)
  if (c.fit && c.fit.amp > 0.01) {
    const L = R * 0.55, [x, y] = polar(L, c.fit.loDeg), [bx, by] = polar(-L, c.fit.loDeg);
    const [h1x, h1y] = polar(L - s * 7, c.fit.loDeg - 4), [h2x, h2y] = polar(L - s * 7, c.fit.loDeg + 4), [tx, ty] = polar(L * 0.55, c.fit.loDeg + 12);
    o.push(`<g class="sp-tilt"><line x1="${f(bx)}" y1="${f(-by)}" x2="${f(x)}" y2="${f(-y)}" stroke-width="${f(s * 0.9)}"/><path d="M${f(x)} ${f(-y)}L${f(h1x)} ${f(-h1y)}L${f(h2x)} ${f(-h2y)}Z"/><text x="${f(tx)}" y="${f(-ty)}" font-size="${f(s * 5.4)}" text-anchor="middle" dominant-baseline="central">low ${c.fit.loDeg.toFixed(0)}°</text></g>`);
  }
  // stations
  for (const p of c.pts) {
    const [x, y] = polar(R, p.angle), [nx, ny] = polar(R * 1.12, p.angle), [vx, vy] = polar(R * 0.84, p.angle);
    o.push(`<g class="sp-st${p.ok === false ? ' bad' : p.z === null ? ' empty' : ''}"><circle cx="${f(x)}" cy="${f(-y)}" r="${f(s * 2.6)}" stroke-width="${f(s * 0.4)}"/><text x="${f(nx)}" y="${f(-ny)}" font-size="${f(s * 5.6)}" text-anchor="middle" dominant-baseline="central" class="sp-n">${p.i}</text>${p.z !== null && c.fit ? `<text x="${f(vx)}" y="${f(-vy)}" font-size="${f(s * 4.6)}" text-anchor="middle" dominant-baseline="central" class="sp-v">${(p.z - c.fit.a >= 0 ? '+' : '') + fm(p.z - c.fit.a)}</text>` : ''}</g>`);
  }
  o.push('</svg>');
  return o.join('');
}

export const SETTLE_SVG_STYLE = `.setchart text,.setplan text{font-family:system-ui,Arial,sans-serif}.sc-frame{fill:none;stroke:#3a434e}.sc-grid{stroke:#d9dde3}.sc-grid.zero{stroke:#66707c}.sc-ax{fill:#3a434e}.sc-title{fill:#1d232b;font-weight:700}.sc-st{fill:#0f766e;font-weight:700}.sc-fit{fill:none;stroke:#0f766e;stroke-width:2}.sc-meas{fill:none;stroke:#1d232b;stroke-width:1.2;stroke-dasharray:4 3}.sc-pt{fill:#1d232b}.sc-pt.bad,.sc-bar.bad{fill:#b91c1c}.sc-bar{fill:#0f766e}.sc-lim{stroke:#b91c1c;stroke-dasharray:6 4}.sc-limt{fill:#b91c1c}.sc-low{stroke:#a16207;stroke-dasharray:3 3}.sc-lowt{fill:#a16207}.sp-shell{fill:#fff;stroke:#1d232b}.sp-tick{stroke:#3a434e}.sp-ang{fill:#66707c}.sp-ang.z{fill:#1d232b;font-weight:700}.sp-st circle{fill:#0f766e;stroke:#0f766e}.sp-st.bad circle{fill:#b91c1c;stroke:#b91c1c}.sp-st.empty circle{fill:#fff;stroke:#66707c}.sp-n{fill:#1d232b;font-weight:700}.sp-v{fill:#3a434e}.sp-tilt line{stroke:#a16207}.sp-tilt path{fill:#a16207}.sp-tilt text{fill:#a16207;font-weight:700}.sp-edge path{fill:#d5efec;stroke:#0f766e}.sp-edge.warn path{fill:#fdf3d7;stroke:#a16207}.sp-edge.bad path{fill:#fde8e8;stroke:#b91c1c}.sp-edge text,.sp-dep text{fill:#1d232b;font-weight:700}.sp-dep circle{fill:none;stroke:#0f766e}.sp-dep.bad circle{stroke:#b91c1c}.pf-title{fill:#1d232b;font-weight:700}.pf-title.bad{fill:#b91c1c}.pf-title.warn{fill:#a16207}.pf-shell{stroke:#1d232b;stroke-width:3}.pf-proj{stroke:#0f766e;stroke-dasharray:5 4;stroke-width:1.4}.pf-bot{fill:none;stroke:#1d232b;stroke-width:1.6}.pf-b{stroke:#b91c1c;stroke-width:1.6}.pf-bt{fill:#b91c1c;font-weight:700}`;
