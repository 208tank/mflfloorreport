// Floor UT thickness survey (schema 7): selected areas located from a plate datum, critical zone scans around
// the circumference (with optional lower shell scans at the same places) and five readings per plate.
// No browser APIs: the calculation (calc.js), the screens, the report and the tests all use this module.
// All lengths and thicknesses in mm.
import { itemFloor, plateAt, polar } from './geometry.js';
import { PT5, utPoints } from './roof.js';
import { courseDesigns } from './design.js';

const IN = 25.4, FT = 304.8, DEG = Math.PI / 180;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);
const norm = (a) => ((a % 360) + 360) % 360;

/** Area condition types (the inspector can type their own with "Custom"). */
export const AREA_TYPES = [['', '—'], ['gen-thin', 'General thinning'], ['gen-pit', 'General pitting'], ['scat-pit', 'Widely scattered pitting'], ['iso-pit', 'Isolated pitting'],
  ['local', 'Localized corrosion'], ['lam', 'Lamination / inclusion'], ['nsl', 'No significant loss'], ['custom', 'Custom…']];
export const AREA_TYPE_LABEL = Object.fromEntries(AREA_TYPES);
/** Side of the loss, when known. A known side sets StPᵣ / UPᵣ; an unknown side only sets RT. */
export const AREA_SIDES = [['', 'Not known'], ['ps', 'Product side'], ['ss', 'Soil side']];
export const SIDE_SHORT = { '': '—', ps: 'PS', ss: 'SS' };
export const PT5_KEYS = PT5.map(([k]) => k);

export function defaultFloorUT(units = 'imperial') {
  const m = units === 'metric';
  return {
    areas: [],
    // critical zone scans: square scans at the shell, every `spacing` along the circumference from `start`
    cz: { on: false, spacing: m ? 3000 : 10 * FT, start: 0, size: m ? 150 : 6 * IN, shell: false, rd: {} },
    // five readings per plate (four corners and the centre), as on a floating roof deck
    plates: { on: false, rd: {} }
  };
}

export function migrateFloorUT(f, units) {
  const d = defaultFloorUT(units);
  if (!f || typeof f !== 'object') return d;
  return {
    ...d, ...f,
    areas: Array.isArray(f.areas) ? f.areas : [],
    cz: { ...d.cz, ...(f.cz || {}), rd: f.cz?.rd && typeof f.cz.rd === 'object' ? f.cz.rd : {} },
    plates: { ...d.plates, ...(f.plates || {}), rd: f.plates?.rd && typeof f.plates.rd === 'object' ? f.plates.rd : {} }
  };
}

/** True when the job has any floor UT data (used to leave empty sections out). */
export function hasFloorUT(job) {
  const F = job.floorUT; if (!F) return false;
  return (F.areas || []).length > 0 || (F.cz?.on && czStations(job).length > 0) || (F.plates?.on && Object.keys(F.plates.rd || {}).length > 0);
}

export const areaTypeText = (a) => (a.type === 'custom' ? String(a.typeText || '').trim() || 'Custom' : AREA_TYPE_LABEL[a.type || ''] === '—' ? '' : AREA_TYPE_LABEL[a.type || ''] || '');
export function nextAreaNo(job) {
  let max = 0;
  for (const a of job.floorUT?.areas || []) { const m = String(a.no || '').match(/(\d+)(?!.*\d)/); if (m) max = Math.max(max, +m[1]); }
  return 'A-' + (max + 1);
}

/* ------------------------------------------------------------------ critical zone scans --- */

export const czKey = (a) => (Math.round(norm(a) * 10) / 10).toFixed(1);

/**
 * Critical zone scan stations: one every `spacing` (arc length at the shell) from the start angle, clockwise,
 * until the circumference is closed. The last gap (back to the first scan) may be shorter; it is reported.
 */
