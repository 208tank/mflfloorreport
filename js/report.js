// Printable report (browser print → Save as PDF).
import { fmt, fmtRate, u } from './units.js';
import { RESULTS, RESULT_SHORT, nozzleUT, NZ_CONN_SHORT, UT_CLOCK } from './calc.js';
import { renderMapSVG, COLORS } from './map.js';
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
      ${kv([['UT instrument', h([E.utMake, E.utModel].filter(Boolean).join(' '))], ['Serial no.', h(E.utSerial)], ['Probe', h(E.utProbe)], ['Calibration block', h(E.utBlock)], ['VT tools', h(E.vtTools)]])}
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
  ${platesBlock}
  ${photoBlock}
  <footer class="rp-foot">${job.rev ? `${h(I.tankId || '')} Rev ${job.rev} (${h(new Date(job.savedAt).toLocaleDateString())}). ` : ''}${h(company.footer || '')} Calculation per API 653 §4.4.7 as configured in this report; verify limits against the edition and tank design in force.</footer>
</article>`;
}
