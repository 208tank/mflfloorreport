// Service worker: cache-first app shell so the app runs fully offline.
// Bump CACHE when you publish changes so installed copies update.
const CACHE = 'tank-floor-v3.33.0';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/db.js', './js/units.js', './js/geometry.js', './js/calc.js', './js/map.js',
  './js/export.js', './js/report.js', './js/report/frame.js', './js/report/front.js', './js/report/floor.js', './js/report/calcapp.js', './js/report/small.js', './js/model.js', './js/demo.js', './js/builder.js', './js/shell.js', './js/roof.js', './js/xlsx.js', './js/loader.js', './js/seal.js', './js/settle.js', './js/tables.js', './js/design.js', './js/sections.js', './js/patches.js', './js/registry.js', './js/equipment.js', './js/personnel.js', './js/sources.js', './js/small.js', './js/smallcalc.js', './js/util.js', './js/ui.js', './js/cards.js', './js/migrations.js', './js/saver.js', './js/journal.js', './js/integrity.js', './js/backup.js', './js/validate.js', './js/issuedfile.js', './js/audit.js', './js/prune.js', './js/duplicates.js', './js/revdiff.js', './js/app/state.js', './js/app/fields.js', './js/app/nav.js', './js/app/actions.js',
  './js/views/codetables.js',
  './js/views/report.js', './js/views/r2fields.js', './js/views/small.js',
  './js/views/settle.js',
  './js/views/roof.js',
  './js/views/shell.js',
  './js/views/nozzles.js',
  './js/views/history.js',
  './js/views/dashboard.js',
  './js/views/registry.js',
  './js/views/sections.js',
  './js/views/summary.js',
  './js/views/setup.js',
  './js/views/floorlists.js',
  './js/views/api.js',
  './js/views/floormap.js',
  './js/views/files.js',
  './js/views/jobs.js',
  './js/views/backup.js',
  './js/views/revisions.js',
  './js/views/audit.js',
  './js/views/loaderpreview.js',
  './js/views/storage.js',
  './js/app/persist.js',
  './js/app/revisions.js',
  './js/app/stage.js',
  './js/app/auditlog.js',
  './js/app/lock.js',
  './js/app/menu.js',
  './js/app/header.js',
  './js/app/folder.js',
  './js/app/images.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser's HTTP cache, so a new release never stores files left over
  // from the previous one (GitHub Pages lets browsers keep files for up to 10 minutes).
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tank-floor-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    })
  );
});
