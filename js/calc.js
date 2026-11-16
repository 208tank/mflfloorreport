import { courseDesigns, annularReq } from './design.js';
import { nozzleNeck } from './tables.js';
// Indication analysis and API 653 bottom MRT calculation (API 653, 5th ed. Addendum 4 (2025), §4.4.5).
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

/** Corrections in force (approved correction list, 14 Nov 2026). Shown in the report footer. */
export const CORRECTIONS = 'C-01 to C-31 (calculation review, Nov 2026)';

export function defaultCalc() {
  return {
    years: 20,            // tank age (years): UPr basis (API 653 §4.4.5.1)
    stprYears: null,      // optional separate StPr basis (years since coating / last inspection); blank = tank age
    Or: 10,               // proposed years to next internal inspection
    mrtBottom: 2.54,      // 0.10 in – no leak detection / containment (Table 4.4)
    mrtAnnular: null,     // blank = Table 4.5 / API 650 Table 5.1 value (+ CA) when it can be computed (§4.4.6)
    annCA: null,          // corrosion allowance added to the annular table value (§4.4.6.2)
    czDist: 76.2,         // critical zone: within 3 in of the shell
    czLimit: null,        // null = auto (§4.4.5.4)
    czLimitReason: '',    // reason for an entered critical-zone limit (e.g. isolated pitting, Table 4.4)
    shellTmin: null,      // lower shell course t-min (for critical zone limit)
    mflThresholdPct: 20,  // MFL threshold (% of nominal) for UPr, §4.4.5.1 Note 1
    coated: false,        // StPr = 0 where coating life ≥ Or
    coatConfirmed: false, // engineer confirms the coating basis despite recorded product-side pitting
    cp: false,            // UPr = 0 where effective cathodic protection
    rbi: false,           // Or set by an RBI assessment (§6.4.2.2.2)
    includeUnverified: false,
    stprOverride: null,
    uprOverride: null,
    autoPatch: true,      // repair indications get a patch plate
    patchL: 304.8,        // default patch 12 x 12 in
    patchW: 304.8,
    patchMargin: 50.8,    // patch extends at least 2 in past the corrosion (API 653 §9.11.1.1 c)
    patchT: 6.35          // patch plate thickness unless entered (1/4 in)
  };
}

const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);
const IN = 25.4;
/** Table 4.4 / §4.4.5.4 minimum in the job's units: 0.10 in (USC) or 2.5 mm (SI). */
export const minT = (job) => (job?.units === 'metric' ? 2.5 : 2.54);
/** Welded repairs (§4.4.5.5) remove a location from the RT evaluation; non-welded repairs (§4.4.5.6) do not. */
export const isWelded = (ind) => !ind.repairMethod || /patch|weld|insert|replace/i.test(ind.repairMethod);

export function plateNominal(job, plate) {
  const ov = job.plates?.[plate?.key];
  if (n(ov?.tNom) !== null) return +ov.tNom;
  if (plate?.kind === 'annular' && n(job.tank?.tAnnular) !== null) return +job.tank.tAnnular;
  return n(job.tank?.tBottom);
}

/** §4.4.5.4: the smaller of 0.118 in (3 mm) and 50 % of the bottom shell course t-min, but not less than 0.10 in (2.5 mm). */
export function czLimitAuto(job) { return czLimitParts(job).value; }
/** The parts of the §4.4.5.4 rule, for the report's calculation appendix (R5). */
export function czLimitParts(job) {
  const C = { ...defaultCalc(), ...job.calc }, met = job.units === 'metric';
  const cap = met ? 3 : 0.118 * IN, floor = met ? 2.5 : 0.1 * IN;
  const c1 = (job.shell?.courses || [])[0], st = n(C.shellTmin) ?? (n(c1?.tMin) > 0 ? +c1.tMin : courseDesigns(job)[0]?.tmin ?? null);
  const stSrc = n(C.shellTmin) !== null ? 'entered on the API 653 page' : n(c1?.tMin) > 0 ? 'course 1 t-min entered' : st !== null ? 'course 1 t-min calculated (§4.3.3)' : 'not available';
  const lim = st !== null ? Math.min(cap, st / 2) : cap;
  return { value: Math.max(floor, lim), cap, floor, st, stSrc, half: st !== null ? st / 2 : null, lim };
}

