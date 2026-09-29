const CACHE_NAME = "__EDUNOZA_CACHE_NAME__";
const PRECACHE_ASSETS = /* __EDUNOZA_PRECACHE_ASSETS__ */ [];
const ROOT_URL = new URL("./", self.registration.scope);
const ASSET_URLS = new Set(PRECACHE_ASSETS.map((path) => new URL(path, ROOT_URL).href));

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const rootUrl = new URL("./", self.registration.scope);
  const requests = [
    new Request(rootUrl, { cache: "reload" }),
    ...PRECACHE_ASSETS.map(
      (assetPath) => new Request(new URL(assetPath, rootUrl), { cache: "reload" })
    )
  ];
  await cache.addAll(requests);
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith("edunoza-") || key.startsWith("profeplus-")) &&
                key !== CACHE_NAME
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(ROOT_URL.pathname)) return;
  if (request.headers.has("authorization")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match(ROOT_URL)) ??
            new Response("Offline application shell unavailable.", { status: 503 })
          );
        })
    );
    return;
  }

  // Cache only versioned build assets; API responses and query URLs stay on the network.
  if (!ASSET_URLS.has(url.href)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        void cache.put(request, copy).catch(() => {});
      }
      return response;
    })
  );
});
