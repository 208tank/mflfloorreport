// Floor UT thickness survey (schema 7): selected areas, critical zone and lower shell scans, five readings per plate,
// and how the readings enter the API 653 evaluation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { migrate, newJob, uid } from '../js/model.js';
import { buildLayout, toLocal } from '../js/geometry.js';
import { api653, czLimitAuto } from '../js/calc.js';
import { czStations, czLastGap, czOrphans, floorUTPoints, shellScans, hasFloorUT, nextAreaNo, areaTypeText } from '../js/floorut.js';
import { validateJobFile } from '../js/validate.js';
import { floorUTCSV } from '../js/export.js';
import { buildReport } from '../js/report.js';
import { renderMapSVG } from '../js/map.js';
import { buildLoader, readLoader, defaultDecisions, loaderAreas } from '../js/loader.js';

const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));
const IN = 25.4, FT = 304.8;
const demo = () => migrate(fixture('demo'));
const calcOf = (j) => { const L = buildLayout(j); return { L, c: api653(j, L) }; };
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test('floor UT: a new job and a migrated job start with an empty survey; schema 7', () => {
  const j = newJob();
  assert.deepEqual(j.floorUT.areas, []);
  assert.equal(j.floorUT.cz.on, false); assert.equal(j.floorUT.plates.on, false);
  near(j.floorUT.cz.size, 6 * IN); near(j.floorUT.cz.spacing, 10 * FT);
  assert.equal(newJob('metric').floorUT.cz.size, 150);
  const m = demo();
  assert.equal(m.schema, 7);
  assert.equal(hasFloorUT(m), false);
});

test('floor UT: no readings changes nothing in the evaluation', () => {
  const a = demo(), b = demo();
  b.floorUT.cz.on = true; b.floorUT.plates.on = true; // switched on, but nothing read
  const ca = calcOf(a).c, cb = calcOf(b).c;
  assert.deepEqual(JSON.parse(JSON.stringify(cb.regions)), JSON.parse(JSON.stringify(ca.regions)));
  assert.equal(cb.K, ca.K);
  assert.equal(cb.ut.pts.length, 0);
});

test('critical zone scans: one every spacing from the start angle; the last gap closes the circle', () => {
  const j = newJob(); j.tank.diameter = 30 * FT;
  j.floorUT.cz = { ...j.floorUT.cz, on: true, spacing: 10 * FT, start: 15 };
  const st = czStations(j), circ = Math.PI * 30 * FT;
  assert.equal(st.length, 10);
  assert.equal(st[0].angle, 15); assert.equal(st[0].no, 'CZ-1');
  near(st[1].angle, 15 + (10 * FT / (15 * FT)) * 180 / Math.PI, 0.05);
  near(czLastGap(j), circ - 9 * 10 * FT);
  // readings follow the angle: change the spacing and an old reading is reported, not lost
  j.floorUT.cz.rd[st[1].key] = { tMin: 6 };
  j.floorUT.cz.spacing = 12 * FT;
  assert.deepEqual(czOrphans(j), [st[1].key]);
  assert.equal(j.floorUT.cz.rd[st[1].key].tMin, 6);
});

test('five readings per plate: the thinnest reading becomes the general thickness of its area', () => {
  const j = demo(); const { L } = calcOf(j);
  const before = calcOf(j).c.regions.find((r) => r.name === 'bottom');
  const p = L.plates.find((q) => q.kind === 'floor' && !q.cut);
  j.floorUT.plates.on = true; j.floorUT.plates.rd[p.key] = { tl: 6.2, tr: 6.1, c: 4.0, bl: 6.3, br: 6.3 };
  const c = calcOf(j).c, r = c.regions.find((x) => x.name === 'bottom');
  assert.equal(r.RTut, 4.0);
  near(r.RT, Math.min(before.RT, 4.0));
  near(r.MRT, r.RT - c.Or * c.K);
  assert.equal(c.ut.pts.filter((q) => q.kind === 'plate').length, 5);
  const ctr = c.ut.pts.find((q) => q.id === `pl:${p.key}:c`);
  near(ctr.projected, 4.0 - c.Or * c.K);
  assert.equal(ctr.status, ctr.projected < ctr.limit - 1e-9 ? 'below MRT' : 'OK');
  assert.equal(c.K, calcOf(demo()).c.K, 'readings with no known side do not change the rates');
  assert.equal(c.trace.regions.bottom.utFrom.no, `${p.label} C`);
});

