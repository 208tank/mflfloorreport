// Small tank report, stage S3 (js/report/small.js): the template's order, code / non-code recommendations, the
// numbers equal js/smallcalc.js, ratings and item tables, sign-off; full-report jobs are not affected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate } from '../js/model.js';
import { buildLayout } from '../js/geometry.js';
import { api653 } from '../js/calc.js';
import { buildReport } from '../js/report.js';
import { smallCalc, rlText } from '../js/smallcalc.js';
import { fmt } from '../js/units.js';

const load = (p) => migrate(JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')));
const small = () => {
  const j = load('./small/small-tank.json');
  j.personnel = [{ id: 'p1', role: 'insp653', name: 'C. Inspector', cert: 'API 653', certNo: '12345', expiry: '2020-01-01' }, { id: 'p2', role: 'ut', name: 'U. Tech', cert: 'CGSB', level: '2', method: 'UT' }];
  j.summary.narrative = 'Inspected out of service.\n\nSoil-side pitting found.';
  j.secs.floor.recs.push({ id: 'r1', finding: 'Pitting below 0.10 in at 003', action: 'Patch plate', priority: 'P2', code: true, def: true, no: 'D-001' });
  j.secs.found.recs.push({ id: 'r2', finding: 'Vegetation in containment', action: 'Clear it', priority: 'P4', code: false });
  j.secs.floor.nde.push({ id: 'n1', method: 'MFL floor scan', extent: '100 % accessible', result: 'Indications found' });
  return j;
};
const build = (j, opts = {}) => { const L = buildLayout(j); return buildReport(j, L, api653(j, L), { name: 'Co' }, [], opts); };
const text = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<sup class="vm"[^>]*>[A-Z]<\/sup>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const chapters = (html) => [...html.matchAll(/<h2 class="rp-ch"><span class="rp-no">(\d+)<\/span>([^<]+)<\/h2>/g)].map((m) => `${m[1]} ${m[2]}`);

test('S3: the small report follows the template order, with the title chosen for the job', () => {
  const j = small(), html = build(j);
  assert.deepEqual(chapters(html), ['1 Job information', '2 Tank static data', '3 Inspection summary', '4 Code required recommendations', '5 Non-code recommendations', '6 NDE scope and summary of results', '7 Inspection intervals', '8 Thickness and corrosion rates', '9 External inspection', '10 Internal inspection', '11 Insulation', '12 Follow-up and sign-off']);
  assert.match(html, /<h1>Out of Service Tank Inspection Report \(Small Diameter\)<\/h1>/);
  assert.match(html, /class="report rp2 rp-small"/);
  assert.doesNotMatch(html, /<h3 class="rp-h3">Tables<\/h3>/, 'contents without the table list');
  j.small.title = 'ins';
  assert.match(build(j), /<h1>In Service Tank Inspection Report \(Small Diameter\)<\/h1>/);
  // the external and internal items are numbered sections in order
  const subs = [...html.matchAll(/class="rp-sub"[^>]*>(?:<[^>]+>)*([0-9]+\.[0-9]+)/g)].map((m) => m[1]);
  for (const k of ['9.1', '9.8', '10.1', '10.7', '12.3']) assert.ok(subs.includes(k) || html.includes(`>${k}<`), k);
});

test('S3: code required and non-code recommendations print in their own chapters', () => {
  const T = text(build(small()));
  const code = T.slice(T.lastIndexOf('4 Code required recommendations'), T.lastIndexOf('5 Non-code recommendations'));
  const non = T.slice(T.lastIndexOf('5 Non-code recommendations'), T.lastIndexOf('6 NDE scope'));
  assert.match(code, /Pitting below 0\.10 in at 003/); assert.match(code, /D-001/); assert.doesNotMatch(code, /Vegetation/);
  assert.match(non, /Vegetation in containment/); assert.doesNotMatch(non, /Pitting/);
  const j = small(); j.secs.floor.recs = []; j.secs.found.recs = [];
  const T2 = text(build(j));
  assert.match(T2, /No code required recommendations\./); assert.match(T2, /No non-code recommendations\./);
});

test('S3: thickness, intervals, tilt and edge results are the calculation’s values', () => {
  const j = small(), L = buildLayout(j), R = smallCalc(j, L, api653(j, L)), T = text(build(j)), t = (v) => fmt(v, 't', j, false);
  const F = R.thick.floor, Sh = R.thick.shell, Rf = R.thick.roof;
  assert.ok(T.includes(`Floor (as found) ${t(F.tNom)} ${t(F.tAct)} 30`), 'floor row');
  assert.ok(T.includes(`Shell — course ${Sh.course} ${t(Sh.tNom)} ${t(Sh.tAct)} 30`), 'shell row');
  assert.ok(T.includes(`${t(Rf.tMin)} ${rlText(Rf.rl, Rf.cr)}`), 'roof RL');
  assert.ok(T.includes(`after the recommended floor repairs RL = ${rlText(F.rlAfter, F.cr)} years`));
  for (const k of ['ut', 'ext', 'int']) assert.ok(T.includes(R.intervals[k].done.date), k);
  assert.match(T, /UT thickness 2041-11-16 \(15 yr\)/);
  assert.match(T, /Out of service \(internal\) 2038-08-13 \(11\.7 yr\) 2026-11-16 \(0 yr\)/);
  assert.match(T, /Out of plumb 0\.62 in limit 2\.88 in \(API 653 §10\.5\.2\.1\)/);
  assert.match(T, /Result Acceptable/);
  assert.match(T, /2 1\.75 20\.00 1\.50 Exceeds/);
  assert.match(T, /3 1\.20 30\.00 1\.50 Beyond the limit’s distance/);
  assert.match(T, /S 0\.090 0\.50 Below minimum thickness/);
  // an override prints as entered
  j.small.intOv.extDone = '2028-06-01';
  assert.match(text(build(j)), /In service \(external\) 2028-06-01 entered/);
});

test('S3: ratings, comments, item tables and sign-off', () => {
  const j = small(), html = build(j), T = text(html);
  assert.match(html, /<span class="sm-rate r-poor">POOR<\/span>/);
  assert.match(T, /Soil-side pitting at 003; MFL indications proven up by UT\./);
  assert.match(T, /PVRV PV-2231 8 oz\/in² 0\.5 oz\/in² 2025-06-10/);
  assert.match(T, /Fit for continued service/);
  assert.match(T, /C\. Inspector API 653 inspector API 653 · 12345 2020-01-01 expired/);
  j.small.items['x-lot'] = { rating: '', text: '' };
  assert.match(build(j), /NOT RATED/);
  // user text is escaped
  j.small.items['x-lot'].text = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(build(j), /<img src=x/);
});

const apps = (html) => [...html.matchAll(/<div class="rp-app" id="app-(\w+)"><h2 class="rp-ch"><span class="rp-no">([A-Z])<\/span>([^<]+)<\/h2>/g)].map((m) => `${m[2]} ${m[3]}`);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEUlEQVR4nGM4YWODFTEMpAQAr9U8AVonTcEAAAAASUVORK5CYII=';

test('S4: appendices as needed — photos, UT, MFL, calculations — and each can be switched off', () => {
  const j = small(), L = buildLayout(j), c = api653(j, L);
  let html = build(j);
  assert.deepEqual(apps(html), ['A NDE — UT thickness', 'B NDE — MFL floor inspection', 'C Calculations — thickness, intervals and settlement', 'D Calculation — floor minimum remaining thickness (API 653 §4.4.5)'], 'no photos: no photo appendix');
  const photos = [{ id: 'ph1', jobId: j.id, sec: 'shell', n: 1, dataUrl: PNG, w: 8, h: 6, caption: 'Shell at the chime', anno: [] }, { id: 'ph2', jobId: j.id, sec: 'floor', n: 1, dataUrl: PNG, w: 8, h: 6, caption: 'Hidden', inReport: false, anno: [] },
    { id: 'ph3', jobId: j.id, indId: j.indications[2].id, dataUrl: PNG, w: 8, h: 6, caption: 'Pit at 003', anno: [] }];
  html = buildReport(j, L, c, { name: 'Co' }, photos, {});
  assert.equal(apps(html)[0], 'A Photographs');
  const T = text(html);
  assert.match(T, /Photo SH-1 · Shell · Shell at the chime/); assert.doesNotMatch(T, /Hidden/); assert.match(T, /Photo 003a · Floor · indication 003 · Pit at 003/);
  html = buildReport(j, L, c, { name: 'Co' }, photos, { layout: { off: ['small-photos', 'small-calcfloor'] } });
  assert.deepEqual(apps(html).map((x) => x.slice(2)), ['NDE — UT thickness', 'NDE — MFL floor inspection', 'Calculations — thickness, intervals and settlement']);
});

test('S4: UT appendix — shell readings by course and station, nozzles, the shell / nozzle plan and the roof plan sheets', () => {
  const j = small(), html = build(j), T = text(html);
  const ut = T.slice(T.lastIndexOf('A NDE — UT thickness'), T.lastIndexOf('B NDE — MFL'));
  assert.match(ut, /Shell UT readings — minimum by course and station/);
  assert.match(ut, /1 0\.250 (0\.\d{3} ){4}0\.231/, 'course 1 row ends with its minimum');
  assert.match(ut, /N1 Water draw \/ drain · Drain/);
  assert.match(html, /External shell and nozzle UT — plan/); assert.match(html, /<svg class="sm-plan"/);
  assert.match(html, /Fixed roof UT — plan/);
  assert.match(ut, /R2 90° 8\.00 ft 0\.150 OK/);
  // tables come before the sheets, so the appendix heading never stands alone
  const a = html.indexOf('id="app-ut"');
  assert.ok(html.indexOf('Shell UT readings', a) < html.indexOf('class="rp-draw dwg', a));
});

test('S4: MFL appendix — the floor drawing sheet with the indication list (No, X, Y, TS/BS, T-act)', () => {
  const j = small(), html = build(j);
  const a = html.indexOf('id="app-mfl"'), sheet = html.slice(html.indexOf('class="rp-draw dwg', a));
  assert.match(sheet, /<div class="dwg-bh">Indications<\/div><table class="dwg-kv sm-ind"><tr><th>No\.<\/th><th>X<\/th><th>Y<\/th><th>TS\/BS<\/th><th>T-act<\/th><\/tr>/);
  assert.match(sheet, /<td>003<\/td><td>[\d.]+<\/td><td>[\d.]+<\/td><td>BS<\/td><td>0\.080<\/td>/);
  assert.match(sheet, /Floor internal — MFL indications and UT prove-up/);
  // many indications: the list stays in the table before the sheet, not on the sheet
  const k = small(); for (let i = 0; i < 30; i++) k.indications.push({ ...k.indications[0], id: 'x' + i, no: String(100 + i) });
  const h2 = build(k), s2 = h2.slice(h2.indexOf('class="rp-draw dwg', h2.indexOf('id="app-mfl"')));
  assert.doesNotMatch(s2, /sm-ind/);
});

test('S4: calculation appendix shows the working with the calculation’s values', () => {
  const j = small(), L = buildLayout(j), R = smallCalc(j, L, api653(j, L)), T = text(build(j));
  const c = T.slice(T.lastIndexOf('C Calculations — thickness'), T.lastIndexOf('D Calculation — floor'));
  assert.match(c, /Shell course 1 — CR \(T-nom − T-act\) \/ years = \(0\.250 − 0\.231\) \/ 30 = 0\.0006 in\/yr/);
  assert.match(c, /UT thickness lesser of 15 and RCA \/ 2N/); assert.ok(c.includes(`= ${R.intervals.ut.done.years} years`));
  assert.match(c, /Twist \[\(N \+ S\) − \(E \+ W\)\] \/ 4/);
  assert.match(c, /Edge settlement Exceeds/);
});

test('S4: a metric job prints in mm', () => {
  const j = small(); j.units = 'metric';
  const T = text(build(j));
  assert.match(T, /T-nom \(mm\)/); assert.match(T, /CR \(mm\/yr\)/); assert.doesNotMatch(T, /in\/yr/);
});

test('S3: full-report jobs are not affected', () => {
  const j = load('./fixtures/demo.json'), html = build(j);
  assert.match(html, /<h1>Storage Tank Inspection Report<\/h1>/);
  assert.doesNotMatch(html, /rp-small/);
  j.template = ''; // not chosen: the full report
  assert.doesNotMatch(build(j), /rp-small/);
});
