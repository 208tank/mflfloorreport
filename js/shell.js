// Shell UT: courses, shell plates / vertical seams, UT stations, reading elevations and the roll-out.
import { fmt, fromMm, u } from './units.js';
import { nozzleUT } from './calc.js';

export const SPACING_MM = 32 * 304.8; // one UT station per 32 ft of circumference
const STD_PLATE_MM = 30 * 304.8;      // used only to suggest a plate count

const uidS = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Default reading pattern: every 1 in from 1 in to 2 ft, then every 1 ft from 3 ft to the top. */
export function defaultZones(units) {
  return units === 'metric'
    ? [{ id: uidS(), start: 25, end: 600, step: 25 }, { id: uidS(), start: 900, end: null, step: 300 }]
    : [{ id: uidS(), start: 25.4, end: 609.6, step: 25.4 }, { id: uidS(), start: 914.4, end: null, step: 304.8 }];
}

export function defaultShell(units = 'imperial') {
  return { courses: [], nLoc: null, start: 0, rd: {}, zones: defaultZones(units), extraZ: [], notes: '' };
}

/** Older jobs stored one reading per course (shell.ut); move them to mid-height of their course. */
export function migrateShell(sh, units) {
  const out = { ...defaultShell(units), ...(sh || {}) };
  out.rd = out.rd || {}; out.extraZ = out.extraZ || [];
  if (!Array.isArray(out.zones)) out.zones = defaultZones(units);
  if (sh?.ut && Object.keys(sh.ut).length) {
    let z = 0; const mid = new Map();
    for (const c of out.courses || []) { const h = +c.h > 0 ? +c.h : 0; mid.set(c.id, z + h / 2); z += h; }
    for (const [ak, m] of Object.entries(sh.ut)) {
      for (const [cid, v] of Object.entries(m || {})) {
        if (v == null || !mid.has(cid)) continue;
        const zk = zKey(mid.get(cid));
        (out.rd[ak] = out.rd[ak] || {})[zk] = v;
        if (!out.extraZ.includes(+zk)) out.extraZ.push(+zk);
      }
    }
  }
  delete out.ut;
  return out;
}

/* ------------------------------------------------------------------------- stations --- */

export function autoLocCount(job) {
  const D = +job.tank?.diameter || 0;
  if (!(D > 0)) return 4;
  return Math.min(8, Math.max(4, Math.floor((Math.PI * D) / SPACING_MM)));
}

const akey = (a) => (Math.round((((a % 360) + 360) % 360) * 10) / 10).toFixed(1);
export const zKey = (z) => (Math.round(z * 10) / 10).toFixed(1);

export function utLocations(job) {
  const sh = job.shell || {};
  const n = +sh.nLoc > 0 ? Math.round(+sh.nLoc) : autoLocCount(job);
  const start = +sh.start || 0;
  const C = Math.PI * (+job.tank?.diameter || 0);
  return Array.from({ length: n }, (_, i) => {
    const angle = (((start + (i * 360) / n) % 360) + 360) % 360;
    return { i, label: `Q${i + 1}`, angle, key: akey(angle), arc: (C * angle) / 360 };
  });
}

/* -------------------------------------------------------------------------- courses --- */

export function coursesWithElev(job) {
  let z = 0;
  return (job.shell?.courses || []).map((c, i) => { const h = +c.h > 0 ? +c.h : 0; const o = { ...c, no: i + 1, z0: z, z1: z + h }; z += h; return o; });
}

export function shellHeight(job) {
  return (job.shell?.courses || []).reduce((a, c) => a + (+c.h > 0 ? +c.h : 0), 0);
}

export function courseAt(courses, z) {
  for (const c of courses) if (z >= c.z0 - 1e-6 && z < c.z1 - 1e-6) return c;
  const last = courses[courses.length - 1];
  return last && Math.abs(z - last.z1) < 1e-6 ? last : null;
}

/** Suggested plate count for a course (≈ 30 ft plates). */
export const autoPlateCount = (job) => Math.max(1, Math.round((Math.PI * (+job.tank?.diameter || 0)) / STD_PLATE_MM));

/**
 * Shell plates of a course. Plates run clockwise from the first vertical seam.
 * With a plate length, full plates are laid from the first seam and the last (closure) plate takes
 * what is left; otherwise the circumference is split into equal plates. When no first-seam angle is
 * given, alternate courses are staggered by half a plate.
 */
