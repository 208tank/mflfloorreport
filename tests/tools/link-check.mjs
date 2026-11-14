// Links every app module the way the browser does, without running them: each `import { a } from './x.js'`
// must find a module x.js that exports a. Run with: node --experimental-vm-modules tests/tools/link-check.mjs
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []; });
const cache = new Map(), problems = [];
const ctx = vm.createContext({});
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const m = new vm.SourceTextModule(readFileSync(path, 'utf8'), { identifier: pathToFileURL(path).href, context: ctx });
  cache.set(path, m); return m;
}
async function linker(spec, ref) {
  const from = fileURLToPath(ref.identifier);
  if (!spec.startsWith('.')) throw new Error(`${from}: imports "${spec}" — the app may only import its own files`);
  return load(resolve(dirname(from), spec));
}
const all = files(join(root, 'js'));
for (const f of all) {
  const m = load(f);
  if (m.status !== 'unlinked') continue; // already linked as a dependency of an earlier file
  try { await m.link(linker); }
  catch (e) { problems.push(`${f.slice(root.length + 1)}: ${e.message}`); }
}
if (problems.length) { console.log(problems.join('\n')); process.exit(1); }
console.log(`linked ${all.length} modules`);
