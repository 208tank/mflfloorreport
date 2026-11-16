// R5 hand check, step 1: export the demo job's raw inputs and the app's results to JSON, for the independent
// recalculation in handcheck.py. Geometry (which plate each indication is on, plate kind, distance from the shell)
// is taken from the app as an input: it is not one of the calculations being checked.
import { readFileSync, writeFileSync } from 'node:fs';
import { migrate } from '../../js/model.js';
import { buildLayout } from '../../js/geometry.js';
import { api653, czLimitParts, nozzleUT, nozzleWall } from '../../js/calc.js';
import { courseDesigns, designBasis, fillFromT } from '../../js/design.js';
import { courseSummary } from '../../js/shell.js';
import { patchList } from '../../js/patches.js';
import { floatingLayout, plateUT, pointStatus } from '../../js/roof.js';
import { sealEval, activeStds } from '../../js/seal.js';
import { settleCalc } from '../../js/settle.js';

const job = migrate(JSON.parse(readFileSync(new URL('../fixtures/demo.json', import.meta.url), 'utf8')));
const layout = buildLayout(job), calc = api653(job, layout);
const per = calc.per, plates = new Map(layout.plates.map((p) => [p.key, p]));
const out = {
  units: job.units, calc: job.calc, tank: job.tank, plates: job.plates,
  indications: job.indications.map((i) => ({ ...i, kind: plates.get(i.plate)?.kind, critical: per.get(i.id).critical })),
  plateMin: Object.fromEntries(['bottom', 'annular'].map((k) => [k, Math.min(...layout.plates.filter((p) => (p.kind === 'annular' ? 'annular' : 'bottom') === k).map((p) => +job.plates?.[p.key]?.utMin || (k === 'annular' ? +job.tank.tAnnular : +job.tank.tBottom)))])),
  scanned: layout.plates.some((p) => (job.plates?.[p.key]?.scan || 'scanned') !== 'not'),
  app: {
    rounds: calc.trace.rounds, specified: calc.trace.specified, pruned: calc.trace.pruned, StPr: calc.StPr, UPr: calc.UPr, K: calc.K, thrRate: calc.thrRate, mAnn: calc.mAnn, czLim: calc.czLim, repaired: calc.repairs,
    regions: calc.regions.map((r) => ({ name: r.name, RTip: r.RTip, RTbc: r.RTbc, MRT: r.MRT, tReq: r.tReq, OrMax: r.OrMax, limit: r.limit })),
    annular: calc.ann.req, cz: czLimitParts(job),
    patches: patchList(job, layout, calc).map((p) => ({ id: p.id, L: p.L, W: p.W, kind: p.kind, inds: p.inds.map((i) => i.id), trace: p.trace })),
  },
  shell: { basis: designBasis(job), designs: courseDesigns(job), courses: job.shell.courses, summary: courseSummary(job).map((c) => ({ id: c.id, min: c.min })),
    fill: courseDesigns(job).map((d) => { const s = courseSummary(job).find((c) => c.id === d.id); return s?.min != null ? fillFromT(job, d, s.min) : null; }) },
  nozzles: job.nozzles.map((n) => ({ n, wall: nozzleWall(n, job), ut: nozzleUT(n, job) })),
  roof: { fixed: job.roof.fixed, fixedStatus: job.roof.fixed.pts.map((p) => pointStatus(job, p)), floating: job.roof.floating, deck: floatingLayout(job).plates.filter((p) => p.kind !== 'annular').map((p) => ({ key: p.key, ut: plateUT(job, p) })) },
  seal: { seal: job.roof.seal, D: +job.tank.diameter, evals: activeStds(job.roof.seal).map((k) => ({ k, p: sealEval(job, k).p, s: sealEval(job, k).s })) },
  settle: (() => { const c = settleCalc(job); return { pts: c.pts.map((p) => ({ i: p.i, angle: p.angle, z: p.z, U: p.U, S: p.S, inSub: p.inSub })), fit: c.fit, Smax: c.Smax, Lsub: c.Lsub, Y: c.Y, E: c.E, H: c.H, D: c.D, k: c.k }; })(),
};
writeFileSync(new URL('./demo-inputs.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('exported');
