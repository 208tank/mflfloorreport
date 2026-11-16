// Report improvements R5: every value in the calculation appendices equals the matching value in the calculation's
// own result, for every fixture job. The appendices tag each worked answer (data-k) so it can be matched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { migrate } from '../js/model.js';
import { buildLayout } from '../js/geometry.js';
import { api653, czLimitParts, nozzleUT } from '../js/calc.js';
import { patchList } from '../js/patches.js';
import { buildReport } from '../js/report.js';
import { settleCalc } from '../js/settle.js';
import { activeStds, sealEval } from '../js/seal.js';
import { fmt, fmtRate } from '../js/units.js';

const FIX = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(FIX).filter((f) => f.endsWith('.json')).sort();
const strip = (s) => s.replace(/<sup[^>]*>.*?<\/sup>/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/^=\s*/, '').trim();

/** Tagged values: key → [text, …] from worked steps and result rows. */
function tagged(html) {
  const out = new Map(), add = (k, v) => { if (!out.has(k)) out.set(k, []); out.get(k).push(strip(v)); };
  for (const m of html.matchAll(/<div class="calc-step" data-k="([^"]+)">([\s\S]*?)<\/div>/g)) { const v = /data-c="v">([\s\S]*?)<\/span>/.exec(m[2]); if (v) add(m[1], v[1]); }
  for (const m of html.matchAll(/<tr data-k="([^"]+)">([\s\S]*?)<\/tr>/g)) { const v = /<td data-c="v">([\s\S]*?)<\/td>/.exec(m[2]); if (v) add('result:' + m[1], v[1]); }
  return out;
}

for (const f of fixtures) {
  test(`calculation appendices equal the calculation results: ${f}`, () => {
    const job = migrate(JSON.parse(readFileSync(new URL(f, FIX), 'utf8')));
    const layout = buildLayout(job), calc = api653(job, layout);
    const html = buildReport(job, layout, calc, { name: 'T' }, [], {});
    const K = tagged(html), T = (v) => fmt(v, 't', job);
    const eq = (k, want) => { const got = K.get(k); assert.ok(got && got.length, `${k} is shown`); for (const g of got) assert.equal(g, want, k); };

    // A — floor MRT
    eq('StPr', fmtRate(calc.StPr, job)); eq('UPr', fmtRate(calc.UPr, job)); eq('K', fmtRate(calc.K, job));
    if (calc.thrRate > 0) eq('thr', fmtRate(calc.thrRate, job));
    for (const r of calc.regions) {
      eq(`${r.name}.RTip`, T(r.RTip)); eq(`${r.name}.RTbc`, T(r.RTbc)); eq(`${r.name}.MRT`, T(r.MRT)); eq(`${r.name}.tReq`, T(r.tReq));
      eq(`${r.name}.OrMax`, r.OrMax === null ? '—' : Number.isFinite(r.OrMax) ? Math.max(0, r.OrMax).toFixed(1) + ' yr' : 'not limited (no corrosion rate)');
      eq(`result:${r.name}.result`, T(r.MRT));
    }
    // the worked substitution gives the stated MRT (to display precision)
    for (const r of calc.regions) if (r.RT !== null) assert.ok(Math.abs(r.RT - calc.Or * calc.K - r.MRT) < 1e-9);
    // B — annular, C — critical zone
    if (layout.Ri < layout.R) { eq('result:mAnn', T(calc.mAnn)); if (calc.ann.req) eq('Sb', `${Math.round(calc.ann.req.Sb).toLocaleString()} psi`); }
    eq('result:czLim', T(calc.czLim));
    if (job.calc?.czLimit == null || job.calc?.czLimit === '') eq('auto', T(czLimitParts(job).value));
    // D — patches
    for (const pp of patchList(job, layout, calc)) eq(`result:patch.${pp.id}`, `${fmt(pp.L, 'small', job)} × ${fmt(pp.W, 'small', job)}`);
    // F — nozzles
    for (const n of job.nozzles || []) { const u = nozzleUT(n, job); eq(`result:noz.${n.id}`, u.count ? T(u.min) : '—'); }
    // H — rim seal
    const stds = job.roof?.seal ? activeStds(job.roof.seal) : [];
    if (stds.length && ['efr', 'fixed-ifr'].includes(job.roof.type)) {
      const ev = sealEval(job, stds[0]);
      eq('pPerM', ev.p.perM == null ? '—' : `${ev.p.perM.toFixed(1)} cm²/m`); eq('pW', ev.p.wMaxCm == null ? '—' : `${ev.p.wMaxCm.toFixed(2)} cm`);
    }
    // I — settlement
    const c = settleCalc(job);
    if (c.fit) { eq('R2', c.fit.R2.toFixed(3)); eq('result:R2', c.fit.R2.toFixed(3)); }
    if (c.Smax != null) { const met = job.units === 'metric'; eq('Smax', `${met ? c.Smax.toFixed(1) : (c.Smax / 25.4).toFixed(2)} ${met ? 'mm' : 'in'}`); }
  });
}

test('the calculation traces are hidden from the results (goldens unchanged) but present', () => {
  const job = migrate(JSON.parse(readFileSync(new URL('demo.json', FIX), 'utf8')));
  const layout = buildLayout(job), calc = api653(job, layout);
  assert.ok(calc.trace && Array.isArray(calc.trace.rounds));
  assert.ok(!Object.keys(calc).includes('trace'));
  assert.ok(!JSON.stringify(calc.ann).includes('trace'));
  // each auto-repair round's location ended up repaired, or was pruned
  for (const r of calc.trace.rounds) assert.ok(calc.autoRepairs.includes(r.id) || calc.trace.pruned.includes(r.id));
});
