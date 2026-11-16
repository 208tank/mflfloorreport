// Report improvements R7: the print rules that keep the report's pages well filled. The page-by-page audit itself is
// tests/tools/print-audit.mjs (needs Playwright and pdftotext; run by hand across the test jobs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate } from '../js/model.js';
import { buildLayout } from '../js/geometry.js';
import { api653 } from '../js/calc.js';
import { buildReport } from '../js/report.js';

const job = migrate(JSON.parse(readFileSync(new URL('./fixtures/demo.json', import.meta.url), 'utf8')));
const layout = buildLayout(job), calc = api653(job, layout), html = buildReport(job, layout, calc, { name: 'T' }, [], {});
const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];

test('print rules: headings and captions stay with what follows; rows, boxes and result sections do not split', () => {
  assert.match(css, /\.report h3\.rp-s, \.report h3\.rp-h3, \.report \.rp-tcap[^{]*\{ break-after: avoid; \}/);
  assert.match(css, /\.report thead \{ display: table-header-group; \}/);
  assert.match(css, /\.report tr, \.report table\.kv[^{]*\{ break-inside: avoid; \}/);
  assert.match(css, /\.report table \+ p\.note[^{]*\{ break-before: avoid; \}/);
  assert.match(css, /\.report \.calc \.calc-res \{ break-inside: avoid; \}/);
  assert.match(css, /\.report \.rbox, \.report \.abox \{[^}]*break-inside: avoid/);
});

test('long sections may break across pages; drawing sheets close their chapter', () => {
  assert.ok(!/<section class="pb-avoid"><h3 class="rp-s"[^>]*><span class="rp-no">[\d.]+<\/span>Repairs/.test(html), 'repairs may break');
  assert.ok(!/class="pb"><h3 class="rp-s"[^>]*><span class="rp-no">[\d.]+<\/span>Rim seal/.test(html), 'no forced break before the rim seal');
  // floor: the floor plan sheet comes after the repairs; roof: both plan sheets after the rim seal section
  const at = (s) => html.indexOf(s);
  assert.ok(at('Repair status') > 0 && at('Floor plan — viewed from above') > at('</b> Repair status'));
  assert.ok(at('Fixed roof plan — viewed from above') > at('Rim seal inspection</h3>'));
  assert.ok(at('Floating roof plan — viewed from above') > at('Fixed roof plan — viewed from above'));
  // settlement: the results come before the figure page
  assert.ok(at('</b> Shell settlement results') < at('</b> Shell settlement — plan and measured points'));
});
