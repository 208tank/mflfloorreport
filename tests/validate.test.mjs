// Job file validation (data integrity stage 6): js/validate.js. One fixture per kind of fault, made from the demo job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateJobFile } from '../js/validate.js';
import { sha256 } from '../js/util.js';

const FIX = new URL('./fixtures/', import.meta.url);
const asFile = (job, photos = []) => ({ format: 'tank-floor-inspector', version: 1, saved: '2026-11-14T00:00:00.000Z', rev: 1, job, photos });
const demoJob = () => JSON.parse(readFileSync(new URL('demo.json', FIX), 'utf8'));
const PHOTO = (o) => ({ id: 'ph1', dataUrl: 'data:image/png;base64,AAAA', caption: '', ...o });
const opts = { schema: 4, fileVersion: 1 };
const run = (data) => validateJobFile(data, opts);

/** Each fixture: a change to a good file and the message it must produce. */
const ERRORS = {
  'not a job file': [() => ({ format: 'something-else' }), /not a Tank Floor Inspector job file/],
  'no job in the file': [() => ({ format: 'tank-floor-inspector', version: 1 }), /no job in it/],
  'newer file version': [(f) => ({ ...f, version: 2, appVersion: '9.0.0' }), /newer version of the app \(v9\.0\.0\)/],
  'newer job schema': [(f) => { f.job.schema = 99; return f; }, /newer version/],
  'job without an id': [(f) => { delete f.job.id; return f; }, /job has no id/],
  'photos not a list': [(f) => ({ ...f, photos: {} }), /photos part of the file is not a list/],
  'checksum does not match': [(f) => ({ ...f, hash: '0'.repeat(64) }), /checksum does not match/],
  'tank part of the wrong type': [(f) => { f.job.tank = 'big'; return f; }, /tank part has the wrong type/],
  'indications not a list': [(f) => { f.job.indications = {}; return f; }, /indications part is not a list/],
  'indication without an id': [(f) => { delete f.job.indications[1].id; return f; }, /Indication .* has no id/],
  'two indications with one id': [(f) => { f.job.indications[2].id = f.job.indications[1].id; return f; }, /Indications .* share the id .*edits would change both/],
  'two recommendations with one id': [(f) => { const s = Object.values(f.job.secs)[0]; s.recs = [{ id: 'r1', finding: 'a' }, { id: 'r1', finding: 'b' }]; return f; }, /Recommendations a and b \(.*\) share the id r1/],
  'a list entry that is not an object': [(f) => { f.job.nozzles.push('N9'); return f; }, /Nozzle \d+ is not a valid entry/],
  'text where a number is needed': [(f) => { f.job.indications[0].mflPct = 'about half'; return f; }, /MFL % is “about half”, which is not a number/],
  'shell course height not a number': [(f) => { f.job.shell.courses[0].h = true; return f; }, /Shell course 1: Height is “true”/],
  'photo without image data': [(f) => ({ ...f, photos: [PHOTO({ dataUrl: '' , caption: 'Sump' })] }), /Photo “Sump” has no image data/],
  'two photos with one id': [(f) => ({ ...f, photos: [PHOTO(), PHOTO()] }), /Two photos share the id ph1/],
};
const WARNINGS = {
  'MFL % over 100': [(f) => { f.job.indications[0].mflPct = 120; return f; }, /MFL % is 120 — expected 0 to 100/],
  'thickness of 0': [(f) => { f.job.indications[0].utMin = 0; return f; }, /UT minimum is 0 — expected more than 0/],
  'negative distance': [(f) => { f.job.indications[0].x = -3; return f; }, /X is -3 — expected 0 or more/],
  'nozzle angle over 360': [(f) => { f.job.nozzles[0].angle = 400; return f; }, /Angle is 400 — expected 0 to 360/],
  'diameter of 0': [(f) => { f.job.tank.diameter = 0; return f; }, /Tank: Diameter is 0/],
  'plate not in the layout': [(f) => { f.job.indications[0].plate = 'r99c99'; return f; }, /on plate r99c99, which is not in the floor layout/],
  'photo of a missing indication': [(f) => ({ ...f, photos: [PHOTO({ indId: 'gone', caption: 'Pit' })] }), /Photo “Pit” belongs to an indication that is not in the job/],
  'photo in an unknown section': [(f) => ({ ...f, photos: [PHOTO({ sec: 'attic' })] }), /unknown section \(attic\)/],
  'photo linked to a missing observation': [(f) => ({ ...f, photos: [PHOTO({ sec: 'floor', obs: 'gone' })] }), /linked to an observation that is not in the job/],
  'recommendation showing a missing photo': [(f) => { f.job.secs.floor.recs = [{ id: 'r1', finding: 'Pitting', photo: 'gone' }]; return f; }, /Recommendation Pitting \(Floor\) shows a photo that is not in the file/],
  'NDE method with missing equipment': [(f) => { f.job.secs.floor.nde = [{ id: 'n1', method: 'MFL floor scan', equip: ['eq-gone'] }]; return f; }, /NDE method MFL floor scan \(Floor\) uses equipment that is not/],
  'two indications with one number': [(f) => { f.job.indications[1].no = f.job.indications[0].no; return f; }, /Two indications are numbered/],
};