export function coursePlates(job, c, idx) {
  const C = Math.PI * (+job.tank?.diameter || 0);
  if (!(C > 0)) return { seams: [], plates: [], n: 0, auto: true };
  const len = +c.plen > 0 ? +c.plen : null;
  let n = +c.pn > 0 ? Math.round(+c.pn) : null;
  const auto = !len && !n;
  if (!len && !n) n = autoPlateCount(job);
  const stepDeg = len ? (len / C) * 360 : 360 / n;
  const hasSeam = c.seam0 !== null && c.seam0 !== undefined && c.seam0 !== '' && Number.isFinite(+c.seam0);
  const seam0 = hasSeam ? +c.seam0 : (idx % 2 ? stepDeg / 2 : 0);
  const seams = [], plates = [];
  if (len) {
    const k = Math.ceil(360 / stepDeg - 1e-9);
    for (let i = 0; i < k; i++) {
      const a0 = seam0 + i * stepDeg, a1 = Math.min(seam0 + (i + 1) * stepDeg, seam0 + 360);
      seams.push(a0); plates.push({ no: i + 1, a0, a1, len: ((a1 - a0) / 360) * C, closure: a1 - a0 < stepDeg - 1e-6 });
    }
  } else {
    for (let i = 0; i < n; i++) { const a0 = seam0 + i * stepDeg; seams.push(a0); plates.push({ no: i + 1, a0, a1: a0 + stepDeg, len: C / n, closure: false }); }
  }
  return { seams: seams.map((a) => ((a % 360) + 360) % 360), plates, n: plates.length, auto, seam0, stepDeg };
}

/* ------------------------------------------------------------------ reading elevations --- */

/** All reading elevations (mm, ascending): the zones, extra elevations, and any elevation that has readings. */
export function readingElevations(job) {
  const sh = job.shell || {}, H = shellHeight(job);
  const set = new Map();
  const add = (z) => { if (Number.isFinite(z) && z >= 0 && (!(H > 0) || z <= H + 1e-6)) set.set(zKey(z), +zKey(z)); };
  for (const zn of sh.zones || []) {
    const st = +zn.start, step = +zn.step;
    if (!Number.isFinite(st) || !(step > 0)) continue;
    const end = zn.end === null || zn.end === undefined || zn.end === '' ? H : +zn.end;
    if (!Number.isFinite(end)) continue;
    let k = 0;
    for (let z = st; z <= end + 1e-6 && k < 2000; z = st + ++k * step) add(z);
  }
  for (const z of sh.extraZ || []) add(+z);
  for (const m of Object.values(sh.rd || {})) for (const zk of Object.keys(m || {})) if (m[zk] != null) add(+zk);
  return [...set.values()].sort((a, b) => a - b);
}

/** Number of elevations a zone produces (for the zone table). */
export function zoneCount(job, zn) {
  const H = shellHeight(job), st = +zn.start, step = +zn.step;
  const end = zn.end === null || zn.end === undefined || zn.end === '' ? H : +zn.end;
  if (!Number.isFinite(st) || !(step > 0) || !Number.isFinite(end) || end < st) return 0;
  return Math.min(2000, Math.floor((Math.min(end, H > 0 ? H : end) - st) / step + 1e-6) + 1);
}

export const getReading = (job, angleKey, z) => { const v = job.shell?.rd?.[angleKey]?.[zKey(z)]; return v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v; };

/** Elevation as ft-in (imperial) or mm (metric). */
export function fmtElev(z, job) {
  if (job.units === 'metric') return `${Math.round(z)} mm`;
  const inches = z / 25.4, ft = Math.floor(inches / 12 + 1e-9), rem = inches - ft * 12;
  const r = Math.round(rem * 100) / 100;
  return r >= 12 ? `${ft + 1}′ 0″` : `${ft}′ ${r % 1 === 0 ? r.toFixed(0) : r}″`;
}

