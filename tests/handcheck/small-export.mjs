// S2 hand check, step 1: export the small tank fixture's raw inputs and the app's small-tank results to JSON, for the
// independent recalculation in small_handcheck.py. Which plate an indication is on, whether it is in the critical
// zone, and which locations the auto-repair chose are taken from the app (checked in the R5 hand check).
import { readFileSync, writeFileSync } from 'node:fs';
import { migrate } from '../../js/model.js';
import { buildLayout } from '../../js/geometry.js';
import { api653 } from '../../js/calc.js';
import { coursesWithElev } from '../../js/shell.js';
import { smallCalc } from '../../js/smallcalc.js';

const job = migrate(JSON.parse(readFileSync(new URL('../small/small-tank.json', import.meta.url), 'utf8')));
const layout = buildLayout(job), done = api653(job, layout), r = smallCalc(job, layout, done);
const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'annexB' ? undefined : v === Infinity ? 'inf' : v)));
writeFileSync(new URL('./small-inputs.json', import.meta.url), JSON.stringify({
  units: job.units, inspDate: job.info.inspDate, tank: job.tank, calc: job.calc, nozzles: job.nozzles,
  indications: job.indications.map((i) => ({ ...i, critical: done.per.get(i.id).critical, region: done.per.get(i.id).region })),
  repaired: done.repairs,
  courses: coursesWithElev(job).map((c) => ({ id: c.id, no: c.no, z0: c.z0, z1: c.z1, tNom: c.tNom, tMin: c.tMin })), rd: job.shell.rd,
  roof: job.roof.fixed, small: job.small,
  app: strip(r)
}, null, 1));
console.log('exported');
