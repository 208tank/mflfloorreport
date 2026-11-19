// Small tank report template, stage S1 (schema 6): data, migration, suggestion, validation, registry and revision diff.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate, newJob, SCHEMA } from '../js/model.js';
import { ITEMS, ITEM, GROUPS, defaultSmall, migrateSmall, parseDiameter, suggestSmall, smallMaxD, SMALL_MAX_D, isSmall, templateOf, titleOf, progress } from '../js/small.js';
import { validateJobFile } from '../js/validate.js';
import { jobFromTank, staticFrom, tankFromJob } from '../js/registry.js';
import { diffJobs } from '../js/revdiff.js';
import { newRec } from '../js/sections.js';

const fixture = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
const FT = 304.8;

test('S1: the checklist has the 16 items in the report order, each tied to an inspection section', () => {
  assert.equal(ITEMS.length, 16);
  assert.deepEqual(GROUPS.map(([k]) => k), ['ext', 'int', 'insul']);
  assert.deepEqual(ITEMS.filter((i) => i.grp === 'ext').map((i) => i.label), ['Tank lot and containment', 'Floor projections and shell-to-floor weld', 'Tank shell', 'Fixed roof', 'Nozzles and piping', 'Instrumentation', 'Over-pressure protection', 'Settlement']);
  assert.deepEqual(ITEMS.filter((i) => i.grp === 'int').map((i) => i.label), ['Tank floor', 'Floor-to-shell weld', 'Tank shell', 'Fixed roof', 'Nozzles', 'Accessories', 'Edge settlement']);
  assert.equal(new Set(ITEMS.map((i) => i.k)).size, 16);
  for (const i of ITEMS) assert.ok(['floor', 'shell', 'froof', 'nozzles', 'found', 'settle'].includes(i.sec), i.k);
  assert.deepEqual(ITEMS.filter((i) => i.table).map((i) => [i.k, i.table]), [['x-proj', 'proj'], ['x-opp', 'opp'], ['x-settle', 'tilt'], ['i-edge', 'edge']]);
});

test('S1: a new job has no template chosen and a blank checklist; a recommendation starts not code-required', () => {
  const j = newJob();
  assert.ok(SCHEMA >= 6);
  assert.equal(j.template, '');
  assert.equal(templateOf(j), 'full', 'not chosen = the full report');
  assert.equal(j.small.title, 'oos'); assert.match(titleOf(j), /Out of Service.*Small Diameter/);
  assert.deepEqual(j.small.items, {});
  assert.deepEqual(j.small.proj.map((p) => p.loc), ['N', 'E', 'S', 'W']);
  assert.deepEqual(j.small.tilt.map((p) => p.loc), ['N', 'E', 'S', 'W']);
  assert.deepEqual(j.small.edge.map((p) => p.st), ['1', '2', '3', '4']);
  assert.equal(j.small.level, 4 * FT);
  assert.deepEqual(j.small.basis, { settle: 'small', intervals: '653' });
  assert.equal(j.small.lim.twist, null, 'no default twist trigger');
  for (const k of ['maker', 'serialNo', 'capacity', 'matFloor', 'matShell', 'matRoof']) assert.equal(j.tank[k], '', k);
  for (const k of ['jobNo', 'poNo']) assert.equal(j.info[k], '', k);
  assert.equal(newRec().code, false);
  assert.equal(progress(j), 0);
});

test('S1: step 6 keeps existing jobs on the full report and changes nothing they calculate', () => {
  const raw = { ...fixture('demo'), schema: 5 }, log = [];
  assert.ok(!raw.template);
  const before = JSON.stringify(raw), out = migrate(raw, { log });
  assert.equal(JSON.stringify(raw), before, 'the stored job is not changed');
  assert.deepEqual(log.map((l) => l.to), [6, 7, 8]);
  assert.equal(out.template, 'full');
  assert.equal(isSmall(out), false);
  assert.deepEqual(out.small.items, {});
  // a job already at schema 6 with no template chosen keeps it unchosen
  const fresh = migrate(newJob());
  assert.equal(fresh.template, '');
  // a chosen template survives normalising; a nonsense value does not
  assert.equal(migrate({ ...out, template: 'small' }).template, 'small');
  assert.equal(migrate({ ...out, template: 'bogus' }).template, '');
});

