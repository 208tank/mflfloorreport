// Minimal IndexedDB wrapper. Stores: jobs, photos, meta, tanks (the tank registry) and cards
// (a light copy of each job, without readings, for the job lists and the Dashboard).
import { DB_VERSION, upgradeDb } from './migrations.js';
const DB_NAME = 'tank-floor-inspector';
const DB_VER = DB_VERSION;
/** App version recorded in the migration log (set by the app at start-up). */
export const dbConfig = { appVersion: '', failStep: null };

/** The job without its bulky readings: what the Jobs list, Dashboard and registry need. */
export function lite(job) {
  const { indications, plates, features, shell, roof, settle, ...rest } = job;
  return { ...rest, nInds: (indications || []).length };
}
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    // migrations.js: every step from the stored version up runs in this one transaction; a step that
    // throws aborts it, and the browser keeps the old database exactly as it was.
    req.onupgradeneeded = (e) => {
      try { upgradeDb(req.result, req.transaction, e.oldVersion, { lite, appVersion: dbConfig.appVersion, fail: dbConfig.failStep ?? globalThis.__tfiFailDbStep }); }
      catch (err) { console.error('Database upgrade failed; nothing was changed', err); req.transaction.abort(); }
    };
    req.onsuccess = () => {
      const db = req.result;
      // let a newer version of the app (in another tab) upgrade the database
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => { dbp = null; reject(req.error); };
    // an older version of the app is open in another window and hasn't let go of the database yet
    req.onblocked = () => globalThis.dispatchEvent?.(new Event('tfi-db-blocked'));
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => (result = r));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** One transaction over several stores. fn queues its requests synchronously; resolves when the
 *  transaction commits, rejects (with everything rolled back) if any request fails. */
