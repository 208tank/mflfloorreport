// Browser checks run by tests/browser/run.mjs. Each takes { browser, url, serve, appPage }.
import assert from 'node:assert/strict';

const VIEWS = ['dash', 'reg', 'jobs', 'equip', 'setup', 'summary', 'defs', 'map', 'inds', 'plates', 'api', 'shell', 'roofF', 'roofL', 'seal', 'nozzles', 'settle', 'ref', 'report'];
const SECS = ['floor', 'shell', 'froof', 'flroof', 'nozzles', 'found', 'settle'];
const CHILD = ['nde', 'obs', 'photos', 'recs'];

export const XSS = `"'><img src=x onerror="window.__xss=(window.__xss||0)+1">`;

/** Put the XSS payload into every free-text field a user (or an edited job file) controls. */
export function poison(XSS) {
  const j = window.tfi.job(), add = (o, ...keys) => { for (const k of keys) if (o) o[k] = (o[k] || '') + XSS; };
  add(j.info, 'client', 'site', 'tankId', 'product', 'reportNo', 'workOrder', 'inspector', 'notes', 'location', 'tankNotes', 'mflTech', 'utTech');
  add(j.summary, 'scope', 'narrative', 'condition');
  add(j.status, 'notes', 'inspector', 'reviewer');
  for (const i of j.indications) add(i, 'no', 'comments', 'repairId');
  for (const f of j.features) add(f, 'label');
  for (const n of j.nozzles) add(n, 'mark', 'service');
  for (const e of j.equipment || []) add(e, 'make', 'model', 'serial');
  for (const p of Object.values(j.plates || {})) add(p, 'label');
  for (const sec of Object.values(j.secs)) {
    sec.obs.push({ id: 'x' + Math.random(), item: 'Item' + XSS, loc: 'Loc' + XSS, cond: 'poor', text: 'Text' + XSS });
    sec.recs.push({ id: 'r' + Math.random(), finding: 'F' + XSS, loc: 'L' + XSS, action: 'A' + XSS, priority: 'P1', due: '', def: true, status: 'Open', client: 'C' + XSS, ref: 'R' + XSS });
    for (const n of sec.nde) add(n, 'extent', 'proc', 'tech', 'notes');
  }
  if (j.roof?.seal) { j.roof.seal.std = { ...(j.roof.seal.std || {}), custom: true }; j.roof.seal.custom = { ...(j.roof.seal.custom || {}), label: 'Permit' + XSS }; }
  window.tfi.commit();
}

/* ---- backup and restore (data integrity stage 5) ---- */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEUlEQVR4nGM4YWODFTEMpAQAr9U8AVonTcEAAAAASUVORK5CYII=';
/** Every record in the stores a backup covers, in a stable order (audit without its auto-numbered key). */
async function storeSnapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('tank-floor-inspector'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = (s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const by = (a) => a.sort((x, y) => String(x.id ?? JSON.stringify(x)).localeCompare(String(y.id ?? JSON.stringify(y))));
    const out = {};
    for (const s of ['jobs', 'photos', 'cards', 'revisions', 'tanks']) out[s] = JSON.stringify(by(await all(s)));
    out.audit = JSON.stringify(by((await all('audit')).map(({ seq, ...a }) => a)));
    out.company = JSON.stringify((await all('meta')).find((m) => m.key === 'company')?.value || null);
    db.close();
    return out;
  });
}
/** Make a backup the way a user does (download fallback, as in browsers without the file picker). */
async function takeBackup(page) {
  await page.evaluate(() => { delete Window.prototype.showSaveFilePicker; delete window.showSaveFilePicker; window.tfi.go('jobs'); });
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="backup-make"]')]);
  const { readFile } = await import('node:fs/promises');
  return { name: d.suggestedFilename(), buffer: await readFile(await d.path()) };
}
/** Restore a backup through the preview; choices = { jobId: 'keep' | 'replace' | 'both' }. Returns the toast text. */
async function restoreBackup(page, file, choices = {}, { expectPreview = true } = {}) {
  await page.evaluate(() => window.tfi.go('jobs'));
  await page.evaluate(() => { const t = document.querySelector('#toast'); t.innerHTML = ''; t.hidden = true; });
  await page.setInputFiles('input[data-act="backup-restore"]', { name: file.name, mimeType: 'application/json', buffer: file.buffer });
  if (!expectPreview) { await page.waitForFunction(() => /can.t be restored/.test(document.querySelector('#toast').textContent)); return page.evaluate(() => document.querySelector('#toast').textContent); }
  await page.waitForSelector('#dlg[open] .rs-dlg');
  for (const [id, v] of Object.entries(choices)) await page.selectOption(`#dlg select[data-rj="${id}"]`, v);
  await page.click('#dlg [data-rs="go"]');
  await page.waitForFunction(() => /Restored|Nothing needed restoring/.test(document.querySelector('#toast').textContent));
  return page.evaluate(() => document.querySelector('#toast').textContent);
}
/** A device with two jobs, a registry tank, a section photo, settings, a revision and an audit entry. */
async function richDevice(page) {
  await page.evaluate(() => window.tfi.go('photos:floor'));
  await page.setInputFiles('input[data-act="ph-add"]', { name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await page.waitForFunction(() => window.__app.photos.length === 1);
  await page.evaluate(() => window.tfi.go('jobs'));
  await page.fill('input[data-cb="name"]', 'Backup Test Co'); await page.press('input[data-cb="name"]', 'Tab');
  await page.click('[data-act="job-demo"]');
  await page.waitForFunction(() => window.__app.jobs.length === 2 && window.__app.view === 'map' && document.querySelector('#mapbox svg'));
  await page.evaluate(() => window.tfi.go('reg'));
  await page.click('[data-act="reg-build"]');
  await page.waitForFunction(() => window.__app.tanks.length >= 1);
  await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('tank-floor-inspector'); r.onsuccess = () => res(r.result); });
    const id = window.__app.jobs[0].id;
    await new Promise((res, rej) => { const t = db.transaction(['revisions', 'audit'], 'readwrite');
      t.objectStore('revisions').put({ id: id + ':1', jobId: id, n: 1, rev: 0, at: 1, by: { name: '', id: 'dev-x', method: 'device' }, reason: 'manual', note: 'test', appVersion: 'x', schema: 4, hash: 'h', job: { id }, photoIds: [] });
      t.objectStore('audit').add({ jobId: id, at: 2, action: 'test-edit', by: 'dev-x' });
      t.oncomplete = res; t.onerror = () => rej(t.error); });
    db.close();
  });
  await page.waitForTimeout(800); // let the open job's save settle
}