test('S1: migrateSmall keeps entered data, drops unknown items and is safe to repeat', () => {
  const s = defaultSmall();
  s.items['x-shell'] = { rating: 'fair', text: 'Paint failing at the chime' };
  s.items['x-bogus'] = { rating: 'good' };
  s.opp.push({ id: 'd1', dev: 'PVRV', serial: '123', press: '8 oz', vac: '0.5 oz', svc: '2026-01-01' });
  const once = migrateSmall(s), twice = migrateSmall(once);
  assert.deepEqual(Object.keys(once.items), ['x-shell']);
  assert.equal(once.items['x-shell'].text, 'Paint failing at the chime');
  assert.equal(once.opp[0].dev, 'PVRV');
  assert.deepEqual(twice, once);
  // missing or wrong-typed parts are filled from the defaults
  const m = migrateSmall({ basis: { intervals: '12r1' }, proj: 'x', items: null });
  assert.deepEqual(m.basis, { settle: 'small', intervals: '12r1' });
  assert.equal(m.proj.length, 4);
  assert.deepEqual(migrateSmall(undefined).items, {});
  assert.ok(ITEM.has('i-edge'));
});

test('S1: the small template is suggested under 40 ft (or the device setting) until a template is chosen', () => {
  const j = newJob();
  assert.equal(SMALL_MAX_D, 40 * FT);
  assert.equal(suggestSmall(j, {}), false, 'no diameter yet');
  j.tank.diameter = 30 * FT; assert.equal(suggestSmall(j, {}), true);
  j.tank.diameter = 40 * FT; assert.equal(suggestSmall(j, {}), false, 'under, not at, the limit');
  j.tank.diameter = 50 * FT; assert.equal(suggestSmall(j, { smallMaxD: 60 * FT }), true, 'device setting');
  j.tank.diameter = 30 * FT; j.template = 'full'; assert.equal(suggestSmall(j, {}), false, 'chosen: no suggestion');
  j.template = ''; j.regEdit = 't1'; assert.equal(suggestSmall(j, {}), false, 'not while editing the registry');
  assert.equal(smallMaxD({ smallMaxD: 'x' }), SMALL_MAX_D);
  assert.equal(parseDiameter('40'), 40 * FT);
  assert.equal(parseDiameter('40 ft'), 40 * FT);
  assert.equal(parseDiameter('12 m'), 12000);
  assert.equal(parseDiameter('12192 mm'), 12192);
  for (const bad of ['', 'forty', '-3', '0']) assert.equal(parseDiameter(bad), null, bad);
});

test('S1: validation checks the checklist lists and numbers', async () => {
  const j = migrate(fixture('demo'));
  j.small.proj[0].t = '0.25'; j.small.edge[1].max = 'deep'; j.small.opp = [{ dev: 'PVRV' }];
  const r = await validateJobFile({ format: 'tank-floor-inspector', version: 1, job: j }, { schema: Infinity, fileVersion: 2 });
  assert.ok(r.warnings.some((w) => /Floor projection N: Thickness was stored as the text/.test(w)), r.warnings.join('\n'));
  assert.ok(r.errors.some((e) => /Edge settlement station 2: Maximum settlement is “deep”/.test(e)), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /Over-pressure device PVRV has no id/.test(e)), r.errors.join('\n'));
  const bad = await validateJobFile({ format: 'tank-floor-inspector', version: 1, job: { ...migrate(fixture('demo')), small: [] } }, { schema: Infinity, fileVersion: 2 });
  assert.ok(bad.errors.some((e) => /small part has the wrong type/.test(e)));
});

test('S1: nameplate fields go to the registry; the checklist and template stay with the inspection', () => {
  const j = migrate(fixture('demo'));
  Object.assign(j.tank, { maker: 'Acme Tank', serialNo: 'S-1', capacity: '400 bbl', matShell: 'A36' });
  j.template = 'small'; j.small.items['x-lot'] = { rating: 'good', text: '' };
  const st = staticFrom(j);
  assert.equal(st.tank.maker, 'Acme Tank'); assert.equal(st.tank.capacity, '400 bbl');
  assert.ok(!('small' in st) && !('template' in st));
  const t = tankFromJob(j), next = jobFromTank(t, { last: j });
  assert.equal(next.tank.serialNo, 'S-1');
  assert.equal(next.template, '', 'each inspection chooses again (suggested for small tanks)');
  assert.deepEqual(next.small.items, {});
});

test('S1: the revision diff names checklist changes', () => {
  const a = migrate(fixture('demo')), b = structuredClone(a);
  b.template = 'small'; b.small.items['i-floor'] = { rating: 'poor', text: 'Pitting' }; b.small.proj[2].t = 6;
  const rows = diffJobs(a, b);
  assert.ok(rows.some((r) => r.area === 'Report template' && r.after === 'small'), JSON.stringify(rows));
  assert.ok(rows.filter((r) => r.area === 'Small tank checklist').length >= 2, JSON.stringify(rows));
});