/** Per-course summary across all stations and elevations in the course. */
export function courseSummary(job) {
  const locs = utLocations(job), courses = coursesWithElev(job), zs = readingElevations(job);
  return courses.map((c) => {
    const vals = [];
    for (const z of zs) { if (courseAt(courses, z)?.id !== c.id) continue; for (const l of locs) { const v = getReading(job, l.key, z); if (v !== null) vals.push(v); } }
    const min = vals.length ? Math.min(...vals) : null;
    const tNom = +c.tNom > 0 ? +c.tNom : null, tMin = +c.tMin > 0 ? +c.tMin : null;
    return { ...c, count: vals.length, min, lossPct: min !== null && tNom ? Math.max(0, ((tNom - min) / tNom) * 100) : null, status: min === null || !tMin ? '' : min < tMin - 1e-9 ? 'Below t-min' : 'OK' };
  });
}

/* --------------------------------------------------------------------------- roll-out --- */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = (v) => (Math.round(v * 10) / 10).toString();

/**
 * Roll-out: the shell unwrapped from 0° to 360° (left to right, looking from outside). Courses are
 * bands (course 1 at the bottom) divided into their plates by the vertical seams; UT station lines
 * run the full height; shell nozzles sit at their angle and elevation. Scales differ horizontally
 * and vertically so wide and tall tanks both stay readable.
 */
