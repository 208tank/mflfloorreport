// Independent calculation verification library.
// Code references checked against API 653, 5th edition, Addendum 4 (July 2025) — the user's copy.
//
// Each case states its inputs, the hand-calculation steps, the expected result, the tolerance and where
// the expected result comes from. Expected values were worked out independently of the app's code
// (tests/verification/oracle.py reproduces them from the equations alone). `run()` calls the app and
// returns the actual values; the runner compares them.
//
// basis:
//   'equation'  expected value follows from a governing equation quoted in the report (the code reference
//               must still be confirmed against the user's edition of API 653)
//   'review'    behaviour this review proposes the software must have (an engineering-verification
//               requirement, not a code equation) — a FAIL here is a proposed correction, not a code error
//   'reference' expected value is a lookup from a figure / table that could not be checked here; the
//               case records the app's value and is marked UNVERIFIED until an engineer confirms it
import { newJob, migrate } from '../../js/model.js';
import { buildLayout, plateAt, toLocal, polar } from '../../js/geometry.js';
import { api653, nozzleUT } from '../../js/calc.js';
import { courseDesigns, fillFromT, annularReq } from '../../js/design.js';
import { allowables, annularMin, edgeAllow, nozzleNeck } from '../../js/tables.js';
import { courseSummary } from '../../js/shell.js';
import { settleCalc, edgeEval, depEval, profileEval, autoN, epOffsets, xKey } from '../../js/settle.js';
import { pointStatus, plateUT } from '../../js/roof.js';
import { gapSummary, cm2mToIn2ft } from '../../js/seal.js';
import { toMm } from '../../js/units.js';
import { patchList } from '../../js/patches.js';

const IN = 25.4, FT = 304.8;

/* ------------------------------------------------------------------ job builders --- */

/** Floor job: D (mm), tBottom (mm), years, Or; no annular ring. */
function floorJob({ units = 'imperial', D, tBottom, years = 20, Or = 10, calc = {}, annular = false, tAnnular = null, courses = [] }) {
  const job = newJob(units);
  Object.assign(job.tank, { diameter: D, tBottom, tAnnular });
  Object.assign(job.layout, { annular, annW: 24 * IN });
  Object.assign(job.calc, { years, Or, ...calc });
  job.shell.courses = courses;
  return job;
}
/** Indication at radius r (mm) and angle deg from the centre. */
function indAt(job, r, deg, o) {
  const L = buildLayout(job), [x, y] = polar(r, deg), p = plateAt(L, x, y), loc = toLocal(L, p, x, y);
  return { id: o.id, no: o.id, plate: p.key, x: loc.X, y: loc.Y, result: 'pending', repair: 'auto', ...o };
}
const evalFloor = (job) => { const L = buildLayout(job); return { L, c: api653(job, L) }; };
const region = (c, name) => c.regions.find((r) => r.name === name);

/** Shell job: D (mm), fill (mm), G, courses [{h, tNom, tMin?}], material and joint for all courses. */
function shellJob({ units = 'imperial', D, fill, G, courses, matl = 'ASTM A516 Gr. 55', joint = 'w:650-7:0' }) {
  const job = newJob(units);
  Object.assign(job.tank, { diameter: D, fillH: fill, sg: G, code: 'API 650', edition: 'Tenth, November 1998' });
  job.shell.matl = matl; job.shell.joint = joint;
  job.shell.courses = courses.map((c, i) => ({ id: 'c' + (i + 1), h: c.h, tNom: c.tNom ?? null, tMin: c.tMin ?? null }));
  return job;
}

/** Settlement job: D, H (mm), N stations, elevations (mm) by station, Y / E entered (MPa). */
function settleJob({ units = 'imperial', D, H, N, z, Y, E }) {
  const job = newJob(units);
  job.tank.diameter = D;
  job.shell.courses = [{ id: 'c1', h: H }];
  Object.assign(job.settle, { n: N, start: 0, yeAuto: false, Y, E, H, el: Object.fromEntries(z.map((v, i) => [i + 1, v])) });
  return job;
}
const cosZ = (N, a, b, c) => Array.from({ length: N }, (_, i) => a + b * Math.cos((2 * Math.PI * i) / N) + c * Math.sin((2 * Math.PI * i) / N));

/* ------------------------------------------------------------------------- cases --- */

