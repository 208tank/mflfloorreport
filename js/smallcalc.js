// Small tank report calculations (stage S2). No browser APIs: the tests and the hand check run it in Node.
//
//  - Thickness and corrosion rates per component (floor, shell, fixed roof):
//      CR = (T-nom − T-act) / years,  RL = (T-act − T-min) / CR   ("30 +" when CR = 0 or RL > 30).
//    The floor uses the API 653 §4.4.5 evaluation the app already makes: T-act = RT, CR = StPr + UPr,
//    T-min = the governing area's limit, RL = the largest Or it allows (§4.4.5.1), as found and after repairs.
//  - Inspection intervals: API 653 §6.3.2.1 (external: lesser of 5 years and RCA / 4N), §6.3.3.2 (UT: 5 years
//    when the rate is not known, else the lesser of 15 years and RCA / 2N), §6.4.2 (internal: the floor Or from
//    §4.4.5, not over 20 years, 30 with a release prevention barrier, §6.4.2.2.1). Or API 12R1 maximum intervals
//    entered by the user. "Recommendations completed" uses the floor repairs; "not completed" the floor as found.
//  - Settlement: the small-tank planar method (four stations), API 653 Annex B (the full survey), or entered
//    API 12R1 limits; edge settlement against an entered limit or Annex B (Fig. B.11 table).
// Clause numbers only: no standards text is reproduced. API 12R1 values come from the user's own copy.
import { api653, minT } from './calc.js';
import { courseSummary } from './shell.js';
import { hasFixed } from './roof.js';
import { settleCalc, settleYE, settleHeight, edgeEval, edgeCurve, hasSettle } from './settle.js';
import { defaultSmall, COMPASS } from './small.js';

const IN = 25.4, DEG = Math.PI / 180;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);
const RL_CAP = 30;

/** Years to show for the remaining life: '30 +' when there is no loss or it is over 30 years. */
export const rlText = (rl, cr) => (cr === 0 || (rl !== null && rl > RL_CAP) ? '30 +' : rl === null ? '—' : String(Math.max(0, Math.round(rl * 10) / 10)));

/** A date `years` after an ISO date (to the day). */
export function addYears(iso, years) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) || !(years >= 0)) return '';
  const [y, m, d] = iso.split('-').map(Number), whole = Math.floor(years), rest = years - whole;
  const t = new Date(Date.UTC(y + whole, m - 1, d));
  t.setUTCDate(t.getUTCDate() + Math.round(rest * 365.25));
  return t.toISOString().slice(0, 10);
}

/** CR and RL from thicknesses and years. Missing inputs give nulls; CR below 0 (thicker than nominal) is 0. */
export function rateLife(tNom, tAct, years, tMin) {
  const cr = tNom !== null && tAct !== null && years > 0 ? Math.max(0, (tNom - tAct) / years) : null;
  const rca = tAct !== null && tMin !== null ? tAct - tMin : null;
  const rl = rca === null || cr === null ? null : rca <= 0 ? 0 : cr === 0 ? Infinity : rca / cr;
  return { cr, rca, rl };
}

/* ----------------------------------------------------------------------------- components --- */

/** The floor as found (every repair set to "No") and after the repairs (the job's own evaluation). */
function floorRow(job, layout, done) {
  const asFound = api653({ ...job, indications: (job.indications || []).map((i) => ({ ...i, repair: 'no' })) }, layout);
  const gov = (r) => { const rs = r.regions.filter((g) => g.RT !== null); if (!rs.length) return null; return rs.reduce((m, g) => ((g.OrMax ?? -Infinity) < (m.OrMax ?? -Infinity) ? g : m)); };
  const g = gov(asFound), ga = gov(done);
  const tNom = num(job.tank?.tBottom), years = num(asFound.years);
  const cr = asFound.noBasis ? null : asFound.K;
  const life = (x) => (x === null || x.OrMax === null ? null : Math.max(0, x.OrMax));
  const row = {
    key: 'floor', label: 'Floor', tNom, tAct: g ? g.RT : null, years, cr, tMin: g ? g.limit : null,
    rl: life(g), rlAfter: life(ga), area: g?.label || '', notEvaluated: !!asFound.noBasis,
    basis: 'API 653 §4.4.5: T-act = RT, CR = StPᵣ + UPᵣ, RL = the largest Oᵣ for which MRT ≥ the limit'
  };
  // the two floor evaluations, for the report's working (not enumerable: kept out of saved results and goldens)
  Object.defineProperty(row, 'asFound', { value: asFound, enumerable: false });
  Object.defineProperty(row, 'done', { value: done, enumerable: false });
  return row;
}

