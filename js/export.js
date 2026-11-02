// CSV / JSON / image exports.
import { fromMm, u, fmt } from './units.js';
import { RESULTS, nozzleUT, NZ_CONN_SHORT, UT_CLOCK } from './calc.js';
import { floatingLayout, plateUT, pointStatus, PT5, hasFixed, hasFloating } from './roof.js';
import { sealEval, activeStds } from './seal.js';
import { utLocations, courseSummary, coursesWithElev, courseAt, readingElevations, getReading, fmtElev } from './shell.js';
import { angleOf, toLocal, datumName, orientName } from './geometry.js';

export function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCSV = (rows) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
const r = (v, d) => (v === null || v === undefined || !Number.isFinite(v) ? '' : +v.toFixed(d));

export function fileBase(job) {
  const parts = [job.info?.client, job.info?.tankId, job.info?.inspDate].filter(Boolean).join('_');
  return (parts || 'tank-floor').replace(/[^\w.-]+/g, '-');
}

export function indicationsCSV(job, layout, calc) {
  const U = u(job), S = U.small, B = U.big, d = U.tDec + 1;
  const sm = (mm) => r(fromMm(mm, 'small', job), U.smallDec + 2);
  const t = (mm) => r(fromMm(mm, 't', job), d);
  const head = ['Indication', 'Plate', 'Plate type', `X (${S})`, `Y (${S})`, `Radius (${B})`, 'Angle (deg)', `Dist. to shell (${S})`, 'Critical zone',
    'MFL signal', 'MFL est. loss (%)', 'MFL scan ref', `Length (${S})`, `Width (${S})`,
    'Prove-up result', `Nominal t (${S})`, `UT min remaining (${S})`, 'UT method', `VT pit depth (${S})`, 'VT condition', 'Coating condition',
    `Remaining t used (${S})`, 'Remaining t source', `Wall loss (${S})`, 'Wall loss (%)', `Projected t at next insp. (${S})`, `MRT limit (${S})`, 'API 653 status',
    'Repair setting', 'Repair method', 'Comments'];
  const rows = [head];
  for (const ind of job.indications || []) {
    const a = calc.per.get(ind.id) || {};
    const fl = a.floor;
    rows.push([
      ind.no, a.plate?.label ?? '', a.plate?.kind ?? '', sm(ind.x), sm(ind.y),
      fl ? r(fromMm(Math.hypot(fl.x, fl.y), 'big', job), U.bigDec) : '', fl ? r(angleOf(fl.x, fl.y), 1) : '',
      sm(a.distShell), a.critical ? 'Yes' : '',
      ind.mflSignal ?? '', ind.mflPct ?? '', ind.scanRef ?? '', sm(ind.len), sm(ind.wid),
      RESULTS[ind.result || 'pending'], t(a.tNom), t(ind.utMin), ind.utMethod ?? '', t(ind.vtDepth), ind.vtCond ?? '', ind.coating ?? '',
      t(a.rem), a.src ?? '', t(a.loss), r(a.lossPct, 1), t(a.projected), t(a.limit), a.status ?? '',
      ind.repair || 'auto', ind.repairMethod ?? '', ind.comments ?? ''
    ]);
  }
  return toCSV(rows);
}

export function platesCSV(job, layout, calc) {
  const U = u(job), d = U.tDec + 1;
  const counts = new Map();
  for (const ind of job.indications || []) counts.set(ind.plate, (counts.get(ind.plate) || 0) + 1);
  const rows = [['Plate', 'Type', 'Cut / sketch', `Length (${U.big})`, `Width (${U.big})`, 'Orientation', 'Measured size', `Area (${U.big}²)`, `Nominal t (${U.small})`, `UT min (${U.small})`, 'MFL scan', 'Datum corner', 'Indications', 'Notes']];
  for (const p of layout.plates) {
    const o = job.plates?.[p.key] || {};
    rows.push([p.label, p.kind, p.cut ? 'Yes' : '',
      p.size ? r(fromMm(p.size.len, 'big', job), U.bigDec + 1) : '', p.size ? r(fromMm(p.size.wid, 'big', job), U.bigDec + 1) : '', p.size ? orientName(p.size.orient) : '', p.resized ? 'Yes' : '',
      r(p.area / (U.bigMm * U.bigMm), 2),
      r(fromMm(o.tNom ?? (p.kind === 'annular' ? job.tank.tAnnular ?? job.tank.tBottom : job.tank.tBottom), 't', job), d),
      r(fromMm(o.utMin, 't', job), d), o.scan || 'scanned', datumName(p),
      counts.get(p.key) || 0, o.notes ?? '']);
  }
  return toCSV(rows);
}