/** Annular plate limit: entered value, else the table value (+ CA) when it can be computed. */
export function annularLimit(job) {
  const C = { ...defaultCalc(), ...job.calc };
  const req = annularReq(job), ca = n(C.annCA) ?? 0, tbl = req?.tmm != null ? req.tmm + ca : null;
  if (n(C.mrtAnnular) !== null) return { t: +C.mrtAnnular, src: 'entered', tbl, req, low: tbl !== null && +C.mrtAnnular < tbl - 1e-6 };
  if (tbl !== null) return { t: tbl, src: req.table + (ca ? ' + CA' : ''), tbl, req };
  return { t: minT(job), src: req?.over ? 'beyond the table' : 'not set', tbl: null, req, unset: true };
}

/** Indication input checks: impossible values are not used; doubtful ones are flagged. */
function inputIssues(ind, tNom) {
  const bad = [], doubt = [];
  const m = n(ind.mflPct), vt = n(ind.vtDepth), ut = n(ind.utMin);
  if (m !== null && (m < 0 || m > 100)) bad.push(`MFL ${m} % is outside 0–100 %`);
  if (vt !== null && (vt < 0 || (tNom !== null && vt >= tNom))) bad.push('VT pit depth is negative or not less than the nominal');
  if (ut !== null && ut < 0) bad.push('UT remaining is negative');
  if (ut !== null && tNom !== null && ut > tNom + 1e-9) doubt.push('UT remaining is more than the nominal');
  return { bad, doubt };
}

/** Per-indication derived values. */
export function analyze(job, layout, ind) {
  const C = { ...defaultCalc(), ...job.calc }, met = job.units === 'metric';
  const plate = layout.byKey.get(ind.plate) || null;
  const tNom = n(ind.utNom) ?? plateNominal(job, plate);
  const res = ind.result || 'pending';
  const proven = res === 'ps' || res === 'ss' || res === 'both';
  const iss = inputIssues(ind, tNom), okM = (k) => !iss.bad.some((b) => b.startsWith(k));
  let rem = null, src = '';
  if (n(ind.utMin) !== null && okM('UT')) { rem = +ind.utMin; src = 'UT'; }
  else if ((res === 'ps' || res === 'both') && n(ind.vtDepth) !== null && tNom !== null && okM('VT')) { rem = tNom - ind.vtDepth; src = 'VT pit depth'; }
  else if ((proven || res === 'pending') && n(ind.mflPct) !== null && tNom !== null && okM('MFL')) { rem = tNom * (1 - ind.mflPct / 100); src = 'MFL estimate'; }

  let loss = null, lossPct = null, top = 0, bot = 0;
  if (rem !== null && tNom !== null) {
    loss = Math.max(0, tNom - rem);
    lossPct = tNom > 0 ? (loss / tNom) * 100 : null;
    if (res === 'ps') top = loss;
    else if (res === 'ss') bot = loss;
    else if (res === 'both') { top = n(ind.vtDepth) !== null && okM('VT') ? Math.min(+ind.vtDepth, loss) : 0; bot = loss - top; }
    else if (res === 'pending' && C.includeUnverified) bot = loss;
  }
  const f = plate ? itemFloor(layout, ind) : null;
  const r = f ? Math.hypot(f.x, f.y) : null;
  const distShell = r !== null ? layout.R - r : null;
  // §3.11: critical when the recorded corrosion reaches the zone (centre less half the larger extent)
  const ext = Math.max(n(ind.len) || 0, n(ind.wid) || 0), cz = n(C.czDist) ?? 76.2;
  const distEdge = distShell !== null ? distShell - ext / 2 : null;
  const critical = distEdge !== null && distEdge <= cz + 1e-6;
  const nearCZ = !critical && !ext && distShell !== null && distShell <= cz + (met ? 225 : 9 * IN) + 1e-6;
  const region = plate?.kind === 'annular' ? 'annular' : 'bottom';
  const counts = proven || (res === 'pending' && C.includeUnverified);
  return { plate, tNom, rem, src, est: src === 'MFL estimate', loss, lossPct, top, bot, proven, res, floor: f, r, distShell, distEdge, critical, nearCZ, region, counts, issues: iss };
}