test('selected area: centre from the plate datum, size, critical when its extent reaches the zone; a known side sets the rate', () => {
  const j = demo(); const { L } = calcOf(j);
  const p = L.plates.find((q) => q.kind === 'floor' && !q.cut);
  const cx = (p.bb.x0 + p.bb.x1) / 2, cy = (p.bb.y0 + p.bb.y1) / 2, loc = toLocal(L, p, cx, cy);
  const a = { id: uid(), no: nextAreaNo(j), plate: p.key, x: loc.X, y: loc.Y, len: 300, wid: 200, tMin: 4.5, tAvg: 5.2, type: 'gen-pit', side: 'ss' };
  j.floorUT.areas.push(a);
  const c = calcOf(j).c, q = c.ut.pts.find((x) => x.id === a.id);
  near(q.floor.x, cx); near(q.floor.y, cy);
  assert.equal(q.critical, false); assert.equal(q.type, 'General pitting');
  const tNom = j.tank.tBottom, loss = tNom - 4.5;
  assert.ok(c.UPr >= loss / c.years - 1e-12);
  if (loss / c.years > calcOf(demo()).c.UPr) { near(c.UPr, loss / c.years); assert.equal(c.upSrc.no, a.no); }
  const bottom = c.regions.find((r) => r.name === 'bottom');
  assert.ok(bottom.RTbc <= 4.5 + 1e-9);
  assert.equal(areaTypeText({ type: 'custom', typeText: 'Weld spatter' }), 'Weld spatter');
  assert.equal(nextAreaNo(j), 'A-2');
});

test('critical zone scan: in the critical zone, against the critical zone limit, and adds the critical zone area', () => {
  const j = migrate(fixture('demo-metric-noannular'));
  const base = calcOf(j).c;
  j.floorUT.cz = { ...j.floorUT.cz, on: true, spacing: 3000, start: 0 };
  const st = czStations(j);
  j.floorUT.cz.rd[st[2].key] = { tMin: 3.0, tAvg: 4.0 };
  const { L, c } = calcOf(j);
  const q = c.ut.pts.find((x) => x.kind === 'cz');
  assert.equal(q.critical, true); assert.equal(q.label, 'CZ-3');
  near(Math.hypot(q.floor.x, q.floor.y), L.R - 75);
  near(q.limit, Math.max(c.czLim, c.mBot));
  const cr = c.regions.find((r) => r.name === 'critical');
  assert.ok(cr, 'critical zone area is evaluated');
  assert.ok(cr.RT <= 3.0 + 1e-9);
  near(c.czLim, czLimitAuto(j));
  assert.ok(base.regions.length <= c.regions.length);
});

test('lower shell scans: same places, compared with the course 1 t-min (60 % rule of §4.3.2.1)', () => {
  const j = demo(); j.floorUT.cz = { ...j.floorUT.cz, on: true, shell: true, spacing: 20 * FT };
  j.shell.courses[0].tMin = 0.2 * IN;
  const st = czStations(j);
  j.floorUT.cz.rd[st[0].key] = { sMin: 0.25 * IN };
  j.floorUT.cz.rd[st[1].key] = { sMin: 0.15 * IN };
  j.floorUT.cz.rd[st[2].key] = { sMin: 0.1 * IN };
  const sh = shellScans(j);
  assert.equal(sh[0].status, 'OK'); assert.equal(sh[1].status, 'Evaluate per §4.3.2'); assert.equal(sh[2].status, 'Below t-min');
  const c = calcOf(j).c;
  assert.ok(c.warnings.some((w) => /Lower shell scans: 2 below/.test(w)));
  j.floorUT.cz.shell = false;
  assert.equal(shellScans(j).length, 0);
});

