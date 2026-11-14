// Writes the fixed job files the golden tests run on. Run once (node tests/make-fixtures.mjs);
// the fixtures are committed so ids and dates never change between runs.
import { writeFileSync } from 'node:fs';
import { makeDemo } from '../js/demo.js';
import { rowsFromGrid, measuredFromDrawing } from '../js/builder.js';

const out = (name, job) => writeFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), JSON.stringify(job, null, 1));
const clone = (o) => JSON.parse(JSON.stringify(o));

const demo = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(new URL("./fixtures/demo.json", import.meta.url), "utf8")).catch(() => "null")) || makeDemo();
out('demo', demo);

const custom = clone(demo); custom.layout.mode = 'custom'; custom.layout.rows = rowsFromGrid(custom); out('demo-rows', custom);
const measured = clone(demo); measured.layout.mode = 'measured'; measured.layout.mrows = measuredFromDrawing(measured); out('demo-measured', measured);
const coated = clone(demo); Object.assign(coated.calc, { coated: true, cp: true, Or: 20 }); out('demo-coated-cp', coated);
const metric = clone(demo); metric.units = 'metric'; metric.layout.annular = false; metric.settle.eu = 'mm'; out('demo-metric-noannular', metric);
const forced = clone(demo); forced.indications.forEach((d, i) => { d.repair = ['yes', 'no', 'auto'][i % 3]; }); Object.assign(forced.calc, { years: 10, stprOverride: 0.05 }); out('demo-repair-overrides', forced);
console.log('fixtures written');

// An old (schema 1, v3.1-era) job, to pin down what migrate() does to legacy files.
const legacy = clone(demo); legacy.schema = 1; delete legacy.equipment; delete legacy.status; legacy.calc.patchMargin = 25.4; out('legacy-schema1', legacy);
console.log('legacy fixture written');