export function czStations(job) {
  const C = job.floorUT?.cz, R = (+job.tank?.diameter || 0) / 2;
  if (!C || !(R > 0)) return [];
  const sp = num(C.spacing), circ = 2 * Math.PI * R;
  if (!(sp > 0)) return [];
  const n = Math.min(2000, Math.max(1, Math.ceil(circ / sp - 1e-6)));
  const st = norm(num(C.start) ?? 0), out = [];
  for (let i = 0; i < n; i++) {
    const s = i * sp; if (s > circ - 1e-6) break;
    const a = norm(st + (s / R) / DEG);
    out.push({ no: 'CZ-' + (i + 1), key: czKey(a), angle: Math.round(a * 10) / 10, s });
  }
  return out;
}
/** The gap from the last scan back to the first (arc mm), and the regular spacing. */
export function czLastGap(job) {
  const st = czStations(job), R = (+job.tank?.diameter || 0) / 2;
  if (!st.length || !(R > 0)) return null;
  return 2 * Math.PI * R - st[st.length - 1].s;
}
/** Readings kept at angles that are no longer a scan station (after the spacing or start changed). */
export function czOrphans(job) {
  const keys = new Set(czStations(job).map((s) => s.key)), rd = job.floorUT?.cz?.rd || {};
  return Object.keys(rd).filter((k) => !keys.has(k) && Object.values(rd[k] || {}).some((v) => v !== null && v !== undefined && v !== ''));
}

/** Where a critical zone scan sits: the centre of a `size` square whose outer edge is at the shell. */
export function czScanFloor(job, layout, angle) {
  const size = num(job.floorUT?.cz?.size) ?? 6 * IN, r = Math.max(0, layout.R - size / 2);
  const [x, y] = polar(r, angle);
  return { x, y, r };
}

/** Lower shell scans are compared with the course 1 t-min: entered on the shell course, else calculated (§4.3.3). */
export function shellScanTmin(job) {
  const c1 = (job.shell?.courses || [])[0]; if (!c1) return { tMin: null, tNom: null, src: 'no shell courses' };
  const entered = +c1.tMin > 0 ? +c1.tMin : null, calc = entered === null ? courseDesigns(job)[0]?.tmin ?? null : null;
  return { tMin: entered ?? calc, tNom: +c1.tNom > 0 ? +c1.tNom : null, src: entered !== null ? 'course 1 t-min entered' : calc !== null ? 'course 1 t-min calculated (§4.3.3)' : 'not available' };
}
/** Same rules as the shell readings (shell.js courseSummary): below 60 % of t-min fails §4.3.2.1. */
export function shellScanStatus(t, tMin) {
  if (t === null || !tMin) return '';
  return t < 0.6 * tMin - 1e-9 ? 'Below t-min' : t < tMin - 1e-9 ? 'Evaluate per §4.3.2' : 'OK';
}
export function shellScans(job) {
  const C = job.floorUT?.cz; if (!C?.on || !C.shell) return [];
  const T = shellScanTmin(job);
  return czStations(job).map((s) => {
    const r = C.rd?.[s.key] || {}, t = num(r.sMin), avg = num(r.sAvg);
    return { ...s, t, avg, tMin: T.tMin, tNom: T.tNom, lossPct: t !== null && T.tNom ? Math.max(0, ((T.tNom - t) / T.tNom) * 100) : null, status: shellScanStatus(t, T.tMin), note: r.sNote || '' };
  });
}

/* ------------------------------------------------------------------------ all the points --- */

/**
 * Every floor UT result as a location: { kind: 'area' | 'cz' | 'plate', id, label, plate, region, critical, t, avg,
 * floor:{x,y}, distShell, tNom, side, top, bot }. `nomOf(plate)` gives the plate's nominal (calc.js plateNominal).
 * Area: the minimum over the area, centred at X / Y from the plate datum; critical when its extent reaches the zone.
 * CZ scan: the scan's minimum, always in the critical zone. Plate: each of the five readings.
 */