async function txMany(stores, fn, opts) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, 'readwrite', opts);
    try { fn(...stores.map((n) => t.objectStore(n))); } catch (e) { try { t.abort(); } catch { /* already finished */ } reject(e); return; }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  async allJobs() { return tx('jobs', 'readonly', (s) => reqP(s.getAll())); },
  async getJob(id) { return tx('jobs', 'readonly', (s) => reqP(s.get(id))); },
  /** Write a job and its card. 'strict' durability: the browser reports success only once the data is
   *  on disk, so "Saved" means a crash or power cut a moment later can't undo it. */
  async putJob(job) { return txMany(['jobs', 'cards'], (J, C) => { J.put(job); C.put(lite(job)); }, { durability: 'strict' }); },
  async allCards() { return tx('cards', 'readonly', (s) => reqP(s.getAll())); },
  /** Delete a job and its photos together: either both go or neither does. */
  async deleteJob(id) {
    return txMany(['jobs', 'photos', 'cards'], (J, P, C) => {
      const r = P.index('jobId').getAllKeys(id);
      r.onsuccess = () => r.result.forEach((k) => P.delete(k));
      J.delete(id); C.delete(id);
    });
  },
  /** Write a job and its photos in one transaction. With removeId, that job's existing photos that are
   *  not in `photos` are removed too (and the job record itself if it has a different id).
   *  If anything fails, nothing on the device changes. */
  async replaceJob(job, photos = [], removeId = null) {
    const keep = new Set(photos.map((p) => p.id));
    return txMany(['jobs', 'photos', 'cards'], (J, P, C) => {
      if (removeId) {
        const r = P.index('jobId').getAllKeys(removeId);
        r.onsuccess = () => r.result.forEach((k) => { if (!keep.has(k)) P.delete(k); });
        if (removeId !== job.id) { J.delete(removeId); C.delete(removeId); }
      }
      J.put(job); C.put(lite(job));
      for (const p of photos) P.put({ ...p, jobId: job.id });
    });
  },
  async jobPhotos(jobId) { return tx('photos', 'readonly', (s) => reqP(s.index('jobId').getAll(jobId))); },
  async jobPhotoKeys(jobId) { return tx('photos', 'readonly', (s) => reqP(s.index('jobId').getAllKeys(jobId))); },
  async getPhoto(id) { return tx('photos', 'readonly', (s) => reqP(s.get(id))); },
  async putPhoto(p) { return tx('photos', 'readwrite', (s) => reqP(s.put(p))); },
  async deletePhoto(id) { return tx('photos', 'readwrite', (s) => reqP(s.delete(id))); },
  async allTanks() { return tx('tanks', 'readonly', (s) => reqP(s.getAll())); },
  async getTank(id) { return tx('tanks', 'readonly', (s) => reqP(s.get(id))); },
  async putTank(t) { return tx('tanks', 'readwrite', (s) => reqP(s.put(t))); },
  async deleteTank(id) { return tx('tanks', 'readwrite', (s) => reqP(s.delete(id))); },
  /* ---- revisions (append-only; migrations.js step 4) ---- */
  /** Add a revision. n = the next number for the job; the record is never updated afterwards. */
  async addRevision(rec) {
    const db_ = await open();
    return new Promise((resolve, reject) => {
      const t = db_.transaction('revisions', 'readwrite'), s = t.objectStore('revisions');
      const r = s.index('jobN').openCursor(IDBKeyRange.bound([rec.jobId, -Infinity], [rec.jobId, Infinity]), 'prev');
      let out;
      r.onsuccess = () => { const n = (r.result?.value.n || 0) + 1; out = { ...rec, n, id: `${rec.jobId}:${n}` }; s.add(out); };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Revision not saved'));
    });
  },
  async jobRevisions(jobId) { return tx('revisions', 'readonly', (s) => reqP(s.index('jobId').getAll(jobId))).then((a) => a.sort((x, y) => x.n - y.n)); },
  async revisionCount(jobId) { return tx('revisions', 'readonly', (s) => reqP(s.index('jobId').count(jobId))); },
  async getRevision(id) { return tx('revisions', 'readonly', (s) => reqP(s.get(id))); },
  /* ---- backup and restore (data integrity stage 5) ---- */
  async jobAudit(jobId) { return tx('audit', 'readonly', (s) => reqP(s.index('jobId').getAll(jobId))); },
  /** Record an import (job file, loader sheet, backup restore): append-only. */
  async addImport(rec) { return tx('imports', 'readwrite', (s) => reqP(s.add(rec))); },
  async allImports() { return tx('imports', 'readonly', (s) => reqP(s.getAll())); },
  /** Earlier imports of a file with this checksum (data integrity stage 7). */
  async importsByHash(hash) { return tx('imports', 'readonly', (s) => reqP(s.index('hash').getAll(hash))); },
  /**
   * Restore one job from a backup in a single transaction (job, card, photos, revisions, audit): if anything
   * fails, nothing on the device changes. replace = the device copy is replaced: its photos that are not in the
   * backup are removed. Revisions are append-only: a backup revision already on the device is skipped; one whose
   * number is taken by a different revision is added after the device's last revision (its note says which).
   * Audit entries already on the device (same content) are not added twice.
   */
  async restoreJob({ job, photos, revisions, audit }, { replace = false } = {}) {
    const keep = new Set(photos.map((p) => p.id));
    return txMany(['jobs', 'cards', 'photos', 'revisions', 'audit'], (J, C, P, R, A) => {
      if (replace) {
        const r = P.index('jobId').getAllKeys(job.id);
        r.onsuccess = () => r.result.forEach((k) => { if (!keep.has(k)) P.delete(k); });
      }
      J.put(job); C.put(lite(job));
      for (const p of photos) P.put({ ...p, jobId: job.id });
      const have = R.index('jobId').getAll(job.id);
      have.onsuccess = () => {
        const byId = new Map(have.result.map((x) => [x.id, x]));
        let n = Math.max(0, ...have.result.map((x) => x.n || 0));
        const later = [];
        for (const rv of [...revisions].sort((a, b) => a.n - b.n)) {
          const cur = byId.get(rv.id);
          if (!cur) { R.add(rv); n = Math.max(n, rv.n); } else if (JSON.stringify(cur) !== JSON.stringify(rv)) later.push(rv);
        }
        for (const rv of later) { n++; R.add({ ...rv, n, id: `${job.id}:${n}`, note: [rv.note, `restored from a backup (was revision ${rv.n} there)`].filter(Boolean).join(' — ') }); }
      };
      const had = A.index('jobId').getAll(job.id);
      had.onsuccess = () => {
        const seen = new Set(had.result.map(({ seq, ...a }) => JSON.stringify(a)));
        for (const { seq, ...a } of audit) { const e = { ...a, jobId: job.id }; if (!seen.has(JSON.stringify(e))) A.add(e); }
      };
      if (globalThis.__tfiFailRestore === job.id) throw new Error('Test: restore failure');
    });
  },
  async migrationLog() { return (await this.getMeta('migrations')) || []; },
  async logMigrations(entries) {
    if (!entries?.length) return;
    return txMany(['meta'], (M) => { const r = M.get('migrations'); r.onsuccess = () => M.put({ key: 'migrations', value: [...(r.result?.value || []), ...entries].slice(-500) }); });
  },
  /* ---- integrity check (stage 4) ---- */
  /** Every photo's id, job and indication. full = also open each image to check its data (slower). */
  async photoIndex(full = false) {
    const db_ = await open();
    return new Promise((resolve, reject) => {
      const out = [], t = db_.transaction('photos'), s = t.objectStore('photos');
      if (!full) {
        // a key cursor on the jobId index reads ownership without loading the images
        s.index('jobId').openKeyCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out.push({ id: c.primaryKey, jobId: c.key }); c.continue(); } };
      } else {
        s.openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { const p = c.value; out.push({ id: p.id, jobId: p.jobId, indId: p.indId || null, ok: typeof p.dataUrl === 'string' && /^data:image\/[a-z+.-]+;base64,/i.test(p.dataUrl) }); c.continue(); } };
      }
      t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error);
    });
  },
  async allRevisions() { return tx('revisions', 'readonly', (s) => reqP(s.getAll())); },
  async revisionHeads() { return (await this.allRevisions()).map(({ job, ...r }) => r); },
  async metaKeys() { return tx('meta', 'readonly', (s) => reqP(s.getAllKeys())); },
  async putCard(job) { return tx('cards', 'readwrite', (s) => reqP(s.put(lite(job)))); },
  async deleteCard(id) { return tx('cards', 'readwrite', (s) => reqP(s.delete(id))); },
  async deleteMeta(key) { return tx('meta', 'readwrite', (s) => reqP(s.delete(key))); },
  async getMeta(key) { const r = await tx('meta', 'readonly', (s) => reqP(s.get(key))); return r?.value; },
  async setMeta(key, value) { return tx('meta', 'readwrite', (s) => reqP(s.put({ key, value }))); }
};

export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}
