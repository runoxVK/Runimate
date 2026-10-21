// Offline support: network first (so updates show up immediately), cache as fallback.
const CACHE = 'runimate-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './icons/icon.svg', './icons/icon-192.png',
  './js/main.js', './js/app.js', './js/model.js', './js/geom.js', './js/rig.js', './js/presets.js', './js/brush.js',
  './js/render.js', './js/tween.js', './js/player.js', './js/stage.js', './js/timeline.js', './js/panels.js',
  './js/shell.js', './js/commands.js', './js/actions.js', './js/library.js', './js/projects.js', './js/storage.js',
  './js/fileio.js', './js/export.js', './js/gif.js', './js/zip.js', './js/ui.js', './vendor/mp4-muxer.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))),
  );
});
