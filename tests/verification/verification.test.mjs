// CI guard for the verification library: every case based on a governing equation must pass, except
// the open findings listed below (awaiting the engineer's decision on the proposed corrections).
// 'review' and 'reference' cases are reported by tests/verification/run.mjs but don't fail the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASES, check } from './cases.mjs';

// Open findings awaiting the engineer's decision (correction list). Remove an ID once its correction is made.
const KNOWN_OPEN = new Set([]);

for (const cs of CASES.filter((c) => c.basis === 'equation')) {
  test(`verification ${cs.id}: ${cs.title}`, { todo: KNOWN_OPEN.has(cs.id) ? 'open finding' : false }, () => {
    const r = check(cs);
    assert.ok(r.pass, JSON.stringify(r.rows) + (r.error ? ' ' + r.error : ''));
  });
}
