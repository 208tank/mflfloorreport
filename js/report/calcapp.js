// Calculation appendices (report improvements R5). Each calculation the app performs is set out in the same five
// parts — inputs, assumptions, references, working, result — using only values the calculation returned (its result
// and its trace). Nothing is recalculated here except the arithmetic shown as working, which repeats the calculation's
// own steps on its own numbers and is checked against its result by tests/calcapp.test.mjs. References are clause,
// table and figure numbers only. No browser APIs.
import { czLimitParts, nozzleUT, nozzleWall, RESULT_SHORT, UT_CLOCK } from '../calc.js';
import { annularReq, designBasis } from '../design.js';
import { floatingLayout, hasFixed, hasFloating, plateUT, pointStatus, roofBad } from '../roof.js';
import { activeStds, sealEval } from '../seal.js';
import { fmt, fmtRate } from '../units.js';
import { escText as h } from '../util.js';
import { remMark, vm } from './front.js';

const blank = (v) => v === null || v === undefined || v === '';
const TYPE = { M: `Measured${vm('M')}`, E: `Estimated${vm('E')}`, C: `Calculated${vm('C')}`, S: 'Specified', D: 'App default', T: 'Code table' };

/** The five parts. inputs: [[quantity, value, type key, source]]; results: [[item, value, limit, result, key]]. */
export function block(N, { name = '', inputs = [], assumptions = [], refs = [], working = '', results = [], assess = null, resultNote = '' }) {
  const assessHTML = assess === undefined ? '' : assess && assess.text
    ? `<div class="calc-assess"><b>Engineering assessment${vm('A')}:</b> ${h(assess.text)}${assess.by || assess.date ? ` <small>(${h([assess.by, assess.date].filter(Boolean).join(', '))})</small>` : ''}</div>`
    : '<div class="calc-assess none">Engineering assessment: none entered.</div>';
  return `<div class="calc">
    <h3 class="rp-h3">1 Inputs</h3>
    ${N.table(name ? name + ' — inputs' : 'Inputs')}<table class="grid small wrap calc-in"><thead><tr><th>Quantity</th><th>Value</th><th>Type</th><th>Source</th></tr></thead><tbody>
      ${inputs.map(([q, v, t, s]) => `<tr><td>${q}</td><td>${v}</td><td>${TYPE[t] || h(t || '')}</td><td>${s || ''}</td></tr>`).join('')}
    </tbody></table>
    <h3 class="rp-h3">2 Assumptions</h3>${assumptions.length ? `<ul class="calc-list">${assumptions.map((a) => `<li>${a}</li>`).join('')}</ul>` : '<p class="note">None beyond the inputs listed.</p>'}
    <h3 class="rp-h3">3 References</h3><p class="calc-refs">${refs.map(h).join('; ')}.</p>
    <h3 class="rp-h3">4 Working</h3>${typeof working === 'function' ? working() : working}
    <div class="calc-res"><h3 class="rp-h3">5 Result</h3>
    ${results.length ? `${N.table(name ? name + ' — calculated result' : 'Calculated result')}<table class="grid small wrap calc-out"><thead><tr><th>Item</th><th>Calculated${vm('C')}</th><th>Limit</th><th>Result${vm('C')}</th></tr></thead><tbody>
      ${results.map(([i, v, l, r, k]) => `<tr${k ? ` data-k="${h(k)}"` : ''}><td>${i}</td><td data-c="v">${v}</td><td>${l}</td><td>${r}</td></tr>`).join('')}
    </tbody></table>` : ''}${resultNote ? `<p class="note">${resultNote}</p>` : ''}
    ${assessHTML}</div>
  </div>`;
}
/** A worked line: formula, the numbers in it, and the answer. */
export const step = (label, formula, subst, ans, key = '') => `<div class="calc-step"${key ? ` data-k="${h(key)}"` : ''}><span class="cs-l">${label}</span><span class="cs-f">${formula}</span>${subst ? `<span class="cs-s">= ${subst}</span>` : ''}<span class="cs-a" data-c="v">= ${ans}</span></div>`;
const yesNo = (b) => (b ? 'yes' : 'no');