/** Status text for display: marks results that rest on an MFL estimate (C-03). */
export function statusText(a) {
  const st = a?.status || '';
  const base = st === 'repair (calc)' ? 'Repair — below MRT at next inspection' : st === 'repair' ? 'Repair — specified' : st === 'below MRT' ? 'Below MRT' : st === 'pending' ? 'Pending prove-up' : st === 'no action' ? 'No action' : st === 'OK' ? 'OK' : st === 'not evaluated' ? 'Not evaluated — no rate basis' : st === 'n/a' ? 'Not used in calculation' : st;
  return a?.est && a.counts && st !== 'n/a' ? `${base} (MFL estimate)` : base;
}

/**
 * Full API 653 evaluation.
 * Repairs: ind.repair = 'yes' (forced), 'no' (declined), otherwise 'auto'.
 * Auto mode repeatedly marks the worst failing location for repair, then re-derives the
 * corrosion rates, until every remaining location passes. Only welded repairs (§4.4.5.5) remove a
 * location from RT; repaired soil-side locations keep their rate in UPr unless the cause of corrosion
 * was removed (§4.4.5.1 Note 1).
 */
export function api653(job, layout) {
  const C = { ...defaultCalc(), ...job.calc }, met = job.units === 'metric';
  const years = n(C.years), stYears = n(C.stprYears) ?? years, Or = n(C.Or) ?? 0;
  const czLim = n(C.czLimit) ?? czLimitAuto(job);
  const ann = annularLimit(job), mBot = n(C.mrtBottom) ?? minT(job), mAnn = ann.t;
  const warnings = [];
  const all = (job.indications || []).map((ind) => ({ ind, a: analyze(job, layout, ind) }));
  const use = all.filter((it) => it.a.counts && it.a.rem !== null);
  // C-04: with no rate basis the rates are unknown, unless both sides are set to zero or entered
  const stKnown = (stYears && stYears > 0) || (C.coated && C.coatConfirmed) || n(C.stprOverride) !== null;
  const upKnown = (years && years > 0) || C.cp || n(C.uprOverride) !== null;
  const noBasis = !(stKnown && upKnown);

  const limitFor = (a) => Math.max(a.region === 'annular' ? mAnn : mBot, a.critical ? czLim : 0);
  const canRemove = (ind) => ind.repair !== 'no' && isWelded(ind);

  // MFL threshold (§4.4.5.1 Note 1): for MFL-scanned areas without effective CP, UPr uses the lesser of the
  // threshold thickness and the thinnest unrepaired soil-side area.
  const thr = n(C.mflThresholdPct), scanned = layout.plates.some((p) => (job.plates?.[p.key]?.scan || 'scanned') !== 'not');
  const thrRate = (() => {
    if (C.cp || !(thr > 0) || !(years > 0) || !scanned) return 0;
    const noms = [n(job.tank?.tBottom), layout.Ri < layout.R ? n(job.tank?.tAnnular) ?? n(job.tank?.tBottom) : null].filter((v) => v !== null);
    return noms.length ? Math.max(...noms.map((t) => (t * thr) / 100 / years)) : 0;
  })();
  const coatConflict = C.coated && !C.coatConfirmed && use.some((it) => it.a.top > 0);

  const ratesFrom = (repaired) => {
    let st = 0, up = 0, stSrc = null, upSrc = null;
    for (const it of use) {
      const rep = repaired.has(it.ind.id);
      if (stYears && stYears > 0 && !rep && it.a.top / stYears > st) { st = it.a.top / stYears; stSrc = it.ind; }
      if (years && years > 0 && (!rep || !it.ind.causeRemoved) && it.a.bot / years > up) { up = it.a.bot / years; upSrc = it.ind; }
    }
    if (thrRate > up) { up = thrRate; upSrc = 'threshold'; }
    if (C.coated && !coatConflict) { st = 0; stSrc = null; }
    if (C.cp) { up = 0; upSrc = null; }
    if (n(C.stprOverride) !== null) { st = +C.stprOverride; stSrc = 'override'; }
    if (n(C.uprOverride) !== null) { up = +C.uprOverride; upSrc = 'override'; }
    return { StPr: st, UPr: up, stSrc, upSrc };
  };

  const repaired = new Set(use.filter((it) => it.ind.repair === 'yes' && isWelded(it.ind)).map((it) => it.ind.id));
  const autoSet = new Set();
  const trace = { specified: [...repaired], rounds: [], pruned: [], kept: [] }; // report trace (R5); not part of the result
  let rates = ratesFrom(repaired);
  if (!noBasis) {
    for (let guard = 0; guard < use.length + 1; guard++) {
      rates = ratesFrom(repaired);
      const k = rates.StPr + rates.UPr;
      let worst = null, worstMargin = 0;
      for (const it of use) {
        if (repaired.has(it.ind.id) || !canRemove(it.ind)) continue;
        const margin = it.a.rem - Or * k - limitFor(it.a);
        if (margin < -1e-9 && (worst === null || margin < worstMargin)) { worst = it; worstMargin = margin; }
      }
      if (!worst) break;
      trace.rounds.push({ id: worst.ind.id, no: worst.ind.no, rem: worst.a.rem, K: k, projected: worst.a.rem - Or * k, limit: limitFor(worst.a), margin: worstMargin });
      repaired.add(worst.ind.id); autoSet.add(worst.ind.id);
    }
    // prune: drop any auto repair that turns out not to be needed once the others are done
    const allPass = (rep) => {
      const r = ratesFrom(rep), k = r.StPr + r.UPr;
      return use.every((it) => rep.has(it.ind.id) || !canRemove(it.ind) || it.a.rem - Or * k - limitFor(it.a) >= -1e-9);
    };
    const remOf = new Map(use.map((x) => [x.ind.id, x.a.rem]));
    for (const id of [...autoSet].sort((a, b) => remOf.get(b) - remOf.get(a))) {
      repaired.delete(id);
      if (allPass(repaired)) { autoSet.delete(id); trace.pruned.push(id); } else { repaired.add(id); trace.kept.push(id); }
    }
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
      if (out.repair) {
        out.status = out.auto ? 'repair (calc)' : 'repair';
        // §4.4.5.1 Note 1: the patch thickness is added to the repaired location's RT
        const pt = n(it.ind.repT) ?? n(C.patchT) ?? 0.25 * IN;
        out.rtRepaired = a.rem + pt; out.projectedRepaired = out.rtRepaired - Or * K;
      } else if (noBasis) out.status = 'not evaluated';
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
    const gov = (side) => { const xs = un.filter((it) => (side === 'ip' ? it.a.top : it.a.bot) > 0); if (!xs.length) return null; const g = xs.reduce((m, it) => (it.a.rem < m.a.rem ? it : m)); return { id: g.ind.id, no: g.ind.no }; };
    trace.regions[name] = { ipFrom: gov('ip'), bcFrom: gov('bc'), base, ipCount: ip.length, bcCount: bc.length };
    const RT = RTip === null ? RTbc : RTbc === null ? RTip : Math.min(RTip, RTbc);
    const MRT = RT === null ? null : RT - Or * K;
    const OrMax = RT === null || noBasis ? null : K > 0 ? (RT - limit) / K : Infinity;
    const provisional = un.filter((it) => it.a.est).length;
    return { name, label, RTip, RTbc, RT, MRT, limit, ok: MRT === null || noBasis ? null : MRT >= limit - 1e-9, OrMax, tReq: limit + Or * K, provisional, notEvaluated: noBasis };
  };
  trace.regions = {};
  const regions = [summarize('bottom', 'Bottom plates', (a) => a.region === 'bottom', mBot)];
  if (layout.Ri < layout.R) regions.push(summarize('annular', 'Annular plates', (a) => a.region === 'annular', mAnn));
  if (use.some((it) => it.a.critical)) regions.push(summarize('critical', 'Critical zone', (a) => a.critical, Math.max(czLim, layout.Ri < layout.R ? mAnn : mBot)));

  const pl = (k, one, many) => (k > 1 ? many : one);
  const pend = all.filter((it) => it.a.res === 'pending').length;
  if (noBasis) warnings.push('Not evaluated: no corrosion rate basis (tank age) is set, so the rates are unknown. Enter the tank age, or set both sides to zero (coating confirmed and effective CP) or enter the rates.');
  if (!(Or > 0)) warnings.push('Oᵣ (years to the next internal inspection) is not set or not positive.');
  const OrLim = job.tank?.rpb ? 30 : 20;
  if (C.rbi) warnings.push(`Oᵣ is set by an RBI assessment (API 653 §6.4.2.2.2); the §6.4.2.2.1 limit of ${OrLim} years does not apply.`);
  else if (Or > OrLim + 1e-9) warnings.push(`Oᵣ = ${Or} years exceeds the API 653 §6.4.2.2.1 maximum interval of ${OrLim} years${job.tank?.rpb ? ' (with a release prevention barrier)' : ' (30 years with a release prevention barrier)'}; §4.4.5.1 does not allow a longer Oᵣ.`);
  if (thrRate > 0 && rates.upSrc === 'threshold') warnings.push(`UPᵣ is set by the MFL threshold (${thr} % of nominal, API 653 §4.4.5.1 Note 1): undetected soil-side loss up to the threshold is assumed.`);
  if (coatConflict) warnings.push(`The product side is marked coated (StPᵣ = 0), but ${use.filter((it) => it.a.top > 0).length} location(s) have recorded product-side loss, so StPᵣ is kept from them (§4.4.5.1: StPᵣ = 0 only where the coating life is at least Oᵣ). Confirm the coating basis to use StPᵣ = 0.`);
  if (C.coated && C.coatConfirmed && use.some((it) => it.a.top > 0)) warnings.push('StPᵣ = 0 on the engineer\'s confirmation of the coating basis, despite recorded product-side loss.');
  if (n(C.czLimit) !== null && !String(C.czLimitReason || '').trim()) warnings.push('A critical-zone limit has been entered without a reason (API 653 §4.4.5.4 gives the limit; record why it differs, e.g. isolated pitting per Table 4.4).');
  if (layout.Ri < layout.R) {
    if (ann.unset) warnings.push(`Annular plate limit: ${ann.req?.over ? 'beyond Table 5.1 / 4.5 — an elastic analysis is required (API 650 §5.5.3)' : 'the table value cannot be calculated (enter course 1 t, fill height and SG)'}; ${met ? '2.5 mm' : '0.10 in'} is used until a value is entered.`);
    else if (ann.low) warnings.push(`The entered annular limit is less than the ${ann.req.table} value${n(C.annCA) ? ' plus corrosion allowance' : ''} (API 653 §4.4.6).`);
  }
  if (pend) warnings.push(`${pend} indication${pend > 1 ? 's are' : ' is'} pending prove-up${C.includeUnverified ? ' and included using MFL estimates (treated as soil side).' : ' and not included in the calculation.'}`);
  const noLoc = all.filter((it) => !it.a.plate).length;
  if (noLoc) warnings.push(`${noLoc} indication${noLoc > 1 ? 's have' : ' has'} no valid plate location.`);
  const noRem = all.filter((it) => it.a.proven && it.a.rem === null).length;
  if (noRem) warnings.push(`${noRem} proven-up indication${noRem > 1 ? 's have' : ' has'} no usable remaining thickness (enter UT or VT pit depth).`);
  const badIn = all.filter((it) => it.a.issues.bad.length);
  if (badIn.length) warnings.push(`Not used — impossible input: ${badIn.map((it) => `${it.ind.no} (${it.a.issues.bad.join('; ')})`).join(', ')}.`);
  const doubtIn = all.filter((it) => it.a.issues.doubt.length);
  if (doubtIn.length) warnings.push(`Check input: ${doubtIn.map((it) => `${it.ind.no} (${it.a.issues.doubt.join('; ')})`).join(', ')}.`);
  const bothNoVt = all.filter((it) => it.a.res === 'both' && n(it.ind.vtDepth) === null).length;
  if (bothNoVt) warnings.push(`${bothNoVt} "both sides" indication${bothNoVt > 1 ? 's have' : ' has'} no VT pit depth; all loss was assigned to the soil side.`);
  const declined = [...per.values()].filter((p) => p.status === 'below MRT').length;
  if (declined) warnings.push(`${declined} location${pl(declined, ' is', 's are')} below MRT and not repaired (repair set to "No", or a non-welded repair method).`);
  const nonWeld = all.filter((it) => it.ind.repair === 'yes' && !isWelded(it.ind)).length;
  if (nonWeld) warnings.push(`${nonWeld} location${pl(nonWeld, ' has', 's have')} a non-welded repair method; non-welded repairs do not increase RT (API 653 §4.4.5.6), so ${pl(nonWeld, 'it stays', 'they stay')} in the evaluation.`);
  const repSoil = use.filter((it) => repaired.has(it.ind.id) && it.a.bot > 0 && !it.ind.causeRemoved).length;
  if (repSoil && years > 0 && !C.cp) warnings.push(`${repSoil} repaired soil-side location${pl(repSoil, ' keeps its', 's keep their')} corrosion rate in UPᵣ (API 653 §4.4.5.1 Note 1); tick "cause of corrosion removed" on a repair where that applies.`);
  const repThin = [...per.values()].filter((p) => p.repair && p.projectedRepaired != null && p.projectedRepaired < p.limit - 1e-9).length;
  if (repThin) warnings.push(`${repThin} repaired location${pl(repThin, '', 's')}: plate plus patch thickness would be below the minimum at the next inspection.`);
  const estUsed = use.filter((it) => it.a.est && it.a.proven).length;
  if (estUsed) warnings.push(`Provisional: ${estUsed} proven-up indication${estUsed > 1 ? 's use' : ' uses'} the MFL % estimate because no UT/VT value was entered.`);
  const near = all.filter((it) => it.a.nearCZ && it.a.counts).length;
  if (near) warnings.push(`${near} location${pl(near, ' is', 's are')} near the critical zone with no recorded extent; enter the indication length / width to check whether the corrosion reaches the zone (§3.11).`);

  // C-25: §4.4.5.7 bottom projection beyond the shell (≥ 0.10 in / 2.5 mm thick at the outside weld toe, ≥ 3/8 in / 10 mm wide)
  const pT = n(job.tank?.projT), pW = n(job.tank?.projW), pTmin = minT(job), pWmin = met ? 10 : 0.375 * IN;
  const projection = pT === null && pW === null ? null : { t: pT, w: pW, tMin: pTmin, wMin: pWmin, tOk: pT === null ? null : pT >= pTmin - 1e-9, wOk: pW === null ? null : pW >= pWmin - 1e-9 };
  if (projection) { projection.ok = projection.tOk === false || projection.wOk === false ? false : projection.tOk && projection.wOk ? true : null; if (projection.ok === false) warnings.push(`Bottom projection beyond the shell does not meet API 653 §4.4.5.7 (at least ${met ? '2.5 mm' : '0.10 in'} thick at the outside weld toe and ${met ? '10 mm' : '3/8 in'} wide).`); }

  const result = { C, years, stYears, Or, czLim, ann, mBot, mAnn, noBasis, thrRate, projection, ...rates, K, per, regions, warnings, repairs: [...repaired], autoRepairs: [...autoSet] };
  Object.defineProperty(result, 'trace', { value: trace, enumerable: false });
  return result;
}

