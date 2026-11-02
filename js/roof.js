// Roof: fixed roof details and UT points, floating roof layout (deck plates + pontoons) and 5-point plate UT.
import { buildLayout, defaultLayout, polar, pointInPoly } from './geometry.js';

const IN = 25.4, FT = 304.8;

export const ROOF_TYPES = [['none', 'No roof / not inspected'], ['fixed', 'Fixed roof'], ['efr', 'External floating roof'], ['fixed-ifr', 'Fixed roof + internal floating roof']];
export const FIXED_TYPES = ['Cone roof', 'Dome roof', 'Umbrella roof', 'Aluminium geodesic dome', 'Other'];
export const FIXED_SUPPORT = ['Column supported', 'Self supported', 'Rafter supported', 'Other'];
export const FLOAT_TYPES = ['Single-deck pontoon', 'Double-deck', 'Internal – steel pan', 'Internal – steel pontoon', 'Internal – aluminium', 'Other'];
export const PT5 = [['tl', 'Top-left'], ['tr', 'Top-right'], ['c', 'Centre'], ['bl', 'Bottom-left'], ['br', 'Bottom-right']];
export const PT5_SHORT = { tl: 'TL', tr: 'TR', c: 'C', bl: 'BL', br: 'BR' };
export const PONT_COND = ['', 'Dry', 'Liquid present', 'Leaking', 'Not accessible', 'Other'];

export function defaultRoof(units = 'imperial') {
  const m = units === 'metric';
  return {
    type: 'none',
    fixed: { kind: 'Cone roof', support: 'Column supported', slope: '', tNom: null, tMin: m ? 2.3 : 0.09 * IN, notes: '', pts: [] },
    floating: {
      kind: 'Single-deck pontoon', rimGap: m ? 200 : 8 * IN, pontW: m ? 1800 : 6 * FT, pontN: null, pontStart: 0,
      plateW: m ? 1800 : 6 * FT, plateL: m ? 6000 : 20 * FT, orient: 'h', stagger: 0.5,
      deckNom: null, deckMin: m ? 2.3 : 0.09 * IN, pontNom: null, pontMin: m ? 2.3 : 0.09 * IN,
      ut: {}, pont: {}, notes: ''
    }
  };
}

export function migrateRoof(r, units) {
  const d = defaultRoof(units);
  return { ...d, ...(r || {}), fixed: { ...d.fixed, ...(r?.fixed || {}) }, floating: { ...d.floating, ...(r?.floating || {}) } };
}

export const hasFixed = (job) => ['fixed', 'fixed-ifr'].includes(job.roof?.type);
export const hasFloating = (job) => ['efr', 'fixed-ifr'].includes(job.roof?.type);

/* ------------------------------------------------------------------------ floating roof --- */

export function roofDiameter(job) {
  const D = +job.tank?.diameter || 0, g = +job.roof?.floating?.rimGap || 0;
  return Math.max(0, D - 2 * g);
}

/** Suggested pontoon count: about one pontoon per 10 ft of circumference at mid-pontoon, at least 8. */
export function autoPontCount(job) {
  const Dr = roofDiameter(job), pw = +job.roof?.floating?.pontW || 0;
  const Rm = Dr / 2 - pw / 2;
  return Rm > 0 ? Math.max(8, Math.round((2 * Math.PI * Rm) / (10 * FT))) : 8;
}

