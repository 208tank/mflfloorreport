// Shell UT: courses, standard reading locations and the shell roll-out drawing.
import { fmt, fromMm, u } from './units.js';
import { nozzleUT } from './calc.js';

export const SPACING_MM = 32 * 304.8; // one reading location per 32 ft of circumference

export function defaultShell() {
  return { courses: [], nLoc: null, start: 0, ut: {}, notes: '' };
}

/** Standard count: circumference ÷ 32 ft, rounded down, at least 4 and at most 8. */
export function autoLocCount(job) {
  const D = +job.tank?.diameter || 0;
  if (!(D > 0)) return 4;
  return Math.min(8, Math.max(4, Math.floor((Math.PI * D) / SPACING_MM)));
}

const akey = (a) => (Math.round((((a % 360) + 360) % 360) * 10) / 10).toFixed(1);

/** Reading locations: equally spaced, starting at the start angle. Readings are keyed by angle. */
export function utLocations(job) {
  const sh = job.shell || defaultShell();
  const n = +sh.nLoc > 0 ? Math.round(+sh.nLoc) : autoLocCount(job);
  const start = +sh.start || 0;
  const C = Math.PI * (+job.tank?.diameter || 0);
  return Array.from({ length: n }, (_, i) => {
    const angle = (((start + (i * 360) / n) % 360) + 360) % 360;
    return { i, label: `Q${i + 1}`, angle, key: akey(angle), arc: (C * angle) / 360 };
  });
}

/** Courses with their elevations (course 1 is the bottom course). */
export function coursesWithElev(job) {
  let z = 0;
  return (job.shell?.courses || []).map((c, i) => { const h = +c.h > 0 ? +c.h : 0; const o = { ...c, no: i + 1, z0: z, z1: z + h }; z += h; return o; });
}

export function shellHeight(job) {
  return (job.shell?.courses || []).reduce((a, c) => a + (+c.h > 0 ? +c.h : 0), 0);
}

const reading = (job, key, cid) => { const v = job.shell?.ut?.[key]?.[cid]; return v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v; };