function shellRows(job, years) {
  return courseSummary(job).filter((c) => c.min !== null).map((c) => {
    const tNom = num(c.tNom), tMin = num(c.tMin), r = rateLife(tNom, c.min, years, tMin);
    return { key: 'shell', course: c.no, label: `Shell course ${c.no}`, tNom, tAct: c.min, years, tMin, tMinSrc: c.tMinSet ? 'entered' : c.tMinCalc ? 'API 653 §4.3.3.1' : '', ...r };
  });
}

function roofRow(job, years) {
  if (!hasFixed(job)) return null;
  const F = job.roof.fixed, vals = (F.pts || []).map((p) => num(p.t)).filter((v) => v !== null);
  if (!vals.length) return null;
  const holes = vals.filter((v) => v === 0).length, tAct = Math.min(...vals), tNom = num(F.tNom), tMin = num(F.tMin);
  const r = rateLife(tNom, tAct, years, tMin);
  return { key: 'roof', label: 'Fixed roof', tNom, tAct, years, tMin, holes, ...r, ...(holes ? { rl: 0 } : {}) };
}

/* ------------------------------------------------------------------------------ intervals --- */

const iv = (years, src, insp) => ({ years: years === null ? null : Math.max(0, years), src, date: years === null ? '' : addYears(insp, Math.max(0, years)) });

function intervals653(job, shellGov, floor) {
  const insp = job.info?.inspDate || '', rpb = !!job.tank?.rpb, cap = rpb ? 30 : 20;
  let ut, ext;
  if (!shellGov) { ut = iv(null, 'No shell UT readings'); ext = iv(5, 'API 653 §6.3.2.1: 5 years (no shell UT readings for RCA / 4N)', insp); }
  else if (shellGov.cr === null) { ut = iv(5, 'API 653 §6.3.3.2: corrosion rate not known — 5 years', insp); ext = iv(5, 'API 653 §6.3.2.1: 5 years (corrosion rate not known)', insp); }
  else {
    const q = (k) => (shellGov.cr === 0 ? Infinity : Math.max(0, shellGov.rca) / (k * shellGov.cr));
    const u = Math.min(15, q(2)), e = Math.min(5, q(4)), c = `course ${shellGov.course}`;
    ut = iv(u, `API 653 §6.3.3.2: lesser of 15 years and RCA / 2N (${c})`, insp);
    ext = iv(e, `API 653 §6.3.2.1: lesser of 5 years and RCA / 4N (${c})`, insp);
  }
  const intOf = (rl, label) => (rl === null ? iv(null, floor.notEvaluated ? 'Floor not evaluated (no corrosion rate basis)' : 'No floor evaluation') : iv(Math.min(cap, rl), `API 653 §6.4.2: floor Oᵣ (§4.4.5) ${label}, not over ${cap} years (§6.4.2.2.1${rpb ? ', with a release prevention barrier' : ''})`, insp));
  return {
    ut: { done: ut, not: ut }, ext: { done: ext, not: ext },
    int: { done: intOf(floor.rlAfter, 'after the repairs'), not: intOf(floor.rl, 'as found') }
  };
}

function intervals12R1(job, s, shellGov, floor) {
  const insp = job.info?.inspDate || '', E = s.r12int || {}, src = (k) => `API 12R1 maximum entered${E.refs ? ' (' + E.refs + ')' : ''}${k}`;
  const lim = (max, rl, k) => {
    const m = num(max); if (m === null) return iv(null, 'API 12R1 maximum not entered');
    if (rl !== null && rl < m) return iv(rl, `${src(k)}, shortened to the remaining life`, insp);
    return iv(m, src(k), insp);
  };
  const shellRL = shellGov ? shellGov.rl : null;
  return {
    ut: { done: lim(E.ut, shellRL, ''), not: lim(E.ut, shellRL, '') },
    ext: { done: lim(E.ext, shellRL, ''), not: lim(E.ext, shellRL, '') },
    int: { done: lim(E.int, floor.rlAfter, ' (floor after repairs)'), not: lim(E.int, floor.rl, ' (floor as found)') }
  };
}

/* ----------------------------------------------------------------------------- settlement --- */

/**
 * Small-tank planar method (four stations at 0°, 90°, 180°, 270° from the 0° reference, read as N / E / S / W).
 * Plane fit: slopes (E − W) / D and (N − S) / D; twist residual ±[(N + S) − (E + W)] / 4; plumbness = slope × H,
 * cross-checked with the out-of-plumb readings over the level; freeboard loss on the low side = slope × D / 2.
 */
