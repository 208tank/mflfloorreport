// Demo job so the app can be tried without field data.
import { newJob, uid } from './model.js';
import { defaultZones, utLocations } from './shell.js';
import { defaultRoof, floatingLayout, PT5 } from './roof.js';
import { buildLayout, plateAt, toLocal, polar } from './geometry.js';

const IN = 25.4, FT = 304.8;

export function makeDemo() {
  const job = newJob('imperial');
  Object.assign(job.info, {
    client: 'Demo Energy Ltd.', site: 'Example Terminal', tankId: 'TK-101', product: 'Diesel', reportNo: 'DEMO-001', workOrder: 'WO-2026-114',
    zeroRef: 'N', mflTech: 'A. Operator', utTech: 'B. Technician', inspector: 'C. Inspector', notes: 'Demonstration data only.'
  });
  Object.assign(job.tank, { diameter: 120 * FT, tBottom: 0.25 * IN, tAnnular: 0.3125 * IN, coating: 'None', cp: false, rpb: false, yearBuilt: '2001' });
  Object.assign(job.layout, { plateW: 8 * FT, plateL: 30 * FT, annular: true, annW: 24 * IN, annN: 32, annStart: 0, stagger: 0.5, refCorner: 'BL' });
  Object.assign(job.equip, { mflMake: 'MFL', mflModel: 'Floor scanner', mflSerial: 'SN-0000', mflThreshold: '20', mflRef: 'Reference plate 0.25 in', utMake: 'UT', utModel: 'Flaw detector', utProbe: '5 MHz dual 10 mm', utBlock: 'Step wedge 0.1–0.5 in', vtTools: 'Pit gauge, light, mirror' });
  Object.assign(job.calc, { years: 25, Or: 10 });

  const layout = buildLayout(job);
  const at = (rFt, deg) => {
    const [x, y] = polar(rFt * FT, deg);
    const p = plateAt(layout, x, y);
    const { X, Y } = toLocal(layout, p, x, y);
    return { plate: p.key, x: Math.round(X / 12.7) * 12.7, y: Math.round(Y / 12.7) * 12.7 };
  };
  const ind = (no, r, a, o) => ({ id: uid(), no, ...at(r, a), result: 'pending', repair: 'auto', created: Date.now(), ...o });
  const t = (v) => v * IN;
  job.indications = [
    ind('001', 10, 40, { mflPct: 35, mflSignal: '62', len: t(1.5), wid: t(1.2), result: 'ss', utMin: t(0.168), utMethod: 'A-scan', vtCond: 'None visible' }),
    ind('002', 22, 75, { mflPct: 25, mflSignal: '41', len: t(0.8), wid: t(0.8), result: 'ps', vtDepth: t(0.06), vtCond: 'Isolated pit' }),
    ind('003', 35, 130, { mflPct: 45, mflSignal: '88', len: t(3), wid: t(2), result: 'ss', utMin: t(0.12), utMethod: 'B-scan', vtCond: 'None visible' }),
    ind('004', 41, 200, { mflPct: 20, mflSignal: '35', result: 'nri', comments: 'Mill scale / debris' }),
    ind('005', 50, 250, { mflPct: 30, mflSignal: '51', len: t(2), wid: t(1), result: 'ps', utMin: t(0.185), vtDepth: t(0.065), utMethod: 'A-scan', vtCond: 'Pitting cluster' }),
    ind('006', 15, 300, { mflPct: 55, mflSignal: '97', len: t(4), wid: t(3), result: 'ss', utMin: t(0.098), utMethod: 'B-scan', vtCond: 'None visible' }),
    ind('007', 58.9, 20, { mflPct: 40, mflSignal: '70', len: t(2), wid: t(1.5), result: 'ss', utMin: t(0.205), utMethod: 'A-scan' }),
    ind('008', 59.85, 95, { mflPct: 30, mflSignal: '55', len: t(1.5), wid: t(1), result: 'ss', utMin: t(0.235), utMethod: 'A-scan', comments: 'Near shell weld' }),
    ind('009', 30, 330, { mflPct: 25, mflSignal: '44', len: t(1), wid: t(1) }),
    ind('010', 45, 170, { mflPct: 60, mflSignal: '104', len: t(5), wid: t(4), result: 'both', utMin: t(0.09), vtDepth: t(0.04), utMethod: 'B-scan', vtCond: 'General corrosion' }),
    ind('011', 5, 220, { mflPct: 20, mflSignal: '33', result: 'other', comments: 'Lamination' }),
    ind('012', 38, 15, { mflPct: 35, mflSignal: '60', len: t(2), wid: t(2), result: 'ss', utMin: t(0.15), utMethod: 'A-scan' }),
    ind('013', 27, 260, { mflPct: 30, mflSignal: '49', len: t(1), wid: t(0.8), result: 'ps', vtDepth: t(0.08), vtCond: 'Isolated pit' }),
    ind('014', 52, 300, { mflPct: 25, mflSignal: '40', len: t(1), wid: t(1) })
  ];
  const feat = (type, label, r, a, A, B) => ({ id: uid(), type, label, ...at(r, a), sizeA: A, sizeB: B ?? A });
  job.features = [
    feat('sump', 'Sump', 52, 180, t(36)),
    feat('column', 'C1', 0.5, 0, t(12)),
    ...[0, 60, 120, 180, 240, 300].map((a, i) => feat('column', `C${i + 2}`, 30, a + 30, t(10))),
    feat('patch', 'Patch (2015)', 20, 110, t(24), t(24))
  ];
  job.nozzles = [
    { id: uid(), mark: 'MH1', type: 'Manway', angle: 0, size: 24 * IN, elev: 30 * IN, service: 'Shell manway', conn: 'RFWN', tNom: 0.5 * IN, tMin: 0.375 * IN, ut12: 0.49 * IN, ut3: 0.488 * IN, ut6: 0.482 * IN, ut9: 0.49 * IN },
    { id: uid(), mark: 'MH2', type: 'Manway', angle: 180, size: 24 * IN, elev: 30 * IN, service: 'Shell manway' },
    { id: uid(), mark: 'N1', type: 'Inlet', angle: 45, size: 12 * IN, elev: 18 * IN, service: 'Product inlet', conn: 'RFWN', sched: 'STD', tNom: 0.375 * IN, tMin: 0.25 * IN, ut12: 0.362 * IN, ut3: 0.358 * IN, ut6: 0.341 * IN, ut9: 0.355 * IN },
    { id: uid(), mark: 'N2', type: 'Outlet', angle: 135, size: 12 * IN, elev: 18 * IN, service: 'Product outlet', conn: 'RFWN', sched: 'STD', tNom: 0.375 * IN, tMin: 0.25 * IN, ut12: 0.366 * IN, ut3: 0.36 * IN, ut6: 0.33 * IN, ut9: 0.361 * IN },
    { id: uid(), mark: 'N3', type: 'Water draw / drain', angle: 182, size: 4 * IN, elev: 6 * IN, service: 'Water draw to sump', conn: 'THD', sched: 'Sch 80', tNom: 0.337 * IN, tMin: 0.2 * IN, ut12: 0.301 * IN, ut3: 0.255 * IN, ut6: 0.188 * IN, ut9: 0.262 * IN, utx: [{ id: uid(), loc: '6 o’clock at shell weld', t: 0.176 * IN }] },
    { id: uid(), mark: 'CO1', type: 'Clean-out door', angle: 270, size: 48 * IN, elev: 24 * IN, service: 'Flush clean-out' }
  ];
  // shell: 5 courses of 8 ft, 13 plates per course, readings at the 8 standard stations using the
  // standard pattern (every 1 in up to 2 ft, then every 1 ft to the top)
  const nom = [0.5, 0.4375, 0.375, 0.3125, 0.25], tmin = [0.39, 0.31, 0.24, 0.16, 0.1];
  job.shell = { courses: nom.map((t, i) => ({ id: uid(), h: 8 * FT, tNom: t * IN, tMin: tmin[i] * IN, pn: 13 })), nLoc: null, start: 0, rd: {}, zones: defaultZones('imperial'), extraZ: [], notes: '' };
  const zs = [];
  for (let k = 1; k <= 24; k++) zs.push(k * IN);
  for (let k = 3; k <= 40; k++) zs.push(k * FT);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let q = 0; q < 8; q++) {
    const key = (q * 45).toFixed(1); job.shell.rd[key] = {};
    for (const z of zs) {
      const ci = Math.min(4, Math.floor(z / (8 * FT) - 1e-9));
      let loss = 0.004 + rnd() * 0.012;
      if (z <= 12 * IN) loss += 0.03 * (1 - z / (12 * IN)) + (q === 6 ? 0.1 * Math.max(0, 1 - Math.abs(z - 3 * IN) / (3 * IN)) : 0); // corrosion near the bottom, worst at 270°
      job.shell.rd[key][(Math.round(z * 10) / 10).toFixed(1)] = Math.round((nom[ci] - loss) * 1000) / 1000 * IN;
    }
  }
  // roof: cone roof on columns with an internal steel pontoon floating roof
  job.roof = defaultRoof('imperial');
  job.roof.type = 'fixed-ifr';
  Object.assign(job.roof.fixed, { kind: 'Cone roof', support: 'Column supported', slope: '3/4 in 12', tNom: 0.1875 * IN });
  const R = 60 * FT;
  job.roof.fixed.pts = [{ id: uid(), label: 'CTR', angle: 0, r: 0, t: 0.181 * IN }];
  for (const l of utLocations(job)) {
    job.roof.fixed.pts.push({ id: uid(), label: `${l.label}-E`, angle: l.angle, r: R - 2 * FT, t: Math.round((0.1875 - 0.01 - rnd() * 0.03 - (l.angle === 135 ? 0.085 : 0)) * 1000) / 1000 * IN });
    job.roof.fixed.pts.push({ id: uid(), label: `${l.label}-M`, angle: l.angle, r: R / 2, t: Math.round((0.1875 - 0.004 - rnd() * 0.012) * 1000) / 1000 * IN });
  }
  Object.assign(job.roof.floating, { kind: 'Internal – steel pontoon', rimGap: 8 * IN, pontW: 5 * FT, pontN: 32, plateW: 6 * FT, plateL: 20 * FT, deckNom: 0.1875 * IN });
  const rl = floatingLayout(job);
  rl.plates.forEach((p, i) => {
    if (p.kind === 'annular') { job.roof.floating.pont[p.key] = { cond: p.label === 'P7' ? 'Liquid present' : 'Dry' }; return; }
    const m = (job.roof.floating.ut[p.key] = {});
    for (const [k] of PT5) m[k] = Math.round((0.1875 - 0.003 - rnd() * 0.014 - (i === 23 && k === 'c' ? 0.1 : 0)) * 1000) / 1000 * IN;
  });
  const sump = layout.plates.find((p) => p.key === job.features[0].plate);
  if (sump) job.plates[sump.key] = { scan: 'partial', notes: 'Around sump not scannable' };
  const p2 = at(18, 112).plate; job.plates[p2] = { ...(job.plates[p2] || {}), scan: 'partial', notes: 'Patch plate' };
  return job;
}
