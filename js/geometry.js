// Floor geometry: plate layout generation and coordinate transforms.
// Floor coordinates (mm): origin at tank centre, +x right, +y up (toward 0°) on the drawing.
// Angles are measured clockwise from 0° at the top of the drawing.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export const angleOf = (x, y) => { let a = Math.atan2(x, y) / DEG; if (a < 0) a += 360; return a; };
export const polar = (r, deg) => [r * Math.sin(deg * DEG), r * Math.cos(deg * DEG)];

export function polyArea(p) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return Math.abs(a / 2);
}

export function bbox(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

export function pointInPoly(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function circlePoly(r, n = 360) {
  const pts = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * TAU; pts.push([r * Math.cos(t), r * Math.sin(t)]); }
  return pts;
}

// Sutherland–Hodgman: keep the side where f(x,y) >= 0 for a linear edge function.
function clipHalf(poly, inside, intersect) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
    const cIn = inside(cur), pIn = inside(prev);
    if (cIn) { if (!pIn) out.push(intersect(prev, cur)); out.push(cur); }
    else if (pIn) out.push(intersect(prev, cur));
  }
  return out;
}

function clipToRect(poly, x0, y0, x1, y1) {
  const ix = (X) => (a, b) => [X, a[1] + ((b[1] - a[1]) * (X - a[0])) / (b[0] - a[0])];
  const iy = (Y) => (a, b) => [a[0] + ((b[0] - a[0]) * (Y - a[1])) / (b[1] - a[1]), Y];
  let p = poly;
  p = clipHalf(p, (q) => q[0] >= x0, ix(x0)); if (!p.length) return p;
  p = clipHalf(p, (q) => q[0] <= x1, ix(x1)); if (!p.length) return p;
  p = clipHalf(p, (q) => q[1] >= y0, iy(y0)); if (!p.length) return p;
  p = clipHalf(p, (q) => q[1] <= y1, iy(y1));
  return p;
}

const rowName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

export function defaultLayout() {
  return {
    plateW: 2438.4, plateL: 9144, orient: 'h', centerRow: true, stagger: 0.5,
    annular: false, annW: 609.6, annN: 24, annStart: 0, annPrefix: 'AN',
    scheme: 'letters', sep: '', seqPrefix: 'P', revRows: false, revPlates: false,
    refCorner: 'BL', minAreaPct: 0,
    mode: 'grid', rows: [], stackOff: 0
  };
}

/**
 * Build the floor plate layout.
 * Returns { R, Ri, plates: [...], byKey: Map }
 * plate = { key, label, kind: 'floor'|'annular', poly, bb, area, fullArea, cut, a0, a1 }
 */