/** Deck plates (kind 'floor', labelled A1…) and pontoons (kind 'annular', labelled P1…), built with the floor plate generator. */
export function floatingLayout(job) {
  const F = job.roof?.floating || defaultRoof(job.units).floating;
  const Dr = roofDiameter(job);
  const pw = +F.pontW > 0 ? +F.pontW : 0;
  const nP = +F.pontN > 0 ? Math.round(+F.pontN) : autoPontCount(job);
  const pseudo = {
    tank: { diameter: Dr },
    layout: { ...defaultLayout(), plateW: +F.plateW || 6 * FT, plateL: +F.plateL || 20 * FT, orient: F.orient === 'v' ? 'v' : 'h', stagger: +F.stagger || 0,
      centerRow: true, annular: pw > 0 && pw < Dr / 2, annW: pw, annN: nP, annStart: +F.pontStart || 0, annPrefix: 'P', mode: 'grid', scheme: 'letters', refCorner: 'BL' },
    plates: {}
  };
  const lay = buildLayout(pseudo);
  lay.nPont = nP; lay.Dr = Dr;
  return lay;
}

function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const c = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += c; cx += (poly[j][0] + poly[i][0]) * c; cy += (poly[j][1] + poly[i][1]) * c;
  }
  return Math.abs(a) < 1e-9 ? poly[0] : [cx / (3 * a), cy / (3 * a)];
}

/**
 * Where the 5 readings sit on a plate: corners inset 15% and the centre (pulled inside cut plates).
 * Pontoons: top = outer rim, bottom = inner rim, left = start (anticlockwise) end, right = clockwise end.
 */
export function utPoints(p, lay) {
  if (p.kind === 'annular') {
    const R = lay.R, Ri = lay.Ri, am = (p.a0 + p.a1) / 2, da = (p.a1 - p.a0) * 0.3;
    const rO = R - (R - Ri) * 0.2, rI = Ri + (R - Ri) * 0.2, rm = (R + Ri) / 2;
    return { tl: polar(rO, am - da), tr: polar(rO, am + da), c: polar(rm, am), bl: polar(rI, am - da), br: polar(rI, am + da) };
  }
  const b = p.bb, ix = (b.x1 - b.x0) * 0.15, iy = (b.y1 - b.y0) * 0.15;
  let c = centroid(p.poly); if (!pointInPoly(c[0], c[1], p.poly)) c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  const pull = (pt) => { for (let t = 0; t <= 1; t += 0.1) { const q = [c[0] + (pt[0] - c[0]) * (1 - t), c[1] + (pt[1] - c[1]) * (1 - t)]; if (pointInPoly(q[0], q[1], p.poly)) return q; } return c; };
  return { tl: pull([b.x0 + ix, b.y1 - iy]), tr: pull([b.x1 - ix, b.y1 - iy]), c, bl: pull([b.x0 + ix, b.y0 + iy]), br: pull([b.x1 - ix, b.y0 + iy]) };
}

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);

export function plateUT(job, p) {
  const F = job.roof.floating, r = F.ut?.[p.key] || {};
  const pont = p.kind === 'annular';
  const vals = PT5.map(([k]) => num(r[k])).filter((v) => v !== null);
  const tNom = num(pont ? F.pontNom : F.deckNom), tMin = num(pont ? F.pontMin : F.deckMin);
  const min = vals.length ? Math.min(...vals) : null;
  return { count: vals.length, min, tNom, tMin, lossPct: min !== null && tNom ? Math.max(0, ((tNom - min) / tNom) * 100) : null, status: min === null || !tMin ? '' : min < tMin - 1e-9 ? 'Below t-min' : 'OK' };
}

/* --------------------------------------------------------------------------- fixed roof --- */

export function pointStatus(job, pt) {
  const t = num(pt.t), tMin = num(job.roof.fixed.tMin), tNom = num(job.roof.fixed.tNom);
  return { t, lossPct: t !== null && tNom ? Math.max(0, ((tNom - t) / tNom) * 100) : null, status: t === null || !tMin ? '' : t < tMin - 1e-9 ? 'Below t-min' : 'OK' };
}

/* ----------------------------------------------------------------------------- drawings --- */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (v) => (Math.round(v * 10) / 10).toString();
const pathOf = (poly) => 'M' + poly.map(([x, y]) => `${f(x)} ${f(-y)}`).join('L') + 'Z';

