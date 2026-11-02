// Repair patch plates for floor indications that need repair (API 653 9.10.1).
//  - Each repair indication gets a lap-welded patch centred on it: the default size (12 × 12 in), larger
//    where needed to extend at least the overlap allowance (API 653 9.10.1.1 b: 2 in) past the corrosion,
//    or the size typed on the indication. Overlapping patches, and indications with the same Repair ID,
//    are combined.
//  - Patches that would come within 6 in of the shell become tombstone patches (API 653 9.10.1.2): turned so
//    their sides run radially and meet the shell-to-bottom joint at 90°, extending to the shell.
//  - Patches in the critical zone are checked against the 9.10.1.2 requirements.
// All lengths in mm, floor coordinates (x right, y up, angle clockwise from the top).
import { itemFloor, angleOf } from './geometry.js';
import { coursePlates } from './shell.js';

const IN = 25.4, DEG = Math.PI / 180;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);

export function patchDefaults(job) {
  const met = job.units === 'metric';
  return { autoPatch: true, patchL: met ? 300 : 12 * IN, patchW: met ? 300 : 12 * IN, patchMargin: met ? 50 : 2 * IN, patchT: met ? 6 : 0.25 * IN, patchGap: 0, opTempOK: null };
}
export const TOMB_DIST = 6 * IN;      // within 6 in of the shell → tombstone (9.10.1.2)
export const CZ_TMAX = 0.25 * IN;     // max patch thickness in the critical zone
export const CZ_SEAM = 3 * IN;        // fillet welds at least 3 in (or 5t) from shell vertical seams

const unit = (deg) => [Math.sin(deg * DEG), Math.cos(deg * DEG)];         // radial unit vector
const tang = (deg) => [Math.cos(deg * DEG), -Math.sin(deg * DEG)];        // clockwise tangent
const rectPoly = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const bbox = (poly) => ({ x0: Math.min(...poly.map((p) => p[0])), x1: Math.max(...poly.map((p) => p[0])), y0: Math.min(...poly.map((p) => p[1])), y1: Math.max(...poly.map((p) => p[1])) });
const overlapBB = (a, b, g = 0) => a.x0 <= b.x1 + g && b.x0 <= a.x1 + g && a.y0 <= b.y1 + g && b.y0 <= a.y1 + g;

/** Tombstone polygon: centre angle θ, width W (tangential), from radius rIn out to the shell R (outer edge follows the shell). */
export function tombPoly(R, th, rIn, W) {
  const u = unit(th), t = tang(th), hw = W / 2, s = Math.sqrt(Math.max(R * R - hw * hw, 0));
  const P = (r, o) => [u[0] * r + t[0] * o, u[1] * r + t[1] * o];
  const pts = [P(rIn, -hw), P(rIn, hw), P(s, hw)];
  const a1 = Math.asin(Math.min(1, hw / R)) / DEG;
  for (let k = 1; k < 8; k++) { const a = th + a1 - (2 * a1 * k) / 8; pts.push([Math.sin(a * DEG) * R, Math.cos(a * DEG) * R]); }
  pts.push(P(s, -hw));
  return pts;
}