export function buildLayout(job, opts = {}) {
  const L = { ...defaultLayout(), ...(job.layout || {}) };
  const R = (job.tank?.diameter || 0) / 2;
  const plates = [];
  if (!(R > 0) || !(L.plateW > 0) || !(L.plateL > 0)) return { R, Ri: R, plates, byKey: new Map(), L };

  const Ri = L.annular && L.annW > 0 && L.annW < R ? R - L.annW : R;

  // --- centre (sketch / rectangular) plates, generated in local u (along length) / v (across rows)
  const W = L.plateW, Lp = L.plateL;
  const clipCircle = circlePoly(Ri, 720);
  if (L.mode === 'custom' || L.mode === 'measured') customPlates(L, Ri, clipCircle, plates);
  else {
  const v0 = L.centerRow ? -W / 2 : 0;
  const kMin = Math.floor((-Ri - v0) / W) - 1, kMax = Math.ceil((Ri - v0) / W) + 1;
  const rows = [];
  for (let k = kMin; k <= kMax; k++) {
    const va = v0 + k * W, vb = va + W;
    const frac = (((k * (L.stagger || 0)) % 1) + 1) % 1;
    const s = -Lp / 2 + frac * Lp;
    const jMin = Math.floor((-Ri - s) / Lp) - 1, jMax = Math.ceil((Ri - s) / Lp) + 1;
    const row = [];
    for (let j = jMin; j <= jMax; j++) {
      const ua = s + j * Lp, ub = ua + Lp;
      // map local (u,v) rectangle to drawing coordinates
      const [x0, y0, x1, y1] = L.orient === 'v' ? [va, ua, vb, ub] : [ua, va, ub, vb];
      const poly = clipToRect(clipCircle, x0, y0, x1, y1);
      if (poly.length < 3) continue;
      const area = polyArea(poly), fullArea = W * Lp;
      if (area < fullArea * 1e-4 || area < (fullArea * (L.minAreaPct || 0)) / 100) continue;
      row.push({ key: `r${k}c${j}`, kind: 'floor', poly, bb: bbox(poly), area, fullArea, cut: area < fullArea * 0.999, rect: { x0, y0, x1, y1 } });
    }
    if (row.length) rows.push({ k, center: (va + vb) / 2, plates: row });
  }

  // order rows: horizontal rows top→bottom, vertical rows left→right
  rows.sort((a, b) => (L.orient === 'v' ? a.center - b.center : b.center - a.center));
  if (L.revRows) rows.reverse();
  let seq = 0;
  rows.forEach((row, ri) => {
    row.plates.sort((a, b) => (L.orient === 'v' ? (b.bb.y0 + b.bb.y1) - (a.bb.y0 + a.bb.y1) : (a.bb.x0 + a.bb.x1) - (b.bb.x0 + b.bb.x1)));
    if (L.revPlates) row.plates.reverse();
    row.plates.forEach((p, pi) => {
      seq++;
      p.row = ri; p.col = pi;
      p.autoLabel = L.scheme === 'sequential' ? `${L.seqPrefix || ''}${seq}` : `${rowName(ri)}${L.sep || ''}${pi + 1}`;
      plates.push(p);
    });
  });
  }

  // --- annular ring segments
  if (Ri < R) {
    const n = Math.max(1, Math.round(L.annN || 1));
    const step = 360 / n;
    for (let i = 0; i < n; i++) {
      const a0 = (L.annStart || 0) + i * step, a1 = a0 + step;
      const poly = [];
      const seg = Math.max(4, Math.ceil(step / 1.5));
      for (let t = 0; t <= seg; t++) poly.push(polar(R, a0 + (step * t) / seg));
      for (let t = seg; t >= 0; t--) poly.push(polar(Ri, a0 + (step * t) / seg));
      plates.push({ key: `an${i}`, kind: 'annular', poly, bb: bbox(poly), area: polyArea(poly), fullArea: polyArea(poly), cut: false, a0, a1, autoLabel: `${L.annPrefix || 'AN'}${i + 1}` });
    }
  }

  const ov = job.plates || {};
  for (const p of plates) {
    const o = ov[p.key] || {};
    p.label = (o.label || '').trim() || p.autoLabel;
    if (p.kind === 'annular') { p.datumEnd = o.datumC === 'end'; p.datumOwn = !!o.datumC; continue; }
    const c = ['BL', 'TL', 'BR', 'TR'].includes(o.datumC) ? o.datumC : L.refCorner || 'BL';
    const custom = false;
    // measured size / orientation: redraw the plate from its datum corner on the standard grid
    const len = +o.len > 0 ? +o.len : null, wid = +o.wid > 0 ? +o.wid : null;
    const orient = o.orient === 'h' || o.orient === 'v' ? o.orient : null;
    p.std = { len: L.plateL, wid: L.plateW, orient: L.orient === 'v' ? 'v' : 'h' };
    p.size = { len: len ?? L.plateL, wid: wid ?? L.plateW, orient: orient ?? p.std.orient };
    if (len || wid || (orient && orient !== p.std.orient)) {
      const g = p.rect;
      const w = p.size.orient === 'v' ? p.size.wid : p.size.len, hgt = p.size.orient === 'v' ? p.size.len : p.size.wid;
      const ax = c[1] === 'L' ? g.x0 : g.x1, ay = c[0] === 'B' ? g.y0 : g.y1;
      const x0 = c[1] === 'L' ? ax : ax - w, y0 = c[0] === 'B' ? ay : ay - hgt;
      const poly = clipToRect(clipCircle, x0, y0, x0 + w, y0 + hgt);
      if (poly.length >= 3) {
        p.rect = { x0, y0, x1: x0 + w, y1: y0 + hgt };
        p.poly = poly; p.bb = bbox(poly); p.area = polyArea(poly); p.fullArea = w * hgt;
        p.cut = p.area < p.fullArea * 0.999; p.resized = true;
      }
    }
    let x = custom ? o.datumX : c[1] === 'L' ? p.bb.x0 : p.bb.x1;
    let y = custom ? o.datumY : c[0] === 'B' ? p.bb.y0 : p.bb.y1;
    // X/Y are measured from the plate's outer edges in the datum direction (the corner of its
    // bounding box), so every point on the plate has X ≥ 0 and Y ≥ 0. Where that corner lies off the
    // floor (cut by the shell), the marker is drawn at the nearest seam / shell point instead.
    let mx = x, my = y, snapped = false;
    if (!custom && p.cut && !onPlate(p, x, y)) {
      let bd = Infinity;
      for (const [sx, sy] of datumSnapPoints(p)) { const d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; mx = sx; my = sy; } }
      snapped = true;
      if (opts.legacySnap) { x = mx; y = my; } // v1.0–1.7 measured from the snapped point
    }
    p.datum = { c, custom, snapped, own: !!o.datumC || custom, x, y, mx, my };
  }
  const byKey = new Map(plates.map((p) => [p.key, p]));
  return { R, Ri, plates, byKey, L };
}