test('floor UT: map, report, CSV and validation', async () => {
  const j = demo(); const { L } = calcOf(j);
  const p = L.plates.find((q) => q.kind === 'floor' && !q.cut);
  j.floorUT.areas.push({ id: 'ua1', no: 'A-1', plate: p.key, x: 100, y: 100, len: 300, wid: 300, tMin: 1.5, tAvg: 3, type: 'gen-thin', side: '' });
  j.floorUT.cz = { ...j.floorUT.cz, on: true, shell: true }; j.floorUT.cz.rd[czStations(j)[0].key] = { tMin: 5, sMin: 7 };
  j.floorUT.plates.on = true; j.floorUT.plates.rd[p.key] = { c: 5.9 };
  const c = api653(j, L);
  assert.equal(c.ut.pts.find((q) => q.id === 'ua1').status, 'below MRT');
  assert.ok(c.warnings.some((w) => /Floor UT: \d+ reading/.test(w)));
  const svg = renderMapSVG(j, L, { calc: c, floorOf: () => null });
  assert.ok(svg.includes('data-utarea="ua1"') && svg.includes('class="ut-pt"') && svg.includes('class="ut-sh"'));
  assert.ok(!renderMapSVG(j, L, { calc: c, showUT: false, floorOf: () => null }).includes('ut-area'));
  const html = buildReport(j, L, c, { name: 'Test Co' }, [], {});
  assert.ok(html.includes('UT thickness survey') && html.includes('Selected UT areas') && html.includes('Critical zone and lower shell scans') && html.includes('Plate UT readings'));
  assert.ok(html.includes('RT<sub>UT</sub>'));
  const csv = floorUTCSV(j, L, c);
  assert.ok(/Area,A-1,/.test(csv) && /Critical zone scan,CZ-1,/.test(csv) && /Plate reading,Centre,/.test(csv));
  // validation: duplicate ids are an error; a number stored as text is converted
  const bad = structuredClone(j); bad.floorUT.areas.push({ ...bad.floorUT.areas[0] }); bad.floorUT.areas[0].tMin = '1.5';
  const r = await validateJobFile({ format: 'tank-floor-inspector', version: 2, job: bad }, { schema: 7, fileVersion: 2 });
  assert.ok(r.errors.some((e) => /Floor UT areas .*share the id ua1/.test(e)), r.errors.join('\n'));
  assert.ok(r.warnings.some((w) => /Floor UT area A-1: Minimum was stored as the text/.test(w)), r.warnings.join('\n'));
  const wrong = structuredClone(j); wrong.floorUT = [];
  assert.ok((await validateJobFile({ format: 'tank-floor-inspector', version: 2, job: wrong }, { schema: 7, fileVersion: 2 })).errors.some((e) => /floorUT part has the wrong type/.test(e)));
});

test('UT loader sheet: floor UT sheets round-trip', async (t) => {
  if (typeof CompressionStream === 'undefined') { t.skip('no CompressionStream'); return; }
  const j = demo(); const { L } = calcOf(j);
  const p = L.plates.find((q) => q.kind === 'floor' && !q.cut);
  j.floorUT.areas.push({ id: 'ua1', no: 'A-1', plate: p.key, x: 100, y: 100, len: 300, wid: 300, tMin: null });
  j.floorUT.cz = { ...j.floorUT.cz, on: true, shell: true };
  j.floorUT.plates.on = true;
  assert.deepEqual(loaderAreas(j).filter((a) => a.startsWith('Floor ')), ['Floor prove-up', 'Floor UT areas', 'Floor CZ scans', 'Floor plates'].filter((a) => a !== 'Floor prove-up' || (j.indications || []).length));
  // the technician fills in readings: build the sheet from a copy holding them, read it into the job without them
  const filled = structuredClone(j), k0 = czStations(j)[0].key;
  filled.floorUT.areas[0].tMin = 4.5; filled.floorUT.areas[0].tAvg = 5.1;
  filled.floorUT.cz.rd[k0] = { tMin: 5.5, sMin: 7.2 };
  filled.floorUT.plates.rd[p.key] = { tl: 6.0, c: 5.8 };
  const buf = await (await buildLoader(filled)).arrayBuffer();
  assert.ok(buf.byteLength > 1000);
  if (typeof DOMParser === 'undefined') { t.diagnostic('reading the sheet back needs a browser (DOMParser): covered by the browser check "floor UT"'); return; }
  const res = await readLoader(j, buf);
  const ids = res.items.filter((x) => x.status === 'new').map((x) => x.id).sort();
  assert.deepEqual(ids.filter((x) => /^f(ua|cz|pl):/.test(x)), [`fcz:${k0}:sMin`, `fcz:${k0}:tMin`, `fpl:${p.key}:c`, `fpl:${p.key}:tl`, 'fua:ua1:tAvg', 'fua:ua1:tMin'].sort());
  res.apply(defaultDecisions(res.items));
  near(j.floorUT.areas[0].tMin, 4.5, 1e-3); near(j.floorUT.cz.rd[k0].sMin, 7.2, 1e-3); near(j.floorUT.plates.rd[p.key].c, 5.8, 1e-3);
});
