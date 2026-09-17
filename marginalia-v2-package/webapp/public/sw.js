const CACHE = 'marginalia-page-v1';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch('/index.html', { cache: 'reload' });
    if (!response.ok) throw new Error('Reading page unavailable.');
    const html = await response.clone().text();
    const assets = Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g), match => match[1]);
    await cache.put('/index.html', response);
    await cache.addAll(assets);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const document = url.pathname === '/' || url.pathname === '/index.html';
  if (!document && !url.pathname.startsWith('/assets/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = document ? '/index.html' : event.request;
    if (!document) { const cached = await cache.match(key); if (cached) return cached; }
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(key, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(key);
      if (cached) return cached;
      throw error;
    }
  })());
});