/* ------------------------------------------------------------------ shell nozzle neck UT --- */
export const NZ_CONN = [['', '—'], ['RFWN', 'Raised face weld neck (RFWN)'], ['THD', 'Threaded (NPT)'], ['SO', 'Slip-on flange'], ['SW', 'Socket weld'], ['FF', 'Flat face'], ['OTH', 'Other']];
export const NZ_CONN_SHORT = { RFWN: 'RFWN', THD: 'Threaded', SO: 'Slip-on', SW: 'Socket weld', FF: 'Flat face', OTH: 'Other' };
export const UT_CLOCK = [['ut12', '12'], ['ut3', '3'], ['ut6', '6'], ['ut9', '9']];

/** Neck UT summary: min reading, % loss against nominal, and status against t-min. */
/** Nozzle neck nominal / minimum: entered values, else the pipe table for the construction code (tables.js). */
export function nozzleWall(n, job) {
  const tNom = n.tNom > 0 ? +n.tNom : null, tMin = n.tMin > 0 ? +n.tMin : null;
  if ((tNom && tMin) || !job || !(+n.size > 0)) return { tNom, tMin, src: tNom || tMin ? 'entered' : '' };
  const nps = +n.size / 25.4, ds = courseDesigns(job);
  const c = (job.shell?.courses || []).find((_, i) => n.elev != null && +n.elev >= (ds[i]?.z0 ?? 0) && +n.elev < (ds[i]?.z1 ?? 0)) || (job.shell?.courses || [])[0];
  const r = nozzleNeck(nps, job.tank?.code || 'Unknown', c?.tNom > 0 ? +c.tNom / 25.4 : null);
  if (!r) return { tNom, tMin, src: tNom || tMin ? 'entered' : '' };
  return { tNom: tNom ?? r.nom * 25.4, tMin: tMin ?? r.min * 25.4, src: `table (NPS ${r.nps} ${r.sched})`, nomTbl: !tNom, minTbl: !tMin };
}
export function nozzleUT(n, job) {
  const vals = [...UT_CLOCK.map(([k]) => n[k]), ...(n.utx || []).map((r) => r.t)].map((v) => (v === null || v === undefined || v === '' ? null : +v)).filter((v) => Number.isFinite(v));
  if (!vals.length) return { count: 0, min: null, lossPct: null, status: '' };
  const min = Math.min(...vals);
  const w = nozzleWall(n, job), tNom = w.tNom, tMin = w.tMin;
  const lossPct = tNom ? Math.max(0, ((tNom - min) / tNom) * 100) : null;
  // C-19: the table value is a construction minimum (pipe wall less mill tolerance), not a retirement thickness;
  // a nozzle is accepted only against an engineer-entered retirement thickness.
  const status = !tMin ? '' : w.minTbl ? (min < tMin - 1e-9 ? 'Below construction min.' : 'Retirement t not entered') : min < tMin - 1e-9 ? 'Below t-min' : 'OK';
  return { count: vals.length, min, lossPct, status, construction: !!w.minTbl };
}
