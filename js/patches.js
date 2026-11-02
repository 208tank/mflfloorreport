// Repair patch plates for floor indications that need repair.
// Each repair indication gets a lap-welded patch centred on it: the default size (12 × 12 in), or larger so
// it extends past the corrosion by the overlap allowance, or the size typed on the indication. Patches that
// overlap (or share a Repair ID) are combined into one rectangle. Patches are axis-aligned on the floor map.
// All lengths in mm, floor coordinates.

export function patchDefaults(job) {
  const met = job.units === 'metric';
  return { autoPatch: true, patchL: met ? 300 : 304.8, patchW: met ? 300 : 304.8, patchMargin: met ? 25 : 25.4, patchGap: 0 };
}
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);

/** Patch list: [{ id, x0, x1, y0, y1, cx, cy, L, W, t, inds: [indication], auto, cz }] */
export function patchList(job, layout, calc) {
  const C = { ...patchDefaults(job), ...(job.calc || {}) };
  const L0 = num(C.patchL) || 304.8, W0 = num(C.patchW) || 304.8, m = num(C.patchMargin) ?? 25.4, gap = num(C.patchGap) ?? 0;
  const rects = [];
  for (const ind of job.indications || []) {
    const a = calc?.per?.get(ind.id);
    if (!a?.repair || !a.floor) continue;
    if (ind.repairMethod && !/patch/i.test(ind.repairMethod)) continue;
    const manual = num(ind.repLen) > 0 && num(ind.repWid) > 0;
    if (!manual && C.autoPatch === false) continue;
    const L = manual ? +ind.repLen : Math.max(L0, (num(ind.len) || 0) + 2 * m);
    const W = manual ? +ind.repWid : Math.max(W0, (num(ind.wid) || 0) + 2 * m);
    const { x, y } = a.floor;
    rects.push({ x0: x - L / 2, x1: x + L / 2, y0: y - W / 2, y1: y + W / 2, inds: [ind], manual, group: ind.repId ? String(ind.repId).trim() : null, t: num(ind.repT) });
  }
  // merge overlapping patches and patches with the same Repair ID
  const near = (a, b) => a.x0 <= b.x1 + gap && b.x0 <= a.x1 + gap && a.y0 <= b.y1 + gap && b.y0 <= a.y1 + gap;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if ((a.group && a.group === b.group) || near(a, b)) {
        rects[i] = { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), inds: [...a.inds, ...b.inds], manual: a.manual && b.manual, group: a.group || b.group, t: a.t ?? b.t };
        rects.splice(j, 1); merged = true; break outer;
      }
    }
  }
  // number them: Repair ID where given, otherwise P-1, P-2… in indication order
  const byNo = (r) => Math.min(...r.inds.map((i) => parseInt(String(i.no).replace(/\D/g, ''), 10) || 0));
  rects.sort((a, b) => byNo(a) - byNo(b));
  const used = new Set(rects.map((r) => r.group).filter(Boolean)); let n = 0;
  const R = layout?.R || 0, cz = num(C.czDist) ?? 76.2;
  return rects.map((r) => {
    let id = r.group; if (!id) { do { id = `P-${++n}`; } while (used.has(id)); }
    const far = Math.max(...[[r.x0, r.y0], [r.x0, r.y1], [r.x1, r.y0], [r.x1, r.y1]].map(([x, y]) => Math.hypot(x, y)));
    return { ...r, id, cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2, L: r.x1 - r.x0, W: r.y1 - r.y0, auto: !r.manual, cz: R > 0 && far > R - cz, shell: R > 0 && far > R };
  });
}

/** Patch for an indication id. */
export function patchOf(patches, indId) { return patches.find((p) => p.inds.some((i) => i.id === indId)) || null; }
