const PREFIX = 'meu-financeiro-offline-';
const CACHE = PREFIX + '__CACHE_REVISION__';
const ASSETS = __ASSETS__;
const assetURLs = new Set(ASSETS.map(name => new URL(name, self.registration.scope).href));
const indexURL = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...assetURLs].map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;
  const asset = request.mode === 'navigate' ? indexURL : request.url;
  if (assetURLs.has(asset)) {
    event.respondWith(caches.open(CACHE).then(async cache => await cache.match(asset) || fetch(request)));
  }
});
