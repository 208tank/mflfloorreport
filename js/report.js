// Printable report (browser print → Save as PDF).
import { fmt, fmtRate, u } from './units.js';
import { RESULTS, RESULT_SHORT, nozzleUT, NZ_CONN_SHORT, UT_CLOCK } from './calc.js';
import { renderMapSVG, COLORS } from './map.js';
import { settleCalc, edgeEval, depEval, hasSettle, hasEP, epOffsets, xKey, profileEval, profileSVG, stations as setStations, slopeText, settleChartSVG, settlePlanSVG, ELEV_UNITS, PSI_PER_MPA } from './settle.js';
import { sealEval, activeStds, nextDue, gapSummary, cm2mToIn2ft, SEAL_CHECKS } from './seal.js';
import { ROOF_TYPES, hasFixed, hasFloating, floatingLayout, floatingSVG, fixedSVG, plateUT, pointStatus, PT5, PT5_SHORT, roofDiameter } from './roof.js';
import { rolloutSVG, utLocations, courseSummary, coursesWithElev, courseAt, readingElevations, getReading, fmtElev, coursePlates } from './shell.js';
import { itemFloor, angleOf, refCornerName, datumName, orientName } from './geometry.js';

const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
    ${item('not', 'Not scanned', `<rect x="-5" y="-4" width="10" height="8" fill="url(#lg-hatch)" stroke="#5b6470" stroke-width=".6"/><defs><pattern id="lg-hatch" width="2.5" height="2.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.5" height="2.5" fill="#eceef1"/><line y2="2.5" stroke="#9aa3ad" stroke-width=".7"/></pattern></defs>`)}
  </div>`;
}

export function buildReport(job, layout, calc, company, photos, opts) {
  const U = u(job), I = job.info || {}, T = job.tank || {}, E = job.equip || {}, C = calc.C;
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
      <td class="n">${fmt(a.projected, 't', job, false)}</td><td>${h(a.status)}</td><td>${h([i.vtCond, i.comments].filter(Boolean).join('; '))}</td></tr>`;
  }).join('');

  const regionRows = calc.regions.map((r) => `<tr><td>${h(r.label)}</td><td class="n">${t(r.RTip)}</td><td class="n">${t(r.RTbc)}</td><td class="n">${t(r.MRT)}</td><td class="n">${t(r.limit)}</td><td class="n">${t(r.tReq)}</td><td class="n">${r.OrMax === null ? '—' : Number.isFinite(r.OrMax) ? Math.max(0, r.OrMax).toFixed(1) + ' yr' : 'n/a (no corrosion rate)'}</td><td class="${r.ok ? 'ok' : 'bad'}">${r.ok === null ? '—' : r.ok ? 'Acceptable' : 'Not acceptable'}</td></tr>`).join('');

  const photoBlock = opts.photos ? (() => {
    const byInd = new Map();
    for (const p of photos) { if (!byInd.has(p.indId)) byInd.set(p.indId, []); byInd.get(p.indId).push(p); }
    const blocks = inds.filter((i) => byInd.has(i.id)).map((i) => byInd.get(i.id).map((p) => `<figure><img src="${p.dataUrl}" alt=""><figcaption><b>${h(i.no)}</b> · ${h(per.get(i.id)?.plate?.label ?? '')} · ${h(p.caption || RESULTS[i.result || 'pending'])}</figcaption></figure>`).join('')).join('');
    return blocks ? `<section class="pb"><h2>Photographs</h2><div class="photos">${blocks}</div></section>` : '';
  })() : '';

  const platesBlock = opts.plates ? `<section class="pb"><h2>Plate register</h2><table class="grid small"><thead><tr><th>Plate</th><th>Type</th><th>Size (L × W)</th><th>Orientation</th><th>Nominal t</th><th>UT min</th><th>MFL scan</th><th>Datum</th><th>Ind.</th><th>Notes</th></tr></thead><tbody>${layout.plates.map((p) => {
    const o = job.plates?.[p.key] || {}; const nI = inds.filter((i) => i.plate === p.key).length;
    return `<tr><td>${h(p.label)}</td><td>${p.kind}${p.cut ? ' (cut)' : ''}</td><td class="n">${p.kind === 'annular' ? '—' : `${fmt(p.size.len, 'big', job, false)} × ${fmt(p.size.wid, 'big', job)}${p.resized ? ' <sup>m</sup>' : ''}`}</td><td>${p.kind === 'annular' ? '—' : orientName(p.size.orient)}</td><td class="n">${t(o.tNom ?? (p.kind === 'annular' ? T.tAnnular ?? T.tBottom : T.tBottom))}</td><td class="n">${t(o.utMin)}</td><td>${o.scan === 'not' ? 'Not scanned' : o.scan === 'partial' ? 'Partial' : 'Scanned'}</td><td>${h(datumName(p))}</td><td class="n">${nI || ''}</td><td>${h(o.notes)}</td></tr>`;
  }).join('')}</tbody></table><p class="note"><sup>m</sup> measured size entered for that plate; others use the standard plate size.</p></section>` : '';

  return `<article class="report">
  <header class="rp-head">
    ${company.logo ? `<img class="logo" src="${company.logo}" alt="">` : ''}
    <div class="co"><b>${h(company.name || '')}</b><br>${h(company.details || '').replace(/\n/g, '<br>')}</div>
    <div class="rp-title"><h1>Tank Floor Inspection Report</h1><div>MFL scanning with UT / VT prove-up</div>
    <div class="meta">${I.reportNo ? 'Report ' + h(I.reportNo) + ' · ' : ''}${h(I.inspDate || '')}</div>
    <div class="meta">${job.rev ? `Rev ${job.rev} · saved ${h(new Date(job.savedAt).toLocaleString())}${(job.updated || 0) > (job.savedAt || 0) ? ' · <b>includes changes after Rev ' + job.rev + '</b>' : ''}` : 'Draft — not saved to a file'}</div></div>
  </header>

  <section>
    <div class="cols">
      ${kv([['Client', h(I.client)], ['Facility / site', h(I.site)], ['Tank ID', h(I.tankId)], ['Product', h(I.product)], ['Work order', h(I.workOrder)], ['Inspection date', h(I.inspDate)]])}
      ${kv([['Diameter', fmt(T.diameter, 'big', job)], ['Bottom type', h(T.bottomType)], ['Bottom nominal t', t(T.tBottom)], ['Annular nominal t', job.layout?.annular ? t(T.tAnnular) : 'No annular ring'], ['Product-side coating', h(T.coating || 'None')], ['Cathodic protection / RPB', `${yn(T.cp)} / ${yn(T.rpb)}`]])}
    </div>
  </section>

  <section>
    <h2>Summary</h2>
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
    <p class="verdict ${allOk ? 'ok' : 'bad'}">${allOk
      ? `With the ${repairs.length} repair${repairs.length === 1 ? '' : 's'} listed, the floor meets the API 653 minimum remaining thickness for a ${calc.Or}-year interval to the next internal inspection.`
      : `The floor does <b>not</b> meet the API 653 minimum remaining thickness for a ${calc.Or}-year interval. See the calculation and indication list.`}</p>
    ${calc.warnings.length ? `<ul class="warn">${calc.warnings.map((w) => `<li>${h(w)}</li>`).join('')}</ul>` : ''}
    ${(aNot || aPart) ? `<p class="note">Areas not scanned: ${pct(aNot)} of floor area; partially scanned: ${pct(aPart)}. These are hatched on the floor map.</p>` : ''}
  </section>

  <section class="pb-avoid">
    <h2>API 653 bottom minimum remaining thickness</h2>
    <p class="formula">MRT = min(RT<sub>bc</sub>, RT<sub>ip</sub>) − O<sub>r</sub> × (StP<sub>r</sub> + UP<sub>r</sub>)</p>
    ${kv([['O<sub>r</sub> — years to next internal inspection', calc.Or + ' yr'], ['Corrosion rate basis', calc.years ? calc.years + ' yr' : '—'],
      ['StP<sub>r</sub> — product side rate (unrepaired)', fmtRate(calc.StPr, job) + (C.coated ? ' (coated, = 0)' : '') + (calc.stSrc && calc.stSrc !== 'override' ? ` — from ${h(calc.stSrc.no)}` : calc.stSrc === 'override' ? ' (entered)' : '')],
      ['UP<sub>r</sub> — soil side rate (unrepaired)', fmtRate(calc.UPr, job) + (C.cp ? ' (effective CP, = 0)' : '') + (calc.upSrc && calc.upSrc !== 'override' ? ` — from ${h(calc.upSrc.no)}` : calc.upSrc === 'override' ? ' (entered)' : '')],
      ['Critical zone', `within ${fmt(C.czDist, 'small', job)} of shell, limit ${t(calc.czLim)}`]])}
    <table class="grid"><thead><tr><th>Area</th><th>RT<sub>ip</sub></th><th>RT<sub>bc</sub></th><th>MRT at O<sub>r</sub></th><th>Min. allowed</th><th>t required today</th><th>Max. O<sub>r</sub></th><th>Result</th></tr></thead><tbody>${regionRows}</tbody></table>
    <p class="note">Rates are linear: wall loss of each unrepaired, proven-up location divided by the rate basis. Locations marked for repair are excluded from RT and rates. "t required today" is the thickness a remaining location needs now to stay above the minimum for O<sub>r</sub> years. Thickness values in ${U.small}.</p>
  </section>

  <section class="pb map-sec">
    <h2>Floor map</h2>
    <div class="map-wrap">${map}</div>
    ${legendHTML()}
    <p class="note">Plate offsets X/Y are measured from each plate's datum corner, marked with a small triangle in that corner. Unless listed in the plate register, the datum is the plate's ${refCornerName(job.layout?.refCorner || 'BL')} corner${layout.Ri < layout.R ? '; on annular plates X runs along the shell from the datum seam and Y is measured in from the shell' : ''}.${(() => { const own = layout.plates.filter((p) => p.datum?.own || p.datumOwn); return own.length ? ` Plates measured from a different corner: ${own.map((p) => `${h(p.label)} (${h(datumName(p))})`).join(', ')}.` : ''; })()} 0° ${h(I.zeroRef || '')}.</p>
  </section>

  ${(job.nozzles || []).length ? `<section class="pb-avoid"><h2>Shell nozzles</h2><table class="grid small"><thead><tr><th>Mark</th><th>Type</th><th>Connection</th><th>Service</th><th class="n">Angle</th><th class="n">Size</th><th class="n">Elev.</th><th>Sched.</th><th class="n">Nom.</th><th class="n">t-min</th>${UT_CLOCK.map(([, l]) => `<th class="n">${l}:00</th>`).join('')}<th class="n">Min</th><th class="n">Loss</th><th>Status</th></tr></thead><tbody>${job.nozzles.slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0)).map((n) => { const r = nozzleUT(n); const extra = (n.utx || []).filter((x) => x.t != null); return `<tr class="${r.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${h(n.mark)}</b></td><td>${h(n.type)}</td><td>${h(NZ_CONN_SHORT[n.conn] || '')}</td><td>${h(n.service)}${extra.length ? `<br><small>${extra.map((x) => `${h(x.loc || 'other')}: ${fmt(x.t, 't', job, false)}`).join('; ')}</small>` : ''}${n.notes ? `<br><small>${h(n.notes)}</small>` : ''}</td><td class="n">${n.angle != null && n.angle !== '' ? (+n.angle).toFixed(1) + '°' : '—'}</td><td class="n">${fmt(n.size, 'small', job, false)}</td><td class="n">${fmt(n.elev, 'small', job, false)}</td><td>${h(n.sched)}</td><td class="n">${fmt(n.tNom, 't', job, false)}</td><td class="n">${fmt(n.tMin, 't', job, false)}</td>${UT_CLOCK.map(([k]) => `<td class="n">${fmt(n[k], 't', job, false)}</td>`).join('')}<td class="n"><b>${r.count ? fmt(r.min, 't', job, false) : '—'}</b></td><td class="n">${r.lossPct != null ? r.lossPct.toFixed(0) + '%' : '—'}</td><td>${r.status === 'Below t-min' ? '<b>Below t-min</b>' : h(r.status)}</td></tr>`; }).join('')}</tbody></table><p class="note">Angles clockwise from 0° ${h(I.zeroRef || '')}; elevation to centreline above the bottom. Sizes and thicknesses in ${U.small}. Neck UT at clock positions looking at the nozzle from outside the tank; other readings listed under service.</p></section>` : ''}

  <section class="pb">
    <h2>Indications</h2>
    <table class="grid small"><thead><tr><th>No.</th><th>Plate</th><th>X</th><th>Y</th><th>Angle</th><th>MFL %</th><th>Result</th><th>UT min</th><th>VT pit</th><th>Remaining</th><th>Loss %</th><th>t at O<sub>r</sub></th><th>Status</th><th>Remarks</th></tr></thead><tbody>${indRows || '<tr><td colspan="14">No indications recorded.</td></tr>'}</tbody></table>
    <p class="note">Dimensions in ${U.small}. Remaining thickness from UT unless marked <sup>V</sup> (nominal − VT pit depth) or <sup>M</sup> (MFL estimate).</p>
  </section>

  ${repairs.length || below.length ? `<section class="pb-avoid"><h2>Repairs</h2><table class="grid small"><thead><tr><th>No.</th><th>Plate</th><th>X</th><th>Y</th><th>Side</th><th>Remaining</th><th>Size (L × W)</th><th>Method</th><th>Basis</th></tr></thead><tbody>${[...repairs, ...below].map((i) => { const a = per.get(i.id); return `<tr><td>${h(i.no)}</td><td>${h(a.plate?.label)}</td><td class="n">${fmt(i.x, 'small', job, false)}</td><td class="n">${fmt(i.y, 'small', job, false)}</td><td>${RESULT_SHORT[i.result]}</td><td class="n">${t(a.rem)}</td><td class="n">${fmt(i.len, 'small', job, false)} × ${fmt(i.wid, 'small', job, false)}</td><td>${h(i.repairMethod || '')}</td><td>${a.status === 'below MRT' ? '<b>Below MRT – repair declined</b>' : a.auto ? 'Below MRT at O<sub>r</sub>' : 'Specified'}</td></tr>`; }).join('')}</tbody></table></section>` : ''}

  <section class="pb-avoid">
    <h2>Equipment and personnel</h2>
    <div class="cols">
      ${kv([['MFL scanner', h([E.mflMake, E.mflModel].filter(Boolean).join(' '))], ['Serial no.', h(E.mflSerial)], ['Calibration / reference', h([E.mflRef, E.mflCal].filter(Boolean).join(' · '))], ['Reporting threshold', E.mflThreshold ? h(E.mflThreshold) + ' %' : '—'], ['Sensitivity / settings', h(E.mflSettings)]])}
      ${kv([['UT instrument', h([E.utMake, E.utModel].filter(Boolean).join(' '))], ['Serial no.', h(E.utSerial)], ['Probe', h(E.utProbe)], ['Calibration block', h(E.utBlock)], ['VT tools', h(E.vtTools), ['Date of UT readings', h(I.utDate)]]])}
    </div>
    ${I.notes ? `<p><b>Notes:</b> ${h(I.notes).replace(/\n/g, '<br>')}</p>` : ''}
    <table class="sig"><tr>${[['MFL operator', I.mflTech], ['UT technician', I.utTech], ['API 653 inspector', I.inspector]].map(([r, n]) => `<td><div class="line"></div><b>${h(n || '')}</b><br>${r} · Date</td>`).join('')}</tr></table>
  </section>

  ${(() => {
    const cs = courseSummary(job); if (!cs.length) return '';
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
    return `<section class="pb"><h2>Shell UT</h2>
      <div class="ro-print">${rolloutSVG(job, { print: true })}</div>
      <p class="note">${locs.length} UT stations equally spaced from ${(+sh.start || 0).toFixed(1)}°${+sh.nLoc > 0 ? '' : ' (standard: one per 32 ft of circumference, minimum 4, maximum 8)'}. Readings at each station ${zsNote || 'at the elevations listed'}. Thickness in ${U.small}.</p>
      <table class="grid small"><thead><tr><th>Course</th><th class="n">Height</th><th class="n">Plates</th><th class="n">Nominal</th><th class="n">t-min</th><th class="n">Readings</th><th class="n">Min</th><th class="n">Loss</th><th>Status</th></tr></thead><tbody>
      ${top.map((c) => `<tr class="${c.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${c.no}</b></td><td class="n">${fmt(c.h, 'big', job, false)}</td><td class="n">${coursePlates(job, c, c.no - 1).n}</td><td class="n">${fmt(c.tNom, 't', job, false)}</td><td class="n">${fmt(c.tMin, 't', job, false)}</td><td class="n">${c.count}</td><td class="n"><b>${c.min != null ? fmt(c.min, 't', job, false) : '—'}</b></td><td class="n">${c.lossPct != null ? c.lossPct.toFixed(0) + '%' : '—'}</td><td>${c.status === 'Below t-min' ? '<b>Below t-min</b>' : h(c.status)}</td></tr>`).join('')}
      </tbody></table></section>
    <section class="pb"><h2>Shell UT readings</h2>
      <table class="grid small readings-rp"><thead><tr><th>Elevation</th>${locs.map((l) => `<th class="n">${l.label}<br>${l.angle.toFixed(0)}°</th>`).join('')}<th class="n">Min</th></tr></thead><tbody>${rows.join('') || `<tr><td colspan="${locs.length + 2}">No readings recorded.</td></tr>`}</tbody></table>
      <p class="note">Elevation above the bottom of the shell. Readings below the course t-min in bold. Thickness in ${U.small}.</p></section>`;
  })()}
  ${(() => {
    if (!job.roof || job.roof.type === 'none') return '';
    const out = [`<section class="pb"><h2>Roof</h2><p><b>${h((ROOF_TYPES.find(([k]) => k === job.roof.type) || [])[1] || '')}</b></p>`];
    if (hasFixed(job)) {
      const Fx = job.roof.fixed, pts = Fx.pts || [];
      const vals = pts.map((p) => pointStatus(job, p)).filter((x) => x.t !== null);
      out.push(`<h3 class="rp-h3">Fixed roof</h3><div class="cols">${kv([['Roof', h(Fx.kind)], ['Support', h(Fx.support)], ['Slope / radius', h(Fx.slope)]])}${kv([['Nominal plate t', t(Fx.tNom)], ['t-min', t(Fx.tMin)], ['Minimum reading', vals.length ? t(Math.min(...vals.map((x) => x.t))) : '—']])}</div>
        ${Fx.notes ? `<p class="note">${h(Fx.notes)}</p>` : ''}
        <div class="roof-print">${fixedSVG(job, { stations: utLocations(job), fmtT: (v) => fmt(v, 't', job, false) })}</div>
        <table class="grid small"><thead><tr><th>Point</th><th class="n">Angle</th><th class="n">From centre</th><th class="n">Reading</th><th class="n">Loss</th><th>Status</th></tr></thead><tbody>
        ${pts.map((pt) => { const st = pointStatus(job, pt); return `<tr class="${st.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${h(pt.label)}</b></td><td class="n">${pt.angle != null ? (+pt.angle).toFixed(1) + '°' : '—'}</td><td class="n">${fmt(pt.r, 'big', job)}</td><td class="n">${fmt(pt.t, 't', job, false)}</td><td class="n">${st.lossPct != null ? st.lossPct.toFixed(0) + '%' : '—'}</td><td>${st.status === 'Below t-min' ? '<b>Below t-min</b>' : h(st.status)}</td></tr>`; }).join('') || '<tr><td colspan="6">No readings.</td></tr>'}
        </tbody></table><p class="note">Thickness in ${U.small}. Angles clockwise from 0° ${h(I.zeroRef || '')}.</p>`);
    }
    if (hasFloating(job)) {
      const F = job.roof.floating, lay = floatingLayout(job);
      const all = lay.plates.filter((p) => p.kind !== 'annular').map((p) => ({ p, s: plateUT(job, p) })), pons = lay.plates.filter((p) => p.kind === 'annular');
      const vals = all.filter((x) => x.s.min !== null);
      out.push(`${hasFixed(job) ? '</section><section class="pb"><h2>Roof (continued)</h2>' : ''}<h3 class="rp-h3">${job.roof.type === 'fixed-ifr' ? 'Internal' : 'External'} floating roof</h3>
        <div class="cols">${kv([['Roof', h(F.kind)], ['Roof diameter', fmt(roofDiameter(job), 'big', job)], ['Rim gap', fmt(F.rimGap, 'small', job)], ['Pontoons', `${lay.nPont} × ${fmt(F.pontW, 'big', job)} wide`]])}${kv([['Deck plates', `${lay.plates.filter((p) => p.kind !== 'annular').length} (${fmt(F.plateW, 'big', job, false)} × ${fmt(F.plateL, 'big', job)})`], ['Deck nominal / t-min', `${t(F.deckNom)} / ${t(F.deckMin)}`], ['Pontoons with liquid / leaking', String(pons.filter((p) => ['Liquid present', 'Leaking'].includes(F.pont?.[p.key]?.cond)).length)], ['Minimum reading', vals.length ? t(Math.min(...vals.map((x) => x.s.min))) : '—']])}</div>
        ${F.notes ? `<p class="note">${h(F.notes)}</p>` : ''}
        <div class="roof-print">${floatingSVG(job, lay)}</div>
        <p class="note">Each deck plate has 5 UT readings (four corners and centre): ● OK ● below t-min ○ not read. Shaded pontoons have liquid present or are leaking.</p></section>
        <section class="pb"><h2>Floating roof deck UT readings</h2>
        <table class="grid small"><thead><tr><th>Plate</th>${PT5.map(([k]) => `<th class="n">${PT5_SHORT[k]}</th>`).join('')}<th class="n">Min</th><th class="n">Loss</th><th>Status</th></tr></thead><tbody>
        ${all.map(({ p, s }) => { const m = F.ut?.[p.key] || {}; return `<tr class="${s.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${h(p.label)}</b>${p.cut ? ' <small>cut</small>' : ''}</td>${PT5.map(([k]) => { const v = m[k]; return `<td class="n">${v == null ? '—' : s.tMin && v < s.tMin - 1e-9 ? '<b class="bad">' + fmt(v, 't', job, false) + '</b>' : fmt(v, 't', job, false)}</td>`; }).join('')}<td class="n"><b>${s.min != null ? fmt(s.min, 't', job, false) : '—'}</b></td><td class="n">${s.lossPct != null ? s.lossPct.toFixed(0) + '%' : '—'}</td><td>${s.status === 'Below t-min' ? '<b>Below t-min</b>' : h(s.status)}</td></tr>`; }).join('')}
        </tbody></table><p class="note">Thickness in ${U.small}. TL / TR / C / BL / BR = top-left, top-right, centre, bottom-left, bottom-right of each plate as drawn.</p>
        ${pons.length ? `<h3 class="rp-h3">Pontoons</h3><table class="grid small"><thead><tr><th>Pontoon</th><th>Condition</th><th>Notes</th></tr></thead><tbody>${pons.map((p) => { const pc = F.pont?.[p.key] || {}; return `<tr class="${['Liquid present', 'Leaking'].includes(pc.cond) ? 'is-bad' : ''}"><td><b>${h(p.label)}</b></td><td>${h(pc.cond || '—')}</td><td>${h(pc.notes)}</td></tr>`; }).join('')}</tbody></table>` : ''}`);
    }
    if (hasFloating(job) && job.roof.seal) {
      const seal = job.roof.seal, D = +job.tank.diameter || 0, met = job.units === 'metric';
      const ga = (v) => (v === null || v === undefined ? '—' : met ? `${v.toFixed(1)} cm²/m` : `${cm2mToIn2ft(v).toFixed(2)} in²/ft (${v.toFixed(1)} cm²/m)`);
      const gw = (cm) => (cm === null || cm === undefined ? '—' : met ? `${cm.toFixed(cm >= 5 ? 1 : 2)} cm` : `${(cm / 2.54).toFixed(cm >= 5 ? 1 : 3)} in (${cm.toFixed(cm >= 5 ? 1 : 2)} cm)`);
      const gapRows = (sd) => sd.gaps.map((g, i) => { const L = +g.len, W = +(g.wAvg ?? g.wMax), a = L > 0 && W > 0 ? (L / 10) * (W / 10) : null; return `<tr><td>${i + 1}</td><td class="n">${g.angle != null ? (+g.angle).toFixed(1) + '°' : '—'}</td><td class="n">${fmt(g.len, 'small', job, false)}</td><td class="n">${fmt(g.wMax, 'small', job, false)}</td><td class="n">${g.wAvg != null ? fmt(g.wAvg, 'small', job, false) : '—'}</td><td class="n">${a === null ? '—' : met ? a.toFixed(1) + ' cm²' : (a / 6.4516).toFixed(2) + ' in²'}</td><td>${h(g.notes)}</td></tr>`; }).join('') || `<tr><td colspan="7">${sd.noGaps ? 'No gaps found.' : 'No gaps recorded.'}</td></tr>`;
      const gapTbl = (title, sd) => `<h3 class="rp-h3">${title}: ${h(sd.type)}${sd.notes ? ' — ' + h(sd.notes) : ''}</h3><table class="grid small"><thead><tr><th>Gap</th><th class="n">Start angle</th><th class="n">Length (${U.small})</th><th class="n">Max width (${U.small})</th><th class="n">Avg width (${U.small})</th><th class="n">Area</th><th>Notes</th></tr></thead><tbody>${gapRows(sd)}</tbody></table>`;
      const res = activeStds(seal).map((k) => { const ev = sealEval(job, k), due = nextDue(job, k); return `<h3 class="rp-h3">${h(ev.L.name)} — <span class="${ev.overall === 'Compliant' ? 'ok' : ev.overall === 'Not compliant' ? 'bad' : ''}">${ev.overall}</span></h3>
        <table class="grid small"><thead><tr><th>Check</th><th class="n">Result</th><th class="n">Limit</th><th>Status</th></tr></thead><tbody>${ev.rows.map((r) => `<tr class="${r.ok === false ? 'is-bad' : ''}"><td>${h(r.item)}</td><td class="n">${r.text !== undefined ? h(r.text) : r.unit === 'cm2m' ? ga(r.value) : gw(r.value)}</td><td class="n">${r.limit === null || r.limit === undefined ? '—' : r.op + ' ' + (r.unit === 'cm2m' ? ga(r.limit) : gw(r.limit))}</td><td>${r.ok === true ? 'OK' : r.ok === false ? '<b>Fails</b>' : '—'}</td></tr>`).join('')}</tbody></table>
        ${ev.fails ? `<p class="note"><b>Repair:</b> ${h(ev.repair)}</p>` : ''}${due.length ? `<p class="note">${due.map((d) => `${h(d.what)}: ${d.every}${d.due ? `, next due ${h(d.due.toLocaleDateString())}` : ''}`).join(' · ')}</p>` : ''}`; }).join('');
      out.push(`</section><section class="pb"><h2>Rim seal inspection</h2>
        <div class="cols">${kv([['Roof', h(job.roof.type === 'fixed-ifr' ? 'Internal floating roof' : 'External floating roof')], ['Inspection date', h(seal.date)], ['Inspected by', h(seal.inspector)]])}${kv([['Roof / liquid level', h(seal.level)], ['Tank diameter', fmt(D, 'big', job)], ['Notes', h(seal.notes)]])}</div>
        ${res || '<p class="note">No standard selected.</p>'}
        ${gapTbl('Primary seal', seal.primary)}${seal.secondary.type !== 'None' ? gapTbl('Secondary seal', seal.secondary) : '<p class="note">No secondary seal fitted.</p>'}
        <h3 class="rp-h3">Visual inspection</h3><table class="grid small"><tbody>${SEAL_CHECKS.map(([k, l]) => { const c = seal.checks?.[k] || {}; return `<tr class="${c.r === 'defect' ? 'is-bad' : ''}"><td>${h(l)}</td><td>${c.r === 'ok' ? 'OK' : c.r === 'defect' ? '<b>Defect</b>' : c.r === 'na' ? 'N/A' : '—'}</td><td>${h(c.note)}</td></tr>`; }).join('')}</tbody></table>
        <p class="note">Seal gaps found with a 1/8 in (0.32 cm) probe (Canada 0.3 cm) with the roof floating freely; gap area = length × average width (maximum width where no average was recorded); area per metre of tank diameter. Gaps are shown on the floating roof plan (primary red, secondary blue).</p>`);
    }
    out.push('</section>');
    return out.join('');
  })()}
  ${hasSettle(job) ? (() => {
    const st = job.settle, c = settleCalc(job), F = c.fit, met = job.units === 'metric', sU = U.small;
    const fS = (mm, sign = false) => (mm === null || mm === undefined ? '—' : (sign && mm > 0 ? '+' : '') + (met ? mm.toFixed(1) : (mm / 25.4).toFixed(2)));
    const eu = ELEV_UNITS[st.eu] || ELEV_UNITS.in, okc = (ok) => (ok === true ? 'OK' : ok === false ? '<b class="bad">Fails</b>' : '—');
    const stTxt = (s) => (s === 'Exceeds' || s === 'Not acceptable' ? `<b class="bad">${s}</b>` : s === 'Acceptable' ? `<span class="ok">${s}</span>` : `<b>${s}</b>`);
    const out = [`<section class="pb"><h2>Settlement — API 653 Annex B</h2>
      <div class="cols">${kv([['Survey date', h(st.date)], ['Surveyed by', h(st.surveyor)], ['Instrument', h(st.instrument)], ['Benchmark', h(st.benchmark)]])}${kv([['Liquid level at survey', h(st.level)], ['Stations', `${c.N} (${c.n} read) · L = ${c.L ? fmt(c.L, 'big', job) : '—'}`], ['Shell height H', c.H > 0 ? fmt(c.H, 'big', job) : '—'], ['Y / E', st.Y == null ? '—' : met ? `${(+st.Y).toFixed(0)} / ${(+st.E).toFixed(0)} MPa` : `${Math.round(st.Y * PSI_PER_MPA).toLocaleString()} / ${Math.round(st.E * PSI_PER_MPA).toLocaleString()} psi`]])}</div>`];
    if (c.n) {
      out.push(`<h3 class="rp-h3">Shell settlement — ${stTxt(c.status)}</h3>
      <div class="set-print"><div>${settlePlanSVG(job, c, { fmt: (v) => fS(v) })}</div><div>${settleChartSVG(job, c, { fmt: (v) => fS(v), unit: sU })}</div></div>
      ${F ? `<table class="grid small"><thead><tr><th>Check</th><th class="n">Result</th><th class="n">Limit</th><th>Status</th><th>Basis</th></tr></thead><tbody>
        <tr><td>Cosine fit R²</td><td class="n">${F.R2.toFixed(3)}</td><td class="n">≥ 0.90</td><td>${c.valid ? 'Valid' : '<b class="bad">Not valid</b>'}</td><td>B.2.2.4</td></tr>
        <tr><td>Planar tilt across diameter</td><td class="n">${fS(F.tilt)} ${sU}</td><td class="n">—</td><td>—</td><td>Low side ${F.loDeg.toFixed(0)}°, slope ${slopeText(F.slope, job)}</td></tr>
        <tr class="${c.tiltOk === false ? 'is-bad' : ''}"><td>Out-of-plumbness at top of shell</td><td class="n">${fS(F.plumb)} ${sU}</td><td class="n">≤ ${fS(F.plumbLim)} ${sU}</td><td>${okc(c.tiltOk)}</td><td>API 653 §10.5.2.1 (1/100 H, 5 in max); API 650 1/200 H = ${fS(F.plumb650)} ${sU} for reference</td></tr>
        <tr class="${c.oopOk === false ? 'is-bad' : ''}"><td>Max out-of-plane deflection |S|</td><td class="n">${F.maxS == null ? '—' : fS(Math.abs(F.maxS)) + ' ' + sU + ' (stn ' + F.maxAt + ')'}</td><td class="n">${c.Smax == null ? '—' : '≤ ' + fS(c.Smax) + ' ' + sU}</td><td>${okc(c.oopOk)}</td><td>B.3.2.1: Smax = 11·L²·Y / (2·E·H)</td></tr>
      </tbody></table>` : ''}
      ${c.warnings.length ? `<p class="note">${c.warnings.map(h).join(' ')}</p>` : ''}
      <table class="grid small"><thead><tr><th>Station</th><th class="n">Angle</th><th class="n">Reading (${eu[1]})</th><th class="n">Cosine fit</th><th class="n">Measured</th><th class="n">U</th><th class="n">S</th><th>Status</th></tr></thead><tbody>
      ${c.pts.map((p) => `<tr class="${p.ok === false ? 'is-bad' : ''}"><td>${p.i}</td><td class="n">${p.angle.toFixed(1)}°</td><td class="n">${p.raw == null ? '—' : (p.raw / eu[0]).toFixed(eu[2])}</td><td class="n">${F && p.fit !== undefined ? fS(p.fit - F.a, true) : '—'}</td><td class="n">${F && p.z !== null ? fS(p.z - F.a, true) : '—'}</td><td class="n">${p.U !== undefined ? fS(p.U, true) : '—'}</td><td class="n">${p.S != null ? fS(p.S, true) : '—'}</td><td>${p.ok === false ? '<b>Exceeds</b>' : p.ok ? 'OK' : '—'}</td></tr>`).join('')}
      </tbody></table><p class="note">Fit, measured, U and S in ${sU === "in" ? "inches" : "mm"} relative to the mean plane${st.rod ? '; readings are rod readings (larger = lower)' : ''}. U = measured − optimum cosine curve; S = U − ½(U<sub>i−1</sub> + U<sub>i+1</sub>). Annex B sets no numeric planar-tilt limit; out-of-plumbness is compared with API 653 §10.5.2.1.</p>`);
    }
    if (hasEP(job)) {
      const fo = (x) => { if (met) return `${Math.round(x)}`; const inch = Math.round((x / 25.4) * 100) / 100; if (inch < 12) return `${inch}"`; const ft = Math.floor(inch / 12 + 1e-9); return `${ft}'-${Math.round((inch - ft * 12) * 100) / 100}"`; };
      const sts = setStations(job), offs = epOffsets(job), P = new Map(sts.map((x) => [x.i, profileEval(job, x.i)]));
      const wl = { par: 'Lap ∥ shell', perp: 'Lap ⊥ shell', none: 'None / butt', angle: 'Lap at angle' };
      const chunks = []; for (let k = 0; k < sts.length; k += 12) chunks.push(sts.slice(k, k + 12));
      out.push(`</section><section class="pb"><h2>Edge settlement survey — API 653 B.2.3 / B.3.4</h2>
        <table class="grid small"><thead><tr><th>Station</th><th class="n">Angle</th><th class="n">Breakover R</th><th class="n">B (${sU})</th><th>Bottom weld</th><th class="n">Bew</th><th class="n">Be</th><th class="n">Allowable</th><th class="n">B / allow</th><th>Status</th><th>Notes</th></tr></thead><tbody>
        ${sts.map((t) => { const p = P.get(t.i), o = st.ep.st?.[t.i] || {}; if (!p.n) return ''; return `<tr class="${p.status === 'Exceeds' ? 'is-bad' : ''}"><td>${t.i}</td><td class="n">${t.angle.toFixed(1)}°</td><td class="n">${p.R > 0 ? fo(p.R) + (p.auto ? '' : ' *') : '—'}</td><td class="n">${p.R > 0 ? fS(p.B) : p.status === 'No edge settlement' ? '0' : '—'}</td><td>${p.R > 0 ? wl[o.weld || 'par'] + ((o.weld || 'par') === 'angle' ? ` ${o.alpha ?? '?'}°` : '') : ''}</td><td class="n">${p.Bew != null ? fS(p.Bew) : '—'}</td><td class="n">${p.Be != null ? fS(p.Be) : '—'}</td><td class="n">${p.ev?.allow != null ? fS(p.ev.allow) : '—'}</td><td class="n">${p.ev?.pct != null ? p.ev.pct.toFixed(0) + '%' : '—'}</td><td>${stTxt(p.status)}</td><td>${h(o.notes)}</td></tr>`; }).join('')}
        </tbody></table>
        <p class="note">Readings taken radially inward from the shell at each settlement station (${offs.map(fo).join(', ')}${met ? ' mm' : ''}). The unsettled bottom is the straight line through the outer readings (allows for bottom slope, Fig. B.7); R = distance from the shell to the breakover, B = largest drop below the projected line inside R (Fig. B.6)${Object.values(st.ep.st || {}).some((o) => o.Rov != null) ? '; * breakover chosen by the inspector' : ''}. Bew / Be ${(st.curve || []).length ? `interpolated from ${h(st.curveSrc || 'Fig. B.11 / B.12 values')} unless entered for the station` : 'as entered from Fig. B.11 / B.12'}. NDE required: 75 % of allowable or more — VT and MT/PT of shell-to-bottom and bottom welds in the area (B.3.4.1).</p>
        <div class="prof-grid">${sts.filter((t) => P.get(t.i).n >= 2).map((t) => profileSVG(job, P.get(t.i), { small: true, fmt: (v) => fS(v), fmtX: fo, fmtR: fo, title: `Stn ${t.i} (${Math.round(t.angle)}°)` })).join('')}</div>
        ${chunks.map((ch) => `<table class="grid small epr"><thead><tr><th>From shell</th>${ch.map((t) => `<th>Stn ${t.i}</th>`).join('')}</tr></thead><tbody>${offs.map((x) => `<tr><td>${fo(x)}</td>${ch.map((t) => { const v = st.ep.rd?.[t.i]?.[xKey(x)]; return `<td>${v == null ? '—' : (v / eu[0]).toFixed(eu[2])}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`).join('')}
        <p class="note">Readings in ${eu[1]}${st.rod ? ' (rod readings, larger = lower)' : ''}.</p>`);
    }
    if (st.edge.length) out.push(`<h3 class="rp-h3">${hasEP(job) ? 'Other edge settlement areas' : 'Edge settlement'} (B.2.3 / B.3.4)</h3><table class="grid small"><thead><tr><th>Area</th><th class="n">Angle</th><th class="n">R (${U.big})</th><th class="n">B (${sU})</th><th>Bottom weld</th><th class="n">Bew</th><th class="n">Be</th><th class="n">Allowable</th><th class="n">B / allow</th><th>Status</th><th>Notes</th></tr></thead><tbody>
      ${st.edge.map((x, i) => { const ev = edgeEval(x); return `<tr class="${ev.status === 'Exceeds' ? 'is-bad' : ''}"><td>E${i + 1}</td><td class="n">${x.angle != null ? x.angle + '°' : '—'}</td><td class="n">${fmt(x.R, 'big', job, false)}</td><td class="n">${fmt(x.B, 'small', job, false)}</td><td>${{ par: 'Lap ∥ shell', perp: 'Lap ⊥ shell', none: 'None / butt', angle: `Lap at ${x.alpha ?? '?'}°` }[x.weld] || ''}</td><td class="n">${fmt(x.Bew, 'small', job, false)}</td><td class="n">${fmt(x.Be, 'small', job, false)}</td><td class="n">${fmt(ev.allow, 'small', job, false)}</td><td class="n">${ev.pct != null ? ev.pct.toFixed(0) + '%' : '—'}</td><td>${stTxt(ev.status)}</td><td>${h(x.notes)}</td></tr>`; }).join('')}
      </tbody></table><p class="note">Bew from API 653 Fig. B.11 (lap weld ±20° of parallel to the shell), Be from Fig. B.12 (no weld, butt welds, or lap weld ±20° of perpendicular), read at R for a ${fmt(c.D, 'big', job)} tank; angled welds B = Be − (Be − Bew)·sin α. NDE required: over 75 % of allowable — examine shell-to-bottom and bottom welds in the area by VT and MT/PT (B.3.4.1).</p>`);
    if (st.dep.length) out.push(`<h3 class="rp-h3">Bottom depressions / bulges (B.3.3)</h3><table class="grid small"><thead><tr><th>Area</th><th class="n">Angle</th><th class="n">From centre (${U.big})</th><th class="n">R (${U.big})</th><th class="n">Depth B (${sU})</th><th class="n">Allowable 0.37·R</th><th class="n">B / allow</th><th>Status</th><th>Notes</th></tr></thead><tbody>
      ${st.dep.map((x, i) => { const ev = depEval(x); return `<tr class="${ev.status === 'Exceeds' ? 'is-bad' : ''}"><td>D${i + 1}</td><td class="n">${x.angle != null ? x.angle + '°' : '—'}</td><td class="n">${fmt(x.r, 'big', job, false)}</td><td class="n">${fmt(x.R, 'big', job, false)}</td><td class="n">${fmt(x.B, 'small', job, false)}</td><td class="n">${fmt(ev.allow, 'small', job, false)}</td><td class="n">${ev.pct != null ? ev.pct.toFixed(0) + '%' : '—'}</td><td>${stTxt(ev.status)}</td><td>${h(x.notes)}</td></tr>`; }).join('')}
      </tbody></table>`);
    if (st.notes) out.push(`<p class="note">${h(st.notes)}</p>`);
    out.push('</section>');
    return out.join('');
  })() : ''}
  ${platesBlock}
  ${photoBlock}
  <footer class="rp-foot">${job.rev ? `${h(I.tankId || '')} Rev ${job.rev} (${h(new Date(job.savedAt).toLocaleDateString())}). ` : ''}${h(company.footer || '')} Calculation per API 653 §4.4.7 as configured in this report; verify limits against the edition and tank design in force.</footer>
</article>`;
}