/* ---- job file validation (data integrity stage 6) ---- */
/** The open demo job as a job file, changed by fn. */
async function demoFile(page, fn) {
  const data = await page.evaluate(() => ({ format: 'tank-floor-inspector', version: 1, saved: new Date().toISOString(), rev: 1, job: structuredClone(window.tfi.job()), photos: [] }));
  data.job.id = 'imported-job'; data.job.info.tankId = 'TK-IMPORT';
  fn?.(data);
  return { name: 'tk-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) };
}
const jobIds = (page) => page.evaluate(() => window.__app.jobs.map((j) => j.id).sort());
const importRecords = (page) => page.evaluate(async () => {
  const db = await new Promise((res) => { const r = indexedDB.open('tank-floor-inspector'); r.onsuccess = () => res(r.result); });
  const all = await new Promise((res) => { const r = db.transaction('imports').objectStore('imports').getAll(); r.onsuccess = () => res(r.result); });
  db.close(); return all.filter((x) => x.kind === 'job-file').map((x) => [x.result, x.counts.errors, x.counts.warnings]);
});

export default {
  async 'security: user text from a job file never runs as script on any page'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(poison, XSS);
    const views = [...VIEWS, ...SECS.flatMap((s) => [...CHILD, 'an'].map((c) => (c === 'an' ? null : `${c}:${s}`))).filter(Boolean), 'an:shell', 'an:settle', 'an:froof', 'an:flroof', 'an:nozzles', 'an:found', 'defrep'];
    const hits = [];
    for (const v of views) {
      await page.evaluate((x) => window.tfi.go(x), v);
      await page.waitForTimeout(30);
      const n = await page.evaluate(() => window.__xss || 0);
      if (n) { hits.push(v); await page.evaluate(() => { window.__xss = 0; }); }
    }
    // panels and dialogs: indication editor, and the map side panel for each kind of selection
    await page.evaluate(() => window.tfi.go('inds'));
    await page.click('tr[data-act="open-ind"]');
    await page.waitForTimeout(50);
    if (await page.evaluate(() => window.__xss || 0)) hits.push('indication dialog');
    await page.keyboard.press('Escape');
    for (const kind of ['sel', 'selPlate', 'selFeature', 'selNozzle']) {
      await page.evaluate((k) => {
        const S = window.__app, j = S.job;
        S.sel = S.selPlate = S.selFeature = S.selNozzle = null;
        S[k] = k === 'sel' ? j.indications[0].id : k === 'selPlate' ? j.indications[0].plate : k === 'selFeature' ? j.features[0].id : j.nozzles[0].id;
        window.tfi.go('map');
      }, kind);
      await page.waitForTimeout(50);
      if (await page.evaluate(() => window.__xss || 0)) { hits.push('map panel ' + kind); await page.evaluate(() => { window.__xss = 0; }); }
    }
    assert.deepEqual(hits, [], 'script ran on: ' + hits.join(', '));
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'smoke: every page renders without errors'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const views = [...VIEWS, ...SECS.flatMap((s) => CHILD.map((c) => `${c}:${s}`)), 'an:shell', 'an:settle'];
    for (const v of views) {
      await page.evaluate((x) => window.tfi.go(x), v);
      const n = await page.evaluate(() => document.querySelector('#main').innerHTML.length);
      assert.ok(n > 200, `${v} rendered almost nothing`);
    }
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'security: the Content-Security-Policy blocks inline event handlers'({ browser, url, appPage }) {
    const page = await appPage(browser, url, { demo: false });
    await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<img src="x" onerror="window.__csp=1">'); });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__csp), undefined);
    await page.context().close();
  },

  async 'exports: every Export menu item still produces a file'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(() => window.tfi.go('map'));
    const acts = ['utl-down', 'exp-ind', 'exp-plates', 'exp-noz', 'exp-shell', 'exp-roof', 'exp-settle', 'exp-svg', 'exp-png', 'exp-shell-svg'];
    for (const act of acts) {
      await page.evaluate(() => { document.querySelector('#exportMenu').open = true; });
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click(`[data-act="${act}"]`)]);
      const path = await dl.path();
      const { statSync } = await import('node:fs');
      assert.ok(statSync(path).size > 100, `${act} produced an empty file`);
    }
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'storage: replacing a job is all-or-nothing (a failed photo write keeps the original)'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const r = await page.evaluate(async () => {
      const { db } = await import('./js/db.js');
      const job = window.tfi.job(), id = job.id;
      await db.replaceJob(job, [1, 2, 3].map((n) => ({ id: 'p' + n, jobId: id, n, dataUrl: 'data:,' + n })));
      const before = (await db.jobPhotos(id)).length;
      const put = IDBObjectStore.prototype.put; let calls = 0;
      IDBObjectStore.prototype.put = function (v, ...a) { if (v && v.dataUrl && ++calls === 3) throw new DOMException('Simulated quota', 'QuotaExceededError'); return put.call(this, v, ...a); };
      let err = null;
      try { await db.replaceJob({ ...job, info: { ...job.info, tankId: 'REPLACED' } }, [4, 5, 6].map((n) => ({ id: 'q' + n, jobId: id, n, dataUrl: 'data:,' + n })), id); } catch (e) { err = e.name; }
      IDBObjectStore.prototype.put = put;
      const after = await db.getJob(id), photos = await db.jobPhotos(id);
      return { before, err, tankId: after.info.tankId, photos: photos.map((p) => p.id).sort() };
    });
    assert.equal(r.before, 3);
    assert.equal(r.err, 'QuotaExceededError');
    assert.equal(r.tankId, 'TK-101');
    assert.deepEqual(r.photos, ['p1', 'p2', 'p3']);
    await page.context().close();
  },

  async 'storage: deleting a job is all-or-nothing'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const r = await page.evaluate(async () => {
      const { db } = await import('./js/db.js');
      const job = window.tfi.job(), id = job.id;
      await db.replaceJob(job, [1, 2].map((n) => ({ id: 'd' + n, jobId: id, n, dataUrl: 'data:,' + n })));
      const del = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (k) { if (k === id) throw new DOMException('Simulated failure', 'UnknownError'); return del.call(this, k); };
      let err = null; try { await db.deleteJob(id); } catch (e) { err = e.name; }
      IDBObjectStore.prototype.delete = del;
      return { err, job: !!(await db.getJob(id)), photos: (await db.jobPhotos(id)).length };
    });
    assert.deepEqual(r, { err: 'UnknownError', job: true, photos: 2 });
    await page.context().close();
  },

  async 'job files: "Keep both" copy keeps its linked photos; "Replace" keeps photo links'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const text = await page.evaluate(async () => {
      const { db } = await import('./js/db.js');
      const job = window.tfi.job(), id = job.id;
      job.secs.floor.recs.push({ id: 'rec1', finding: 'Linked', loc: '', action: '', priority: 'P3', due: '', def: true, status: 'Open', client: '', photo: 'ph1' });
      await db.replaceJob(job, [{ id: 'ph1', jobId: id, sec: 'floor', n: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgo=', caption: 'c' }]);
      // a different version of the job (identical content would be "already on this device", stage 7)
      return JSON.stringify({ format: 'tank-floor-inspector', version: 1, rev: 1, job: { ...job, info: { ...job.info, notes: 'Saved on another computer' } }, photos: await db.jobPhotos(id) });
    });
    const upload = async (choice) => {
      await page.evaluate(() => window.tfi.go('jobs'));
      await page.setInputFiles('#openFileInput', { name: 'job.json', mimeType: 'application/json', buffer: Buffer.from(text) });
      await page.click(`#confirmDlg [data-cf="${choice}"]`);
      await page.waitForTimeout(400);
    };
    await upload('no'); // keep both
    const copy = await page.evaluate(async () => {
      const { db } = await import('./js/db.js');
      const all = await db.allJobs(), c = all.find((j) => / \(copy\)$/.test(j.info.tankId));
      const rec = c.secs.floor.recs.find((r) => r.id === 'rec1'), p = await db.getPhoto(rec.photo);
      return { photoId: rec.photo, owner: p?.jobId === c.id, origStill: (await db.getPhoto('ph1'))?.jobId !== c.id };
    });
    assert.notEqual(copy.photoId, 'ph1');
    assert.ok(copy.owner, 'the copy\'s recommendation should link to the copy\'s own photo');
    assert.ok(copy.origStill);
    await upload('yes'); // replace the original
    const orig = await page.evaluate(async () => {
      const { db } = await import('./js/db.js');
      const all = await db.allJobs(), o = all.find((j) => j.info.tankId === 'TK-101');
      return { photos: (await db.jobPhotos(o.id)).map((p) => p.id), count: all.length };
    });
    assert.deepEqual(orig, { photos: ['ph1'], count: 2 });
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'storage: a value typed but not yet committed is saved when the app is hidden'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(() => window.tfi.go('setup'));
    await page.fill('[data-bind="info.client"]', 'Typed then app switched');
    const saved = await page.evaluate(async () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      const { db } = await import('./js/db.js');
      let v;
      for (let i = 0; i < 40; i++) { v = (await db.getJob(window.tfi.job().id)).info.client; if (v === 'Typed then app switched') break; await new Promise((r) => setTimeout(r, 50)); }
      return v;
    });
    assert.equal(saved, 'Typed then app switched');
    await page.context().close();
  },

  async 'saving: a device write that fails is shown, retried, and the change still reaches the device'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(() => window.tfi.go('setup'));
    // the next two writes of the jobs store fail, as on a full or busy device
    await page.evaluate(() => { const put = IDBObjectStore.prototype.put; let fails = 2; window.__restorePut = () => { IDBObjectStore.prototype.put = put; }; IDBObjectStore.prototype.put = function (...a) { if (this.name === 'jobs' && fails > 0) { fails--; throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); } return put.apply(this, a); }; });
    await page.fill('[data-bind="info.client"]', 'Written after a retry');
    await page.press('[data-bind="info.client"]', 'Tab');
    await page.waitForFunction(() => document.querySelector('#saveState')?.textContent === 'Not saved — retrying');
    assert.match(await page.textContent('#toasts, body'), /out of storage space/);
    await page.waitForFunction(() => document.querySelector('#saveState')?.textContent === 'Saved locally', null, { timeout: 15000 });
    const stored = await page.evaluate(async () => (await (await import('./js/db.js')).db.getJob(window.tfi.job().id)).info.client);
    assert.equal(stored, 'Written after a retry');
    // job writes ask the browser for 'strict' durability (on disk before "Saved")
    const dur = await page.evaluate(async () => { const t = IDBDatabase.prototype.transaction; let seen = null; IDBDatabase.prototype.transaction = function (st, mode, o) { if ([].concat(st).includes('jobs') && mode === 'readwrite') seen = o?.durability || 'default'; return t.call(this, st, mode, o); }; window.tfi.job().info.site = 'x'; window.tfi.commit(); for (let i = 0; i < 30 && !seen; i++) await new Promise((r) => setTimeout(r, 100)); IDBDatabase.prototype.transaction = t; return seen; });
    assert.equal(dur, 'strict');
    assert.deepEqual(page.errors.filter((e) => !/quota/i.test(e)), []);
    await page.context().close();
  },

  async 'saving: while a change cannot be saved, switching job and writing a job file are refused'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const first = await page.evaluate(() => window.tfi.job().id);
    // a second job to switch to
    await page.evaluate(() => window.tfi.go('jobs'));
    await page.click('[data-act="job-demo"]');
    await page.waitForFunction((id) => window.tfi.job()?.id !== id, first);
    const second = await page.evaluate(() => window.tfi.job().id);
    await page.waitForFunction(() => window.__app.view === 'map');
    // every jobs-store write now fails
    await page.evaluate(() => { const put = IDBObjectStore.prototype.put; window.__restorePut = () => { IDBObjectStore.prototype.put = put; }; IDBObjectStore.prototype.put = function (...a) { if (this.name === 'jobs') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return put.apply(this, a); }; });
    await page.evaluate(() => { window.tfi.job().info.client = 'Unsaved change'; window.tfi.commit(); });
    await page.waitForFunction(() => /^Not saved/.test(document.querySelector('#saveState')?.textContent || ''));
    // switching job is refused and the change stays on screen
    await page.evaluate((id) => { window.tfi.go('jobs'); document.querySelector(`[data-act="job-open"][data-id="${id}"]`).click(); }, first);
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.tfi.job().id), second);
    assert.equal(await page.evaluate(() => window.tfi.job().info.client), 'Unsaved change');
    // saving a job file is refused (nothing downloaded)
    let downloads = 0; page.on('download', () => downloads++);
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(800);
    assert.equal(downloads, 0);
    assert.match(await page.textContent('body'), /job file was not written/);
    // once the device can write again, the change is saved and switching works
    await page.evaluate(() => window.__restorePut());
    assert.equal(await page.evaluate(async () => { window.tfi.commit(); for (let i = 0; i < 40; i++) { if (document.querySelector('#saveState').textContent === 'Saved locally') return true; await new Promise((r) => setTimeout(r, 100)); } return false; }), true);
    assert.equal(await page.evaluate(async (id) => (await (await import('./js/db.js')).db.getJob(id)).info.client, second), 'Unsaved change');
    await page.evaluate((id) => { window.tfi.go('jobs'); document.querySelector(`[data-act="job-open"][data-id="${id}"]`).click(); }, first);
    await page.waitForFunction((id) => window.tfi.job()?.id === id, first);
    assert.deepEqual(page.errors.filter((e) => !/quota/i.test(e)), []);
    await page.context().close();
  },

  async 'unsaved: changes are counted by area until saved to a file, including changes made during the save'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(linkTestFile);
    const fs = () => page.evaluate(() => ({ text: document.querySelector('#fileState').textContent, title: document.querySelector('#fileState').title, state: document.querySelector('#fileState').dataset.state }));
    const base = (await fs()).text;
    assert.match(base, /^Not saved to a file/);
    const n0 = await page.evaluate(() => window.tfi.job().edits || 0);
    await page.evaluate(() => window.tfi.go('setup'));
    await page.fill('[data-bind="info.client"]', 'Counted'); await page.keyboard.press('Tab');
    await page.evaluate(() => { window.tfi.go('shell'); window.tfi.job().shell.notes = 'a'; window.tfi.commit(); });
    let f = await fs();
    assert.equal(f.text, `Not saved to a file · ${n0 + 2} changes`);
    assert.match(f.title, /Tank setup, Shell|Shell, Tank setup|Tank setup.*Shell/);
    // save: Rev 1, nothing left over
    await page.evaluate(() => window.tfi.go('setup')); await page.keyboard.press('Control+s');
    await page.waitForFunction(() => /^Rev 1 · saved/.test(document.querySelector('#fileState').textContent));
    f = await fs(); assert.equal(f.state, 'clean');
    // one more change: counted against Rev 1, and shown on the Jobs list
    await page.fill('[data-bind="info.site"]', 'After rev 1'); await page.keyboard.press('Tab');
    assert.equal((await fs()).text, 'Rev 1 · 1 change not in the file');
    await page.evaluate(() => window.tfi.go('jobs'));
    assert.match(await page.textContent('#main'), /1 change not in the file/);
    // a change made while the file is being written is not in the file, so it stays counted
    await page.evaluate(async () => {
      // the save reads the job, then (slowly) its photos; an edit lands in between
      const { db } = await import('./js/db.js'), keys = db.jobPhotoKeys.bind(db), get = db.getJob.bind(db);
      db.getJob = async (id) => { const v = await get(id); if (window.__slow) { window.__slow = false; window.__read = true; await new Promise((r) => setTimeout(r, 600)); } return v; };
      window.__slow = true; window.__read = false;
      window.tfi.go('setup');
    });
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => window.__read);
    await page.evaluate(() => { window.tfi.job().info.notes = 'typed during the save'; window.tfi.commit(); });
    await page.waitForFunction(() => /^Rev 2/.test(document.querySelector('#fileState').textContent));
    await page.waitForTimeout(300);
    assert.equal((await fs()).text, 'Rev 2 · 1 change not in the file');
    const file = await page.evaluate(() => window.__file());
    assert.equal(file.job.info.site, 'After rev 1');
    assert.notEqual(file.job.info.notes, 'typed during the save');
    assert.equal(file.job.edits, 0);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'unsaved: closing the app asks first only while a change is not yet on the device'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const fire = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
    await page.waitForFunction(() => document.querySelector('#saveState').textContent !== 'Saving…');
    assert.equal(await fire(), false, 'nothing pending: close without asking');
    await page.evaluate(() => { const put = IDBObjectStore.prototype.put; window.__restorePut = () => { IDBObjectStore.prototype.put = put; }; IDBObjectStore.prototype.put = function (...a) { if (this.name === 'jobs') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return put.apply(this, a); }; });
    await page.evaluate(() => { window.tfi.job().info.client = 'Pending'; window.tfi.commit(); });
    await page.waitForFunction(() => /^Not saved/.test(document.querySelector('#saveState').textContent));
    assert.equal(await fire(), true, 'a change not on the device: ask first');
    await page.evaluate(() => window.__restorePut());
    await page.evaluate(() => window.tfi.commit());
    await page.waitForFunction(() => document.querySelector('#saveState').textContent === 'Saved locally');
    assert.equal(await fire(), false);
    await page.context().close();
  },

  async 'recovery: changes that never reached the device are offered back after the tab is killed'({ browser, url, appPage }) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(() => { window.__tfiAliveMs = 600; });
    const a = await appPage(browser, url, { ctx });
    const id = await a.evaluate(() => window.tfi.job().id);
    await a.waitForFunction(() => document.querySelector('#saveState').textContent === 'Saved locally', null, { timeout: 10000 }).catch(() => {});
    await a.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); }; });
    await a.evaluate(() => { window.tfi.job().info.client = 'Recovered client'; window.tfi.go('shell'); window.tfi.commit(); });
    await a.waitForFunction(() => /^Not saved/.test(document.querySelector('#saveState').textContent));
    await a.close({ runBeforeUnload: false }); // the tab dies with the change only in memory and the journal
    await new Promise((r) => setTimeout(r, 900));
    const b = await ctx.newPage(); b.errors = []; b.on('pageerror', (e) => b.errors.push(String(e)));
    await b.goto(url);
    await b.waitForSelector('#confirmDlg[open] [data-cf="restore"]', { timeout: 10000 });
    const msg = await b.textContent('#confirmDlg');
    assert.match(msg, /closed before some changes reached this device/);
    assert.match(msg, /TK-101/); assert.match(msg, /Shell/);
    await b.click('#confirmDlg [data-cf="restore"]');
    await b.waitForFunction(() => window.tfi?.job());
    const r = await b.evaluate(async (jid) => { const { db } = await import('./js/db.js'); const revs = await db.jobRevisions(jid); return { client: (await db.getJob(jid)).info.client, open: window.tfi.job().info.client, rev: revs.at(-2)?.reason, last: revs.at(-1)?.reason, prevClient: revs.at(-2)?.job.info.client, journal: Object.keys(localStorage).filter((k) => k.startsWith('tfi-journal:')) }; }, id);
    assert.equal(r.client, 'Recovered client');
    assert.equal(r.open, 'Recovered client');
    assert.equal(r.rev, 'before-replace', 'the device copy before recovery is kept as a revision');
    assert.equal(r.last, 'restore', 'the recovered job is kept as a revision too');
    assert.notEqual(r.prevClient, 'Recovered client');
    assert.deepEqual(r.journal, []);
    // not offered again
    await b.reload(); await b.waitForFunction(() => window.tfi?.job()); await b.waitForTimeout(500);
    assert.equal(await b.isVisible('#confirmDlg[open]'), false);
    assert.deepEqual(b.errors, []);
    await ctx.close();
  },

  async 'recovery: discarding keeps the device copy; an open tab and a clean close leave nothing to recover'({ browser, url, appPage }) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(() => { window.__tfiAliveMs = 600; });
    const a = await appPage(browser, url, { ctx });
    const id = await a.evaluate(() => window.tfi.job().id);
    const before = await a.evaluate(async (jid) => { for (let i = 0; i < 40 && document.querySelector('#saveState').textContent !== 'Saved locally'; i++) await new Promise((r) => setTimeout(r, 100)); return (await (await import('./js/db.js')).db.getJob(jid)).info.client; }, id);
    // a clean change: saved, so nothing is left in the journal
    await a.evaluate(() => { window.tfi.job().info.site = 'Clean'; window.tfi.commit(); });
    await a.waitForFunction(() => document.querySelector('#saveState').textContent === 'Saved locally');
    assert.deepEqual(await a.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tfi-journal:'))), []);
    // a pending change in a tab that stays open is not treated as a crash by a second tab
    await a.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('full', 'QuotaExceededError'); }; window.tfi.job().info.client = 'Pending in A'; window.tfi.commit(); });
    await a.waitForFunction(() => /^Not saved/.test(document.querySelector('#saveState').textContent));
    const b = await ctx.newPage(); await b.goto(url); await b.waitForFunction(() => window.tfi && document.querySelector('#main').children.length);
    await b.waitForTimeout(1200);
    assert.equal(await b.isVisible('#confirmDlg[open]'), false, 'tab A is still running');
    await b.close();
    // now tab A dies; the next start offers the change, and Discard keeps the device copy
    await a.close({ runBeforeUnload: false });
    await new Promise((r) => setTimeout(r, 900));
    const c = await ctx.newPage(); await c.goto(url);
    await c.waitForSelector('#confirmDlg[open] [data-cf="discard"]', { timeout: 10000 });
    await c.click('#confirmDlg [data-cf="discard"]');
    await c.waitForFunction(() => window.tfi?.job());
    assert.equal(await c.evaluate(async (jid) => (await (await import('./js/db.js')).db.getJob(jid)).info.client, id), before);
    assert.deepEqual(await c.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('tfi-journal:'))), []);
    await ctx.close();
  },

  async 'integrity: a damaged database is reported without changes; safe repairs fix it; photos are deleted only on request'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const id = await page.evaluate(() => window.tfi.job().id);
    await page.waitForFunction(() => document.querySelector('#saveState').textContent === 'Saved locally', null, { timeout: 10000 }).catch(() => {});
    // damage: a job missing from the list, a list entry with no job, an orphan photo, a file link to a deleted job, a tampered revision
    await page.evaluate(async (jid) => {
      const { db } = await import('./js/db.js'), { sha256 } = await import('./js/util.js');
      const raw = await new Promise((res) => { const q = indexedDB.open('tank-floor-inspector'); q.onsuccess = () => res(q.result); });
      const put = (store, v) => new Promise((res, rej) => { const t = raw.transaction(store, 'readwrite'); t.objectStore(store).put(v); t.oncomplete = res; t.onerror = () => rej(t.error); });
      await db.deleteCard(jid);
      await put('cards', { id: 'ghost', info: { tankId: 'Ghost tank' } });
      await put('photos', { id: 'orphan-photo', jobId: 'deleted-job', dataUrl: 'data:image/png;base64,AA==' });
      await db.setMeta('fh:deleted-job', { name: 'old.json' });
      const job = await db.getJob(jid);
      await put('revisions', { id: jid + ':99', jobId: jid, n: 99, rev: 0, at: Date.now(), reason: 'checkpoint', hash: await sha256(job), job: { ...job, info: { ...job.info, client: 'Tampered later' } }, photoIds: [] });
    }, id);
    const dump = () => page.evaluate(async () => { const raw = await new Promise((res) => { const q = indexedDB.open('tank-floor-inspector'); q.onsuccess = () => res(q.result); }); const all = (n) => new Promise((res) => { const r = raw.transaction(n).objectStore(n).getAll(); r.onsuccess = () => res(JSON.stringify(r.result)); }); return { jobs: await all('jobs'), cards: await all('cards'), photos: await all('photos'), revisions: await all('revisions') }; });
    const before = await dump();
    await page.evaluate(() => window.tfi.go('jobs'));
    await page.click('[data-act="integrity-run"]');
    await page.waitForSelector('.integrity-list');
    const text = await page.textContent('#integrityRes');
    assert.match(text, /missing from the job list/);
    assert.match(text, /Ghost tank/);
    assert.match(text, /photo belongs to a job that is no longer on this device/);
    assert.match(text, /remembered file link/);
    assert.match(text, /does not match its checksum/);
    assert.deepEqual(await dump(), before, 'checking changes nothing');
    // safe repairs: the list entries and the file link; the photo and the revision are left alone
    await page.click('[data-act="integrity-fix-safe"]');
    await page.waitForFunction(() => { const t = document.querySelector('#integrityRes').textContent; return !/Checking/.test(t) && !/missing from the job list/.test(t); });
    const t2 = await page.textContent('#integrityRes');
    assert.doesNotMatch(t2, /Ghost tank|remembered file link/);
    assert.match(t2, /does not match its checksum/);
    assert.match(t2, /photo belongs to a job/);
    assert.equal(await page.evaluate(async (jid) => !!(await (await import('./js/db.js')).db.allCards()).find((c) => c.id === jid), id), true);
    // the orphan photo goes only after an explicit confirmation
    await page.click('#integrityRes [data-act="integrity-fix"]:has-text("Delete photo")');
    await page.click('#confirmDlg [data-cf="no"]');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(async () => !!(await (await import('./js/db.js')).db.getPhoto('orphan-photo'))), true);
    await page.click('#integrityRes [data-act="integrity-fix"]:has-text("Delete photo")');
    await page.click('#confirmDlg [data-cf="yes"]');
    await page.waitForFunction(() => { const t = document.querySelector('#integrityRes').textContent; return !/Checking/.test(t) && !/photo belongs to a job/.test(t); });
    assert.equal(await page.evaluate(async () => !!(await (await import('./js/db.js')).db.getPhoto('orphan-photo'))), false);
    // the tampered revision is still reported; it is never changed
    assert.match(await page.textContent('#integrityRes'), /does not match its checksum/);
    assert.equal(await page.evaluate(async (jid) => (await (await import('./js/db.js')).db.getRevision(jid + ':99')).job.info.client, id), 'Tampered later');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'integrity: a clean device reports no problems'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(() => window.tfi.go('jobs'));
    await page.click('[data-act="integrity-run"]');
    await page.waitForFunction(() => /No problems found/.test(document.querySelector('#integrityRes').textContent));
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'offline: an update never caches stale files from the browser HTTP cache'({ browser, serve }) {
    const { readFile } = await import('node:fs/promises');
    const root = new URL('../../', import.meta.url);
    const over = new Map();
    const { srv, url } = await serve(over, { 'Cache-Control': 'max-age=600' });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    // release B: new cache name and a changed app.js
    const sw = await readFile(new URL('sw.js', root), 'utf8');
    over.set('/sw.js', sw.replace(/const CACHE = '[^']+'/, "const CACHE = 'tank-floor-test-B'"));
    over.set('/js/app.js', (await readFile(new URL('js/app.js', root), 'utf8')) + '\n// release B\n');
    const ok = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update();
      for (let i = 0; i < 100 && !(await caches.keys()).includes('tank-floor-test-B'); i++) await new Promise((r) => setTimeout(r, 100));
      for (let i = 0; i < 100 && reg.installing; i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 300));
      const c = await caches.open('tank-floor-test-B');
      const res = await c.match('./js/app.js');
      return res ? (await res.text()).includes('// release B') : 'missing';
    });
    assert.equal(ok, true, 'the new cache holds the previous release of app.js');
    await ctx.close(); srv.close();
  },

  async 'job files: saving over a file someone else saved asks first; Dashboard stage changes merge'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    // a real file handle (Origin Private File System), remembered as this job's file
    await page.evaluate(async () => {
      const { db } = await import('./js/db.js');
      const dir = await navigator.storage.getDirectory();
      const hnd = await dir.getFileHandle('job.json', { create: true });
      // Keep file handles in memory: reading a handle back from IndexedDB crashes headless Chrome.
      const handles = new Map(), get = db.getMeta.bind(db), set = db.setMeta.bind(db);
      db.getMeta = async (k) => (k.startsWith('fh:') ? handles.get(k) : get(k));
      db.setMeta = async (k, v) => (k.startsWith('fh:') ? handles.set(k, v) : set(k, v));
      await db.setMeta('fh:' + window.tfi.job().id, hnd);
      window.__file = async (fn) => { const d = JSON.parse(await (await hnd.getFile()).text()); if (!fn) return d; fn(d); const w = await hnd.createWritable(); await w.write(JSON.stringify(d)); await w.close(); return d; };
    });
    const save = async () => { await page.evaluate(() => window.tfi.go('setup')); await page.keyboard.press('Control+s'); await page.waitForTimeout(500); };
    await save();
    assert.equal((await page.evaluate(() => window.__file())).rev, 1);

    // someone else saves Rev 2
    await page.evaluate(() => window.__file((d) => { d.rev = 2; d.job.rev = 2; d.job.savedAt = Date.now() + 1000; d.job.info.client = 'Theirs'; }));
    await page.fill('[data-bind="info.client"]', 'Mine'); await page.keyboard.press('Tab');
    await save();
    assert.ok(await page.isVisible('#confirmDlg [data-cf="copy"]'), 'conflict prompt should appear');
    await page.click('#confirmDlg [data-cf="cancel"]');
    await page.waitForTimeout(200);
    let f = await page.evaluate(() => window.__file());
    assert.equal(f.job.info.client, 'Theirs', 'cancel must leave their file alone');
    await save();
    await page.click('#confirmDlg [data-cf="ok"]');
    await page.waitForTimeout(500);
    f = await page.evaluate(() => window.__file());
    assert.equal(f.job.info.client, 'Mine');

    // no conflict prompt when nothing changed since our own save
    await save();
    assert.equal(await page.isVisible('#confirmDlg[open]'), false);

    // a teammate moves the card on their Dashboard (same rev): our next save keeps their stage
    await page.evaluate(() => window.__file((d) => { d.job.status.stage = 'review'; d.job.status.history.push({ stage: 'review', at: Date.now() + 5000 }); }));
    await save();
    assert.equal(await page.isVisible('#confirmDlg[open]'), false);
    f = await page.evaluate(() => window.__file());
    assert.equal(f.job.status.stage, 'review');
    assert.equal(await page.evaluate(() => window.tfi.job().status.stage), 'review');

    // changing the stage here adds to the file's history instead of replacing it
    const n = f.job.status.history.length;
    await page.selectOption('[data-bind="status.stage"]', 'complete');
    await page.waitForTimeout(400);
    f = await page.evaluate(() => window.__file());
    assert.equal(f.job.status.stage, 'complete');
    assert.equal(f.job.status.history.length, n + 1);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'job files: a file from a newer app version is refused, not re-saved'({ browser, url, appPage }) {
    const page = await appPage(browser, url, { demo: false });
    const job = await page.evaluate(async () => { const { newJob } = await import('./js/model.js'); const j = newJob(); j.schema = 99; j.info.tankId = 'FUTURE'; return j; });
    await page.evaluate(() => window.tfi.go('jobs'));
    await page.setInputFiles('#openFileInput', { name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'tank-floor-inspector', version: 1, job, photos: [], appVersion: '9.0.0' })) });
    await page.waitForTimeout(300);
    assert.match(await page.textContent('#toast'), /newer version of the app \(v9\.0\.0\)/);
    assert.equal(await page.evaluate(async () => (await (await import('./js/db.js')).db.allJobs()).length), 0);
    await page.context().close();
  },

  async 'storage: warns when the device is nearly full'({ browser, url, appPage }) {
    const page = await appPage(browser, url, { demo: false });
    await page.evaluate(() => { navigator.storage.estimate = async () => ({ usage: 850, quota: 1000 }); });
    await page.evaluate(() => window.tfi.go('jobs'));
    await page.click('[data-act="job-new"]');
    await page.waitForTimeout(300);
    assert.match(await page.textContent('#toast'), /85 % full/);
    await page.evaluate(() => window.tfi.go('jobs'));
    await page.waitForTimeout(200);
    assert.match(await page.textContent('#storageInfo'), /Nearly full/);
    await page.context().close();
  },

  async 'performance: cached floor results always equal a fresh calculation'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const bad = await page.evaluate(async () => {
      const { buildLayout } = await import('./js/geometry.js');
      const { api653 } = await import('./js/calc.js');
      const ser = (v) => JSON.stringify(v, (k, x) => (x instanceof Map ? [...x] : x instanceof Set ? [...x] : x));
      const S = window.__app, j = () => S.job, out = [];
      const edits = [
        ['indication UT', () => { j().indications[2].utMin = 1.5; }],
        ['indication repair', () => { j().indications[0].repair = 'no'; }],
        ['new indication', () => { j().indications.push({ ...j().indications[1], id: 'new1', no: '099', utMin: 2 }); }],
        ['Or', () => { j().calc.Or = 15; }],
        ['coated', () => { j().calc.coated = true; }],
        ['shell course t-min', () => { j().shell.courses[0].tMin = 9; }],
        ['shell UT reading only', () => { const k = Object.keys(j().shell.rd)[0]; const z = Object.keys(j().shell.rd[k])[0]; j().shell.rd[k][z] = 7.5; }],
        ['tank bottom t', () => { j().tank.tBottom = 7; }],
        ['plate thickness', () => { const p = S.layout.plates[5].key; j().plates[p] = { ...(j().plates[p] || {}), t: 5 }; }],
        ['annular off', () => { j().layout.annular = false; }],
        ['diameter', () => { j().tank.diameter = 30000; }],
        ['delete indication', () => { j().indications.splice(0, 1); }]
      ];
      for (const [name, fn] of edits) {
        fn(); window.tfi.commit();
        if (ser(S.calc) !== ser(api653(j(), buildLayout(j())))) out.push(name);
      }
      return out;
    });
    assert.deepEqual(bad, []);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'performance: a shell UT edit on a 1,000-indication floor is fast'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const ms = await page.evaluate(async () => {
      const j = window.tfi.job(), base = j.indications;
      for (let i = 0; i < 1000; i++) { const b = base[i % base.length]; j.indications.push({ ...b, id: 'bulk' + i, no: String(100 + i), utMin: (b.utMin || 4) * (0.8 + (i % 20) / 50) }); }
      window.tfi.commit();
      window.tfi.go('shell');
      const inp = document.querySelector('input[data-rd], .readings input');
      const times = [];
      for (let k = 0; k < 5; k++) {
        inp.value = String(0.3 + k / 100);
        const t0 = performance.now();
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        times.push(performance.now() - t0);
      }
      return times.sort((a, b) => a - b)[2];
    });
    console.log(`      median shell UT edit with 1,014 indications: ${ms.toFixed(1)} ms`);
    assert.ok(ms < 20, `took ${ms.toFixed(0)} ms`);
    await page.context().close();
  },

  async 'storage: upgrading from v3.4.2 keeps every job and builds the light job list'({ browser, url, appPage }) {
    const { readFileSync } = await import('node:fs');
    const demo = JSON.parse(readFileSync(new URL('../fixtures/demo.json', import.meta.url), 'utf8'));
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const pre = await ctx.newPage();
    await pre.goto(url + 'icons/icon.svg');
    await pre.evaluate(async (job) => {
      // the v3.4.2 database: version 2, no cards store
      const db = await new Promise((res) => { const q = indexedDB.open('tank-floor-inspector', 2); q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('jobs', { keyPath: 'id' }); d.createObjectStore('photos', { keyPath: 'id' }).createIndex('jobId', 'jobId'); d.createObjectStore('meta', { keyPath: 'key' }); d.createObjectStore('tanks', { keyPath: 'id' }); }; q.onsuccess = () => res(q.result); });
      await new Promise((res) => { const t = db.transaction('jobs', 'readwrite'); t.objectStore('jobs').put(job); t.objectStore('jobs').put({ ...job, id: 'second', info: { ...job.info, tankId: 'TK-202' } }); t.oncomplete = res; });
      db.close();
    }, demo);
    await pre.close();
    const page = await appPage(browser, url, { demo: false, ctx });
    // count full-job reads while the job list and dashboard render
    await page.evaluate(() => { const g = IDBObjectStore.prototype.getAll; window.__fullReads = 0; IDBObjectStore.prototype.getAll = function (...a) { if (this.name === 'jobs') window.__fullReads++; return g.apply(this, a); }; });
    await page.evaluate(() => window.tfi.go('jobs'));
    await page.evaluate(() => window.tfi.go('dash'));
    const r = await page.evaluate(() => ({ jobs: window.__app.jobs.map((j) => [j.info.tankId, j.nInds, 'indications' in j]).sort(), rows: document.querySelectorAll('#main [data-act]').length, fullReads: window.__fullReads }));
    assert.deepEqual(r.jobs, [['TK-101', 14, false], ['TK-202', 14, false]]);
    assert.equal(r.fullReads, 0);
    await page.evaluate(() => window.tfi.go('jobs'));
    assert.match(await page.textContent('#main'), /TK-202/);
    // opening a job still loads all of it
    await page.click('[data-act="job-open"][data-id="second"]');
    await page.waitForFunction(() => window.tfi.job()?.id === 'second');
    assert.equal(await page.evaluate(() => window.tfi.job().indications.length), 14);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  },

  async 'performance: Dashboard rescans only re-read job files that changed'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const r = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('jobs', { create: true });
      const job = window.tfi.job(), write = async (name, obj) => { const h = await dir.getFileHandle(name, { create: true }); const w = await h.createWritable(); await w.write(JSON.stringify(obj)); await w.close(); };
      for (const n of [1, 2, 3]) await write(`tk${n}.json`, { format: 'tank-floor-inspector', version: 1, rev: 1, job: { ...job, id: 'f' + n, info: { ...job.info, tankId: 'FILE-' + n } }, photos: [] });
      await write('other.json', { hello: 'not a job' });
      let full = 0; const text = Blob.prototype.text;
      Blob.prototype.text = function () { if (this instanceof File) full++; return text.call(this); };
      const S = window.__app;
      S.dash.dir = dir; S.dash.perm = 'granted'; S.dash.scanned = false;
      const rescan = async () => { full = 0; window.tfi.go('dash'); document.querySelector('[data-act="dash-rescan"]').click(); for (let i = 0; i < 50 && (S.dash.scanning || !S.dash.scanned); i++) await new Promise((r) => setTimeout(r, 50)); await new Promise((r) => setTimeout(r, 100)); return full; };
      const first = await rescan();
      const second = await rescan();
      await write('tk2.json', { format: 'tank-floor-inspector', version: 1, rev: 2, job: { ...job, id: 'f2', updated: Date.now() + 9999, info: { ...job.info, tankId: 'FILE-2-NEW' } }, photos: [] });
      const third = await rescan();
      const cards = [...S.dash.files.values()].map((f) => f.card.tankId).sort();
      Blob.prototype.text = text;
      return { first, second, third, cards };
    });
    assert.deepEqual(r, { first: 3, second: 0, third: 1, cards: ['FILE-1', 'FILE-2-NEW', 'FILE-3'] });
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'job files: the file written in pieces is byte-for-byte the v3.4.2 format'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(async () => {
      const { db } = await import('./js/db.js');
      const job = window.tfi.job(), id = job.id;
      await db.replaceJob(job, [1, 2, 3].map((n) => ({ id: 'ph' + n, jobId: id, sec: 'floor', n, dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(1000 * n), caption: 'Photo "' + n + '" ü', anno: [{ k: 'arrow', x: n }] })));
      const dir = await navigator.storage.getDirectory(), hnd = await dir.getFileHandle('bytes.json', { create: true });
      const handles = new Map(), get = db.getMeta.bind(db), set = db.setMeta.bind(db);
      db.getMeta = async (k) => (k.startsWith('fh:') ? handles.get(k) : get(k));
      db.setMeta = async (k, v) => (k.startsWith('fh:') ? handles.set(k, v) : set(k, v));
      await db.setMeta('fh:' + id, hnd);
      window.__hnd = hnd;
    });
    await page.keyboard.press('Control+s');
    const r = await page.evaluate(async () => {
      const { db } = await import('./js/db.js');
      const id = window.tfi.job().id, hnd = window.__hnd;
      for (let i = 0; i < 50 && !(await hnd.getFile()).size; i++) await new Promise((res) => setTimeout(res, 50));
      await new Promise((res) => setTimeout(res, 200));
      const text = await (await hnd.getFile()).text(), f = JSON.parse(text);
      const expected = JSON.stringify({ format: 'tank-floor-inspector', version: 1, saved: f.saved, rev: f.rev, job: f.job, photos: await db.jobPhotos(id), appVersion: f.appVersion });
      return { same: text === expected, photos: f.photos.length, len: text.length };
    });
    assert.deepEqual({ same: r.same, photos: r.photos }, { same: true, photos: 3 });
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'tablet: two-finger pinch zooms the floor map; one finger still pans and taps'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(() => window.tfi.go('map'));
    const r = await page.evaluate(async () => {
      const box = document.querySelector('#mapbox'), svg = () => box.querySelector('svg');
      const vbw = () => +svg().getAttribute('viewBox').split(/\s+/)[2];
      const rect = box.getBoundingClientRect(), cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      const ev = (type, id, x, y, kind = 'touch') => svg().dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: kind, clientX: x, clientY: y, button: 0, bubbles: true, isPrimary: id === 1 }));
      const start = vbw(), selBefore = window.__app.selPlate;
      ev('pointerdown', 1, cx - 20, cy); ev('pointerdown', 2, cx + 20, cy);
      for (let k = 1; k <= 5; k++) { ev('pointermove', 1, cx - 20 - k * 20, cy); ev('pointermove', 2, cx + 20 + k * 20, cy); }
      ev('pointerup', 1, cx - 120, cy); ev('pointerup', 2, cx + 120, cy);
      const zoomed = vbw();
      const sel = window.__app.selPlate;
      // one-finger pan: viewBox moves, width unchanged
      const vb0 = svg().getAttribute('viewBox');
      ev('pointerdown', 7, cx, cy); for (let k = 1; k <= 5; k++) ev('pointermove', 7, cx + k * 10, cy); ev('pointerup', 7, cx + 50, cy);
      const panned = svg().getAttribute('viewBox') !== vb0 && vbw() === zoomed;
      // one-finger tap still selects
      ev('pointerdown', 8, cx, cy); ev('pointerup', 8, cx, cy);
      await new Promise((res) => setTimeout(res, 50));
      return { start, zoomed, tappedDuringPinch: sel !== selBefore, panned, tapSelects: !!(window.__app.selPlate || window.__app.sel || window.__app.selFeature) };
    });
    assert.ok(r.zoomed < r.start * 0.3, `pinch should zoom in (width ${r.start} → ${r.zoomed})`);
    assert.equal(r.tappedDuringPinch, false);
    assert.ok(r.panned, 'one-finger drag should pan');
    assert.ok(r.tapSelects, 'a tap should still select');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'accessibility: every button on every page has a readable name'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const views = [...VIEWS, ...SECS.flatMap((s) => CHILD.map((c) => `${c}:${s}`)), 'an:shell', 'an:settle'];
    const bad = new Set();
    for (const v of views) {
      await page.evaluate((x) => window.tfi.go(x), v);
      for (const b of await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => !/[\p{L}\p{N}]/u.test(b.textContent) && !b.getAttribute('aria-label')).map((b) => (b.dataset.act || b.className) + ' ' + b.outerHTML.slice(0, 80)))) bad.add(b);
    }
    assert.deepEqual([...bad], []);
    await page.context().close();
  },

  async 'job files: opening an older job says what was updated, once'({ browser, url, appPage }) {
    const { readFileSync } = await import('node:fs');
    const legacy = readFileSync(new URL('../fixtures/legacy-schema1.json', import.meta.url));
    const page = await appPage(browser, url, { demo: false });
    await page.evaluate(() => window.tfi.go('jobs'));
    await page.setInputFiles('#openFileInput', { name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'tank-floor-inspector', version: 1, job: JSON.parse(legacy), photos: [] })) });
    // this test job was made from a newer one, so its NDE methods point at equipment ids the update replaces:
    // the import check lists that (stage 6), and the job opens once the user chooses Open anyway
    await page.waitForSelector('#confirmDlg[open]');
    assert.match(await page.textContent('#confirmDlg'), /uses equipment that is not in the job’s equipment list/);
    await page.click('#confirmDlg [data-cf="open"]');
    await page.waitForTimeout(500);
    const t = await page.textContent('#toast');
    assert.match(t, /updated from an older version/);
    assert.match(t, /2 in past the corrosion/);
    assert.match(t, /plate edges/);
    // saved in the new shape, so the next open says nothing
    await page.waitForTimeout(600);
    const id = await page.evaluate(() => window.tfi.job().id);
    await page.evaluate(() => { document.querySelector('#toast').hidden = true; window.tfi.go('jobs'); });
    await page.click(`[data-act="job-open"][data-id="${id}"]`);
    await page.waitForFunction(() => window.__app.view === 'map' && document.querySelector('#mapbox svg'));
    await page.waitForTimeout(400);
    assert.equal(await page.isVisible('#toast'), false);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'storage: an old version open in another window delays the upgrade with a message, then it completes'({ browser, url }) {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const old = await ctx.newPage();
    await old.goto(url + 'icons/icon.svg');
    await old.evaluate(() => new Promise((res) => { const q = indexedDB.open('tank-floor-inspector', 2); q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('jobs', { keyPath: 'id' }); d.createObjectStore('photos', { keyPath: 'id' }).createIndex('jobId', 'jobId'); d.createObjectStore('meta', { keyPath: 'key' }); d.createObjectStore('tanks', { keyPath: 'id' }); }; q.onsuccess = () => { window.__keep = q.result; res(); }; }));
    const page = await ctx.newPage();
    await page.goto(url);
    await page.waitForFunction(() => /Close any other Tank Floor Inspector windows/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 10000 });
    await old.close();
    await page.waitForFunction(() => window.tfi && document.querySelector('#main').children.length, null, { timeout: 10000 });
    await ctx.close();
  }
  ,
  async 'migrations: upgrading a v3.6.0 database keeps every record, logs the step and adds baseline revisions'({ browser, url, appPage }) {
    const { readFileSync } = await import('node:fs');
    const demo = JSON.parse(readFileSync(new URL('../fixtures/demo.json', import.meta.url), 'utf8'));
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const pre = await ctx.newPage();
    await pre.goto(url + 'icons/icon.svg');
    await pre.evaluate(seedV3, { ...demo, schema: 3 }); const before = await pre.evaluate(dumpStores);
    await pre.close();
    const page = await appPage(browser, url, { demo: false, ctx });
    await page.evaluate(async () => { const { db } = await import('./js/db.js'); for (let i = 0; i < 150 && !(await db.getMeta('baseline:v4')); i++) await new Promise((r) => setTimeout(r, 100)); });
    const after = await page.evaluate(dumpStores);
    assert.equal(after.version, 4);
    for (const s of ['jobs', 'photos', 'tanks', 'cards']) assert.deepEqual(after[s], before[s], `${s} changed during the upgrade`);
    assert.deepEqual(after.newStores, ['audit', 'imports', 'revisions']);
    const dbLog = after.migrations.filter((m) => m.kind === 'db');
    assert.deepEqual(dbLog.map((m) => [m.from, m.to]), [[3, 4]]);
    assert.ok(dbLog[0].app, 'the log records the app version');
    // one baseline revision per job, holding the stored job exactly, with a matching checksum
    const revs = await page.evaluate(async () => { const { db } = await import('./js/db.js'), { sha256 } = await import('./js/util.js'); const out = []; for (const id of ['demo-a', 'demo-b']) for (const r of await db.jobRevisions(id)) out.push({ id: r.id, reason: r.reason, ok: r.hash === (await sha256(r.job)), job: r.job, photos: r.photoIds }); return out; });
    assert.deepEqual(revs.map((r) => [r.id, r.reason, r.ok]), [['demo-a:1', 'migration', true], ['demo-b:1', 'migration', true]]);
    assert.deepEqual(revs[0].job, before.jobs.find((j) => j.id === 'demo-a'));
    assert.deepEqual(revs[0].photos, ['p1']);
    // the baseline runs once: reloading adds nothing
    await page.reload(); await page.waitForFunction(() => window.tfi && document.querySelector('#main').children.length);
    await page.waitForTimeout(2500);
    assert.equal(await page.evaluate(async () => (await (await import('./js/db.js')).db.jobRevisions('demo-a')).length), 1);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  },

  async 'migrations: opening an older job keeps a copy of it as it was, then migrates and logs it'({ browser, url, appPage }) {
    const { readFileSync } = await import('node:fs');
    const demo = JSON.parse(readFileSync(new URL('../fixtures/legacy-schema1.json', import.meta.url), 'utf8'));
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const pre = await ctx.newPage(); await pre.goto(url + 'icons/icon.svg');
    await pre.evaluate(seedV3, { ...demo, schema: 1 }); const before = await pre.evaluate(dumpStores);
    await pre.close();
    const page = await appPage(browser, url, { demo: false, ctx });
    await page.evaluate(async () => { const { db } = await import('./js/db.js'); for (let i = 0; i < 150 && !(await db.getMeta('baseline:v4')); i++) await new Promise((r) => setTimeout(r, 100)); });
    await page.evaluate(() => window.tfi.go('jobs'));
    await page.click('[data-act="job-open"][data-id="demo-a"]');
    await page.waitForFunction(() => window.tfi.job()?.id === 'demo-a' && window.tfi.job().schema === 4);
    await page.waitForTimeout(800); // let the migrated job save
    const r = await page.evaluate(async () => {
      const { db } = await import('./js/db.js');
      const revs = await db.jobRevisions('demo-a'), log = await db.migrationLog(), stored = await db.getJob('demo-a');
      return { revs: revs.map((x) => [x.n, x.reason, x.note, x.schema, x.job]), jobLog: log.filter((m) => m.kind === 'job' && m.jobId === 'demo-a').map((m) => [m.from, m.to]), storedSchema: stored.schema };
    });
    assert.deepEqual(r.revs.map((x) => x.slice(0, 4)), [[1, 'migration', 'Baseline at upgrade to the data integrity version', 1], [2, 'migration', 'Before migration from schema 1 to 4', 1]]);
    assert.deepEqual(r.revs[1][4], before.jobs.find((j) => j.id === 'demo-a'), 'the revision holds the job exactly as stored before the migration');
    assert.deepEqual(r.jobLog, [[1, 2], [2, 3], [3, 4]]);
    assert.equal(r.storedSchema, 4);
    // opening it again adds no revision and no log entry
    const openVia = (id) => page.evaluate((i) => { window.tfi.go('jobs'); document.querySelector(`[data-act="job-open"][data-id="${i}"]`).click(); }, id);
    await openVia('demo-b');
    await page.waitForFunction(() => window.tfi.job()?.id === 'demo-b');
    await page.waitForTimeout(300);
    await openVia('demo-a');
    await page.waitForFunction(() => window.tfi.job()?.id === 'demo-a');
    assert.equal(await page.evaluate(async () => (await (await import('./js/db.js')).db.jobRevisions('demo-a')).length), 2);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  },

  async 'migrations: a database step that fails leaves the old database and its data untouched'({ browser, url }) {
    const { readFileSync } = await import('node:fs');
    const demo = JSON.parse(readFileSync(new URL('../fixtures/demo.json', import.meta.url), 'utf8'));
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const pre = await ctx.newPage(); await pre.goto(url + 'icons/icon.svg');
    await pre.evaluate(seedV3, { ...demo, schema: 3 }); const before = await pre.evaluate(dumpStores);
    await pre.close();
    await ctx.addInitScript(() => { window.__tfiFailDbStep = 4; });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);
    await page.waitForFunction(() => /could not be opened/.test(document.querySelector('#main')?.textContent || ''), null, { timeout: 10000 });
    await page.close();
    const chk = await ctx.newPage(); await chk.goto(url + 'icons/icon.svg');
    const after = await chk.evaluate(dumpStores);
    assert.equal(after.version, 3);
    assert.deepEqual(after.newStores, []);
    for (const s of ['jobs', 'photos', 'tanks', 'cards']) assert.deepEqual(after[s], before[s]);
    assert.deepEqual(after.migrations, []);
    assert.deepEqual(errors, []);
    await ctx.close();
  },

  async 'backup: back up → restore on an empty device gives identical stores (checksummed file)'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await richDevice(page);
    const before = await storeSnapshot(page);
    const file = await takeBackup(page);
    assert.match(file.name, /^tfi-backup_.*\.tfibackup\.json$/);
    assert.match(await page.textContent('#backupLast'), /Last backup .*2 jobs, 1 photo/);
    await page.context().close();
    // a new browser profile = a wiped device
    const fresh = await appPage(browser, url, { demo: false });
    const msg = await restoreBackup(fresh, file);
    assert.match(msg, /Restored 2 jobs from the backup/);
    const after = await storeSnapshot(fresh), afterRaw = { ...after };
    // each restored job gains one 'restore' revision on top of the revisions it had; the rest is identical
    const restored = JSON.parse(after.revisions).filter((r) => r.reason === 'restore');
    assert.deepEqual(restored.map((r) => r.jobId).sort(), JSON.parse(before.jobs).map((j) => j.id).sort(), 'one restore revision per job');
    after.revisions = JSON.stringify(JSON.parse(after.revisions).filter((r) => r.reason !== 'restore'));
    for (const k of Object.keys(before)) assert.equal(after[k], before[k], `store ${k} differs after restore`);
    // restoring the same backup again changes nothing
    const again = await restoreBackup(fresh, file);
    assert.match(again, /Nothing needed restoring/);
    assert.deepEqual(await storeSnapshot(fresh), afterRaw);
    assert.deepEqual(fresh.errors, []);
    await fresh.context().close();
  },

  async 'backup: a damaged backup is refused and nothing changes'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const file = await takeBackup(page);
    const before = await storeSnapshot(page);
    const text = file.buffer.toString('utf8');
    const damaged = { name: file.name, buffer: Buffer.from(text.replace('"TK-101"', '"TK-1O1"')) };
    assert.notEqual(damaged.buffer.toString(), text);
    assert.match(await restoreBackup(page, damaged, {}, { expectPreview: false }), /checksum does not match.*Nothing was changed/s);
    const cut = { name: file.name, buffer: file.buffer.subarray(0, Math.floor(file.buffer.length / 2)) };
    assert.match(await restoreBackup(page, cut, {}, { expectPreview: false }), /not a readable backup file.*Nothing was changed/s);
    assert.deepEqual(await storeSnapshot(page), before);
    await page.context().close();
  },

  async 'backup: a job that fails to restore is left untouched; the others are restored in full'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await richDevice(page);
    const ids = await page.evaluate(() => window.__app.jobs.map((j) => j.id));
    const file = await takeBackup(page);
    await page.context().close();
    const fresh = await appPage(browser, url, { demo: false });
    await fresh.evaluate((id) => { window.__tfiFailRestore = id; }, ids[0]);
    const msg = await restoreBackup(fresh, file);
    assert.match(msg, /Restored 1 job\. Not restored \(left as they were\)/);
    const s = await storeSnapshot(fresh), has = (store, id) => JSON.parse(s[store]).some((r) => r.id === id || r.jobId === id);
    for (const store of ['jobs', 'cards', 'photos', 'revisions', 'audit']) assert.equal(has(store, ids[0]), false, `${store} has records of the failed job`);
    assert.equal(has('jobs', ids[1]), true);
    await fresh.context().close();
  },

  async 'backup: replacing a job keeps a revision of the device copy; "keep both" adds a separate copy'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const file = await takeBackup(page);
    const id = await page.evaluate(() => window.tfi.job().id);
    await page.evaluate(() => window.tfi.go('setup'));
    await page.fill('input[data-bind="info.client"]', 'Changed after the backup'); await page.press('input[data-bind="info.client"]', 'Tab');
    await page.waitForTimeout(500);
    const msg = await restoreBackup(page, file, { [id]: 'replace' });
    assert.match(msg, /Restored 1 job from the backup \(1 replaced\).*open job was replaced/s);
    const st = await storeSnapshot(page);
    const job = JSON.parse(st.jobs).find((j) => j.id === id);
    assert.equal(job.info.client, 'Demo Energy Ltd.');
    const revs = JSON.parse(st.revisions).filter((r) => r.jobId === id);
    assert.ok(revs.some((r) => r.reason === 'before-replace' && r.job.info.client === 'Changed after the backup'), 'device copy kept as a revision');
    // change it again and keep both
    await page.click(`[data-act="job-open"][data-id="${id}"]`);
    await page.waitForFunction(() => window.__app.view === 'map' && document.querySelector('#mapbox svg'));
    await page.evaluate(() => window.tfi.go('setup'));
    await page.fill('input[data-bind="info.client"]', 'Second change'); await page.press('input[data-bind="info.client"]', 'Tab');
    await page.waitForTimeout(500);
    await restoreBackup(page, file, { [id]: 'both' });
    const jobs = JSON.parse((await storeSnapshot(page)).jobs);
    assert.equal(jobs.length, 2);
    assert.ok(jobs.some((j) => j.id === id && j.info.client === 'Second change'));
    assert.ok(jobs.some((j) => j.id !== id && /from backup/.test(j.info.tankId) && j.info.client === 'Demo Energy Ltd.'));
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'backup: automatic backups go to the jobs folder (_backups, newest 5 kept); without access the card says one is due'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(() => {
      const fakeDir = (perm) => { const files = new Map(), dirs = new Map(); return { kind: 'directory', files, dirs,
        async queryPermission() { return perm; }, async getDirectoryHandle(n) { if (!dirs.has(n)) dirs.set(n, fakeDir(perm)); return dirs.get(n); },
        async getFileHandle(n) { return { kind: 'file', name: n, async createWritable() { let buf = ''; return { async write(c) { buf += c; }, async close() { files.set(n, buf); }, async abort() {} }; } }; },
        async *entries() { for (const [n] of files) yield [n, { kind: 'file' }]; for (const [n, v] of dirs) yield [n, v]; },
        async removeEntry(n) { files.delete(n); } }; };
      window.__fakeDir = fakeDir('granted'); window.__app.dash.dir = window.__fakeDir;
      const real = Date.now.bind(Date); window.__shift = 0; Date.now = () => real() + window.__shift;
      window.tfi.go('jobs');
    });
    const backups = () => page.evaluate(() => [...(window.__fakeDir.dirs.get('_backups')?.files.keys() || [])].sort());
    for (let k = 0; k < 7; k++) {
      await page.evaluate((k) => { window.__shift = k * 8 * 86400000; document.querySelector('#toast').hidden = true; }, k);
      await page.selectOption('select[data-backup-days]', k % 2 ? '7' : '1');
      await page.waitForFunction((n) => (window.__fakeDir.dirs.get('_backups')?.files.size || 0) >= Math.min(n, 5) && /Automatic backup made/.test(document.querySelector('#toast').textContent), k + 1);
    }
    const names = await backups();
    assert.equal(names.length, 5, names.join(', '));
    assert.ok(names.every((n) => /^tfi-backup_auto_.*\.tfibackup\.json$/.test(n)));
    const newest = JSON.parse(await page.evaluate((n) => window.__fakeDir.dirs.get('_backups').files.get(n), names.at(-1)));
    assert.equal(newest.format, 'tank-floor-inspector-backup');
    assert.match(await page.textContent('#backupLast'), /to the jobs folder/);
    // a folder the browser hasn't allowed this session: no backup, the card says one is due
    await page.evaluate(() => { window.__app.dash.dir = { ...window.__fakeDir, queryPermission: async () => 'prompt' }; window.__shift += 30 * 86400000; });
    await page.selectOption('select[data-backup-days]', '30');
    await page.waitForFunction(() => /automatic backup is due/i.test(document.querySelector('#backupLast').textContent));
    assert.equal((await backups()).length, 5);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'import validation: a job file with an error is refused with the reason, and nothing changes'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(() => window.tfi.go('jobs'));
    const before = await jobIds(page);
    const file = await demoFile(page, (d) => { d.job.indications[1].id = d.job.indications[0].id; d.job.indications[2].mflPct = 'deep'; });
    await page.setInputFiles('input[data-act="job-import"]', file);
    await page.waitForSelector('#confirmDlg[open]');
    const msg = await page.textContent('#confirmDlg');
    assert.match(msg, /tk-import\.json was not opened: it has 2 problems.*Nothing on this device was changed/s);
    assert.match(msg, /share the id .*edits would change both/);
    assert.match(msg, /MFL % is “deep”, which is not a number/);
    assert.equal(await page.locator('#confirmDlg [data-cf]').count(), 1, 'no way to open it anyway');
    await page.click('#confirmDlg [data-cf="ok"]');
    await page.waitForTimeout(300);
    assert.deepEqual(await jobIds(page), before);
    assert.deepEqual(await importRecords(page), [['refused', 2, 0]]);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'import validation: warnings are listed; Cancel changes nothing, Open anyway opens the job'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(() => window.tfi.go('jobs'));
    const before = await jobIds(page);
    const file = await demoFile(page, (d) => { d.job.indications[0].mflPct = 130; d.job.tank.diameter = String(d.job.tank.diameter); });
    await page.setInputFiles('input[data-act="job-import"]', file);
    await page.waitForSelector('#confirmDlg[open]');
    const msg = await page.textContent('#confirmDlg');
    assert.match(msg, /tk-import\.json has 2 things to check/);
    assert.match(msg, /MFL % is 130 — expected 0 to 100/);
    assert.match(msg, /Diameter was stored as the text/);
    await page.click('#confirmDlg [data-cf="cancel"]');
    await page.waitForTimeout(300);
    assert.deepEqual(await jobIds(page), before);
    await page.setInputFiles('input[data-act="job-import"]', file);
    await page.waitForSelector('#confirmDlg[open]');
    await page.click('#confirmDlg [data-cf="open"]');
    await page.waitForFunction(() => window.tfi.job()?.id === 'imported-job');
    const stored = await page.evaluate(() => ({ mfl: window.tfi.job().indications[0].mflPct, d: window.tfi.job().tank.diameter }));
    assert.equal(stored.mfl, 130);
    assert.equal(typeof stored.d, 'number', 'diameter stored as a number');
    assert.deepEqual(await importRecords(page), [['cancelled', 0, 2], ['opened', 0, 2]]);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'duplicates: importing the same file twice changes nothing, and the second time says so'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    // let the start-up tasks finish first (baseline revisions are added a moment after the app opens)
    await page.evaluate(async () => { const { db } = await import('./js/db.js'); for (let i = 0; i < 100 && !(await db.getMeta('baseline:v4')); i++) await new Promise((r) => setTimeout(r, 100)); });
    await page.evaluate(() => window.tfi.go('jobs'));
    const file = await demoFile(page);
    await page.setInputFiles('input[data-act="job-import"]', file);
    await page.waitForFunction(() => window.tfi.job()?.id === 'imported-job');
    await page.waitForTimeout(800); // the open job settles (its card is written)
    await page.evaluate(() => window.tfi.go('jobs'));
    const before = await storeSnapshot(page);
    await page.setInputFiles('input[data-act="job-import"]', file);
    await page.waitForSelector('#confirmDlg[open]');
    const msg = await page.textContent('#confirmDlg');
    assert.match(msg, /tk-import\.json is already on this device: “TK-IMPORT” here has the same data and photos, so there is nothing to import\. You opened this file on this device before/);
    await page.click('#confirmDlg [data-cf="ok"]');
    await page.waitForTimeout(400);
    const after = await storeSnapshot(page);
    for (const k of Object.keys(before)) assert.equal(after[k], before[k], `store ${k} changed`);
    assert.deepEqual(await importRecords(page), [['opened', 0, 0], ['already-on-device', 0, 0]]);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'duplicates: the same tank and inspection date under another id is flagged; each choice does what it says'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const deviceId = await page.evaluate(() => window.tfi.job().id);
    await page.evaluate(() => window.tfi.go('jobs'));
    const file = await demoFile(page, (d) => { d.job.info.tankId = 'TK-101'; });
    const ask = async (choice) => {
      await page.evaluate(() => window.tfi.go('jobs'));
      await page.setInputFiles('input[data-act="job-import"]', file);
      await page.waitForSelector('#confirmDlg[open]');
      const msg = await page.textContent('#confirmDlg');
      await page.click(`#confirmDlg [data-cf="${choice}"]`);
      await page.waitForTimeout(500);
      return msg;
    };
    const msg = await ask('cancel');
    assert.match(msg, /tk-import\.json may be an inspection that is already on this device\. This job has the same tank and inspection date, but it is a separate job:.*TK-101 — Demo Energy Ltd\., Example Terminal — inspection/s);
    assert.deepEqual(await jobIds(page), [deviceId]);
    await ask('existing');
    assert.equal(await page.evaluate(() => window.tfi.job().id), deviceId);
    assert.deepEqual(await jobIds(page), [deviceId]);
    await ask('import');
    await page.waitForFunction(() => window.tfi.job()?.id === 'imported-job');
    assert.deepEqual(await jobIds(page), [deviceId, 'imported-job'].sort());
    assert.deepEqual((await importRecords(page)).map((r) => r[0]), ['cancelled', 'opened-existing', 'added-separately']);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'duplicates: a different version of a job on this device goes to Replace / Keep both; Replace keeps a revision first'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const id = await page.evaluate(() => window.tfi.job().id);
    await page.evaluate(() => window.tfi.go('jobs'));
    const file = await demoFile(page, (d) => { d.job.id = id; d.job.info.tankId = 'TK-101'; d.job.info.client = 'Edited elsewhere'; });
    await page.setInputFiles('input[data-act="job-import"]', file);
    await page.waitForSelector('#confirmDlg[open]');
    assert.match(await page.textContent('#confirmDlg'), /is already on this device\.\s*File:/);
    await page.click('#confirmDlg [data-cf="yes"]');
    await page.waitForFunction(() => window.tfi.job()?.info.client === 'Edited elsewhere');
    const revs = JSON.parse((await storeSnapshot(page)).revisions).filter((r) => r.jobId === id);
    assert.ok(revs.some((r) => r.reason === 'before-replace' && r.job.info.client === 'Demo Energy Ltd.' && /tk-import\.json/.test(r.note)), 'device copy kept as a revision');
    assert.deepEqual(await importRecords(page), [['replaced', 0, 0]]);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'revisions: edits, stage changes, file saves and imports each add a revision; the Revisions screen lists them'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const id = await page.evaluate(() => window.tfi.job().id);
    await page.evaluate(() => window.tfi.go('setup'));
    await page.fill('input[data-bind="info.client"]', 'Edited today'); await page.press('input[data-bind="info.client"]', 'Tab');
    await page.selectOption('select[data-bind="status.stage"]', 'reporting');
    await page.waitForTimeout(600);
    await page.evaluate(() => { delete Window.prototype.showSaveFilePicker; delete window.showSaveFilePicker; });
    const [d] = await Promise.all([page.waitForEvent('download'), page.click('#saveFileBtn')]);
    await page.waitForTimeout(600);
    const { readFile } = await import('node:fs/promises');
    const file = { name: 'again.json', mimeType: 'application/json', buffer: Buffer.from((await readFile(await d.path(), 'utf8')).replace('"Edited today"', '"Edited in the file"')) };
    await page.evaluate(() => window.tfi.go('jobs'));
    await page.setInputFiles('input[data-act="job-import"]', file);
    await page.waitForSelector('#confirmDlg[open]'); await page.click('#confirmDlg [data-cf="yes"]');
    await page.waitForFunction(() => window.tfi.job()?.info.client === 'Edited in the file');
    // let the import finish (its last step records the 'import' revision and redraws) before moving on
    await page.evaluate(async (jid) => { const { db } = await import('./js/db.js'); for (let i = 0; i < 100; i++) { if ((await db.jobRevisions(jid)).some((r) => r.reason === 'import')) return; await new Promise((r) => setTimeout(r, 50)); } }, id);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.tfi.go('revs'));
    await page.waitForSelector('#revList table');
    const rows = await page.$$eval('#revList tbody tr', (trs) => trs.map((tr) => tr.children[3].textContent + ' | ' + tr.children[6].textContent));
    const has = (re) => rows.some((r) => re.test(r));
    for (const re of [/Daily checkpoint/, /Stage changed.*Upcoming → Reporting/, /Saved to a file.*Rev 1/, /Before being replaced/, /Opened from a file.*again\.json/]) assert.ok(has(re), `${re} in\n${rows.join('\n')}`);
    assert.ok(rows.every((r) => /✓/.test(r)), 'every checksum matches');
    // the checkpoint holds the job as it was before the day's first change
    const cp = await page.evaluate(async (jid) => (await (await import('./js/db.js')).db.jobRevisions(jid)).find((r) => r.reason === 'checkpoint').job.info.client, id);
    assert.equal(cp, 'Demo Energy Ltd.');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'revisions: compare, report, and restore — a restored revision equals the original by content checksum'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(() => window.tfi.go('setup'));
    await page.selectOption('select[data-bind="status.stage"]', 'inspection'); // revision: client still "Demo Energy Ltd."
    await page.waitForTimeout(400);
    await page.fill('input[data-bind="info.client"]', 'Changed later'); await page.press('input[data-bind="info.client"]', 'Tab');
    await page.waitForTimeout(600);
    await page.evaluate(() => window.tfi.go('revs'));
    await page.waitForSelector('#revList table');
    const n = await page.$eval('#revList tbody tr:has-text("Stage changed")', (tr) => +tr.dataset.n);
    // compare with now
    await page.check(`[data-revpick="${n}"]`);
    await page.click('#revCompare');
    await page.waitForSelector('#revDiff:not([hidden]) table');
    assert.match(await page.textContent('#revDiff'), /client.*Demo Energy Ltd\..*Changed later/s);
    // its report, read-only
    await page.click(`[data-act="rev-report"][data-n="${n}"]`);
    await page.waitForSelector('#dlg[open] .rev-report .report');
    assert.match(await page.textContent('#dlg .rev-report'), /Demo Energy Ltd\./);
    await page.click('#dlg [data-rv="close"]');
    // restore it
    const revBefore = await page.evaluate(() => window.tfi.job().rev || 0);
    await page.click(`[data-act="rev-restore"][data-n="${n}"]`);
    await page.click('#confirmDlg [data-cf="yes"]');
    await page.waitForFunction(() => window.tfi.job().info.client === 'Demo Energy Ltd.');
    const r = await page.evaluate(async (n) => {
      const { contentHash } = await import('./js/app/revisions.js'), { db } = await import('./js/db.js');
      const job = window.tfi.job();
      let revs = [];
      for (let i = 0; i < 100 && !revs.some((x) => x.reason === 'restore'); i++) { revs = await db.jobRevisions(job.id); if (!revs.some((x) => x.reason === 'restore')) await new Promise((res) => setTimeout(res, 50)); }
      const orig = revs.find((x) => x.n === n);
      return { same: (await contentHash(job)) === (await contentHash(orig.job)), stored: (await contentHash(await db.getJob(job.id))) === (await contentHash(orig.job)), reasons: revs.map((x) => x.reason), kept: revs.find((x) => x.reason === 'before-replace' && x.note.includes('revision ' + n))?.job.info.client, rev: job.rev || 0 };
    }, n);
    assert.ok(r.same && r.stored, 'restored content equals the revision by checksum (on screen and on the device)');
    assert.equal(r.kept, 'Changed later', 'the job as it was is kept as a revision first');
    assert.ok(r.reasons.includes('restore'));
    assert.equal(r.rev, revBefore, 'the file revision number is not taken back');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'complete lock: Complete freezes the report, locks the job, and Reopen asks for a reason'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(() => window.tfi.go('setup'));
    await page.selectOption('select[data-bind="status.stage"]', 'complete');
    await page.waitForSelector('#jobTitle [data-act="reopen"]');
    await page.waitForFunction(() => window.tfi.job().issued);
    await page.waitForTimeout(300);
    const iss = await page.evaluate(async () => {
      const { db } = await import('./js/db.js'), { sha256 } = await import('./js/util.js');
      const j = window.tfi.job(), r = await db.getRevision(`${j.id}:${j.issued?.n}`);
      return { issued: j.issued, reason: r?.reason, note: r?.note, hashOk: r && (await sha256(r.issued.html)) === r.issued.hash, hasReport: /class="report/.test(r?.issued.html || ''), stored: (await db.getJob(j.id)).issued?.n };
    });
    assert.equal(iss.reason, 'issued'); assert.match(iss.note, /→ Complete: report issued/);
    assert.ok(iss.hashOk && iss.hasReport, 'the frozen report is stored with a matching checksum');
    assert.equal(iss.stored, iss.issued.n, 'job.issued is saved on the device');
    // locked: job fields disabled, the stage field and navigation are not
    await page.waitForFunction(() => document.querySelector('input[data-bind="info.client"]')?.disabled);
    assert.equal(await page.$eval('select[data-bind="status.stage"]', (e) => e.disabled), false);
    // a change that gets past the disabled field is refused and put back
    await page.evaluate(() => { const el = document.querySelector('input[data-bind="info.client"]'); el.disabled = false; el.value = 'Sneaky'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.tfi.job().info.client), 'Demo Energy Ltd.');
    assert.equal(await page.$eval('input[data-bind="info.client"]', (e) => e.value), 'Demo Energy Ltd.');
    // the save backstop: a change made straight to the job is not saved, and the stored job comes back
    await page.evaluate(async () => { const { commit, flushSave } = await import('./js/app/persist.js'); window.tfi.job().info.client = 'Behind the screens'; commit(); await flushSave(); });
    await page.waitForFunction(() => window.tfi.job().info.client === 'Demo Energy Ltd.');
    assert.equal(await page.evaluate(async () => (await (await import('./js/db.js')).db.getJob(window.tfi.job().id)).info.client), 'Demo Energy Ltd.');
    // the map: select only
    await page.evaluate(() => window.tfi.go('map'));
    await page.waitForSelector('[data-act="mode"][data-mode="add"]');
    await page.evaluate(() => document.querySelector('[data-act="mode"][data-mode="add"]').click());
    assert.equal(await page.evaluate(() => window.__app.mode), 'select');
    // the Report shows the issued report
    await page.evaluate(() => window.tfi.go('report'));
    await page.waitForSelector('#issuedBar');
    const bar = await page.textContent('#issuedBar');
    assert.match(bar, /Issued report.*checksum ✓/s); assert.doesNotMatch(bar, /different report/);
    assert.ok(await page.$('#issuedReport .report'));
    // Reopen: cancel keeps it locked; a reason is required
    await page.click('#jobTitle [data-act="reopen"]');
    await page.waitForSelector('#confirmDlg[open] #askText');
    assert.equal(await page.$eval('#confirmDlg [data-cf="yes"]', (b) => b.disabled), true);
    await page.click('#confirmDlg [data-cf="no"]');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.tfi.job().status.stage), 'complete');
    await page.click('#jobTitle [data-act="reopen"]');
    await page.fill('#askText', 'Client asked for nozzle readings');
    await page.click('#confirmDlg [data-cf="yes"]');
    await page.waitForFunction(() => window.tfi.job().status.stage === 'review');
    const after = await page.evaluate(async () => {
      const { db } = await import('./js/db.js'), j = window.tfi.job();
      for (let i = 0; i < 60; i++) { const revs = await db.jobRevisions(j.id); const r = revs.find((x) => x.reason === 'stage' && /Reopened/.test(x.note)); if (r) return { note: r.note, hist: j.status.history.at(-1) }; await new Promise((res) => setTimeout(res, 50)); }
      return null;
    });
    assert.match(after.note, /Complete → Peer review.*Reopened: Client asked for nozzle readings/);
    assert.equal(after.hist.reason, 'Client asked for nozzle readings');
    assert.equal(await page.$('#jobTitle [data-act="reopen"]'), null);
    await page.evaluate(() => window.tfi.go('setup'));
    await page.waitForSelector('input[data-bind="info.client"]');
    assert.equal(await page.$eval('input[data-bind="info.client"]', (e) => e.disabled), false, 'unlocked after reopening');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'complete lock: the Report flags a report this version would produce differently, and compares them'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    await page.evaluate(() => window.tfi.go('setup'));
    await page.selectOption('select[data-bind="status.stage"]', 'complete');
    await page.waitForFunction(() => window.tfi.job().issued);
    await page.waitForTimeout(300);
    // pretend the report was issued by an older version that printed it differently
    await page.evaluate(async () => {
      const { db } = await import('./js/db.js'), { sha256 } = await import('./js/util.js'), j = window.tfi.job();
      const r = await db.getRevision(`${j.id}:${j.issued.n}`);
      r.issued.html = r.issued.html.replace('Demo Energy Ltd.', 'Demo Energy Limited'); r.issued.hash = await sha256(r.issued.html);
      await new Promise((res, rej) => { const q = indexedDB.open('tank-floor-inspector'); q.onsuccess = () => { const t = q.result.transaction('revisions', 'readwrite'); t.objectStore('revisions').put(r); t.oncomplete = () => { q.result.close(); res(); }; t.onerror = rej; }; });
    });
    await page.evaluate(() => window.tfi.go('report'));
    await page.waitForSelector('#issuedBar.differs');
    assert.match(await page.textContent('#issuedBar'), /different report/);
    assert.match(await page.textContent('#issuedReport'), /Demo Energy Limited/, 'the issued report is shown as issued');
    await page.click('[data-act="rev-issued-cmp"]');
    await page.waitForSelector('#dlg[open] .issued-cmp');
    const cols = await page.$$eval('#dlg .issued-cmp > div', (d) => d.map((x) => x.textContent));
    assert.match(cols[0], /Demo Energy Limited/); assert.match(cols[1], /Demo Energy Ltd\./);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

  async 'complete lock: the Dashboard issues a stored job at Complete and asks why when it is moved back'({ browser, url, appPage }) {
    const page = await appPage(browser, url);
    const id = await page.evaluate(() => window.tfi.job().id);
    // put the job away, so the Dashboard changes the stored copy (as for a job that isn't open)
    await page.evaluate(async () => { const { flushSave, recompute } = await import('./js/app/persist.js'); await flushSave(); window.__app.job = null; window.__app.photos = []; recompute(); window.tfi.go('dash'); });
    assert.equal(await page.evaluate(() => window.tfi.job()), null, 'no job open');
    const sel = `select[data-stage-of="${id}"]`;
    await page.waitForSelector(sel);
    await page.selectOption(sel, 'complete');
    const iss = await page.evaluate(async (id) => { const { db } = await import('./js/db.js'); for (let i = 0; i < 60; i++) { const j = await db.getJob(id); if (j.issued) { const r = await db.getRevision(`${id}:${j.issued.n}`); return { reason: r.reason, html: !!r.issued?.html }; } await new Promise((res) => setTimeout(res, 50)); } return null; }, id);
    assert.deepEqual(iss, { reason: 'issued', html: true });
    await page.waitForSelector(sel);
    await page.selectOption(sel, 'reporting');
    await page.waitForSelector('#confirmDlg[open] #askText');
    await page.click('#confirmDlg [data-cf="no"]');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(async (id) => (await (await import('./js/db.js')).db.getJob(id)).status.stage, id), 'complete', 'cancelled: still Complete');
    assert.equal(await page.$eval(sel, (e) => e.value), 'complete', 'the board shows it unchanged');
    await page.selectOption(sel, 'reporting');
    await page.fill('#askText', 'Typo in the client name');
    await page.click('#confirmDlg [data-cf="yes"]');
    await page.waitForFunction(async (id) => (await (await import('./js/db.js')).db.getJob(id)).status.stage === 'reporting', id);
    assert.equal(await page.evaluate(async (id) => (await (await import('./js/db.js')).db.getJob(id)).status.history.at(-1).reason, id), 'Typo in the client name');
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },

};