export function nozzlesCSV(job) {
  const U = u(job), d = U.smallDec + 1, td = U.tDec + 1;
  const t = (mm) => r(fromMm(mm, 't', job), td);
  const rows = [['Mark', 'Type', 'Connection', 'Service / description', 'Angle (deg)', `Size (${U.small})`, `Elevation to centreline (${U.small})`, 'Schedule', `Nominal wall (${U.small})`, `t-min (${U.small})`,
    `UT 12 o'clock (${U.small})`, `UT 3 o'clock (${U.small})`, `UT 6 o'clock (${U.small})`, `UT 9 o'clock (${U.small})`, 'Other UT readings', `Min UT (${U.small})`, 'Wall loss (%)', 'Status', 'Notes']];
  for (const n of (job.nozzles || []).slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0))) {
    const s = nozzleUT(n);
    rows.push([n.mark ?? '', n.type ?? '', NZ_CONN_SHORT[n.conn] || '', n.service ?? '', n.angle ?? '', r(fromMm(n.size, 'small', job), d), r(fromMm(n.elev, 'small', job), d), n.sched ?? '', t(n.tNom), t(n.tMin),
      ...UT_CLOCK.map(([k]) => t(n[k])), (n.utx || []).filter((x) => x.t != null).map((x) => `${x.loc || 'other'}: ${t(x.t)}`).join('; '), t(s.min), r(s.lossPct, 1), s.status, n.notes ?? '']);
  }
  return toCSV(rows);
}

export function shellCSV(job) {
  const U = u(job), td = U.tDec + 1, t = (mm) => r(fromMm(mm, 't', job), td);
  const locs = utLocations(job), courses = coursesWithElev(job);
  const rows = [[`Elevation (${U.small})`, 'Elevation', 'Course', `Course nominal t (${U.small})`, `Course t-min (${U.small})`, ...locs.map((l) => `${l.label} ${l.angle.toFixed(1)}° (${U.small})`), `Row min (${U.small})`]];
  for (const z of readingElevations(job)) {
    const c = courseAt(courses, z), vals = locs.map((l) => getReading(job, l.key, z)), got = vals.filter((v) => v !== null);
    rows.push([r(fromMm(z, 'small', job), U.smallDec + 2), fmtElev(z, job), c?.no ?? '', t(c?.tNom), t(c?.tMin), ...vals.map(t), got.length ? t(Math.min(...got)) : '']);
  }
  rows.push([]);
  rows.push(['Course summary']);
  rows.push(['Course', `Height (${U.big})`, `Nominal t (${U.small})`, `t-min (${U.small})`, 'Readings', `Min (${U.small})`, 'Wall loss (%)', 'Status']);
  for (const c of courseSummary(job)) rows.push([c.no, r(fromMm(c.h, 'big', job), U.bigDec + 1), t(c.tNom), t(c.tMin), c.count, t(c.min), r(c.lossPct, 1), c.status]);
  return toCSV(rows);
}

