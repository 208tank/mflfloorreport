// Checks on the source itself: the offline file list, escaping helpers, and module hygiene.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { esc, escText } from '../js/util.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('sw.js ASSETS lists exactly the files the app needs offline', () => {
  const sw = read('sw.js');
  const list = JSON.parse('[' + sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']');
  const files = ['./', './index.html', './manifest.webmanifest',
    ...readdirSync(new URL('css/', root)).map((f) => './css/' + f),
    ...readdirSync(new URL('js/', root), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => './js/' + f),
    ...readdirSync(new URL('icons/', root)).map((f) => './icons/' + f)];
  const unused = ['./icons/icon-maskable.svg']; // source artwork, not referenced by the app
  const missing = files.filter((f) => !list.includes(f) && !unused.includes(f)), extra = list.filter((f) => !files.includes(f));
  assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, 'update ASSETS in sw.js');
  assert.equal(new Set(list).size, list.length, 'ASSETS has duplicates');
});

test('esc escapes every HTML special character; escText all but the apostrophe', () => {
  assert.equal(esc(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(escText(`5'-6" <b>`), '5\'-6&quot; &lt;b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(0), '0');
});

test('no module interpolates into a single-quoted HTML attribute (escText would not protect it)', () => {
  for (const f of readdirSync(new URL('js/', root), { recursive: true }).filter((x) => x.endsWith('.js'))) {
    assert.doesNotMatch(read('js/' + f), /=\s*'\$\{/, `js/${f}: use double-quoted attributes`);
  }
});

test('only util.js defines an HTML escape helper', () => {
  for (const f of readdirSync(new URL('js/', root)).filter((x) => x.endsWith('.js') && x !== 'util.js')) {
    assert.doesNotMatch(read('js/' + f), /\.replace\(\/\[&<>"'?\]\/g/, `js/${f} has its own escape helper; import it from util.js`);
  }
});

test('the calculation modules do not touch the page (so they stay testable in Node)', () => {
  for (const f of ['calc', 'settle', 'shell', 'geometry', 'design', 'tables', 'patches', 'units', 'model', 'seal', 'roof', 'sections', 'builder', 'equipment', 'registry', 'util', 'cards']) {
    assert.doesNotMatch(read(`js/${f}.js`), /\bdocument\.|\bwindow\.|localStorage/, `js/${f}.js uses the DOM`);
  }
});
