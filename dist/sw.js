const cacheName = 'expand-shell-v15';
const shell = [
  './', './index.html', './style.css?v=15', './theme.js?v=14', './sync.js?v=14', './app.js?v=14', './conversations.js?v=14', './db.js', './seed.js', './backup.js?v=14',
  './manifest.webmanifest', './assets/icon-192.png', './assets/icon-512.png',
  './assets/fraunces.ttf', './assets/instrument.ttf', './assets/fflate.js',
];
const local = new Set(shell.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('expand-shell-') && name !== cacheName)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate' && local.has(event.request.url)) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match('./index.html')));
  } else if (local.has(event.request.url)) {
    event.respondWith(caches.open(cacheName).then(async cache => await cache.match(event.request) ?? fetch(event.request)));
  }
});
