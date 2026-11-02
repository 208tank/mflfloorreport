// UT loader sheet: an Excel workbook built from the job for the UT technician to fill in, and the
// matching import that writes the readings back into the job.
import { writeXlsx, readXlsx, ref, ST } from './xlsx.js';
import { u, fromMm, toMm } from './units.js';
import { buildLayout } from './geometry.js';
import { UT_CLOCK, plateNominal } from './calc.js';
import { utLocations, readingElevations, coursesWithElev, courseAt, fmtElev, getReading, zKey } from './shell.js';
import { floatingLayout, hasFixed, hasFloating, PT5 } from './roof.js';

export const LOADER_VER = 'UTL1';
const UT_METHODS = ['A-scan', 'B-scan', 'C-scan / mapping', 'Thickness gauge', 'Other'];

const K = (v) => ({ v, s: ST.key });
const H = (v) => ({ v, s: ST.hdr });
const L = (v) => ({ v, s: ST.lbl });
const LB = (v) => ({ v, s: ST.lblB });
const N = (v) => ({ v, s: ST.num });

/** Which UT areas this job has. */
export function loaderAreas(job) {
  const a = [];
  if ((job.shell?.courses || []).length && readingElevations(job).length) a.push('Shell');
  if ((job.nozzles || []).length) a.push('Nozzles');
  if (hasFixed(job) && (job.roof.fixed.pts || []).length) a.push('Fixed roof');
  if (hasFloating(job) && floatingLayout(job).plates.some((p) => p.kind !== 'annular')) a.push('Floating roof');
  if ((job.indications || []).length) a.push('Floor prove-up');
  return a;
}