export const CASES = [
  /* ---------------------------------------------------------------- 1. bottom MRT --- */
  {
    id: 'V-01', area: 'Bottom MRT', units: 'imperial', basis: 'equation',
    title: 'MRT with one soil-side (UT) and one product-side (VT) location',
    input: 'D 100 ft; nominal bottom 0.250 in; rate basis 20 yr; Or 10 yr. A: soil side, UT 0.180 in. B: product side, VT pit 0.040 in. Uncoated, no CP.',
    steps: ['UPr = (0.250 − 0.180) / 20 = 0.0035 in/yr', 'StPr = 0.040 / 20 = 0.0020 in/yr', 'RTbc = 0.180 in; RTip = 0.250 − 0.040 = 0.210 in', 'MRT = min(0.180, 0.210) − 10 × (0.0020 + 0.0035) = 0.125 in'],
    expected: { UPr: 0.0035 * IN, StPr: 0.002 * IN, MRT: 0.125 * IN, ok: true }, tol: 0.0005 * IN, unit: 'mm (shown in in)',
    source: 'API 653 (2025) §4.4.5.1: MRT = (minimum of RTbc or RTip) − Or (StPr + UPr); Table 4.4 limit 0.10 in',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'ss', utMin: 0.18 * IN }), indAt(job, 20 * FT, 120, { id: 'B', result: 'ps', vtDepth: 0.04 * IN })];
      const { c } = evalFloor(job), b = region(c, 'bottom');
      return { UPr: c.UPr, StPr: c.StPr, MRT: b.MRT, ok: b.ok };
    }
  },
  {
    id: 'V-02', area: 'Bottom MRT', units: 'metric', basis: 'equation',
    title: 'MRT, metric units',
    input: 'D 30 m; nominal bottom 6.0 mm; rate basis 20 yr; Or 10 yr. A: soil side, UT 4.5 mm. B: product side, VT pit 1.0 mm.',
    steps: ['UPr = (6.0 − 4.5) / 20 = 0.075 mm/yr', 'StPr = 1.0 / 20 = 0.050 mm/yr', 'MRT = min(4.5, 5.0) − 10 × 0.125 = 3.25 mm ≥ 2.54 mm'],
    expected: { UPr: 0.075, StPr: 0.05, MRT: 3.25, ok: true }, tol: 0.005, unit: 'mm',
    source: 'API 653 (2025) §4.4.5.1; Table 4.4a (2.54 mm)',
    run() {
      const job = floorJob({ units: 'metric', D: 30000, tBottom: 6 });
      job.indications = [indAt(job, 3000, 30, { id: 'A', result: 'ss', utMin: 4.5 }), indAt(job, 6000, 120, { id: 'B', result: 'ps', vtDepth: 1.0 })];
      const { c } = evalFloor(job), b = region(c, 'bottom');
      return { UPr: c.UPr, StPr: c.StPr, MRT: b.MRT, ok: b.ok };
    }
  },
  {
    id: 'V-03', area: 'Repair selection', units: 'imperial', basis: 'equation',
    title: 'A patched soil-side area keeps its corrosion rate in UPr (cause not removed)',
    input: 'As V-01 plus C: soil side, UT 0.110 in.',
    steps: ['UPr = 0.140/20 = 0.0070 (from C), StPr = 0.0020, K = 0.0090 in/yr', 'C projected = 0.110 − 0.090 = 0.020 in < 0.100 → patch C', '§4.4.5.1 Note 1: a repaired soil-side area keeps its rate in UPr unless the cause is removed → K stays 0.0090', 'A projected = 0.180 − 0.090 = 0.090 in < 0.100 → A must also be repaired (or Or shortened)', 'App drops C from the rates (K = 0.0055) and reports A as OK'],
    expected: { aOk: false, K: 0.009 * IN }, tol: 0.0005 * IN, unit: 'mm (shown in in)',
    source: 'API 653 (2025) §4.4.5.1 Note 1, 2nd paragraph (corrosion rate of repaired areas) — proposed correction C-24',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'ss', utMin: 0.18 * IN }), indAt(job, 20 * FT, 120, { id: 'B', result: 'ps', vtDepth: 0.04 * IN }), indAt(job, 30 * FT, 200, { id: 'C', result: 'ss', utMin: 0.11 * IN })];
      const { c } = evalFloor(job);
      return { aOk: c.per.get('A').status === 'OK' ? true : false, K: c.K, repairs: c.repairs.join(',') };
    }
  },
  {
    id: 'V-04', area: 'Bottom MRT', units: 'imperial', basis: 'equation',
    title: '"Both sides" location splits loss into product side (VT) and soil side (rest)',
    input: 'Nominal 0.250 in; UT 0.150 in; VT pit 0.040 in; rate basis 20 yr.',
    steps: ['Total loss = 0.250 − 0.150 = 0.100 in', 'Product side = VT pit = 0.040 in → StPr = 0.0020 in/yr', 'Soil side = 0.100 − 0.040 = 0.060 in → UPr = 0.0030 in/yr'],
    expected: { StPr: 0.002 * IN, UPr: 0.003 * IN }, tol: 0.00005 * IN, unit: 'mm/yr (shown in in/yr)',
    source: 'Split rule used by the app; API 653 defines StPr / UPr but not how a through-wall split is apportioned — engineering assumption',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'both', utMin: 0.15 * IN, vtDepth: 0.04 * IN })];
      const { c } = evalFloor(job);
      return { StPr: c.StPr, UPr: c.UPr };
    }
  },

  /* --------------------------------------------- MFL estimates vs verified thickness --- */
  {
    id: 'V-05', area: 'MFL vs UT', units: 'imperial', basis: 'equation',
    title: 'Proven soil-side location with only an MFL % estimate',
    input: 'Nominal 0.250 in; result soil side; MFL 40 % loss; no UT, no VT.',
    steps: ['Remaining = 0.250 × (1 − 0.40) = 0.150 in (MFL estimate)', 'A warning must say an MFL estimate was used'],
    expected: { rem: 0.15 * IN, src: 'MFL estimate', warned: true }, tol: 0.0005 * IN, unit: 'mm (shown in in)',
    source: 'App rule; MFL % is an estimate of loss, not a measured thickness',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'ss', mflPct: 40 })];
      const { c } = evalFloor(job), a = c.per.get('A');
      return { rem: a.rem, src: a.src, warned: c.warnings.some((w) => /MFL % estimate/.test(w)) };
    }
  },
  {
    id: 'V-06', area: 'MFL vs UT', units: 'imperial', basis: 'review',
    title: 'A location evaluated from an MFL estimate must not be reported as a plain "OK"',
    input: 'As V-05 (passes MRT only on the estimate).',
    steps: ['Projected = 0.150 − 10 × 0.005 = 0.100 in → passes by 0 margin on an estimate', 'Required: status distinguishes estimate from measured, e.g. "OK (MFL estimate — verify by UT)"'],
    expected: { estimateFlagInStatus: true }, tol: null, unit: '',
    source: 'This review (proposed correction C-03): an estimate must not be presented as an acceptance',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'ss', mflPct: 40 })];
      const { c } = evalFloor(job), a = c.per.get('A');
      return { estimateFlagInStatus: /estimate/i.test(a.status) };
    }
  },
  {
    id: 'V-07', area: 'MFL vs UT', units: 'imperial', basis: 'equation',
    title: 'Pending (unproven) MFL calls are excluded and the exclusion is reported',
    input: 'One proven soil-side location UT 0.200 in; one pending call MFL 60 %.',
    steps: ['Pending call excluded (includeUnverified off)', 'UPr = 0.050/20 = 0.0025; MRT = 0.200 − 0.025 = 0.175 in', 'Warning lists 1 pending call'],
    expected: { MRT: 0.175 * IN, warned: true }, tol: 0.0005 * IN, unit: 'mm (shown in in)',
    source: 'App rule; API 653 (2025) §4.4.4 — UT is used to confirm and quantify MFL data; unproven calls are an open item',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'ss', utMin: 0.2 * IN }), indAt(job, 15 * FT, 60, { id: 'P', mflPct: 60 })];
      const { c } = evalFloor(job);
      return { MRT: region(c, 'bottom').MRT, warned: c.warnings.some((w) => /pending prove-up/.test(w)) };
    }
  },
  {
    id: 'V-08', area: 'Input validation', units: 'imperial', basis: 'review',
    title: 'MFL loss over 100 % is rejected rather than giving a negative remaining thickness',
    input: 'Nominal 0.250 in; soil side; MFL 120 %.',
    steps: ['A loss over 100 % is not physical', 'Required: the value is refused or flagged; no negative remaining thickness enters the MRT'],
    expected: { remNonNegative: true }, tol: null, unit: '',
    source: 'This review (proposed correction C-09)',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'ss', mflPct: 120 })];
      const { c } = evalFloor(job);
      return { remNonNegative: c.per.get('A').rem >= 0 };
    }
  },

  /* ----------------------------------------------------------- corrosion rate basis --- */
  {
    id: 'V-09', area: 'Corrosion rates', units: 'imperial', basis: 'review',
    title: 'With no rate basis (years) the result must not read as acceptable',
    input: 'As V-01 but rate basis blank.',
    steps: ['Rates cannot be computed → MRT = RT (no corrosion allowance for the next interval)', 'Required: region result "not evaluated", not OK'],
    expected: { regionOk: null }, tol: null, unit: '',
    source: 'This review (proposed correction C-04)',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN, years: null });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'ss', utMin: 0.18 * IN })];
      const { c } = evalFloor(job);
      return { regionOk: region(c, 'bottom').ok };
    }
  },
  {
    id: 'V-10', area: 'Coating / CP', units: 'imperial', basis: 'review',
    title: '"Coated" with proven product-side pitting must not silently zero StPr',
    input: 'As V-01 with "coated" ticked. Location B is product-side pitting (coating evidently not intact there).',
    steps: ['API 653 sets StPr = 0 only for coated areas expected to last the interval', 'Required: StPr kept for proven product-side locations, or a warning that the coating option conflicts with recorded product-side corrosion'],
    expected: { conflictWarned: true }, tol: null, unit: '',
    source: 'API 653 (2025) §4.4.5.1: StPr = 0 only for coated areas with coating life ≥ Or — C-05',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN, calc: { coated: true } });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'ss', utMin: 0.18 * IN }), indAt(job, 20 * FT, 120, { id: 'B', result: 'ps', vtDepth: 0.04 * IN })];
      const { c } = evalFloor(job);
      return { conflictWarned: c.StPr > 0 || c.warnings.some((w) => /coat/i.test(w)) };
    }
  },
  {
    id: 'V-11', area: 'Coating / CP', units: 'imperial', basis: 'equation',
    title: 'Effective CP sets UPr = 0',
    input: 'As V-01 with "effective CP" ticked.',
    steps: ['UPr = 0; StPr = 0.0020 in/yr', 'MRT = 0.180 − 10 × 0.0020 = 0.160 in'],
    expected: { UPr: 0, MRT: 0.16 * IN }, tol: 0.0005 * IN, unit: 'mm (shown in in)',
    source: 'API 653 (2025) §4.4.5.1: UPr = 0 for areas with effective cathodic protection',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN, calc: { cp: true } });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'ss', utMin: 0.18 * IN }), indAt(job, 20 * FT, 120, { id: 'B', result: 'ps', vtDepth: 0.04 * IN })];
      const { c } = evalFloor(job);
      return { UPr: c.UPr, MRT: region(c, 'bottom').MRT };
    }
  },

  /* ------------------------------------------------------------------- critical zone --- */
  {
    id: 'V-12', area: 'Critical zone', units: 'imperial', basis: 'equation',
    title: 'Critical-zone limit = smaller of 0.118 in or 50 % of course-1 t-min, not less than 0.10 in',
    input: 'Bottom 0.250 in, no annular ring; course 1 t-min entered 0.300 in. Soil-side UT 0.150 in, 2 in from the shell; rate basis 20 yr; Or 10.',
    steps: ['§4.4.5.4: limit = max(0.10, min(0.118, 0.300/2)) = 0.118 in (0.118 in = ½ of the API 650 minimum bottom, fixed — not ½ of this tank\'s bottom)', 'App uses ½ × 0.250 = 0.125 in (conservative here, by 0.007 in)', 'UPr = 0.005; projected = 0.100 in < 0.118 → repair'],
    expected: { czLim: 0.118 * IN, critical: true, repair: true }, tol: 0.0005 * IN, unit: 'mm (shown in in)',
    source: 'API 653 (2025) §4.4.5.4; critical zone defined in §3.11 — proposed correction C-21',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN, courses: [{ id: 'c1', h: 8 * FT, tNom: 0.5 * IN, tMin: 0.3 * IN }] });
      job.indications = [indAt(job, 50 * FT - 2 * IN, 90, { id: 'A', result: 'ss', utMin: 0.15 * IN })];
      const { c } = evalFloor(job), a = c.per.get('A');
      return { czLim: c.czLim, critical: a.critical, repair: a.repair };
    }
  },
  {
    id: 'V-13', area: 'Critical zone', units: 'metric', basis: 'equation',
    title: 'Critical-zone limit in SI units',
    input: 'Bottom 8 mm; course 1 t-min 5 mm.',
    steps: ['§4.4.5.4 (SI): limit = max(2.5, min(3, 5/2)) = 2.5 mm', 'App floors at 2.54 mm (0.10 in converted) — 0.04 mm conservative'],
    expected: { czLim: 2.5 }, tol: 0.005, unit: 'mm',
    source: 'API 653 (2025) §4.4.5.4 (SI values 3 mm / 2.5 mm) — C-21',
    run() {
      const job = floorJob({ units: 'metric', D: 30000, tBottom: 8, courses: [{ id: 'c1', h: 2400, tNom: 10, tMin: 5 }] });
      return { czLim: evalFloor(job).c.czLim };
    }
  },
  {
    id: 'V-14', area: 'Critical zone', units: 'imperial', basis: 'equation',
    title: 'Critical-zone boundary at 3 in from the shell',
    input: 'Location centres 2.9 in and 3.1 in from the shell.',
    steps: ['2.9 in ≤ 3 in → critical zone', '3.1 in > 3 in → not critical zone'],
    expected: { at29: true, at31: false }, tol: null, unit: '',
    source: 'API 653 definition of critical zone (within 3 in of the inside edge of the shell)',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN });
      job.indications = [indAt(job, 50 * FT - 2.9 * IN, 45, { id: 'A', result: 'ss', utMin: 0.2 * IN }), indAt(job, 50 * FT - 3.1 * IN, 135, { id: 'B', result: 'ss', utMin: 0.2 * IN })];
      const { c } = evalFloor(job);
      return { at29: c.per.get('A').critical, at31: c.per.get('B').critical };
    }
  },
  {
    id: 'V-15', area: 'Critical zone', units: 'imperial', basis: 'review',
    title: 'A corroded area that extends into the critical zone is treated as critical',
    input: 'Location centre 4 in from the shell; recorded width 3 in (inner edge of the corrosion 2.5 in from the shell).',
    steps: ['Corrosion reaches 2.5 in from the shell → inside the 3 in critical zone', 'Required: critical = true (or the app asks the inspector)'],
    expected: { critical: true }, tol: null, unit: '',
    source: 'This review (proposed correction C-06): the app tests only the location point',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN });
      job.indications = [indAt(job, 50 * FT - 4 * IN, 45, { id: 'A', result: 'ss', utMin: 0.2 * IN, len: 3 * IN, wid: 3 * IN })];
      return { critical: evalFloor(job).c.per.get('A').critical };
    }
  },

  /* -------------------------------------------------------------------- annular plates --- */
  {
    id: 'V-16', area: 'Annular plates', units: 'imperial', basis: 'equation',
    title: 'Table 4.5 lookup between stress columns',
    input: 'Course 1 t = 0.75 in; computed stress Sb = 25,000 psi (column "≤ 27,000").',
    steps: ['Sb = 2.34 D (H − 1) / t (Table 4.5b Note b) = 25,000 psi', '§4.4.6.2 allows interpolation within Table 4.5 on this stress', 't = 0.17 + (25,000 − 24,300)/(27,000 − 24,300) × (0.20 − 0.17) = 0.1778 in'],
    expected: { t: 0.177778, Sb: 25000 }, tol: 0.001, unit: 'in',
    source: 'API 653 (2025) §4.4.6.2 and Table 4.5b (values and Note b checked)',
    run() {
      const Dft = 100, t1 = 0.75, H = 1 + (25000 * t1) / (2.34 * Dft); // gives Sb = 25,000 with the app's Sb formula
      const r = annularMin(Dft, H, 0.85, t1);
      return { t: r.t, Sb: r.Sb };
    }
  },
  {
    id: 'V-17', area: 'Annular plates', units: 'imperial', basis: 'equation',
    title: 'Table 4.5 at a column boundary',
    input: 'Course 1 t = 1.00 in; Sb exactly 27,000 psi.',
    steps: ['Row 0.75 < t ≤ 1.00, column ≤ 27,000 → 0.22 in'],
    expected: { t: 0.22 }, tol: 0.001, unit: 'in',
    source: 'API 653 (2025) Table 4.5b (checked)',
    run() { const t1 = 1, H = 1 + (27000 * t1) / (2.34 * 100); return { t: annularMin(100, H, 0.85, t1).t }; }
  },
  {
    id: 'V-18', area: 'Annular plates', units: 'imperial', basis: 'review',
    title: 'Default annular MRT limit when an annular ring is present',
    input: 'New job with annular ring ticked; Table 4.5 gives 0.17 in or more.',
    steps: ['App default annular limit = 0.10 in until the user presses "use Table 4.5"', 'Required: the Table 4.5 / 5.1b value is the default when it can be computed, or the limit is flagged as not set'],
    expected: { defaultAtLeastTable: true }, tol: null, unit: '',
    source: 'This review (proposed correction C-08)',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN, annular: true, tAnnular: 0.3125 * IN, courses: [{ id: 'c1', h: 8 * FT, tNom: 0.75 * IN }] });
      job.tank.fillH = 40 * FT; job.tank.sg = 0.85;
      const req = annularReq(job);
      return { defaultAtLeastTable: req?.tmm != null && (job.calc.mrtAnnular ?? 2.54) >= req.tmm - 1e-6, tableIn: req?.t, defaultIn: (job.calc.mrtAnnular ?? 2.54) / IN };
    }
  },

  /* ----------------------------------------------------------------- shell evaluation --- */
  {
    id: 'V-19', area: 'Shell t-min', units: 'imperial', basis: 'equation',
    title: 'Course t-min by API 653 4.3.3.1 (lower two courses use the lower-course Sd)',
    input: 'D 100 ft; fill 40 ft; G 1.0; 5 courses × 8 ft; A516 Gr 55 (Table 4.1 Sd 23,600 lower / 26,000 upper); E 1.0.',
    steps: ['Course 1: H = 40 → 2.6 × 39 × 100 × 1.0 / (23,600 × 1.0) = 0.4297 in', 'Course 2: H = 32 → 2.6 × 31 × 100 / 23,600 = 0.3415 in', 'Course 3: H = 24 → 2.6 × 23 × 100 / 26,000 = 0.2300 in', 'Course 5: H = 8 → 0.070 → minimum 0.100 in'],
    expected: { c1: 0.429661, c2: 0.341525, c3: 0.23, c5: 0.1 }, tol: 0.0005, unit: 'in',
    source: 'API 653 (2025) §4.3.3.1 a): t-min = 2.6 (H − 1) D G / (S E), not less than 0.10 in; S per Table 4.1b',
    run() {
      const job = shellJob({ D: 100 * FT, fill: 40 * FT, G: 1, courses: Array.from({ length: 5 }, () => ({ h: 8 * FT })) });
      const d = courseDesigns(job);
      return { c1: d[0].tmin / IN, c2: d[1].tmin / IN, c3: d[2].tmin / IN, c5: d[4].tmin / IN };
    }
  },
  {
    id: 'V-20', area: 'Shell t-min', units: 'metric', basis: 'equation',
    title: 'Course 1 t-min, metric input',
    input: 'D 30 m (98.425 ft); fill 12 m (39.370 ft); G 0.9; A516 Gr 60 (Sd lower 25,600 psi); E 0.85 (API 650 Annex A spot RT).',
    steps: ['t-min = 2.6 × (39.370 − 1) × 98.425 × 0.9 / (25,600 × 0.85) = 0.40612 in = 10.315 mm'],
    expected: { tmin: 10.3155 }, tol: 0.01, unit: 'mm',
    source: 'API 653 (2025) §4.3.3.1 a) (USC form, as the app computes); Table 4.2b E = 0.85 — the SI form 4.9 (H − 0.3) D G / (S E) gives about 10.29 mm (C-27)',
    run() {
      const job = shellJob({ units: 'metric', D: 30000, fill: 12000, G: 0.9, matl: 'ASTM A516 Gr. 60', joint: 'w:650-7:1', courses: [{ h: 2400 }, { h: 2400 }] });
      return { tmin: courseDesigns(job)[0].tmin };
    }
  },
  {
    id: 'V-21', area: 'Shell t-min', units: 'imperial', basis: 'equation',
    title: 'Allowable stresses from Y and T for a material not in Table 4.1',
    input: 'Y = 36,000 psi; T = 58,000 psi.',
    steps: ['Sd lower = min(0.80 Y, 0.429 T) = min(28,800, 24,882) = 24,882', 'Sd upper = min(0.88 Y, 0.472 T) = 27,376', 'St lower = min(0.88 Y, 0.472 T) = 27,376', 'St upper = min(0.90 Y, 0.519 T) = 30,102'],
    expected: { SdL: 24882, SdU: 27376, StL: 27376, StU: 30102 }, tol: 1, unit: 'psi',
    source: 'API 653 (2025) §4.3.3.1 (S) and §4.3.3.2 (St) rules; Table 4.1b',
    run() {
      const lo = allowables('Other', 36000, 58000, true, false), up = allowables('Other', 36000, 58000, false, false);
      return { SdL: lo.Sd, SdU: up.Sd, StL: lo.St, StU: up.St };
    }
  },
  {
    id: 'V-22', area: 'Shell t-min', units: 'imperial', basis: 'equation',
    title: 'Hydrotest and product fill heights supported by a thickness',
    input: 'D 100 ft; course 1 t = 0.500 in; A516 Gr 55 (Sd 23,600, St 26,000); E 1.0; G 1.0.',
    steps: ['Ht = St E t / (2.6 D) + 1 = 26,000 × 0.5 / 260 + 1 = 51.0 ft', 'H fill = Sd E t / (2.6 D G) + 1 = 46.38 ft'],
    expected: { Ht: 51.0, Hfill: 46.3846 }, tol: 0.01, unit: 'ft',
    source: 'API 653 (2025) §4.3.3.2 (hydrotest height); inverse of §4.3.3.1 a)',
    run() {
      const job = shellJob({ D: 100 * FT, fill: 40 * FT, G: 1, courses: [{ h: 8 * FT, tNom: 0.5 * IN }] });
      const d = courseDesigns(job)[0], r = fillFromT(job, d, 0.5 * IN);
      return { Ht: r.hydro / FT, Hfill: r.prod / FT };
    }
  },
  {
    id: 'V-23', area: 'Shell evaluation', units: 'imperial', basis: 'equation',
    title: 'Course status from the minimum reading',
    input: 'Course 1 t-min entered 0.430 in; readings 0.450, 0.432, 0.428 in.',
    steps: ['Minimum 0.428 < 0.430 → "Below t-min" (single reading compared with the whole-course t-min)'],
    expected: { status: 'Below t-min', min: 0.428 * IN }, tol: 0.0005 * IN, unit: 'mm',
    source: 'API 653 (2025) §4.3.3.1 a) (whole course). §4.3.2 averaging and §4.3.3.1 b) (H for a location) are not applied — C-18',
    run() {
      const job = shellJob({ D: 100 * FT, fill: 40 * FT, G: 1, courses: [{ h: 8 * FT, tNom: 0.5 * IN, tMin: 0.43 * IN }] });
      job.shell.nLoc = 4; job.shell.zones = []; job.shell.rd = { '0.0': { [(12 * IN).toFixed(1)]: 0.45 * IN }, '90.0': { [(12 * IN).toFixed(1)]: 0.432 * IN }, '180.0': { [(12 * IN).toFixed(1)]: 0.428 * IN } };
      const s = courseSummary(job)[0];
      return { status: s.status, min: s.min };
    }
  },

  /* ------------------------------------------------------------------------- nozzles --- */
  {
    id: 'V-24', area: 'Nozzles', units: 'imperial', basis: 'equation',
    title: 'Neck minimum, % loss and status',
    input: 'NPS 4 Sch 80: nominal 0.337 in; t-min entered 0.200 in; readings 0.301, 0.255, 0.290, 0.300 in.',
    steps: ['Minimum = 0.255 in', 'Loss = (0.337 − 0.255) / 0.337 = 24.33 %', '0.255 ≥ 0.200 → OK'],
    expected: { min: 0.255 * IN, lossPct: 24.3323, status: 'OK' }, tol: 0.01, unit: 'mm / %',
    source: 'Arithmetic; the t-min itself is an engineering input (API 653 gives no neck retirement rule; C-19)',
    run() {
      const n = { size: 4 * IN, tNom: 0.337 * IN, tMin: 0.2 * IN, ut12: 0.301 * IN, ut3: 0.255 * IN, ut6: 0.29 * IN, ut9: 0.3 * IN };
      const r = nozzleUT(n, newJob());
      return { min: r.min, lossPct: r.lossPct, status: r.status };
    }
  },

  /* ---------------------------------------------------------------------------- roofs --- */
  {
    id: 'V-25', area: 'Fixed roof', units: 'imperial', basis: 'equation',
    title: 'Fixed roof point below the 0.09 in limit',
    input: 'Roof t-min 0.09 in (default); point reading 0.085 in; nominal 0.1875 in.',
    steps: ['0.085 < 0.090 → "Below t-min"; loss = (0.1875 − 0.085)/0.1875 = 54.7 %'],
    expected: { status: 'Below t-min', lossPct: 54.6667 }, tol: 0.01, unit: '%',
    source: 'API 653 (2025) §4.2.1.2: 0.09 in average over any 100 in² (2.2 mm over 250 × 250 mm) — the app compares single points (conservative)',
    run() { const job = newJob(); job.roof.type = 'fixed'; job.roof.fixed.tNom = 0.1875 * IN; const r = pointStatus(job, { t: 0.085 * IN }); return { status: r.status, lossPct: r.lossPct }; }
  },
  {
    id: 'V-26', area: 'Fixed roof', units: 'metric', basis: 'equation',
    title: 'Metric default roof limit is not less than 0.09 in',
    input: 'New metric job.',
    steps: ['SI limit in §4.2.1.2 is 2.2 mm; 0.09 in = 2.286 mm; app default 2.3 mm (≥ both → conservative)'],
    expected: { atLeast: true }, tol: null, unit: '',
    source: 'Unit conversion check',
    run() { const job = newJob('metric'); return { atLeast: job.roof.fixed.tMin >= 0.09 * IN - 1e-9 }; }
  },
  {
    id: 'V-27', area: 'Floating roof', units: 'imperial', basis: 'equation',
    title: 'Deck plate minimum of five readings',
    input: 'Deck nominal 0.1875 in; t-min 0.09 in; readings 0.18, 0.17, 0.088, 0.16, 0.175 in.',
    steps: ['Minimum 0.088 < 0.090 → "Below t-min"'],
    expected: { status: 'Below t-min', min: 0.088 * IN }, tol: 0.0005 * IN, unit: 'mm',
    source: 'API 653 (2025) §4.2.1.2 applies to all roof plates: 0.09 in averaged over any 100 in² (app compares single points)',
    run() {
      const job = newJob(); job.roof.type = 'efr'; job.roof.floating.deckNom = 0.1875 * IN;
      job.roof.floating.ut = { A1: { tl: 0.18 * IN, tr: 0.17 * IN, c: 0.088 * IN, bl: 0.16 * IN, br: 0.175 * IN } };
      const r = plateUT(job, { key: 'A1', kind: 'floor' });
      return { status: r.status, min: r.min };
    }
  },
  {
    id: 'V-28', area: 'Rim seal', units: 'metric', basis: 'equation',
    title: 'Seal gap area per metre of diameter',
    input: 'D 30 m; two gaps each 1,000 mm long × 10 mm average width.',
    steps: ['Area = 2 × (100 cm × 1 cm) = 200 cm²', 'Per metre of diameter = 200 / 30 = 6.667 cm²/m'],
    expected: { perM: 6.6667 }, tol: 0.001, unit: 'cm²/m',
    source: '40 CFR 60.113b (gap area per metre of tank diameter)',
    run() { return { perM: gapSummary([{ len: 1000, wAvg: 10 }, { len: 1000, wAvg: 10 }], 30000).perM }; }
  },
  {
    id: 'V-29', area: 'Rim seal', units: 'imperial', basis: 'equation',
    title: 'cm²/m ↔ in²/ft conversion',
    input: '212 cm²/m.',
    steps: ['1 in²/ft = 6.4516 cm² / 0.3048 m = 21.1667 cm²/m', '212 / 21.1667 = 10.016 in²/ft'],
    expected: { inft: 10.0157 }, tol: 0.0002, unit: 'in²/ft',
    source: 'Exact unit definitions (1 in = 2.54 cm)',
    run() { return { inft: cm2mToIn2ft(212) }; }
  },

  /* ---------------------------------------------------------------------- settlement --- */
  {
    id: 'V-30', area: 'Settlement — cosine fit', units: 'imperial', basis: 'equation',
    title: 'Exact cosine data: fit, tilt and high point',
    input: 'D 100 ft; H 40 ft; 8 stations; z = 10 + 2 cos θ + 1 sin θ (in).',
    steps: ['Least squares returns a = 10, b = 2, c = 1; R² = 1', 'Amplitude = √(2² + 1²) = 2.2361 in; tilt across the diameter = 4.4721 in', 'High side at atan2(1, 2) = 26.57°'],
    expected: { b: 2 * IN, c: 1 * IN, R2: 1, tilt: 4.472136 * IN, hiDeg: 26.565051 }, tol: 0.001, unit: 'mm / °',
    source: 'API 653 (2025) B.2.2.4 e) (least-squares optimum cosine curve)',
    run() {
      const job = settleJob({ D: 100 * FT, H: 40 * FT, N: 8, z: cosZ(8, 10 * IN, 2 * IN, 1 * IN), Y: 206.843, E: 199948 });
      const f = settleCalc(job).fit;
      return { b: f.b, c: f.c, R2: f.R2, tilt: f.tilt, hiDeg: f.hiDeg };
    }
  },
  {
    id: 'V-31', area: 'Settlement — out-of-plane', units: 'imperial', basis: 'equation',
    title: 'Out-of-plane deflection S and Smax',
    input: 'D 100 ft; H 40 ft; 10 stations (L = 31.416 ft); z = 2 cos θ + 1 sin θ in, +0.5 in at station 3; Y 30,000 psi; E 29,000,000 psi.',
    steps: ['Fit by least squares (independent numpy solve): R² = 0.99347', 'U = z − fit; S₃ = U₃ − ½(U₂ + U₄) = 0.4809 in', 'Smax = 11 L² Y / (2 E H) = 11 × 31.416² × 30,000 / (2 × 29e6 × 40) ft = 1.6846 in', '|S| ≤ Smax → acceptable'],
    expected: { R2: 0.993469, S3: 0.480902 * IN, Smax: 1.684639 * IN, oopOk: true }, tol: 0.001 * IN, unit: 'mm',
    source: 'API 653 (2025) B.3.2.1 and Figure B.3: Smax = (L² × Y × 11) / [2 (E × H)]',
    run() {
      const z = cosZ(10, 0, 2 * IN, 1 * IN); z[2] += 0.5 * IN;
      const c = settleCalc(settleJob({ D: 100 * FT, H: 40 * FT, N: 10, z, Y: 30000 / 145.0377, E: 29e6 / 145.0377 }));
      return { R2: c.fit.R2, S3: c.pts[2].S, Smax: c.Smax, oopOk: c.oopOk };
    }
  },
  {
    id: 'V-32', area: 'Settlement — out-of-plane', units: 'metric', basis: 'equation',
    title: 'Out-of-plane deflection, metric',
    input: 'D 30 m; H 12 m; 10 stations; z = 50 cos θ + 25 sin θ mm, +12 mm at station 3; Y 206.8 MPa; E 200,000 MPa.',
    steps: ['S₃ = 11.5416 mm (independent solve)', 'Smax = 11 L² Y / (2 E H) with L = π × 30,000 / 10 mm = 42.096 mm'],
    expected: { S3: 11.541641, Smax: 42.09633, R2: 0.993963 }, tol: 0.01, unit: 'mm',
    source: 'API 653 (2025) B.3.2.1 SI form (consistent units: L²/H is a length, Y/E dimensionless)',
    run() {
      const z = cosZ(10, 0, 50, 25); z[2] += 12;
      const c = settleCalc(settleJob({ units: 'metric', D: 30000, H: 12000, N: 10, z, Y: 206.8, E: 200000 }));
      return { S3: c.pts[2].S, Smax: c.Smax, R2: c.fit.R2 };
    }
  },
  {
    id: 'V-33', area: 'Settlement — R²', units: 'imperial', basis: 'equation',
    title: 'Poor cosine fit is not evaluated by B.3.2.1',
    input: '8 stations; random-looking elevations (R² < 0.9).',
    steps: ['R² < 0.90 → cosine fit not valid for out-of-plane check; result must not be "Acceptable" from B.3.2.1'],
    expected: { valid: false, notAcceptableByB321: true }, tol: null, unit: '',
    source: 'API 653 (2025) B.2.2.4 e): cosine curve valid only if R² ≥ 0.9',
    run() {
      const z = [0, 1.2, -0.9, 0.8, -1.1, 0.7, -0.6, 1.0].map((v) => v * IN);
      const c = settleCalc(settleJob({ D: 100 * FT, H: 40 * FT, N: 8, z, Y: 206.843, E: 199948 }));
      return { valid: c.valid, notAcceptableByB321: c.status !== 'Acceptable' || c.arcs.ok !== null };
    }
  },
  {
    id: 'V-34', area: 'Settlement — stations', units: 'imperial', basis: 'equation',
    title: 'Number of settlement stations',
    input: 'D = 40, 150, 330, 400 ft.',
    steps: ['N = D/10 rounded up to even, at least 8, spacing ≤ 32 ft', '40 → 4 → 8; 150 → 15 → 16; 330 → 33 → 34; 400 → 40'],
    expected: { D40: 8, D150: 16, D330: 34, D400: 40 }, tol: 0, unit: '',
    source: 'API 653 (2025) §12.5.2 (even number, N ≥ D/10) and Figure B.1 (≥ 8 points, spacing ≤ 32 ft)',
    run() { const n = (d) => { const j = newJob(); j.tank.diameter = d * FT; return autoN(j); }; return { D40: n(40), D150: n(150), D330: n(330), D400: n(400) }; }
  },
  {
    id: 'V-35', area: 'Settlement — edge', units: 'imperial', basis: 'equation',
    title: 'Angled lap weld allowable',
    input: 'Be = 4.0 in, Bew = 3.0 in, α = 45°.',
    steps: ['B = Be − (Be − Bew) sin α = 4.0 − 1.0 × 0.7071 = 3.2929 in'],
    expected: { allow: 3.292893 * IN }, tol: 0.0005 * IN, unit: 'mm',
    source: 'API 653 (2025) B.3.4.4: α = angle of the weld to a tank centreline (Figure B.13)',
    run() { return { allow: edgeEval({ B: 1 * IN, Be: 4 * IN, Bew: 3 * IN, weld: 'angle', alpha: 45 }).allow }; }
  },
  {
    id: 'V-36', area: 'Settlement — edge', units: 'imperial', basis: 'equation',
    title: 'Angled lap welds: figure values inside the ±20° bands, the B.3.4.4 formula between',
    input: 'Be 4.0, Bew 3.0 in; α (weld to tank centreline) = 19.9°, 20.1°, 70.1°.',
    steps: ['α ≤ 20°: weld essentially perpendicular to the shell → Be = 4.0 (B.3.4.3)', 'α = 20.1°: B = 4.0 − 1.0 × sin 20.1° = 3.656 in (B.3.4.4)', 'α ≥ 70°: essentially parallel → Bew = 3.0 (B.3.4.1). The step at 20° is in the standard, not the app.'],
    expected: { a199: 4 * IN, a201: 3.656297 * IN, a701: 3 * IN }, tol: 0.001 * IN, unit: 'mm',
    source: 'API 653 (2025) B.3.4.1, B.3.4.3, B.3.4.4 and Figure B.13',
    run() {
      const a = (al) => edgeEval({ B: 1, Be: 4 * IN, Bew: 3 * IN, weld: 'angle', alpha: al }).allow;
      return { a199: a(19.9), a201: a(20.1), a701: a(70.1) };
    }
  },
  {
    id: 'V-37', area: 'Settlement — edge', units: 'imperial', basis: 'equation',
    title: '75 % of allowable triggers NDE',
    input: 'Allowable Bew 4.0 in (weld parallel); B = 3.0 in and 2.99 in.',
    steps: ['3.00 / 4.00 = 75 % → "NDE required"', '2.99 / 4.00 = 74.75 % → "Acceptable"'],
    expected: { at75: 'NDE required', below: 'Acceptable' }, tol: null, unit: '',
    source: 'API 653 (2025) B.3.4.1–3 (measured B exceeds 75 %); the app uses ≥ 75 % (slightly stricter)',
    run() { return { at75: edgeEval({ B: 3 * IN, Bew: 4 * IN, Be: 5 * IN, weld: 'par' }).status, below: edgeEval({ B: 2.99 * IN, Bew: 4 * IN, Be: 5 * IN, weld: 'par' }).status }; }
  },
  {
    id: 'V-38', area: 'Settlement — edge', units: 'imperial', basis: 'equation',
    title: 'Fig. B.11b / B.12b allowables match the built-in table',
    input: 'D 100 and 160 ft; R 3 and 6 ft.',
    steps: ['Read from Fig. B.11b (2025): D 100, R 6 → 5.45 in; D 160, R 6 → 6.9 in; D 100, R 3 → 3.48 in', 'Read from Fig. B.12b: D 100, R 6 → 6.7 in; D 160, R 6 → 8.0 in; D 100, R 3 → 4.2 in', 'Reading accuracy of the figure about ±0.05 in'],
    expected: { Bew100r6: 5.45, Bew160r6: 6.9, Bew100r3: 3.48, Be100r6: 6.7, Be160r6: 8.0, Be100r3: 4.2 }, tol: 0.06, unit: 'in',
    source: 'API 653 (2025) Figures B.11b and B.12b, read by this review',
    run() { const a = edgeAllow(100, 6), b = edgeAllow(160, 6), c = edgeAllow(100, 3); return { Bew100r6: a.Bew, Bew160r6: b.Bew, Bew100r3: c.Bew, Be100r6: a.Be, Be160r6: b.Be, Be100r3: c.Be }; }
  },
  {
    id: 'V-39', area: 'Settlement — edge', units: 'imperial', basis: 'equation',
    title: 'Diameters below the smallest tabulated curve are not extrapolated non-conservatively',
    input: 'D 15 ft (below the 20 ft curve); R 3 ft.',
    steps: ['Allowables grow with diameter, so using the 20 ft curve for a 15 ft tank overstates the allowable', 'Required: no value (engineering evaluation) or a conservative value below the tabulated range'],
    expected: { Bew: null }, tol: null, unit: '',
    source: 'API 653 (2025) Figures B.11 / B.12 have no curve below 20 ft (6 m) — C-12',
    run() { return { Bew: edgeAllow(15, 3).Bew }; }
  },
  {
    id: 'V-40', area: 'Settlement — edge profile', units: 'imperial', basis: 'equation',
    title: 'Breakover R and settlement B from a radial profile',
    input: 'Readings from the shell inward: bottom flat at 0 beyond 36 in; linear drop to −2.0 in at the shell; tolerance 1/8 in.',
    steps: ['Line through outer readings: z = 0', 'Walking inward, 36 in is within tolerance; 24 in is 0.667 in low → breakover R = 36 in = 3 ft', 'B = largest drop inside R = 2.0 in (at the shell)'],
    expected: { R: 36 * IN, B: 2 * IN }, tol: 0.01 * IN, unit: 'mm',
    source: 'API 653 (2025) Figure B.6 and B.2.3.3 (definitions of B and R); breakover tolerance is an engineering choice',
    run() {
      const job = newJob(); job.tank.diameter = 100 * FT;
      const offs = epOffsets(job), m = {};
      for (const x of offs) m[xKey(x)] = x >= 36 * IN ? 0 : -2 * IN * (1 - x / (36 * IN));
      job.settle.ep.rd = { 1: m };
      const p = profileEval(job, 1);
      return { R: p.R, B: p.B };
    }
  },
  {
    id: 'V-41', area: 'Settlement — depressions', units: 'imperial', basis: 'equation',
    title: 'Bottom depression limit BB = 0.37 R',
    input: 'R = 10 ft; depth B = 3.5 in.',
    steps: ['BB = 0.37 × 10 = 3.70 in', '3.5 ≤ 3.70 → acceptable'],
    expected: { allow: 3.7 * IN, status: 'Acceptable' }, tol: 0.001 * IN, unit: 'mm',
    source: 'API 653 (2025) B.3.3: BB = 0.37 R (BB in in, R in ft)',
    run() { const r = depEval({ R: 10 * FT, B: 3.5 * IN }); return { allow: r.allow, status: r.status }; }
  },
  {
    id: 'V-42', area: 'Settlement — depressions', units: 'metric', basis: 'equation',
    title: 'Bottom depression limit, metric',
    input: 'R = 3.0 m; depth 95 mm.',
    steps: ['R = 9.8425 ft → BB = 0.37 × 9.8425 = 3.6417 in = 92.50 mm', '95 > 92.50 → exceeds'],
    expected: { allow: 92.5, status: 'Exceeds' }, tol: 0.01, unit: 'mm',
    source: 'API 653 (2025) B.3.3; SI form BB = 0.031 R gives 93.0 mm — the app’s 92.5 mm is 0.5 % stricter',
    run() { const r = depEval({ R: 3000, B: 95 }); return { allow: r.allow, status: r.status }; }
  },

  {
    id: 'V-46', area: 'Settlement — B.3.2.2 arcs', units: 'imperial', basis: 'equation',
    title: 'Arc method: deflection below the chord, K and the allowable',
    input: 'D 100 ft; H 40 ft; 8 stations; elevations 2, 0, 1.5, 0, 2, 0, 1.5, 0 in (high points at stations 1, 3, 5, 7).',
    steps: ['Arc 1→3: chord at station 2 = (2 + 1.5)/2 = 1.75 in; station 2 is at 0 → deflection 1.75 in', 'K = 6.5 (open top, 80 < D ≤ 120 ft); Sarc = 2 × π × 100 / 8 = 78.54 ft', 'Smax = K · Sarc · (D/H) · (Y/E) = 6.5 × 78.54 × 2.5 × (30,000 / 29,000,000) = 1.320 in (USC: Sarc in ft, Smax in in)', 'Cap: printed as 100 (USC) and 4.0 (SI) — inconsistent; app uses 4 in (engineer to decide, C-13)'],
    expected: { maxDef: 1.75 * IN, K: 6.5, allowIn: 1.320283 }, tol: 0.001 * IN, unit: 'mm / in',
    source: 'API 653 (2025) B.3.2.2 equation and K table (checked)',
    run() {
      const z = [2, 0, 1.5, 0, 2, 0, 1.5, 0].map((v) => v * IN);
      const c = settleCalc(settleJob({ D: 100 * FT, H: 40 * FT, N: 8, z, Y: 206.843, E: 199948 }));
      const a = c.arcs.arcs.find((x) => x.from === 1);
      return { maxDef: a?.maxDef, K: c.arcs.K, allowIn: a?.allow == null ? null : a.allow / IN };
    }
  },

  {
    id: 'V-47', area: 'Critical zone', units: 'imperial', basis: 'equation',
    title: 'Critical-zone limit for a thin (3/16 in) bottom',
    input: 'Bottom 0.1875 in; course 1 t-min 0.400 in.',
    steps: ['§4.4.5.4: max(0.10, min(0.118, 0.400/2)) = 0.118 in', 'App: max(0.10, min(0.1875/2, 0.200)) = 0.100 in → 0.018 in non-conservative'],
    expected: { czLim: 0.118 * IN }, tol: 0.0005 * IN, unit: 'mm (shown in in)',
    source: 'API 653 (2025) §4.4.5.4 — C-21',
    run() { const job = floorJob({ D: 100 * FT, tBottom: 0.1875 * IN, courses: [{ id: 'c1', h: 8 * FT, tNom: 0.5 * IN, tMin: 0.4 * IN }] }); return { czLim: evalFloor(job).c.czLim }; }
  },
  {
    id: 'V-48', area: 'Corrosion rates', units: 'imperial', basis: 'equation',
    title: 'MFL threshold governs UPr where the bottom was MFL-scanned without effective CP',
    input: 'Bottom 0.250 in; tank age 20 yr; MFL threshold = 40 % loss (0.150 in remaining); unrepaired soil-side minimum UT 0.200 in; no CP.',
    steps: ['§4.4.5.1 Note 1: thickness for UPr = lesser of the MFL threshold (0.150) and the minimum unrepaired thickness (0.200) = 0.150 in', 'UPr = (0.250 − 0.150) / 20 = 0.0050 in/yr', 'App has no MFL threshold input: UPr = (0.250 − 0.200) / 20 = 0.0025 in/yr (half)'],
    expected: { UPr: 0.005 * IN }, tol: 0.00005 * IN, unit: 'mm/yr (shown in in/yr)',
    source: 'API 653 (2025) §4.4.5.1 Note 1 — C-22',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN, calc: { mflThresholdPct: 40 } });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'ss', utMin: 0.2 * IN })];
      return { UPr: evalFloor(job).c.UPr };
    }
  },
  {
    id: 'V-49', area: 'Inspection interval', units: 'imperial', basis: 'equation',
    title: 'Or beyond the 20-year limit (no release prevention barrier) is flagged',
    input: 'No RPB; corrosion-rate method; Or = 25 years.',
    steps: ['§4.4.5.1: Or not to exceed that allowed by §6.4.2', '§6.4.2.2.1: maximum subsequent interval 20 yr without RPB, 30 yr with RPB', 'Required: a warning (or Or limited) when 25 > 20'],
    expected: { warned: true }, tol: null, unit: '',
    source: 'API 653 (2025) §4.4.5.1, §6.4.2.2.1 — C-02',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN, Or: 25 });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'ss', utMin: 0.24 * IN })];
      return { warned: evalFloor(job).c.warnings.some((w) => /6\.4|interval/i.test(w)) };
    }
  },
  {
    id: 'V-50', area: 'Patch plates', units: 'imperial', basis: 'equation',
    title: 'Critical-zone patch longer than 24 in along the shell is flagged',
    input: 'Two repair locations in the critical zone 18 in apart along the shell; default 12 × 12 in patches merge into one tombstone ≈ 30 in wide.',
    steps: ['§9.11.1.2 i): maximum dimension along the shell for a critical-zone patch = 24 in (600 mm)', 'Required: a failing check on the merged patch'],
    expected: { flagged: true }, tol: null, unit: '',
    source: 'API 653 (2025) §9.11.1.2 i) — C-29',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN, courses: [{ id: 'c1', h: 8 * FT, tNom: 0.5 * IN }] });
      const r = 50 * FT - 2 * IN, d = (18 * IN / r) * (180 / Math.PI);
      job.indications = [indAt(job, r, 90, { id: 'A', result: 'ss', utMin: 0.05 * IN }), indAt(job, r, 90 + d, { id: 'B', result: 'ss', utMin: 0.05 * IN })];
      const { L, c } = evalFloor(job), p = patchList(job, L, c);
      return { flagged: p.some((q) => q.checks.some((k) => /24 in|600 mm/.test(k.item) && k.ok === false)), widthIn: Math.max(...p.map((q) => q.W)) / IN };
    }
  },

  {
    id: 'V-51', area: 'Annular plates', units: 'imperial', basis: 'equation',
    title: 'API 650 Table 5.1b for SG ≥ 1 (via API 653 §4.4.6.3)',
    input: 'Course 1 t = 1.00 in; Sb = 30,000 psi (G 1.0).',
    steps: ['Row 0.75 < t ≤ 1.00, column ≤ 30,000 → 9/32 = 0.28125 in'],
    expected: { t: 0.28125 }, tol: 0.001, unit: 'in',
    source: 'API 650 13th ed. Errata 1 (2021) Table 5.1b; API 653 (2025) §4.4.6.3',
    run() { const t1 = 1, H = 1 + (30000 * t1) / (2.6 * 100); return { t: annularMin(100, H, 1.0, t1).t }; }
  },
  {
    id: 'V-52', area: 'Annular plates', units: 'imperial', basis: 'equation',
    title: 'Table 5.1 is not used beyond H × G = 75 ft or a first course thicker than 1.75 in',
    input: 'D 100 ft; H 80 ft; G 1.0; course 1 t = 1.80 in.',
    steps: ['API 650 §5.5.3: Table 5.1a/b applies for H × G ≤ 75 ft (23 m); beyond that an elastic analysis is required', 'Table 5.1b rows stop at 1.75 in', 'Required: no table value'],
    expected: { t: null }, tol: null, unit: '',
    source: 'API 650 (2021) §5.5.3 and Table 5.1b — C-08',
    run() { const r = annularMin(100, 80, 1.0, 1.8); return { t: r ? r.t : null }; }
  },
  {
    id: 'V-53', area: 'Nozzles', units: 'imperial', basis: 'equation',
    title: 'Default neck wall for API 650 nozzles matches Table 5.6b / 5.7b',
    input: 'API 650 tank; NPS 4, NPS 12; NPS 30 in a 1.10 in shell.',
    steps: ['Table 5.6b column 3: NPS 4 → 0.337 in; NPS 12 → 0.50 in', 'NPS ≥ 26: Table 5.6b note e → Table 5.7b column 2: shell 1-1/8 in → 9/16 in'],
    expected: { n4: 0.337, n12: 0.5, n30: 0.5625 }, tol: 0.001, unit: 'in',
    source: 'API 650 (2021) Tables 5.6b and 5.7b. The app also takes 12.5 % off as a "minimum"; that is an as-built value, not a retirement thickness (C-19)',
    run() { const job = { tank: { code: 'API 650' } }; const n = (nps, sh) => nozzleNeck(nps, 'API 650', sh).nom; return { n4: n(4), n12: n(12), n30: n(30, 1.1) }; }
  },

  /* ------------------------------------------------------------------- repair patches --- */
  {
    id: 'V-43', area: 'Patch plates', units: 'imperial', basis: 'equation',
    title: 'Auto patch size extends 2 in past the recorded corrosion',
    input: 'Repair location 14 in × 3 in; default patch 12 × 12 in; margin 2 in.',
    steps: ['L = max(12, 14 + 2 × 2) = 18 in', 'W = max(12, 3 + 2 × 2) = 12 in'],
    expected: { L: 18 * IN, W: 12 * IN }, tol: 0.01, unit: 'mm',
    source: 'API 653 (2025) §9.11.1.1 c) — the 2 in rule is stated for patches smaller than 12 in; extending a 12 in+ patch past the corrosion is good practice (app behaviour)',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN });
      job.indications = [indAt(job, 10 * FT, 30, { id: 'A', result: 'ss', utMin: 0.05 * IN, len: 14 * IN, wid: 3 * IN })];
      const { L, c } = evalFloor(job), p = patchList(job, L, c)[0];
      return { L: p.L, W: p.W };
    }
  },
  {
    id: 'V-44', area: 'Patch plates', units: 'imperial', basis: 'review',
    title: 'With no recorded corrosion size, the "2 in past the corrosion" check is not a pass',
    input: 'Critical-zone repair location with no length / width entered.',
    steps: ['Patch defaults to 12 × 12 in centred on the point', 'Coverage of the corrosion is unknown → the coverage check must be "Verify", not OK'],
    expected: { marginCheck: null }, tol: null, unit: '',
    source: 'This review (C-10); coverage of the corroded area cannot be confirmed without its size — §9.11.1.1',
    run() {
      const job = floorJob({ D: 100 * FT, tBottom: 0.25 * IN, courses: [{ id: 'c1', h: 8 * FT, tNom: 0.5 * IN }] });
      job.indications = [indAt(job, 50 * FT - 2 * IN, 90, { id: 'A', result: 'ss', utMin: 0.05 * IN })];
      const { L, c } = evalFloor(job), p = patchList(job, L, c)[0];
      return { marginCheck: p.checks.find((k) => /2 in past/.test(k.item))?.ok ?? 'n/a' };
    }
  },

  /* -------------------------------------------------------------------------- units --- */
  {
    id: 'V-45', area: 'Units', units: 'both', basis: 'equation',
    title: 'Input conversion to the internal millimetre basis',
    input: '0.25 in thickness; 120 ft diameter; 6.0 mm; 30 m.',
    steps: ['0.25 × 25.4 = 6.35 mm', '120 × 304.8 = 36,576 mm', 'metric values unchanged (× 1 / × 1000)'],
    expected: { t_in: 6.35, D_ft: 36576, t_mm: 6, D_m: 30000 }, tol: 1e-9, unit: 'mm',
    source: 'Exact definitions: 1 in = 25.4 mm, 1 ft = 304.8 mm',
    run() { const I = { units: 'imperial' }, M = { units: 'metric' }; return { t_in: toMm('0.25', 't', I), D_ft: toMm('120', 'big', I), t_mm: toMm('6.0', 't', M), D_m: toMm('30', 'big', M) }; }
  }
];

/** Compare one case. Returns { pass, rows: [[key, expected, actual, ok]] }. */
export function check(cs) {
  let actual, error = null;
  try { actual = cs.run(); } catch (e) { error = String(e && e.message || e); actual = {}; }
  const rows = Object.entries(cs.expected).map(([k, exp]) => {
    const act = actual[k];
    let ok;
    if (typeof exp === 'number' && typeof act === 'number') ok = Math.abs(act - exp) <= (cs.tol ?? 0) + 1e-12;
    else ok = exp === act;
    return [k, exp, act, ok];
  });
  return { pass: !error && rows.every((r) => r[3]), rows, actual, error };
}
