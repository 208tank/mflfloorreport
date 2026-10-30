// Indication analysis and API 653 bottom MRT calculation (API 653, 4.4.7).
// MRT = min(RTbc, RTip) − Or × (StPr + UPr)
// All thickness values in mm, rates in mm/yr.
import { itemFloor } from './geometry.js';

export const RESULTS = {
  pending: 'Pending prove-up',
  ps: 'Product side',
  ss: 'Soil side',
  both: 'Both sides',
  nri: 'No indication (false call)',
  other: 'Other / non-relevant'
};
export const RESULT_SHORT = { pending: 'PEND', ps: 'PS', ss: 'SS', both: 'PS+SS', nri: 'NRI', other: 'OTH' };

export function defaultCalc() {
  return {
    years: 20,            // rate basis: years of service (or since last thickness baseline)
    Or: 10,               // proposed years to next internal inspection
    mrtBottom: 2.54,      // 0.10 in – no leak detection / containment (Table 4.6)
    mrtAnnular: 2.54,     // check Table 4.5 where annular plates are required
    czDist: 76.2,         // critical zone: within 3 in of the shell
    czLimit: null,        // null = auto
    shellTmin: null,      // lower shell course t-min (for critical zone limit)
    coated: false,        // StPr = 0 where coating life ≥ Or
    cp: false,            // UPr = 0 where effective cathodic protection
    includeUnverified: false,
    stprOverride: null,
    uprOverride: null
  };
}

const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);

export function plateNominal(job, plate) {
  const ov = job.plates?.[plate?.key];
  if (n(ov?.tNom) !== null) return +ov.tNom;
  if (plate?.kind === 'annular' && n(job.tank?.tAnnular) !== null) return +job.tank.tAnnular;
  return n(job.tank?.tBottom);
}

export function czLimitAuto(job) {
  const C = { ...defaultCalc(), ...job.calc };
  const tOrig = job.layout?.annular && n(job.tank?.tAnnular) !== null ? +job.tank.tAnnular : n(job.tank?.tBottom);
  let lim = tOrig !== null ? tOrig / 2 : Infinity;
  if (n(C.shellTmin) !== null) lim = Math.min(lim, C.shellTmin / 2);
  if (!Number.isFinite(lim)) lim = 2.54;
  return Math.max(2.54, lim);
}

/** Per-indication derived values. */
export function analyze(job, layout, ind) {
  const C = { ...defaultCalc(), ...job.calc };
  const plate = layout.byKey.get(ind.plate) || null;
  const tNom = n(ind.utNom) ?? plateNominal(job, plate);
  const res = ind.result || 'pending';
  const proven = res === 'ps' || res === 'ss' || res === 'both';
  let rem = null, src = '';
  if (n(ind.utMin) !== null) { rem = +ind.utMin; src = 'UT'; }
  else if ((res === 'ps' || res === 'both') && n(ind.vtDepth) !== null && tNom !== null) { rem = tNom - ind.vtDepth; src = 'VT pit depth'; }
  else if ((proven || res === 'pending') && n(ind.mflPct) !== null && tNom !== null) { rem = tNom * (1 - ind.mflPct / 100); src = 'MFL estimate'; }

  let loss = null, lossPct = null, top = 0, bot = 0;
  if (rem !== null && tNom !== null) {
    loss = Math.max(0, tNom - rem);
    lossPct = tNom > 0 ? (loss / tNom) * 100 : null;
    if (res === 'ps') top = loss;
    else if (res === 'ss') bot = loss;
    else if (res === 'both') { top = n(ind.vtDepth) !== null ? Math.min(+ind.vtDepth, loss) : 0; bot = loss - top; }
    else if (res === 'pending' && C.includeUnverified) bot = loss;
  }
  const f = plate ? itemFloor(layout, ind) : null;
  const r = f ? Math.hypot(f.x, f.y) : null;
  const distShell = r !== null ? layout.R - r : null;
  const critical = distShell !== null && distShell <= (n(C.czDist) ?? 76.2) + 1e-6;
  const region = plate?.kind === 'annular' ? 'annular' : 'bottom';
  const counts = proven || (res === 'pending' && C.includeUnverified);
  return { plate, tNom, rem, src, loss, lossPct, top, bot, proven, res, floor: f, r, distShell, critical, region, counts };
}

