// A complete packaged generation is promoted by one pointer write. Private
// helper requests, pairing, jobs and authorization-bearing requests bypass this.
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
function packagedAsset(value, parent) {
  if (!value || /^(?:data:|blob:|#)/i.test(value)) return;
  const url = new URL(value, new URL(parent, origin));
  if (url.origin !== origin || !url.pathname.startsWith('/assets/') || url.search || url.hash) return;
  return url.pathname;
}
function dependencies(text, parent) {
  const values = [];
  const add = value => { const path = packagedAsset(value.startsWith('assets/') ? '/' + value : value, parent); if (path) values.push(path); };
  if (parent === '/index.html') {
    for (const match of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)) add(match[1]);
  } else if (/\.css$/.test(parent)) {
    for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)|@import\s*["']([^"']+)["']/g)) add(match[1] || match[2]);
  } else if (/\.m?js$/.test(parent)) {
    // Static imports/re-exports and literal dynamic imports, not arbitrary prose.
    for (const match of text.matchAll(/\b(?:import|export)\s*(?:[^;"']*?\bfrom\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)) add(match[1] || match[2]);
    // Vite's preload dependency maps contain root-relative packaged paths.
    for (const match of text.matchAll(/["'`]((?:\/)?assets\/[^"'`\s]+)["'`]/g)) add(match[1]);
    for (const match of text.matchAll(/new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g)) add(match[1]);
  }
  return [...new Set(values)];
}
async function fetchPackaged(path) {
  const response = await fetch(new URL(path, origin).href, { cache: 'reload', credentials: 'omit', signal: AbortSignal.timeout(8000) });
  if (!response.ok || response.type === 'opaque' || response.redirected || (response.url && new URL(response.url).origin !== origin)) throw new Error('A packaged asset is unavailable.');
  return response;
}
function promote() {
  if (staging) return staging;
  staging = (async () => {
    const index = await fetchPackaged('/index.html'), html = await index.clone().text();
    const indexDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))), byte => byte.toString(16).padStart(2, '0')).join('');
    for (const name of await generations()) {
      const cache = await caches.open(name), marker = await cache.match(COMPLETE);
      if (marker && (await marker.json()).indexDigest === indexDigest && await cache.match('/index.html')) return name;
    }
    const name = PREFIX + crypto.randomUUID(), cache = await caches.open(name);
    let complete = false;
    try {
      const queue = dependencies(html, '/index.html'), seen = new Set();
      if (!queue.length) throw new Error('No packaged application entry point was found.');
      while (queue.length) {
        const path = queue.shift(); if (seen.has(path)) continue;
        seen.add(path); if (seen.size > 4096) throw new Error('The packaged dependency graph exceeds its bound.');
        const response = await fetchPackaged(path);
        if (/\.(?:m?js|css)$/.test(path)) queue.push(...dependencies(await response.clone().text(), path));
        await cache.put(path, response);
      }
      await cache.put('/index.html', index);
      await cache.put(COMPLETE, new Response(JSON.stringify({ indexDigest })));
      complete = true;
      // Only this write promotes the index, after its complete asset closure.
      await (await caches.open(META)).put(POINTER, new Response(JSON.stringify([name, ...await generations()]), { headers: { 'content-type': 'application/json' } }));
      return name;
    } finally {
      // Never delete a complete generation after an uncertain pointer outcome.
      if (!complete) await caches.delete(name);
    }
  })().finally(() => { staging = undefined; });
  return staging;
}
async function cached(path) {
  const preferred = await generations();
  // An unpromoted index is never used. Old open pages can still request hashed
  // assets from complete generations lost from a racing worker's pointer list.
  const names = path === '/index.html' ? preferred : [...new Set([...preferred, ...(await caches.keys()).filter(name => name.startsWith(PREFIX))])];
  for (const name of names) {
    const cache = await caches.open(name);
    if (!(await cache.match(COMPLETE))) continue;
    const response = await cache.match(path); if (response) return response;
  }
  // Read only legacy packaged assets, never the old potentially incomplete index.
  if (path.startsWith('/assets/') && (await caches.keys()).includes('marginalia-page-v1')) return (await caches.open('marginalia-page-v1')).match(path);
}
self.addEventListener('install', event => { event.waitUntil(promote().then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== origin || request.headers.has('authorization') || url.search || url.hash) return;
  const document = url.pathname === '/' || url.pathname === '/index.html';
  if (!document && !url.pathname.startsWith('/assets/')) return;
  event.respondWith((async () => {
    if (document) {
      try { await promote(); } catch { /* A failed update leaves the old working pointer. */ }
      const index = await cached('/index.html'); if (index) return index;
      throw new Error('No complete offline application is available yet.');
    }
    const asset = await cached(url.pathname);
    return asset ?? fetch(request); // Never mutate a complete generation from a GET.
  })());
});