/* ===================================================================================== A — floor MRT === */
export function calcFloor({ job, layout, calc, N }) {
  const C = calc.C || {}, T = (v) => fmt(v, 't', job), tn = (v) => fmt(v, 't', job, false), tr = calc.trace || { rounds: [], pruned: [], regions: {} };
  const per = calc.per, inds = job.indications || [], byId = new Map(inds.map((i) => [i.id, i]));
  const used = inds.filter((i) => per.get(i.id)?.counts && per.get(i.id)?.rem != null);
  const yrs = (v) => (v ? `${v} yr` : '—');
  const anyAnn = layout.Ri < layout.R;
  const inputs = [
    ['Oᵣ — years to the next internal inspection', `${calc.Or} yr`, 'S', C.rbi ? 'API 653 page; set by an RBI assessment' : 'API 653 page'],
    ['Tank age (UPᵣ basis)', yrs(calc.years), 'S', 'API 653 page'],
    ['StPᵣ basis', yrs(calc.stYears), blank(C.stprYears) ? 'S' : 'S', blank(C.stprYears) ? 'tank age (no separate basis entered)' : 'API 653 page'],
    ['MFL threshold', blank(C.mflThresholdPct) ? '—' : `${h(C.mflThresholdPct)} % of nominal`, 'S', 'API 653 page (app default 20 %)'],
    ['Bottom nominal thickness', T(job.tank?.tBottom), 'S', 'Tank setup'],
    ...(anyAnn ? [['Annular nominal thickness', T(job.tank?.tAnnular ?? job.tank?.tBottom), 'S', 'Tank setup']] : []),
    ['Bottom plate minimum', T(calc.mBot), 'S', 'API 653 page (Table 4.4 preset)'],
    ...(anyAnn ? [['Annular plate minimum', T(calc.mAnn), calc.ann?.src === 'entered' ? 'S' : 'C', `${h(calc.ann?.src || '')} — see the annular plate calculation`]] : []),
    ['Critical zone width / limit', `${fmt(C.czDist, 'small', job)} / ${T(calc.czLim)}`, blank(C.czLimit) ? 'C' : 'S', blank(C.czLimit) ? 'see the critical zone calculation' : `entered: ${h(C.czLimitReason || 'no reason recorded')}`],
    ['Locations used', `${used.length} of ${inds.length} indications`, 'C', 'proven-up indications with a remaining thickness (UT / VT; MFL estimate where no UT / VT)'],
  ];
  const assumptions = [
    'Corrosion rates are linear: the wall loss at each location divided by the rate basis in years (§4.4.5.1).',
    C.coated ? (C.coatConfirmed ? 'Product side coated: StPᵣ = 0 on the engineer\'s confirmation of the coating basis.' : 'Product side marked coated: StPᵣ = 0 unless product-side loss is recorded, in which case it is kept from that loss.') : 'Product side not coated: StPᵣ from the recorded product-side loss.',
    C.cp ? 'Effective cathodic protection: UPᵣ = 0.' : 'No effective cathodic protection credit: UPᵣ from the recorded soil-side loss, not less than the MFL threshold rate where the floor was scanned.',
    C.includeUnverified ? 'Indications pending prove-up are included on their MFL estimate, as soil side.' : 'Indications pending prove-up are not included.',
    'Locations with a welded repair are removed from RTᵢₚ / RTᵦc (§4.4.5.5); non-welded repairs are not (§4.4.5.6). Repaired soil-side locations keep their rate in UPᵣ unless "cause of corrosion removed" is ticked.',
    ...(used.some((i) => per.get(i.id).est) ? [`${used.filter((i) => per.get(i.id).est).length} location(s) rest on the MFL estimate (E); results that depend on them are provisional.`] : []),
    ...(!blank(C.stprOverride) ? ['StPᵣ entered as an override.'] : []), ...(!blank(C.uprOverride) ? ['UPᵣ entered as an override.'] : []),
    ...(calc.noBasis ? ['No rate basis is set, so the floor is not evaluated.'] : []),
  ];
  const refs = ['API 653 §4.4.5 (MRT)', '§4.4.5.1 and Note 1 (rates, MFL threshold)', '§4.4.5.4 (critical zone)', '§4.4.5.5 / §4.4.5.6 (repairs)', '§4.4.6 (annular plates)', '§6.4.2.2 (inspection interval)', 'Table 4.4 (bottom minimum)'];

  // rates
  const st = calc.stSrc, up = calc.upSrc, sa = st && st.id ? per.get(st.id) : null, ua = up && up.id ? per.get(up.id) : null;
  const stLine = st === 'override' ? step('StPᵣ', 'entered', '', fmtRate(calc.StPr, job), 'StPr')
    : sa ? step('StPᵣ', `product-side loss at ${h(st.no)} / StPᵣ basis`, `${tn(sa.top)} / ${calc.stYears}`, fmtRate(calc.StPr, job), 'StPr')
      : step('StPᵣ', C.coated ? 'coated' : 'no product-side loss', '', fmtRate(calc.StPr, job), 'StPr');
  const thrLine = calc.thrRate > 0 ? step('MFL threshold rate', `nominal × ${h(C.mflThresholdPct)} % / tank age`, `${tn(Math.max(+(job.tank?.tBottom) || 0, anyAnn ? +(job.tank?.tAnnular ?? job.tank?.tBottom) || 0 : 0))} × ${h(C.mflThresholdPct)} / 100 / ${calc.years}`, fmtRate(calc.thrRate, job), 'thr') : '';
  const upLine = up === 'override' ? step('UPᵣ', 'entered', '', fmtRate(calc.UPr, job), 'UPr')
    : up === 'threshold' ? step('UPᵣ', 'the greater of the soil-side rates and the MFL threshold rate (threshold governs)', '', fmtRate(calc.UPr, job), 'UPr')
      : ua ? step('UPᵣ', `soil-side loss at ${h(up.no)} / tank age${calc.thrRate > 0 ? ' (more than the MFL threshold rate)' : ''}`, `${tn(ua.bot)} / ${calc.years}`, fmtRate(calc.UPr, job), 'UPr')
        : step('UPᵣ', C.cp ? 'effective CP' : 'no soil-side loss', '', fmtRate(calc.UPr, job), 'UPr');
  const kLine = step('StPᵣ + UPᵣ', 'combined rate', `${fmtRate(calc.StPr, job, false)} + ${fmtRate(calc.UPr, job, false)}`, fmtRate(calc.K, job), 'K');
  // locations
  const locRows = used.map((i) => { const a = per.get(i.id); return `<tr><td>${h(i.no)}</td><td>${a.region === 'annular' ? 'Annular' : 'Bottom'}${a.critical ? ' (CZ)' : ''}</td><td>${RESULT_SHORT[i.result || 'pending']}</td><td class="n">${tn(a.rem)}${remMark(a)}</td><td class="n">${a.top > 0 ? tn(a.top) : '—'}</td><td class="n">${a.bot > 0 ? tn(a.bot) : '—'}</td><td>${a.repair ? (a.auto ? 'Yes — calculated' : 'Yes — specified') : 'No'}</td></tr>`; }).join('');
  // rounds
  const rounds = tr.rounds.map((r, k) => `<tr><td>${k + 1}</td><td>${h(r.no)}</td><td class="n">${tn(r.rem)}</td><td class="n">${fmtRate(r.K, job, false)}</td><td class="n">${tn(r.projected)}</td><td class="n">${tn(r.limit)}</td><td>${tr.pruned.includes(r.id) ? 'repair removed — not needed once the others are repaired' : 'repair'}</td></tr>`).join('');
  // regions
  const regionSteps = calc.regions.map((r) => {
    const g = tr.regions?.[r.name] || {}, from = (x, base) => (x ? `at ${h(x.no)}` : `no unrepaired location — plate minimum ${tn(base)}`);
    return `<div class="calc-reg"><b>${h(r.label)}</b>
      ${step('RTᵢₚ', `least product-side remaining, ${from(g.ipFrom, g.base)}`, '', T(r.RTip), r.name + '.RTip')}
      ${step('RTᵦc', `least soil-side remaining, ${from(g.bcFrom, g.base)}`, '', T(r.RTbc), r.name + '.RTbc')}${r.RTut !== undefined ? '\n      ' + step('RTᵤₜ', g.utFrom ? `least floor UT reading with no known side of loss, at ${h(g.utFrom.no)}` : 'no floor UT reading without a known side', '', T(r.RTut), r.name + '.RTut') : ''}
      ${step('MRT', r.RTut !== undefined ? 'min(RTᵦc, RTᵢₚ, RTᵤₜ) − Oᵣ × (StPᵣ + UPᵣ)' : 'min(RTᵦc, RTᵢₚ) − Oᵣ × (StPᵣ + UPᵣ)', r.RT == null ? '' : `${tn(r.RT)} − ${calc.Or} × ${fmtRate(calc.K, job, false)}`, T(r.MRT), r.name + '.MRT')}
      ${step('t required today', 'limit + Oᵣ × (StPᵣ + UPᵣ)', `${tn(r.limit)} + ${calc.Or} × ${fmtRate(calc.K, job, false)}`, T(r.tReq), r.name + '.tReq')}
      ${step('Maximum Oᵣ', '(min(RTᵦc, RTᵢₚ) − limit) / (StPᵣ + UPᵣ)', r.RT == null || !(calc.K > 0) ? '' : `(${tn(r.RT)} − ${tn(r.limit)}) / ${fmtRate(calc.K, job, false)}`, r.OrMax === null ? '—' : Number.isFinite(r.OrMax) ? Math.max(0, r.OrMax).toFixed(1) + ' yr' : 'not limited (no corrosion rate)', r.name + '.OrMax')}
    </div>`;
  }).join('');
  const working = () => `<p class="note">Thickness in ${job.units === 'metric' ? 'mm' : 'in'}; rates in ${fmtRate(1, job).replace(/^[\d.\s]+/, '')}.</p>
    ${N.table('Locations used in the calculation')}<table class="grid small wrap"><thead><tr><th>No.</th><th>Area</th><th>Side</th><th class="n">Remaining</th><th class="n">Product-side loss</th><th class="n">Soil-side loss</th><th>Repaired (welded)</th></tr></thead><tbody>${locRows || '<tr><td colspan="7">None.</td></tr>'}</tbody></table>
    <p class="calc-h">Corrosion rates (with the repaired set below)</p>${stLine}${thrLine}${upLine}${kLine}
    ${tr.rounds.length ? `<p class="calc-h">Repairs found by the calculation, worst first</p>${N.table('Auto-repair rounds')}<table class="grid small wrap"><thead><tr><th>Round</th><th>Location</th><th class="n">Remaining</th><th class="n">Rate at that round</th><th class="n">t at Oᵣ</th><th class="n">Limit</th><th>Outcome</th></tr></thead><tbody>${rounds}</tbody></table><p class="note">Each round repairs the location furthest below its limit at Oᵣ and re-derives the rates; afterwards each calculated repair is tested again and removed if the floor passes without it.${tr.specified.length ? ` Specified repairs (Repair = Yes, welded): ${h(tr.specified.map((id) => byId.get(id)?.no).join(', '))}.` : ''}</p>` : `<p class="note">No repairs were needed by the calculation.${tr.specified.length ? ` Specified repairs: ${h(tr.specified.map((id) => byId.get(id)?.no).join(', '))}.` : ''}</p>`}
    <p class="calc-h">By area</p>${regionSteps}`;
  const results = calc.regions.map((r) => [h(r.label) + ' — MRT at Oᵣ', T(r.MRT), `≥ ${T(r.limit)}`, r.notEvaluated ? 'Not evaluated' : r.ok === null ? '—' : r.ok ? 'Acceptable' : '<b>Not acceptable</b>', r.name + '.result']);
  return block(N, { name: 'Floor MRT', inputs, assumptions, refs, working, results, assess: job.secs?.floor?.assess || null, resultNote: `With the ${calc.repairs.length} repair(s) listed in the floor chapter.` });
}

