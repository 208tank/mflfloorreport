// Demo job so the app can be tried without field data.
import { newJob, uid } from './model.js';
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
    { id: uid(), mark: 'MH1', type: 'Manway', angle: 0, size: 24 * IN, elev: 30 * IN, service: 'Shell manway' },
    { id: uid(), mark: 'MH2', type: 'Manway', angle: 180, size: 24 * IN, elev: 30 * IN, service: 'Shell manway' },
    { id: uid(), mark: 'N1', type: 'Inlet', angle: 45, size: 12 * IN, elev: 18 * IN, service: 'Product inlet' },
    { id: uid(), mark: 'N2', type: 'Outlet', angle: 135, size: 12 * IN, elev: 18 * IN, service: 'Product outlet' },
    { id: uid(), mark: 'N3', type: 'Water draw / drain', angle: 182, size: 4 * IN, elev: 6 * IN, service: 'Water draw to sump' },
    { id: uid(), mark: 'CO1', type: 'Clean-out door', angle: 270, size: 48 * IN, elev: 24 * IN, service: 'Flush clean-out' }
  ];
  const sump = layout.plates.find((p) => p.key === job.features[0].plate);
  if (sump) job.plates[sump.key] = { scan: 'partial', notes: 'Around sump not scannable' };
  const p2 = at(18, 112).plate; job.plates[p2] = { ...(job.plates[p2] || {}), scan: 'partial', notes: 'Patch plate' };
  return job;
}
