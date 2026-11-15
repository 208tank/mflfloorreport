// Structure checks for the modular refactoring: every module parses, every import finds a matching
// export, no name is used without being defined or imported, and the offline cache lists every module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const root = new URL('..', import.meta.url).pathname;
const jsFiles = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? jsFiles(p) : p.endsWith('.js') ? [p] : []; });

test('every module parses as an ES module', () => {
  for (const f of [...jsFiles(join(root, 'js')), join(root, 'sw.js')]) {
    try { execFileSync(process.execPath, ['--input-type=module', '--check'], { input: readFileSync(f), stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { assert.fail(`${f}: ${String(e.stderr)}`); }
  }
});

test('every import links to a matching export (as the browser loads them)', () => {
  const out = execFileSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', join(root, 'tests/tools/link-check.mjs')], { encoding: 'utf8' });
  assert.match(out, /linked \d+ modules/);
});

test('no name is used without being defined or imported', async (t) => {
  let ESLint;
  for (const from of [import.meta.url, '/opt/node-tools/node_modules/', '/opt/npm-tools/node_modules/']) {
    try { ({ ESLint } = createRequire(from.startsWith('/') ? from + 'x.js' : from)('eslint')); break; } catch { /* try the next place */ }
  }
  if (!ESLint) return t.skip('eslint not installed (CI installs it)');
  const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, 'tests/tools/eslint.config.mjs') });
  const res = await eslint.lintFiles(['js', 'sw.js']);
  const errors = res.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => `${r.filePath.slice(root.length)}:${m.line} ${m.message}`));
  assert.deepEqual(errors, []);
});

test('the offline cache lists every module under js/', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const missing = jsFiles(join(root, 'js')).map((f) => './' + f.slice(root.length)).filter((p) => !sw.includes(`'${p}'`));
  assert.deepEqual(missing, []);
});

test('no import loops between modules (screen modules may reuse each other, but never in a circle)', () => {
  const files = jsFiles(join(root, 'js'));
  const deps = new Map(files.map((f) => {
    const src = readFileSync(f, 'utf8');
    const list = [...src.matchAll(/^import\s+(?:[^;]*?\s+from\s+)?'([^']+)'/gm)].map((m) => join(f, '..', m[1]));
    return [f, list];
  }));
  const loops = [];
  const visit = (f, path) => {
    for (const d of deps.get(f) || []) {
      if (path.includes(d)) { loops.push([...path.slice(path.indexOf(d)), d].map((p) => p.slice(root.length)).join(' → ')); continue; }
      if (path.length < 40) visit(d, [...path, d]);
    }
  };
  for (const f of files) visit(f, [f]);
  assert.deepEqual([...new Set(loops)], []);
});

test('every module under js/ is loaded by app.js, directly or through another (screen modules register themselves)', () => {
  const seen = new Set(), todo = [join(root, 'js/app.js')];
  while (todo.length) {
    const f = todo.pop(); if (seen.has(f)) continue; seen.add(f);
    for (const m of readFileSync(f, 'utf8').matchAll(/^import\s+(?:[^;]*?\s+from\s+)?'([^']+)'/gm)) todo.push(join(f, '..', m[1]));
  }
  assert.deepEqual(jsFiles(join(root, 'js')).filter((f) => !seen.has(f)).map((f) => f.slice(root.length)), []);
});
