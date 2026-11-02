// Floating roof rim seal inspection: seal gap survey, visual checks and evaluation against
// US EPA 40 CFR 60 Subpart Kb / 63 Subpart WW and Canada SOR/2025-88 (plus a custom / provincial set).
// Gap lengths and widths are stored in mm, shoe heights in mm. Limits are in cm²/m and cm.

const uidS = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const SEAL_STDS = {
  kb: {
    key: 'kb', short: 'US EPA', name: 'US EPA 40 CFR 60 Subpart Kb / 40 CFR 63 Subpart WW',
    pArea: 212, pWidth: 3.81, sArea: 21.2, sWidth: 1.27, strict: false, probe: '0.32 cm (1/8 in)',
    shoeAbove: 61, shoeBelow: 0.01, shoeHeight: null, ifrGaps: false,
    repairEFR: 'Repair the seal or empty the tank and remove it from service within 45 days of the inspection (§60.113b(b)(4)); a 30-day extension may be requested (Subpart WW allows up to two).',
    repairIFR: 'Repair or empty and remove from service within 45 days (§60.113b(a)(2)); defects found with the tank emptied must be repaired before refilling.',
    freqEFR: [['Secondary seal gaps', 1], ['Primary seal gaps', 5], ['Full inspection when emptied and degassed (WW: at least every 10 years)', 10]],
    freqIFR: [['Visual inspection of roof and seals through roof hatches', 1], ['Internal inspection of roof, seals, gaskets and fittings (5 years with the double-seal option)', 10]],
    refs: '§60.113b; §63.1063'
  },
  ca: {
    key: 'ca', short: 'Canada', name: 'Canada SOR/2025-88 — Reduction in the Release of VOCs (Storage and Loading of Volatile Petroleum Liquids) Regulations',
    pArea: 200, pWidth: 4.0, sArea: 20, sWidth: 1.3, strict: true, probe: '0.3 cm',
    shoeAbove: 10, shoeBelow: 10, shoeHeight: 30, ifrGaps: true,
    repairEFR: 'Repair and confirm the repair, or remove the tank from service, within 60 days (s. 100(1)(a)); 90 days if the total seal gap area is under 1000 cm²/m and an API 653 inspector confirms within 30 days (s. 100(3)); remove from service within 45 days if the rim seal cannot be repaired in service (s. 100(4)).',
    repairIFR: 'Install a temporary vapour control system within 15 days and complete the repair within 180 days (s. 100(1)(b)).',
    freqEFR: [['Visual inspection of the roof surface', 1 / 12], ['Roof inspection and secondary seal gaps', 1], ['Roof, shell and primary seal gaps — API 653 inspector', 5]],
    freqIFR: [['LEL% above the internal floating roof', 1 / 12], ['Internal inspection incl. seal gaps — API 653 inspector', 20]],
    refs: 'ss. 64–65, 73–76, 91–101, Sch. 4'
  },
  custom: {
    key: 'custom', short: 'Custom', name: 'Custom / provincial approval (e.g. CCME PN 1180)',
    strict: false, probe: '', shoeAbove: null, shoeBelow: null, shoeHeight: null, ifrGaps: true,
    repairEFR: 'As set by the provincial approval / permit.', repairIFR: 'As set by the provincial approval / permit.', freqEFR: [], freqIFR: [], refs: ''
  }
};

export const PRIMARY_TYPES = ['Mechanical shoe', 'Liquid-mounted (foam / liquid filled)', 'Vapour-mounted', 'Other'];
export const SECONDARY_TYPES = ['Rim-mounted wiper', 'Shoe-mounted', 'None', 'Other'];

export const SEAL_CHECKS = [
  ['floating', 'Roof floating freely on the liquid (not on legs or supports) during gap measurement'],
  ['liquid', 'No stored liquid on the roof deck'],
  ['pHoles', 'Primary seal: no holes, tears or openings in the shoe, fabric or envelope'],
  ['pAttached', 'Primary seal attached and in contact with the shell (not detached)'],
  ['sHoles', 'Secondary seal: no holes, tears or openings'],
  ['sCover', 'Secondary seal covers the space between the roof rim and the shell'],
  ['fittings', 'Deck fittings, gaskets and wipers seal (no gap over 1/8 in / 0.32 cm)'],
  ['drains', 'Roof drains working; no snow, ice or debris affecting buoyancy (EFR)'],
  ['movement', 'No structural defect or obstruction that could impair roof movement'],
  ['rim', 'Roof rim extends into the liquid (Canada: at least 10 cm)']
];

