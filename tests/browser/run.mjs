// Browser tests: serves the app locally and drives it in Chromium with Playwright.
//   node tests/browser/run.mjs [filter]   (needs the `playwright` package and a Chromium)
import { serve, launch, appPage } from './lib.mjs';

const checks = (await import('./checks.mjs')).default;
const only = process.argv[2];
const browser = await launch();
const { srv, url } = await serve();
let failed = 0;
for (const [name, fn] of Object.entries(checks)) {
  if (only && !name.includes(only)) continue;
  try { await fn({ browser, url, serve, appPage }); console.log('ok    ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.stack || e).split('\n').slice(0, 40).join('\n      ')); }
}
await browser.close(); srv.close();
console.log(failed ? `${failed} browser check(s) failed` : 'all browser checks passed');
process.exit(failed ? 1 : 0);