function frame(job, s, Rt, M, cls) {
  return `<svg class="roofplan ${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="${f(-Rt - M)} ${f(-Rt - M)} ${f(2 * (Rt + M))} ${f(2 * (Rt + M))}" data-r="${Rt}" style="--s:${s}">`;
}

function ticks(job, Rt, s) {
  const o = ['<g class="rf-ticks">'];
  for (let a = 0; a < 360; a += 10) {
    const big = a % 30 === 0;
    const [x1, y1] = polar(Rt + s * 1.2, a), [x2, y2] = polar(Rt + s * (big ? 4.5 : 2.8), a);
    o.push(`<line x1="${f(x1)}" y1="${f(-y1)}" x2="${f(x2)}" y2="${f(-y2)}" stroke-width="${f(s * (big ? 0.45 : 0.25))}"/>`);
    if (big) { const [tx, ty] = polar(Rt + s * 9, a); o.push(`<text x="${f(tx)}" y="${f(-ty)}" font-size="${f(s * 3.6)}" text-anchor="middle" dominant-baseline="central" class="${a === 0 ? 'zero' : ''}">${a}°${a === 0 && job.info?.zeroRef ? ' ' + esc(job.info.zeroRef) : ''}</text>`); }
  }
  o.push('</g>');
  return o.join('');
}

const empty = (msg) => `<svg class="roofplan" viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg"><text x="50" y="30" text-anchor="middle" font-size="4" class="rf-empty">${msg}</text></svg>`;

/** Floating roof plan: shell, rim gap, pontoon ring, deck plates, and the 5 UT dots on every plate. */
export function floatingSVG(job, lay, opts = {}) {
  const D = +job.tank?.diameter || 0;
  if (!(D > 0) || !(lay.R > 0)) return empty('Enter the tank diameter in Tank setup');
  const Rt = D / 2, s = Rt / 100, M = Rt * 0.16;
  const o = [frame(job, s, Rt, M, 'floating')];
  o.push(`<circle cx="0" cy="0" r="${f(Rt)}" class="rf-shell" stroke-width="${f(s * 0.9)}"/>`);
  o.push(ticks(job, Rt, s));
  for (const p of lay.plates) {
    const st = plateUT(job, p).status;
    o.push(`<path d="${pathOf(p.poly)}" class="${p.kind === 'annular' ? 'rf-pont' : 'rf-deck'}${st === 'Below t-min' ? ' bad' : ''}${opts.sel === p.key ? ' sel' : ''}" data-plate="${esc(p.key)}" stroke-width="${f(s * 0.25)}"/>`);
  }
  o.push(`<circle cx="0" cy="0" r="${f(lay.R)}" class="rf-rim" stroke-width="${f(s * 0.5)}"/>`);
  if (lay.Ri < lay.R) o.push(`<circle cx="0" cy="0" r="${f(lay.Ri)}" class="rf-rim in" stroke-width="${f(s * 0.35)}"/>`);
  // labels
  o.push('<g class="rf-labels">');
  for (const p of lay.plates) {
    let x, y, fs;
    if (p.kind === 'annular') {
      [x, y] = polar((lay.R + lay.Ri) / 2, (p.a0 + p.a1) / 2);
      const arc = ((lay.R + lay.Ri) / 2) * (p.a1 - p.a0) * Math.PI / 180;
      fs = Math.min(s * 2.4, (lay.R - lay.Ri) * 0.28, arc * 0.3);
      const [lx, ly] = polar((lay.R + lay.Ri) / 2 + (lay.R - lay.Ri) * 0.02, (p.a0 + p.a1) / 2 + (p.a1 - p.a0) * 0.18);
      x = lx; y = ly;
    } else {
      const c = centroid(p.poly); x = c[0]; y = c[1];
      const w = p.bb.x1 - p.bb.x0, h = p.bb.y1 - p.bb.y0;
      fs = Math.min(s * 2.6, Math.min(w, h) * 0.24);
      y += Math.min(h * 0.18, fs * 1.4);
    }
    if (fs >= s * 0.8) o.push(`<text x="${f(x)}" y="${f(-y)}" font-size="${f(fs)}" text-anchor="middle" dominant-baseline="central">${esc(p.label)}</text>`);
  }
  o.push('</g>');
  // UT dots
  const F = job.roof.floating;
  o.push(`<g class="rf-dots" stroke-width="${f(s * 0.18)}">`);
  for (const p of lay.plates) {
    const pts = utPoints(p, lay), u = plateUT(job, p), r = F.ut?.[p.key] || {};
    for (const [k] of PT5) {
      const v = num(r[k]), [x, y] = pts[k];
      const cls = v === null ? 'empty' : u.tMin && v < u.tMin - 1e-9 ? 'bad' : 'ok';
      o.push(`<circle cx="${f(x)}" cy="${f(-y)}" r="${f(s * 0.6)}" class="rf-pt ${cls}" data-plate="${esc(p.key)}"/>`);
    }
  }
  o.push('</g></svg>');
  return o.join('');
}

