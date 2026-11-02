// SVG floor map rendering and interaction.
import { polar, datumPoint, datumAxes } from './geometry.js';
import { nozzleUT } from './calc.js';
import { patchList, patchPath } from './patches.js';

export const COLORS = { ps: '#1f6feb', ss: '#d9480f', both: '#8250df', pending: '#6b7280', nri: '#9ca3af', other: '#9ca3af' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (v) => (Math.round(v * 10) / 10).toString();
const pathOf = (poly) => 'M' + poly.map(([x, y]) => `${f(x)} ${f(-y)}`).join('L') + 'Z';

function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const c = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += c; cx += (poly[j][0] + poly[i][0]) * c; cy += (poly[j][1] + poly[i][1]) * c;
  }
  if (Math.abs(a) < 1e-9) return poly[0];
  return [cx / (3 * a), cy / (3 * a)];
}

export function featureShape(ft, x, y, s) {
  const sx = f(x), sy = f(-y);
  const A = Math.max(+ft.sizeA || 0, s * 2), B = Math.max(+ft.sizeB || ft.sizeA || 0, s * 2);
  switch (ft.type) {
    case 'column': return `<circle cx="${sx}" cy="${sy}" r="${f(A / 2)}" class="ft ft-column"/>`;
    case 'sump': return `<circle cx="${sx}" cy="${sy}" r="${f(A / 2)}" class="ft ft-sump"/><circle cx="${sx}" cy="${sy}" r="${f(A / 4)}" class="ft ft-sump"/>`;
    case 'patch': case 'repair': return `<rect x="${f(x - A / 2)}" y="${f(-y - B / 2)}" width="${f(A)}" height="${f(B)}" class="ft ft-patch"/>`;
    case 'nozzle': case 'manway': return `<rect x="${f(x - A / 2)}" y="${f(-y - B / 2)}" width="${f(A)}" height="${f(B)}" rx="${f(Math.min(A, B) / 2)}" class="ft ft-nozzle"/>`;
    default: return `<path d="M${f(x - A / 2)} ${f(-y)}L${sx} ${f(-y - A / 2)}L${f(x + A / 2)} ${f(-y)}L${sx} ${f(-y + A / 2)}Z" class="ft ft-other"/>`;
  }
}

/**
 * Build the SVG markup.
 * opts: { calc, selected, selPlate, plateLabels, indLabels, filter:Set, print, preview:{x,y} }
 */
