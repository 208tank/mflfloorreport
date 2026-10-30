// CSV / JSON / image exports.
import { fromMm, u, fmt } from './units.js';
import { RESULTS } from './calc.js';
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

export function svgForExport(svgMarkup) {
  // inline the styles the on-screen map gets from CSS so the file stands alone
  const style = `<style>
  .plate{fill:#fff;stroke:#5b6470}.plate.annular{fill:#f3f5f8}.plate.scan-not{fill:url(#hatch-not)}.plate.scan-partial{fill:url(#hatch-part)}
  .hatch-bg{fill:#eceef1}.hatch-bg2{fill:#f7f8fa}.hatch-line{stroke:#9aa3ad}.shell{fill:none;stroke:#1d232b}.cz{fill:none;stroke:#c2410c;opacity:.7}
  .ticks line{stroke:#1d232b}.ticks text,.plabels text{fill:#5b6470;font-family:Arial,sans-serif}.ticks text.zero{fill:#1d232b;font-weight:700}
  .ilabel,.ftlabel{fill:#1d232b;font-family:Arial,sans-serif;font-weight:700}.rep{fill:none;stroke:#b91c1c;stroke-dasharray:3 2}.rep.bad{stroke:#b91c1c}
  .selring{fill:none;stroke:#0ea5e9}.datum{fill:#0f766e;opacity:.6}.datum.own{opacity:.9}.ft{fill:#fff;stroke:#1d232b}.ft-column{fill:#1d232b}.ft-patch{fill:#fde68a;fill-opacity:.6}.scalebar rect{fill:#1d232b}.scalebar text{fill:#1d232b;font-family:Arial}</style>`;
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
