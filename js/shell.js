// Shell UT: courses, shell plates / vertical seams, UT stations, reading elevations and the roll-out.
import { fmt, fromMm, u } from './units.js';
import { nozzleUT } from './calc.js';
import { courseDesigns } from './design.js';

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
  let z = 0; const ds = courseDesigns(job);
  return (job.shell?.courses || []).map((c, i) => {
    const h = +c.h > 0 ? +c.h : 0, d = ds[i], set = +c.tMin > 0 ? +c.tMin : null;
    const o = { ...c, no: i + 1, z0: z, z1: z + h, d, tMinSet: set, tMinCalc: d?.tmin ?? null, tMin: set ?? d?.tmin ?? null, tMinSrc: set ? 'entered' : d?.tmin ? 'API 653 4.3.3.1' : '' };
    z += h; return o;
  });
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

/** Dimension text: 12'-1 7/8" (to 1/32") for imperial, mm for metric. */
export function dimText(mm, job) {
  if (job.units === 'metric') return { main: `${Math.round(mm)}`, sub: '' };
  let n32 = Math.round((mm / 25.4) * 32);
  const ft = Math.floor(n32 / (12 * 32)); n32 -= ft * 12 * 32;
  const whole = Math.floor(n32 / 32); let num = n32 - whole * 32, den = 32;
  while (num && num % 2 === 0) { num /= 2; den /= 2; }
  return { main: `${ft}'-${whole}${num ? ` ${num}/${den}` : ''}"`, sub: `[${Math.round(mm)}]` };
}

/** Every plate rectangle that shows between 0° and 360° (a plate crossing 0°/360° is drawn whole at both ends). */
function visiblePlates(cp) {
  const out = [];
  for (const p of cp.plates) for (const k of [-1, 0, 1]) {
    const a0 = p.a0 + k * 360, a1 = p.a1 + k * 360;
    if (a1 > 1e-6 && a0 < 360 - 1e-6) out.push({ ...p, a0, a1 });
  }
  return out;
}

/**
 * Shell roll-out in the style of a fabrication drawing: the shell unwrapped from 0° to 360° looking
 * from outside, each course drawn as whole plates (plates that cross 0°/360° overhang both ends),
 * UT station lines with the angle in a circle at the top, arc-length dimensions between stations,
 * course and overall height dimensions on the right, the circumference along the bottom, and shell
 * nozzles with hexagon tags. Drawn to scale; very wide, short shells get their height stretched.
 */
