// Runs the same sequence of edits on two copies of the app and compares, after every step, the open job's
// data and the screen HTML. Used to confirm a refactoring step leaves a screen's behaviour unchanged.
//   node tests/tools/actions-diff.mjs <old app folder> <new app folder> <script name in tests/tools/scripts/>
// A script is a list of steps: { go }, { fill, value, key? } (typed, then Tab unless key says otherwise), { click }, { select, value }, { check },
// { confirm: 'yes' | 'no' }. Ids and times are made repeatable (fixed clock, seeded random numbers).
import { serve, launch } from '../browser/lib.mjs';
import { resolve, sep } from 'node:path';
const [oldDir, newDir, name] = process.argv.slice(2);
const { steps } = await import(`./scripts/${name}.mjs`);

async function run(dir) {
  const browser = await launch();
  const { srv, url } = await serve(new Map(), {}, resolve(dir) + sep);
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { let t = 1794700000000; Date.now = () => t; Math.random = (() => { let x = 0.5; return () => (x = (x * 9301 + 49297) % 233280 / 233280); })(); });
  await page.goto(url);
  await page.waitForFunction(() => window.tfi && document.querySelector('#main').children.length);
  await page.evaluate(() => window.tfi.go('jobs'));
  await page.click('[data-act="job-demo"]');
  await page.waitForFunction(() => window.tfi.job()?.info?.tankId === 'TK-101');
  await page.waitForTimeout(1500);
  const out = [];
  for (const s of steps) {
    if (s.go) await page.evaluate((v) => window.tfi.go(v), s.go);
    else if (s.fill) { await page.fill(s.fill, s.value); await page.press(s.fill, s.key || 'Tab'); }
    else if (s.click) await page.click(s.click);
    else if (s.select) await page.selectOption(s.select, s.value);
    else if (s.check) await page.click(s.check);
    else if (s.confirm) await page.click(`[data-cf="${s.confirm}"]`);
    await page.waitForTimeout(300);
    out.push(await page.evaluate(() => {
      const j = structuredClone(window.tfi.job()); delete j.updated; delete j.edits; delete j.editAreas;
      return { job: JSON.stringify(j), main: document.querySelector('#main').innerHTML, focus: document.activeElement?.outerHTML?.slice(0, 120) || '' };
    }));
  }
  await browser.close(); srv.close();
  return { out, errors };
}
const norm = (s) => s.replace(/v3\.\d+\.\d+/g, 'vX');
const a = await run(oldDir), b = await run(newDir);
let diffs = 0;
steps.forEach((s, i) => {
  for (const part of ['job', 'main', 'focus']) {
    const x = norm(a.out[i][part]), y = norm(b.out[i][part]);
    if (x !== y) { diffs++; let k = 0; while (x[k] === y[k]) k++; console.log(`DIFF step ${i + 1} ${JSON.stringify(s)} ${part} @${k}\n  old: …${x.slice(Math.max(0, k - 80), k + 120)}\n  new: …${y.slice(Math.max(0, k - 80), k + 120)}`); }
  }
});
if (a.errors.length || b.errors.length) { diffs++; console.log('page errors', { old: a.errors, new: b.errors }); }
const changed = a.out.filter((o, i) => i && o.job !== a.out[i - 1].job).length;
console.log(diffs ? `${diffs} difference(s)` : `all ${steps.length} steps identical (${changed} changed the job)`);
process.exit(diffs ? 1 : 0);