export function renderMapSVG(job, layout, opts = {}) {
  const R = layout.R;
  if (!(R > 0)) return `<svg class="floormap" viewBox="0 0 100 60"><text x="50" y="30" text-anchor="middle" class="empty-msg" font-size="4">Enter the tank diameter and plate size in Setup</text></svg>`;
  const s = R / 100;
  const M = R * ((job.nozzles || []).length ? 0.19 : 0.16);
  const vb = `${f(-R - M)} ${f(-R - M)} ${f(2 * (R + M))} ${f(2 * (R + M))}`;
  const calc = opts.calc;
  const out = [];
  out.push(`<svg class="floormap${opts.print ? ' print' : ''}" xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" data-r="${R}" style="--s:${s}">`);
  out.push(`<defs>
    <pattern id="hatch-not" patternUnits="userSpaceOnUse" width="${f(s * 3)}" height="${f(s * 3)}" patternTransform="rotate(45)"><rect width="${f(s * 3)}" height="${f(s * 3)}" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="${f(s * 3)}" class="hatch-line" stroke-width="${f(s * 0.6)}"/></pattern>
    <pattern id="hatch-part" patternUnits="userSpaceOnUse" width="${f(s * 5)}" height="${f(s * 5)}" patternTransform="rotate(45)"><rect width="${f(s * 5)}" height="${f(s * 5)}" class="hatch-bg2"/><line x1="0" y1="0" x2="0" y2="${f(s * 5)}" class="hatch-line" stroke-width="${f(s * 0.35)}"/></pattern>
  </defs>`);

  // plates
  out.push('<g class="plates">');
  for (const p of [...layout.plates.filter((q) => !q.resized), ...layout.plates.filter((q) => q.resized)]) {
    const scan = job.plates?.[p.key]?.scan || 'scanned';
    const cls = `plate ${p.kind} scan-${scan}${p.resized ? ' measured' : ''}${opts.selPlate === p.key ? ' sel' : ''}`;
    out.push(`<path d="${pathOf(p.poly)}" class="${cls}" data-plate="${esc(p.key)}" stroke-width="${f(s * 0.22)}"/>`);
  }
  out.push('</g>');

  // shell & critical zone
  const czDist = +(job.calc?.czDist ?? 76.2);
  out.push(`<circle cx="0" cy="0" r="${f(R)}" class="shell" stroke-width="${f(s * 0.9)}"/>`);
  if (czDist > 0 && opts.showCZ !== false) out.push(`<circle cx="0" cy="0" r="${f(R - czDist)}" class="cz" stroke-width="${f(s * 0.25)}" stroke-dasharray="${f(s * 1.5)} ${f(s)}"/>`);

  // degree ticks
  out.push('<g class="ticks">');
  for (let a = 0; a < 360; a += 10) {
    const big = a % 30 === 0;
    const [x1, y1] = polar(R + s * 1.2, a), [x2, y2] = polar(R + s * (big ? 4.5 : 2.8), a);
    out.push(`<line x1="${f(x1)}" y1="${f(-y1)}" x2="${f(x2)}" y2="${f(-y2)}" stroke-width="${f(s * (big ? 0.45 : 0.25))}"/>`);
    if (big) {
      const [tx, ty] = polar(R + s * ((job.nozzles || []).length ? 13.5 : 9), a);
      const lab = a === 0 && job.info?.zeroRef ? `${a}° ${job.info.zeroRef}` : `${a}°`;
      out.push(`<text x="${f(tx)}" y="${f(-ty)}" font-size="${f(s * 3.6)}" text-anchor="middle" dominant-baseline="central" class="${a === 0 ? 'zero' : ''}">${esc(lab)}</text>`);
    }
  }
  out.push('</g>');

  // plate labels
  if (opts.plateLabels !== false) {
    out.push('<g class="plabels">');
    for (const p of layout.plates) {
      const [cx, cy] = p.kind === 'annular' ? polar((R + layout.Ri) / 2, (p.a0 + p.a1) / 2) : centroid(p.poly);
      const w = p.bb.x1 - p.bb.x0, h = p.bb.y1 - p.bb.y0;
      let fs = Math.min(s * 3, Math.min(w, h) * 0.32);
      if (p.kind === 'annular') fs = Math.min(s * 2.6, (R - layout.Ri) * 0.45);
      if (fs < s * 0.9) continue;
      out.push(`<text x="${f(cx)}" y="${f(-cy)}" font-size="${f(fs)}" text-anchor="middle" dominant-baseline="central">${esc(p.label)}</text>`);
    }
    out.push('</g>');
  }

  // shell nozzles (outside the shell, by angle)
  if ((job.nozzles || []).length) {
    out.push(`<g class="nozzles" stroke-width="${f(s * 0.35)}">`);
    for (const nz of job.nozzles) {
      const a = +nz.angle; if (!Number.isFinite(a)) continue;
      const big = /manway|door/i.test(nz.type || '');
      const sz = Math.max(+nz.size || 0, s * (big ? 2.6 : 1.6));
      const L1 = R + s * 0.4, L2 = R + s * (big ? 3.2 : 4.2);
      const rad = a * Math.PI / 180, tx = Math.cos(rad), ty = -Math.sin(rad); // tangent (floor coords)
      const P = (r, t) => { const [x, y] = polar(r, a); return [x + tx * t, y + ty * t]; };
      const pts = [P(L1, -sz / 2), P(L2, -sz / 2), P(L2, sz / 2), P(L1, sz / 2)];
      const fl = [P(L2, -sz / 2 - s * 0.7), P(L2 + s * 0.9, -sz / 2 - s * 0.7), P(L2 + s * 0.9, sz / 2 + s * 0.7), P(L2, sz / 2 + s * 0.7)];
      const d = (q) => 'M' + q.map(([x, y]) => `${f(x)} ${f(-y)}`).join('L') + 'Z';
      const [lx, ly] = polar(L2 + s * 3, a);
      const bad = nozzleUT(nz, job).status === 'Below t-min';
      out.push(`<g class="nozzle${big ? ' mw' : ''}${bad ? ' bad' : ''}${opts.selNozzle === nz.id ? ' sel' : ''}" data-nozzle="${esc(nz.id)}"><path d="${d(pts)}"/><path class="fl" d="${d(fl)}"/>` +
        `<text x="${f(lx)}" y="${f(-ly)}" font-size="${f(s * 2.3)}" text-anchor="middle" dominant-baseline="central">${esc(nz.mark || '')}</text></g>`);
    }
    out.push('</g>');
  }

  // features
  out.push('<g class="features">');
  for (const ft of job.features || []) {
    const p = layout.byKey.get(ft.plate);
    if (!p) continue;
    const pos = opts.floorOf ? opts.floorOf(ft) : null;
    if (!pos) continue;
    out.push(`<g data-feature="${esc(ft.id)}" class="${opts.selFeature === ft.id ? 'sel' : ''}" stroke-width="${f(s * 0.3)}">${featureShape(ft, pos.x, pos.y, s)}`);
    if (ft.label) out.push(`<text x="${f(pos.x)}" y="${f(-pos.y + Math.max(+ft.sizeB || +ft.sizeA || 0, s * 2) / 2 + s * 2.4)}" font-size="${f(s * 2)}" text-anchor="middle" class="ftlabel">${esc(ft.label)}</text>`);
    out.push('</g>');
  }
  out.push('</g>');

  // repair patch plates
  if (opts.showPatches !== false && calc) {
    const pl = opts.patches || patchList(job, layout, calc);
    out.push('<g class="patches">');
    const minD = s * 5.2; // drawn at least this big so a 12 in patch shows on a large tank; true outline inside
    for (const pt of pl) {
      const k = Math.max(1, minD / Math.max(1, Math.min(pt.L, pt.W)));
      const cy = (pt.y0 + pt.y1) / 2, hy = pt.kind === 'tomb' ? Math.max(pt.y1 - pt.y0, Math.min(pt.L, pt.W) * k) / 2 : ((pt.y1 - pt.y0) / 2) * k;
      out.push(`<g class="patchp${pt.auto ? ' auto' : ''}${pt.cz ? ' cz' : ''}${pt.status === 'Fails' ? ' fail' : ''}"><path d="${patchPath(pt, k, R)}" stroke-width="${f(s * 0.3)}"/>` +
        (k > 1.01 ? `<path d="${patchPath(pt)}" class="true" stroke-width="${f(s * 0.15)}"/>` : '') +
        (() => { if (pt.kind === 'tomb') { const Ld = Math.max(pt.L, Math.min(pt.L, pt.W) * k) + s * 2.4, rr = R - Ld; return `<text x="${f(Math.sin(pt.th * Math.PI / 180) * rr)}" y="${f(-Math.cos(pt.th * Math.PI / 180) * rr + s * 0.7)}" font-size="${f(s * 1.9)}" text-anchor="middle" class="plabel">${esc(pt.id)}</text>`; } return `<text x="${f((pt.x0 + pt.x1) / 2)}" y="${f(-(cy - hy) + s * 2.1)}" font-size="${f(s * 1.9)}" text-anchor="middle" class="plabel">${esc(pt.id)}</text>`; })() + '</g>');
    }
    out.push('</g>');
  }

  // datum marks (X/Y origin of each plate)
  if (opts.showDatums !== false) {
    out.push('<g class="datums">');
    const focus = opts.datumFocus ? layout.byKey.get(opts.datumFocus) : null;
    for (const p of layout.plates) if (p !== focus) out.push(datumMark(layout, p, s, false));
    if (focus) out.push(datumMark(layout, focus, s, true));
    out.push('</g>');
  }

  // indications
  const mr = s * 1.35;
  out.push(`<g class="inds" stroke-width="${f(s * 0.3)}">`);
  for (const ind of job.indications || []) {
    const res = ind.result || 'pending';
    if (opts.filter && !opts.filter.has(res)) continue;
    const a = calc?.per.get(ind.id);
    const pos = a?.floor;
    if (!pos) continue;
    const x = f(pos.x), y = f(-pos.y);
    const col = COLORS[res] || COLORS.pending;
    const sel = opts.selected === ind.id;
    out.push(`<g class="ind r-${res}${sel ? ' sel' : ''}" data-ind="${esc(ind.id)}">`);
    if (a?.repair || a?.status === 'below MRT') out.push(`<circle cx="${x}" cy="${y}" r="${f(mr * 1.9)}" class="rep${a.status === 'below MRT' ? ' bad' : ''}" stroke-width="${f(s * 0.35)}"/>`);
    if (sel) out.push(`<circle cx="${x}" cy="${y}" r="${f(mr * 2.7)}" class="selring" stroke-width="${f(s * 0.45)}"/>`);
    if (res === 'nri') out.push(`<path d="M${f(pos.x - mr)} ${f(-pos.y - mr)}L${f(pos.x + mr)} ${f(-pos.y + mr)}M${f(pos.x - mr)} ${f(-pos.y + mr)}L${f(pos.x + mr)} ${f(-pos.y - mr)}" stroke="${col}" stroke-width="${f(s * 0.45)}"/>`);
    else if (res === 'other') out.push(`<path d="M${f(pos.x)} ${f(-pos.y - mr)}L${f(pos.x + mr)} ${f(-pos.y)}L${f(pos.x)} ${f(-pos.y + mr)}L${f(pos.x - mr)} ${f(-pos.y)}Z" fill="none" stroke="${col}"/>`);
    else if (res === 'pending') out.push(`<circle cx="${x}" cy="${y}" r="${f(mr)}" fill="var(--map-bg, #fff)" stroke="${col}" stroke-width="${f(s * 0.45)}"/>`);
    else if (res === 'both') out.push(`<circle cx="${x}" cy="${y}" r="${f(mr)}" fill="${col}" stroke="#fff"/><path d="M${f(pos.x - mr)} ${y}A${f(mr)} ${f(mr)} 0 0 1 ${f(pos.x + mr)} ${y}Z" fill="${COLORS.ps}"/><path d="M${f(pos.x - mr)} ${y}A${f(mr)} ${f(mr)} 0 0 0 ${f(pos.x + mr)} ${y}Z" fill="${COLORS.ss}"/>`);
    else out.push(`<circle cx="${x}" cy="${y}" r="${f(mr)}" fill="${col}" stroke="#fff"/>`);
    if (opts.indLabels !== false && ind.no) out.push(`<text x="${f(pos.x + mr * 1.5)}" y="${f(-pos.y - mr * 1.1)}" font-size="${f(s * 2.1)}" class="ilabel">${esc(ind.no)}</text>`);
    out.push('</g>');
  }
  out.push('</g>');

  if (opts.preview) out.push(`<g class="preview"><circle cx="${f(opts.preview.x)}" cy="${f(-opts.preview.y)}" r="${f(mr * 2.2)}" stroke-width="${f(s * 0.4)}"/><path d="M${f(opts.preview.x - mr * 4)} ${f(-opts.preview.y)}h${f(mr * 8)}M${f(opts.preview.x)} ${f(-opts.preview.y - mr * 4)}v${f(mr * 8)}" stroke-width="${f(s * 0.25)}"/></g>`);

  // north/zero arrow & scale bar (print)
  if (opts.print) {
    const U = job.units === 'metric' ? { len: 1000, name: 'm' } : { len: 304.8, name: 'ft' };
    let step = U.len; const target = R / 2.5;
    for (const m of [1, 2, 5, 10, 20, 25, 50]) if (m * U.len <= target) step = m * U.len;
    const x0 = -R - M * 0.8, y0 = R + M * 0.75;
    out.push(`<g class="scalebar"><rect x="${f(x0)}" y="${f(y0)}" width="${f(step)}" height="${f(s * 1.2)}"/><text x="${f(x0)}" y="${f(y0 - s * 1.2)}" font-size="${f(s * 2.6)}">0</text><text x="${f(x0 + step)}" y="${f(y0 - s * 1.2)}" font-size="${f(s * 2.6)}" text-anchor="middle">${f(step / U.len)} ${U.name}</text></g>`);
  }
  out.push('</svg>');
  return out.join('');
}