/* ================================================================================ B — annular limit === */
export function calcAnnular({ job, layout, calc, N }) {
  if (!(layout.Ri < layout.R)) return '';
  const ann = calc.ann || {}, req = ann.req || annularReq(job), trc = req?.trace, C = calc.C || {}, B = designBasis(job);
  const T = (v) => fmt(v, 't', job);
  const inputs = [
    ['Tank diameter D', trc ? `${trc.D.toFixed(2)} ft` : fmt(B.D, 'big', job), 'S', 'Tank setup'],
    ['Liquid height H (maximum fill)', trc ? `${trc.H.toFixed(2)} ft` : fmt(B.fill, 'big', job), 'S', blank(job.tank?.fillH) ? 'shell height (no fill height entered)' : 'Tank setup'],
    ['Specific gravity G', h(trc ? trc.G : (B.G ?? '—')), 'S', 'Tank setup'],
    ['Course 1 nominal thickness t', trc ? `${trc.t1.toFixed(3)} in` : '—', 'S', 'Shell courses'],
    ['Corrosion allowance', blank(C.annCA) ? 'none' : T(C.annCA), 'S', 'API 653 page'],
    ...(ann.src === 'entered' ? [['Annular limit entered', T(C.mrtAnnular), 'S', 'API 653 page']] : []),
  ];
  const big = trc?.big;
  const working = () => (req ? `${step('Sb', big ? '2.6 D (H − 1) G / t' : '2.34 D (H − 1) / t', trc ? (big ? `2.6 × ${trc.D.toFixed(2)} × (${trc.H.toFixed(2)} − 1) × ${trc.G} / ${trc.t1.toFixed(3)}` : `2.34 × ${trc.D.toFixed(2)} × (${trc.H.toFixed(2)} − 1) / ${trc.t1.toFixed(3)}`) : '', `${Math.round(req.Sb).toLocaleString()} psi`, 'Sb')}
    ${req.over ? `<p class="note">${h(req.why || 'Beyond the table')}: the table does not give a thickness; an elastic analysis is required.</p>`
      : trc?.at === 'between' ? step('Table thickness', `${h(req.table)}, row for course 1 t ≤ ${trc.rowUpTo} in, interpolated between ${trc.x0.toLocaleString()} and ${trc.x1.toLocaleString()} psi`, `${trc.y0} + (${Math.round(req.Sb).toLocaleString()} − ${trc.x0.toLocaleString()}) / (${trc.x1.toLocaleString()} − ${trc.x0.toLocaleString()}) × (${trc.y1} − ${trc.y0})`, `${req.t.toFixed(3)} in`, 'tTbl')
        : trc ? step('Table thickness', `${h(req.table)}, row for course 1 t ≤ ${trc.rowUpTo} in, first stress column (Sb at or below ${trc.x0.toLocaleString()} psi)`, '', `${req.t.toFixed(3)} in`, 'tTbl') : ''}
    ${!req.over ? step('Annular limit from the table', 'table thickness + corrosion allowance', `${T(req.tmm)} + ${blank(C.annCA) ? '0' : T(C.annCA)}`, T(ann.tbl), 'tbl') : ''}`
    : '<p class="note">The table value cannot be calculated: enter the course 1 thickness, the fill height and the specific gravity.</p>');
  return block(N, { name: 'Annular plate limit',
    inputs, refs: ['API 653 §4.4.6', 'API 653 Table 4.5 (G < 1)', 'API 650 Table 5.1b (G ≥ 1)', 'API 650 §5.5.3 (limits of Table 5.1)'],
    assumptions: [big ? 'G ≥ 1: API 650 Table 5.1b applies.' : 'G < 1: API 653 Table 4.5 applies (stress for the product, 2.34 D (H − 1) / t).', ann.src === 'entered' ? `The entered limit is used${ann.low ? ' — it is less than the table value' : ''}.` : ann.unset ? 'No table value: the bottom-plate minimum is used until a value is entered.' : 'The table value plus any corrosion allowance is used.'],
    working, results: [['Annular plate limit used', T(calc.mAnn), '—', h(ann.src === 'entered' ? 'Entered' : ann.unset ? 'Not set — bottom minimum used' : 'From the table'), 'mAnn']], assess: undefined,
  });
}

