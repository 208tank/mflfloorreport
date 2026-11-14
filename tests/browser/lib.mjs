// Browser test helpers: serves the app locally and drives it in Chromium with Playwright.
//   node tests/browser/run.mjs            (needs the `playwright` package and a Chromium)
// Each check is a small async function; the run fails if any check fails or the page logs an error.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let pw;
try { pw = await import('playwright'); } catch {
  pw = createRequire(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/')('playwright');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

/** Static server. `overrides` lets a test swap a file's content (to simulate a new release). */
export function serve(overrides = new Map(), headers = {}, root = ROOT) {
  const srv = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    try {
      const body = overrides.has(p) ? overrides.get(p) : await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', ...headers });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}/` })));
}

export async function launch() {
  const opts = { headless: true };
  try { return await pw.chromium.launch(opts); } catch { return pw.chromium.launch({ ...opts, channel: 'chrome' }); }
}

/** A fresh page on the app with the demo job loaded. Collects page errors in page.errors. */
export async function appPage(browser, url, { demo = true, ctx } = {}) {
  const context = ctx || (await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true }));
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.tfi && document.querySelector('#main').children.length);
  if (demo) {
    await page.evaluate(() => window.tfi.go('jobs'));
    await page.click('[data-act="job-demo"]');
    await page.waitForFunction(() => window.tfi.job()?.info?.tankId === 'TK-101');
    // openJob() finishes by switching to the floor map; wait for that so a test's own go() isn't overtaken
    await page.waitForFunction(() => window.__app.view === 'map' && document.querySelector('#mapbox svg'));
  }
  return page;
}

