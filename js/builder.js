// Starting layouts for the row-by-row floor builder.
import { suggestCount, halfChord, buildLayout, sectionsOf } from './geometry.js';
import { uid } from './model.js';

const innerRadius = (job) => {
  const R = (job.tank?.diameter || 0) / 2, L = job.layout || {};
  return L.annular && L.annW > 0 && L.annW < R ? R - L.annW : R;
};

export function newRow(job, type = 'row') {
  const L = job.layout;
  return type === 'block'
    ? { id: uid(), type: 'block', h: L.plateL, n: 3, w: L.plateW, off: 0, sideH: L.plateW, sideN: 1 }
    : { id: uid(), type: 'row', h: L.plateW, n: 3, len: null, off: 0 };
}

/** Rows across the whole floor, one per standard plate width, with plate counts worked out from the chord. */
export function rowsFromGrid(job) {
  const L = job.layout, Ri = innerRadius(job), W = L.plateW, Lp = L.plateL;
  if (!(Ri > 0 && W > 0 && Lp > 0)) return [];
  const n = Math.ceil((2 * Ri) / W - 1e-6), top = (n * W) / 2, rows = [];
  for (let k = 0; k < n; k++) {
    const vb = top - k * W, va = vb - W;
    let frac = (((k * (+L.stagger || 0)) % 1) + 1) % 1; if (frac > 0.5) frac -= 1;
    rows.push({ id: uid(), type: 'row', h: W, n: suggestCount(Ri, va, vb, Lp), len: null, off: Math.round(frac * Lp) });
  }
  return rows;
}

/** Vertical full-length plates in the centre, horizontal sketch-plate rows above, below and at the sides. */
export function rowsCentreBlock(job) {
  const L = job.layout, Ri = innerRadius(job), W = L.plateW, Lp = L.plateL;
  if (!(Ri > 0 && W > 0 && Lp > 0)) return [];
  const bh = Math.min(Lp, 2 * Ri * 0.9), half = bh / 2;
  const nBlock = Math.max(1, Math.floor((2 * halfChord(Ri, -half, half)) / W) - 1);
  const m = Math.max(0, Math.ceil((Ri - half) / W - 1e-6));
  const rows = [];
  for (let k = m - 1; k >= 0; k--) { const va = half + k * W, vb = va + W; rows.push({ id: uid(), type: 'row', h: W, n: suggestCount(Ri, va, vb, Lp), len: null, off: 0 }); }
  rows.push({ id: uid(), type: 'block', h: bh, n: nBlock, w: W, off: 0, sideH: W, sideN: 1 });
  for (let k = 0; k < m; k++) { const vb = -half - k * W, va = vb - W; rows.push({ id: uid(), type: 'row', h: W, n: suggestCount(Ri, va, vb, Lp), len: null, off: 0 }); }
  return rows;
}

/** Coverage check: how far the stacked sections fall short of / overrun the floor across the rows. */
export function coverage(job) {
  const rows = sectionsOf(job.layout || {}).filter((r) => +r.h > 0);
  const total = rows.reduce((a, r) => a + +r.h, 0);
  const span = 2 * innerRadius(job);
  const off = +job.layout?.stackOff || 0;
  const gapTop = span / 2 - (total / 2 + off), gapBottom = span / 2 - (total / 2 - off);
  return { total, span, gapTop, gapBottom };
}

/* ------------------------------------------------------------- plate by plate (measured) --- */

export const newPlate = (len = null, wid = null) => ({ id: uid(), len, wid });

export function newMeasuredSection(job, type = 'row') {
  const L = job.layout;
  return type === 'block'
    ? { id: uid(), type: 'block', h: L.plateL, off: 0, sideH: L.plateW, sideN: 1, plates: [newPlate(), newPlate(), newPlate()] }
    : { id: uid(), type: 'row', h: L.plateW, off: 0, plates: [newPlate(), newPlate(), newPlate()] };
}

/**
 * Turn the current drawing (automatic grid or row-by-row) into plate-by-plate sections, with each
 * plate's length and width taken from the drawing, so the crew only has to correct the numbers.
 */
export function measuredFromDrawing(job) {
  const L0 = job.layout || {};
  const rows = L0.mode === 'custom' && (L0.rows || []).length ? L0.rows : rowsFromGrid(job);
  const j = { ...job, layout: { ...L0, mode: 'custom', rows } };
  const lay = buildLayout(j);
  const v = L0.orient === 'v';
  const along = (p) => (v ? p.bb.y1 - p.bb.y0 : p.bb.x1 - p.bb.x0);
  const uPos = (p) => (v ? p.bb.y0 + p.bb.y1 : p.bb.x0 + p.bb.x1);
  const step = job.units === 'metric' ? 10 : 25.4, r1 = (x) => Math.round(x / step) * step; // nearest inch / 10 mm
  return rows.map((sec) => {
    const mains = lay.plates.filter((p) => p.rowId === sec.id && p.part !== 'side').sort((a, b) => uPos(a) - uPos(b));
    if (sec.type === 'block') {
      return { id: uid(), type: 'block', h: sec.h, off: +sec.off || 0, sideH: sec.sideH ?? L0.plateW, sideN: sec.sideN ?? 1,
        plates: mains.map((p) => newPlate(null, r1(along(p)))) };
    }
    return { id: uid(), type: 'row', h: sec.h, off: 0, plates: mains.map((p) => newPlate(r1(along(p)), null)) };
  });
}
