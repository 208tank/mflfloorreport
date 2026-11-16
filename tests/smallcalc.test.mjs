// Small tank report calculations, stage S2 (js/smallcalc.js): thickness and corrosion rates, intervals, planar tilt,
// edge settlement and floor projections. Hand values below are worked out in the comments; the full independent
// recalculation of the small tank fixture is tests/handcheck/small_handcheck.py (small-handcheck.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate } from '../js/model.js';
import { buildLayout } from '../js/geometry.js';
import { api653 } from '../js/calc.js';
import { smallCalc, rateLife, rlText, addYears, planarTilt } from '../js/smallcalc.js';

const IN = 25.4, FT = 304.8;
const fixture = (n) => migrate(JSON.parse(readFileSync(new URL(n === 'small-tank' ? './small/small-tank.json' : `./fixtures/${n}.json`, import.meta.url), 'utf8')));
const near = (a, b, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg} ${a} ≠ ${b}`);
const run = (j) => smallCalc(j, buildLayout(j));

test('S2: CR, RL and the 30 + rule', () => {
  // 0.25 in nominal, 0.231 in measured, 30 years, 0.10 in t-min: CR = 0.019 / 30, RL = 0.131 / CR = 206.8 years
  const r = rateLife(0.25 * IN, 0.231 * IN, 30, 0.1 * IN);
  near(r.cr, (0.019 * IN) / 30); near(r.rl, 0.131 / (0.019 / 30)); assert.equal(rlText(r.rl, r.cr), '30 +');
  assert.equal(rlText(12.34, 0.1), '12.3');
  const z = rateLife(0.25 * IN, 0.26 * IN, 30, 0.1 * IN); assert.equal(z.cr, 0, 'thicker than nominal: no loss'); assert.equal(z.rl, Infinity); assert.equal(rlText(z.rl, z.cr), '30 +');
  const b = rateLife(0.25 * IN, 0.09 * IN, 30, 0.1 * IN); assert.equal(b.rl, 0, 'below t-min: no remaining life');
  assert.deepEqual(rateLife(0.25 * IN, 0.2 * IN, null, 0.1 * IN), { cr: null, rca: 0.1 * IN, rl: null }, 'no years: rate unknown');
  assert.equal(addYears('2026-11-16', 5), '2031-11-16');
  assert.equal(addYears('2026-11-16', 0.5), '2027-05-18');
  assert.equal(addYears('', 5), '');
});

test('S2: the small tank fixture — thickness table, shell governing course, roof', () => {
  const r = run(fixture('small-tank')), T = r.thick;
  // floor as found: RT 0.08 in (003), K = 0.06/30 + 0.17/30, RL 0 (below the 0.10 in limit); after the repairs RL = (0.19 − 0.10)/K
  near(T.floor.tAct, 0.08 * IN); near(T.floor.cr, (0.06 / 30 + 0.17 / 30) * IN); assert.equal(T.floor.rl, 0);
  near(T.floor.rlAfter, 0.09 / (0.23 / 30));
  assert.equal(T.shell.course, 1, 'course 1 has the shortest life');
  near(T.shell.rl, 0.131 / (0.019 / 30));
  near(T.roof.tAct, 0.15 * IN); near(T.roof.rl, (0.15 - 0.09) / (0.0375 / 30));
  assert.equal(T.courses.length, 3);
  assert.deepEqual(r.proj.map((p) => p.ok), [true, true, false, false], 'S: 0.09 in thick; W: 1/4 in wide');
});

test('S2: API 653 intervals — UT §6.3.3.2, external §6.3.2.1, internal §6.4.2 with and without the repairs', () => {
  const j = fixture('small-tank'), r = run(j), I = r.intervals;
  assert.equal(I.basis, '653');
  assert.equal(I.ut.done.years, 15, 'RCA / 2N is over 15');
  assert.equal(I.ext.done.years, 5);
  near(I.int.done.years, 0.09 / (0.23 / 30)); assert.equal(I.int.not.years, 0, 'not completed: the floor is below its limit');
  assert.equal(I.ut.done.date, '2041-11-16');
  assert.match(I.int.done.src, /§6\.4\.2.*not over 20 years/);
  // a thin shell: RCA / 2N and RCA / 4N govern
  const k = structuredClone(j);
  for (const m of Object.values(k.shell.rd)) for (const z of Object.keys(m)) if (m[z] < 0.24 * IN && m[z] > 0.2 * IN) m[z] = 0.13 * IN;
  const r2 = run(k), g = r2.thick.shell; // course 1: 0.13 in, CR = 0.12/30 = 0.004, RCA 0.03 → UT 3.75 yr, external 1.875 yr
  near(r2.intervals.ut.done.years, 0.03 / (2 * 0.004)); near(r2.intervals.ext.done.years, 0.03 / (4 * 0.004)); assert.equal(g.course, 1);
  // no tank age: the rate is not known — 5 years for UT and external
  const u = structuredClone(j); u.calc.years = null;
  const r3 = run(u); assert.equal(r3.intervals.ut.done.years, 5); assert.match(r3.intervals.ut.done.src, /not known/); assert.equal(r3.intervals.int.done.years, null);
  // a release prevention barrier allows 30 years
  const v = structuredClone(j); v.indications = []; v.tank.rpb = true; v.calc.mflThresholdPct = 0;
  assert.equal(run(v).intervals.int.done.years, 30);
});

test('S2: API 12R1 intervals are the entered maximums, never longer than the remaining life; overrides are kept', () => {
  const j = fixture('small-tank'); j.small.basis.intervals = '12r1';
  let I = run(j).intervals;
  assert.equal(I.ut.done.years, null); assert.match(I.ut.done.src, /not entered/);
  j.small.r12int = { ut: 10, ext: 3, int: 15, refs: 'cl. x.y' };
  I = run(j).intervals;
  assert.equal(I.ut.done.years, 10); assert.equal(I.ext.done.years, 3); assert.match(I.ext.done.src, /API 12R1 maximum entered \(cl\. x\.y\)/);
  near(I.int.done.years, 0.09 / (0.23 / 30)); assert.match(I.int.done.src, /shortened to the remaining life/);
  assert.equal(I.int.not.years, 0);
  j.small.intOv.extDone = '2028-06-01';
  assert.equal(run(j).intervals.ext.done.override, '2028-06-01');
  assert.equal(run(j).intervals.ext.not.override, undefined);
});

test('S2: planar tilt from four stations — plane, twist, plumbness, freeboard, drain', () => {
  const j = fixture('small-tank'), P = planarTilt(j);
  // N 0, E −0.25, S −0.55, W −0.15 in on a 21.5 ft tank, 24 ft shell
  near(P.diff, Math.hypot(0.1, 0.55) * IN);
  near(P.twist, -0.0375 * IN);
  near(P.lowDeg, (Math.atan2(0.1 / (21.5 * FT), -0.55 / (21.5 * FT)) * 180) / Math.PI);
  near(P.plumbElev, (Math.hypot(0.1, 0.55) * IN / (21.5 * FT)) * 24 * FT);
  near(P.leanMax, (0.10 / 48) * 24 * FT, 1e-9, 'largest level reading scaled to the shell');
  near(P.freeboard, P.diff / 2);
  assert.equal(P.drain.mark, 'N1'); assert.equal(P.drain.rel, 'toward');
  const t = run(j).tilt;
  assert.equal(t.status, 'Acceptable'); near(t.plumbLim, 24 * FT / 100); assert.equal(t.limSrc, 'API 653 §10.5.2.1');
  // entered limit and twist trigger
  j.small.lim.plumb = 0.5 * IN; j.small.lim.twist = 0.02 * IN;
  const t2 = run(j).tilt; assert.equal(t2.status, 'Exceeds'); assert.equal(t2.twistOk, false); assert.match(t2.limSrc, /Entered limit/);
  // 12R1 with no limit entered: no pass / fail
  j.small.basis.settle = '12r1'; j.small.lim.plumb = null;
  assert.equal(run(j).tilt.status, 'No limit entered');
  // Annex B basis with no full survey
  j.small.basis.settle = '653';
  assert.equal(run(j).tilt.status, 'No Annex B survey');
  // incomplete stations
  const k = fixture('small-tank'); k.small.tilt[1].elev = null; k.small.tilt.forEach((x) => { x.lean = null; });
  assert.equal(run(k).tilt.status, 'Incomplete');
});

test('S2: edge settlement — entered limit and distance, Annex B, and 12R1 without a limit', () => {
  const j = fixture('small-tank');
  assert.deepEqual(run(j).edge.rows.map((e) => e.status), ['Acceptable', 'Exceeds', 'Beyond the limit’s distance', 'Acceptable']);
  assert.equal(run(j).edge.status, 'Exceeds');
  j.small.lim.edgeDist = null;
  assert.deepEqual(run(j).edge.rows.map((e) => e.status), ['Acceptable', 'Exceeds', 'Acceptable', 'Acceptable']);
  j.small.basis.settle = '12r1'; j.small.lim.edge = null;
  assert.ok(run(j).edge.rows.every((e) => e.status === 'No limit entered'));
  j.small.basis.settle = 'small';
  assert.ok(run(j).edge.rows.every((e) => e.status === 'Reported only'));
  j.small.basis.settle = '653';
  const e = run(j).edge; // Annex B Bew for D = 21.5 ft, lap welds assumed parallel
  assert.ok(e.rows.every((r) => r.allow > 0 && ['Acceptable', 'NDE required', 'Exceeds'].includes(r.status)), JSON.stringify(e.rows));
  assert.match(e.rows[0].src, /Bew/);
});

test('S2: the floor row matches the app’s own API 653 evaluation; the fixture jobs all calculate', () => {
  for (const f of ['demo', 'demo-coated-cp', 'demo-measured', 'demo-metric-noannular', 'demo-repair-overrides', 'demo-rows', 'legacy-schema1', 'small-tank']) {
    const j = fixture(f), L = buildLayout(j), a = api653(j, L), r = smallCalc(j, L, a);
    const life = Math.min(...a.regions.filter((g) => g.OrMax !== null).map((g) => g.OrMax));
    if (Number.isFinite(life)) near(r.thick.floor.rlAfter, Math.max(0, life), 1e-9, f);
    for (const k of ['ut', 'ext', 'int']) for (const w of ['done', 'not']) assert.ok(r.intervals[k][w].src, `${f} ${k} ${w}`);
  }
});
