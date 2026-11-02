// Tank sections (Floor, Shell, Fixed roof, Floating roof, Nozzles, Foundation, Settlement), each with
// NDE scope, observations, photos, analysis and recommendations; automatic findings used by the analysis
// pages, the executive summary and the deficiency report.
import { fmt } from './units.js';
import { nozzleUT, nozzleWall } from './calc.js';
import { courseSummary, coursesWithElev } from './shell.js';
import { hasFixed, hasFloating, floatingLayout, plateUT, pointStatus } from './roof.js';
import { sealEval, activeStds } from './seal.js';
import { settleCalc, profileEval, edgeEval, depEval, stations, hasSettle } from './settle.js';
import { designBasis, fillFromT } from './design.js';

const uidS = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const SECTIONS = [
  { key: 'floor', label: 'Floor', icon: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3v18', nde: [['map', 'Floor map'], ['inds', 'Indications'], ['plates', 'Plates']], an: 'api' },
  { key: 'shell', label: 'Shell', icon: 'M4 5h16v14H4zM4 10h16M4 15h16M9 5v14M15 5v14', nde: [['shell', 'Shell UT']], an: 'an:shell' },
  { key: 'froof', label: 'Fixed roof', icon: 'M3 11l9-7 9 7M5 10v9h14v-9', nde: [['roofF', 'Fixed roof UT']], an: 'an:froof' },
  { key: 'flroof', label: 'Floating roof', icon: 'M3 14h18M5 14v4h14v-4M8 10h8', nde: [['roofL', 'Deck & pontoons'], ['seal', 'Rim seal']], an: 'an:flroof' },
  { key: 'nozzles', label: 'Nozzles', icon: 'M4 12h9M13 8v8M17 9a3 3 0 1 1 0 6', nde: [['nozzles', 'Nozzle UT']], an: 'an:nozzles' },
  { key: 'found', label: 'Foundation', icon: 'M3 18h18M5 18v-4h14v4M8 14v-3h8v3', nde: [], an: 'an:found' },
  { key: 'settle', label: 'Settlement', icon: 'M3 7h18M3 7l3 11h12l3-11M8 12l8 3', nde: [['settle', 'Settlement survey']], an: 'an:settle' }
];
export const SEC = new Map(SECTIONS.map((s) => [s.key, s]));
export const CHILDREN = [['nde', 'NDE'], ['obs', 'Observations'], ['photos', 'Photos'], ['an', 'Analysis'], ['recs', 'Recommendations']];

/** Which section / child a view belongs to. */
export function viewPlace(view) {
  if (!view) return null;
  const m = /^(nde|obs|photos|an|recs):(\w+)$/.exec(view);
  if (m) return { sec: m[2], child: m[1] };
  for (const s of SECTIONS) {
    if (s.nde.some(([v]) => v === view)) return { sec: s.key, child: 'nde' };
    if (s.an === view) return { sec: s.key, child: 'an' };
  }
  return null;
}
export const childView = (sec, child) => (child === 'an' ? SEC.get(sec).an : `${child}:${sec}`);

/* ---------------------------------------------------------------------- data --- */

export function defaultSecs() { return Object.fromEntries(SECTIONS.map((s) => [s.key, { nde: [], obs: [], recs: [] }])); }
export function migrateSecs(secs) {
  const out = defaultSecs();
  for (const k of Object.keys(out)) { const s = secs?.[k] || {}; out[k] = { nde: s.nde || [], obs: s.obs || [], recs: s.recs || [] }; }
  return out;
}
export function defaultSummary() { return { scope: '', condition: '', narrative: '', nextExt: '', nextInt: '', nextUT: '', rts: '', issued: '', defRev: 0 }; }

export const NDE_METHODS = ['Visual (VT)', 'UT thickness', 'UT scanning (B / C-scan)', 'MFL floor scan', 'MT', 'PT', 'Vacuum box', 'Tracer gas / helium', 'RT', 'Hardness', 'Level / settlement survey', 'Seal gap survey', 'Holiday / coating test', 'Other'];
export const NDE_RESULTS = ['', 'Satisfactory', 'Indications found', 'Repairs required', 'Not performed', 'In progress'];
export const CONDITIONS = [['', '—'], ['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor'], ['na', 'Not inspected']];
export const PRIORITIES = [['P1', 'P1 — Immediate'], ['P2', 'P2 — Before return to service'], ['P3', 'P3 — Within 12 months'], ['P4', 'P4 — Next scheduled inspection'], ['P5', 'P5 — Monitor / maintenance']];
export const PRIORITY_LABEL = Object.fromEntries(PRIORITIES);
export const STATUSES = ['Open', 'In progress', 'Closed', 'Deferred'];

const TYPICAL_NDE = {
  floor: [['MFL floor scan', 'All accessible floor plates'], ['UT thickness', 'Prove-up of MFL indications'], ['Visual (VT)', 'Floor plates, welds and sumps'], ['Vacuum box', 'Repaired / suspect welds']],
  shell: [['UT thickness', 'Standard stations, every course'], ['Visual (VT)', 'Shell plates, welds, appurtenances']],
  froof: [['UT thickness', 'Roof plates at the marked points'], ['Visual (VT)', 'Roof plates, structure, fittings']],
  flroof: [['UT thickness', 'Deck plates (5 per plate)'], ['Visual (VT)', 'Deck, pontoons, legs, drains'], ['Seal gap survey', 'Primary and secondary seals']],
  nozzles: [['UT thickness', 'Nozzle necks (4 quadrants)'], ['Visual (VT)', 'Nozzles, reinforcing pads, flanges']],
  found: [['Visual (VT)', 'Foundation, ringwall, chime and drainage']],
  settle: [['Level / settlement survey', 'Shell stations, edge and bottom profile']]
};
export function typicalNDE(sec) { return (TYPICAL_NDE[sec] || []).map(([method, extent]) => ({ id: uidS(), method, extent, proc: '', tech: '', date: '', result: '', notes: '' })); }

const TYPICAL_OBS = {
  floor: ['Floor plate general condition', 'Product-side corrosion / pitting', 'Bottom welds and lap seams', 'Sump and drain', 'Coating / lining', 'Bulges, depressions or wrinkles', 'Roof support pads / column bases'],
  shell: ['Shell plates — external corrosion', 'Shell welds', 'Shell distortion / out-of-roundness', 'Coating / insulation', 'Wind girders and stiffeners', 'Stairway, platforms and handrails', 'Grounding and nameplate'],
  froof: ['Roof plates — corrosion / holes', 'Roof structure (rafters, columns, girders)', 'Roof-to-shell joint', 'Roof vents, hatches and fittings', 'Coating', 'Standing water / ponding'],
  flroof: ['Deck plates — corrosion / holes', 'Pontoons — leaks / liquid', 'Roof legs and supports', 'Roof drains and siphons', 'Rim seal and secondary seal', 'Anti-rotation device and gauge well', 'Rolling ladder'],
  nozzles: ['Nozzle necks and flanges', 'Reinforcing pads and tell-tale holes', 'Valves and piping supports', 'Gaskets and bolting'],
  found: ['Ringwall / foundation cracking or spalling', 'Chime area and bottom projection', 'Drainage away from the tank', 'Vegetation and debris', 'Grout / sealant at the chime', 'Anchor bolts / chairs', 'Containment / dyke'],
  settle: ['Visible shell distortion from settlement', 'Edge settlement at the chime', 'Bottom depressions or bulges', 'Piping strain at nozzles']
};
export function typicalObs(sec) { return (TYPICAL_OBS[sec] || []).map((item) => ({ id: uidS(), item, loc: '', cond: '', text: '' })); }
export const newObs = () => ({ id: uidS(), item: '', loc: '', cond: '', text: '' });
export const newNDE = () => ({ id: uidS(), method: 'Visual (VT)', extent: '', proc: '', tech: '', date: '', result: '', notes: '' });
export const newRec = (o = {}) => ({ id: uidS(), finding: '', loc: '', action: '', priority: 'P3', due: '', def: true, status: 'Open', client: '', ref: '', photo: '', history: [], created: Date.now(), ...o });

/** Give deficiency numbers (D-001…) to recommendations flagged as deficiencies. */
export function numberDefs(job) {
  job.defSeq = job.defSeq || 0;
  for (const s of SECTIONS) for (const r of job.secs?.[s.key]?.recs || []) if (r.def && !r.no) r.no = `D-${String(++job.defSeq).padStart(3, '0')}`;
}
export function allDefs(job) {
  const out = [];
  for (const s of SECTIONS) for (const r of job.secs?.[s.key]?.recs || []) if (r.def) out.push({ ...r, sec: s.key, secLabel: s.label });
  return out.sort((a, b) => String(a.no || '').localeCompare(String(b.no || ''), undefined, { numeric: true }));
}

/* ------------------------------------------------------------------ findings --- */

/**
 * Automatic findings from the data in each section.
 * Returns { [sec]: { status: 'ok'|'attn'|'bad'|'none', lines: [text], items: [{ key, finding, loc, action, priority, ref }] } }
 */
export function findings(job, layout, calc) {
  const F = Object.fromEntries(SECTIONS.map((s) => [s.key, { status: 'none', lines: [], items: [] }]));
  const t = (mm) => fmt(mm, 't', job), big = (mm) => fmt(mm, 'big', job);
  const add = (sec, it) => F[sec].items.push(it);

  // floor
  try {
    const inds = job.indications || [];
    if (inds.length || calc?.regions?.some((r) => r.RT != null)) {
      const f = F.floor; f.status = 'ok';
      const proven = inds.filter((i) => ['ps', 'ss', 'both'].includes(i.result)).length, pend = inds.filter((i) => (i.result || 'pending') === 'pending').length;
      f.lines.push(`${inds.length} MFL indications recorded, ${proven} proven corrosion${pend ? `, ${pend} awaiting prove-up` : ''}.`);
      for (const r of calc?.regions || []) {
        if (r.MRT == null) continue;
        f.lines.push(`${r.label}: MRT ${t(r.MRT)} at O<sub>r</sub> = ${calc.Or} yr (minimum ${t(r.limit)}) — ${r.ok ? 'acceptable' : 'not acceptable'}.`);
        if (r.ok === false) add('floor', { key: 'floor-mrt-' + r.name, finding: `${r.label}: minimum remaining thickness ${t(r.MRT)} at the next internal inspection (${calc.Or} yr) is below the ${t(r.limit)} minimum (API 653 4.4.7).`, loc: r.label, action: 'Repair the thinned areas or shorten the internal inspection interval so the bottom meets the MRT limit.', priority: 'P2', ref: 'API 653 4.4.7' });
      }
      const reps = inds.filter((i) => calc?.per?.get(i.id)?.repair);
      if (reps.length) add('floor', { key: 'floor-repairs', finding: `${reps.length} floor location${reps.length > 1 ? 's' : ''} require repair: ${reps.map((i) => i.no + ' (' + (calc.per.get(i.id)?.plate?.label || '') + ')').join(', ')}.`, loc: 'See floor map', action: 'Repair by patch plate, weld build-up or plate replacement per API 653 Section 9 and re-test (vacuum box) before return to service.', priority: 'P2', ref: 'API 653 9.10' });
      if (pend) { add('floor', { key: 'floor-pending', finding: `${pend} MFL indication${pend > 1 ? 's have' : ' has'} not been proven up.`, loc: 'See indications list', action: 'Prove up the remaining MFL indications by UT / VT and update the evaluation.', priority: 'P2', ref: '' }); }
    }
  } catch { /* */ }

  // shell
  try {
    const cs = courseSummary(job), courses = coursesWithElev(job);
    if (cs.some((c) => c.count)) {
      const f = F.shell; f.status = 'ok';
      f.lines.push(`${cs.length} courses, ${cs.reduce((a, c) => a + c.count, 0)} UT readings.`);
      const B = designBasis(job); let pm = null;
      for (const c of cs) {
        if (c.min == null) continue;
        f.lines.push(`Course ${c.no}: minimum ${t(c.min)}${c.tMin ? ` vs t-min ${t(c.tMin)}` : ''} — ${c.status || 'no t-min'}.`);
        if (c.status === 'Below t-min') add('shell', { key: 'shell-c' + c.no, finding: `Shell course ${c.no}: minimum reading ${t(c.min)} is below the minimum required thickness ${t(c.tMin)}.`, loc: `Course ${c.no}`, action: 'Evaluate the thin area per API 653 4.3.2 (locally thinned areas / pitting); otherwise repair (insert or door sheet) or re-rate the maximum fill height.', priority: 'P2', ref: 'API 653 4.3.2 / 4.3.3' });
        const d = courses.find((x) => x.id === c.id)?.d; const fl = d ? fillFromT(job, d, c.min) : null;
        if (fl?.prod != null && (pm === null || fl.prod < pm.v)) pm = { v: fl.prod, c: c.no };
      }
      if (pm && B.fill && pm.v < B.fill - 1) add('shell', { key: 'shell-fill', finding: `The minimum shell readings support a maximum product fill height of ${big(pm.v)} (course ${pm.c}), below the ${big(B.fill)} maximum fill height.`, loc: `Course ${pm.c}`, action: `Reduce the maximum fill height to ${big(pm.v)} or repair course ${pm.c}.`, priority: 'P2', ref: 'API 653 4.3.3.1' });
    }
  } catch { /* */ }

  // fixed roof
  try {
    if (hasFixed(job)) {
      const pts = job.roof.fixed.pts || [], st = pts.map((p) => ({ p, s: pointStatus(job, p) })).filter((x) => x.s.t != null);
      if (st.length) {
        const f = F.froof; f.status = 'ok'; const mn = Math.min(...st.map((x) => x.s.t));
        f.lines.push(`${st.length} roof UT readings, minimum ${t(mn)}.`);
        const bad = st.filter((x) => x.s.status === 'Below t-min');
        f.lines.push(bad.length ? `${bad.length} reading${bad.length > 1 ? 's' : ''} below t-min.` : 'All readings at or above t-min.');
        if (bad.length) add('froof', { key: 'froof-tmin', finding: `${bad.length} fixed roof reading${bad.length > 1 ? 's are' : ' is'} below t-min (${bad.map((x) => (x.p.label || '') + ' ' + t(x.s.t)).join(', ')}).`, loc: 'See roof plan', action: 'Repair or replace the thin roof plates (API 653 4.2.1.2: average thickness below 0.09 in over any 100 in² requires repair or replacement).', priority: 'P3', ref: 'API 653 4.2.1.2' });
      }
    }
  } catch { /* */ }

  // floating roof
  try {
    if (hasFloating(job)) {
      const lay = floatingLayout(job), F2 = job.roof.floating;
      const deck = lay.plates.filter((p) => p.kind !== 'annular').map((p) => ({ p, s: plateUT(job, p) })).filter((x) => x.s.min != null);
      const pons = lay.plates.filter((p) => p.kind === 'annular').filter((p) => ['Liquid present', 'Leaking'].includes(F2.pont?.[p.key]?.cond));
      const f = F.flroof;
      if (deck.length || pons.length) { f.status = 'ok'; f.lines.push(`${deck.length} deck plates read, minimum ${deck.length ? t(Math.min(...deck.map((x) => x.s.min))) : '—'}.`); }
      const bad = deck.filter((x) => x.s.status === 'Below t-min');
      if (bad.length) add('flroof', { key: 'flroof-deck', finding: `${bad.length} floating roof deck plate${bad.length > 1 ? 's are' : ' is'} below t-min: ${bad.map((x) => x.p.label).join(', ')}.`, loc: 'See floating roof plan', action: 'Repair or replace the thin deck plates.', priority: 'P2', ref: 'API 653 4.2.2' });
      if (pons.length) add('flroof', { key: 'flroof-pont', finding: `${pons.length > 1 ? 'Pontoons' : 'Pontoon'} ${pons.map((p) => p.label).join(', ')} ${pons.length > 1 ? 'contain liquid or are leaking' : 'contains liquid or is leaking'}.`, loc: 'Pontoons', action: 'Drain, locate and repair the leaks; re-test the pontoons.', priority: 'P2', ref: 'API 653 4.2.2' });
      if (job.roof.seal) for (const k of activeStds(job.roof.seal)) {
        const ev = sealEval(job, k);
        if (ev.overall === 'Compliant' || ev.overall === 'Not compliant') { if (f.status === 'none') f.status = 'ok'; f.lines.push(`Rim seal — ${ev.L.short || ev.L.name}: ${ev.overall.toLowerCase()}.`); }
        if (ev.overall === 'Not compliant') add('flroof', { key: 'flroof-seal-' + k, finding: `Rim seal does not meet ${ev.L.name}: ${ev.rows.filter((r) => r.ok === false).map((r) => r.item).join('; ')}.`, loc: 'Rim seal', action: ev.repair || 'Repair the rim seal.', priority: 'P1', ref: ev.L.refs || '' });
      }
    }
  } catch { /* */ }

  // nozzles
  try {
    const nz = (job.nozzles || []).map((n) => ({ n, r: nozzleUT(n, job) })).filter((x) => x.r.count);
    if (nz.length) {
      const f = F.nozzles; f.status = 'ok'; f.lines.push(`${nz.length} of ${(job.nozzles || []).length} nozzles UT tested.`);
      const bad = nz.filter((x) => x.r.status === 'Below t-min');
      f.lines.push(bad.length ? `Below t-min: ${bad.map((x) => x.n.mark + ' (' + t(x.r.min) + ')').join(', ')}.` : 'All tested necks at or above t-min.');
      for (const x of bad) add('nozzles', { key: 'noz-' + x.n.id, finding: `Nozzle ${x.n.mark} neck minimum ${t(x.r.min)} is below the minimum ${t(nozzleWall(x.n, job).tMin)}.`, loc: `Nozzle ${x.n.mark}${x.n.angle != null ? ' at ' + x.n.angle + '°' : ''}`, action: 'Replace the nozzle neck or evaluate it for the design conditions.', priority: 'P2', ref: 'API 653 4.3.10' });
    }
  } catch { /* */ }

  // settlement
  try {
    if (hasSettle(job)) {
      const f = F.settle, c = settleCalc(job); f.status = 'ok';
      if (c.fit) f.lines.push(`Shell settlement: ${c.status.toLowerCase()} (R² ${c.fit.R2.toFixed(2)}, tilt ${fmt(c.fit.tilt, 'small', job)} towards ${c.fit.loDeg.toFixed(0)}°).`);
      if (c.tiltOk === false) add('settle', { key: 'set-tilt', finding: `Planar tilt gives an out-of-plumbness of ${fmt(c.fit.plumb, 'small', job)} at the top of the shell, over the ${fmt(c.fit.plumbLim, 'small', job)} limit.`, loc: `Low side ${c.fit.loDeg.toFixed(0)}°`, action: 'Engineering evaluation of the tilt; re-level the tank (jacking) if required.', priority: 'P2', ref: 'API 653 10.5.2.1 / Annex B' });
      if (c.oopOk === false) add('settle', { key: 'set-oop', finding: `Out-of-plane (differential) shell settlement exceeds the API 653 Annex B allowable${c.fit?.maxAt ? ` (station ${c.fit.maxAt})` : ''}.`, loc: c.fit?.maxAt ? `Station ${c.fit.maxAt}` : 'Shell', action: 'Engineering evaluation per API 653 B.3.2; re-level or repair the foundation as required.', priority: 'P2', ref: 'API 653 B.3.2' });
      if (c.fit && !c.valid && c.arcs?.ok === null) add('settle', { key: 'set-fit', finding: `Cosine fit R² = ${c.fit.R2.toFixed(2)} is below 0.90; the out-of-plane settlement could not be evaluated by B.3.2.1.`, loc: 'Shell', action: 'Rigorous settlement evaluation by an engineer (B.3.2.2 or finite element).', priority: 'P2', ref: 'API 653 B.2.2.4' });
      const edges = stations(job).map((x) => ({ x, p: profileEval(job, x.i) })).filter((e) => e.p.ev);
      const measured = stations(job).map((x) => profileEval(job, x.i)).filter((p) => p.n);
      if (measured.length) { const w = edges.filter((e) => e.p.ev.pct != null).sort((a, b) => b.p.ev.pct - a.p.ev.pct)[0]; f.lines.push(`Edge settlement: ${measured.length} stations measured${w ? `, worst ${w.p.ev.pct.toFixed(0)} % of allowable at station ${w.x.i} (${w.p.status.toLowerCase()})` : ', no edge settlement'}.`); }
      for (const e of edges.filter((e) => e.p.status === 'Exceeds')) add('settle', { key: 'set-edge-' + e.x.i, finding: `Edge settlement at station ${e.x.i} (${e.x.angle.toFixed(0)}°): B = ${fmt(e.p.B, 'small', job)} over R = ${fmt(e.p.R, 'big', job)} exceeds the allowable ${fmt(e.p.ev.allow, 'small', job)}.`, loc: `Station ${e.x.i}`, action: 'Repair the edge settlement (re-level, replace bottom plates) or rigorous engineering evaluation.', priority: 'P2', ref: 'API 653 B.3.4' });
      const nde = edges.filter((e) => e.p.status === 'NDE required');
      if (nde.length) add('settle', { key: 'set-edge-nde', finding: `Edge settlement over 75 % of the allowable at station${nde.length > 1 ? 's' : ''} ${nde.map((e) => e.x.i).join(', ')}.`, loc: nde.map((e) => `Stn ${e.x.i}`).join(', '), action: 'Examine the shell-to-bottom and bottom welds in the settled areas visually and by MT or PT; VT of welds within 12 in of the breakover.', priority: 'P2', ref: 'API 653 B.3.4.1' });
      (job.settle.edge || []).forEach((e, i) => { const ev = edgeEval(e, job); if (ev.status === 'Exceeds') add('settle', { key: 'set-area-' + e.id, finding: `Edge settlement area E${i + 1} exceeds the allowable (${fmt(ev.B, 'small', job)} vs ${fmt(ev.allow, 'small', job)}).`, loc: `E${i + 1}${e.angle != null ? ' at ' + e.angle + '°' : ''}`, action: 'Repair or engineering evaluation.', priority: 'P2', ref: 'API 653 B.3.4' }); });
      (job.settle.dep || []).forEach((d, i) => { const ev = depEval(d); if (ev.status === 'Exceeds') add('settle', { key: 'set-dep-' + d.id, finding: `Bottom depression D${i + 1} (${fmt(ev.B, 'small', job)}) exceeds 0.37R (${fmt(ev.allow, 'small', job)}).`, loc: `D${i + 1}`, action: 'Repair the depression (re-level and re-support the bottom) or engineering evaluation.', priority: 'P2', ref: 'API 653 B.3.3' }); });
    }
  } catch { /* */ }

  // observations rated poor count as attention items for every section
  for (const s of SECTIONS) {
    const obs = job.secs?.[s.key]?.obs || [];
    if (obs.some((o) => o.cond)) { if (F[s.key].status === 'none') F[s.key].status = 'ok'; }
    const poor = obs.filter((o) => o.cond === 'poor');
    if (poor.length) F[s.key].lines.push(`${poor.length} observation${poor.length > 1 ? 's' : ''} rated poor: ${poor.map((o) => o.item).join(', ')}.`);
    for (const o of poor) add(s.key, { key: 'obs-' + o.id, finding: `${o.item}${o.loc ? ' (' + o.loc + ')' : ''}: ${o.text || 'rated poor'}`, loc: o.loc || '', action: '', priority: 'P3', ref: '' });
  }
  for (const s of SECTIONS) {
    const f = F[s.key];
    if (f.items.some((i) => ['P1', 'P2'].includes(i.priority))) f.status = 'bad';
    else if (f.items.length) f.status = 'attn';
  }
  return F;
}

export const STATUS_TEXT = { ok: 'Satisfactory', attn: 'Attention', bad: 'Deficient', none: 'Not evaluated' };
