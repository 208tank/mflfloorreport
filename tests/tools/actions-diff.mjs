// Runs the same sequence of edits on two copies of the app and compares, after every step, the open job's
// data, the tank registry records, the photo records, settings and job list, and the screen HTML. Used to confirm a refactoring step leaves a screen's behaviour unchanged.
//   node tests/tools/actions-diff.mjs <old app folder> <new app folder> <script name in tests/tools/scripts/>
// A script is a list of steps: { go }, { fill, value, key? } (typed, then Tab unless key says otherwise), { click }, { select, value } (value may be { index }), { check }, { at, x, y } (click a point on a drawing), { js } (run code in the page, e.g. pick a map item), { drag, to }, { upload } (a small photo into a file input), { press } (a key), { download } (click and compare the downloaded file),
// { confirm: 'yes' | 'no' }, { confirmIf } (answer only if a confirmation is showing). Ids and times are made repeatable (fixed clock, seeded random numbers).
import { serve, launch } from '../browser/lib.mjs';
import { resolve, sep } from 'node:path';
const [oldDir, newDir, name] = process.argv.slice(2);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEUlEQVR4nGM4YWODFTEMpAQAr9U8AVonTcEAAAAASUVORK5CYII='; // an 8×6 px photo for upload steps
const { steps } = await import(`./scripts/${name}.mjs`);

async function run(dir) {
  const browser = await launch();
  const { srv, url } = await serve(new Map(), {}, resolve(dir) + sep);
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { let t = 1794700000000; const D = Date; globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [t])); } static now() { return t; } }; Math.random = (() => { let x = 1; return () => (x = (x * 9301 + 49297) % 233280) / 233280; })(); });
  await page.goto(url);
  await page.waitForFunction(() => window.tfi && document.querySelector('#main').children.length);
  await page.evaluate(() => window.tfi.go('jobs'));
  await page.click('[data-act="job-demo"]');
  await page.waitForFunction(() => window.tfi.job()?.info?.tankId === 'TK-101');
  await page.waitForTimeout(1500);
  const out = []; let file = '';
  for (const [n, s] of steps.entries()) {
    try {
    if (s.go) await page.evaluate((v) => window.tfi.go(v), s.go);
    else if (s.fill) { await page.fill(s.fill, s.value); await page.press(s.fill, s.key || 'Tab'); }
    else if (s.click) await page.click(s.click);
    else if (s.select) await page.selectOption(s.select, s.value);
    else if (s.check) await page.click(s.check);
    else if (s.at) await page.click(s.at, { position: { x: s.x, y: s.y } });
    else if (s.js) await page.evaluate(s.js);
    else if (s.drag) await page.dragAndDrop(s.drag, s.to);
    else if (s.press) await page.keyboard.press(s.press);
    else if (s.download) {
      const [d] = await Promise.all([page.waitForEvent('download'), page.evaluate((q) => document.querySelector(q).click(), s.download)]);
      const chunks = []; for await (const c of await d.createReadStream()) chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (process.env.DUMP) (await import('node:fs')).writeFileSync(`${process.env.DUMP}/${dir.replace(/\W/g, '_')}_${d.suggestedFilename()}`, buf);
      file = d.suggestedFilename() + '\n' + (/\.(csv|svg|json)$/i.test(d.suggestedFilename()) ? buf.toString('utf8') : 'binary ' + buf.length + ' bytes, sha256 ' + (await import('node:crypto')).createHash('sha256').update(buf).digest('hex'));
    }
    else if (s.upload) await page.setInputFiles(s.upload, { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
    else if (s.confirm) await page.click(`[data-cf="${s.confirm}"]`);
    else if (s.confirmIf) { if (await page.isVisible(`[data-cf="${s.confirmIf}"]`)) await page.click(`[data-cf="${s.confirmIf}"]`); }
    } catch (err) { await browser.close(); srv.close(); throw new Error(`${dir}: step ${n + 1} ${JSON.stringify(s)} failed: ${err.message.split('\n')[0]}`); }
    await page.waitForTimeout(300);
    const snap = await page.evaluate(() => {
      const j = structuredClone(window.tfi.job() || { none: true }); delete j.updated; delete j.edits; delete j.editAreas;
      return { job: JSON.stringify(j), tanks: JSON.stringify((window.__app.tanks || []).map(({ updated, ...t }) => t)), photos: JSON.stringify((window.__app.photos || []).map(({ dataUrl, ...p }) => p)), meta: JSON.stringify({ company: window.__app.company, jobs: (window.__app.jobs || []).map((c) => [c.id, c.info?.tankId, c.status?.stage]) }), main: document.querySelector('#main').innerHTML, focus: document.activeElement?.outerHTML?.slice(0, 120) || '' };
    });
    out.push({ ...snap, file }); file = '';
  }
  await browser.close(); srv.close();
  return { out, errors };
}
const norm = (s) => s.replace(/v3\.\d+\.\d+/g, 'vX');
const a = await run(oldDir), b = await run(newDir);
let diffs = 0;
steps.forEach((s, i) => {
  for (const part of ['job', 'tanks', 'photos', 'meta', 'file', 'main', 'focus']) {
    const x = norm(a.out[i][part]), y = norm(b.out[i][part]);
    if (x !== y) { diffs++; let k = 0; while (x[k] === y[k]) k++; console.log(`DIFF step ${i + 1} ${JSON.stringify(s)} ${part} @${k}\n  old: …${x.slice(Math.max(0, k - 80), k + 120)}\n  new: …${y.slice(Math.max(0, k - 80), k + 120)}`); }
  }
});
if (a.errors.length || b.errors.length) { diffs++; console.log('page errors', { old: a.errors, new: b.errors }); }
const changed = a.out.filter((o, i) => i && (o.job !== a.out[i - 1].job || o.tanks !== a.out[i - 1].tanks || o.photos !== a.out[i - 1].photos || o.meta !== a.out[i - 1].meta)).length;
console.log(diffs ? `${diffs} difference(s)` : `all ${steps.length} steps identical (${changed} changed the job)`);
if (process.env.VERBOSE) steps.forEach((s, i) => { if (i && a.out[i].job === a.out[i - 1].job && a.out[i].tanks === a.out[i - 1].tanks && a.out[i].photos === a.out[i - 1].photos && a.out[i].meta === a.out[i - 1].meta) console.log(`  step ${i + 1} left the job unchanged: ${JSON.stringify(s)}`); });
process.exit(diffs ? 1 : 0);