/* ============================================================================== C — critical zone === */
export function calcCritical({ job, calc, N }) {
  const P = czLimitParts(job), C = calc.C || {}, T = (v) => fmt(v, 't', job), met = job.units === 'metric', entered = !blank(C.czLimit);
  return block(N, { name: 'Critical zone limit',
    inputs: [
      ['Critical zone width', fmt(C.czDist, 'small', job), 'S', 'API 653 page (3 in default)'],
      ['Course 1 t-min', P.st === null ? '—' : T(P.st), P.stSrc.includes('calculated') ? 'C' : 'S', h(P.stSrc)],
      ['Upper value', met ? '3 mm' : '0.118 in', 'T', '§4.4.5.4'], ['Lower bound', met ? '2.5 mm' : '0.10 in', 'T', '§4.4.5.4'],
      ...(entered ? [['Limit entered', T(C.czLimit), 'S', `API 653 page — reason: ${h(C.czLimitReason || 'none recorded')}`]] : []),
    ],
    assumptions: [entered ? 'The entered limit replaces the §4.4.5.4 value.' : 'The §4.4.5.4 value is used.', 'A location is in the critical zone when its recorded extent reaches within the zone width of the shell (§3.11).'],
    refs: ['API 653 §4.4.5.4', '§3.11 (critical zone)'],
    working: () => `${step('Half of course 1 t-min', 't-min / 2', P.st === null ? '' : `${fmt(P.st, 't', job, false)} / 2`, P.half === null ? '—' : T(P.half), 'half')}
      ${step('Smaller of', `min(${met ? '3 mm' : '0.118 in'}, t-min / 2)`, '', T(P.lim), 'lim')}
      ${step('Not less than', `max(${met ? '2.5 mm' : '0.10 in'}, value above)`, '', T(P.value), 'auto')}`,
    results: [['Critical zone limit used', T(calc.czLim), '—', entered ? 'Entered' : '§4.4.5.4', 'czLim']], assess: undefined,
  });
}