export function floorUTPoints(job, layout, nomOf) {
  const F = job.floorUT, out = [];
  if (!F || !layout || !(layout.R > 0)) return out;
  const czDist = num(job.calc?.czDist) ?? 76.2;
  const regionOf = (p) => (p?.kind === 'annular' ? 'annular' : 'bottom');
  const mk = (o) => {
    const tNom = o.plate ? nomOf(o.plate) : null;
    const loss = o.t !== null && tNom !== null ? Math.max(0, tNom - o.t) : null;
    const top = o.side === 'ps' && loss ? loss : 0, bot = o.side === 'ss' && loss ? loss : 0;
    out.push({ ...o, region: regionOf(o.plate), tNom, loss, lossPct: loss !== null && tNom > 0 ? (loss / tNom) * 100 : null, top, bot });
  };
  for (const a of F.areas || []) {
    const t = num(a.tMin); if (t === null) continue;
    const plate = layout.byKey.get(a.plate) || null, floor = plate ? itemFloor(layout, a) : null;
    const distShell = floor ? layout.R - Math.hypot(floor.x, floor.y) : null, ext = Math.max(num(a.len) || 0, num(a.wid) || 0);
    mk({ kind: 'area', id: a.id, label: a.no || 'Area', plate, floor, distShell, critical: distShell !== null && distShell - ext / 2 <= czDist + 1e-6, t, avg: num(a.tAvg), side: a.side || '', type: areaTypeText(a) });
  }
  if (F.cz?.on) {
    for (const s of czStations(job)) {
      const r = F.cz.rd?.[s.key] || {}, t = num(r.tMin); if (t === null) continue;
      const fl = czScanFloor(job, layout, s.angle), plate = plateAt(layout, fl.x, fl.y);
      mk({ kind: 'cz', id: 'cz:' + s.key, label: s.no, angle: s.angle, plate, floor: { x: fl.x, y: fl.y }, distShell: layout.R - fl.r, critical: true, t, avg: num(r.tAvg), side: '' });
    }
  }
  if (F.plates?.on) {
    for (const p of layout.plates) {
      const r = F.plates.rd?.[p.key]; if (!r) continue;
      const pos = utPoints(p, layout);
      for (const k of PT5_KEYS) {
        const t = num(r[k]); if (t === null) continue;
        const [x, y] = pos[k], distShell = layout.R - Math.hypot(x, y);
        mk({ kind: 'plate', id: 'pl:' + p.key + ':' + k, label: `${p.label} ${k.toUpperCase()}`, pt: k, plate: p, floor: { x, y }, distShell, critical: distShell <= czDist + 1e-6, t, avg: null, side: '' });
      }
    }
  }
  return out;
}

/** The 5-reading summary of one plate: count, minimum and the readings' positions. */
export function plateReadings(job, p) {
  const r = job.floorUT?.plates?.rd?.[p.key] || {}, vals = PT5_KEYS.map((k) => num(r[k])).filter((v) => v !== null);
  return { count: vals.length, min: vals.length ? Math.min(...vals) : null, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
}
/** Plates whose readings are kept but which are no longer in the layout. */
export function plateOrphans(job, layout) {
  const rd = job.floorUT?.plates?.rd || {};
  return Object.keys(rd).filter((k) => !layout.byKey.has(k) && Object.values(rd[k] || {}).some((v) => v !== null && v !== undefined && v !== ''));
}

/** Input checks for an area (used by the screen and the validator). */
export function areaIssues(a) {
  const out = [], t = num(a.tMin), avg = num(a.tAvg);
  if (t !== null && t < 0) out.push('minimum is negative');
  if (avg !== null && t !== null && avg < t - 1e-9) out.push('average is less than the minimum');
  if ((num(a.len) ?? 1) <= 0 || (num(a.wid) ?? 1) <= 0) out.push('size must be more than 0');
  return out;
}

