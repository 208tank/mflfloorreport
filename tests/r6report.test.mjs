// Report improvements R6: value marks, result / assessment boxes, photos and the photo log, deficiency sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { migrate } from '../js/model.js';
import { buildLayout } from '../js/geometry.js';
import { api653 } from '../js/calc.js';
import { buildReport } from '../js/report.js';

const FIX = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(FIX).filter((f) => f.endsWith('.json')).sort();
const load = (f) => migrate(JSON.parse(readFileSync(new URL(f, FIX), 'utf8')));
const build = (job, photos = [], opts = {}) => { const layout = buildLayout(job), calc = api653(job, layout); return { html: buildReport(job, layout, calc, { name: 'T' }, photos, opts), calc, layout }; };
const text = (s) => s.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

for (const f of fixtures) {
  test(`marks and boxes: ${f}`, () => {
    const job = load(f), { html, calc } = build(job);
    assert.ok(!/<sup>[VM]<\/sup>/.test(html), 'old V / M superscripts are gone');
    // each remaining thickness in the register carries the mark for its source
    const i0 = html.indexOf('</b> Floor indication register — all MFL'), reg = html.slice(html.indexOf('<tbody>', i0), html.indexOf('</tbody>', i0));
    for (const i of job.indications) {
      const a = calc.per.get(i.id); if (a.rem == null) continue;
      const want = a.src === 'UT' ? 'C' : 'E';
      assert.ok(reg.includes(`title="${want === 'C' ? 'Calculated' : 'Estimated'}">${want}</sup>`), `${i.no} marked ${want}`);
    }
    // one calculated-result box per evaluated component, each naming its appendix
    const boxes = [...html.matchAll(/<div class="rbox[^"]*">([\s\S]*?)<\/div>\s*(?:<div|<\/|\$|\n)/g)];
    assert.ok(boxes.length >= 5, `${boxes.length} result boxes`);
    for (const t of ['floor minimum remaining thickness', 'shell t-min and fill heights', 'roof plates', 'nozzle necks', 'settlement (API 653 Annex B)']) assert.ok(html.includes(`“Calculation — ${t}`), t);
    // no assessment printed that was not entered: the fixtures have none
    const ab = [...html.matchAll(/<div class="abox( none)?">/g)];
    assert.ok(ab.length >= 6 && ab.every((m) => m[1] === ' none'), 'every assessment box is empty');
    assert.ok(text(html).includes('No engineering assessment entered.'));
  });
}

test('an assessment appears only where entered, and only as entered', () => {
  const job = load('demo.json');
  job.secs.shell.assess = { text: 'Shell fit for continued service at the present fill height.', by: 'E. Engineer', date: '2026-11-20' };
  const t = text(build(job).html);
  assert.equal(t.split('Shell fit for continued service at the present fill height.').length - 1, 3, 'shell chapter box, executive summary, shell calculation appendix');
  const filled = [...build(job).html.matchAll(/<div class="abox">/g)].length;
  assert.equal(filled, 1, 'one filled box in the chapters');
});

test('photos: numbered captions with component, location and observation; every photo in the log', () => {
  const job = load('demo.json'), o = job.secs.found.obs[0] || (job.secs.found.obs[0] = { id: 'o1', item: 'Ringwall', loc: '90°', cond: 'fair', text: '' });
  const img = 'data:image/png;base64,iVBORw0KGgo=';
  const photos = [{ id: 'p1', sec: 'found', n: 1, obs: o.id, caption: 'Crack', dataUrl: img, w: 800, h: 450 }, { id: 'p2', sec: 'shell', n: 1, caption: 'Hidden', inReport: false, dataUrl: img, w: 4, h: 3 }, { id: 'p3', indId: job.indications[0].id, caption: 'Pit', dataUrl: img, w: 4, h: 3 }];
  job.secs.found.recs.push({ id: 'r1', finding: 'Crack in ringwall', def: true, priority: 'P3', status: 'Open', photo: 'p1', obs: o.id, no: 'D-099' });
  const { html } = build(job, photos, { photos: true }), t = text(html);
  assert.match(t, /Photo FO-1 · Foundation · .*observation 1/);
  const log = t.slice(t.indexOf('Photo log Photo Component'));
  for (const no of ['FO-1', 'SH-1', `${job.indications[0].no}a`]) assert.ok(log.includes(no), no + ' in the log');
  assert.match(log, /SH-1 Shell\s.*Hidden No/);
  assert.match(t, /From: Foundation observation 1/);
});