/* =============================================================================== D — patch plates === */
export function calcPatches({ job, calc, N, patches }) {
  if (!patches?.length) return '';
  const C = calc.C || {}, s = (v) => fmt(v, 'small', job, false), S = (v) => fmt(v, 'small', job);
  const rows = patches.map((pp) => { const tq = pp.trace || []; return `<tr><td><b>${h(pp.id)}</b></td><td>${h(pp.inds.map((i) => i.no).join(', '))}</td><td class="n">${pp.inds.map((i) => (i.len || i.wid ? `${s(i.len)} × ${s(i.wid)}` : '—')).join('<br>')}</td><td class="n">${tq.map((q) => `${s(q.L)} × ${s(q.W)}`).join('<br>')}</td><td>${pp.inds.length > 1 ? 'combined (overlap or shared repair ID)' : pp.manual ? 'size entered' : 'auto'}</td><td>${pp.kind === 'tomb' ? 'Tombstone (near the shell)' : 'Rectangle'}</td><td class="n" data-c="size">${s(pp.L)} × ${s(pp.W)}</td><td class="n">${fmt(pp.t, 't', job, false)}${pp.tAssumed ? '*' : ''}</td></tr>`; }).join('');
  return block(N, { name: 'Patch plates',
    inputs: [['Default patch size', `${S(C.patchL ?? 304.8)} × ${S(C.patchW ?? 304.8)}`, 'S', 'API 653 page'], ['Extend past the corrosion by at least', S(C.patchMargin ?? 50.8), 'S', 'API 653 page (2 in default)'], ['Default patch thickness', fmt(C.patchT ?? 6.35, 't', job), 'S', 'API 653 page'], ['Auto patch', yesNo(C.autoPatch !== false), 'S', 'API 653 page'], ['Indication extents (L × W)', 'per indication', 'M', 'indication editor']],
    assumptions: ['Each repaired location gets a lap-welded patch unless another repair method is chosen.', 'Patches that overlap, or share a repair ID, are combined into one.', 'A patch reaching within 6 in of the shell becomes a tombstone patch, sides radial, extending to the shell.', 'An entered patch size replaces the calculated size.'],
    refs: ['API 653 §9.10 (patch plates)', '§9.11.1.1 (extent past the corrosion)', '§9.11.1.2 (critical zone patches)'],
    working: () => `${step('Size for one location', 'L = max(default L, indication L + 2 × margin); W = max(default W, indication W + 2 × margin)', '', 'per location below', '')}
      ${N.table('Patch plate sizes')}<table class="grid small wrap"><thead><tr><th>Patch</th><th>Covers</th><th class="n">Indication L × W</th><th class="n">Size per location</th><th>How sized</th><th>Shape</th><th class="n">Final L × W</th><th class="n">t</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="note">Sizes in ${job.units === 'metric' ? 'mm' : 'in'}. * default thickness. The critical-zone checks for each patch are listed in the floor chapter (critical zone patch plates).</p>`,
    results: patches.map((pp) => [`${h(pp.id)} — size`, `${S(pp.L)} × ${S(pp.W)}`, '—', pp.checks?.some((k) => k.ok === false) ? '<b>A critical-zone check fails</b>' : pp.checks?.length ? 'See critical-zone checks' : 'Sized', 'patch.' + pp.id]),
    assess: undefined,
  });
}

/* =============================================================================== E — shell t-min === */
export function calcShell({ job, N, working, rows }) {
  const B = designBasis(job), met = job.units === 'metric';
  return block(N, { name: 'Shell t-min',
    inputs: [['Tank diameter D', fmt(B.D, 'big', job), 'S', 'Tank setup'], ['Specific gravity G', h(B.G ?? '—'), 'S', 'Tank setup'], ['Maximum fill height', fmt(B.fill, 'big', job), 'S', blank(job.tank?.fillH) ? 'shell height (no fill height entered)' : 'Tank setup'], ['Construction code / edition', h([job.tank?.code, job.tank?.edition].filter(Boolean).join(', ') || '—'), 'S', 'Tank setup'], ['Course heights, materials, joints', 'per course', 'S', 'Shell courses'], ['Allowable stress S, joint efficiency E', 'per course', 'T', 'API 653 Table 4.1, Table 4.2 / 4.3'], ['Minimum readings', 'per course', 'M', 'Shell UT']],
    assumptions: ['A t-min entered on a course replaces the calculated value (marked †).', 'Materials not listed use the app\'s unknown-material values (30,000 / 55,000 psi).', met ? 'SI form: t = 4.9 D (H − 0.3) G / (S E), not less than 2.5 mm.' : 'US form: t = 2.6 (H − 1) D G / (S E), not less than 0.100 in.', 'Single readings are compared with the t-min at their elevation; a reading below it is evaluated per §4.3.2.'],
    refs: ['API 653 §4.3.3.1', '§4.3.2', 'Table 4.1', 'Table 4.2 / 4.3'],
    working: () => `${step('t-min', met ? '4.9 D (H − 0.3) G / (S E)' : '2.6 (H − 1) D G / (S E)', '', 'per course in the table', '')}${step('Maximum product fill', met ? 'S E t / (4.9 D G) + 0.3' : 'S E t / (2.6 D G) + 1', '', 'from each course\'s minimum reading', '')}${step('Hydrostatic test height Ht', met ? 'St E t / (4.9 D) + 0.3' : 'St E t / (2.6 D) + 1', '', 'from each course\'s minimum reading', '')}${working()}`,
    results: rows, assess: job.secs?.shell?.assess || null,
  });
}