export function defaultSeal() {
  return {
    std: { kb: true, ca: true, custom: false },
    custom: { pArea: null, pWidth: null, sArea: null, sWidth: null, shoeAbove: null, shoeBelow: null, label: '' },
    date: '', inspector: '', level: '', notes: '',
    primary: { type: 'Mechanical shoe', shoeAbove: null, shoeBelow: null, shoeHeight: null, notes: '', noGaps: false, gaps: [] },
    secondary: { type: 'Rim-mounted wiper', notes: '', noGaps: false, gaps: [] },
    checks: {}
  };
}

export function migrateSeal(s) {
  const d = defaultSeal();
  return { ...d, ...(s || {}), std: { ...d.std, ...(s?.std || {}) }, custom: { ...d.custom, ...(s?.custom || {}) },
    primary: { ...d.primary, ...(s?.primary || {}) }, secondary: { ...d.secondary, ...(s?.secondary || {}) }, checks: { ...(s?.checks || {}) } };
}

export const newGap = (angle = null) => ({ id: uidS(), angle, len: null, wMax: null, wAvg: null, notes: '' });

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);

/** Gap survey for one seal: total area (cm²), area per metre of diameter, widest gap (cm). Uses average width when given, else the maximum width. */
export function gapSummary(gaps, diameterMm) {
  let area = 0, wMax = 0, len = 0, n = 0;
  for (const g of gaps || []) {
    const L = num(g.len), W = num(g.wAvg) ?? num(g.wMax), M = num(g.wMax) ?? num(g.wAvg);
    if (L === null || W === null) continue;
    n++; area += (L / 10) * (W / 10); len += L; if (M !== null) wMax = Math.max(wMax, M / 10);
  }
  const Dm = (+diameterMm || 0) / 1000;
  return { n, areaCm2: area, perM: Dm > 0 ? area / Dm : null, wMaxCm: n ? wMax : 0, lenMm: len };
}

export const cm2mToIn2ft = (v) => v / 21.1678; // 1 in²/ft of diameter = 6.4516 cm² / 0.3048 m

export function stdLimits(seal, key) {
  const S = SEAL_STDS[key];
  if (key !== 'custom') return S;
  const c = seal.custom || {};
  return { ...S, pArea: num(c.pArea), pWidth: num(c.pWidth), sArea: num(c.sArea), sWidth: num(c.sWidth), shoeAbove: num(c.shoeAbove), shoeBelow: num(c.shoeBelow), name: c.label ? `Custom — ${c.label}` : S.name };
}

