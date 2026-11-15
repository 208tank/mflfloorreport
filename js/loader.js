// UT loader sheet: an Excel workbook built from the job for the UT technician to fill in, and the
// matching import that writes the readings back into the job.
import { utKit } from './equipment.js';
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
  const kit = utKit(job);
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
    [K('instr'), LB('UT instrument'), { v: [kit.ut?.make, kit.ut?.model].filter(Boolean).join(' '), s: ST.inTxt }],
    [K('serial'), LB('Serial no.'), { v: kit.ut?.serial || '', s: ST.inTxt }],
    [K('probe'), LB('Probe'), { v: [kit.probe?.make, kit.probe?.model, kit.probe?.details].filter(Boolean).join(' ') || '', s: ST.inTxt }],
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

/** Loader statuses (data integrity stage 10). */
export const LOADER_STATUS = { new: 'New', same: 'Same', changed: 'Changed', conflict: 'Conflict', unmatched: 'Not in this job', unreadable: 'Unreadable' };

/**
 * Read a completed loader sheet and list every reading in it against the job. Nothing is changed until apply().
 * opts.verified(item) → is the job's current value a verified measurement? A sheet value that differs from a verified
 * one is a 'conflict' and needs a decision; one that differs from an unverified value is 'changed'.
 * Returns { info, jobMatch, units, items, errors, apply(decisions) }.
 *  item: { id, area, where, old, value, kind: 'num' | 'text', status, get(job) → the value in any version of the job }
 *  decisions: Map(item id → 'sheet' | 'keep' | 'skip'); only 'sheet' changes the job. Blank cells are never listed.
 */