/* ================================================================================ F — nozzle necks === */
export function calcNozzles({ job, N }) {
  const list = (job.nozzles || []).slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0)); if (!list.length) return '';
  const tn = (v) => fmt(v, 't', job, false);
  const rows = list.map((n) => { const w = nozzleWall(n, job), r = nozzleUT(n, job), vals = [...UT_CLOCK.map(([k]) => n[k]), ...(n.utx || []).map((x) => x.t)].filter((v) => !blank(v) && Number.isFinite(+v));
    return `<tr data-noz="${h(n.id)}"><td><b>${h(n.mark)}</b></td><td class="n">${tn(w.tNom)} <small>${w.nomTbl ? 'table' : 'entered'}</small></td><td class="n">${tn(w.tMin)} <small>${w.minTbl ? 'table — construction min.' : w.tMin ? 'entered — retirement t' : ''}</small></td><td class="n">${vals.length ? vals.map(tn).join(', ') : '—'}</td><td class="n" data-c="min">${r.count ? tn(r.min) : '—'}</td><td class="n" data-c="loss">${r.lossPct != null && r.count ? `(${tn(w.tNom)} − ${tn(r.min)}) / ${tn(w.tNom)} = ${r.lossPct.toFixed(0)} %` : '—'}</td><td data-c="status">${h(r.status || '—')}</td></tr>`; }).join('');
  return block(N, { name: 'Nozzle necks',
    inputs: [['Neck readings (12, 3, 6, 9 o\'clock and others)', 'per nozzle', 'M', 'Nozzle UT'], ['Nominal wall', 'per nozzle', 'S', 'entered, or the pipe table for the construction code'], ['Retirement thickness', 'per nozzle', 'S', 'entered by the engineer'], ['Construction minimum', 'per nozzle', 'T', 'nozzle neck table (nominal less 12.5 % mill tolerance)']],
    assumptions: ['A neck is accepted only against an engineer-entered retirement thickness; a table value is a construction minimum, not a retirement thickness.', 'The minimum of all readings on the neck is compared.'],
    refs: ['API 650 Tables 5.6b / 5.7b (nozzle necks)'],
    working: () => `${step('Wall loss', '(nominal − minimum reading) / nominal × 100', '', 'per nozzle below', '')}${N.table('Nozzle neck working')}<table class="grid small wrap"><thead><tr><th>Mark</th><th class="n">Nominal</th><th class="n">t-min</th><th class="n">Readings</th><th class="n">Minimum</th><th class="n">Loss</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table><p class="note">Thickness in ${job.units === 'metric' ? 'mm' : 'in'}.</p>`,
    results: list.map((n) => { const r = nozzleUT(n, job), w = nozzleWall(n, job); return [h(n.mark) + ' — minimum reading', r.count ? fmt(r.min, 't', job) : '—', w.tMin ? `${w.minTbl ? 'construction min.' : 'retirement t'} ${fmt(w.tMin, 't', job)}` : '—', h(r.status || '—'), 'noz.' + n.id]; }),
    assess: job.secs?.nozzles?.assess || null,
  });
}

/* ================================================================================== G — roof plates === */
export function calcRoof({ job, N }) {
  const fx = hasFixed(job), fl = hasFloating(job); if (!fx && !fl) return '';
  const T = (v) => fmt(v, 't', job), DEF = job.units === 'metric' ? 2.3 : 0.09 * 25.4, near = (a, b) => Math.abs((+a || 0) - b) < 1e-6;
  const inputs = [], results = [];
  if (fx) { const F = job.roof.fixed, st = (F.pts || []).map((p) => pointStatus(job, p)), read = st.filter((x) => x.t !== null), low = st.filter((x) => roofBad(x.status)), holes = st.filter((x) => x.status === 'Hole through plate');
    inputs.push(['Fixed roof nominal / t-min', `${T(F.tNom)} / ${T(F.tMin)}`, near(F.tMin, DEF) ? 'D' : 'S', near(F.tMin, DEF) ? 'app default (§4.2.1.2 value)' : 'entered'], ['Fixed roof readings', `${read.length} of ${(F.pts || []).length} points`, 'M', 'Fixed roof UT']);
    results.push(['Fixed roof — minimum reading', read.length ? T(Math.min(...read.map((x) => x.t))) : '—', `t-min ${T(F.tMin)}`, low.length ? `<b>${low.length} below t-min${holes.length ? `, ${holes.length} hole(s)` : ''}</b>` : read.length ? 'All at or above t-min' : '—', 'fixed']); }
  if (fl) { const F = job.roof.floating, lay = floatingLayout(job), st = lay.plates.filter((p) => p.kind !== 'annular').map((p) => plateUT(job, p)), read = st.filter((x) => x.min !== null), low = st.filter((x) => roofBad(x.status));
    inputs.push(['Deck nominal / t-min', `${T(F.deckNom)} / ${T(F.deckMin)}`, near(F.deckMin, DEF) ? 'D' : 'S', near(F.deckMin, DEF) ? 'app default (§4.2.1.2 value)' : 'entered'], ['Deck readings', `${read.length} of ${st.length} plates (5 each)`, 'M', 'Deck & pontoons']);
    results.push(['Floating roof deck — minimum reading', read.length ? T(Math.min(...read.map((x) => x.min))) : '—', `t-min ${T(F.deckMin)}`, low.length ? `<b>${low.length} plate(s) below t-min</b>` : read.length ? 'All at or above t-min' : '—', 'deck']); }
  return block(N, { name: 'Roof plates',
    inputs, assumptions: ['Single readings are compared with t-min; §4.2.1.2 applies to the average over any 100 in² (645 cm²) — a single low reading calls for that check.', 'A reading of 0 records a hole through the plate, which requires repair or replacement.'],
    refs: ['API 653 §4.2.1.2'],
    working: () => `${step('Wall loss', '(nominal − reading) / nominal × 100', '', 'per point / plate, listed in the appendix "Roof UT readings and rim seal gaps"', '')}${step('Status', 'reading ≤ 0 → hole; reading < t-min → below t-min; else OK', '', 'per point / plate', '')}`,
    results, assess: job.secs?.[fl && !fx ? 'flroof' : 'froof']?.assess || null,
  });
}