export function planarTilt(job, s = job.small) {
  const D = num(job.tank?.diameter) || 0, H = settleHeight(job), Lv = num(s.level);
  const at = (loc, f) => num(s.tilt.find((x) => x.loc === loc)?.[f]);
  const z = Object.fromEntries(COMPASS.map((k) => [k, at(k, 'elev')]));
  const lean = Object.fromEntries(COMPASS.map((k) => [k, at(k, 'lean')]));
  const out = { D, H, z, lean, haveElev: COMPASS.every((k) => z[k] !== null), haveLean: COMPASS.some((k) => lean[k] !== null) && Lv > 0 };
  if (out.haveElev && D > 0) {
    const sx = (z.E - z.W) / D, sy = (z.N - z.S) / D, slope = Math.hypot(sx, sy);
    const low = slope > 0 ? (Math.atan2(-sx, -sy) / DEG + 360) % 360 : null;
    Object.assign(out, { sx, sy, slope, lowDeg: low, diff: slope * D, twist: ((z.N + z.S) - (z.E + z.W)) / 4, plumbElev: H > 0 ? slope * H : null, freeboard: slope * D / 2 });
  }
  if (out.haveLean) {
    const r = (k) => (lean[k] === null ? null : lean[k] / Lv);
    const vals = COMPASS.map(r).filter((v) => v !== null);
    out.leanMax = H > 0 ? Math.max(...vals.map(Math.abs)) * H : null;
    const pair = (a, b) => (r(a) === null || r(b) === null ? null : (r(a) - r(b)) / 2);
    const ns = pair('N', 'S'), ew = pair('E', 'W');
    out.plumbLevel = H > 0 && ns !== null && ew !== null ? Math.hypot(ns, ew) * H : null;
  }
  const cands = [out.plumbElev, out.leanMax].filter((v) => v != null);
  out.plumb = cands.length ? Math.max(...cands) : null;
  // drain / sump: the first water-draw nozzle, if any (angle from the 0° reference)
  const dr = (job.nozzles || []).find((n) => /drain|water draw/i.test(n.type || '') && num(n.angle) !== null);
  if (dr && out.lowDeg != null) {
    const d = Math.abs(((num(dr.angle) - out.lowDeg + 540) % 360) - 180);
    out.drain = { mark: dr.mark, angle: num(dr.angle), off: d, rel: d <= 45 ? 'toward' : d >= 135 ? 'away from' : 'across from' };
  }
  // Annex B out-of-plane allowable with N = 4, for reference only (four stations are fewer than Annex B asks for)
  const ye = settleYE(job), L = D > 0 ? (Math.PI * D) / 4 : null;
  out.smaxRef = L && H > 0 && ye.Y && ye.E ? (11 * L * L * ye.Y) / (2 * ye.E * H) : null;
  return out;
}

function tiltEval(job, s) {
  const basis = s.basis.settle, lim = s.lim || {}, P = planarTilt(job, s), H = P.H;
  const lim653 = H > 0 ? Math.min(H / 100, 5 * IN) : null;
  const res = { basis, planar: P, twistTrig: num(lim.twist), refs: lim.refs || '' };
  if (basis === '653') {
    const c = hasSettle(job) ? settleCalc(job) : null;
    res.annexB = c;
    res.plumb = c?.fit?.plumb ?? null; res.plumbLim = c?.fit?.plumbLim ?? lim653; res.limSrc = 'API 653 §10.5.2.1';
    res.ok = c?.tiltOk ?? null; res.status = !c ? 'No Annex B survey' : c.status || (res.ok === null ? 'Incomplete' : res.ok ? 'Acceptable' : 'Exceeds');
    return res;
  }
  res.plumb = P.plumb;
  if (basis === '12r1') { res.plumbLim = num(lim.plumb); res.limSrc = res.plumbLim === null ? '' : `API 12R1 limit entered${lim.refs ? ' (' + lim.refs + ')' : ''}`; }
  else { res.plumbLim = num(lim.plumb) ?? lim653; res.limSrc = num(lim.plumb) !== null ? `Entered limit${lim.refs ? ' (' + lim.refs + ')' : ''}` : 'API 653 §10.5.2.1'; }
  res.ok = res.plumb === null || res.plumbLim === null ? null : res.plumb <= res.plumbLim + 1e-9;
  res.twistOk = P.twist === undefined || res.twistTrig === null ? null : Math.abs(P.twist) <= res.twistTrig + 1e-9;
  res.status = res.plumb === null ? 'Incomplete' : res.plumbLim === null ? 'No limit entered' : res.ok ? 'Acceptable' : 'Exceeds';
  return res;
}