/** Patch list: [{ id, kind: 'rect'|'tomb', poly, x0..y1, cx, cy, L, W, th, t, inds, auto, cz, checks, status }] */
export function patchList(job, layout, calc) {
  const C = { ...patchDefaults(job), ...(job.calc || {}) };
  const L0 = num(C.patchL) || 12 * IN, W0 = num(C.patchW) || 12 * IN, m = num(C.patchMargin) ?? 2 * IN, gap = num(C.patchGap) ?? 0;
  const R = layout?.R || (+job.tank?.diameter || 0) / 2;
  let rects = [];
  for (const ind of job.indications || []) {
    const a = calc?.per?.get(ind.id);
    if (!a?.repair || !a.floor) continue;
    if (ind.repairMethod && !/patch/i.test(ind.repairMethod)) continue;
    const manual = num(ind.repLen) > 0 && num(ind.repWid) > 0;
    if (!manual && C.autoPatch === false) continue;
    const ext = Math.max(num(ind.len) || 0, num(ind.wid) || 0);
    const L = manual ? +ind.repLen : Math.max(L0, (num(ind.len) || 0) + 2 * m);
    const W = manual ? +ind.repWid : Math.max(W0, (num(ind.wid) || 0) + 2 * m);
    const { x, y } = a.floor;
    rects.push({ x0: x - L / 2, x1: x + L / 2, y0: y - W / 2, y1: y + W / 2, inds: [{ ind, x, y, ext, L, W }], manual, group: ind.repId ? String(ind.repId).trim() : null, t: num(ind.repT) });
  }
  const mergeAll = (list, test) => {
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if ((a.group && a.group === b.group) || test(a, b)) {
          list[i] = { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), inds: [...a.inds, ...b.inds], manual: a.manual && b.manual, group: a.group || b.group, t: a.t ?? b.t, tomb: a.tomb || b.tomb };
          list.splice(j, 1); merged = true; break outer;
        }
      }
    }
    return list;
  };
  rects = mergeAll(rects, (a, b) => overlapBB(a, b, gap));

  // near the shell → tombstone, sides radial (90° to the shell), extending to the shell
  const shapes = [];
  const toTomb = (r) => {
    const sx = r.inds.reduce((s, q) => s + q.x, 0), sy = r.inds.reduce((s, q) => s + q.y, 0);
    const th = angleOf(sx, sy);
    const u = unit(th), t = tang(th);
    let hw = r.manual ? 0 : W0 / 2, rIn = r.manual ? R : R - L0;
    for (const q of r.inds) {
      const along = q.x * u[0] + q.y * u[1], across = q.x * t[0] + q.y * t[1];
      if (r.manual) { hw = Math.max(hw, Math.abs(across) + q.W / 2); rIn = Math.min(rIn, R - q.L, along - q.ext / 2); }
      else { hw = Math.max(hw, Math.abs(across) + q.ext / 2 + m); rIn = Math.min(rIn, along - q.ext / 2 - m); }
    }
    const poly = tombPoly(R, th, rIn, 2 * hw);
    return { ...r, kind: 'tomb', th, rIn, poly, L: R - rIn, W: 2 * hw, ...bbox(poly) };
  };
  for (const r of rects) {
    const far = Math.max(...rectPoly(r.x0, r.x1, r.y0, r.y1).map(([x, y]) => Math.hypot(x, y)));
    if (R > 0 && far > R - TOMB_DIST) shapes.push(toTomb(r));
    else shapes.push({ ...r, kind: 'rect', poly: rectPoly(r.x0, r.x1, r.y0, r.y1), L: r.x1 - r.x0, W: r.y1 - r.y0, th: null });
  }
  // tombstones that now overlap each other are combined
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < shapes.length && !again; i++) for (let j = i + 1; j < shapes.length && !again; j++) {
      const a = shapes[i], b = shapes[j];
      if (overlapBB(a, b, gap) && (a.kind === 'tomb' || b.kind === 'tomb')) {
        const u = { inds: [...a.inds, ...b.inds], manual: a.manual && b.manual, group: a.group || b.group, t: a.t ?? b.t };
        shapes[i] = toTomb(u); shapes.splice(j, 1); again = true;
      }
    }
  }

  // number: Repair ID where given, otherwise P-1, P-2… in indication order
  const byNo = (r) => Math.min(...r.inds.map((q) => parseInt(String(q.ind.no).replace(/\D/g, ''), 10) || 0));
  shapes.sort((a, b) => byNo(a) - byNo(b));
  const used = new Set(shapes.map((r) => r.group).filter(Boolean)); let n = 0;
  const cz = num(C.czDist) ?? 3 * IN;
  return shapes.map((r) => {
    let id = r.group; if (!id) { do { id = `P-${++n}`; } while (used.has(id)); }
    const farR = Math.max(...r.poly.map(([x, y]) => Math.hypot(x, y)));
    const inCZ = R > 0 && farR > R - cz - 1;
    const c = (r.x0 + r.x1) / 2, d = (r.y0 + r.y1) / 2;
    const out = { ...r, id, inds: r.inds.map((q) => q.ind), cx: r.kind === 'tomb' ? unit(r.th)[0] * (R + r.rIn) / 2 : c, cy: r.kind === 'tomb' ? unit(r.th)[1] * (R + r.rIn) / 2 : d, auto: !r.manual, cz: inCZ, tAssumed: r.t == null, t: r.t ?? num(C.patchT) ?? 0.25 * IN };
    out.checks = czChecks(job, layout, out, C, R);
    out.status = !out.checks.length ? 'OK' : out.checks.some((k) => k.ok === false) ? 'Fails' : out.checks.some((k) => k.ok === null) ? 'Verify' : 'OK';
    return out;
  });
}