/* =================================================================================== H — rim seal === */
export function calcSeal({ job, N }) {
  if (!hasFloating(job) || !job.roof.seal) return '';
  const seal = job.roof.seal, D = +job.tank?.diameter || 0, met = job.units === 'metric', stds = activeStds(seal); if (!stds.length) return '';
  const gapRows = (sd, label) => (sd.gaps || []).map((g, i) => { const L = +g.len, W = +(g.wAvg ?? g.wMax), a = L > 0 && W > 0 ? (L / 10) * (W / 10) : null; return `<tr><td>${label} ${i + 1}</td><td class="n">${(L / 10).toFixed(1)}</td><td class="n">${(W / 10).toFixed(2)}${g.wAvg == null ? ' (max)' : ''}</td><td class="n">${a === null ? '—' : a.toFixed(1)}</td><td class="n">${(+g.wMax / 10).toFixed(2)}</td></tr>`; }).join('');
  const ev0 = sealEval(job, stds[0]), p = ev0.p, s = ev0.s;
  const sum = (lab, x) => `${step(`${lab} — area per metre of diameter`, 'Σ (length × width) / D', x.n ? `${x.areaCm2.toFixed(1)} cm² / ${(D / 1000).toFixed(2)} m` : '', x.perM == null ? '—' : `${x.perM.toFixed(1)} cm²/m`, lab.toLowerCase().startsWith('p') ? 'pPerM' : 'sPerM')}${step(`${lab} — widest gap`, 'max(width)', '', x.wMaxCm == null ? '—' : `${x.wMaxCm.toFixed(2)} cm`, lab.toLowerCase().startsWith('p') ? 'pW' : 'sW')}`;
  return block(N, { name: 'Rim seal',
    inputs: [['Tank diameter D', fmt(D, 'big', job), 'S', 'Tank setup'], ['Gap lengths and widths', `${p.n} primary, ${s.n} secondary`, 'M', 'Rim seal inspection'], ['Shoe heights and visual checks', 'as recorded', 'M', 'Rim seal inspection'], ...stds.map((k) => { const L = sealEval(job, k).L; return [`Limits — ${h(L.short || k)}`, h(L.name), k === 'custom' ? 'S' : 'T', k === 'custom' ? 'entered (provincial approval or guideline)' : 'built into the app from the regulation']; })],
    assumptions: ['Gap area = length × average width (maximum width where no average was recorded).', 'An empty gap table counts as no gaps only when "No gaps found" is ticked.', ...(met ? [] : ['Calculated in centimetres, as the regulations state their limits; inches shown in the chapter.'])],
    refs: ['40 CFR 60.113b', '40 CFR 63.1063', 'SOR/2025-88 ss. 64–65, 73–76, 91–101, Schedule 4'],
    working: () => `${N.table('Gap areas (cm)')}<table class="grid small wrap"><thead><tr><th>Gap</th><th class="n">Length</th><th class="n">Width used</th><th class="n">Area (cm²)</th><th class="n">Max width</th></tr></thead><tbody>${gapRows(seal.primary, 'Primary') + gapRows(seal.secondary, 'Secondary') || '<tr><td colspan="5">No gaps recorded.</td></tr>'}</tbody></table>${sum('Primary seal', p)}${seal.secondary.type !== 'None' ? sum('Secondary seal', s) : ''}`,
    results: stds.flatMap((k) => { const ev = sealEval(job, k); return ev.rows.filter((r) => r.limit != null).map((r) => [`${h(ev.L.short || k)} — ${h(r.item)}`, r.value == null ? '—' : `${r.value.toFixed(r.unit === 'cm2m' ? 1 : 2)} ${r.unit === 'cm2m' ? 'cm²/m' : 'cm'}`, `${r.op} ${r.limit} ${r.unit === 'cm2m' ? 'cm²/m' : 'cm'}`, r.ok === true ? 'OK' : r.ok === false ? '<b>Fails</b>' : '—', `seal.${k}.${r.item}`]); }),
    assess: job.secs?.flroof?.assess || null,
  });
}

