// Stage 3 — crash recovery journal (js/journal.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJournal, recoveryDiff } from '../js/journal.js';

/** A stand-in for localStorage (optionally full). */
function store({ full = false } = {}) {
  const m = new Map();
  return { m, get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), removeItem: (k) => m.delete(k),
    setItem: (k, v) => { if (full && k.startsWith('tfi-journal:')) throw new DOMException('full', 'QuotaExceededError'); m.set(k, String(v)); } };
}
const job = (id, extra = {}) => ({ id, info: { tankId: 'TK-' + id }, updated: 1000, edits: 0, ...extra });

test('an entry stays until its device write is confirmed, then is cleared', () => {
  const st = store(), j = createJournal({ storage: st, session: 'a' });
  j.put(job('1')); assert.ok(st.getItem('tfi-journal:1'));
  j.clear('1'); assert.equal(st.getItem('tfi-journal:1'), null);
});

test('entries of a tab that is still running are not orphans; those of a dead tab are', () => {
  let t = 0; const st = store(), now = () => t;
  const a = createJournal({ storage: st, session: 'a', now, aliveMs: 100 }), b = createJournal({ storage: st, session: 'b', now, aliveMs: 100 });
  a.heartbeat(); a.put(job('1'));
  t = 50; b.heartbeat();
  assert.deepEqual(b.orphans(), [], 'tab a is alive');
  t = 500; b.heartbeat();
  assert.deepEqual(b.orphans().map((e) => e.job.id), ['1'], 'tab a stopped beating');
  assert.deepEqual(a.orphans(), [], 'a tab never treats its own entries as orphans');
});

test('a tab only clears its own entry; remove clears any', () => {
  const st = store(), a = createJournal({ storage: st, session: 'a' }), b = createJournal({ storage: st, session: 'b' });
  a.put(job('1')); b.clear('1');
  assert.ok(st.getItem('tfi-journal:1'));
  b.remove('1'); assert.equal(st.getItem('tfi-journal:1'), null);
});

test('a full storage is reported, not thrown', () => {
  const j = createJournal({ storage: store({ full: true }), session: 'a' });
  assert.equal(j.put(job('1')), false);
  assert.equal(j.failed, true);
});

test('a damaged entry is listed as broken so it can be removed', () => {
  const st = store(); st.setItem('tfi-journal:x', '{not json');
  assert.deepEqual(createJournal({ storage: st, session: 'z', aliveMs: 0 }).orphans().map((e) => !!e.broken), [true]);
});

test('recoveryDiff offers only changes newer than the device copy', () => {
  const e = { job: job('1', { updated: 2000, edits: 5, editAreas: ['Floor', 'Shell'] }) };
  assert.equal(recoveryDiff(e, null).action, 'gone');
  assert.equal(recoveryDiff(e, job('1', { updated: 2000 })).action, 'stale');
  assert.equal(recoveryDiff(e, job('1', { updated: 3000 })).action, 'stale');
  assert.deepEqual(recoveryDiff(e, job('1', { updated: 1500, edits: 3, editAreas: ['Floor'] })), { action: 'offer', n: 2, areas: ['Shell'], at: 2000 });
});
