// Printable report (browser print → Save as PDF).
import { personName } from './personnel.js';
import { EQ_LABEL, EQ_TYPES, equipLine, calState, equipUse, useByMethod } from './equipment.js';
import { fmt, fmtRate, u } from './units.js';
import { RESULTS, RESULT_SHORT, nozzleUT, nozzleWall, NZ_CONN_SHORT, UT_CLOCK, CORRECTIONS, statusText } from './calc.js';
import { renderMapSVG, COLORS } from './map.js';
import { settleCalc, edgeEval, depEval, hasSettle, hasEP, epOffsets, xKey, profileEval, profileSVG, stations as setStations, slopeText, settleChartSVG, settlePlanSVG, ELEV_UNITS, PSI_PER_MPA } from './settle.js';
import { sealEval, activeStds, nextDue, cm2mToIn2ft, SEAL_CHECKS } from './seal.js';
import { ROOF_TYPES, hasFixed, hasFloating, floatingLayout, floatingSVG, fixedSVG, plateUT, pointStatus, PT5, PT5_SHORT, roofDiameter, roofBad } from './roof.js';
import { rolloutSVG, utLocations, courseSummary, coursesWithElev, courseAt, readingElevations, getReading, fmtElev, coursePlates } from './shell.js';
import { designBasis, fillFromT } from './design.js';
import { jointLabel, MAT_NOTES } from './tables.js';
import { SECTIONS, findings, allDefs, STATUS_TEXT, PRIORITY_LABEL, CONDITIONS } from './sections.js';
import { patchList, patchOf } from './patches.js';
import { itemFloor, angleOf, refCornerName, datumName, orientName } from './geometry.js';
import { inScope } from './registry.js';
import { escText as h } from './util.js';
import { assembleReport, layoutOf, legendList, numbering, sheetHTML, swatch } from './report/frame.js';
import { execCh, personnelCh, scopeCh, tankCh, vm } from './report/front.js';
import { floorParts } from './report/floor.js';

const yn = (b) => (b ? 'Yes' : 'No');
const or = (v, d = '—') => (v === null || v === undefined || v === '' ? d : v);

export function legendHTML() {
  const item = (cls, label, svg) => `<span class="lg"><svg viewBox="-6 -6 12 12" width="14" height="14">${svg}</svg>${label}</span>`;
  return `<div class="legend">
    ${item('ps', 'Product side', `<circle r="4.5" fill="${COLORS.ps}"/>`)}
    ${item('ss', 'Soil side', `<circle r="4.5" fill="${COLORS.ss}"/>`)}
    ${item('both', 'Both sides', `<circle r="4.5" fill="${COLORS.ss}"/><path d="M-4.5 0A4.5 4.5 0 0 1 4.5 0Z" fill="${COLORS.ps}"/>`)}
    ${item('pend', 'Pending prove-up', `<circle r="4" fill="#fff" stroke="${COLORS.pending}" stroke-width="1.6"/>`)}
    ${item('nri', 'No indication', `<path d="M-4-4L4 4M-4 4L4-4" stroke="${COLORS.nri}" stroke-width="1.6"/>`)}
    ${item('rep', 'Repair', `<circle r="5" fill="none" stroke="#b91c1c" stroke-width="1.3" stroke-dasharray="2 1.3"/>`)}
    ${item('cz', 'Critical zone limit', `<path d="M-5 0H5" stroke="#c2410c" stroke-width="1.4" stroke-dasharray="2.5 1.5"/>`)}
    ${item('patch', 'Patch plate', `<rect x="-5" y="-4" width="10" height="8" fill="rgba(234,88,12,.18)" stroke="#c2410c" stroke-width="1"/>`)}
    ${item('not', 'Not scanned', `<rect x="-5" y="-4" width="10" height="8" fill="url(#lg-hatch)" stroke="#5b6470" stroke-width=".6"/><defs><pattern id="lg-hatch" width="2.5" height="2.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.5" height="2.5" fill="#eceef1"/><line y2="2.5" stroke="#9aa3ad" stroke-width=".7"/></pattern></defs>`)}
  </div>`;
}