/* ================================================================================= I — settlement === */
export function calcSettle({ job, N, c, working }) {
  const met = job.units === 'metric', F = c.fit, sU = met ? 'mm' : 'in', fS = (mm) => (mm == null ? '—' : met ? mm.toFixed(1) : (mm / 25.4).toFixed(2));
  const psi = (mpa) => Math.round(mpa * 145.0377);
  return block(N, { name: 'Settlement',
    inputs: [['Stations', `${c.N} (${c.n} read)`, 'S', 'Settlement survey'], ['Station elevations', 'per station', 'M', 'Settlement survey'], ['Tank diameter D', fmt(c.D, 'big', job), 'S', 'Tank setup'], ['Shell height H', c.H > 0 ? fmt(c.H, 'big', job) : '—', 'S', 'shell courses unless entered'], ['Arc length between stations L', c.L ? fmt(c.L, 'big', job) : '—', 'C', 'π D / N'], ['Yield strength Y', c.Y == null ? '—' : `${psi(c.Y).toLocaleString()} psi`, c.Ysrc === 'entered' ? 'S' : 'T', h(c.Ysrc || '')], ['Modulus E', c.E == null ? '—' : `${(psi(c.E) / 1e6).toFixed(1)} × 10⁶ psi`, c.Esrc === 'entered' ? 'S' : 'T', h(c.Esrc || '')], ['Edge settlement readings', 'per station', 'M', 'Edge settlement survey']],
    assumptions: ['Uniform settlement plus planar tilt is fitted as a + b cos θ + c sin θ by least squares.', 'The out-of-plane check needs R² ≥ 0.90; otherwise the arc method (information only) or an engineering evaluation applies.', c.k > 1 ? `Si and Smax use every ${c.k}th station (spacing ${fmt(c.Lsub, 'big', job)}) as the B.2.2.4 NOTE requires.` : 'Si and Smax use every station.', 'Annex B gives no numeric planar-tilt limit; out-of-plumbness is compared with §10.5.2.1.'],
    refs: ['API 653 Annex B: B.2.2.4, B.3.2.1, B.3.2.2, B.2.3, B.3.3, B.3.4', 'Fig. B.6, B.7, B.11, B.12', '§10.5.2.1'],
    working: () => `${F ? `${step('Cosine fit', 'z = a + b cos θ + c sin θ', '', `a = ${fS(F.a)}, b = ${fS(F.b)}, c = ${fS(F.c)} ${sU}`, 'fit')}${step('R²', '1 − SSE / Syy', '', F.R2.toFixed(3), 'R2')}${step('Planar tilt across the diameter', '2 √(b² + c²)', `2 × ${fS(F.amp)}`, `${fS(F.tilt)} ${sU}`, 'tilt')}${step('Out-of-plumbness at the top of the shell', 'tilt / D × H', '', `${fS(F.plumb)} ${sU}`, 'plumb')}` : ''}
      ${c.Smax != null ? step('Smax', '11 L² Y / (2 E H)', `11 × ${fmt(c.Lsub, 'big', job, false)}² × ${psi(c.Y).toLocaleString()} / (2 × ${psi(c.E).toLocaleString()} × ${fmt(c.H, 'big', job, false)})`, `${fS(c.Smax)} ${sU}`, 'Smax') : ''}
      ${step('U and S', 'U = measured − fit; S = U − ½(U before + U after)', '', 'per station below', '')}${working()}`,
    results: [['Cosine fit R²', F ? F.R2.toFixed(3) : '—', '≥ 0.90', c.valid ? 'Valid' : '<b>Not valid</b>', 'R2'], ['Out-of-plumbness', F ? `${fS(F.plumb)} ${sU}` : '—', F ? `≤ ${fS(F.plumbLim)} ${sU}` : '—', c.tiltOk === true ? 'OK' : c.tiltOk === false ? '<b>Fails</b>' : '—', 'plumb'], ['Max out-of-plane |S|', F?.maxS == null ? '—' : `${fS(Math.abs(F.maxS))} ${sU}`, c.Smax == null ? '—' : `≤ ${fS(c.Smax)} ${sU}`, c.oopOk === true ? 'OK' : c.oopOk === false ? '<b>Fails</b>' : '—', 'S']],
    assess: job.secs?.settle?.assess || null, resultNote: 'Edge settlement and bottom depression results are in the settlement chapter; the edge working by station follows above.',
  });
}

export const CALC_CSS = `
.report .calc .calc-step { display: grid; grid-template-columns: 12em minmax(0, 1fr); gap: 0 10px; padding: 3px 0; border-bottom: 0.5px solid #e1e5ea; font-size: 10.5px; }
.report .calc .cs-l { font-weight: 600; grid-row: span 3; } .report .calc .cs-f { font-style: italic; } .report .calc .cs-s { color: #3a434e; } .report .calc .cs-a { font-weight: 700; }
.report .calc .calc-h { font-weight: 700; margin: 10px 0 2px; font-size: 10.5px; }
.report .calc .calc-reg { margin: 6px 0 8px; } .report .calc .calc-reg > b { display: block; margin-bottom: 2px; }
.report .calc .calc-assess { border: 1px solid #8a939d; padding: 5px 8px; margin: 8px 0; font-size: 10.5px; } .report .calc .calc-assess.none { border-style: dashed; color: #3a434e; }
.report .calc .calc-refs { font-size: 10.5px; } .report .calc .calc-list { margin: 0 0 6px 16px; padding: 0; font-size: 10.5px; }
.report .calc h3.rp-h3 { font-size: 11px; margin: 12px 0 4px; }
@media print { .report .calc .calc-res { break-inside: avoid; } .report .calc .calc-step { break-inside: avoid; } }`;
