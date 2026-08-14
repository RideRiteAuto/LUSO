
const CURRENT_CACHE = "navora-world-48291-2db448a586fb";
const CACHE_PREFIX = "navora-world-";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== CURRENT_CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.endsWith("/index.html") || url.pathname.endsWith("/preload-manifest.json") || url.pathname.endsWith("/navora-cache-worker.js")) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.open(CURRENT_CACHE).then(cache => cache.match(event.request, { ignoreSearch: true }));
    return cached || fetch(event.request);
  })());
});