export function buildReport(job, layout, calc, company, photos, opts) {
  const U = u(job), I = job.info || {}, T = job.tank || {}, C = calc.C;
  const t = (mm) => fmt(mm, 't', job);
  const inds = (job.indications || []).slice().sort((a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
  const per = calc.per;
  const cnt = (r) => inds.filter((i) => (i.result || 'pending') === r).length;
  const proven = inds.filter((i) => ['ps', 'ss', 'both'].includes(i.result));
  const rems = proven.map((i) => per.get(i.id)?.rem).filter((v) => v !== null && v !== undefined);
  const losses = proven.map((i) => per.get(i.id)?.lossPct).filter((v) => v !== null && v !== undefined);
  const repairs = inds.filter((i) => per.get(i.id)?.repair);
  const below = inds.filter((i) => per.get(i.id)?.status === 'below MRT');
  let aTot = 0, aNot = 0, aPart = 0;
  for (const p of layout.plates) { aTot += p.area; const s = job.plates?.[p.key]?.scan; if (s === 'not') aNot += p.area; else if (s === 'partial') aPart += p.area; }
  const pct = (a) => (aTot ? ((a / aTot) * 100).toFixed(1) + '%' : '—');
  const listed = opts.provenOnly ? inds.filter((i) => !['nri', 'other'].includes(i.result)) : inds;
  const patches = patchList(job, layout, calc);
  const showSize = opts.indSize !== false && inds.some((i) => i.len || i.wid);
  const allOk = calc.regions.every((r) => r.ok !== false) && !below.length;

  const kv = (rows) => `<table class="kv">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;

  const map = renderMapSVG(job, layout, { calc, print: true, plateLabels: opts.plateLabels !== false, indLabels: true, showDatums: opts.datums !== false, floorOf: (ft) => itemFloor(layout, ft) });

  const indRows = listed.map((i) => {
    const a = per.get(i.id) || {};
    const fl = a.floor;
    return `<tr class="${a.repair ? 'is-rep' : ''}${a.status === 'below MRT' ? ' is-bad' : ''}">
      <td>${h(i.no)}</td><td>${h(a.plate?.label ?? '?')}</td><td class="n">${fmt(i.x, 'small', job, false)}</td><td class="n">${fmt(i.y, 'small', job, false)}</td>
      <td class="n">${fl ? angleOf(fl.x, fl.y).toFixed(0) + '°' : '—'}</td>
      <td class="n">${or(i.mflPct)}</td><td><span class="chip r-${i.result || 'pending'}">${RESULT_SHORT[i.result || 'pending']}</span>${a.critical ? ' <span class="chip cz">CZ</span>' : ''}</td>
      <td class="n">${fmt(i.utMin, 't', job, false)}</td><td class="n">${fmt(i.vtDepth, 't', job, false)}</td>
      <td class="n">${fmt(a.rem, 't', job, false)}${a.src && a.src !== 'UT' ? '<sup>' + (a.src === 'MFL estimate' ? 'M' : 'V') + '</sup>' : ''}</td>
      <td class="n">${a.lossPct !== null && a.lossPct !== undefined ? a.lossPct.toFixed(0) : '—'}</td>
      <td class="n">${fmt(a.projected, 't', job, false)}</td><td>${h(statusText(a))}</td><td>${h([i.vtCond, i.comments].filter(Boolean).join('; '))}</td></tr>`;
  }).join('');

  const regionRows = calc.regions.map((r) => `<tr><td>${h(r.label)}</td><td class="n">${t(r.RTip)}</td><td class="n">${t(r.RTbc)}</td><td class="n">${t(r.MRT)}</td><td class="n">${t(r.limit)}</td><td class="n">${t(r.tReq)}</td><td class="n">${r.OrMax === null ? '—' : Number.isFinite(r.OrMax) ? Math.max(0, r.OrMax).toFixed(1) + ' yr' : 'n/a (no corrosion rate)'}</td><td class="${r.ok ? 'ok' : r.ok === false ? 'bad' : ''}">${r.notEvaluated ? 'Not evaluated — no rate basis' : r.ok === null ? '—' : r.ok ? (r.provisional ? `Provisional — ${r.provisional} location${r.provisional > 1 ? 's' : ''} on MFL estimates` : 'Acceptable') : 'Not acceptable'}</td></tr>`).join('');

  const photoBlock = () => (opts.photos ? (() => {
    const byInd = new Map();
    for (const p of photos) { if (!byInd.has(p.indId)) byInd.set(p.indId, []); byInd.get(p.indId).push(p); }
    const blocks = inds.filter((i) => byInd.has(i.id)).map((i) => byInd.get(i.id).map((p) => `<figure><img src="${p.dataUrl}" alt=""><figcaption><b>${h(i.no)}</b> · ${h(per.get(i.id)?.plate?.label ?? '')} · ${h(p.caption || RESULTS[i.result || 'pending'])}</figcaption></figure>`).join('')).join('');
    return blocks ? `<section><div class="photos">${blocks}</div>${N.figure('Photographs of floor indications (number · plate · caption)')}</section>` : '';
  })() : '');

  const indRegister = () => `<section>
        ${N.table('Floor indication register — all MFL indications and prove-up results')}<table class="grid small"><thead><tr><th>No.</th><th>Plate</th><th>X</th><th>Y</th><th>Angle</th><th>MFL %</th><th>Result</th><th>UT min</th><th>VT pit</th><th>Remaining</th><th>Loss %</th><th>t at O<sub>r</sub></th><th>Status</th><th>Remarks</th></tr></thead><tbody>${indRows || '<tr><td colspan="14">No indications recorded.</td></tr>'}</tbody></table>
    <p class="note">Dimensions in ${U.small}. Remaining thickness from UT unless marked <sup>V</sup> (nominal − VT pit depth) or <sup>M</sup> (MFL estimate).</p>
  </section>`;

  const platesBlock = () => `<section>${N.table('Plate register — size, orientation, thickness, scan coverage and datum')}<table class="grid small"><thead><tr><th>Plate</th><th>Type</th><th>Size (L × W)</th><th>Orientation</th><th>Nominal t</th><th>UT min</th><th>MFL scan</th><th>Datum</th><th>Ind.</th><th>Notes</th></tr></thead><tbody>${layout.plates.map((p) => {
    const o = job.plates?.[p.key] || {}; const nI = inds.filter((i) => i.plate === p.key).length;
    return `<tr><td>${h(p.label)}</td><td>${p.kind}${p.cut ? ' (cut)' : ''}</td><td class="n">${p.kind === 'annular' ? '—' : `${fmt(p.size.len, 'big', job, false)} × ${fmt(p.size.wid, 'big', job)}${p.resized ? ' <sup>m</sup>' : ''}`}</td><td>${p.kind === 'annular' ? '—' : orientName(p.size.orient)}</td><td class="n">${t(o.tNom ?? (p.kind === 'annular' ? T.tAnnular ?? T.tBottom : T.tBottom))}</td><td class="n">${t(o.utMin)}</td><td>${o.scan === 'not' ? 'Not scanned' : o.scan === 'partial' ? 'Partial' : 'Scanned'}</td><td>${h(datumName(p))}</td><td class="n">${nI || ''}</td><td>${h(o.notes)}</td></tr>`;
  }).join('')}</tbody></table><p class="note"><sup>m</sup> measured size entered for that plate; others use the standard plate size.</p></section>`;

  // ---- report improvements R1: numbered chapters in the chosen order, inside the report frame
  const SI = { company, client: I.client, site: I.site, tankId: I.tankId, reportNo: I.reportNo, rev: job.rev ? 'Rev ' + job.rev : 'Draft', revDate: job.savedAt ? new Date(job.savedAt).toISOString().slice(0, 10) : '', status: job.status?.stage === 'complete' ? 'ISSUED' : 'DRAFT', drawnBy: personName(job, 'insp653') || job.status?.inspector, checkedBy: job.status?.reviewer };
  const N = numbering(), LY = layoutOf(opts), drawCls = LY.drawOrient === 'portrait' ? 'port' : 'land', drawBig = drawCls + (LY.drawPaper === 'tabloid' ? ' lg' : ''); // floor, shell and roof drawings may go on 11 × 17

    const fp = floorParts({ job, layout, calc, N, opts, patches });
    // R4: parts a chapter moves to an appendix are registered here while the chapter is built, and printed by the
    // appendix (chapters are built before appendices, so the appendix numbers its own tables)
    const later = {};
    const defer = (key, fn) => { (later[key] = later[key] || []).push(fn); return ''; };
    const app = (key) => () => (later[key] || []).map((fn) => fn()).join('');
    const floorCh = () => (inScope(job, 'floor') ? `<section>
    ${N.sub('Floor summary')}
    <div class="kpis">
      <div><b>${inds.length}</b><span>MFL indications</span></div>
      <div><b>${cnt('ps')}</b><span>Product side</span></div>
      <div><b>${cnt('ss')}</b><span>Soil side</span></div>
      <div><b>${cnt('both')}</b><span>Both sides</span></div>
      <div><b>${cnt('nri') + cnt('other')}</b><span>No indication / other</span></div>
      <div><b>${cnt('pending')}</b><span>Pending</span></div>
      <div><b>${rems.length ? t(Math.min(...rems)) : '—'}</b><span>Min. remaining</span></div>
      <div><b>${losses.length ? Math.max(...losses).toFixed(0) + '%' : '—'}</b><span>Max. wall loss</span></div>
      <div><b>${repairs.length}</b><span>Repairs</span></div>
      <div><b>${pct(aTot - aNot - aPart)}</b><span>Floor area fully scanned</span></div>
    </div>
    <p class="verdict ${allOk ? 'ok' : 'bad'}"><span class="vk">Calculated result${vm('C')}</span>${allOk
      ? `With the ${repairs.length} repair${repairs.length === 1 ? '' : 's'} listed, the floor meets the API 653 minimum remaining thickness for a ${calc.Or}-year interval to the next internal inspection.`
      : `The floor does <b>not</b> meet the API 653 minimum remaining thickness for a ${calc.Or}-year interval. See the calculation and indication list.`}</p>
    ${calc.warnings.length ? `<ul class="warn">${calc.warnings.map((w) => `<li>${h(w)}</li>`).join('')}</ul>` : ''}
    ${(aNot || aPart) ? `<p class="note">Areas not scanned: ${pct(aNot)} of floor area; partially scanned: ${pct(aPart)}. These are hatched on the floor map.</p>` : ''}
    ${fp.mfl()}
  </section>

  <section class="pb-avoid">
    ${N.sub('API 653 bottom minimum remaining thickness')}
    <p class="formula">MRT = min(RT<sub>bc</sub>, RT<sub>ip</sub>) − O<sub>r</sub> × (StP<sub>r</sub> + UP<sub>r</sub>)</p>
    ${kv([['O<sub>r</sub> — years to next internal inspection', calc.Or + ' yr' + (C.rbi ? ' (RBI, §6.4.2.2.2)' : '')], ['Tank age — UP<sub>r</sub> basis', calc.years ? calc.years + ' yr' : '—'],
      ...(calc.stYears !== calc.years ? [['StP<sub>r</sub> basis', calc.stYears ? calc.stYears + ' yr' : '—']] : []),
      ['StP<sub>r</sub> — product side rate', fmtRate(calc.StPr, job) + (C.coated && !calc.stSrc ? ` (coated, = 0${C.coatConfirmed ? ', coating basis confirmed by the engineer' : ''})` : '') + (calc.stSrc && calc.stSrc !== 'override' ? ` — from ${h(calc.stSrc.no)}` : calc.stSrc === 'override' ? ' (entered)' : '')],
      ['UP<sub>r</sub> — soil side rate', fmtRate(calc.UPr, job) + (C.cp ? ' (effective CP, = 0)' : '') + (calc.upSrc === 'threshold' ? ` — MFL threshold ${h(C.mflThresholdPct)} % of nominal (§4.4.5.1 Note 1)` : calc.upSrc && calc.upSrc !== 'override' ? ` — from ${h(calc.upSrc.no)}` : calc.upSrc === 'override' ? ' (entered)' : '')],
      ['Critical zone', `within ${fmt(C.czDist, 'small', job)} of shell, limit ${t(calc.czLim)} (${C.czLimit != null ? 'entered' + (C.czLimitReason ? ': ' + h(C.czLimitReason) : '') : '§4.4.5.4'})`],
      ...(layout.Ri < layout.R ? [['Annular plate limit', `${t(calc.mAnn)} (${h(calc.ann.src)})`]] : []),
      ...(calc.projection ? [['Bottom projection beyond the shell (§4.4.5.7)', `${t(calc.projection.t)} thick, ${fmt(calc.projection.w, 'small', job)} wide — ${calc.projection.ok === true ? 'meets' : calc.projection.ok === false ? '<b>does not meet</b>' : 'incomplete'}`]] : [])])}
    ${N.table('API 653 bottom evaluation by area')}<table class="grid"><thead><tr><th>Area</th><th>RT<sub>ip</sub></th><th>RT<sub>bc</sub></th><th>MRT at O<sub>r</sub></th><th>Min. allowed</th><th>t required today</th><th>Max. O<sub>r</sub></th><th>Result</th></tr></thead><tbody>${regionRows}</tbody></table>
    <p class="note">Rates are linear: wall loss of each proven-up location divided by the tank age (StP<sub>r</sub>: the StP<sub>r</sub> basis if entered). Locations with a welded repair are excluded from RT (§4.4.5.5); repaired soil-side locations keep their rate in UP<sub>r</sub> unless the cause of corrosion was removed (§4.4.5.1 Note 1); non-welded repairs stay in the evaluation (§4.4.5.6). "t required today" is the thickness a remaining location needs now to stay above the minimum for O<sub>r</sub> years. Thickness values in ${U.small}.</p>
  </section>
  <section>${fp.corr()}</section>

  ${sheetHTML(N, SI, { cls: drawBig, section: 'Floor map', figure: 'Floor plan — plates, MFL indications, repairs, patch plates and datum corners', view: 'Floor plan — viewed from above', scale: 'As shown by the scale bar',
    drawing: map, wrap: 'map-wrap',
    data: [['Diameter', fmt(T.diameter, 'big', job)], ['Bottom type', h(T.bottomType)], ['Bottom nominal t', t(T.tBottom)], ['Annular nominal t', job.layout?.annular ? t(T.tAnnular) : 'No annular ring'], ['Standard plate', job.layout?.plateL && job.layout?.plateW ? `${fmt(+job.layout.plateL, 'big', job, false)} × ${fmt(+job.layout.plateW, 'big', job)}` : ''], ['Plates', String(layout.plates.length)], ['MFL indications', String(inds.length)], ['Repairs / patch plates', `${repairs.length} / ${patches.length}`], ['Floor area fully scanned', pct(aTot - aNot - aPart)]],
    legend: legendHTML(),
    notes: [`Plate offsets X/Y are measured from each plate's datum corner, marked with a small triangle in that corner. Unless listed in the plate register, the datum is the plate's ${refCornerName(job.layout?.refCorner || 'BL')} corner${layout.Ri < layout.R ? '; on annular plates X runs along the shell from the datum seam and Y is measured in from the shell' : ''}.${(() => { const own = layout.plates.filter((p) => p.datum?.own || p.datumOwn); return own.length ? ` Plates measured from a different corner: ${own.map((p) => `${h(p.label)} (${h(datumName(p))})`).join(', ')}.` : ''; })()} 0° ${h(I.zeroRef || '')}.`, `Dimensions in ${U.small}; angles clockwise from 0° ${h(I.zeroRef || '')}.`, 'Indications are numbered as in the indication table; patch plates as in the patch plate table.'] })}
${fp.prove()}
  ${inScope(job, 'floor') && (repairs.length || below.length) ? `<section class="pb-avoid">${N.sub('Repairs')}${N.table('Repairs')}<table class="grid small"><thead><tr><th>No.</th><th>Plate</th><th>X</th><th>Y</th><th>Side</th><th>Remaining</th>${showSize ? '<th>Indication (L × W)</th>' : ''}<th>Method</th><th>Repair / patch (L × W × t)</th><th>Basis</th></tr></thead><tbody>${[...repairs, ...below].map((i) => { const a = per.get(i.id); return `<tr><td>${h(i.no)}</td><td>${h(a.plate?.label)}</td><td class="n">${fmt(i.x, 'small', job, false)}</td><td class="n">${fmt(i.y, 'small', job, false)}</td><td>${RESULT_SHORT[i.result]}</td><td class="n">${t(a.rem)}</td>${showSize ? `<td class="n">${i.len || i.wid ? `${fmt(i.len, 'small', job, false)} × ${fmt(i.wid, 'small', job, false)}` : '—'}</td>` : ''}<td>${h(i.repairMethod || '')}</td><td class="n">${(() => { const pp = patchOf(patches, i.id); if (pp) return `<b>${h(pp.id)}</b> ${fmt(pp.L, 'small', job, false)} × ${fmt(pp.W, 'small', job, false)}${pp.t ?? i.repT ? ' × ' + fmt(pp.t ?? i.repT, 't', job, false) : ''}${pp.auto ? ' <small>auto</small>' : ''}`; return i.repLen || i.repWid ? `${fmt(i.repLen, 'small', job, false)} × ${fmt(i.repWid, 'small', job, false)}${i.repT ? ' × ' + fmt(i.repT, 't', job, false) : ''}${i.repId ? `<br><small>${h(i.repId)}</small>` : ''}` : '—'; })()}</td><td>${a.status === 'below MRT' ? '<b>Below MRT – repair declined</b>' : a.auto ? 'Below MRT at O<sub>r</sub>' : 'Specified'}</td></tr>`; }).join('')}</tbody></table>${patches.length ? `${N.table('Patch plates')}<table class="grid small"><thead><tr><th>Patch</th><th>Shape</th><th class="n">Size (L × W)</th><th class="n">t</th><th>Covers indications</th><th>Plate(s)</th><th>Critical zone (§9.11.1.2)</th><th>Notes</th></tr></thead><tbody>${patches.map((pp) => `<tr class="${pp.status === 'Fails' ? 'is-bad' : ''}"><td><b>${h(pp.id)}</b></td><td>${pp.kind === 'tomb' ? `Tombstone at ${pp.th.toFixed(0)}°` : 'Rectangular'}</td><td class="n">${fmt(pp.L, 'small', job, false)} × ${fmt(pp.W, 'small', job, false)}</td><td class="n">${fmt(pp.t, 't', job, false)}${pp.tAssumed ? '*' : ''}</td><td>${pp.inds.map((x) => h(x.no)).join(', ')}</td><td>${[...new Set(pp.inds.map((x) => per.get(x.id)?.plate?.label).filter(Boolean))].map(h).join(', ')}</td><td>${pp.checks.length ? `<b>${pp.status}</b>` : '—'}</td><td>${pp.auto ? 'Auto size' : 'Size entered'}${pp.inds.length > 1 ? '; combined' : ''}</td></tr>`).join('')}</tbody></table>
${patches.some((pp) => pp.checks.length) ? `${N.table('Critical zone patch plates — API 653 §9.11.1.2')}<table class="grid small"><thead><tr><th>Patch</th><th>Requirement</th><th>Result</th><th>Note</th></tr></thead><tbody>${patches.filter((pp) => pp.checks.length).map((pp) => pp.checks.map((k, i) => `<tr class="${k.ok === false ? 'is-bad' : ''}"><td>${i ? '' : `<b>${h(pp.id)}</b>`}</td><td>${h(k.item)}</td><td>${k.ok === true ? 'OK' : k.ok === false ? '<b>Fails</b>' : 'Verify'}</td><td>${h(k.note)}</td></tr>`).join('')).join('')}</tbody></table>` : ''}<p class="note">Tombstone patches (within 6 in of the shell) are turned so their sides run radially and meet the shell-to-bottom joint at 90°, and extend to the shell; L is measured radially from the shell, W along the shell. Lap-welded patch plates centred on the repair indications: default ${fmt(+(job.calc?.patchL ?? 304.8), 'small', job)} × ${fmt(+(job.calc?.patchW ?? 304.8), 'small', job)}, larger where needed to extend at least ${fmt(+(job.calc?.patchMargin ?? 25.4), 'small', job)} past the corrosion; overlapping patches combined. Shown on the floor map. * default patch thickness (no thickness entered). Check patch size, spacing and weld details against API 653 9.10.</p>` : ''}${fp.status()}</section>` : ''}` : '');
    const nozCh = () => {
      if (!(inScope(job, 'nozzles') && (job.nozzles || []).length)) return '';
      const list = job.nozzles.slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0));
      const sched = `${N.table('Shell nozzle schedule')}<table class="grid small wrap"><thead><tr><th>Mark</th><th>Type</th><th>Connection</th><th>Service</th><th class="n">Angle</th><th class="n">Size</th><th class="n">Elev.</th><th>Sched.</th></tr></thead><tbody>${list.map((n) => `<tr><td><b>${h(n.mark)}</b></td><td>${h(n.type)}</td><td>${h(NZ_CONN_SHORT[n.conn] || '')}</td><td>${h(n.service)}${n.notes ? `<br><small>${h(n.notes)}</small>` : ''}</td><td class="n">${n.angle != null && n.angle !== '' ? (+n.angle).toFixed(1) + '°' : '—'}</td><td class="n">${fmt(n.size, 'small', job, false)}</td><td class="n">${fmt(n.elev, 'small', job, false)}</td><td>${h(n.sched)}</td></tr>`).join('')}</tbody></table>`;
      const ut = `${N.table('Nozzle neck UT and evaluation')}<table class="grid small wrap nzut"><thead><tr><th>Mark</th><th class="n">Nom.</th><th class="n">t-min / constr. min.</th>${UT_CLOCK.map(([, l]) => `<th class="n">${l}:00${vm('M')}</th>`).join('')}<th>Other readings${vm('M')}</th><th class="n">Min</th><th class="n">Loss${vm('C')}</th><th>Status${vm('C')}</th></tr></thead><tbody>${list.map((n) => { const r = nozzleUT(n, job), w = nozzleWall(n, job), extra = (n.utx || []).filter((x) => x.t != null);
        return `<tr data-noz="${h(n.id)}" class="${r.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${h(n.mark)}</b></td><td class="n">${fmt(w.tNom, 't', job, false)}${w.nomTbl ? '<sup>T</sup>' : ''}</td><td class="n">${fmt(w.tMin, 't', job, false)}${w.minTbl ? '<sup>T</sup>' : ''}</td>${UT_CLOCK.map(([k]) => `<td class="n">${fmt(n[k], 't', job, false)}</td>`).join('')}<td>${extra.length ? extra.map((x) => `${h(x.loc || 'other')}: ${fmt(x.t, 't', job, false)}`).join('; ') : '—'}</td><td class="n" data-c="min"><b>${r.count ? fmt(r.min, 't', job, false) : '—'}</b></td><td class="n" data-c="loss">${r.lossPct != null ? r.lossPct.toFixed(0) + '%' : '—'}</td><td data-c="status">${r.status === 'Below t-min' ? '<b>Below t-min</b>' : h(r.status)}</td></tr>`; }).join('')}</tbody></table>`;
      return `<section class="pb-avoid">${N.sub('Nozzle schedule')}${sched}${N.sub('Neck UT and evaluation')}${ut}<p class="note">Angles clockwise from 0° ${h(I.zeroRef || '')}; elevation to centreline above the bottom. Sizes and thicknesses in ${U.small}. Neck UT at clock positions looking at the nozzle from outside the tank; other readings in their own column. <sup>T</sup> nominal / minimum not entered — taken from the nozzle neck table for the construction code (API 650 Tables 5.6b / 5.7b: XS or STD pipe; NPS 26 and over by shell thickness). The tabulated minimum is a construction minimum (nominal less 12.5 % mill tolerance), not a retirement thickness: a neck is accepted only against an engineer-entered retirement thickness.</p></section>`;
    };
    const shellCh = () => ((() => {
    const cs = courseSummary(job); if (!cs.length || !inScope(job, 'shell')) return '';
    const locs = utLocations(job), top = cs.slice().reverse(), sh = job.shell || {}, courses = coursesWithElev(job), zs = readingElevations(job);
    const csm = new Map(cs.map((c) => [c.id, c]));
    let cur = null; const rows = [];
    for (const z of zs) {
      const c = courseAt(courses, z);
      if (c && c.id !== cur) { cur = c.id; const s = csm.get(c.id); rows.push(`<tr class="crow"><td colspan="${locs.length + 2}"><b>Course ${c.no}</b> · nominal ${fmt(c.tNom, 't', job)} · t-min ${fmt(c.tMin, 't', job)} · min reading <b>${s.min != null ? fmt(s.min, 't', job) : '—'}</b>${s.status === 'Below t-min' ? ' · <b>Below t-min</b>' : ''}</td></tr>`); }
      const vals = locs.map((l) => getReading(job, l.key, z));
      const got = vals.filter((v) => v !== null);
      if (!got.length) continue;
      rows.push(`<tr><td>${fmtElev(z, job)}</td>${vals.map((v) => `<td class="n">${v === null ? '—' : c?.tMin > 0 && v < c.tMin - 1e-9 ? '<b class="bad">' + fmt(v, 't', job, false) + '</b>' : fmt(v, 't', job, false)}</td>`).join('')}<td class="n">${fmt(Math.min(...got), 't', job, false)}</td></tr>`);
    }
    const zsNote = (sh.zones || []).filter((zn) => +zn.step > 0).map((zn) => `every ${fmt(+zn.step, 'small', job)} from ${fmtElev(+zn.start || 0, job)} to ${zn.end != null && zn.end !== '' ? fmtElev(+zn.end, job) : 'the top'}`).join('; ');
    return `<section>${N.sub('Shell UT summary')}
      <p class="note">${locs.length} UT stations equally spaced from ${(+sh.start || 0).toFixed(1)}°${+sh.nLoc > 0 ? '' : ' (standard: one per 32 ft of circumference, minimum 4, maximum 8)'}. Readings at each station ${zsNote || 'at the elevations listed'}; every reading is listed in the appendix "Shell UT readings". Thickness in ${U.small}.</p>
      ${N.table('Shell courses — UT summary')}<table class="grid small"><thead><tr><th>Course</th><th class="n">Height</th><th class="n">Plates</th><th class="n">Nominal</th><th class="n">t-min</th><th class="n">Readings</th><th class="n">Min${vm('M')}</th><th class="n">Loss${vm('C')}</th><th>Status${vm('C')}</th></tr></thead><tbody>
      ${top.map((c) => `<tr class="${c.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${c.no}</b></td><td class="n">${fmt(c.h, 'big', job, false)}</td><td class="n">${coursePlates(job, c, c.no - 1).n}</td><td class="n">${fmt(c.tNom, 't', job, false)}</td><td class="n">${fmt(c.tMin, 't', job, false)}</td><td class="n">${c.count}</td><td class="n"><b>${c.min != null ? fmt(c.min, 't', job, false) : '—'}</b></td><td class="n">${c.lossPct != null ? c.lossPct.toFixed(0) + '%' : '—'}</td><td>${c.status === 'Below t-min' ? '<b>Below t-min</b>' : h(c.status)}</td></tr>`).join('')}
      </tbody></table>
      ${(() => { const B = designBasis(job); if (!courses.some((c) => c.tMinCalc)) return ''; const csm = new Map(cs.map((x) => [x.id, x])); let pm = null, hm = null;
        const ev = courses.slice().reverse().map((c) => { const s2 = csm.get(c.id), f = s2?.min != null ? fillFromT(job, c.d, s2.min) : {}; if (f.prod != null && (!pm || f.prod < pm.v)) pm = { v: f.prod, c: c.no }; if (f.hydro != null && (!hm || f.hydro < hm.v)) hm = { v: f.hydro, c: c.no }; return { c, s2, f }; });
        const summary = `${N.table('Shell evaluation summary — API 653 §4.3.3')}<table class="grid small wrap shev"><thead><tr><th>Course</th><th class="n">Nominal</th><th class="n">t-min used</th><th class="n">Min reading${vm('M')}</th><th class="n">Max product fill (${U.big})${vm('C')}</th><th class="n">Hydrotest Ht (${U.big})${vm('C')}</th><th>Status${vm('C')}</th></tr></thead><tbody>${ev.map(({ c, s2, f }) => `<tr data-course="${h(c.id)}" class="${s2?.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${c.no}</b></td><td class="n">${fmt(c.tNom, 't', job, false)}</td><td class="n" data-c="tmin">${fmt(c.tMin, 't', job, false)}${c.tMinSet ? ' (entered)' : vm('C')}</td><td class="n" data-c="min">${s2?.min != null ? fmt(s2.min, 't', job, false) : '—'}</td><td class="n" data-c="prod">${f.prod != null ? fmt(f.prod, 'big', job, false) : '—'}</td><td class="n" data-c="hydro">${f.hydro != null ? fmt(f.hydro, 'big', job, false) : '—'}</td><td>${s2?.status === 'Below t-min' ? '<b>Below t-min</b>' : h(s2?.status || '—')}</td></tr>`).join('')}</tbody></table>
        <p class="note">${pm ? `Maximum product fill height supported by the minimum readings: <b>${fmt(pm.v, 'big', job)}</b> (course ${pm.c}). ` : ''}t-min from API 653 §4.3.3.1 with D = ${fmt(B.D, 'big', job)}, G = ${B.G}, fill height ${fmt(B.fill, 'big', job)}; the material, joint efficiency, stresses and liquid heads for each course are in the appendix "Shell evaluation — working".</p>`;
        const rr = ev.map(({ c, s2, f }) => { const d = c.d;
          return `<tr class="${s2?.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${c.no}</b></td><td>${h(d.matl)}</td><td>${h(jointLabel(d.jKey))}</td><td class="n">${d.Ej}</td><td class="n">${Math.round(d.Y).toLocaleString()}</td><td class="n">${Math.round(d.Sd).toLocaleString()}</td><td class="n">${Math.round(d.St).toLocaleString()}</td><td class="n">${fmt(Math.max(0, B.fill - c.z0), 'big', job, false)}</td><td class="n">${fmt(c.tMinCalc, 't', job, false)}</td><td class="n"><b>${fmt(c.tMin, 't', job, false)}</b>${c.tMinSet ? '<sup>†</sup>' : ''}</td><td class="n">${s2?.min != null ? fmt(s2.min, 't', job, false) : '—'}</td><td class="n">${f.prod != null ? fmt(f.prod, 'big', job, false) : '—'}</td><td class="n">${f.hydro != null ? fmt(f.hydro, 'big', job, false) : '—'}</td></tr>`; }).join('');
        const working = () => `${N.table('Shell evaluation — API 653 §4.3.3')}<table class="grid small"><thead><tr><th>Course</th><th>Material</th><th>Joint</th><th class="n">E</th><th class="n">Y (psi)</th><th class="n">Sd (psi)</th><th class="n">St (psi)</th><th class="n">Liquid above (${U.big})</th><th class="n">t-min calc</th><th class="n">t-min used</th><th class="n">Min reading</th><th class="n">Max fill (${U.big})</th><th class="n">Hydrotest Ht (${U.big})</th></tr></thead><tbody>${rr}</tbody></table>
        <p class="note">t-min = 2.6 (H − 1) D G / (S E), not less than 0.100 in (SI form for metric jobs) (API 653 §4.3.3.1 a); single readings compared with the t-min at their elevation (§4.3.3.1 b) and evaluated per §4.3.2 when below it, D = ${fmt(B.D, 'big', job)}, G = ${B.G}, maximum fill height ${fmt(B.fill, 'big', job)}; S from API 653 Table 4.1 (lower two courses / upper courses), E from Table 4.2 / 4.3 for ${h([job.tank.code, job.tank.edition].filter(Boolean).join(', ') || 'unknown code')}. <sup>†</sup> t-min entered by the inspector. ${[...new Set(courses.map((c) => c.d?.matl))].filter((m) => MAT_NOTES[m]).map((m) => h(m) + ': ' + h(MAT_NOTES[m])).join(' ')} Fill and hydrostatic test heights (Ht = St E t / (2.6 D) + 1) from each course's minimum reading, measured from the tank bottom${pm ? `: maximum product fill <b>${fmt(pm.v, 'big', job)}</b> (course ${pm.c})` : ''}${hm ? `, hydrostatic test height <b>${fmt(hm.v, 'big', job)}</b> (course ${hm.c})` : ''}.</p>`;
        return summary + defer('shelleval', () => `<section>${working()}</section>`); })()}
      </section>
    ${sheetHTML(N, SI, { cls: drawBig, section: 'Shell roll-out', figure: 'Shell roll-out — courses, plates, UT stations and nozzles, viewed from outside', view: 'Shell roll-out — viewed from outside', scale: 'To scale, as dimensioned',
      drawing: rolloutSVG(job, { print: true }), wrap: 'ro-print',
      data: [['Diameter', fmt(T.diameter, 'big', job)], ['Circumference', fmt(Math.PI * (+T.diameter || 0), 'big', job)], ['Courses', String(cs.length)], ['UT stations', `${locs.length}, first at ${(+sh.start || 0).toFixed(1)}°`], ['Construction code', h([T.code, T.edition].filter(Boolean).join(', '))]],
      notes: ['The shell is unrolled from 0° to 360° clockwise and viewed from outside; course 1 is at the bottom.', 'Plates are numbered in circles in each course; plates crossing 0° / 360° are drawn at both ends.', 'UT station lines are marked at the top with their angle; arc lengths between stations are dimensioned along the top, course heights on the right and the circumference along the bottom.', 'Shell nozzles are shown at their angle and elevation (manways as double circles).', `Dimensions in ${U.big} and ${U.small}.`] })}
    ${defer('shellrd', () => `<section>
      ${N.table('Shell UT readings by elevation and station')}<table class="grid small readings-rp"><thead><tr><th>Elevation</th>${locs.map((l) => `<th class="n">${l.label}<br>${l.angle.toFixed(0)}°</th>`).join('')}<th class="n">Min</th></tr></thead><tbody>${rows.join('') || `<tr><td colspan="${locs.length + 2}">No readings recorded.</td></tr>`}</tbody></table>
      <p class="note">Elevation above the bottom of the shell. Readings below the course t-min in bold. Thickness in ${U.small}.</p></section>`)}`;
  })());
    const roofCh = () => ((() => {
    if (!job.roof || job.roof.type === 'none' || (!inScope(job, 'froof') && !inScope(job, 'flroof'))) return '';
    const out = [`<section>${N.sub('Roof')}<p><b>${h((ROOF_TYPES.find(([k]) => k === job.roof.type) || [])[1] || '')}</b></p>`];
    if (hasFixed(job) && inScope(job, 'froof')) {
      const Fx = job.roof.fixed, pts = Fx.pts || [];
      const vals = pts.map((p) => pointStatus(job, p)).filter((x) => x.t !== null);
      out.push(`<h3 class="rp-h3">Fixed roof</h3><div class="cols">${kv([['Roof', h(Fx.kind)], ['Support', h(Fx.support)], ['Slope / radius', h(Fx.slope)]])}${kv([['Nominal plate t', t(Fx.tNom)], ['t-min', t(Fx.tMin)], ['Minimum reading', vals.length ? t(Math.min(...vals.map((x) => x.t))) : '—']])}</div>
        ${Fx.notes ? `<p class="note">${h(Fx.notes)}</p>` : ''}
        ${(() => { const st = pts.map((pt) => [pt, pointStatus(job, pt)]), low = st.filter(([, x]) => roofBad(x.status)), read = st.filter(([, x]) => x.t !== null);
          return low.length ? `${N.table('Fixed roof — UT points below t-min')}<table class="grid small wrap"><thead><tr><th>Point</th><th class="n">Angle</th><th class="n">From centre</th><th class="n">Reading${vm('M')}</th><th class="n">t-min</th><th class="n">Loss${vm('C')}</th><th>Status${vm('C')}</th></tr></thead><tbody>${low.map(([pt, x]) => `<tr class="is-bad"><td><b>${h(pt.label)}</b></td><td class="n">${pt.angle != null ? (+pt.angle).toFixed(1) + '°' : '—'}</td><td class="n">${fmt(pt.r, 'big', job)}</td><td class="n">${fmt(pt.t, 't', job, false)}</td><td class="n">${fmt(Fx.tMin, 't', job, false)}</td><td class="n">${x.lossPct != null ? x.lossPct.toFixed(0) + '%' : '—'}</td><td><b>${h(x.status)}</b></td></tr>`).join('')}</tbody></table><p class="note">${read.length} of ${pts.length} points read; ${low.length} below t-min. Every reading is listed in the appendix "Roof UT readings and rim seal gaps".</p>`
            : `<p class="note">${read.length} of ${pts.length} points read${read.length ? `; all at or above t-min (minimum ${t(Math.min(...read.map(([, x]) => x.t)))})` : ''}. Every reading is listed in the appendix "Roof UT readings and rim seal gaps".</p>`; })()}
        ${sheetHTML(N, SI, { cls: drawBig, figure: 'Fixed roof plan — UT points and shell UT station lines', view: 'Fixed roof plan — viewed from above', scale: 'Not to scale',
          drawing: fixedSVG(job, { stations: utLocations(job), fmtT: (v) => fmt(v, 't', job, false) }), wrap: 'roof-print',
          data: [['Roof', h(Fx.kind)], ['Support', h(Fx.support)], ['Slope / radius', h(Fx.slope)], ['Nominal plate t', t(Fx.tNom)], ['t-min', t(Fx.tMin)], ['UT points', String(pts.length)], ['Minimum reading', vals.length ? t(Math.min(...vals.map((x) => x.t))) : '—']],
          legend: legendList([[swatch.dot('#0f766e'), 'UT point, reading at or above t-min'], [swatch.dot('#b91c1c'), 'UT point below t-min'], [swatch.dot('#fff', '#5b6470'), 'UT point not read'], [swatch.line('#0f766e', '4 2'), 'Shell UT station line'], [swatch.dot('#3a434e'), 'Roof support column']]),
          notes: [`Thickness in ${U.small}; each point shows its label and reading.`, `Points are located by angle (clockwise from 0° ${h(I.zeroRef || '')}) and distance from the centre.`, ...(Fx.notes ? [h(Fx.notes)] : [])] })}
        ${defer('roofrd', () => `<section>${N.table('Fixed roof UT readings')}<table class="grid small"><thead><tr><th>Point</th><th class="n">Angle</th><th class="n">From centre</th><th class="n">Reading</th><th class="n">Loss</th><th>Status</th></tr></thead><tbody>
        ${pts.map((pt) => { const st = pointStatus(job, pt); return `<tr class="${roofBad(st.status) ? 'is-bad' : ''}"><td><b>${h(pt.label)}</b></td><td class="n">${pt.angle != null ? (+pt.angle).toFixed(1) + '°' : '—'}</td><td class="n">${fmt(pt.r, 'big', job)}</td><td class="n">${fmt(pt.t, 't', job, false)}</td><td class="n">${st.lossPct != null ? st.lossPct.toFixed(0) + '%' : '—'}</td><td>${st.status === 'Below t-min' ? '<b>Below t-min</b>' : h(st.status)}</td></tr>`; }).join('') || '<tr><td colspan="6">No readings.</td></tr>'}
        </tbody></table><p class="note">Thickness in ${U.small}. Angles clockwise from 0° ${h(I.zeroRef || '')}.</p></section>`)}`);
    }
    if (hasFloating(job) && inScope(job, 'flroof')) {
      const F = job.roof.floating, lay = floatingLayout(job);
      const all = lay.plates.filter((p) => p.kind !== 'annular').map((p) => ({ p, s: plateUT(job, p) })), pons = lay.plates.filter((p) => p.kind === 'annular');
      const vals = all.filter((x) => x.s.min !== null);
      out.push(`${hasFixed(job) && inScope(job, 'froof') ? '</section><section class="pb">' : ''}<h3 class="rp-h3">${job.roof.type === 'fixed-ifr' ? 'Internal' : 'External'} floating roof</h3>
        <div class="cols">${kv([['Roof', h(F.kind)], ['Roof diameter', fmt(roofDiameter(job), 'big', job)], ['Rim gap', fmt(F.rimGap, 'small', job)], ['Pontoons', `${lay.nPont} × ${fmt(F.pontW, 'big', job)} wide`]])}${kv([['Deck plates', `${lay.plates.filter((p) => p.kind !== 'annular').length} (${fmt(F.plateW, 'big', job, false)} × ${fmt(F.plateL, 'big', job)})`], ['Deck nominal / t-min', `${t(F.deckNom)} / ${t(F.deckMin)}`], ['Pontoons with liquid / leaking', String(pons.filter((p) => ['Liquid present', 'Leaking'].includes(F.pont?.[p.key]?.cond)).length)], ['Minimum reading', vals.length ? t(Math.min(...vals.map((x) => x.s.min))) : '—']])}</div>
        ${F.notes ? `<p class="note">${h(F.notes)}</p>` : ''}
        ${(() => { const low = all.filter(({ s }) => roofBad(s.status)), read = all.filter(({ s }) => s.min !== null);
          return (low.length ? `${N.table('Floating roof — deck plates below t-min')}<table class="grid small wrap"><thead><tr><th>Plate</th><th class="n">Min reading${vm('M')}</th><th class="n">t-min</th><th class="n">Loss${vm('C')}</th><th>Status${vm('C')}</th></tr></thead><tbody>${low.map(({ p, s }) => `<tr class="is-bad"><td><b>${h(p.label)}</b></td><td class="n">${fmt(s.min, 't', job, false)}</td><td class="n">${fmt(s.tMin, 't', job, false)}</td><td class="n">${s.lossPct != null ? s.lossPct.toFixed(0) + '%' : '—'}</td><td><b>${h(s.status)}</b></td></tr>`).join('')}</tbody></table>` : '')
            + `<p class="note">${read.length} of ${all.length} deck plates read (5 readings each)${low.length ? `; ${low.length} with a reading below t-min` : read.length ? `; all at or above t-min (minimum ${t(Math.min(...read.map(({ s }) => s.min)))})` : ''}. Every reading is listed in the appendix "Roof UT readings and rim seal gaps".</p>`; })()}
        ${sheetHTML(N, SI, { cls: drawBig, figure: 'Floating roof plan — deck plates, pontoons and UT readings', view: 'Floating roof plan — viewed from above', scale: 'Not to scale',
          drawing: floatingSVG(job, lay), wrap: 'roof-print',
          data: [['Roof', h(F.kind)], ['Roof diameter', fmt(roofDiameter(job), 'big', job)], ['Rim gap', fmt(F.rimGap, 'small', job)], ['Pontoons', `${lay.nPont} × ${fmt(F.pontW, 'big', job)} wide`], ['Deck plates', String(lay.plates.filter((p) => p.kind !== 'annular').length)], ['Deck nominal / t-min', `${t(F.deckNom)} / ${t(F.deckMin)}`], ['Minimum reading', vals.length ? t(Math.min(...vals.map((x) => x.s.min))) : '—']],
          legend: legendList([[swatch.dot('#0f766e'), 'Deck reading at or above t-min'], [swatch.dot('#b91c1c'), 'Deck reading below t-min'], [swatch.dot('#fff', '#5b6470'), 'Not read'], [swatch.box('#e9ecf0', '#6b7480'), 'Pontoon with liquid present or leaking (shaded)']]),
          notes: ['Each deck plate has 5 UT readings (four corners and centre): ● OK ● below t-min ○ not read. Shaded pontoons have liquid present or are leaking.', `Thickness in ${U.small}.`, ...(F.notes ? [h(F.notes)] : [])] })}</section>
        <section>
        ${defer('roofrd', () => `<section>        ${N.table('Floating roof deck UT readings')}<table class="grid small"><thead><tr><th>Plate</th>${PT5.map(([k]) => `<th class="n">${PT5_SHORT[k]}</th>`).join('')}<th class="n">Min</th><th class="n">Loss</th><th>Status</th></tr></thead><tbody>
        ${all.map(({ p, s }) => { const m = F.ut?.[p.key] || {}; return `<tr class="${roofBad(s.status) ? 'is-bad' : ''}"><td><b>${h(p.label)}</b>${p.cut ? ' <small>cut</small>' : ''}</td>${PT5.map(([k]) => { const v = m[k]; return `<td class="n">${v == null ? '—' : s.tMin && v < s.tMin - 1e-9 ? '<b class="bad">' + fmt(v, 't', job, false) + '</b>' : fmt(v, 't', job, false)}</td>`; }).join('')}<td class="n"><b>${s.min != null ? fmt(s.min, 't', job, false) : '—'}</b></td><td class="n">${s.lossPct != null ? s.lossPct.toFixed(0) + '%' : '—'}</td><td>${s.status === 'Below t-min' ? '<b>Below t-min</b>' : h(s.status)}</td></tr>`; }).join('')}
        </tbody></table><p class="note">Thickness in ${U.small}. TL / TR / C / BL / BR = top-left, top-right, centre, bottom-left, bottom-right of each plate as drawn.</p></section>`)}
        ${pons.length ? `${N.table('Pontoon conditions')}<table class="grid small"><thead><tr><th>Pontoon</th><th>Condition${vm('O')}</th><th>Notes</th></tr></thead><tbody>${pons.map((p) => { const pc = F.pont?.[p.key] || {}; return `<tr class="${['Liquid present', 'Leaking'].includes(pc.cond) ? 'is-bad' : ''}"><td><b>${h(p.label)}</b></td><td>${h(pc.cond || '—')}</td><td>${h(pc.notes)}</td></tr>`; }).join('')}</tbody></table>` : ''}`);
    }
    if (hasFloating(job) && inScope(job, 'flroof') && job.roof.seal) {
      const seal = job.roof.seal, D = +job.tank.diameter || 0, met = job.units === 'metric';
      const ga = (v) => (v === null || v === undefined ? '—' : met ? `${v.toFixed(1)} cm²/m` : `${cm2mToIn2ft(v).toFixed(2)} in²/ft (${v.toFixed(1)} cm²/m)`);
      const gw = (cm) => (cm === null || cm === undefined ? '—' : met ? `${cm.toFixed(cm >= 5 ? 1 : 2)} cm` : `${(cm / 2.54).toFixed(cm >= 5 ? 1 : 3)} in (${cm.toFixed(cm >= 5 ? 1 : 2)} cm)`);
      const gapRows = (sd) => sd.gaps.map((g, i) => { const L = +g.len, W = +(g.wAvg ?? g.wMax), a = L > 0 && W > 0 ? (L / 10) * (W / 10) : null; return `<tr><td>${i + 1}</td><td class="n">${g.angle != null ? (+g.angle).toFixed(1) + '°' : '—'}</td><td class="n">${fmt(g.len, 'small', job, false)}</td><td class="n">${fmt(g.wMax, 'small', job, false)}</td><td class="n">${g.wAvg != null ? fmt(g.wAvg, 'small', job, false) : '—'}</td><td class="n">${a === null ? '—' : met ? a.toFixed(1) + ' cm²' : (a / 6.4516).toFixed(2) + ' in²'}</td><td>${h(g.notes)}</td></tr>`; }).join('') || `<tr><td colspan="7">${sd.noGaps ? 'No gaps found.' : 'No gaps recorded.'}</td></tr>`;
      const gapTbl = (title, sd) => `<h3 class="rp-h3">${title}: ${h(sd.type)}${sd.notes ? ' — ' + h(sd.notes) : ''}</h3><table class="grid small"><thead><tr><th>Gap</th><th class="n">Start angle</th><th class="n">Length (${U.small})</th><th class="n">Max width (${U.small})</th><th class="n">Avg width (${U.small})</th><th class="n">Area</th><th>Notes</th></tr></thead><tbody>${gapRows(sd)}</tbody></table>`;
      const res = activeStds(seal).map((k) => { const ev = sealEval(job, k), due = nextDue(job, k); return `<h3 class="rp-h3">${h(ev.L.name)} — <span class="${ev.overall === 'Compliant' ? 'ok' : ev.overall === 'Not compliant' ? 'bad' : ''}">${ev.overall}</span></h3>
        <table class="grid small"><thead><tr><th>Check</th><th class="n">Result</th><th class="n">Limit</th><th>Status</th></tr></thead><tbody>${ev.rows.map((r) => `<tr class="${r.ok === false ? 'is-bad' : ''}"><td>${h(r.item)}</td><td class="n">${r.text !== undefined ? h(r.text) : r.unit === 'cm2m' ? ga(r.value) : gw(r.value)}</td><td class="n">${r.limit === null || r.limit === undefined ? '—' : r.op + ' ' + (r.unit === 'cm2m' ? ga(r.limit) : gw(r.limit))}</td><td>${r.ok === true ? 'OK' : r.ok === false ? '<b>Fails</b>' : '—'}</td></tr>`).join('')}</tbody></table>
        <p class="note">Limits: ${h(ev.L.name)}, as built into this app; results calculated${vm('C')} from the recorded gaps and checks.</p>
        ${ev.fails ? `<p class="note"><b>Repair:</b> ${h(ev.repair)}</p>` : ''}${due.length ? `<p class="note">${due.map((d) => `${h(d.what)}: ${d.every}${d.due ? `, next due ${h(d.due.toLocaleDateString())}` : ''}`).join(' · ')}</p>` : ''}`; }).join('');
      out.push(`</section><section class="pb">${N.sub('Rim seal inspection')}
        <div class="cols">${kv([['Roof', h(job.roof.type === 'fixed-ifr' ? 'Internal floating roof' : 'External floating roof')], ['Inspection date', h(seal.date)], ['Inspected by', h(seal.inspector)]])}${kv([['Roof / liquid level', h(seal.level)], ['Tank diameter', fmt(D, 'big', job)], ['Notes', h(seal.notes)]])}</div>
        ${res || '<p class="note">No standard selected.</p>'}
        ${seal.secondary.type !== 'None' ? '' : '<p class="note">No secondary seal fitted.</p>'}<p class="note">The measured gaps (primary${seal.secondary.type !== 'None' ? ' and secondary' : ''} seal) are listed in the appendix "Roof UT readings and rim seal gaps".</p>
        ${defer('roofrd', () => `<section>${N.table('Rim seal gaps — primary' + (seal.secondary.type !== 'None' ? ' and secondary' : '') + ' seal')}${gapTbl('Primary seal', seal.primary)}${seal.secondary.type !== 'None' ? gapTbl('Secondary seal', seal.secondary) : ''}</section>`)}
        <h3 class="rp-h3">Visual inspection${vm('O')}</h3><table class="grid small"><tbody>${SEAL_CHECKS.map(([k, l]) => { const c = seal.checks?.[k] || {}; return `<tr class="${c.r === 'defect' ? 'is-bad' : ''}"><td>${h(l)}</td><td>${c.r === 'ok' ? 'OK' : c.r === 'defect' ? '<b>Defect</b>' : c.r === 'na' ? 'N/A' : '—'}</td><td>${h(c.note)}</td></tr>`; }).join('')}</tbody></table>
        <p class="note">Seal gaps found with a 1/8 in (0.32 cm) probe (Canada 0.3 cm) with the roof floating freely; gap area = length × average width (maximum width where no average was recorded); area per metre of tank diameter. Gaps are shown on the floating roof plan (primary red, secondary blue).</p>`);
    }
    out.push('</section>');
    return out.join('');
  })());
    const settleCh = () => (hasSettle(job) && inScope(job, 'settle') ? (() => {
    const st = job.settle, c = settleCalc(job), F = c.fit, met = job.units === 'metric', sU = U.small;
    const fS = (mm, sign = false) => (mm === null || mm === undefined ? '—' : (sign && mm > 0 ? '+' : '') + (met ? mm.toFixed(1) : (mm / 25.4).toFixed(2)));
    const eu = ELEV_UNITS[st.eu] || ELEV_UNITS.in, okc = (ok) => (ok === true ? 'OK' : ok === false ? '<b class="bad">Fails</b>' : '—');
    const stTxt = (s) => (s === 'Exceeds' || s === 'Not acceptable' ? `<b class="bad">${s}</b>` : s === 'Acceptable' ? `<span class="ok">${s}</span>` : `<b>${s}</b>`);
    const out = [`<section>${N.sub('Settlement — API 653 Annex B')}
      <div class="cols">${kv([['Survey date', h(st.date)], ['Surveyed by', h(st.surveyor)], ['Instrument', h(st.instrument)], ['Benchmark', h(st.benchmark)]])}${kv([['Liquid level at survey', h(st.level)], ['Stations', `${c.N} (${c.n} read) · L = ${c.L ? fmt(c.L, 'big', job) : '—'}`], ['Shell height H', c.H > 0 ? fmt(c.H, 'big', job) : '—'], ['Y / E', c.Y == null ? '—' : (met ? `${(+c.Y).toFixed(0)} / ${(+c.E).toFixed(0)} MPa` : `${Math.round(c.Y * PSI_PER_MPA).toLocaleString()} / ${Math.round(c.E * PSI_PER_MPA).toLocaleString()} psi`) + ` <small>(${h(c.Ysrc)})</small>`]])}</div>`];
    if (c.n) {
      out.push(`<h3 class="rp-h3">Shell settlement — ${stTxt(c.status)}</h3>
      <div class="rp-draw ${drawCls}"><div class="set-print"><div>${settlePlanSVG(job, c, { fmt: (v) => fS(v) })}</div><div>${settleChartSVG(job, c, { fmt: (v) => fS(v), unit: sU })}</div></div>${N.figure('Shell settlement — plan and measured points against the cosine fit')}</div>
      ${F ? `${N.table('Shell settlement results')}<table class="grid small"><thead><tr><th>Check</th><th class="n">Result${vm('C')}</th><th class="n">Limit</th><th>Status${vm('C')}</th><th>Basis</th></tr></thead><tbody>
        <tr><td>Cosine fit R²</td><td class="n">${F.R2.toFixed(3)}</td><td class="n">≥ 0.90</td><td>${c.valid ? 'Valid' : '<b class="bad">Not valid</b>'}</td><td>B.2.2.4</td></tr>
        <tr><td>Planar tilt across diameter</td><td class="n">${fS(F.tilt)} ${sU}</td><td class="n">—</td><td>—</td><td>Low side ${F.loDeg.toFixed(0)}°, slope ${slopeText(F.slope, job)}</td></tr>
        <tr class="${c.tiltOk === false ? 'is-bad' : ''}"><td>Out-of-plumbness at top of shell</td><td class="n">${fS(F.plumb)} ${sU}</td><td class="n">≤ ${fS(F.plumbLim)} ${sU}</td><td>${okc(c.tiltOk)}</td><td>Compared with API 653 §10.5.2.1 (reconstruction tolerance: 1/100 H, 5 in max); API 650 1/200 H = ${fS(F.plumb650)} ${sU} for reference</td></tr>
        <tr class="${c.oopOk === false ? 'is-bad' : ''}"><td>Max out-of-plane deflection |S|</td><td class="n">${F.maxS == null ? '—' : fS(Math.abs(F.maxS)) + ' ' + sU + ' (stn ' + F.maxAt + ')'}</td><td class="n">${c.Smax == null ? '—' : '≤ ' + fS(c.Smax) + ' ' + sU}</td><td>${okc(c.oopOk)}</td><td>B.3.2.1: Smax = 11·L²·Y / (2·E·H); Y = ${Math.round(c.Y * 145.0377).toLocaleString()} psi, E = ${(c.E * 145.0377 / 1e6).toFixed(1)} × 10⁶ psi (${h(c.Esrc || c.Ysrc || '')})${c.k > 1 ? `; subset of every ${c.k}th station, L = ${fmt(c.Lsub, 'big', job)} (B.2.2.4 NOTE)` : ''}</td></tr>
      </tbody></table>` : ''}
      ${c.warnings.length ? `<p class="note">${c.warnings.map(h).join(' ')}</p>` : ''}
      <p class="note">The station-by-station fit (cosine curve, U and S at each station)${c.arcs?.arcs?.length && (!c.valid || c.oopOk === false) ? ' and the B.3.2.2 arc method' : ''} are in the appendix "Settlement — working and readings".</p>
      ${defer('settlework', () => `<section>${N.table('Shell settlement — cosine fit, U and S by station')}<table class="grid small"><thead><tr><th>Station</th><th class="n">Angle</th><th class="n">Reading (${eu[1]})</th><th class="n">Cosine fit</th><th class="n">Measured</th><th class="n">U</th><th class="n">S</th><th>Status</th></tr></thead><tbody>
      ${c.pts.map((p) => `<tr class="${p.ok === false ? 'is-bad' : ''}"><td>${p.i}</td><td class="n">${p.angle.toFixed(1)}°</td><td class="n">${p.raw == null ? '—' : (p.raw / eu[0]).toFixed(eu[2])}</td><td class="n">${F && p.fit !== undefined ? fS(p.fit - F.a, true) : '—'}</td><td class="n">${F && p.z !== null ? fS(p.z - F.a, true) : '—'}</td><td class="n">${p.U !== undefined ? fS(p.U, true) : '—'}</td><td class="n">${p.S != null ? fS(p.S, true) : '—'}</td><td>${p.ok === false ? '<b>Exceeds</b>' : p.ok ? 'OK' : '—'}</td></tr>`).join('')}
      </tbody></table><p class="note">Fit, measured, U and S in ${sU === "in" ? "inches" : "mm"} relative to the mean plane${st.rod ? '; readings are rod readings (larger = lower)' : ''}. U = measured − optimum cosine curve; S = U − ½(U<sub>i−1</sub> + U<sub>i+1</sub>). Annex B sets no numeric planar-tilt limit; out-of-plumbness is compared with API 653 §10.5.2.1.</p>
${c.arcs?.arcs?.length && (!c.valid || c.oopOk === false) ? `<h3 class="rp-h3">B.3.2.2 arc method — for information only${c.arcs.fold ? ' (fold pattern, arcs of 50 % of the circumference)' : ''}${c.arcs.fromTilt ? ', deflection from the tilt plane' : ''}</h3><table class="grid small"><thead><tr><th>Arc (stations)</th><th class="n">Arc length</th><th class="n">Max. settlement (${sU})</th><th class="n">Allowable (${sU})</th><th>Status</th></tr></thead><tbody>${c.arcs.arcs.map((a) => `<tr class="${a.ok === false ? 'is-bad' : ''}"><td>${a.from} → ${a.to}</td><td class="n">${fmt(a.Sarc, 'big', job)}</td><td class="n">${fS(Math.abs(a.maxDef))}</td><td class="n">${a.allow != null ? fS(a.allow) : '—'}</td><td>${okc(a.ok)}</td></tr>`).join('')}</tbody></table><p class="note">Allowable = min(K · S<sub>arc</sub> · (D / H) · (Y / E), 4 in), K = ${c.arcs.K ?? 'n/a'} (${c.arcs.fixed ? 'fixed roof' : 'open top'}); settlement measured from the straight line joining the arc ends.</p>` : ''}</section>`)}`);
    }
    if (hasEP(job)) {
      const fo = (x) => { if (met) return `${Math.round(x)}`; const inch = Math.round((x / 25.4) * 100) / 100; if (inch < 12) return `${inch}"`; const ft = Math.floor(inch / 12 + 1e-9); return `${ft}'-${Math.round((inch - ft * 12) * 100) / 100}"`; };
      const sts = setStations(job), offs = epOffsets(job), P = new Map(sts.map((x) => [x.i, profileEval(job, x.i)]));
      const wl = { par: 'Lap ∥ shell', perp: 'Lap ⊥ shell', none: 'None / butt', angle: 'Lap at angle' };
      const chunks = []; for (let k = 0; k < sts.length; k += 12) chunks.push(sts.slice(k, k + 12));
      const evd = sts.map((t) => ({ t, p: P.get(t.i) })).filter((x) => x.p.n), withR = evd.filter((x) => x.p.R > 0);
      const nOf = (st2) => evd.filter((x) => x.p.status === st2).length;
      const worstE = withR.filter((x) => x.p.ev?.pct != null).sort((a, b) => b.p.ev.pct - a.p.ev.pct)[0];
      out.push(`</section><section>${N.sub('Edge settlement survey — API 653 B.2.3 / B.3.4')}
        ${N.table('Edge settlement survey — summary')}<table class="kv edge-sum"><tr><th>Stations surveyed</th><td data-c="n">${evd.length} of ${sts.length}</td></tr><tr><th>With edge settlement (breakover found)</th><td data-c="withR">${withR.length}</td></tr>
        <tr><th>Acceptable${vm('C')}</th><td data-c="ok">${nOf('Acceptable')}</td></tr><tr><th>NDE required (75 % of allowable or more)${vm('C')}</th><td data-c="nde">${nOf('NDE required')}</td></tr><tr><th>Exceeds allowable${vm('C')}</th><td data-c="exc">${nOf('Exceeds')}</td></tr>
        <tr><th>Highest B / allowable${vm('C')}</th><td data-c="worst">${worstE ? `${worstE.p.ev.pct.toFixed(0)} % at station ${worstE.t.i} (${worstE.t.angle.toFixed(1)}°)` : '—'}</td></tr></table>
        <p class="note">Per-station results (R, B, weld, Bew / Be and allowable), the profiles and the radial readings are in the appendix "Settlement — working and readings".</p>`);
      out.push(defer('settlework', () => `<section>${N.table('Edge settlement survey — results by station')}
        <table class="grid small"><thead><tr><th>Station</th><th class="n">Angle</th><th class="n">Breakover R</th><th class="n">B (${sU})</th><th>Bottom weld</th><th class="n">Bew</th><th class="n">Be</th><th class="n">Allowable</th><th class="n">B / allow</th><th>Status</th><th>Notes</th></tr></thead><tbody>
        ${sts.map((t) => { const p = P.get(t.i), o = st.ep.st?.[t.i] || {}; if (!p.n) return ''; return `<tr class="${p.status === 'Exceeds' ? 'is-bad' : ''}"><td>${t.i}</td><td class="n">${t.angle.toFixed(1)}°</td><td class="n">${p.R > 0 ? fo(p.R) + (p.auto ? '' : ' *') : '—'}</td><td class="n">${p.R > 0 ? fS(p.B) : p.status === 'No edge settlement' ? '0' : '—'}</td><td>${p.R > 0 ? wl[o.weld || 'par'] + ((o.weld || 'par') === 'angle' ? ` ${o.alpha ?? '?'}°` : '') : ''}</td><td class="n">${p.Bew != null ? fS(p.Bew) : '—'}</td><td class="n">${p.Be != null ? fS(p.Be) : '—'}</td><td class="n">${p.ev?.allow != null ? fS(p.ev.allow) : '—'}</td><td class="n">${p.ev?.pct != null ? p.ev.pct.toFixed(0) + '%' : '—'}</td><td>${stTxt(p.status)}</td><td>${h(o.notes)}</td></tr>`; }).join('')}
        </tbody></table>
        <p class="note">Readings taken radially inward from the shell at each settlement station (${offs.map(fo).join(', ')}${met ? ' mm' : ''}). The unsettled bottom is the straight line through the outer readings (allows for bottom slope, Fig. B.7); R = distance from the shell to the breakover, B = largest drop below the projected line inside R (Fig. B.6)${Object.values(st.ep.st || {}).some((o) => o.Rov != null) ? '; * breakover chosen by the inspector' : ''}. Bew / Be ${(st.curveMode || 'api') === 'api' ? 'from the tabulated API 653 Fig. B.11 / B.12 curves for this diameter (interpolated in D and R)' : `interpolated from ${h(st.curveSrc || 'Fig. B.11 / B.12 values entered by the inspector')}`} unless entered for the station. NDE required: 75 % of allowable or more — VT and MT/PT of shell-to-bottom and bottom welds in the area (B.3.4.1).</p>
        <div class="prof-grid">${sts.filter((t) => P.get(t.i).n >= 2).map((t) => profileSVG(job, P.get(t.i), { small: true, fmt: (v) => fS(v), fmtX: fo, fmtR: fo, title: `Stn ${t.i} (${Math.round(t.angle)}°)` })).join('')}</div>
        ${N.table('Edge settlement survey — radial readings')}${chunks.map((ch) => `<table class="grid small epr"><thead><tr><th>From shell</th>${ch.map((t) => `<th>Stn ${t.i}</th>`).join('')}</tr></thead><tbody>${offs.map((x) => `<tr><td>${fo(x)}</td>${ch.map((t) => { const v = st.ep.rd?.[t.i]?.[xKey(x)]; return `<td>${v == null ? '—' : (v / eu[0]).toFixed(eu[2])}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`).join('')}
        <p class="note">Readings in ${eu[1]}${st.rod ? ' (rod readings, larger = lower)' : ''}.</p></section>`));
    }
    if (st.edge.length) out.push(`<h3 class="rp-h3">${hasEP(job) ? 'Other edge settlement areas' : 'Edge settlement'} (B.2.3 / B.3.4)</h3><table class="grid small"><thead><tr><th>Area</th><th class="n">Angle</th><th class="n">R (${U.big})</th><th class="n">B (${sU})</th><th>Bottom weld</th><th class="n">Bew</th><th class="n">Be</th><th class="n">Allowable</th><th class="n">B / allow</th><th>Status</th><th>Notes</th></tr></thead><tbody>
      ${st.edge.map((x, i) => { const ev = edgeEval(x, job); return `<tr class="${ev.status === 'Exceeds' ? 'is-bad' : ''}"><td>E${i + 1}</td><td class="n">${x.angle != null ? x.angle + '°' : '—'}</td><td class="n">${fmt(x.R, 'big', job, false)}</td><td class="n">${fmt(x.B, 'small', job, false)}</td><td>${{ par: 'Lap ∥ shell', perp: 'Lap ⊥ shell', none: 'None / butt', angle: `Lap at ${x.alpha ?? '?'}°` }[x.weld] || ''}</td><td class="n">${fmt(ev.Bew, 'small', job, false)}</td><td class="n">${fmt(ev.Be, 'small', job, false)}</td><td class="n">${fmt(ev.allow, 'small', job, false)}</td><td class="n">${ev.pct != null ? ev.pct.toFixed(0) + '%' : '—'}</td><td>${stTxt(ev.status)}</td><td>${h(x.notes)}</td></tr>`; }).join('')}
      </tbody></table><p class="note">Bew from API 653 Fig. B.11 (lap weld ±20° of parallel to the shell), Be from Fig. B.12 (no weld, butt welds, or lap weld ±20° of perpendicular), read at R for a ${fmt(c.D, 'big', job)} tank; angled welds B = Be − (Be − Bew)·sin α. NDE required: over 75 % of allowable — examine shell-to-bottom and bottom welds in the area by VT and MT/PT (B.3.4.1).</p>`);
    if (st.dep.length) out.push(`<h3 class="rp-h3">Bottom depressions / bulges (B.3.3)</h3><table class="grid small"><thead><tr><th>Area</th><th class="n">Angle</th><th class="n">From centre (${U.big})</th><th class="n">R (${U.big})</th><th class="n">Depth B (${sU})</th><th class="n">Allowable ${job.units === 'metric' ? '0.031·R' : '0.37·R'}</th><th class="n">B / allow</th><th>Status</th><th>Notes</th></tr></thead><tbody>
      ${st.dep.map((x, i) => { const ev = depEval(x, job); return `<tr class="${ev.status === 'Exceeds' ? 'is-bad' : ''}"><td>D${i + 1}</td><td class="n">${x.angle != null ? x.angle + '°' : '—'}</td><td class="n">${fmt(x.r, 'big', job, false)}</td><td class="n">${fmt(x.R, 'big', job, false)}</td><td class="n">${fmt(x.B, 'small', job, false)}</td><td class="n">${fmt(ev.allow, 'small', job, false)}</td><td class="n">${ev.pct != null ? ev.pct.toFixed(0) + '%' : '—'}</td><td>${stTxt(ev.status)}</td><td>${h(x.notes)}</td></tr>`; }).join('')}
      </tbody></table>`);
    if (st.notes) out.push(`<p class="note">${h(st.notes)}</p>`);
    out.push('</section>');
    return out.join('');
  })() : '');

  const ctx = { job, layout, calc, N, opts, patches };
  const chapterBody = {
    exec: () => execCh(ctx), tank: () => tankCh(ctx), scope: () => scopeCh(ctx), personnel: () => personnelCh(ctx), floor: floorCh, shell: shellCh, roof: roofCh,
    nozzles: () => (inScope(job, 'nozzles') && (job.nozzles || []).length ? nozCh() : ''),
    settle: settleCh,
    findings: () => sectionChaptersHTML(job, photos, opts, N),
    defs: () => defTableHTML(job, photos, 'Deficiencies and recommendations', { N }),
  };
  const appendixBody = { shellrd: app('shellrd'), shelleval: app('shelleval'), roofrd: app('roofrd'), settlework: app('settlework'), floorinds: () => (inScope(job, 'floor') && inds.length ? indRegister() : ''), plates: () => (inScope(job, 'floor') ? platesBlock() : ''), floorphotos: () => (inScope(job, 'floor') ? photoBlock() : '') };
  return assembleReport({ job, company, opts, layout: LY, N, chapterBody, appendixBody, footer: `<footer class="rp-foot">${job.rev ? `${h(I.tankId || '')} Rev ${job.rev} (${h(new Date(job.savedAt).toLocaleDateString())}). ` : ''}${h(company.footer || '')} Calculations per API 653, 5th ed. Addendum 4 (2025) (§4.4.5 bottom), with corrections ${h(CORRECTIONS)}, as configured in this report; verify limits against the edition and tank design in force.</footer>` });
}


/* ---------------------------------------------------------- sections, summary, deficiencies --- */

const photoNo = (p) => `${(SECTIONS.find((x) => x.key === p.sec)?.label || '').replace(/\s.*/, '').slice(0, 2).toUpperCase()}-${p.n || '?'}`;
export function annoOverlay(p) {
  if (!(p.anno || []).length) return '';
  const W = 1000, H = Math.round(1000 * ((p.h || 3) / (p.w || 4))), sw = 6;
  const o = [`<svg class="anno" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><marker id="rh-${p.id}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5 0 10z" fill="context-stroke"/></marker></defs>`];
  for (const a of p.anno) {
    const c = a.c || '#ff2d2d';
    if (a.t === 'arrow') o.push(`<line x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" marker-end="url(#rh-${p.id})"/>`);
    else if (a.t === 'ell') o.push(`<ellipse cx="${a.x}" cy="${a.y}" rx="${Math.abs(a.rx)}" ry="${Math.abs(a.ry)}" fill="none" stroke="${c}" stroke-width="${sw}"/>`);
    else if (a.t === 'rect') o.push(`<rect x="${Math.min(a.x, a.x + a.w)}" y="${Math.min(a.y, a.y + a.h)}" width="${Math.abs(a.w)}" height="${Math.abs(a.h)}" fill="none" stroke="${c}" stroke-width="${sw}"/>`);
    else if (a.t === 'pen') o.push(`<polyline points="${a.pts.map((q) => q.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`);
    else if (a.t === 'text') o.push(`<text x="${a.x}" y="${a.y}" font-size="${a.s || 44}" font-family="Arial,sans-serif" font-weight="700" fill="${c}" stroke="#000" stroke-width="1.5" paint-order="stroke">${h(a.txt)}</text>`);
  }
  o.push('</svg>');
  return o.join('');
}
const fig = (p, cap = true) => `<figure class="phr"><span class="phfig"><img src="${p.dataUrl}" alt="">${annoOverlay(p)}</span>${cap ? `<figcaption><b>${photoNo(p)}</b>${p.caption ? ' · ' + h(p.caption) : ''}${p.comment ? `<br><small>${h(p.comment)}</small>` : ''}</figcaption>` : ''}</figure>`;
const condText = (c) => (CONDITIONS.find(([k]) => k === c) || [])[1] || '';

export function defTableHTML(job, photos, title, opts = {}) {
  let defs = allDefs(job); if (opts.openOnly) defs = defs.filter((d) => d.status !== 'Closed');
  if (!defs.length) return opts.always ? `<section class="pb-avoid"><h2>${title}</h2><p>No deficiencies recorded.</p></section>` : '';
  const ph = new Map((photos || []).map((p) => [p.id, p]));
  const cnt = (f) => defs.filter(f).length;
  return `${opts.N ? `<section class="defs">${opts.N.table('Deficiencies and recommendations')}` : `<section class="pb defs"><h2>${title}</h2>`}
    <p class="note">${defs.length} item${defs.length > 1 ? 's' : ''}: ${['P1', 'P2', 'P3', 'P4', 'P5'].map((p) => `${p} ${cnt((d) => d.priority === p)}`).join(' · ')} · open ${cnt((d) => d.status !== 'Closed')}, closed ${cnt((d) => d.status === 'Closed')}. Priorities: ${Object.values(PRIORITY_LABEL).join('; ')}.</p>
    <table class="grid small deft"><thead><tr><th>No.</th><th>Component / location</th><th>Deficiency</th><th>Recommended action</th><th>Priority</th><th>Due</th><th>Status</th>${opts.client ? '<th>Client comment</th>' : ''}</tr></thead><tbody>
    ${defs.map((d) => { const p = d.photo && ph.get(d.photo); return `<tr class="${d.status === 'Closed' ? 'closed' : d.priority === 'P1' ? 'is-bad' : ''}"><td><b>${h(d.no || '')}</b></td><td>${h(d.secLabel)}${d.loc ? '<br><small>' + h(d.loc) + '</small>' : ''}</td><td>${h(d.finding)}${d.ref ? `<br><small>${h(d.ref)}</small>` : ''}${p ? `<div class="dthumb">${fig(p, false)}<small>${photoNo(p)}</small></div>` : ''}</td><td>${h(d.action)}</td><td>${h(d.priority)}</td><td>${h(d.due || '')}</td><td>${h(d.status)}${d.status === 'Closed' && d.closedOn ? `<br><small>${h(d.closedOn)}</small>` : ''}</td>${opts.client ? `<td>${h(d.client || '')}</td>` : ''}</tr>`; }).join('')}
    </tbody></table></section>`;
}

export function sectionChaptersHTML(job, photos, opts = {}, N = null) {
  const out = [];
  for (const s of SECTIONS) {
    if (!inScope(job, s.key)) continue;
    const d = job.secs?.[s.key] || {}, ph = (photos || []).filter((p) => p.sec === s.key && p.inReport !== false).sort((a, b) => (a.n || 0) - (b.n || 0));
    if (!d.nde?.length && !d.obs?.length && !d.recs?.length && !ph.length) continue;
    out.push(`<section class="${N ? '' : 'pb '}chap">${N ? N.sub(s.label) : `<h2>${h(s.label)} — inspection findings</h2>`}
      ${d.nde?.length ? `${N ? N.table(s.label + ' — NDE performed') : '<h3 class="rp-h3">NDE performed</h3>'}<table class="grid small"><thead><tr><th>Method</th><th>Extent</th><th>Procedure</th><th>Technician</th><th>Date</th><th>Equipment</th><th>Result</th><th>Notes</th></tr></thead><tbody>${d.nde.map((n) => `<tr><td>${h(n.method)}</td><td>${h(n.extent)}</td><td>${h(n.proc)}</td><td>${h(n.tech)}</td><td>${h(n.date)}</td><td>${(n.equip || []).map((id) => (job.equipment || []).find((e) => e.id === id)).filter(Boolean).map((e) => h(equipLine(e))).join('<br>')}</td><td>${h(n.result)}</td><td>${h(n.notes)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${d.obs?.length ? `${N ? N.table(s.label + ' — observations') : '<h3 class="rp-h3">Observations</h3>'}<table class="grid small"><thead><tr><th>#</th><th>Item</th><th>Location</th><th>Condition</th><th>Observation</th><th>Photos</th></tr></thead><tbody>${d.obs.map((o, i) => `<tr class="${o.cond === 'poor' ? 'is-bad' : ''}"><td>${i + 1}</td><td>${h(o.item)}</td><td>${h(o.loc)}</td><td>${condText(o.cond)}</td><td>${h(o.text)}</td><td>${ph.filter((p) => p.obs === o.id).map(photoNo).join(', ')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${d.recs?.length ? `${N ? N.table(s.label + ' — recommendations') : '<h3 class="rp-h3">Recommendations</h3>'}<table class="grid small"><thead><tr><th>No.</th><th>Finding</th><th>Recommended action</th><th>Priority</th><th>Due</th><th>Status</th></tr></thead><tbody>${d.recs.map((r) => `<tr><td>${h(r.def ? r.no || '' : '—')}</td><td>${h(r.finding)}${r.loc ? `<br><small>${h(r.loc)}</small>` : ''}</td><td>${h(r.action)}</td><td>${h(r.priority)}</td><td>${h(r.due || '')}</td><td>${h(r.status)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${ph.length && opts.photos !== false ? `<h3 class="rp-h3">Photographs</h3><div class="photos sec-ph">${ph.map((p) => fig(p)).join('')}</div>` : ''}
    </section>`);
  }
  return out.join('');
}

/** Stand-alone deficiency report for client updates. */
export function buildDefReport(job, company, photos) {
  const I = job.info || {}, S2 = job.summary || {};
  return `<article class="report">
  <header class="rp-head">
    ${company.logo ? `<img class="logo" src="${company.logo}" alt="">` : ''}
    <div class="co"><b>${h(company.name || '')}</b><br>${h(company.details || '').replace(/\n/g, '<br>')}</div>
    <div class="rp-title"><h1>Deficiency Report</h1><div>${h(I.tankId ? 'Tank ' + I.tankId : '')}${I.site ? ' · ' + h(I.site) : ''}</div>
    <div class="meta">${I.reportNo ? 'Report ' + h(I.reportNo) + ' · ' : ''}Issued ${h(S2.issued || new Date().toISOString().slice(0, 10))}${S2.defRev ? ' · Update ' + S2.defRev : ''}</div></div>
  </header>
  <section><table class="kv">${[['Client', I.client], ['Facility / site', I.site], ['Tank ID', I.tankId], ['Inspection date', I.inspDate], ['API 653 inspector', personName(job, 'insp653')], ['Overall condition', S2.condition]].filter(([, v]) => v).map(([k, v]) => `<tr><th>${k}</th><td>${h(v)}</td></tr>`).join('')}</table></section>
  ${defTableHTML(job, photos, 'Deficiencies', { always: true, client: true })}
  <footer class="rp-foot">${h(company.footer || '')} Status as of ${h(new Date().toLocaleDateString())}.</footer>
</article>`;
}