/** Evaluate the inspection against one standard. Returns rows of { item, value, limit, ok (true/false/null) } and an overall result. */
export function sealEval(job, key) {
  const seal = job.roof.seal, L = stdLimits(seal, key), D = +job.tank?.diameter || 0;
  const ifr = job.roof.type === 'fixed-ifr';
  const cmp = (v, lim) => (lim === null || lim === undefined || v === null ? null : L.strict ? v < lim : v <= lim + 1e-9);
  const p = gapSummary(seal.primary.gaps, D), s = gapSummary(seal.secondary.gaps, D);
  // an empty gap table only counts as "no gaps" when the inspector has ticked No gaps found
  if (!p.n) { p.perM = seal.primary.noGaps ? 0 : null; p.wMaxCm = seal.primary.noGaps ? 0 : null; }
  if (!s.n) { s.perM = seal.secondary.noGaps ? 0 : null; s.wMaxCm = seal.secondary.noGaps ? 0 : null; }
  const rows = [];
  const gapsApply = !ifr || L.ifrGaps;
  const opT = L.strict ? '<' : '≤';
  if (gapsApply) {
    rows.push({ item: 'Primary seal — gap area', value: p.perM, unit: 'cm2m', limit: L.pArea, op: opT, ok: cmp(p.perM, L.pArea) });
    rows.push({ item: 'Primary seal — widest gap', value: p.wMaxCm, unit: 'cm', limit: L.pWidth, op: opT, ok: cmp(p.wMaxCm, L.pWidth) });
    if (seal.secondary.type !== 'None') {
      rows.push({ item: 'Secondary seal — gap area', value: s.perM, unit: 'cm2m', limit: L.sArea, op: opT, ok: cmp(s.perM, L.sArea) });
      rows.push({ item: 'Secondary seal — widest gap', value: s.wMaxCm, unit: 'cm', limit: L.sWidth, op: opT, ok: cmp(s.wMaxCm, L.sWidth) });
    }
  } else rows.push({ item: 'Seal gap limits', value: null, text: 'Not set for internal floating roofs under this standard — visual inspection only', ok: null });
  if (!ifr && seal.secondary.type === 'None' && key !== 'custom') rows.push({ item: 'Secondary seal fitted', text: 'No secondary seal — required on external floating roofs', ok: false });
  if (/shoe/i.test(seal.primary.type) && !(ifr && key === 'kb')) { // Kb's 61 cm shoe rule is for external floating roofs (§60.113b(b)(4)(i)(A))
    const ab = num(seal.primary.shoeAbove), be = num(seal.primary.shoeBelow), ht = num(seal.primary.shoeHeight);
    if (L.shoeAbove !== null && L.shoeAbove !== undefined) rows.push({ item: 'Shoe — top above liquid', value: ab === null ? null : ab / 10, unit: 'cm', limit: L.shoeAbove, op: '≥', ok: ab === null ? null : ab / 10 >= L.shoeAbove - 1e-9 });
    if (L.shoeBelow) rows.push({ item: key === 'kb' ? 'Shoe — extends into the liquid' : 'Shoe — bottom below liquid', value: be === null ? null : be / 10, unit: 'cm', limit: key === 'kb' ? null : L.shoeBelow, op: key === 'kb' ? '>' : '≥', text: key === 'kb' ? (be === null ? '' : be > 0 ? 'Yes' : 'No') : undefined, ok: be === null ? null : key === 'kb' ? be > 0 : be / 10 >= L.shoeBelow - 1e-9 });
    if (L.shoeHeight) rows.push({ item: 'Shoe — height', value: ht === null ? null : ht / 10, unit: 'cm', limit: L.shoeHeight, op: '≥', ok: ht === null ? null : ht / 10 >= L.shoeHeight - 1e-9 });
  }
  const defects = SEAL_CHECKS.filter(([k]) => seal.checks?.[k]?.r === 'defect');
  rows.push({ item: 'Visual inspection', text: defects.length ? `${defects.length} defect${defects.length > 1 ? 's' : ''}` : Object.keys(seal.checks || {}).length ? 'No defects recorded' : 'Not recorded', ok: defects.length ? false : Object.keys(seal.checks || {}).length ? true : null });
  const fails = rows.filter((r) => r.ok === false).length, unknown = rows.filter((r) => r.ok === null && r.item !== 'Seal gap limits').length;
  const overall = fails ? 'Not compliant' : unknown ? 'Incomplete' : 'Compliant';
  const warn = [];
  if (seal.checks?.floating?.r === 'defect') warn.push('Gap measurements must be taken with the roof floating freely — re-measure.');
  if (gapsApply && !p.n && !seal.primary.noGaps) warn.push('No primary seal gaps entered — add the gaps, or tick “No gaps found”.');
  if (gapsApply && seal.secondary.type !== 'None' && !s.n && !seal.secondary.noGaps) warn.push('No secondary seal gaps entered — add the gaps, or tick “No gaps found”.');
  return { key, L, rows, fails, overall, p, s, ifr, gapsApply, repair: ifr ? L.repairIFR : L.repairEFR, freq: ifr ? L.freqIFR : L.freqEFR, warn };
}

export const activeStds = (seal) => Object.keys(SEAL_STDS).filter((k) => seal?.std?.[k]);

/** Next due dates from the inspection date for the selected standards. */
export function nextDue(job, key) {
  const seal = job.roof.seal, ev = sealEval(job, key);
  const d = seal.date ? new Date(seal.date + 'T00:00:00') : null;
  return ev.freq.map(([what, yrs]) => {
    let due = null;
    if (d && !isNaN(d)) { due = new Date(d); if (yrs < 1) due.setMonth(due.getMonth() + Math.round(yrs * 12)); else due.setFullYear(due.getFullYear() + yrs); }
    return { what, every: yrs < 1 ? 'monthly' : yrs === 1 ? 'annually' : `every ${yrs} years`, due };
  });
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (v) => (Math.round(v * 10) / 10).toString();

/** Seal gap arcs to overlay on the floating roof plan (primary inside, secondary outside, in the rim space). */
export function sealGapOverlay(job, lay, s) {
  const seal = job.roof.seal; if (!seal) return '';
  const Rt = (+job.tank.diameter || 0) / 2, Rr = lay.R; if (!(Rt > 0)) return '';
  const C = Math.PI * 2 * Rt, gapSpace = Math.max(Rt - Rr, s * 2);
  const arc = (r, a0, a1) => { const p = (a) => [r * Math.sin(a * Math.PI / 180), -r * Math.cos(a * Math.PI / 180)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f(x1)} ${f(y1)}`; };
  const o = ['<g class="sl-gaps">'];
  const draw = (gaps, r, cls) => {
    for (const g of gaps || []) {
      const a = num(g.angle), L = num(g.len); if (a === null || L === null) continue;
      const span = Math.max((L / C) * 360, 0.6);
      o.push(`<path d="${arc(r, a, a + span)}" class="${cls}" stroke-width="${f(s * 1.6)}"/>`);
    }
  };
  draw(seal.primary.gaps, Rr + gapSpace * 0.3, 'sl-p');
  if (seal.secondary.type !== 'None') draw(seal.secondary.gaps, Rr + gapSpace * 0.7 + s * 1.2, 'sl-s');
  o.push('</g>');
  return o.join('');
}
