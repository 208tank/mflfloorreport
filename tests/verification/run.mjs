// Runs the verification library and prints / saves the results table.
//   node tests/verification/run.mjs            → table on screen + tests/verification/results.json
import { writeFileSync } from 'node:fs';
import { CASES, check } from './cases.mjs';

const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 1000 ? v.toFixed(1) : +v.toPrecision(6)) : v === null ? 'null' : v === undefined ? '—' : String(v));
const out = [];
for (const cs of CASES) {
  const r = check(cs);
  const status = cs.basis === 'reference' ? 'UNVERIFIED' : r.pass ? 'PASS' : 'FAIL';
  out.push({ id: cs.id, area: cs.area, units: cs.units, basis: cs.basis, title: cs.title, input: cs.input, steps: cs.steps, tol: cs.tol, unit: cs.unit, source: cs.source, status, error: r.error,
    checks: r.rows.map(([k, e, a, ok]) => ({ key: k, expected: fmt(e), actual: fmt(a), ok })) });
  console.log(`${status.padEnd(10)} ${cs.id}  ${cs.title}`);
  if (!r.pass) for (const [k, e, a, ok] of r.rows) if (!ok) console.log(`             ${k}: expected ${fmt(e)}, got ${fmt(a)}`);
  if (r.error) console.log('             error: ' + r.error);
}
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(out, null, 1));
const n = (s) => out.filter((x) => x.status === s).length;
console.log(`\n${out.length} cases: ${n('PASS')} pass, ${n('FAIL')} fail, ${n('UNVERIFIED')} unverified`);