function axesOf(layout, p) {
  if (p.kind === 'annular') {
    const a = (p.datumEnd ? p.a1 : p.a0) * Math.PI / 180, dir = p.datumEnd ? -1 : 1;
    return { ux: [dir * Math.cos(a), -dir * Math.sin(a)], uy: [-Math.sin(a), -Math.cos(a)] };
  }
  const { sx, sy } = datumAxes(p);
  return { ux: [sx, 0], uy: [0, sy] };
}

/** Filled wedge tucked into the datum corner of a plate. */
function datumMark(layout, p, s, big) {
  const d = datumPoint(layout, p), { ux, uy } = axesOf(layout, p);
  const L = s * (big ? 4.2 : 2.2);
  const P = (fx, fy) => `${f(fx)} ${f(-fy)}`;
  return `<path class="datum${big ? ' big' : ''}${p.datum?.own || p.datumOwn ? ' own' : ''}" d="M${P(d.x, d.y)}L${P(d.x + ux[0] * L, d.y + ux[1] * L)}L${P(d.x + uy[0] * L, d.y + uy[1] * L)}Z"/>`;
}

/**
 * Pan / zoom / click / hover controller for a container whose SVG is re-rendered often.
 */
export class MapController {
  constructor(container, handlers) {
    this.c = container; this.h = handlers; this.vb = null; this.drag = null;
    container.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    container.addEventListener('pointerdown', (e) => this.onDown(e));
    container.addEventListener('pointermove', (e) => this.onMove(e));
    container.addEventListener('pointerup', (e) => this.onUp(e));
    container.addEventListener('pointerleave', () => this.h.onHover?.(null));
  }
  get svg() { return this.c.querySelector('svg'); }
  afterRender() {
    const svg = this.svg; if (!svg) return;
    const r = +svg.dataset.r;
    if (this.r !== r) { this.vb = null; this.r = r; }
    if (this.vb) svg.setAttribute('viewBox', this.vb.join(' '));
  }
  floorPt(e) {
    const svg = this.svg; if (!svg) return null;
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const m = svg.getScreenCTM(); if (!m) return null;
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: -p.y };
  }
  curVB() { return (this.vb || this.svg.getAttribute('viewBox').split(/\s+/).map(Number)).slice(); }
  setVB(vb) { this.vb = vb; this.svg?.setAttribute('viewBox', vb.join(' ')); }
  zoom(factor, cx, cy) {
    const svg = this.svg; if (!svg) return;
    const vb = this.curVB();
    if (cx === undefined) { cx = vb[0] + vb[2] / 2; cy = vb[1] + vb[3] / 2; }
    const nw = vb[2] * factor, nh = vb[3] * factor;
    const R = +svg.dataset.r || 1;
    if (nw > R * 4 || nw < R * 0.01) return;
    this.setVB([cx - ((cx - vb[0]) * nw) / vb[2], cy - ((cy - vb[1]) * nh) / vb[3], nw, nh]);
  }
  fit() { this.vb = null; this.h.rerender?.(); }
  focus(x, y, width) { const svg = this.svg; if (!svg) return; this.setVB([x - width / 2, -y - width / 2, width, width]); }
  onWheel(e) {
    if (!this.svg) return;
    e.preventDefault();
    const svg = this.svg, pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    this.zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
  }
  onDown(e) {
    if (e.button !== 0 || !this.svg) return;
    this.drag = { x: e.clientX, y: e.clientY, vb: this.curVB(), moved: false, id: e.pointerId };
  }
  onMove(e) {
    const fp = this.floorPt(e);
    this.h.onHover?.(fp);
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!this.drag.moved) { this.drag.moved = true; try { this.c.setPointerCapture(this.drag.id); } catch { /* */ } this.c.classList.add('panning'); }
    const svg = this.svg, rect = svg.getBoundingClientRect();
    const vb = this.drag.vb, scale = Math.max(vb[2] / rect.width, vb[3] / rect.height);
    this.setVB([vb[0] - dx * scale, vb[1] - dy * scale, vb[2], vb[3]]);
  }
  onUp(e) {
    const d = this.drag; this.drag = null; this.c.classList.remove('panning');
    if (!d || d.moved) return;
    const fp = this.floorPt(e);
    const t = e.target.closest?.('[data-ind],[data-feature],[data-nozzle],[data-plate]');
    this.h.onClick?.(fp, { ind: t?.dataset.ind, feature: t?.dataset.feature, nozzle: t?.dataset.nozzle, plate: t?.dataset.plate, shift: e.shiftKey });
  }
}