/** Fixed roof plan: shell, UT station radials, roof support columns, and the UT points with their readings. */
export function fixedSVG(job, opts = {}) {
  const D = +job.tank?.diameter || 0;
  if (!(D > 0)) return empty('Enter the tank diameter in Tank setup');
  const Rt = D / 2, s = Rt / 100, M = Rt * 0.16, Fx = job.roof.fixed;
  const o = [frame(job, s, Rt, M, 'fixed')];
  o.push(`<circle cx="0" cy="0" r="${f(Rt)}" class="rf-roof" stroke-width="${f(s * 0.9)}"/>`);
  o.push(ticks(job, Rt, s));
  for (const st of opts.stations || []) {
    const [x, y] = polar(Rt, st.angle), [lx, ly] = polar(Rt * 0.8, st.angle + 4);
    o.push(`<line x1="0" y1="0" x2="${f(x)}" y2="${f(-y)}" class="rf-stl" stroke-width="${f(s * 0.3)}" stroke-dasharray="${f(s * 1.6)} ${f(s)}"/><text x="${f(lx)}" y="${f(-ly)}" font-size="${f(s * 3)}" text-anchor="middle" dominant-baseline="central" class="rf-stt">${esc(st.label)}</text>`);
  }
  o.push(`<path d="M${f(-s * 2)} 0H${f(s * 2)}M0 ${f(-s * 2)}V${f(s * 2)}" class="rf-ctr" stroke-width="${f(s * 0.3)}"/>`);
  for (const c of opts.columns || []) o.push(`<circle cx="${f(c.x)}" cy="${f(-c.y)}" r="${f(Math.max(s * 0.9, c.d / 2))}" class="rf-col"/>`);
  for (const pt of Fx.pts || []) {
    const r = num(pt.r), a = num(pt.angle); if (r === null || a === null) continue;
    const [x, y] = polar(r, a), st = pointStatus(job, pt);
    const cls = st.t === null ? 'empty' : st.status === 'Below t-min' ? 'bad' : 'ok';
    o.push(`<g class="rf-fp ${cls}${opts.sel === pt.id ? ' sel' : ''}" data-feature="${esc(pt.id)}"><circle cx="${f(x)}" cy="${f(-y)}" r="${f(s * 1.5)}" stroke-width="${f(s * 0.3)}"/>` +
      `<text x="${f(x + s * 2.3)}" y="${f(-y - s * 0.6)}" font-size="${f(s * 3.1)}" class="rf-fl">${esc(pt.label || '')}</text>` +
      (st.t !== null ? `<text x="${f(x + s * 2.3)}" y="${f(-y + s * 2.9)}" font-size="${f(s * 2.8)}" class="rf-fv">${opts.fmtT ? opts.fmtT(st.t) : st.t}</text>` : '') + '</g>');
  }
  o.push('</svg>');
  return o.join('');
}
