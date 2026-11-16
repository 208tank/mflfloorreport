// Print audit (report improvements R7): print a job's report to PDF and list pages that print badly.
//   node tests/tools/print-audit.mjs <job.json> [out.pdf] [--a4] [--tabloid] [--portrait]
// Needs Playwright (as for the browser checks) and poppler's pdftotext. Flags:
//   short      a page less than 35 % full that is followed by more content (not a drawing sheet, not the last page
//              of a chapter or appendix)
//   orphan     a page whose last line is a section heading or a table caption (its table starts on the next page)
//   split-box  a calculated-result / assessment box broken across pages
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { serve, launch, appPage } from '../browser/lib.mjs';

const args = process.argv.slice(2), file = args.find((a) => a.endsWith('.json')), out = args.find((a) => a.endsWith('.pdf')) || '/tmp/print-audit.pdf';
if (!file) { console.error('usage: node tests/tools/print-audit.mjs <job.json> [out.pdf] [--a4] [--tabloid] [--portrait]'); process.exit(2); }
const raw = JSON.parse(readFileSync(file, 'utf8')), job = raw.job || raw;

const { srv, url } = await serve(); const browser = await launch();
const page = await appPage(browser, url, { demo: false });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.setViewportSize({ width: 1280, height: 1000 });
await page.evaluate(async ({ job, a4, tabloid, portrait }) => {
  const { migrate } = await import('./js/model.js'); const { createJob } = await import('./js/views/jobs.js'); const { S } = await import('./js/app/state.js');
  if (a4) S.company.pageSize = 'a4';
  S.reportOpts.layout = { ...(S.reportOpts.layout || {}), drawPaper: tabloid ? 'tabloid' : 'report', drawOrient: portrait ? 'portrait' : 'landscape' };
  await createJob(migrate(job));
}, { job, a4: args.includes('--a4'), tabloid: args.includes('--tabloid'), portrait: args.includes('--portrait') });
await page.waitForFunction((id) => window.tfi.job()?.id === id && window.__app.view === 'map', job.id, { timeout: 120000 });
await page.evaluate(() => window.tfi.go('report'));
await page.waitForSelector('#reportRoot .report h2.rp-ch', { timeout: 120000 }); await page.waitForTimeout(800);
await page.addStyleTag({ content: '.rp-draft { display: none !important; }' }); // the diagonal watermark would read as page content
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true, timeout: 300000 });
await browser.close(); srv.close();

// ---- read every page's words with their positions
const xml = execFileSync('pdftotext', ['-bbox', out, '-'], { maxBuffer: 1 << 28 }).toString();
const pages = [...xml.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)].map(([, w, h, body]) => ({
  w: +w, h: +h, words: [...body.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)].map(([, x0, y0, x1, y1, t]) => ({ x0: +x0, y0: +y0, x1: +x1, y1: +y1, t: t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') })),
}));
const issues = [];
pages.forEach((p, k) => {
  // body: inside the page margins (header and footer live in the margin boxes)
  const top = p.h > p.w ? 0.75 * 72 : 0.6 * 72, bot = p.h - (p.h > p.w ? 0.7 * 72 : 0.6 * 72);
  const body = p.words.filter((w) => w.y0 > top - 2 && w.y1 < bot + 2 && !/^DRAFT$/.test(w.t));
  const landscape = p.w > p.h;
  if (!body.length) { issues.push({ page: k + 1, kind: 'empty' }); return; }
  const lines = []; for (const w of body.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) { const l = lines.at(-1); if (l && Math.abs(l.y - w.y0) < 2.5) l.t.push(w.t); else lines.push({ y: w.y0, y1: w.y1, t: [w.t] }); }
  const fill = (Math.max(...body.map((w) => w.y1)) - top) / (bot - top), last = lines.at(-1).t.join(' '), first = lines[0].t.join(' ');
  const next = pages[k + 1], nextFirst = (() => { if (!next) return ''; const nb = next.words.filter((w) => w.y0 > top - 2 && w.y1 < bot + 2 && !/^DRAFT$/.test(w.t)).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0); return nb.length ? nb.filter((w) => Math.abs(w.y0 - nb[0].y0) < 2.5).map((w) => w.t).join(' ') : ''; })();
  const nextStartsChapter = /^([0-9]{1,2}|[A-Z]) [A-Z]/.test(nextFirst) && next && next.words.some((w) => w.y0 < top + 40 && w.t.length > 2);
  const isList = lines.filter((l) => /^(Table|Figure) [0-9A-Z]+-\d+/.test(l.t.join(' '))).length > 4 || (lines.length > 8 && lines.filter((l) => /^[0-9]{1,2}(\.[0-9]{1,2})? \S/.test(l.t.join(' '))).length >= 0.9 * lines.length); // the contents page
  if (!landscape && fill < 0.35 && next) issues.push({ page: k + 1, kind: nextStartsChapter ? 'short-chapter-end' : next.w > next.h ? 'short-before-sheet' : 'short', fill: Math.round(fill * 100) + '%', last });
  if (isList) return;
  if (/^Table [0-9A-Z]+-\d+/.test(last) || /^[0-9]{1,2}\.[0-9]+ [A-Z]/.test(last) || /^[1-5] (Inputs|Assumptions|References|Working|Result)$/.test(last)) issues.push({ page: k + 1, kind: 'orphan', last });
  if (/^(CALCULATED RESULT|ENGINEERING ASSESSMENT)/.test(last)) issues.push({ page: k + 1, kind: 'split-box', last });
  void first;
});
console.log(JSON.stringify({ file, pages: pages.length, errors: errs, issues }, null, 1));