/**
 * Full API 653 evaluation.
 * Repairs: ind.repair = 'yes' (forced), 'no' (declined), otherwise 'auto'.
 * Auto mode repeatedly marks the worst failing location for repair, then re-derives the
 * corrosion rates from what is left unrepaired, until every remaining location passes.
 */
export function api653(job, layout) {
  const C = { ...defaultCalc(), ...job.calc };
  const years = n(C.years), Or = n(C.Or) ?? 0;
  const czLim = n(C.czLimit) ?? czLimitAuto(job);
  const warnings = [];
  const all = (job.indications || []).map((ind) => ({ ind, a: analyze(job, layout, ind) }));
  const use = all.filter((it) => it.a.counts && it.a.rem !== null);

  const limitFor = (a) => Math.max(a.region === 'annular' ? n(C.mrtAnnular) ?? 2.54 : n(C.mrtBottom) ?? 2.54, a.critical ? czLim : 0);

  const ratesFrom = (repaired) => {
    let st = 0, up = 0, stSrc = null, upSrc = null;
    if (years && years > 0) {
      for (const it of use) {
        if (repaired.has(it.ind.id)) continue;
        if (it.a.top / years > st) { st = it.a.top / years; stSrc = it.ind; }
        if (it.a.bot / years > up) { up = it.a.bot / years; upSrc = it.ind; }
      }
    }
    if (C.coated) { st = 0; stSrc = null; }
    if (C.cp) { up = 0; upSrc = null; }
    if (n(C.stprOverride) !== null) { st = +C.stprOverride; stSrc = 'override'; }
    if (n(C.uprOverride) !== null) { up = +C.uprOverride; upSrc = 'override'; }
    return { StPr: st, UPr: up, stSrc, upSrc };
  };

  const repaired = new Set(use.filter((it) => it.ind.repair === 'yes').map((it) => it.ind.id));
  const autoSet = new Set();
  let rates = ratesFrom(repaired);
  for (let guard = 0; guard < use.length + 1; guard++) {
    rates = ratesFrom(repaired);
    const k = rates.StPr + rates.UPr;
    let worst = null, worstMargin = 0;
    for (const it of use) {
      if (repaired.has(it.ind.id) || it.ind.repair === 'no') continue;
      const margin = it.a.rem - Or * k - limitFor(it.a);
      if (margin < -1e-9 && (worst === null || margin < worstMargin)) { worst = it; worstMargin = margin; }
    }
    if (!worst) break;
    repaired.add(worst.ind.id); autoSet.add(worst.ind.id);
  }
  // prune: drop any auto repair that turns out not to be needed once the others are done
  const allPass = (rep) => {
    const r = ratesFrom(rep), k = r.StPr + r.UPr;
    return use.every((it) => rep.has(it.ind.id) || it.ind.repair === 'no' || it.a.rem - Or * k - limitFor(it.a) >= -1e-9);
  };
  for (const id of [...autoSet].sort((a, b) => (use.find((x) => x.ind.id === b).a.rem) - (use.find((x) => x.ind.id === a).a.rem))) {
    repaired.delete(id);
    if (allPass(repaired)) autoSet.delete(id); else repaired.add(id);
  }
  rates = ratesFrom(repaired);
  const K = rates.StPr + rates.UPr;

  const per = new Map();
  for (const it of all) {
    const a = it.a;
    const out = { ...a, limit: limitFor(a), projected: null, status: 'n/a', repair: false, auto: false };
    if (a.counts && a.rem !== null) {
      out.projected = a.rem - Or * K;
      out.repair = repaired.has(it.ind.id);
      out.auto = autoSet.has(it.ind.id);
      if (out.repair) out.status = out.auto ? 'repair (calc)' : 'repair';
      else if (out.projected < out.limit - 1e-9) out.status = 'below MRT';
      else out.status = 'OK';
    } else if (a.res === 'pending') out.status = 'pending';
    else if (a.res === 'nri' || a.res === 'other') out.status = 'no action';
    per.set(it.ind.id, out);
  }

  // region summaries
  const regionNom = (region) => {
    let m = Infinity;
    for (const p of layout.plates) {
      if ((p.kind === 'annular' ? 'annular' : 'bottom') !== region) continue;
      const ov = job.plates?.[p.key];
      const t = n(ov?.utMin) ?? plateNominal(job, p);
      if (t !== null && t < m) m = t;
    }
    return Number.isFinite(m) ? m : null;
  };
  const summarize = (name, label, filter, limit) => {
    const un = use.filter((it) => !repaired.has(it.ind.id) && filter(it.a));
    const base = regionNom(name === 'critical' ? (layout.Ri < layout.R ? 'annular' : 'bottom') : name);
    const ip = un.filter((it) => it.a.top > 0).map((it) => it.a.rem);
    const bc = un.filter((it) => it.a.bot > 0).map((it) => it.a.rem);
    const RTip = ip.length ? Math.min(...ip) : base;
    const RTbc = bc.length ? Math.min(...bc) : base;
    const RT = RTip === null ? RTbc : RTbc === null ? RTip : Math.min(RTip, RTbc);
    const MRT = RT === null ? null : RT - Or * K;
    const OrMax = RT === null ? null : K > 0 ? (RT - limit) / K : Infinity;
    return { name, label, RTip, RTbc, RT, MRT, limit, ok: MRT === null ? null : MRT >= limit - 1e-9, OrMax, tReq: limit + Or * K };
  };
  const regions = [summarize('bottom', 'Bottom plates', (a) => a.region === 'bottom', n(C.mrtBottom) ?? 2.54)];
  if (layout.Ri < layout.R) regions.push(summarize('annular', 'Annular plates', (a) => a.region === 'annular', n(C.mrtAnnular) ?? 2.54));
  if (use.some((it) => it.a.critical)) regions.push(summarize('critical', 'Critical zone', (a) => a.critical, Math.max(czLim, layout.Ri < layout.R ? n(C.mrtAnnular) ?? 0 : n(C.mrtBottom) ?? 0)));

  const pend = all.filter((it) => it.a.res === 'pending').length;
  if (!years || years <= 0) warnings.push('Rate basis (years) is not set, so corrosion rates are zero.');
  if (pend) warnings.push(`${pend} indication${pend > 1 ? 's are' : ' is'} pending prove-up${C.includeUnverified ? ' and included using MFL estimates (treated as soil side).' : ' and not included in the calculation.'}`);
  const noLoc = all.filter((it) => !it.a.plate).length;
  if (noLoc) warnings.push(`${noLoc} indication${noLoc > 1 ? 's have' : ' has'} no valid plate location.`);
  const noRem = all.filter((it) => it.a.proven && it.a.rem === null).length;
  if (noRem) warnings.push(`${noRem} proven-up indication${noRem > 1 ? 's have' : ' has'} no remaining thickness (enter UT or VT pit depth).`);
  const bothNoVt = all.filter((it) => it.a.res === 'both' && n(it.ind.vtDepth) === null).length;
  if (bothNoVt) warnings.push(`${bothNoVt} "both sides" indication${bothNoVt > 1 ? 's have' : ' has'} no VT pit depth; all loss was assigned to the soil side.`);
  const declined = [...per.values()].filter((p) => p.status === 'below MRT').length;
  if (declined) warnings.push(`${declined} location${declined > 1 ? 's are' : ' is'} below MRT with repair set to "No".`);
  const estUsed = use.filter((it) => it.a.src === 'MFL estimate' && it.a.proven).length;
  if (estUsed) warnings.push(`${estUsed} proven-up indication${estUsed > 1 ? 's use' : ' uses'} the MFL % estimate because no UT/VT value was entered.`);

  return { C, years, Or, czLim, ...rates, K, per, regions, warnings, repairs: [...repaired], autoRepairs: [...autoSet] };
}