export async function readLoader(job, buf, { verified = () => false } = {}) {
  const book = await readXlsx(buf);
  const by = new Map(book.map((s) => [s.name, s]));
  const infoS = by.get('Info');
  if (!infoS) throw new Error('This is not a UT loader sheet — it has no Info sheet.');
  const info = {};
  for (const [, cells] of infoS.rows) { const k = cells.get(0); if (typeof k === 'string') info[k] = cells.get(2); }
  if (info.ver !== LOADER_VER) throw new Error('This is not a UT loader sheet from this app (or it is from a different version).');
  const units = String(info.units || '').startsWith('metric') ? 'metric' : 'imperial';
  const lu = { units };
  const errors = [], items = [], sets = new Map();
  const empty = (v) => v === null || v === undefined || v === '';
  const same = (a, b, kind) => (kind === 'text' ? String(a ?? '') === String(b ?? '') : !empty(a) && !empty(b) && Math.abs(+a - +b) < 1e-6);

  const readT = (raw, where) => {
    if (raw === null || raw === undefined || raw === '') return null;
    let v = raw;
    if (typeof v === 'string') { const s = v.trim().replace(',', '.'); if (!s) return null; if (!/^-?\d*\.?\d+$/.test(s)) { errors.push(`${where}: "${v}" is not a number`); return undefined; } v = +s; }
    if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${where}: not a number`); return undefined; }
    if (v < 0) { errors.push(`${where}: negative reading ${v}`); return undefined; }
    return toMm(v, 't', lu);
  };
  const push = (it, set) => {
    const old = it.get(job);
    it.old = empty(old) ? null : old;
    it.status = it.old === null ? 'new' : same(it.old, it.value, it.kind) ? 'same' : verified(it) ? 'conflict' : 'changed';
    items.push(it); sets.set(it.id, set);
  };
  const stage = (id, area, where, get, raw, set) => {
    const v = readT(raw, where);
    if (v === null) return; // blank: never erases a reading
    if (v === undefined) { items.push({ id, area, where, old: get(job) ?? null, value: raw, kind: 'num', status: 'unreadable', message: errors.at(-1), get }); return; }
    push({ id, area, where, value: Math.round(v * 10000) / 10000, kind: 'num', get }, set);
  };
  const unmatched = (area, row) => items.push({ id: `${area}|${row.key}`, area, where: String(row.cells.get(1) ?? row.key).trim() || row.key, old: null, value: null, kind: 'num', status: 'unmatched', get: () => null });

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
        stage(`sh:${ak}:${zk}`, 'Shell', where, (j) => j.shell?.rd?.[ak]?.[zk], raw, (v) => { const rd = (job.shell.rd = job.shell.rd || {}); (rd[ak] = rd[ak] || {})[zk] = v; });
      }
    }
  }

  /* Nozzles */
  const nz = keyed(by.get('Nozzles'));
  if (nz) {
    for (const row of nz.rows) {
      if (!row.key.startsWith('nz:')) continue;
      const nid = row.key.slice(3), n = (job.nozzles || []).find((x) => x.id === nid);
      if (!n) { unmatched('Nozzles', row); continue; }
      for (const [c, k] of nz.colKeys) {
        const raw = row.cells.get(c); if (raw === undefined) continue;
        stage(`nz:${nid}:${k}`, 'Nozzles', `Nozzle ${n.mark || ''} ${k.replace('ut', '')} o'clock`, (j) => (j.nozzles || []).find((x) => x.id === nid)?.[k], raw, (v) => { n[k] = v; });
      }
    }
  }

  /* Fixed roof */
  const fx = keyed(by.get('Fixed roof'));
  if (fx) {
    for (const row of fx.rows) {
      if (!row.key.startsWith('fp:')) continue;
      const pid = row.key.slice(3), p = (job.roof?.fixed?.pts || []).find((x) => x.id === pid);
      if (!p) { unmatched('Fixed roof', row); continue; }
      for (const [c] of fx.colKeys) {
        const raw = row.cells.get(c); if (raw === undefined) continue;
        stage(`fp:${pid}`, 'Fixed roof', `Fixed roof ${p.label || ''}`, (j) => (j.roof?.fixed?.pts || []).find((x) => x.id === pid)?.t, raw, (v) => { p.t = v; });
      }
    }
  }

  /* Floating roof */
  const fl = keyed(by.get('Floating roof'));
  if (fl) {
    const lay = floatingLayout(job);
    for (const row of fl.rows) {
      if (!row.key.startsWith('fl:')) continue;
      const key = row.key.slice(3), p = lay.byKey.get(key);
      if (!p || p.kind === 'annular') { unmatched('Floating roof', row); continue; }
      for (const [c, k] of fl.colKeys) {
        const raw = row.cells.get(c); if (raw === undefined) continue;
        stage(`fl:${key}:${k}`, 'Floating roof', `Deck plate ${p.label} ${k.toUpperCase()}`, (j) => j.roof?.floating?.ut?.[key]?.[k], raw, (v) => { const ut = (job.roof.floating.ut = job.roof.floating.ut || {}); (ut[key] = ut[key] || {})[k] = v; });
      }
    }
  }

  /* Floor prove-up */
  const fp = keyed(by.get('Floor prove-up'));
  if (fp) {
    for (const row of fp.rows) {
      if (!row.key.startsWith('ind:')) continue;
      const iid = row.key.slice(4), ind = (job.indications || []).find((x) => x.id === iid);
      if (!ind) { unmatched('Floor prove-up', row); continue; }
      const getI = (j) => (j.indications || []).find((x) => x.id === iid);
      for (const [c, k] of fp.colKeys) {
        const raw = row.cells.get(c); if (raw === undefined) continue;
        if (k === 'utMethod') {
          const t = String(raw).trim();
          if (t) push({ id: `ind:${iid}:utMethod`, area: 'Floor prove-up', where: `Indication ${ind.no} method`, value: t, kind: 'text', get: (j) => getI(j)?.utMethod || '' }, (v) => { ind.utMethod = v; });
        } else stage(`ind:${iid}:utMin`, 'Floor prove-up', `Indication ${ind.no}`, (j) => getI(j)?.utMin, raw, (v) => { ind.utMin = v; });
      }
    }
  }

  /* technician and instrument details from the Info sheet */
  const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const AREA = 'UT technician and instrument';
  const text = (id, where, raw, get, set) => { const t = txt(raw); if (t) push({ id, area: AREA, where, value: t, kind: 'text', get: (j) => get(j) || '' }, set); };
  text('info:tech', 'UT technician', info.tech, (j) => j.info?.utTech, (v) => { job.info.utTech = v; });
  text('info:date', 'UT date', info.date, (j) => j.info?.utDate, (v) => { job.info.utDate = v; });
  text('info:serial', 'Instrument serial', info.serial, (j) => utKit(j).ut?.serial, (v) => { utKit(job, true).ut.serial = v; });
  text('info:probe', 'Probe', info.probe, (j) => { const k = utKit(j).probe; return [k?.make, k?.model, k?.details].filter(Boolean).join(' '); }, (v) => { const p = utKit(job, true).probe; p.make = ''; p.model = v; p.details = ''; });
  text('info:instr', 'Instrument', info.instr, (j) => { const k = utKit(j).ut; return [k?.make, k?.model].filter(Boolean).join(' '); }, (v) => { const u = utKit(job, true).ut; u.make = ''; u.model = v; });

  return {
    info, jobMatch: info.job === job.id, units, items, errors,
    /** Apply the readings decided 'sheet'. Resolves the number changed. */
    apply(decisions) {
      let n = 0;
      for (const it of items) if (decisions.get(it.id) === 'sheet' && sets.has(it.id)) { sets.get(it.id)(it.value); n++; }
      return n;
    },
  };
}

/** The decision each item starts with: new and changed readings use the sheet (they can be unticked), a conflict
 *  waits for a choice, everything else is left alone. */
export function defaultDecisions(items) {
  return new Map(items.map((it) => [it.id, it.status === 'new' || it.status === 'changed' ? 'sheet' : it.status === 'conflict' ? '' : 'skip']));
}

const fmtElevKey = (z, job) => fmtElev(z, job);
