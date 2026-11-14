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
      await new Promise((r) => setTimeout(r, 300));
      const { db } = await import('./js/db.js');
      return (await db.getJob(window.tfi.job().id)).info.client;
    });
    assert.equal(saved, 'Typed then app switched');
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
  }
};