export function rolloutSVG(job, opts = {}) {
  const courses = coursesWithElev(job), H = shellHeight(job), D = +job.tank?.diameter || 0;
  if (!courses.length || !(H > 0) || !(D > 0)) {
    return `<svg class="rollout" viewBox="0 0 1000 160" xmlns="http://www.w3.org/2000/svg"><text x="500" y="80" text-anchor="middle" class="ro-empty" font-size="16">Enter the tank diameter and the shell courses to draw the roll-out</text></svg>`;
  }
  const C = Math.PI * D;
  const W = 1000, kx = W / C;                             // px per mm along the circumference
  const maxAspect = 4.2;
  let ky = kx, stretched = false;
  if (H * ky < W / maxAspect) { ky = W / maxAspect / H; stretched = true; }
  const Hd = H * ky;
  const plateSets = courses.map((c, i) => coursePlates(job, c, i));
  const vis = plateSets.map(visiblePlates);
  const minA = Math.min(0, ...vis.flat().map((p) => p.a0)), maxA = Math.max(360, ...vis.flat().map((p) => p.a1));
  const ox = 34 + ((-minA) / 360) * W;                    // x of 0°
  const right = ox + W + ((maxA - 360) / 360) * W;        // right end of the widest course
  const T = 112;                                          // top of shell
  const X = (a) => ox + (a / 360) * W, Y = (z) => T + Hd - z * ky;
  const dimX1 = right + 26, dimX2 = dimX1 + 118;
  const vw = dimX2 + 46, vh = T + Hd + 74;
  const locs = utLocations(job);
  const tick = (x, y) => `<path d="M${f1(x - 4)} ${f1(y + 4)}L${f1(x + 4)} ${f1(y - 4)}" class="ro-tk"/>`;
  const o = [];
  o.push(`<svg class="rollout${opts.print ? ' print' : ''}" viewBox="0 0 ${f1(vw)} ${f1(vh)}" xmlns="http://www.w3.org/2000/svg">`);

  // courses: whole plates
  const stX = [...locs.map((l) => X(l.angle)), X(360)];
  courses.forEach((c, i) => {
    const y1 = Y(c.z1), y0 = Y(c.z0), hh = y0 - y1;
    for (const p of vis[i]) {
      const x0 = X(p.a0), x1 = X(p.a1);
      o.push(`<rect x="${f1(x0)}" y="${f1(y1)}" width="${f1(x1 - x0)}" height="${f1(hh)}" class="ro-plate"/>`);
      const r = Math.min(10, hh / 3.2, (x1 - x0) / 3.2);
      let cx = (x0 + x1) / 2;
      if (stX.some((sx) => Math.abs(sx - cx) < r + 4)) { const alt = [cx + r * 2.2, cx - r * 2.2, cx + r * 3, cx - r * 3].find((v) => v - r > x0 + 2 && v + r < x1 - 2 && !stX.some((sx) => Math.abs(sx - v) < r + 4)); if (alt !== undefined) cx = alt; }
      if (r >= 5) o.push(`<circle cx="${f1(cx)}" cy="${f1((y0 + y1) / 2)}" r="${f1(r)}" class="ro-pc"/><text x="${f1(cx)}" y="${f1((y0 + y1) / 2 + r * 0.36)}" text-anchor="middle" font-size="${f1(r * 1.05)}" class="ro-pn">${p.no}${p.closure ? '*' : ''}</text>`);
    }
    o.push(`<text x="${f1(Math.min(...vis[i].map((p) => X(p.a0))) - 6)}" y="${f1((y0 + y1) / 2 + 4)}" text-anchor="end" font-size="10" class="ro-cn">C${c.no}</text>`);
  });

  // station lines with angle circles
  const st = [...locs.map((l) => ({ a: l.angle, label: l.label })), { a: 360, label: '' }].sort((a, b) => a.a - b.a);
  for (const sl of st) {
    const x = X(sl.a);
    o.push(`<line x1="${f1(x)}" y1="${T - 82}" x2="${f1(x)}" y2="${f1(T + Hd + (sl.a === 0 || sl.a === 360 ? 48 : 6))}" class="ro-st"/>`);
    o.push(`<circle cx="${f1(x)}" cy="${T - 92}" r="12" class="ro-sc"/><text x="${f1(x)}" y="${T - 88}" text-anchor="middle" font-size="10.5" class="ro-sa">${Math.round(sl.a * 10) / 10}</text>`);
    if (sl.label) o.push(`<text x="${f1(x + 15)}" y="${T - 95}" font-size="8.5" class="ro-sq">${sl.label}</text>`);
  }
  // arc-length dimensions between stations
  const yd = T - 30;
  for (let i = 0; i + 1 < st.length; i++) {
    const xa = X(st[i].a), xb = X(st[i + 1].a), d = dimText(((st[i + 1].a - st[i].a) / 360) * C, job);
    o.push(`<line x1="${f1(xa)}" y1="${yd}" x2="${f1(xb)}" y2="${yd}" class="ro-dim"/>${tick(xa, yd)}${tick(xb, yd)}`);
    o.push(`<text x="${f1((xa + xb) / 2)}" y="${yd - 5}" text-anchor="middle" font-size="9.5" class="ro-dt">${esc(d.main)}</text>`);
    if (d.sub) o.push(`<text x="${f1((xa + xb) / 2)}" y="${yd + 11}" text-anchor="middle" font-size="8.5" class="ro-ds">${d.sub}</text>`);
  }
  // overall circumference along the bottom
  const yb = T + Hd + 40, dc = dimText(C, job);
  o.push(`<line x1="${f1(X(0))}" y1="${f1(yb)}" x2="${f1(X(360))}" y2="${f1(yb)}" class="ro-dim"/>${tick(X(0), yb)}${tick(X(360), yb)}`);
  o.push(`<text x="${f1(X(180))}" y="${f1(yb - 5)}" text-anchor="middle" font-size="10.5" class="ro-dt">${esc(dc.main)}${job.units === 'metric' ? ' mm' : ''}</text>`);
  if (dc.sub) o.push(`<text x="${f1(X(180))}" y="${f1(yb + 12)}" text-anchor="middle" font-size="9" class="ro-ds">${dc.sub}</text>`);

  // course heights and overall height on the right
  o.push(`<line x1="${f1(dimX1)}" y1="${T}" x2="${f1(dimX1)}" y2="${f1(T + Hd)}" class="ro-dim"/>`);
  for (const c of courses) {
    const y1 = Y(c.z1), y0 = Y(c.z0), d = dimText(+c.h, job);
    o.push(`<line x1="${f1(right + 4)}" y1="${f1(y1)}" x2="${f1(dimX1 + 6)}" y2="${f1(y1)}" class="ro-ext"/>${tick(dimX1, y1)}`);
    o.push(`<text x="${f1(dimX1 + 7)}" y="${f1((y0 + y1) / 2 - (d.sub ? 2 : -3))}" font-size="9.5" class="ro-dt">${esc(d.main)}</text>`);
    if (d.sub) o.push(`<text x="${f1(dimX1 + 7)}" y="${f1((y0 + y1) / 2 + 10)}" font-size="8.5" class="ro-ds">${d.sub}</text>`);
  }
  o.push(`<line x1="${f1(right + 4)}" y1="${f1(T + Hd)}" x2="${f1(dimX2 + 6)}" y2="${f1(T + Hd)}" class="ro-ext"/>${tick(dimX1, T + Hd)}`);
  o.push(`<line x1="${f1(dimX1 + 6)}" y1="${T}" x2="${f1(dimX2 + 6)}" y2="${T}" class="ro-ext"/>`);
  o.push(`<line x1="${f1(dimX2)}" y1="${T}" x2="${f1(dimX2)}" y2="${f1(T + Hd)}" class="ro-dim"/>${tick(dimX2, T)}${tick(dimX2, T + Hd)}`);
  const dh = dimText(H, job);
  o.push(`<text transform="translate(${f1(dimX2 + 13)} ${f1(T + Hd / 2)}) rotate(90)" text-anchor="middle" font-size="10" class="ro-dt">${esc(dh.main)}${dh.sub ? ' ' + dh.sub : ''}</text>`);

  // nozzles: symbol at angle / elevation, hexagon tag above with a leader
  const placed = [];
  const noz = (job.nozzles || []).filter((n) => Number.isFinite(+n.angle) && +n.elev > 0 && +n.elev <= H).slice().sort((a, b) => (+a.angle) - (+b.angle));
  for (const n of noz) {
    const x = X(+n.angle), y = Y(+n.elev);
    const mw = /manway|door/i.test(n.type || '');
    const r = Math.max(mw ? 7 : 3.5, ((+n.size || 0) / 2) * kx);
    const bad = nozzleUT(n, job).status === 'Below t-min';
    let ty = y - r - 24;
    while (placed.some((p) => Math.abs(p.x - x) < 26 && Math.abs(p.y - ty) < 22)) ty -= 22;
    placed.push({ x, y: ty });
    const hx = 12, hy = 9;
    o.push(`<g class="ro-noz${bad ? ' bad' : ''}">`);
    if (mw) o.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}"/><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r * 0.72)}"/>`);
    else o.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}"/><path d="M${f1(x - r - 3)} ${f1(y)}H${f1(x + r + 3)}M${f1(x)} ${f1(y - r - 3)}V${f1(y + r + 3)}" class="ro-cross"/>`);
    o.push(`<line x1="${f1(x)}" y1="${f1(y - r)}" x2="${f1(x)}" y2="${f1(ty + hy)}" class="ro-lead"/>`);
    o.push(`<path d="M${f1(x - hx)} ${f1(ty)}L${f1(x - hx / 2)} ${f1(ty - hy)}L${f1(x + hx / 2)} ${f1(ty - hy)}L${f1(x + hx)} ${f1(ty)}L${f1(x + hx / 2)} ${f1(ty + hy)}L${f1(x - hx / 2)} ${f1(ty + hy)}Z" class="ro-hex"/>`);
    o.push(`<text x="${f1(x)}" y="${f1(ty + 3.3)}" text-anchor="middle" font-size="${(n.mark || '').length > 3 ? 7.5 : 9}" class="ro-ht">${esc(n.mark || '')}</text></g>`);
  }

  o.push(`<text x="${f1(ox)}" y="${f1(vh - 6)}" font-size="9" class="ro-note">Shell roll-out looking from outside · angles clockwise from 0°${job.info?.zeroRef ? ' (' + esc(job.info.zeroRef) + ')' : ''} · circled numbers are plates in each course, numbered clockwise from the first seam (* closure plate) · ${stretched ? 'height stretched for clarity' : 'to scale'}${job.units === 'metric' ? ' · dimensions in mm' : ' · dimensions ft-in [mm]'}</text>`);
  o.push('</svg>');
  return o.join('');
}