export async function buildLoader(job) {
  const U = u(job), tDec = U.tDec + 1;
  const tv = (mm) => (mm === null || mm === undefined || mm === '' || !Number.isFinite(+mm) ? null : +fromMm(+mm, 't', job).toFixed(tDec));
  const IN = (mm) => ({ v: tv(mm), s: ST.in });
  const RO = (mm) => ({ v: tv(mm), s: ST.ro });
  const maxT = job.units === 'metric' ? 80 : 3;
  const dvT = (sqref) => ({ sqref, min: 0, max: maxT, error: `Enter the thickness in ${U.small} (0 to ${maxT}).`, promptTitle: 'UT reading', prompt: `Thickness in ${U.small}` });
  const tankName = job.info.tankId || 'Tank';
  const areas = loaderAreas(job);
  const sheets = [];
  const title = (t, note) => [[null, { v: `${t} — ${tankName}`, s: ST.title }], [null, { v: note, s: ST.note }]];

  /* Info */
  const info = [
    [null, { v: 'UT loader sheet', s: ST.title }],
    [null, { v: 'Fill in the yellow cells, save, and return this file to the inspector.', s: ST.note }],
    [],
    [K('tank'), LB('Tank'), L(tankName)],
    [K('client'), LB('Client / site'), L([job.info.client, job.info.site].filter(Boolean).join(' · '))],
    [K('report'), LB('Report no.'), L(job.info.reportNo || '')],
    [K('job'), LB('Job ID'), L(job.id)],
    [K('ver'), LB('Loader version'), L(LOADER_VER)],
    [K('units'), LB('Units'), L(job.units === 'metric' ? 'metric (thickness in millimetres)' : 'imperial (thickness in inches)')],
    [K('gen'), LB('Generated'), L(new Date().toLocaleString())],
    [],
    [null, { v: 'Completed by the UT technician', s: ST.sub }],
    [K('tech'), LB('UT technician'), { v: job.info.utTech || '', s: ST.inTxt }],
    [K('instr'), LB('UT instrument'), { v: [job.equip?.utMake, job.equip?.utModel].filter(Boolean).join(' '), s: ST.inTxt }],
    [K('serial'), LB('Serial no.'), { v: job.equip?.utSerial || '', s: ST.inTxt }],
    [K('probe'), LB('Probe'), { v: job.equip?.utProbe || '', s: ST.inTxt }],
    [K('date'), LB('Date of readings'), { v: job.info.utDate || '', s: ST.inTxt }],
    [],
    [null, { v: 'Instructions', s: ST.sub }],
    [null, `1. Enter readings in the yellow cells only, in ${U.small === 'in' ? 'inches' : 'millimetres'}${U.small === 'in' ? ' (e.g. 0.245)' : ' (e.g. 6.2)'}.`],
    [null, '2. Leave a cell blank if no reading was taken. Blank cells do not erase readings already in the report.'],
    [null, '3. A reading below the minimum thickness turns red — check it before returning the sheet.'],
    [null, '4. Do not rename the sheets, insert or delete rows or columns, or unhide the hidden ID columns.'],
    [null, '5. Return the file to the inspector, who uploads it in the app (Export → Upload UT loader sheet).'],
    [],
    [null, { v: `Sheets in this file: ${areas.join(', ') || 'none — the tank has no UT areas set up yet'}.`, s: ST.note }]
  ];
  sheets.push({ name: 'Info', rows: info, cols: [{ w: 8, hidden: true }, { w: 22 }, { w: 60 }] });

  /* Shell */
  if (areas.includes('Shell')) {
    const locs = utLocations(job), courses = coursesWithElev(job), zs = readingElevations(job);
    const c0 = 4, cNom = c0 + locs.length, cMin = cNom + 1, r0 = 4;
    const rows = title('Shell UT readings', `Thickness in ${U.small}. One reading at each station (column) at each elevation (row). Elevation is above the bottom of the shell.`);
    rows.push({ hidden: true, cells: [K('#KEY'), null, null, null, ...locs.map((l) => K('a:' + l.key))] });
    rows.push({ ht: 32, cells: [null, H(`Elevation (${U.small})`), H('Elevation'), H('Course'), ...locs.map((l) => H(`${l.label}\n${l.angle.toFixed(1)}°`)), H(`Nominal (${U.small})`), H(`t-min (${U.small})`)] });
    for (const z of zs) {
      const c = courseAt(courses, z);
      rows.push([K('z:' + zKey(z)), N(+fromMm(z, 'small', job).toFixed(2)), L(fmtElev(z, job)), L(c ? c.no : ''), ...locs.map((l) => IN(getReading(job, l.key, z))), RO(c?.tNom), RO(c?.tMin)]);
    }
    const last = r0 + zs.length - 1;
    const rng = `${ref(r0, c0)}:${ref(last, cNom - 1)}`;
    sheets.push({ name: 'Shell', rows, freeze: { r: r0, c: c0 }, landscape: true,
      cols: [{ w: 8, hidden: true }, { w: 11 }, { w: 10 }, { w: 8 }, ...locs.map(() => ({ w: 10 })), { w: 11 }, { w: 11 }],
      dv: [dvT(rng)], cf: [{ sqref: rng, formula: `AND(ISNUMBER(${ref(r0, c0)}),${ref(r0, c0)}<$${ref(r0, cMin).replace(/\d+$/, '')}${r0 + 1})` }] });
  }

  /* Nozzles */
  if (areas.includes('Nozzles')) {
    const list = (job.nozzles || []).slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0));
    const rows = title('Nozzle neck UT readings', `Thickness in ${U.small}, at 12, 3, 6 and 9 o'clock looking at the nozzle from outside the tank.`);
    rows.push({ hidden: true, cells: [K('#KEY'), null, null, null, null, null, null, null, ...UT_CLOCK.map(([k]) => K(k))] });
    rows.push({ ht: 32, cells: [null, H('Mark'), H('Type'), H('Service'), H('Angle (°)'), H(`Size (${U.small})`), H(`Nominal (${U.small})`), H(`t-min (${U.small})`), ...UT_CLOCK.map(([, l]) => H(`${l} o'clock`))] });
    for (const n of list) rows.push([K('nz:' + n.id), LB(n.mark || ''), L(n.type || ''), L(n.service || ''), N(n.angle != null && n.angle !== '' ? +n.angle : null), N(n.size ? +fromMm(n.size, 'small', job).toFixed(2) : null), RO(n.tNom), RO(n.tMin), ...UT_CLOCK.map(([k]) => IN(n[k]))]);
    const r0 = 4, last = r0 + list.length - 1, rng = `${ref(r0, 8)}:${ref(last, 11)}`;
    sheets.push({ name: 'Nozzles', rows, freeze: { r: r0, c: 2 }, cols: [{ w: 8, hidden: true }, { w: 9 }, { w: 18 }, { w: 22 }, { w: 9 }, { w: 9 }, { w: 11 }, { w: 11 }, { w: 11 }, { w: 11 }, { w: 11 }, { w: 11 }],
      dv: [dvT(rng)], cf: [{ sqref: rng, formula: `AND(ISNUMBER(I5),I5<$H5)` }] });
  }

  /* Fixed roof */
  if (areas.includes('Fixed roof')) {
    const Fx = job.roof.fixed, pts = Fx.pts || [];
    const rows = title('Fixed roof UT readings', `Thickness in ${U.small}. Points are located by angle (clockwise from 0°) and distance from the roof centre.`);
    rows.push({ hidden: true, cells: [K('#KEY'), null, null, null, K('t')] });
    rows.push({ ht: 32, cells: [null, H('Point'), H('Angle (°)'), H(`From centre (${U.big})`), H(`Reading (${U.small})`), H(`Nominal (${U.small})`), H(`t-min (${U.small})`)] });
    for (const p of pts) rows.push([K('fp:' + p.id), LB(p.label || ''), N(p.angle != null && p.angle !== '' ? +p.angle : null), N(p.r != null ? +fromMm(p.r, 'big', job).toFixed(2) : null), IN(p.t), RO(Fx.tNom), RO(Fx.tMin)]);
    const r0 = 4, last = r0 + pts.length - 1, rng = `${ref(r0, 4)}:${ref(last, 4)}`;
    sheets.push({ name: 'Fixed roof', rows, freeze: { r: r0, c: 2 }, cols: [{ w: 8, hidden: true }, { w: 10 }, { w: 10 }, { w: 14 }, { w: 13 }, { w: 12 }, { w: 12 }],
      dv: [dvT(rng)], cf: [{ sqref: rng, formula: 'AND(ISNUMBER(E5),E5<$G5)' }] });
  }

  /* Floating roof */
  if (areas.includes('Floating roof')) {
    const F = job.roof.floating, deck = floatingLayout(job).plates.filter((p) => p.kind !== 'annular');
    const rows = title('Floating roof deck UT readings', `Thickness in ${U.small}. Five readings per deck plate: top-left, top-right, centre, bottom-left, bottom-right as the plate is drawn on the roof plan.`);
    rows.push({ hidden: true, cells: [K('#KEY'), null, ...PT5.map(([k]) => K(k))] });
    rows.push({ ht: 32, cells: [null, H('Plate'), ...PT5.map(([, l]) => H(l)), H(`Nominal (${U.small})`), H(`t-min (${U.small})`)] });
    for (const p of deck) rows.push([K('fl:' + p.key), LB(p.label + (p.cut ? ' (cut)' : '')), ...PT5.map(([k]) => IN(F.ut?.[p.key]?.[k])), RO(F.deckNom), RO(F.deckMin)]);
    const r0 = 4, last = r0 + deck.length - 1, rng = `${ref(r0, 2)}:${ref(last, 6)}`;
    sheets.push({ name: 'Floating roof', rows, freeze: { r: r0, c: 2 }, cols: [{ w: 8, hidden: true }, { w: 11 }, { w: 11 }, { w: 11 }, { w: 11 }, { w: 11 }, { w: 11 }, { w: 12 }, { w: 12 }],
      dv: [dvT(rng)], cf: [{ sqref: rng, formula: 'AND(ISNUMBER(C5),C5<$I5)' }] });
  }

  /* Floor prove-up */
  if (areas.includes('Floor prove-up')) {
    const lay = buildLayout(job);
    const inds = (job.indications || []).slice().sort((a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
    const rows = title('Floor MFL indication UT prove-up', `Minimum remaining thickness in ${U.small} at each MFL indication. Locate each one by plate and X / Y from the plate's datum corner (${U.small}).`);
    rows.push({ hidden: true, cells: [K('#KEY'), null, null, null, null, null, null, K('utMin'), K('utMethod')] });
    rows.push({ ht: 32, cells: [null, H('Indication'), H('Plate'), H(`X (${U.small})`), H(`Y (${U.small})`), H('MFL est. loss (%)'), H(`Nominal (${U.small})`), H(`UT min remaining (${U.small})`), H('UT method')] });
    for (const i of inds) {
      const p = lay.byKey.get(i.plate);
      rows.push([K('ind:' + i.id), LB(i.no || ''), L(p?.label || ''), N(i.x != null ? +fromMm(i.x, 'small', job).toFixed(2) : null), N(i.y != null ? +fromMm(i.y, 'small', job).toFixed(2) : null), N(i.mflPct ?? null), RO(i.utNom ?? plateNominal(job, p)), IN(i.utMin), { v: i.utMethod || '', s: ST.inTxt }]);
    }
    const r0 = 4, last = r0 + inds.length - 1;
    sheets.push({ name: 'Floor prove-up', rows, freeze: { r: r0, c: 2 }, cols: [{ w: 8, hidden: true }, { w: 11 }, { w: 9 }, { w: 9 }, { w: 9 }, { w: 11 }, { w: 12 }, { w: 15 }, { w: 16 }],
      dv: [dvT(`${ref(r0, 7)}:${ref(last, 7)}`), { sqref: `${ref(r0, 8)}:${ref(last, 8)}`, list: UT_METHODS }] });
  }

  return writeXlsx(sheets, { tFmt: job.units === 'metric' ? '0.00' : '0.000', title: `UT loader — ${tankName}` });
}

/* ---------------------------------------------------------------------------- import --- */

function keyed(sheet) {
  if (!sheet) return null;
  let keyRow = null;
  for (const [r, cells] of sheet.rows) if (cells.get(0) === '#KEY') { keyRow = r; break; }
  const colKeys = new Map();
  if (keyRow !== null) for (const [c, v] of sheet.rows.get(keyRow)) if (c > 0 && typeof v === 'string') colKeys.set(c, v);
  const rows = [];
  for (const [r, cells] of sheet.rows) {
    const k = cells.get(0);
    if (r === keyRow || typeof k !== 'string' || !k.includes(':')) continue;
    rows.push({ r, key: k, cells });
  }
  return { colKeys, rows };
}

/**
 * Read a completed loader sheet and work out what would change. Nothing is changed until apply() runs.
 * Returns { info, jobMatch, summary: [{area, added, changed}], errors: [text], unmatched, total, apply }.
 */
export async function readLoader(job, buf) {
  const book = await readXlsx(buf);
  const by = new Map(book.map((s) => [s.name, s]));
  const infoS = by.get('Info');
  if (!infoS) throw new Error('This is not a UT loader sheet — it has no Info sheet.');
  const info = {};
  for (const [, cells] of infoS.rows) { const k = cells.get(0); if (typeof k === 'string') info[k] = cells.get(2); }
  if (info.ver !== LOADER_VER) throw new Error('This is not a UT loader sheet from this app (or it is from a different version).');
  const units = String(info.units || '').startsWith('metric') ? 'metric' : 'imperial';
  const lu = { units };
  const errors = [], ops = [], summary = new Map();
  let unmatched = 0;
  const tally = (area, kind) => { const s = summary.get(area) || { area, added: 0, changed: 0 }; s[kind]++; summary.set(area, s); };
  const same = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(+a - +b) < 1e-6;

  const readT = (raw, where) => {
    if (raw === null || raw === undefined || raw === '') return null;
    let v = raw;
    if (typeof v === 'string') { const s = v.trim().replace(',', '.'); if (!s) return null; if (!/^-?\d*\.?\d+$/.test(s)) { errors.push(`${where}: "${v}" is not a number`); return undefined; } v = +s; }
    if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${where}: not a number`); return undefined; }
    if (v < 0) { errors.push(`${where}: negative reading ${v}`); return undefined; }
    return toMm(v, 't', lu);
  };
  const stage = (area, where, oldV, raw, set) => {
    const v = readT(raw, where); if (v === null || v === undefined) return;
    const nv = Math.round(v * 10000) / 10000;
    if (same(oldV, nv)) return;
    tally(area, oldV === null || oldV === undefined || oldV === '' ? 'added' : 'changed');
    ops.push(() => set(nv));
  };

  /* Shell */
  const sh = keyed(by.get('Shell'));
  if (sh) {
    const locs = new Map(utLocations(job).map((l) => [l.key, l]));
    for (const row of sh.rows) {
      if (!row.key.startsWith('z:')) continue;
      const zk = row.key.slice(2);
      for (const [c, ck] of sh.colKeys) {
        if (!ck.startsWith('a:')) continue;
        const ak = ck.slice(2), raw = row.cells.get(c);
        if (raw === undefined) continue;
        const where = `Shell ${locs.get(ak)?.label || ak + '°'} at ${fmtElevKey(+zk, job)}`;
        stage('Shell', where, job.shell?.rd?.[ak]?.[zk], raw, (v) => { const rd = (job.shell.rd = job.shell.rd || {}); (rd[ak] = rd[ak] || {})[zk] = v; });
      }
    }
  }

  /* Nozzles */
  const nz = keyed(by.get('Nozzles'));
  if (nz) {
    for (const row of nz.rows) {
      if (!row.key.startsWith('nz:')) continue;
      const n = (job.nozzles || []).find((x) => x.id === row.key.slice(3));
      if (!n) { unmatched++; continue; }
      for (const [c, k] of nz.colKeys) { const raw = row.cells.get(c); if (raw === undefined) continue; stage('Nozzles', `Nozzle ${n.mark || ''} ${k.replace('ut', '')} o'clock`, n[k], raw, (v) => { n[k] = v; }); }
    }
  }

  /* Fixed roof */
  const fx = keyed(by.get('Fixed roof'));
  if (fx) {
    for (const row of fx.rows) {
      if (!row.key.startsWith('fp:')) continue;
      const p = (job.roof?.fixed?.pts || []).find((x) => x.id === row.key.slice(3));
      if (!p) { unmatched++; continue; }
      for (const [c] of fx.colKeys) { const raw = row.cells.get(c); if (raw === undefined) continue; stage('Fixed roof', `Fixed roof ${p.label || ''}`, p.t, raw, (v) => { p.t = v; }); }
    }
  }

  /* Floating roof */
  const fl = keyed(by.get('Floating roof'));
  if (fl) {
    const lay = floatingLayout(job);
    for (const row of fl.rows) {
      if (!row.key.startsWith('fl:')) continue;
      const key = row.key.slice(3), p = lay.byKey.get(key);
      if (!p || p.kind === 'annular') { unmatched++; continue; }
      for (const [c, k] of fl.colKeys) {
        const raw = row.cells.get(c); if (raw === undefined) continue;
        stage('Floating roof', `Deck plate ${p.label} ${k.toUpperCase()}`, job.roof.floating.ut?.[key]?.[k], raw, (v) => { const ut = (job.roof.floating.ut = job.roof.floating.ut || {}); (ut[key] = ut[key] || {})[k] = v; });
      }
    }
  }

  /* Floor prove-up */
  const fp = keyed(by.get('Floor prove-up'));
  if (fp) {
    for (const row of fp.rows) {
      if (!row.key.startsWith('ind:')) continue;
      const ind = (job.indications || []).find((x) => x.id === row.key.slice(4));
      if (!ind) { unmatched++; continue; }
      for (const [c, k] of fp.colKeys) {
        const raw = row.cells.get(c); if (raw === undefined) continue;
        if (k === 'utMethod') {
          const s = String(raw).trim();
          if (s && s !== (ind.utMethod || '')) { tally('Floor prove-up', ind.utMethod ? 'changed' : 'added'); ops.push(() => { ind.utMethod = s; }); }
        } else stage('Floor prove-up', `Indication ${ind.no}`, ind.utMin, raw, (v) => { ind.utMin = v; });
      }
    }
  }

  /* technician details from the Info sheet */
  const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const infoOps = [];
  if (txt(info.tech) && txt(info.tech) !== (job.info.utTech || '')) infoOps.push(() => { job.info.utTech = txt(info.tech); });
  if (txt(info.date) && txt(info.date) !== (job.info.utDate || '')) infoOps.push(() => { job.info.utDate = txt(info.date); });
  if (txt(info.serial) && txt(info.serial) !== (job.equip?.utSerial || '')) infoOps.push(() => { job.equip.utSerial = txt(info.serial); });
  if (txt(info.probe) && txt(info.probe) !== (job.equip?.utProbe || '')) infoOps.push(() => { job.equip.utProbe = txt(info.probe); });
  const instr = txt(info.instr), cur = [job.equip?.utMake, job.equip?.utModel].filter(Boolean).join(' ');
  if (instr && instr !== cur) infoOps.push(() => { job.equip.utMake = ''; job.equip.utModel = instr; });

  const list = [...summary.values()];
  return {
    info, jobMatch: info.job === job.id, units,
    summary: list, total: list.reduce((a, s) => a + s.added + s.changed, 0), errors, unmatched, infoChanges: infoOps.length,
    apply() { job.equip = job.equip || {}; ops.forEach((f) => f()); infoOps.forEach((f) => f()); }
  };
}

const fmtElevKey = (z, job) => fmtElev(z, job);
