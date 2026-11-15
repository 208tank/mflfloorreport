// Data integrity stage 8c: the issued report inside a job file (version 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { packPhoto, readIssued, unpackHtml, PHOTO_REF } from '../js/issuedfile.js';
import { validateJobFile } from '../js/validate.js';
import { sha256 } from '../js/util.js';

const demoJob = () => JSON.parse(readFileSync(new URL('./fixtures/demo.json', import.meta.url), 'utf8'));
const P1 = { id: 'ph1', dataUrl: 'data:image/png;base64,AAAA' }, P2 = { id: 'ph10', dataUrl: 'data:image/png;base64,BBBB' };
const HTML = `<div class="report"><img src="${P1.dataUrl}"><img src="${P2.dataUrl}"><img src="${P1.dataUrl}"><p>Demo</p></div>`;
const packed = () => [P1, P2].reduce(packPhoto, HTML);
const v2 = async (job, extra = {}) => ({ format: 'tank-floor-inspector', version: 2, saved: '2026-11-15T00:00:00.000Z', rev: 1, job, photos: [P1, P2], ...extra });
const completeJob = () => { const j = demoJob(); j.status = { stage: 'complete', history: [] }; return j; };
const opts = { schema: 4, fileVersion: 2 };

test('photos in the report are written as references and put back exactly', async () => {
  const p = packed();
  assert.ok(!p.includes('base64'), 'no image data left in the packed report');
  assert.equal((p.match(new RegExp(PHOTO_REF, 'g')) || []).length, 3);
  assert.ok(p.includes(`"${PHOTO_REF}ph10"`) && p.includes(`"${PHOTO_REF}ph1"`), 'ids that share a prefix stay distinct');
  assert.equal(unpackHtml(p, [P1, P2]), HTML);
  const r = await readIssued({ html: p, hash: await sha256(HTML), at: 1 }, [P1, P2]);
  assert.equal(r.html, HTML); assert.equal(r.problem, undefined);
});

test('a changed or incomplete issued report is reported, not kept', async () => {
  const hash = await sha256(HTML);
  assert.match((await readIssued({ html: packed().replace('Demo', 'Demo!'), hash }, [P1, P2])).problem, /does not match its checksum/);
  assert.match((await readIssued({ html: packed(), hash }, [P1])).problem, /refers to photos that are not in the file/);
  assert.match((await readIssued({ hash }, [])).problem, /incomplete/);
});

test('validator: a version 2 file of a Complete job returns its issued report', async () => {
  const v = await validateJobFile(await v2(completeJob(), { issued: { n: 4, at: 5, hash: await sha256(HTML), html: packed(), appVersion: '3.17.1' } }), opts);
  assert.deepEqual(v.errors, []); assert.deepEqual(v.warnings, []);
  assert.equal(v.issued.html, HTML); assert.equal(v.issued.appVersion, '3.17.1');
});

test('validator: problems with the issued report are warnings, and it is not kept', async () => {
  const bad = await validateJobFile(await v2(completeJob(), { issued: { hash: '0'.repeat(64), html: packed() } }), opts);
  assert.equal(bad.issued, null); assert.match(bad.warnings.join('\n'), /issued report does not match its checksum: the job opens without it/);
  const notComplete = await validateJobFile(await v2(demoJob(), { issued: { hash: await sha256(HTML), html: packed() } }), opts);
  assert.equal(notComplete.issued, null); assert.match(notComplete.warnings.join('\n'), /not Complete/);
  const missing = await validateJobFile(await v2(completeJob()), opts);
  assert.match(missing.warnings.join('\n'), /Complete but the file has no issued report/);
  const v1 = await validateJobFile({ ...(await v2(completeJob())), version: 1 }, opts);
  assert.deepEqual(v1.warnings, [], 'a version 1 file never had one: nothing to warn about');
  const audit = await validateJobFile(await v2(demoJob(), { audit: {} }), opts);
  assert.match(audit.warnings.join('\n'), /audit trail is not a list/);
});
