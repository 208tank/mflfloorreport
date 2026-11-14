// Golden tests: every engineering result the app computes, for each fixture job, must match the
// output recorded from v3.4.2. Any refactor that changes a number fails here.
//   node --test tests/                 check
//   UPDATE_GOLDEN=1 node --test tests/ re-record (only after a deliberate, reviewed change)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

import { migrate } from '../js/model.js';
import { buildLayout } from '../js/geometry.js';
import { api653, nozzleUT, nozzleWall, czLimitAuto } from '../js/calc.js';
import { patchList } from '../js/patches.js';
import { findings, allDefs } from '../js/sections.js';
import { courseDesigns, designBasis, annularReq } from '../js/design.js';
import { courseSummary, utLocations, readingElevations } from '../js/shell.js';
import { settleCalc, stations, profileEval, edgeEval, depEval, hasEP } from '../js/settle.js';
import { floatingLayout, plateUT, pointStatus, hasFixed, hasFloating } from '../js/roof.js';
import { sealEval, activeStds } from '../js/seal.js';
import { indicationsCSV, platesCSV, nozzlesCSV, shellCSV, roofCSV, settleCSV } from '../js/export.js';
import { buildReport, buildDefReport } from '../js/report.js';

const FIX = new URL('./fixtures/', import.meta.url);
const GOLD = new URL('./golden/', import.meta.url);
const UPDATE = !!process.env.UPDATE_GOLDEN;

/** JSON with numbers rounded to 10 significant figures, Maps/Sets as arrays and cycles cut. */
export function stable(value) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? +v.toPrecision(10) : String(v);
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[cycle]';
    seen.add(v);
    let r;
    if (v instanceof Map) r = [...v.entries()].map(([k, x]) => [walk(k), walk(x)]);
    else if (v instanceof Set) r = [...v].map(walk);
    else if (Array.isArray(v)) r = v.map(walk);
    else r = Object.fromEntries(Object.keys(v).map((k) => [k, walk(v[k])]));
    seen.delete(v);
    return r;
  };
  return JSON.stringify(walk(value), null, 1);
}

/** migrate() gives equipment made from legacy fields random ids; renumber them so runs compare. */
function load(raw) {
  const job = migrate(JSON.parse(JSON.stringify(raw)));
  if (!Array.isArray(raw.equipment)) {
    const map = new Map(job.equipment.map((e, i) => [e.id, 'eq' + i]));
    job.equipment.forEach((e) => { e.id = map.get(e.id); });
    for (const sec of Object.values(job.secs || {})) for (const n of sec.nde || []) if (Array.isArray(n.equip)) n.equip = n.equip.map((id) => map.get(id) || id);
  }
  return job;
}

export function compute(raw) {
  const job = load(raw);
  const layout = buildLayout(job);
  const calc = api653(job, layout);
  const st = stations(job);
  const fl = hasFloating(job) ? floatingLayout(job) : null;
  return {
    migrated: { schema: job.schema, calc: job.calc, equipment: job.equipment, status: job.status, indications: job.indications.map((i) => [i.id, i.plate, i.x, i.y]) },
    layout: { plates: layout.plates.map((p) => ({ key: p.key, label: p.label, kind: p.kind, poly: p.poly, datum: p.datum })), extra: Object.keys(layout).sort() },
    calc, czLimit: czLimitAuto(job),
    patches: patchList(job, layout, calc),
    findings: findings(job, layout, calc),
    defs: allDefs(job),
    design: { basis: designBasis(job), courses: courseDesigns(job), annular: annularReq(job) },
    shell: { summary: courseSummary(job), locations: utLocations(job), elevations: readingElevations(job) },
    nozzles: job.nozzles.map((n) => ({ mark: n.mark, ut: nozzleUT(n, job), wall: nozzleWall(n, job) })),
    settle: { calc: settleCalc(job), profiles: hasEP(job) ? st.map((_, i) => profileEval(job, i)) : [], edges: (job.settle.edges || []).map((e) => edgeEval(e, job)), deps: (job.settle.deps || []).map((d) => depEval(d)) },
    roof: {
      fixed: hasFixed(job) ? (job.roof.fixed?.pts || []).map((p) => pointStatus(job, p)) : null,
      floating: fl ? { layout: fl, plates: fl.plates.map((p) => plateUT(job, p)) } : null,
      seal: activeStds(job.roof.seal).map((k) => [k, sealEval(job, k)])
    },
    csv: { ind: indicationsCSV(job, layout, calc), plates: platesCSV(job, layout, calc), noz: nozzlesCSV(job), shell: shellCSV(job), roof: roofCSV(job), settle: settleCSV(job) }
  };
}

/** The report HTML, minus anything that depends on today's date or the clock. */
export function reportHTML(raw) {
  const job = load(raw);
  const layout = buildLayout(job);
  const calc = api653(job, layout);
  const opts = { exec: true, defs: true, sections: true, indSize: true, photos: true, plates: true, provenOnly: false, plateLabels: true, datums: true };
  return buildReport(job, layout, calc, { name: 'Test Co' }, [], opts) + '\n<!--def-->\n' + buildDefReport(job, { name: 'Test Co' }, []);
}

const fixtures = readdirSync(FIX).filter((f) => f.endsWith('.json')).sort();

for (const f of fixtures) {
  const name = f.replace(/\.json$/, '');
  const raw = JSON.parse(readFileSync(new URL(f, FIX), 'utf8'));
  test(`golden: ${name} — calculations`, () => {
    const got = stable(compute(raw));
    const file = new URL(`${name}.calc.json`, GOLD);
    if (UPDATE || !existsSync(file)) writeFileSync(file, got);
    else assert.equal(got, readFileSync(file, 'utf8'), `${name}: calculated results changed`);
  });
  test(`golden: ${name} — report HTML`, () => {
    const got = reportHTML(raw);
    const file = new URL(`${name}.report.html`, GOLD);
    if (UPDATE || !existsSync(file)) writeFileSync(file, got);
    else assert.equal(got, readFileSync(file, 'utf8'), `${name}: report output changed`);
  });
}
