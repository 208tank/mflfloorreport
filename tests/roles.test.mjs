// Inspector and admin roles (v3.40): who may edit a job and change its stage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminFor, inspectorLocked, pinHash, pinOk, stageChangeKind, stageChangeRefusal, LOCK_STAGES } from '../js/roles.js';
import { STAGES } from '../js/model.js';

test('roles: Admin review sits between Peer review and Complete', () => {
  assert.deepEqual(STAGES.map(([k]) => k), ['upcoming', 'inspection', 'reporting', 'review', 'admin', 'complete']);
  assert.deepEqual([...LOCK_STAGES], ['review', 'admin', 'complete']);
});

test('roles: inspectors are locked out from Peer review on', () => {
  for (const [st, locked] of [['upcoming', false], ['inspection', false], ['reporting', false], ['review', true], ['admin', true], ['complete', true]]) assert.equal(inspectorLocked({ status: { stage: st } }), locked, st);
});

test('roles: stage changes — inspectors send to Peer review; everything after is the admin\'s', () => {
  assert.equal(stageChangeRefusal('reporting', 'review', false), '');
  assert.equal(stageChangeRefusal('inspection', 'reporting', false), '');
  assert.match(stageChangeRefusal('reporting', 'admin', false), /Only an admin/);
  assert.match(stageChangeRefusal('reporting', 'complete', false), /Only an admin/);
  for (const to of ['reporting', 'admin', 'complete', 'inspection']) assert.match(stageChangeRefusal('review', to, false), /only an admin/);
  assert.match(stageChangeRefusal('complete', 'admin', false), /only an admin/);
  for (const [f, t] of [['review', 'admin'], ['admin', 'complete'], ['review', 'reporting'], ['complete', 'admin'], ['reporting', 'complete']]) assert.equal(stageChangeRefusal(f, t, true), '');
  assert.equal(stageChangeKind('reporting', 'review'), 'submit');
  assert.equal(stageChangeKind('review', 'reporting'), 'unlock');
  assert.equal(stageChangeKind('admin', 'inspection'), 'unlock');
  assert.equal(stageChangeKind('complete', 'admin'), 'reopen');
  assert.equal(stageChangeKind('review', 'admin'), '');
});

test('roles: admin mode counts for a job only with the PIN the job carries', async () => {
  const a = await pinHash('4821'), b = await pinHash(' 4821 '), c = await pinHash('9999');
  assert.equal(a, b, 'surrounding spaces are ignored'); assert.notEqual(a, c);
  assert.ok(!a.includes('4821'), 'only a hash is kept');
  assert.equal(adminFor({ adminPin: a }, { on: true, hash: a }), true);
  assert.equal(adminFor({ adminPin: a }, { on: true, hash: c }), false, 'a PIN set on another device does not unlock it');
  assert.equal(adminFor({}, { on: true, hash: c }), true, 'a job not yet stamped');
  assert.equal(adminFor({ adminPin: a }, { on: false, hash: a }), false);
  assert.equal(pinOk('123'), false); assert.equal(pinOk('1234'), true);
});
