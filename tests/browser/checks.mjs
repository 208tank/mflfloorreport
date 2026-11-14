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
      return JSON.stringify({ format: 'tank-floor-inspector', version: 1, rev: 1, job, photos: await db.jobPhotos(id) });
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
    const r = await b.evaluate(async (jid) => { const { db } = await import('./js/db.js'); const revs = await db.jobRevisions(jid); return { client: (await db.getJob(jid)).info.client, open: window.tfi.job().info.client, rev: revs.at(-1)?.reason, prevClient: revs.at(-1)?.job.info.client, journal: Object.keys(localStorage).filter((k) => k.startsWith('tfi-journal:')) }; }, id);
    assert.equal(r.client, 'Recovered client');
    assert.equal(r.open, 'Recovered client');
    assert.equal(r.rev, 'before-replace', 'the device copy before recovery is kept as a revision');
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
  }
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