function edgeEvalSmall(job, s) {
  const basis = s.basis.settle, lim = s.lim || {}, L = num(lim.edge), dist = num(lim.edgeDist);
  const rows = (s.edge || []).map((e) => {
    const B = num(e.max), R = num(e.bo);
    const ref = R !== null ? edgeCurve(job, R) : { Bew: null };
    if (basis === '653') {
      const r = edgeEval({ B, R, weld: 'par' }, job);
      return { st: e.st, B, R, allow: r.allow, pct: r.pct, status: B === null ? 'No reading' : r.status, src: 'API 653 Annex B, Bew (Fig. B.11; lap welds assumed parallel to the shell)', review: r.review, ref: ref.Bew };
    }
    if (B === null) return { st: e.st, B, R, status: 'No reading', ref: ref.Bew };
    if (L === null) return { st: e.st, B, R, allow: null, status: basis === '12r1' ? 'No limit entered' : 'Reported only', ref: ref.Bew };
    if (dist !== null && (R === null || R > dist + 1e-9)) return { st: e.st, B, R, allow: L, status: R === null ? 'Breakover not recorded' : 'Beyond the limit’s distance', ref: ref.Bew };
    return { st: e.st, B, R, allow: L, pct: (B / L) * 100, status: B > L + 1e-9 ? 'Exceeds' : 'Acceptable', ref: ref.Bew };
  });
  const src = basis === '653' ? 'API 653 Annex B (§B.3.4)' : L === null ? '' : `${basis === '12r1' ? 'API 12R1 limit entered' : 'Entered limit'}${lim.edgeRefs ? ' (' + lim.edgeRefs + ')' : ''}`;
  const worst = rows.some((r) => r.status === 'Exceeds') ? 'Exceeds' : rows.some((r) => r.status === 'NDE required') ? 'NDE required' : rows.some((r) => r.status === 'Acceptable') ? 'Acceptable' : rows.some((r) => r.B !== null) ? 'Reported only' : 'No readings';
  return { basis, rows, limit: L, dist, src, status: worst };
}

/** Floor projections beyond the shell (§4.4.5.7): each location against the thickness and width minimums. */
function projEval(job, s) {
  const tMin = minT(job), wMin = job.units === 'metric' ? 10 : 0.375 * IN;
  return (s.proj || []).map((p) => {
    const t = num(p.t), w = num(p.len);
    const tOk = t === null ? null : t >= tMin - 1e-9, wOk = w === null ? null : w >= wMin - 1e-9;
    return { loc: p.loc, t, w, tMin, wMin, tOk, wOk, ok: tOk === false || wOk === false ? false : tOk && wOk ? true : null };
  });
}

/* ---------------------------------------------------------------------------------- main --- */

/**
 * Everything the small tank report calculates. `done` is the job's API 653 floor evaluation (S.calc) when the
 * caller has it; it is recalculated otherwise.
 */
export function smallCalc(job, layout, done = null) {
  const s = job.small || defaultSmall();
  const a = done || api653(job, layout);
  const years = num(a.years), yS = num(s.yrs?.shell) ?? years, yR = num(s.yrs?.roof) ?? years;
  const floor = floorRow(job, layout, a);
  const courses = shellRows(job, yS);
  const shell = courses.length ? courses.reduce((m, c) => ((c.rl ?? Infinity) < (m.rl ?? Infinity) ? c : m)) : null;
  const roof = roofRow(job, yR);
  const basis = s.basis?.intervals === '12r1' ? '12r1' : '653';
  const ivs = basis === '12r1' ? intervals12R1(job, s, shell, floor) : intervals653(job, shell, floor);
  // entered overrides replace the calculated value (shown as typed)
  for (const k of ['ut', 'ext', 'int']) for (const w of ['done', 'not']) {
    const o = String(s.intOv?.[k + (w === 'done' ? 'Done' : 'Not')] ?? '').trim();
    if (o) ivs[k][w] = { ...ivs[k][w], override: o };
  }
  return {
    years, thick: { floor, shell, courses, roof }, intervals: { basis, ...ivs },
    tilt: tiltEval(job, s), edge: edgeEvalSmall(job, s), proj: projEval(job, s)
  };
}

