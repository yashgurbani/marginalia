// Only packaged assets. A complete generation is published by one pointer write.
const META = 'marginalia-page-generations-v2';
const POINTER = '/__marginalia_complete_generation__';
const PREFIX = 'marginalia-assets-v2-';
const COMPLETE = '/__marginalia_generation_complete__';
const origin = self.location.origin;
let staging;
async function generations() {
  const response = await (await caches.open(META)).match(POINTER);
  if (!response) return [];
  const value = await response.json();
  return Array.isArray(value) ? value.filter(name => typeof name === 'string' && name.startsWith(PREFIX)) : [];
}
function packaged(value, parent) {
  if (!value || /^(?:data:|blob:|#)/i.test(value)) return;
  const url = new URL(value, new URL(parent, origin));
  if (url.origin === origin && url.pathname.startsWith('/assets/') && !url.search && !url.hash) return url.pathname;
}
function dependencies(text, parent) {
  const values = [];
  for (const match of text.matchAll(/["'`]([^"'`\s]+)["'`]/g)) {
    const value = match[1];
    const path = value.startsWith('/assets/') ? packaged(value, parent) : value.startsWith('assets/') ? packaged('/' + value, parent) : /\.(?:m?js|css|woff2?|ttf|otf|svg|png|jpe?g|webp|gif|ico|wasm)$/.test(value) ? packaged(value, parent) : undefined;
    if (path) values.push(path);
  }
  for (const match of text.matchAll(/url\(\s*([^'"\s)][^\s)]*)\s*\)/g)) { const path = packaged(match[1], parent); if (path) values.push(path); }
  return [...new Set(values)];
}
async function fetchPackaged(path) {
  const response = await fetch(new URL(path, origin).href, { cache: 'reload', credentials: 'omit' });
  if (!response.ok || response.type === 'opaque' || response.redirected || response.url && new URL(response.url).origin !== origin) throw new Error('A packaged asset is unavailable.');
  if (path.startsWith('/assets/') && /text\/html/i.test(response.headers.get('content-type') ?? '')) throw new Error('The server returned a page instead of a packaged asset.');
  return response;
}
function promote() {
  if (staging) return staging;
  staging = (async () => {
    const index = await fetchPackaged('/index.html'), html = await index.clone().text();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))), byte => byte.toString(16).padStart(2, '0')).join('');
    const previous = await generations();
    for (const name of previous) { const cache = await caches.open(name), marker = await cache.match(COMPLETE); if (marker && (await marker.json()).indexDigest === digest && await cache.match('/index.html')) return name; }
    const name = PREFIX + crypto.randomUUID(), cache = await caches.open(name); let published = false;
    try {
      const queue = dependencies(html, '/index.html'), seen = new Set();
      if (!queue.length) throw new Error('No packaged application entry point was found.');
      while (queue.length) {
        const path = queue.shift(); if (seen.has(path)) continue; seen.add(path);
        if (seen.size > 4096) throw new Error('Packaged dependency graph is too large.');
        const response = await fetchPackaged(path);
        if (/\.(?:m?js|css)$/.test(path)) queue.push(...dependencies(await response.clone().text(), path));
        await cache.put(path, response);
      }
      await cache.put('/index.html', index);
      await cache.put(COMPLETE, new Response(JSON.stringify({ indexDigest: digest })));
      const latest = await generations();
      await (await caches.open(META)).put(POINTER, new Response(JSON.stringify([name, ...latest])));
      published = true; return name;
    } finally { if (!published) await caches.delete(name); }
  })().finally(() => { staging = undefined; });
  return staging;
}
async function cached(path) {
  const preferred = await generations();
  const names = [...new Set([...preferred, ...(await caches.keys()).filter(name => name.startsWith(PREFIX))])];
  for (const name of names) { const cache = await caches.open(name); if (!(await cache.match(COMPLETE))) continue; const value = await cache.match(path); if (value) return value; }
  if (path.startsWith('/assets/') && (await caches.keys()).includes('marginalia-page-v1')) return (await caches.open('marginalia-page-v1')).match(path);
}
self.addEventListener('install', event => event.waitUntil(promote().then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== origin || request.headers.has('authorization') || url.search || url.hash) return;
  const document = url.pathname === '/' || url.pathname === '/index.html';
  if (!document && !url.pathname.startsWith('/assets/')) return;
  event.respondWith((async () => {
    if (document) { try { await promote(); } catch {} const index = await cached('/index.html'); if (index) return index; throw new Error('No complete offline page is available yet.'); }
    return await cached(url.pathname) ?? fetch(request);
  })());
});
