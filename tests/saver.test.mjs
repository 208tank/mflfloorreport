// Stage 1 — reliable automatic saving: the save queue (js/saver.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaver, saveErrorText } from '../js/saver.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A pretend device: records each write's value and how many writes overlap. */
function device({ slow = 5, failFirst = 0, failAlways = false } = {}) {
  const d = { value: 0, stored: [], live: 0, maxLive: 0, calls: 0, fails: failFirst, failAlways };
  d.write = async () => {
    d.calls++; d.live++; d.maxLive = Math.max(d.maxLive, d.live);
    const v = d.value; await sleep(slow); d.live--;
    if (d.failAlways || d.fails > 0) { d.fails--; throw Object.assign(new Error('disk full'), { name: 'QuotaExceededError' }); }
    d.stored.push(v);
  };
  return d;
}
const fast = { debounce: 10, retryDelays: [10, 20, 30] };

test('many quick changes become one write of the latest value', async () => {
  const d = device(), s = createSaver({ write: d.write, ...fast });
  for (let i = 1; i <= 50; i++) { d.value = i; s.touch(); }
  await sleep(60);
  assert.deepEqual(d.stored, [50]);
  assert.equal(s.state, 'saved'); assert.equal(s.pending(), false);
});

test('writes never overlap; a change during a write is written next', async () => {
  const d = device({ slow: 30 }), s = createSaver({ write: d.write, ...fast });
  d.value = 1; s.touch(); await sleep(15);           // first write starts
  d.value = 2; s.touch(); s.flush(); s.flush();       // change and flushes while it runs
  assert.equal(await s.flush(), true);
  assert.equal(d.maxLive, 1);
  assert.equal(d.stored.at(-1), 2);
});

test('1,000 edits with flushes in between lose nothing and never overlap', async () => {
  const d = device({ slow: 1 }), s = createSaver({ write: d.write, ...fast });
  for (let i = 1; i <= 1000; i++) { d.value = i; s.touch(); if (i % 97 === 0) s.flush(); }
  assert.equal(await s.flush(), true);
  assert.equal(d.stored.at(-1), 1000);
  assert.equal(d.maxLive, 1);
  assert.ok(d.calls < 100, `${d.calls} writes`);
});

test('a failed write is reported and retried until it succeeds', async () => {
  const d = device({ failFirst: 2 }), states = [], s = createSaver({ write: d.write, onState: (st) => states.push(st), ...fast });
  d.value = 7; s.touch();
  await sleep(150);
  assert.deepEqual(d.stored, [7]);
  assert.ok(states.includes('retrying'));
  assert.equal(s.state, 'saved'); assert.equal(s.pending(), false);
});

test('when retries run out the change is kept, flush says so, and the next change tries again', async () => {
  const d = device({ failAlways: true }), s = createSaver({ write: d.write, ...fast });
  d.value = 3; s.touch();
  await sleep(200);
  assert.equal(s.state, 'error');
  assert.equal(s.pending(), true, 'the change is still waiting');
  assert.equal(await s.flush(), false);
  assert.equal(saveErrorText(s.error), 'this device is out of storage space — save jobs to files and delete finished ones');
  d.failAlways = false; d.value = 4; s.touch();
  await sleep(60);
  assert.deepEqual(d.stored, [4]);
  assert.equal(s.state, 'saved');
});

test('flush with nothing to save resolves true at once; discard forgets the change', async () => {
  const d = device(), s = createSaver({ write: d.write, ...fast });
  assert.equal(await s.flush(), true);
  assert.equal(d.calls, 0);
  d.value = 9; s.touch(); s.discard();
  await sleep(40);
  assert.equal(d.calls, 0); assert.equal(s.pending(), false);
});
