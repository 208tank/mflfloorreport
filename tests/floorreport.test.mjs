// Report improvements R3: every number in the floor chapter's prove-up and corrosion tables equals the value the
// API 653 calculation produced, for every fixture job; the repair-status rows follow the repairs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { migrate } from '../js/model.js';
import { buildLayout } from '../js/geometry.js';
import { api653, RESULT_SHORT } from '../js/calc.js';
import { patchList } from '../js/patches.js';
import { buildReport } from '../js/report.js';
import { repairUnits } from '../js/report/floor.js';
import { fmt, fmtRate } from '../js/units.js';

const FIX = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(FIX).filter((f) => f.endsWith('.json')).sort();
const strip = (s) => s.replace(/<sup[^>]*>.*?<\/sup>/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
/** Rows of the table whose title contains `title`: [{ ind, cells: {key: text}, tds: [text] }]. */
function rows(html, title) {
  const m = new RegExp('<div class="rp-tcap"[^>]*><b>Table [^<]+</b> ' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).exec(html); if (!m) return null;
  const i = m.index;
  const tb = html.slice(html.indexOf('<tbody>', i), html.indexOf('</tbody>', i));
  return [...tb.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].map(([, attrs, body]) => ({
    ind: /data-ind="([^"]+)"/.exec(attrs)?.[1] || null,
    cells: Object.fromEntries([...body.matchAll(/<td[^>]*data-c="(\w+)"[^>]*>([\s\S]*?)<\/td>/g)].map(([, k, v]) => [k, strip(v)])),
    tds: [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, v]) => strip(v)),
  }));
}

for (const f of fixtures) {
  test(`floor chapter numbers equal the calculation: ${f}`, () => {
    const job = migrate(JSON.parse(readFileSync(new URL(f, FIX), 'utf8')));
    const layout = buildLayout(job), calc = api653(job, layout);
    const html = buildReport(job, layout, calc, { name: 'T' }, [], { exec: true, defs: true, sections: true, plates: true });
    const per = calc.per, T = (v) => fmt(v, 't', job, false);
    const counted = (job.indications || []).filter((i) => per.get(i.id)?.counts && per.get(i.id)?.rem != null);
    if (!(job.indications || []).length) return;

    // lowest remaining: the right locations, in order, with the calculation's values
    const worst = rows(html, 'Lowest remaining thickness');
    if (counted.length) {
      const want = counted.slice().sort((a, b) => per.get(a.id).rem - per.get(b.id).rem).slice(0, 10).map((i) => i.id);
      assert.deepEqual(worst.map((r) => r.ind), want, 'worst locations');
      for (const r of worst) {
        const a = per.get(r.ind);
        assert.equal(r.cells.rem, T(a.rem), 'remaining'); assert.equal(r.cells.proj, T(a.projected), 'projected');
        assert.equal(r.cells.lim, T(a.limit), 'limit'); assert.equal(r.cells.loss, a.lossPct != null ? a.lossPct.toFixed(0) : '—', 'loss');
      }
    }
    // prove-up: every proven location, with the remaining thickness the calculation used
    const prove = rows(html, 'Proven-up indications') || [];
    const proven = (job.indications || []).filter((i) => ['ps', 'ss', 'both'].includes(i.result));
    assert.equal(prove.length, proven.length, 'one row per proven indication');
    for (const r of prove) assert.equal(r.cells.rem, T(per.get(r.ind).rem), 'prove-up remaining');
    for (const r of prove) assert.equal(r.tds[3], RESULT_SHORT[(job.indications.find((i) => i.id === r.ind)).result], 'side');

    // product / soil side: rates as used by the calculation
    const sides = rows(html, 'Product side and soil side');
    assert.equal(sides[0].tds[4], fmtRate(calc.StPr, job)); assert.equal(sides[1].tds[4], fmtRate(calc.UPr, job));
    const minOf = (test) => { const v = counted.filter((i) => test(i.result || 'pending')).map((i) => per.get(i.id).rem); return v.length ? fmt(Math.min(...v), 't', job) : '—'; };
    assert.equal(sides[0].tds[2], minOf((r) => r === 'ps' || r === 'both'));
    assert.equal(sides[1].tds[2], minOf((r) => r === 'ss' || r === 'both' || r === 'pending'));

    // results by area: limits are the calculation's
    const areas = rows(html, 'Results by area');
    assert.equal(areas[0].tds[3], fmt(calc.mBot, 't', job));
    assert.equal(areas.at(-1).tds[3], fmt(calc.czLim, 't', job));

    // repair status: one row per patch or unpatched repair
    const units = repairUnits(job, calc, patchList(job, layout, calc));
    const st = rows(html, 'Repair status') || [];
    assert.equal(st.length, units.length);
  });
}

test('repair status follows the indications, not the patch number', () => {
  const job = migrate(JSON.parse(readFileSync(new URL('demo.json', FIX), 'utf8')));
  const layout = buildLayout(job), calc = api653(job, layout), units = repairUnits(job, calc, patchList(job, layout, calc));
  assert.ok(units.length > 0);
  const u = units[0];
  job.repairs = { [u.key]: { status: 'completed', date: '2026-11-20', contractor: 'Weld Co', exam: 'MT and vacuum box' } };
  const html = buildReport(job, layout, calc, { name: 'T' }, [], {});
  const r = rows(html, 'Repair status').find((x) => x.tds[0] === u.label);
  assert.deepEqual(r.tds.slice(3, 7), ['Completed', '2026-11-20', 'Weld Co', 'MT and vacuum box']);
  assert.ok(u.key.startsWith('inds:') || u.key.startsWith('ind:'));
});