export const SHELL_SVG_STYLE = `<style>
.ro-plate{fill:#fff;stroke:#111;stroke-width:1.1}.ro-pc{fill:#fff;stroke:#111;stroke-width:.9}.ro-pn,.ro-cn{fill:#111;font-family:Arial,sans-serif}
.ro-st{stroke:#111;stroke-width:.8}.ro-sc{fill:#fff;stroke:#111;stroke-width:1}.ro-sa{fill:#111;font-family:Arial,sans-serif;font-weight:700}.ro-sq{fill:#0f766e;font-family:Arial,sans-serif;font-weight:700}
.ro-dim{stroke:#111;stroke-width:.8}.ro-ext{stroke:#111;stroke-width:.5}.ro-tk{stroke:#111;stroke-width:1.2}.ro-dt{fill:#111;font-family:Arial,sans-serif}.ro-ds{fill:#444;font-family:Arial,sans-serif}
.ro-noz circle{fill:#fff;stroke:#111;stroke-width:1.1}.ro-cross{stroke:#111;stroke-width:.8}.ro-lead{stroke:#111;stroke-width:.7}.ro-hex{fill:#fff;stroke:#111;stroke-width:.9}.ro-ht{fill:#111;font-family:Arial,sans-serif;font-weight:700}
.ro-noz.bad circle,.ro-noz.bad .ro-hex{stroke:#b91c1c}.ro-noz.bad .ro-ht{fill:#b91c1c}.ro-note{fill:#555;font-family:Arial,sans-serif}
</style>`;