/* ------------------------------------------------------------------ row-by-row floor builder ---
 * layout.rows: sections stacked across the floor (top → bottom for horizontal rows, left → right
 * when rows run top – bottom). Each section has a stable id so plate keys survive edits.
 *   { id, type: 'row',   h, n, len?, off? }   strip of h; n plates: n−2 full plates (len) centred,
 *                                             sketch plates at both ends out to the shell
 *   { id, type: 'block', h, n, w, off?, sideH, sideN }   n plates of width w set across the rows
 *                                             (h long); gaps to the shell at both ends filled with
 *                                             side rows sideH deep, sideN plates each
 * Plates are built in local u (along the row) / v (across rows) and mapped to the drawing.
 */
export const halfChord = (Ri, va, vb) => {
  const m = va <= 0 && vb >= 0 ? 0 : Math.min(Math.abs(va), Math.abs(vb));
  return m >= Ri ? 0 : Math.sqrt(Ri * Ri - m * m);
};

/** Plates needed for a row so the middle ones are full length and the end sketch plates are ½–1 plate long. */
export function suggestCount(Ri, va, vb, len) {
  const c = 2 * halfChord(Ri, va, vb);
  if (!(c > 0) || !(len > 0)) return 0;
  return c <= len ? 1 : Math.max(2, Math.ceil(c / len));
}

/** Where the stacked sections sit across the floor: [{ sec, va, vb }]. */
/** Sections used by the current layout method: row-by-row (rows) or plate-by-plate (mrows). */
export const sectionsOf = (L) => (L.mode === 'measured' ? L.mrows : L.rows) || [];

export function stackSections(L) {
  const secs = sectionsOf(L).filter((r) => +r.h > 0);
  const total = secs.reduce((a, r) => a + +r.h, 0);
  let top = total / 2 + (+L.stackOff || 0);
  return { total, list: secs.map((sec) => { const vb = top, va = top - sec.h; top = va; return { sec, va, vb }; }) };
}

