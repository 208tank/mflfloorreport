// Tank Floor Inspector — entry point (refactoring step 15).
// Loads every screen module (each registers its screens and buttons with js/app/nav.js and js/app/actions.js),
// wires the core modules together, binds job fields, listens to window events and starts the app.
// Layers: app.js → js/views/* (screens) → js/app/* (core) → js/*.js (calculations, data, files).
import { APP_VERSION, S } from './app/state.js';
import { readInput, rerenderKeep } from './app/fields.js';
import { configureNav, go, renderAll, renderView } from './app/nav.js';
import { onChange } from './app/actions.js';
import { appReload, commit, configurePersist, flushNow, flushSave, journal, loadJobs, loadTanks, recompute, saver } from './app/persist.js';
import { renderHeader, showFileState } from './app/header.js';
import { writeStageToFile } from './app/folder.js';
import { changeStage } from './app/stage.js';
import { measuredFromDrawing, rowsFromGrid } from './builder.js';
import { db, dbConfig } from './db.js';
import { setPath } from './model.js';
import { editionsFor, supplementsFor } from './tables.js';
import { $, toast } from './ui.js';
import { esc as h } from './util.js';
import { refreshApi } from './views/api.js';
import { autoBackupIfDue, loadBackupState } from './views/backup.js';
import { remindBackup } from './views/storage.js';
import { drawMap } from './views/floormap.js';
import { baselineRevisions, recoverAfterCrash, runIntegrity } from './views/history.js';
import { openJob } from './views/jobs.js';
import { nozzleTableHTML } from './views/nozzles.js';
import { refreshRoof } from './views/roof.js';
import { crumbHTML } from './views/sections.js';
import { refreshSettle } from './views/settle.js';
import { refreshBuilder, refreshSetupPreview, relocateOrphans } from './views/setup.js';
import { refreshShell, shellBuildHTML } from './views/shell.js';
import { refreshSmall, refreshTemplateCard } from './views/small.js';
import { refreshFloorUT } from './views/floorut.js';
import './app/menu.js';
import './app/lock.js';
import './views/codetables.js';
import './views/report.js';
import './views/dashboard.js';
import './views/registry.js';
import './views/summary.js';
import './views/revisions.js';
import './views/audit.js';
import './views/loaderpreview.js';
import './views/guide.js';

/* Test hooks (window.tfi is used by the automated tests; window.__app is handy in the console). */
window.tfi = { go: (v) => go(v), zoom: (x, y, r) => { S.mapCtl?.focus(x, y, r); drawMap(); }, job: () => S.job, commit: () => { commit(); renderView(); } }; // used by the automated tests
window.__app = S; // handy for debugging in the console

/* Wiring: how saving and navigation update the header, what leaving registry editing does, and the section breadcrumb. */
configurePersist({ header: () => renderHeader(), fileState: () => showFileState() });
configureNav({
  header: () => renderHeader(),
  leaveRegistry: () => { if (saver.pending()) flushSave(); S.job = null; recompute(); S.photos = []; },
  crumb: (pl) => crumbHTML(pl)
});

