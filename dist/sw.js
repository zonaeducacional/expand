const release = '__EXPAND_RELEASE__';
const packaged = /^[a-f0-9]{20}$/.test(release);
const cacheName = 'expand-shell-' + (packaged ? release : 'preview-16');
const shell = [
  './', './index.html', './style.css?v=16', './theme.js?v=14', './sync.js?v=18', './app.js?v=18',
  './updates.js', './conversations.js?v=14', './db.js', './seed.js', './backup.js?v=14',
  './manifest.webmanifest', './assets/icon-192.png', './assets/icon-512.png',
  './assets/fraunces.ttf', './assets/instrument.ttf', './assets/fflate.js',
];
const local = new Set(shell.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      await Promise.all([...local].map(async path => {
        const url = new URL(path);
        if (packaged) url.searchParams.set('expand-release', release);
        const response = await fetch(url, { cache: 'reload' });
        if (!response.ok) throw new Error('Falha ao baixar o Expand: ' + url.pathname);
        await cache.put(path, response);
      }));
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
    const names = await caches.keys();
    const hasLegacyWorker = names.some(name => /^expand-shell-v\d+$/.test(name));
    const hasReleaseWorker = names.some(name => name !== cacheName && /^expand-shell-[a-f0-9]{20}$/.test(name));
    // Older installed clients cannot request activation. Bring them onto the new update mechanism.
    if (hasLegacyWorker && !hasReleaseWorker) await self.skipWaiting();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'expand:activate') event.waitUntil(self.skipWaiting());
  if (event.data === 'expand:release') event.ports[0]?.postMessage({ release });
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = (await caches.keys()).filter(name => name.startsWith('expand-shell-') && name !== cacheName);
    await Promise.all(names.slice(0, -1).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const isLocal = local.has(event.request.url);
  if (!isLocal) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    const key = event.request.mode === 'navigate' ? './index.html' : event.request;
    return await cache.match(key) ?? fetch(event.request);
  }));
});
