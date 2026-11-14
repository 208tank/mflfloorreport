// Minimal IndexedDB wrapper. Stores: jobs, photos, meta, tanks (the tank registry).
const DB_NAME = 'tank-floor-inspector';
const DB_VER = 2;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('jobId', 'jobId');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('tanks')) db.createObjectStore('tanks', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
async function txMany(stores, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, 'readwrite');
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
  async putJob(job) { return tx('jobs', 'readwrite', (s) => reqP(s.put(job))); },
  /** Delete a job and its photos together: either both go or neither does. */
  async deleteJob(id) {
    return txMany(['jobs', 'photos'], (J, P) => {
      const r = P.index('jobId').getAllKeys(id);
      r.onsuccess = () => r.result.forEach((k) => P.delete(k));
      J.delete(id);
    });
  },
  /** Write a job and its photos in one transaction. With removeId, that job's existing photos that are
   *  not in `photos` are removed too (and the job record itself if it has a different id).
   *  If anything fails, nothing on the device changes. */
  async replaceJob(job, photos = [], removeId = null) {
    const keep = new Set(photos.map((p) => p.id));
    return txMany(['jobs', 'photos'], (J, P) => {
      if (removeId) {
        const r = P.index('jobId').getAllKeys(removeId);
        r.onsuccess = () => r.result.forEach((k) => { if (!keep.has(k)) P.delete(k); });
        if (removeId !== job.id) J.delete(removeId);
      }
      J.put(job);
      for (const p of photos) P.put({ ...p, jobId: job.id });
    });
  },
  async jobPhotos(jobId) { return tx('photos', 'readonly', (s) => reqP(s.index('jobId').getAll(jobId))); },
  async getPhoto(id) { return tx('photos', 'readonly', (s) => reqP(s.get(id))); },
  async putPhoto(p) { return tx('photos', 'readwrite', (s) => reqP(s.put(p))); },
  async deletePhoto(id) { return tx('photos', 'readwrite', (s) => reqP(s.delete(id))); },
  async allTanks() { return tx('tanks', 'readonly', (s) => reqP(s.getAll())); },
  async getTank(id) { return tx('tanks', 'readonly', (s) => reqP(s.get(id))); },
  async putTank(t) { return tx('tanks', 'readwrite', (s) => reqP(s.put(t))); },
  async deleteTank(id) { return tx('tanks', 'readwrite', (s) => reqP(s.delete(id))); },
  async getMeta(key) { const r = await tx('meta', 'readonly', (s) => reqP(s.get(key))); return r?.value; },
  async setMeta(key, value) { return tx('meta', 'readwrite', (s) => reqP(s.put({ key, value }))); }
};

export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}
