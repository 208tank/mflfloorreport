// Minimal IndexedDB wrapper. Stores: jobs, photos, meta.
const DB_NAME = 'tank-floor-inspector';
const DB_VER = 1;
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

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  async allJobs() { return tx('jobs', 'readonly', (s) => reqP(s.getAll())); },
  async getJob(id) { return tx('jobs', 'readonly', (s) => reqP(s.get(id))); },
  async putJob(job) { return tx('jobs', 'readwrite', (s) => reqP(s.put(job))); },
  async deleteJob(id) {
    const photos = await this.jobPhotos(id);
    await tx('photos', 'readwrite', (s) => { photos.forEach((p) => s.delete(p.id)); });
    return tx('jobs', 'readwrite', (s) => reqP(s.delete(id)));
  },
  async jobPhotos(jobId) { return tx('photos', 'readonly', (s) => reqP(s.index('jobId').getAll(jobId))); },
  async getPhoto(id) { return tx('photos', 'readonly', (s) => reqP(s.get(id))); },
  async putPhoto(p) { return tx('photos', 'readwrite', (s) => reqP(s.put(p))); },
  async deletePhoto(id) { return tx('photos', 'readwrite', (s) => reqP(s.delete(id))); },
  async getMeta(key) { const r = await tx('meta', 'readonly', (s) => reqP(s.get(key))); return r?.value; },
  async setMeta(key, value) { return tx('meta', 'readwrite', (s) => reqP(s.put({ key, value }))); }
};

export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}
