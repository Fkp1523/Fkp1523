// The Windows app needs its local server for every session. Let the browser
// revalidate the interface there instead of serving an older cached copy.
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cachesToDelete = (await caches.keys()).filter(key => key.startsWith('meu-financeiro-shell-'));
    await Promise.all(cachesToDelete.map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
