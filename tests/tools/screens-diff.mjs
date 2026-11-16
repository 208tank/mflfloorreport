// Renders every screen with the demo job in two copies of the app and compares the HTML.
//   node tests/tools/screens-diff.mjs <old app folder> <new app folder>
// Field ids (random per draw) and the version number are normalised; anything else that differs is listed.
import { serve, launch } from '../browser/lib.mjs';
import { resolve, sep } from 'node:path';
const [oldDir, newDir] = process.argv.slice(2);
const VIEWS = ['dash', 'reg', 'jobs', 'equip', 'setup', 'summary', 'defs', 'map', 'inds', 'plates', 'api', 'shell', 'roofF', 'roofL', 'seal', 'nozzles', 'settle', 'ref', 'report', 'nde:floor', 'obs:floor', 'photos:floor', 'recs:floor', 'an:floor', 'obs:shell', 'recs:settle', 'defrep', 'equip', 'an:shell', 'an:froof', 'an:nozzles', 'photos:shell'];
async function capture(dir) {
  const browser = await launch();
  const { srv, url } = await serve(new Map(), {}, resolve(dir) + sep);
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(() => { let t = 1794700000000; Date.now = () => t; Math.random = (() => { let x = 1; return () => (x = (x * 9301 + 49297) % 233280) / 233280; })(); });
  await page.goto(url);
  await page.waitForFunction(() => window.tfi && document.querySelector('#main').children.length);
  await page.evaluate(() => window.tfi.go('jobs'));
  await page.click('[data-act="job-demo"]');
  await page.waitForFunction(() => window.tfi.job()?.info?.tankId === 'TK-101');
  await page.waitForFunction(() => /Last checked/.test(document.body.innerHTML) || !document.querySelector('#integrityLast'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500); // let the start-up data check finish
  const out = {};
  for (const v of VIEWS) {
    await page.evaluate((x) => window.tfi.go(x), v);
    await page.waitForTimeout(250);
    out[v] = await page.evaluate(() => ({ main: document.querySelector('#main').innerHTML, nav: document.querySelector('#nav').innerHTML, head: document.querySelector('#jobTitle').innerHTML }));
  }
  await browser.close(); srv.close();
  return out;
}
const norm = (s) => s.replace(/\b(f_|id=")[a-z0-9]+\b/g, "$1X").replace(/v3\.\d+\.\d+/g, "vX").replace(/\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{10,14}\b/g, "ID"); // random field and item ids may be shorter than usual
const a = await capture(oldDir), b = await capture(newDir);
let diffs = 0;
for (const v of VIEWS) for (const part of ['main', 'nav', 'head']) {
  const x = norm(a[v][part]), y = norm(b[v][part]);
  if (x !== y) { diffs++; let i = 0; while (x[i] === y[i]) i++; console.log(`DIFF ${v} ${part} @${i}\n  old: …${x.slice(Math.max(0, i - 80), i + 120)}\n  new: …${y.slice(Math.max(0, i - 80), i + 120)}`); }
}
console.log(diffs ? `${diffs} screen part(s) differ` : `all ${VIEWS.length} screens identical`);
process.exit(diffs ? 1 : 0);
