// Builds tests/small/small-tank.json: a 21.5 ft field tank on the small tank template (stage S2),
// used by the small tank calculation tests, the hand check and (from S3) the small report tests. Run: node tests/tools/make-small-fixture.mjs
import { writeFileSync } from 'node:fs';
import { newJob, migrate } from '../../js/model.js';
import { buildLayout } from '../../js/geometry.js';
import { utLocations, readingElevations, zKey, coursesWithElev } from '../../js/shell.js';

const IN = 25.4, FT = 304.8, T0 = 1794800000000;
let seq = 0; const id = (p) => `${p}${String(++seq).padStart(4, '0')}`;
const j = newJob('imperial');
j.id = 'small-tank-fixture'; j.created = j.updated = T0;
Object.assign(j.info, { client: 'Prairie Midstream Ltd.', site: '04-12-045-23 W4M', location: 'Battery 7', tankId: 'T-3', product: 'Produced water', service: 'Storage',
  reportNo: 'ST-2026-031', workOrder: 'WO-7781', jobNo: 'J-2041', poNo: 'PO-5520', inspDate: '2026-11-16', zeroRef: 'N' });
Object.assign(j.tank, { diameter: 21.5 * FT, height: 24 * FT, tBottom: 0.25 * IN, bottomType: 'Lap welded', coating: 'None', yearBuilt: '1996', code: 'API 650', sg: 1.02, fillH: 22 * FT,
  maker: 'Acme Tank Works', serialNo: 'AT-96-114', capacity: '1,550 bbl', matFloor: 'A36', matShell: 'A36', matRoof: 'A36' });
Object.assign(j.calc, { years: 30, Or: 10 });
j.template = 'small';
j.shell.courses = [[0.25, 8], [0.1875, 8], [0.1875, 8]].map(([t, h]) => ({ id: id('c'), h: h * FT, tNom: t * IN, pn: 3 }));
// shell UT: every station at a few elevations per course; the thinnest reading per course is set below
const locs = utLocations(j), zs = readingElevations(j), cw = coursesWithElev(j);
const minFor = [0.231, 0.180, 0.178], base = [0.246, 0.186, 0.185];
for (const l of locs) j.shell.rd[l.key] = {};
for (const [ci, c] of cw.entries()) {
  const zc = zs.filter((z) => z >= c.z0 && z < c.z1).filter((_, k) => k % 6 === 0);
  zc.forEach((z, k) => locs.forEach((l, li) => { j.shell.rd[l.key][zKey(z)] = (k === 1 && li === 2 ? minFor[ci] : base[ci] - 0.001 * ((k + li) % 3)) * IN; }));
}
j.roof.type = 'fixed';
Object.assign(j.roof.fixed, { kind: 'Cone roof', support: 'Self supported', tNom: 0.1875 * IN, tMin: 0.09 * IN,
  pts: [[0, 0, 0.180], [0, 8, 0.172], [90, 8, 0.150], [180, 8, 0.165], [270, 8, 0.176]].map(([a, r, t], i) => ({ id: id('p'), label: i ? `R${i}` : 'CTR', angle: a, r: r * FT, t: t * IN })) });
j.nozzles = [{ id: id('n'), mark: 'N1', type: 'Water draw / drain', angle: 200, size: 3 * IN, elev: 6 * IN, service: 'Drain' }, { id: id('n'), mark: 'MH1', type: 'Manway', angle: 90, size: 24 * IN, elev: 20 * IN, service: '' }];
const L = buildLayout(j), plates = L.plates.filter((p) => p.kind === 'floor' || p.kind === 'bottom' || p.kind !== 'annular');
const pk = (i) => plates[Math.min(plates.length - 1, i)].key;
j.indications = [
  { no: '001', plate: pk(2), x: 300, y: 400, result: 'ss', utMin: 0.17 * IN, mflPct: 30 },
  { no: '002', plate: pk(4), x: 800, y: 600, result: 'ps', vtDepth: 0.06 * IN, mflPct: 25 },
  { no: '003', plate: pk(6), x: 500, y: 500, result: 'ss', utMin: 0.08 * IN, mflPct: 65 }
].map((i) => ({ id: id('i'), repair: 'auto', created: T0, ...i }));
const s = j.small;
s.title = 'oos';
for (const [k, r] of Object.entries({ 'x-lot': 'good', 'x-proj': 'fair', 'x-shell': 'good', 'x-roof': 'fair', 'x-noz': 'good', 'x-instr': 'good', 'x-opp': 'good', 'x-settle': 'good', 'i-floor': 'poor', 'i-fsw': 'good', 'i-shell': 'good', 'i-roof': 'fair', 'i-noz': 'good', 'i-acc': 'na', 'i-edge': 'good', insul: 'na' })) s.items[k] = { rating: r, text: '' };
s.items['i-floor'].text = 'Soil-side pitting at 003; MFL indications proven up by UT.';
s.proj = [[0.24, 1.0], [0.22, 0.75], [0.09, 0.5], [0.23, 0.25]].map(([t, w], i) => ({ id: id('j'), loc: ['N', 'E', 'S', 'W'][i], t: t * IN, len: w * IN }));
s.opp = [{ id: id('d'), dev: 'PVRV', serial: 'PV-2231', press: '8 oz/in²', vac: '0.5 oz/in²', svc: '2025-06-10' }, { id: id('d'), dev: 'Gauge hatch', serial: 'GH-118', press: '16 oz/in²', vac: '—', svc: '2025-06-10' }];
s.tilt = [[0, 0.10], [-0.25, null], [-0.55, -0.06], [-0.15, 0.02]].map(([e, l], i) => ({ id: id('t'), loc: ['N', 'E', 'S', 'W'][i], elev: e * IN, lean: l === null ? null : l * IN }));
s.edge = [[0.5, 18], [1.75, 20], [1.2, 30], [0.3, 12]].map(([b, r], i) => ({ id: id('e'), st: String(i + 1), max: b * IN, bo: r * IN }));
s.lim = { ...s.lim, edge: 1.5 * IN, edgeDist: 24 * IN, edgeRefs: 'company rule (test)' };
s.followup = 'Clean and dry the floor before the next internal inspection.'; s.fit = 'fit';
const out = migrate(j);
writeFileSync(new URL('../small/small-tank.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('wrote small-tank.json', out.indications.length, 'indications,', Object.keys(out.shell.rd).length, 'stations');
