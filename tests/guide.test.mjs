// The user guide (js/guide.js) is kept up to date: it is reviewed for every release (GUIDE_VERSION = APP_VERSION) and it
// mentions every page in the side menu. When this fails, update the guide's steps for what changed, then its version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDE, GUIDE_VERSION, guideText } from '../js/guide.js';
import { SECTIONS } from '../js/sections.js';
import { MAP_LAYERS } from '../js/map.js';

const appVersion = readFileSync(new URL('../js/app/state.js', import.meta.url), 'utf8').match(/APP_VERSION = '([^']+)'/)[1];
const menu = (src, name) => [...src.slice(src.indexOf(`export const ${name} = [`)).split('];')[0].matchAll(/\['(\w+)', '([^']+)'/g)].map((m) => [m[1], m[2]]);
const state = readFileSync(new URL('../js/app/state.js', import.meta.url), 'utf8');
const text = guideText().toLowerCase();

test('user guide: reviewed for this release (GUIDE_VERSION is the app version)', () => {
  assert.equal(GUIDE_VERSION, appVersion, 'Update js/guide.js for the changes in this release, then set GUIDE_VERSION to the new APP_VERSION.');
});

test('user guide: every page in the side menu and every data page is mentioned', () => {
  const pages = [...menu(state, 'VIEWS'), ...menu(state, 'VIEWS_END'), ...SECTIONS.flatMap((s) => s.nde)].filter(([v]) => v !== 'guide');
  const missing = pages.filter(([, label]) => !text.includes(label.toLowerCase()));
  assert.deepEqual(missing, [], 'Add these pages to the user guide');
});

test('user guide: every floor map layer is mentioned', () => {
  const words = { indLabels: 'indication numbers', showScan: 'scan hatching', showPatches: 'repair patches', showCZ: 'critical zone line' };
  const missing = MAP_LAYERS.filter(([k, l]) => !text.includes((words[k] || l).toLowerCase()));
  assert.deepEqual(missing.map(([k]) => k), []);
});

test('user guide: links open real pages, section ids are unique', () => {
  const views = new Set([...menu(state, 'VIEWS'), ...menu(state, 'VIEWS_END'), ...SECTIONS.flatMap((s) => s.nde)].map(([v]) => v));
  const bad = GUIDE.flatMap((s) => [...s.html.matchAll(/\[\[([^|\]]+)\|/g)].map((m) => m[1])).filter((v) => !views.has(v));
  assert.deepEqual(bad, []);
  assert.equal(new Set(GUIDE.map((s) => s.id)).size, GUIDE.length);
});
