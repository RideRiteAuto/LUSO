const CACHE_PREFIX = "navora-world-";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith((async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX));
    for (const name of names) {
      const cached = await caches.open(name).then((cache) => cache.match(event.request, { ignoreSearch: true }));
      if (cached) return cached;
    }
    return fetch(event.request);
  })());
});