for (const [name, [make, re]] of Object.entries(ERRORS)) {
  test(`validate: error — ${name}`, async () => {
    const r = await run(make(asFile(demoJob())));
    assert.ok(r.errors.some((e) => re.test(e)), `expected ${re} in:\n${r.errors.join('\n') || '(no errors)'}`);
  });
}
for (const [name, [make, re]] of Object.entries(WARNINGS)) {
  test(`validate: warning only — ${name}`, async () => {
    const r = await run(make(asFile(demoJob())));
    assert.deepEqual(r.errors, []);
    assert.ok(r.warnings.some((w) => re.test(w)), `expected ${re} in:\n${r.warnings.join('\n') || '(no warnings)'}`);
  });
}

test('validate: every test job opens without errors; the clean ones without warnings', async () => {
  // known properties of how some fixtures were made (also reported by the calculation and the stage 4 data check)
  const known = { 'demo-measured.json': /not in the floor layout/, 'demo-rows.json': /not in the floor layout/, 'demo-metric-noannular.json': /not in the floor layout/, 'legacy-schema1.json': /uses equipment that is not/ };
  for (const f of readdirSync(FIX).filter((x) => x.endsWith('.json'))) {
    const r = await run(asFile(JSON.parse(readFileSync(new URL(f, FIX), 'utf8'))));
    assert.deepEqual(r.errors, [], f);
    if (known[f]) assert.ok(r.warnings.length && r.warnings.every((w) => known[f].test(w)), `${f}: ${r.warnings.join('; ')}`);
    else assert.deepEqual(r.warnings, [], f);
  }
});

test('validate: blank fields and a matching checksum are fine', async () => {
  const f = asFile(demoJob());
  f.job.indications[0].utMin = ''; f.job.indications[1].len = null;
  f.hash = await sha256(f.job);
  assert.deepEqual(Object.values(await run(f)).slice(0, 2), [[], []]);
});

test('validate: numbers stored as text are a warning, and the copy that is stored has real numbers', async () => {
  const f = asFile(demoJob());
  const D = f.job.tank.diameter; // stored in mm
  f.job.tank.diameter = String(D); f.job.indications[0].mflPct = '35';
  const r = await run(f);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, [`Tank: Diameter was stored as the text “${D}” — it will be read as the number ${D}.`, `Indication ${f.job.indications[0].no}: MFL % was stored as the text “35” — it will be read as the number 35.`]);
  assert.equal(r.job.tank.diameter, D);
  assert.equal(r.job.indications[0].mflPct, 35);
  assert.equal(f.job.tank.diameter, String(D), 'the file itself is not changed');
});

test('validate: checking a file never changes it, and returns the job as this version would store it', async () => {
  const legacy = JSON.parse(readFileSync(new URL('legacy-schema1.json', FIX), 'utf8'));
  const f = asFile(legacy), before = JSON.stringify(f);
  const r = await run(f);
  assert.equal(JSON.stringify(f), before);
  assert.equal(r.job.schema, 4);
});