/* Job fields (data-bind): set the value, recalculate and save, then refresh whichever screen is showing. */
onChange([
  { order: 10, when: (el, act) => el.matches('[data-bind]'), run: async (el, e, act) => {
    {
    const path = el.dataset.bind;
    let v = readInput(el);
    if (path === 'status.stage') { // stage 8b: revisions, the frozen report at Complete, a reason to reopen
      if (await changeStage(S.job, v)) { writeStageToFile(S.job.id, v); renderAll(); } else el.value = S.job.status?.stage || '';
      return;
    }
    if (el.dataset.num) v = +v;
    if (path === 'layout.annN' && v !== null) v = Math.max(1, Math.round(v));
    const before = S.layout;
    if (path === 'layout.mode' && v === 'measured' && !(S.job.layout.mrows || []).length) S.job.layout.mrows = measuredFromDrawing(S.job);
    setPath(S.job, path, v);
    if (path === 'layout.mode' && v === 'custom' && !(S.job.layout.rows || []).length) { recompute(); S.job.layout.rows = rowsFromGrid(S.job); }
    commit();
    if (path === 'template' || path === 'small.title') { renderAll(); return; } // schema 6: the menu and setup card change with the template
    if (path.startsWith('layout.') || path === 'tank.diameter') relocateOrphans(before);
    if (path === 'tank.diameter') refreshTemplateCard();
    if (path === 'tank.code' && !editionsFor(v || 'Unknown').includes(S.job.tank.edition)) { S.job.tank.edition = ''; S.job.tank.supp = ''; }
    if (path === 'tank.edition' && !supplementsFor(v).includes(S.job.tank.supp)) S.job.tank.supp = '';
    const structural = path === 'tank.code' || path === 'tank.edition' || path === 'units' || path === 'layout.annular' || path === 'layout.scheme' || path === 'layout.orient' || path === 'layout.refCorner' || path === 'layout.mode';
    if (S.view === 'setup' && !structural && (path === 'tank.diameter' || path === 'info.zeroRef')) { const sb = $('#shellBuild'), nc = $('#nozzleCard'); setTimeout(() => { if (sb) rerenderKeep(sb, shellBuildHTML()); if (nc) rerenderKeep(nc, nozzleTableHTML(true)); }, 0); }
    if (S.view === 'setup') { if (structural) renderView(); else if (S.job.layout.mode !== 'grid' && path.startsWith('layout.')) refreshBuilder(); else refreshSetupPreview(); renderHeader(); }
    else if (S.view === 'api') refreshApi();
    else if (S.view === 'shell') refreshShell();
    else if (['roofF', 'roofL', 'seal'].includes(S.view)) refreshRoof();
    else if (S.view === 'settle') { if (path === 'settle.eu') renderView(); else refreshSettle(); }
    else if (S.view === 'report' && (path.startsWith('docctl.') || path === 'status.reviewer')) renderView();
    else if (S.view === 'flut') refreshFloorUT();
    else if (S.view === 'small') { if (el.tagName === 'SELECT') renderView(); else refreshSmall(); } // S2: results follow the readings
    if (path === 'units') renderAll();
    return;
  }
  } },
]);

/* Window events: database upgrade blocked, install prompt, online / offline, save on hide or close, printing. */
window.addEventListener('tfi-db-blocked', () => toast('Close any other Tank Floor Inspector windows or tabs to finish updating the app.'));
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; renderHeader(); });
window.addEventListener('online', () => { const n = $('#netState'); if (n) n.textContent = 'Online'; });
window.addEventListener('offline', () => { const n = $('#netState'); if (n) n.textContent = 'Offline'; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
window.addEventListener('pagehide', () => { flushNow(); if (!saver.pending()) journal.end(); });
// Closing while a change is not yet on the device: ask first (the browser shows its own wording).
window.addEventListener('beforeunload', (e) => { flushNow(); if (saver.pending()) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('beforeprint', () => { if (S.view !== 'report' && S.job) { S._prevView = S.view; go('report'); } });
window.addEventListener('afterprint', () => { if (S._prevView) { const v = S._prevView; S._prevView = null; go(v); } });

/* Offline support: the service worker caches the app; a new version offers a reload. */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) { $('#updateBtn').hidden = false; toast('A new version is available.', { label: 'Reload', fn: appReload }); }
      });
    });
  }).catch(() => { /* offline support unavailable */ });
}

/* Start-up */
function dbFailed(e) {
  document.querySelector('#main')?.insertAdjacentHTML('afterbegin', `<section class="card"><h2>The device database could not be opened</h2><p>${h(String(e?.message || e))}</p><p class="muted">If the app was being updated, the update was stopped and your data is unchanged. Close other Tank Floor Inspector windows and reload. If this keeps happening, do not clear the browser data — contact support with this message.</p></section>`);
}

(async function init() {
  dbConfig.appVersion = APP_VERSION;
  try { S.company = (await db.getMeta('company')) || {}; }
  catch (e) { dbFailed(e); return; }
  await loadJobs(); await loadTanks(); await loadBackupState().catch(() => {});
  await recoverAfterCrash().catch((e) => console.warn('Recovery check', e));
  setTimeout(() => baselineRevisions().catch((e) => console.warn('Baseline revisions', e)).then(() => runIntegrity(false, true)).catch((e) => console.warn('Integrity check', e)), 1500);
  setTimeout(() => autoBackupIfDue().catch((e) => console.warn('Automatic backup', e)).then(() => remindBackup()), 4000);
  const last = await db.getMeta('lastJob');
  if (last && S.jobs.some((j) => j.id === last)) await openJob(last, 'dash');
  else go('dash');
})();