/** Per-course summary: min reading, % loss vs nominal, status vs t-min. */
export function courseSummary(job) {
  const locs = utLocations(job);
  return coursesWithElev(job).map((c) => {
    const vals = locs.map((l) => reading(job, l.key, c.id)).filter((v) => v !== null);
    const min = vals.length ? Math.min(...vals) : null;
    const tNom = +c.tNom > 0 ? +c.tNom : null, tMin = +c.tMin > 0 ? +c.tMin : null;
    return {
      ...c, count: vals.length, of: locs.length, min,
      lossPct: min !== null && tNom ? Math.max(0, ((tNom - min) / tNom) * 100) : null,
      status: min === null || !tMin ? '' : min < tMin - 1e-9 ? 'Below t-min' : 'OK'
    };
  });
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = (v) => (Math.round(v * 10) / 10).toString();

/**
 * Roll-out drawing: the shell unwrapped from 0° to 360° (left to right, looking from outside),
 * courses as bands (course 1 at the bottom), UT station lines with their angles, and shell nozzles
 * at their angle and elevation.
 * Horizontal and vertical scales differ so tall and wide tanks both stay readable.
 */
export function rolloutSVG(job, opts = {}) {
  const courses = coursesWithElev(job), H = shellHeight(job), D = +job.tank?.diameter || 0;
  const U = u(job);
  if (!courses.length || !(H > 0) || !(D > 0)) {
    return `<svg class="rollout" viewBox="0 0 1000 160" xmlns="http://www.w3.org/2000/svg"><text x="500" y="80" text-anchor="middle" class="ro-empty" font-size="16">Enter the tank diameter and the shell courses to draw the roll-out</text></svg>`;
  }
  const C = Math.PI * D;
  const L = 168, T = 54, W = 860, Hd = Math.max(240, Math.min(440, 120 + courses.length * 56)), B = 64;
  const vw = L + W + 40, vh = T + Hd + B;
  const X = (a) => L + (a / 360) * W, Y = (z) => T + Hd - (z / H) * Hd;
  const locs = utLocations(job);
  const sum = new Map(courseSummary(job).map((c) => [c.id, c]));
  const o = [];
  o.push(`<svg class="rollout${opts.print ? ' print' : ''}" viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg">`);
  // course bands
  courses.forEach((c, i) => {
    const y1 = Y(c.z1), y0 = Y(c.z0);
    const s = sum.get(c.id);
    o.push(`<rect x="${L}" y="${f1(y1)}" width="${W}" height="${f1(y0 - y1)}" class="ro-course ${i % 2 ? 'alt' : ''}"/>`);
    o.push(`<text x="${L - 34}" y="${f1((y0 + y1) / 2 - 6)}" text-anchor="end" class="ro-cl" font-size="13">Course ${c.no}</text>`);
    o.push(`<text x="${L - 34}" y="${f1((y0 + y1) / 2 + 10)}" text-anchor="end" class="ro-cs" font-size="10.5">${c.tNom ? fmt(c.tNom, 't', job) : ''}${c.tMin ? ' · min ' + fmt(c.tMin, 't', job, false) : ''}</text>`);
  });
  o.push(`<rect x="${L}" y="${T}" width="${W}" height="${Hd}" class="ro-frame"/>`);
  // angle ticks along the bottom
  for (let a = 0; a <= 360; a += 15) {
    const big = a % 90 === 0, mid = a % 45 === 0;
    o.push(`<line x1="${f1(X(a))}" y1="${T + Hd}" x2="${f1(X(a))}" y2="${T + Hd + (big ? 10 : mid ? 7 : 4)}" class="ro-tick"/>`);
    if (mid) o.push(`<text x="${f1(X(a))}" y="${T + Hd + 23}" text-anchor="middle" font-size="11.5" class="ro-deg${big ? ' big' : ''}">${a}°${a === 0 && job.info?.zeroRef ? ' ' + esc(job.info.zeroRef) : ''}</text>`);
  }
  o.push(`<text x="${L}" y="${vh - 6}" font-size="10" class="ro-note">Looking from outside the tank · angles clockwise from 0° · distance along the circumference below · horizontal and vertical scales differ</text>`);
  // elevation scale on the right
  [0, H].forEach((z) => o.push(`<text x="${L + W + 4}" y="${f1(Y(z) + 4)}" font-size="10" class="ro-arc">${fmt(z, 'big', job, false)}</text>`));
  // nozzles (behind the readings)
  for (const n of job.nozzles || []) {
    const a = +n.angle; if (!Number.isFinite(a)) continue;
    const z = +n.elev > 0 ? +n.elev : null; if (z === null || z > H) continue;
    const r = Math.max(4, Math.min(26, ((+n.size || 0) / C) * W / 2));
    const bad = nozzleUT(n).status === 'Below t-min';
    o.push(`<g class="ro-noz${bad ? ' bad' : ''}"><circle cx="${f1(X(a))}" cy="${f1(Y(z))}" r="${f1(r)}"/><text x="${f1(X(a) + r + 3)}" y="${f1(Y(z) + 4)}" font-size="10.5">${esc(n.mark || '')}</text></g>`);
  }
  // reading locations and readings
  for (const l of locs) {
    const x = X(l.angle);
    o.push(`<line x1="${f1(x)}" y1="${T - 6}" x2="${f1(x)}" y2="${T + Hd}" class="ro-loc"/>`);
    o.push(`<text x="${f1(x)}" y="${T + Hd + 38}" text-anchor="middle" font-size="10" class="ro-arc">${fmt(l.arc, 'big', job, false)} ${U.big}</text>`);
    o.push(`<text x="${f1(x)}" y="${T - 26}" text-anchor="middle" font-size="12.5" class="ro-ll">${l.label}</text><text x="${f1(x)}" y="${T - 12}" text-anchor="middle" font-size="10.5" class="ro-la">${f1(l.angle)}°</text>`);
  }
  o.push('</svg>');
  return o.join('');
}

export const SHELL_SVG_STYLE = `<style>
.ro-course{fill:#fff;stroke:#9aa3ad;stroke-width:.8}.ro-course.alt{fill:#f4f6f8}.ro-course.bad{fill:#fdecec}.ro-frame{fill:none;stroke:#1d232b;stroke-width:1.6}
.ro-cl{fill:#1d232b;font-weight:700;font-family:Arial,sans-serif}.ro-cs,.ro-arc,.ro-note,.ro-la{fill:#5b6470;font-family:Arial,sans-serif}.ro-deg{fill:#3a434e;font-family:Arial,sans-serif}.ro-deg.big{font-weight:700;fill:#1d232b}
.ro-tick{stroke:#1d232b}.ro-loc{stroke:#0f766e;stroke-width:1.2;stroke-dasharray:5 3}.ro-ll{fill:#0f766e;font-weight:700;font-family:Arial,sans-serif}
.ro-r rect{fill:#fff;stroke:#0f766e;stroke-width:1}.ro-r text{fill:#1d232b;font-family:Arial,sans-serif;font-weight:600}.ro-r.bad rect{fill:#fde8e8;stroke:#b91c1c}.ro-r.bad text{fill:#b91c1c}.ro-r.empty rect{stroke:#c9ced6;stroke-dasharray:2 2}.ro-r.empty text{fill:#9aa3ad;font-weight:400}
.ro-noz circle{fill:#eef0f3;stroke:#1d232b;stroke-width:1.2}.ro-noz text{fill:#1d232b;font-weight:700;font-family:Arial,sans-serif}.ro-noz.bad circle{stroke:#b91c1c}
</style>`;
