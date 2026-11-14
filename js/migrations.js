// Migration management (data integrity upgrade, stage 11).
//
// Two kinds of migration, each an ordered list of numbered steps:
//  - Database steps (DB_STEPS) change the IndexedDB store layout. They run inside the browser's upgrade
//    transaction, so if any step throws the whole upgrade is rolled back and the old database is left as
//    it was. Each step only adds stores / indexes; none rewrites an existing record.
//  - Job steps (JOB_STEPS) change the contents of one job, from its `schema` to the next. They run on a
//    copy, so a step that throws leaves the stored job untouched.
// Every completed step is logged (meta key 'migrations') with the version, time and app version.
import { buildLayout, toFloor, toLocal } from './geometry.js';

/* ------------------------------------------------------------------------------ database --- */

/** Store layout by database version. step(db, tx) runs in the upgrade transaction. */
export const DB_STEPS = [
  { v: 1, name: 'Jobs, photos and settings', step(db) {
    if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' }).createIndex('jobId', 'jobId');
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
  } },
  { v: 2, name: 'Tank registry', step(db) {
    if (!db.objectStoreNames.contains('tanks')) db.createObjectStore('tanks', { keyPath: 'id' });
  } },
  { v: 3, name: 'Light job list (cards)', step(db, tx, { lite }) {
    if (db.objectStoreNames.contains('cards')) return;
    const cards = db.createObjectStore('cards', { keyPath: 'id' });
    tx.objectStore('jobs').openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { cards.put(lite(c.value)); c.continue(); } };
  } },
  { v: 4, name: 'History: revisions, audit trail and imports', step(db) {
    if (!db.objectStoreNames.contains('revisions')) {
      const s = db.createObjectStore('revisions', { keyPath: 'id' });
      s.createIndex('jobId', 'jobId'); s.createIndex('jobN', ['jobId', 'n'], { unique: true });
    }
    if (!db.objectStoreNames.contains('audit')) {
      const s = db.createObjectStore('audit', { keyPath: 'seq', autoIncrement: true });
      s.createIndex('jobId', 'jobId'); s.createIndex('jobAt', ['jobId', 'at']);
    }
    if (!db.objectStoreNames.contains('imports')) {
      const s = db.createObjectStore('imports', { keyPath: 'seq', autoIncrement: true });
      s.createIndex('jobId', 'jobId'); s.createIndex('hash', 'hash');
    }
  } }
];
export const DB_VERSION = DB_STEPS.at(-1).v;

/**
 * Run the database steps from oldVersion + 1 up to DB_VERSION inside an upgrade transaction, and record
 * them in the migration log. `ctx` passes helpers a step needs (lite) and `fail` (tests only: the version
 * whose step should throw, to prove the upgrade rolls back).
 */
export function upgradeDb(db, tx, oldVersion, ctx = {}) {
  const done = [];
  for (const s of DB_STEPS) {
    if (s.v <= oldVersion) continue;
    if (ctx.fail === s.v) throw new Error(`Test failure in database step ${s.v}`);
    s.step(db, tx, ctx);
    done.push({ kind: 'db', from: oldVersion, to: s.v, name: s.name, at: Date.now(), app: ctx.appVersion || '' });
  }
  // the meta store exists by now (step 1); append to the log in the same transaction
  if (done.length) {
    const meta = tx.objectStore('meta'), r = meta.get('migrations');
    r.onsuccess = () => meta.put({ key: 'migrations', value: [...(r.result?.value || []), ...done].slice(-500) });
  }
  return done;
}

/* ----------------------------------------------------------------------------------- jobs --- */

/**
 * Job content steps. run(out, src): `out` is the normalised copy being built, `src` the job as stored.
 * notes(src) returns the plain-words notes shown to the user once (empty when nothing visible changes).
 */
export const JOB_STEPS = [
  { to: 2, name: 'X / Y on shell-cut plates measured from the plate edges',
    notes: (src) => ((src.indications || []).length ? ['Indication X / Y on plates cut by the shell are now measured from the plate edges; positions on the floor are unchanged.'] : []),
    run(out) {
      // Convert older jobs so their indications stay where they were on the floor.
      try {
        const oldL = buildLayout(out, { legacySnap: true }), newL = buildLayout(out);
        for (const it of [...out.indications, ...out.features]) {
          const po = oldL.byKey.get(it.plate), pn = newL.byKey.get(it.plate);
          if (!po || !pn || !po.datum?.snapped || it.x == null || it.y == null) continue;
          const f = toFloor(oldL, po, it.x, it.y), l = toLocal(newL, pn, f.x, f.y);
          it.x = Math.round(Math.max(0, l.X) * 10) / 10; it.y = Math.round(Math.max(0, l.Y) * 10) / 10;
        }
      } catch { /* leave as is */ }
    } },
  { to: 3, name: 'Calculation review: annular limit from Table 4.5 / 5.1, MFL threshold, repair rules',
    notes(src) {
      const out = [], c = src.calc || {};
      if (c.mrtAnnular === 2.54) out.push('Annular plate limit: the old 0.10 in default is replaced by the API 653 Table 4.5 / API 650 Table 5.1 value where it can be calculated (§4.4.6). Enter a limit to override.');
      if (c.mflThresholdPct === undefined && (src.indications || []).length) out.push('UPr now includes the MFL threshold (default 20 % of nominal, API 653 §4.4.5.1 Note 1). Change it on the API 653 page.');
      if ((src.indications || []).some((i) => i.repair === 'yes' || i.repairMethod)) out.push('Repaired soil-side locations now keep their corrosion rate in UPr unless "cause of corrosion removed" is ticked, and only welded repairs remove a location from RT (API 653 §4.4.5.1 Note 1, §4.4.5.5–6).');
      out.push('Calculations follow the approved corrections (critical-zone limit per §4.4.5.4, rate basis, coating / CP checks). Results may differ from the last report.');
      return out;
    },
    run(out, src) { if (src.calc?.mrtAnnular === 2.54) out.calc.mrtAnnular = null; } },
  { to: 4, name: 'Data integrity upgrade: revision history, audit trail and locking',
    notes: () => [],
    run() { /* new fields (lock, issued, hash, tankVer) are optional: a job without them is valid */ } }
];
export const JOB_SCHEMA = JOB_STEPS.at(-1).to;

/** Steps a stored job still needs. */
export const pendingSteps = (job, steps = JOB_STEPS) => steps.filter((s) => (job?.schema || 1) < s.to);

/** Run the pending steps on `out` (already a copy). Returns the log entries. Throws if a step throws. */
export function runJobSteps(out, src, steps = JOB_STEPS, appVersion = '') {
  const from = src.schema || 1, log = [];
  for (const s of steps) {
    if (from >= s.to) continue;
    s.run(out, src);
    log.push({ kind: 'job', jobId: src.id, from: Math.max(from, s.to - 1), to: s.to, name: s.name, at: Date.now(), app: appVersion });
  }
  return log;
}

/** Plain-words notes for the steps a job still needs. */
export const stepNotes = (job, steps = JOB_STEPS) => pendingSteps(job, steps).flatMap((s) => s.notes(job));