/** API 653 9.10.1.2 checks for a patch in the critical zone (empty list outside it). */
function czChecks(job, layout, p, C, R) {
  if (!p.cz && p.kind !== 'tomb') return [];
  const ck = [], t1 = num(job.shell?.courses?.[0]?.tNom);
  const inch = (mm) => (job.units === 'metric' ? `${Math.round(mm)} mm` : `${(mm / IN).toFixed(2)} in`);
  ck.push({ item: 'Patch thickness not more than 1/4 in (and API 650 4.2.10 toughness)', ok: p.t <= CZ_TMAX + 0.01, note: `${inch(p.t)}${p.tAssumed ? ' (default patch thickness)' : ''}` });
  const near = Math.max(...p.poly.map(([x, y]) => Math.hypot(x, y))) > R - TOMB_DIST;
  ck.push({ item: 'Within 6 in of the shell: tombstone shape, sides meet the shell-to-bottom joint at about 90°', ok: !near || p.kind === 'tomb', note: p.kind === 'tomb' ? `Tombstone, sides radial at ${p.th.toFixed(1)}°` : near ? 'Rectangular patch near the shell' : 'More than 6 in from the shell' });
  ck.push({ item: 'Extends at least 2 in past the corroded area (9.10.1.1)', ok: p.auto ? (num(C.patchMargin) ?? 0) >= 2 * IN - 0.5 : null, note: p.auto ? `Auto size, ${inch(num(C.patchMargin) ?? 0)} past the corrosion` : 'Size entered — check' });
  // spacing from shell vertical seams (course 1)
  if (p.kind === 'tomb' && job.shell?.courses?.length && +job.tank?.diameter > 0) {
    const cp = coursePlates(job, job.shell.courses[0], 0);
    const half = Math.asin(Math.min(1, p.W / 2 / R)) / DEG, sides = [p.th - half, p.th + half];
    const dist = Math.min(...cp.seams.flatMap((s) => sides.map((a) => { let d = Math.abs(((a - s + 540) % 360) - 180); return (d * DEG) * R; })));
    const inside = cp.seams.some((s) => { const d = ((s - p.th + 540) % 360) - 180; return Math.abs(d) < half; });
    const need = Math.max(CZ_SEAM, t1 ? 5 * t1 : 0);
    ck.push({ item: `Fillet welds at least the greater of 3 in or 5t from shell vertical seams${t1 ? ` (5t = ${inch(5 * t1)})` : ''}`, ok: !inside && dist >= need - 0.5, note: inside ? 'A shell vertical seam falls within the patch width' : `Nearest course 1 seam ${inch(dist)} from a patch side` });
  } else if (p.kind === 'tomb') ck.push({ item: 'Fillet welds at least 3 in (or 5t) from shell vertical seams', ok: null, note: 'Enter the shell courses to check' });
  // over / butt-welded to an existing patch
  const feats = (job.features || []).filter((f) => f.type === 'patch' || f.type === 'repair');
  const hit = feats.find((f) => { const pos = layout ? itemFloor(layout, f) : null; if (!pos) return false; const A = +f.sizeA || 0, B = +f.sizeB || A; return overlapBB(p, { x0: pos.x - A / 2, x1: pos.x + A / 2, y0: pos.y - B / 2, y1: pos.y + B / 2 }, 3 * IN); });
  ck.push({ item: 'Not over, or butt-welded to, an existing patch plate', ok: !hit, note: hit ? `Close to existing ${hit.label || 'patch'}` : 'No existing patch recorded here' });
  ck.push({ item: 'Bottom plate under the perimeter weld at least 0.10 in (API 653 4.4)', ok: null, note: 'Verify by UT along the weld line' });
  const temp = num(job.tank?.opTemp), met = job.units === 'metric';
  ck.push({ item: 'Operating temperature not over 200 °F / 93 °C (carbon steel)', ok: temp === null ? null : temp <= (met ? 93 : 200), note: temp === null ? 'Enter the maximum operating temperature in Tank setup' : `${temp} ${met ? '°C' : '°F'}` });
  ck.push({ item: 'Perimeter weld two passes minimum, examined per API 653 (MT / PT)', ok: null, note: 'Welding requirement' });
  return ck;
}

/** Patch for an indication id. */
export function patchOf(patches, indId) { return patches.find((p) => p.inds.some((i) => i.id === indId)) || null; }

/** SVG path for a patch polygon (floor coordinates, y flipped), optionally scaled about its centre. */
export function patchPath(p, k = 1, R = 0) {
  if (p.kind === 'tomb' && k > 1.01 && R > 0) { // enlarge inward from the shell so the outer edge stays on the shell
    const L = Math.max(p.L, Math.min(p.L, p.W) * k), W = Math.max(p.W, Math.min(p.L, p.W) * k), f = (v) => (Math.round(v * 10) / 10).toString();
    return 'M' + tombPoly(R, p.th, R - L, W).map(([x, y]) => `${f(x)} ${f(-y)}`).join('L') + 'Z';
  }
  const cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2, f = (v) => (Math.round(v * 10) / 10).toString();
  return 'M' + p.poly.map(([x, y]) => `${f(cx + (x - cx) * k)} ${f(-(cy + (y - cy) * k))}`).join('L') + 'Z';
}