export function rolloutSVG(job, opts = {}) {
  const courses = coursesWithElev(job), H = shellHeight(job), D = +job.tank?.diameter || 0;
  const U = u(job);
  if (!courses.length || !(H > 0) || !(D > 0)) {
    return `<svg class="rollout" viewBox="0 0 1000 160" xmlns="http://www.w3.org/2000/svg"><text x="500" y="80" text-anchor="middle" class="ro-empty" font-size="16">Enter the tank diameter and the shell courses to draw the roll-out</text></svg>`;
  }
  const C = Math.PI * D;
  const L = 168, T = 54, W = 860, Hd = Math.max(240, Math.min(460, 120 + courses.length * 58)), B = 64;
  const vw = L + W + 40, vh = T + Hd + B;
  const X = (a) => L + (a / 360) * W, Y = (z) => T + Hd - (z / H) * Hd;
  const locs = utLocations(job);
  const clip = 'roclip' + Math.random().toString(36).slice(2, 7);
  const o = [];
  o.push(`<svg class="rollout${opts.print ? ' print' : ''}" viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">`);
  o.push(`<defs><clipPath id="${clip}"><rect x="${L}" y="${T}" width="${W}" height="${Hd}"/></clipPath></defs>`);
  courses.forEach((c, i) => {
    const y1 = Y(c.z1), y0 = Y(c.z0), hh = y0 - y1;
    o.push(`<rect x="${L}" y="${f1(y1)}" width="${W}" height="${f1(hh)}" class="ro-course ${i % 2 ? 'alt' : ''}"/>`);
    const cp = coursePlates(job, c, i);
    o.push(`<g clip-path="url(#${clip})">`);
    for (const p of cp.plates) {
      for (const shift of [0, -360]) {
        const a0 = p.a0 + shift, a1 = p.a1 + shift;
        if (a1 <= 0 || a0 >= 360) continue;
        const v0 = Math.max(0, a0), v1 = Math.min(360, a1);
        if ((v1 - v0) / (a1 - a0) < 0.45) continue; // label the larger part of a plate that wraps past 0°
        const xm = (X(v0) + X(v1)) / 2, wpx = X(v1) - X(v0);
        if (wpx > 18 && hh > 14) o.push(`<text x="${f1(xm)}" y="${f1(y1 + Math.min(15, hh / 2 + 4))}" text-anchor="middle" font-size="${wpx > 44 ? 10.5 : 8.5}" class="ro-pl">${c.no}-${p.no}${p.closure ? '*' : ''}</text>`);
      }
    }
    for (const a of cp.seams) o.push(`<line x1="${f1(X(a))}" y1="${f1(y1)}" x2="${f1(X(a))}" y2="${f1(y0)}" class="ro-seam"/>`);
    o.push('</g>');
    o.push(`<text x="${L - 34}" y="${f1((y0 + y1) / 2 - 7)}" text-anchor="end" class="ro-cl" font-size="13">Course ${c.no}</text>`);
    o.push(`<text x="${L - 34}" y="${f1((y0 + y1) / 2 + 8)}" text-anchor="end" class="ro-cs" font-size="10.5">${c.tNom ? fmt(c.tNom, 't', job) : ''}${c.tMin ? ' · min ' + fmt(c.tMin, 't', job, false) : ''}</text>`);
    if (hh > 34) o.push(`<text x="${L - 34}" y="${f1((y0 + y1) / 2 + 21)}" text-anchor="end" class="ro-cs" font-size="10">${cp.n} plate${cp.n === 1 ? '' : 's'}</text>`);
  });
  o.push(`<rect x="${L}" y="${T}" width="${W}" height="${Hd}" class="ro-frame"/>`);
  for (let a = 0; a <= 360; a += 15) {
    const big = a % 90 === 0, mid = a % 45 === 0;
    o.push(`<line x1="${f1(X(a))}" y1="${T + Hd}" x2="${f1(X(a))}" y2="${T + Hd + (big ? 10 : mid ? 7 : 4)}" class="ro-tick"/>`);
    if (mid) o.push(`<text x="${f1(X(a))}" y="${T + Hd + 23}" text-anchor="middle" font-size="11.5" class="ro-deg${big ? ' big' : ''}">${a}°${a === 0 && job.info?.zeroRef ? ' ' + esc(job.info.zeroRef) : ''}</text>`);
  }
  o.push(`<text x="${L}" y="${vh - 6}" font-size="10" class="ro-note">Looking from outside the tank · angles clockwise from 0° · solid lines are vertical seams, plates numbered course-plate clockwise from the first seam (* closure plate) · scales differ</text>`);
  [0, H].forEach((z) => o.push(`<text x="${L + W + 4}" y="${f1(Y(z) + 4)}" font-size="10" class="ro-arc">${fmt(z, 'big', job, false)}</text>`));
  for (const n of job.nozzles || []) {
    const a = +n.angle; if (!Number.isFinite(a)) continue;
    const z = +n.elev > 0 ? +n.elev : null; if (z === null || z > H) continue;
    const r = Math.max(4, Math.min(26, ((+n.size || 0) / C) * W / 2));
    const bad = nozzleUT(n).status === 'Below t-min';
    o.push(`<g class="ro-noz${bad ? ' bad' : ''}"><circle cx="${f1(X(a))}" cy="${f1(Y(z))}" r="${f1(r)}"/><text x="${f1(X(a) + r + 3)}" y="${f1(Y(z) + 4)}" font-size="10.5">${esc(n.mark || '')}</text></g>`);
  }
  for (const l of locs) {
    const x = X(l.angle);
    o.push(`<line x1="${f1(x)}" y1="${T - 6}" x2="${f1(x)}" y2="${T + Hd}" class="ro-loc"/>`);
    o.push(`<text x="${f1(x)}" y="${T - 26}" text-anchor="middle" font-size="12.5" class="ro-ll">${l.label}</text><text x="${f1(x)}" y="${T - 12}" text-anchor="middle" font-size="10.5" class="ro-la">${f1(l.angle)}°</text>`);
    o.push(`<text x="${f1(x)}" y="${T + Hd + 38}" text-anchor="middle" font-size="10" class="ro-arc">${fmt(l.arc, 'big', job, false)} ${U.big}</text>`);
  }
  o.push('</svg>');
  return o.join('');
}

export const SHELL_SVG_STYLE = `<style>
.ro-course{fill:#fff;stroke:#9aa3ad;stroke-width:.8}.ro-course.alt{fill:#f4f6f8}.ro-frame{fill:none;stroke:#1d232b;stroke-width:1.6}
.ro-seam{stroke:#1d232b;stroke-width:1.3}.ro-pl{fill:#5b6470;font-family:Arial,sans-serif}
.ro-cl{fill:#1d232b;font-weight:700;font-family:Arial,sans-serif}.ro-cs,.ro-arc,.ro-note,.ro-la{fill:#5b6470;font-family:Arial,sans-serif}.ro-deg{fill:#3a434e;font-family:Arial,sans-serif}.ro-deg.big{font-weight:700;fill:#1d232b}
.ro-tick{stroke:#1d232b}.ro-loc{stroke:#0f766e;stroke-width:1.2;stroke-dasharray:5 3}.ro-ll{fill:#0f766e;font-weight:700;font-family:Arial,sans-serif}
.ro-noz circle{fill:#eef0f3;stroke:#1d232b;stroke-width:1.2}.ro-noz text{fill:#1d232b;font-weight:700;font-family:Arial,sans-serif}.ro-noz.bad circle{stroke:#b91c1c}
</style>`;