function customPlates(L, Ri, clipCircle, out) {
  const E = Ri + 10; // beyond the shell
  const toXY = (ua, ub, va, vb) => (L.orient === 'v' ? [-vb, ua, -va, ub] : [ua, va, ub, vb]);
  const make = (key, ua, ub, va, vb, nominal) => {
    const [x0, y0, x1, y1] = toXY(ua, ub, va, vb);
    const poly = clipToRect(clipCircle, x0, y0, x1, y1);
    if (poly.length < 3) return null;
    const area = polyArea(poly);
    if (area < 1e3) return null;
    const bb = bbox(poly);
    const full = nominal ?? (ub - ua) * (vb - va);
    return { key, kind: 'floor', poly, bb, area, fullArea: full, cut: area < full * 0.999,
      rect: { x0: Math.max(x0, bb.x0), y0: Math.max(y0, bb.y0), x1: Math.min(x1, bb.x1), y1: Math.min(y1, bb.y1) } };
  };
  // drawing order inside a row: left → right (h), top → bottom (v)
  const byPos = (a, b) => (L.orient === 'v' ? (b.bb.y0 + b.bb.y1) - (a.bb.y0 + a.bb.y1) : (a.bb.x0 + a.bb.x1) - (b.bb.x0 + b.bb.x1));
  const { list } = stackSections(L);
  const measured = L.mode === 'measured';
  const groups = [];
  for (const { sec, va, vb } of list) {
    const off = +sec.off || 0;
    const n = Math.max(0, Math.round(+sec.n || 0));
    if (sec.type === 'block') {
      const w = +sec.w > 0 ? +sec.w : L.plateW;
      const main = [];
      let u0 = -(n * w) / 2 + off, uEnd = u0 + n * w;
      if (measured) {
        // plates side by side, each its own width; length runs across the rows from the block's top edge
        const pls = sec.plates || [];
        const tot = pls.reduce((a, pl) => a + (+pl.wid > 0 ? +pl.wid : L.plateW), 0);
        u0 = -tot / 2 + off; uEnd = u0 + tot;
        let ua = u0;
        for (const pl of pls) {
          const pw = +pl.wid > 0 ? +pl.wid : L.plateW, pd = +pl.len > 0 ? +pl.len : vb - va;
          const p = make(`${sec.id}-${pl.id}`, ua, ua + pw, vb - pd, vb, pw * pd);
          if (p) { p.rowId = sec.id; p.plId = pl.id; p.part = 'mblock'; main.push(p); }
          ua += pw;
        }
      } else {
        for (let i = 0; i < n; i++) {
          const p = make(`${sec.id}-${i}`, u0 + i * w, u0 + (i + 1) * w, va, vb, w * (vb - va));
          if (p) { p.rowId = sec.id; p.part = 'block'; main.push(p); }
        }
      }
      const sideH = +sec.sideH > 0 ? +sec.sideH : L.plateW, sideN = Math.max(1, Math.round(+sec.sideN || 1));
      const nRows = Math.max(1, Math.ceil((vb - va) / sideH - 1e-6));
      const sides = { L: [], R: [] };
      for (let k = 0; k < nRows; k++) {
        const sb = vb - k * sideH, sa = Math.max(va, sb - sideH);
        const hc = halfChord(Ri, sa, sb);
        for (const side of ['L', 'R']) {
          const [a, b] = side === 'L' ? [-hc, u0] : [uEnd, hc];
          if (b - a <= 1) continue;
          const step = (b - a) / sideN;
          for (let j = 0; j < sideN; j++) {
            const ua = j === 0 && side === 'L' ? -E : a + j * step, ub = j === sideN - 1 && side === 'R' ? E : a + (j + 1) * step;
            const p = make(`${sec.id}-${side}${k}-${j}`, ua, ub, sa, sb);
            if (p) { p.rowId = sec.id; p.part = 'side'; p.side = side; p.sideRow = k; p.sideIdx = j; sides[side].push(p); }
          }
        }
      }
      groups.push({ sec, main, sides });
    } else if (measured) {
      // plates end to end along the row, each its own length; width hangs from the row's top edge
      const pls = sec.plates || [];
      const tot = pls.reduce((a, pl) => a + (+pl.len > 0 ? +pl.len : L.plateL), 0);
      let ua = -tot / 2 + off;
      const main = [];
      for (const pl of pls) {
        const pl_ = +pl.len > 0 ? +pl.len : L.plateL, pw = +pl.wid > 0 ? +pl.wid : vb - va;
        const p = make(`${sec.id}-${pl.id}`, ua, ua + pl_, vb - pw, vb, pl_ * pw);
        if (p) { p.rowId = sec.id; p.plId = pl.id; p.part = 'mrow'; main.push(p); }
        ua += pl_;
      }
      groups.push({ sec, main });
    } else {
      const len = +sec.len > 0 ? +sec.len : L.plateL;
      const cuts = [];
      if (n === 2) cuts.push(off);
      else if (n >= 3) { const k = n - 2, u0 = -(k * len) / 2 + off; for (let i = 0; i <= k; i++) cuts.push(u0 + i * len); }
      const edges = [-E, ...cuts, E];
      const main = [];
      for (let i = 0; i + 1 < edges.length && n > 0; i++) {
        const full = i > 0 && i < edges.length - 2 ? len * (vb - va) : undefined;
        const p = make(`${sec.id}-${i}`, edges[i], edges[i + 1], va, vb, full);
        if (p) { p.rowId = sec.id; p.part = 'row'; main.push(p); }
      }
      groups.push({ sec, main });
    }
  }
  if (L.revRows) groups.reverse();
  let seq = 0;
  groups.forEach((g, gi) => {
    const letter = rowName(gi);
    g.main.sort(byPos); if (L.revPlates) g.main.reverse();
    g.main.forEach((p, i) => { seq++; p.row = gi; p.col = i; p.autoLabel = L.scheme === 'sequential' ? `${L.seqPrefix || ''}${seq}` : `${letter}${L.sep || ''}${i + 1}`; out.push(p); });
    if (g.sides) for (const side of ['L', 'R']) {
      const tag = L.orient === 'v' ? (side === 'L' ? 'B' : 'T') : side;
      for (const p of g.sides[side]) {
        seq++; p.row = gi;
        const multi = (g.sec.sideN || 1) > 1;
        p.autoLabel = L.scheme === 'sequential' ? `${L.seqPrefix || ''}${seq}` : `${letter}${tag}${p.sideRow + 1}${multi ? '.' + (p.sideIdx + 1) : ''}`;
        out.push(p);
      }
    }
  });
}

