// Report improvements R4: the shell, roof, nozzle and settlement summaries in the chapters print the values the
// calculation modules return, for every fixture job; and the parts moved to appendices are all still printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { migrate } from '../js/model.js';
import { buildLayout } from '../js/geometry.js';
import { api653, nozzleUT } from '../js/calc.js';
import { buildReport } from '../js/report.js';
import { courseSummary, coursesWithElev } from '../js/shell.js';
import { fillFromT } from '../js/design.js';
import { floatingLayout, plateUT, pointStatus, roofBad } from '../js/roof.js';
import { profileEval, stations } from '../js/settle.js';
import { fmt } from '../js/units.js';

const FIX = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(FIX).filter((f) => f.endsWith('.json')).sort();
const strip = (s) => s.replace(/<sup[^>]*>.*?<\/sup>/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
function table(html, title) {
  const m = new RegExp('<div class="rp-tcap"[^>]*><b>Table ([^<]+)</b> ' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).exec(html); if (!m) return null;
  const end = html.indexOf('</table>', m.index), tb = html.slice(m.index, end);
  return { no: m[1], rows: [...tb.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].filter(([, , b]) => b.includes('<td')).map(([, attrs, body]) => ({
    attrs, cells: Object.fromEntries([...body.matchAll(/<(?:td|th)[^>]*data-c="(\w+)"[^>]*>([\s\S]*?)<\/(?:td|th)>/g)].map(([, k, v]) => [k, strip(v)])),
    tds: [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, v]) => strip(v)),
  })) };
}
const attr = (r, k) => new RegExp(`data-${k}="([^"]+)"`).exec(r.attrs)?.[1];

for (const f of fixtures) {
  test(`R4 summaries equal the calculation: ${f}`, () => {
    const job = migrate(JSON.parse(readFileSync(new URL(f, FIX), 'utf8')));
    const layout = buildLayout(job), calc = api653(job, layout);
    const html = buildReport(job, layout, calc, { name: 'T' }, [], { exec: true, defs: true, sections: true });
    const T = (v) => fmt(v, 't', job, false), B = (v) => fmt(v, 'big', job, false);

    // shell: §4.3.3 summary per course
    const cs = new Map(courseSummary(job).map((c) => [c.id, c])), courses = coursesWithElev(job);
    const sh = table(html, 'Shell evaluation summary — API 653 §4.3.3');
    assert.ok(sh, 'shell summary table'); assert.equal(sh.rows.length, courses.length);
    for (const r of sh.rows) {
      const c = courses.find((x) => x.id === attr(r, 'course')), s2 = cs.get(c.id), fl = s2.min != null ? fillFromT(job, c.d, s2.min) : {};
      assert.equal(r.cells.tmin.replace(' (entered)', ''), T(c.tMin));
      assert.equal(r.cells.min, s2.min != null ? T(s2.min) : '—');
      assert.equal(r.cells.prod, fl.prod != null ? B(fl.prod) : '—'); assert.equal(r.cells.hydro, fl.hydro != null ? B(fl.hydro) : '—');
    }
    // nozzles: neck UT minimum, loss and status
    const nz = table(html, 'Nozzle neck UT and evaluation');
    assert.equal(nz.rows.length, job.nozzles.length);
    for (const r of nz.rows) {
      const n = job.nozzles.find((x) => x.id === attr(r, 'noz')), u = nozzleUT(n, job);
      assert.equal(r.cells.min, u.count ? T(u.min) : '—'); assert.equal(r.cells.loss, u.lossPct != null ? u.lossPct.toFixed(0) + '%' : '—'); assert.equal(r.cells.status, u.status);
    }
    // roofs: exactly the points and plates below t-min
    const lowPts = (job.roof.fixed.pts || []).filter((p) => roofBad(pointStatus(job, p).status)).map((p) => p.label);
    assert.deepEqual((table(html, 'Fixed roof — UT points below t-min')?.rows || []).map((r) => r.tds[0]), lowPts);
    const lay = floatingLayout(job), lowPl = lay.plates.filter((p) => p.kind !== 'annular' && roofBad(plateUT(job, p).status));
    const fl = table(html, 'Floating roof — deck plates below t-min')?.rows || [];
    assert.deepEqual(fl.map((r) => r.tds[0]), lowPl.map((p) => p.label));
    fl.forEach((r, i) => assert.equal(r.tds[1], T(plateUT(job, lowPl[i]).min)));
    // settlement: edge survey summary counts
    const P = stations(job).map((s) => ({ s, p: profileEval(job, s.i) })).filter((x) => x.p.n);
    const es = table(html, 'Edge settlement survey — summary');
    const cell = (k) => es.rows.find((r) => r.cells[k] !== undefined).cells[k];
    assert.equal(cell('withR'), String(P.filter((x) => x.p.R > 0).length));
    for (const [k, st] of [['ok', 'Acceptable'], ['nde', 'NDE required'], ['exc', 'Exceeds']]) assert.equal(cell(k), String(P.filter((x) => x.p.status === st).length), st);
    // moved parts are in appendices (lettered tables)
    for (const t of ['Shell UT readings by elevation and station', 'Shell evaluation — API 653 §4.3.3', 'Fixed roof UT readings', 'Floating roof deck UT readings', 'Shell settlement — cosine fit, U and S by station', 'Edge settlement survey — results by station']) {
      const x = table(html, t); assert.ok(x, t); assert.match(x.no, /^[A-Z]-\d+$/, t + ' is in an appendix');
    }
  });
}