/** In the page: create the v3.6.0 database (version 3) with two jobs, a photo, a tank and their cards. Returns the stores. */
async function seedV3(job) {
  const lite = (j) => { const { indications, plates, features, shell, roof, settle, ...rest } = j; return { ...rest, nInds: (indications || []).length }; };
  const db = await new Promise((res) => { const q = indexedDB.open('tank-floor-inspector', 3); q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('jobs', { keyPath: 'id' }); d.createObjectStore('photos', { keyPath: 'id' }).createIndex('jobId', 'jobId'); d.createObjectStore('meta', { keyPath: 'key' }); d.createObjectStore('tanks', { keyPath: 'id' }); d.createObjectStore('cards', { keyPath: 'id' }); }; q.onsuccess = () => res(q.result); });
  const a = { ...job, id: 'demo-a' }, b = { ...job, id: 'demo-b', info: { ...job.info, tankId: 'TK-202' } };
  await new Promise((res) => { const t = db.transaction(['jobs', 'photos', 'tanks', 'cards'], 'readwrite'); for (const j of [a, b]) { t.objectStore('jobs').put(j); t.objectStore('cards').put(lite(j)); } t.objectStore('photos').put({ id: 'p1', jobId: 'demo-a', indId: null, caption: 'x', dataUrl: 'data:image/png;base64,AA==' }); t.objectStore('tanks').put({ id: 't1', kind: 'tank', info: { tankId: 'TK-101' } }); t.oncomplete = res; });
  db.close();
}
/** In the page: every record of the main stores, the version, new stores and the migration log. */
async function dumpStores() {
  const db = await new Promise((res) => { const q = indexedDB.open('tank-floor-inspector'); q.onsuccess = () => res(q.result); });
  const all = (n) => new Promise((res) => { const r = db.transaction(n).objectStore(n).getAll(); r.onsuccess = () => res(r.result.sort((x, y) => String(x.id).localeCompare(String(y.id)))); });
  const out = { version: db.version, newStores: [...db.objectStoreNames].filter((n) => ['revisions', 'audit', 'imports'].includes(n)).sort() };
  for (const n of ['jobs', 'photos', 'tanks', 'cards']) out[n] = await all(n);
  const m = await new Promise((res) => { const r = db.transaction('meta').objectStore('meta').get('migrations'); r.onsuccess = () => res(r.result?.value || []); });
  out.migrations = m; db.close();
  return out;
}

/** In the page: give the open job a real file (Origin Private File System) as its job file, and window.__file() to read it. */
async function linkTestFile() {
  const { db } = await import('./js/db.js');
  const dir = await navigator.storage.getDirectory();
  const hnd = await dir.getFileHandle('job-' + Math.random().toString(36).slice(2) + '.json', { create: true });
  // keep file handles in memory: reading a handle back from IndexedDB crashes headless Chrome
  const handles = new Map(), get = db.getMeta.bind(db), set = db.setMeta.bind(db);
  db.getMeta = async (k) => (k.startsWith('fh:') ? handles.get(k) : get(k));
  db.setMeta = async (k, v) => (k.startsWith('fh:') ? handles.set(k, v) : set(k, v));
  await db.setMeta('fh:' + window.tfi.job().id, hnd);
  window.__file = async () => JSON.parse(await (await hnd.getFile()).text());
}