function onPlate(p, x, y) {
  if (pointInPoly(x, y, p.poly)) return true;
  return p.poly.some(([px, py]) => Math.hypot(px - x, py - y) < 1);
}

/** Find the plate under a floor point. */
export function plateAt(layout, x, y) {
  const r = Math.hypot(x, y);
  if (r > layout.R) return null;
  if (layout.Ri < layout.R && r >= layout.Ri) {
    const a = angleOf(x, y);
    return layout.plates.find((p) => p.kind === 'annular' && inArc(a, p.a0, p.a1)) || null;
  }
  // plates with a measured size are drawn on top, so they win where they overlap the standard grid
  const order = layout.plates.filter((p) => p.kind === 'floor' && p.resized).concat(layout.plates.filter((p) => p.kind === 'floor' && !p.resized));
  for (const p of order) {
    const b = p.bb;
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
    if (pointInPoly(x, y, p.poly)) return p;
  }
  return null;
}

const norm = (a) => ((a % 360) + 360) % 360;
function inArc(a, a0, a1) { const d = norm(a - a0); return d <= norm(a1 - a0) || norm(a1 - a0) === 0; }

/** Unit vectors (floor coords) of a floor plate's datum axes. */
export function datumAxes(plate) {
  const c = plate.datum.c;
  return { sx: c[1] === 'L' ? 1 : -1, sy: c[0] === 'B' ? 1 : -1 };
}

/**
 * Local plate coordinates, measured from the plate's datum.
 * Floor plates: X = horizontal, Y = vertical distance on the drawing from the datum point; the datum corner
 *   sets the direction (e.g. bottom-left → X to the right, Y up). The datum can be a custom point.
 * Annular plates: X = arc distance along the shell from the datum seam (start seam → clockwise, end seam →
 *   counter-clockwise), Y = radial distance in from the shell.
 */
export function toLocal(layout, plate, x, y) {
  if (plate.kind === 'annular') {
    const a = plate.datumEnd ? norm(plate.a1 - angleOf(x, y)) : norm(angleOf(x, y) - plate.a0);
    return { X: layout.R * a * DEG, Y: layout.R - Math.hypot(x, y) };
  }
  const d = plate.datum, { sx, sy } = datumAxes(plate);
  return { X: sx * (x - d.x), Y: sy * (y - d.y) };
}

export function toFloor(layout, plate, X, Y) {
  if (!plate || X === null || Y === null || X === undefined || Y === undefined) return null;
  if (plate.kind === 'annular') {
    const a = plate.datumEnd ? plate.a1 - (X / layout.R) / DEG : plate.a0 + (X / layout.R) / DEG;
    const [x, y] = polar(layout.R - Y, a);
    return { x, y };
  }
  const d = plate.datum, { sx, sy } = datumAxes(plate);
  return { x: d.x + sx * X, y: d.y + sy * Y };
}

/** Datum position on the floor (for annular plates: the datum seam at the shell). */
export function datumPoint(layout, plate) {
  if (plate.kind === 'annular') { const [x, y] = polar(layout.R, plate.datumEnd ? plate.a1 : plate.a0); return { x, y }; }
  return { x: plate.datum.mx ?? plate.datum.x, y: plate.datum.my ?? plate.datum.y };
}

/** Points worth snapping a datum to: plate corners and where seams meet the shell / annular ring. */
export function datumSnapPoints(plate) {
  if (plate.kind === 'annular' || !plate.rect) return [];
  const r = plate.rect, e = 1;
  // polygon vertices on the plate's straight seams: true corners and where seams meet the shell / annular ring
  return plate.poly.filter(([x, y]) => Math.abs(x - r.x0) < e || Math.abs(x - r.x1) < e || Math.abs(y - r.y0) < e || Math.abs(y - r.y1) < e);
}

export const orientName = (o) => (o === 'v' ? 'Vertical' : 'Horizontal');

export function datumName(plate) {
  if (plate.kind === 'annular') return plate.datumEnd ? 'end seam' : 'start seam';
  if (plate.datum.snapped) return `${refCornerName(plate.datum.c)} (plate edges, corner cut by shell)`;
  return `${refCornerName(plate.datum.c)} corner`;
}

/** Where an item sits on the floor (or null). Item = { plate, x, y } in mm local coordinates. */
export function itemFloor(layout, item) {
  const p = layout.byKey.get(item.plate);
  if (!p) return null;
  return toFloor(layout, p, item.x ?? 0, item.y ?? 0);
}

export function refCornerName(c) {
  return { BL: 'bottom-left', TL: 'top-left', BR: 'bottom-right', TR: 'top-right' }[c] || c;
}