export function roofCSV(job) {
  const U = u(job), td = U.tDec + 1, t = (mm) => r(fromMm(mm, 't', job), td);
  const rows = [];
  if (hasFixed(job)) {
    const Fx = job.roof.fixed;
    rows.push([`Fixed roof (${Fx.kind}, ${Fx.support})`]);
    rows.push(['Point', 'Angle (deg)', `From centre (${U.big})`, `Reading (${U.small})`, `Nominal (${U.small})`, `t-min (${U.small})`, 'Wall loss (%)', 'Status']);
    for (const pt of Fx.pts || []) { const s = pointStatus(job, pt); rows.push([pt.label ?? '', pt.angle ?? '', r(fromMm(pt.r, 'big', job), U.bigDec + 1), t(pt.t), t(Fx.tNom), t(Fx.tMin), r(s.lossPct, 1), s.status]); }
    rows.push([]);
  }
  if (hasFloating(job)) {
    const F = job.roof.floating, lay = floatingLayout(job);
    rows.push([`Floating roof (${F.kind})`]);
    rows.push(['Deck plate', 'Type', ...PT5.map(([, l]) => `${l} (${U.small})`), `Min (${U.small})`, `Nominal (${U.small})`, `t-min (${U.small})`, 'Wall loss (%)', 'Status']);
    for (const p of lay.plates.filter((q) => q.kind !== 'annular')) {
      const s = plateUT(job, p), m = F.ut?.[p.key] || {};
      rows.push([p.label, p.cut ? 'Deck (cut)' : 'Deck', ...PT5.map(([k]) => t(m[k])), t(s.min), t(s.tNom), t(s.tMin), r(s.lossPct, 1), s.status]);
    }
    const pons = lay.plates.filter((q) => q.kind === 'annular');
    if (pons.length) {
      rows.push([]);
      rows.push(['Pontoon', 'Condition', 'Notes']);
      for (const p of pons) { const pc = F.pont?.[p.key] || {}; rows.push([p.label, pc.cond ?? '', pc.notes ?? '']); }
    }
  }
  if (hasFloating(job) && job.roof.seal) {
    const seal = job.roof.seal;
    rows.push([]);
    rows.push([`Rim seal inspection ${seal.date || ''}`.trim(), seal.inspector || '']);
    for (const [title, sd] of [['Primary seal', seal.primary], ['Secondary seal', seal.secondary]]) {
      if (sd.type === 'None') { rows.push([title, 'None']); continue; }
      rows.push([title, sd.type]);
      rows.push(['Gap', 'Start angle (deg)', `Length (${U.small})`, `Max width (${U.small})`, `Avg width (${U.small})`, 'Notes']);
      sd.gaps.forEach((g, i) => rows.push([i + 1, g.angle ?? '', r(fromMm(g.len, 'small', job), U.smallDec + 2), r(fromMm(g.wMax, 'small', job), 3), r(fromMm(g.wAvg, 'small', job), 3), g.notes ?? '']));
      if (!sd.gaps.length) rows.push([sd.noGaps ? 'No gaps found' : 'No gaps recorded']);
    }
    for (const k of activeStds(seal)) {
      const ev = sealEval(job, k);
      rows.push([]); rows.push([ev.L.name, ev.overall]);
      rows.push(['Check', 'Result', 'Limit', 'Status']);
      for (const x of ev.rows) rows.push([x.item, x.text !== undefined ? x.text : x.value === null || x.value === undefined ? '' : x.unit === 'cm2m' ? `${x.value.toFixed(1)} cm2/m` : `${x.value.toFixed(2)} cm`, x.limit === null || x.limit === undefined ? '' : `${x.op} ${x.limit}${x.unit === 'cm2m' ? ' cm2/m' : ' cm'}`, x.ok === true ? 'OK' : x.ok === false ? 'Fails' : '']);
    }
  }
  if (!rows.length) rows.push(['No roof recorded']);
  return toCSV(rows);
}

export function svgForExport(svgMarkup) {
  // inline the styles the on-screen map gets from CSS so the file stands alone
  const style = `<style>
  .plate{fill:#fff;stroke:#5b6470}.plate.annular{fill:#f3f5f8}.plate.scan-not{fill:url(#hatch-not)}.plate.scan-partial{fill:url(#hatch-part)}
  .hatch-bg{fill:#eceef1}.hatch-bg2{fill:#f7f8fa}.hatch-line{stroke:#9aa3ad}.shell{fill:none;stroke:#1d232b}.cz{fill:none;stroke:#c2410c;opacity:.7}
  .ticks line{stroke:#1d232b}.ticks text,.plabels text{fill:#5b6470;font-family:Arial,sans-serif}.ticks text.zero{fill:#1d232b;font-weight:700}
  .ilabel,.ftlabel{fill:#1d232b;font-family:Arial,sans-serif;font-weight:700}.rep{fill:none;stroke:#b91c1c;stroke-dasharray:3 2}.rep.bad{stroke:#b91c1c}
  .selring{fill:none;stroke:#0ea5e9}.nozzle path{fill:#fff;stroke:#1d232b}.nozzle .fl{fill:#1d232b}.nozzle.bad path{stroke:#b91c1c}.nozzle.bad .fl{fill:#b91c1c}.nozzle text{fill:#1d232b;font-family:Arial;font-weight:700;stroke:none}.datum{fill:#0f766e;opacity:.6}.datum.own{opacity:.9}.ft{fill:#fff;stroke:#1d232b}.ft-column{fill:#1d232b}.ft-patch{fill:#fde68a;fill-opacity:.6}.scalebar rect{fill:#1d232b}.scalebar text{fill:#1d232b;font-family:Arial}</style>`;
  return svgMarkup.replace(/<defs>/, style + '<defs>');
}

export async function svgToPng(svgText, px = 3000) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas'); c.width = px; c.height = px;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, px, px); g.drawImage(img, 0, 0, px, px);
  URL.revokeObjectURL(url);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

export { fmt, toLocal };
