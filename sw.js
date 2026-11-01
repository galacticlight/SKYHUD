// SKYHUD service worker: caches only this site's own files so the astronomy works offline.
// Third-party API responses are never cached here; the app keeps its own short-lived copies and
// labels them with their fetch time.
const CACHE = "skyhud-v17";
const ASSETS = [
  "./", "index.html", "styles.css", "favicon.svg", "icons/maskable-192.png", "icons/maskable-512.png", "manifest.webmanifest", "404.html",
  "vendor/astronomy.browser.min.js", "vendor/satellite.min.js",
  "js/boot.js", "js/theme.js", "js/app.js", "js/early.js", "js/space.js", "js/launches.js", "js/tracker.js", "js/launchdata.js", "js/dsn.js", "js/share.js", "js/astro.js", "js/chart.js", "js/feeds.js", "js/score.js", "js/showers.js", "js/sat-worker.js", "js/util.js", "js/live.js", "js/map.js", "js/svgviz.js", "data/coast110.json", "data/dsn-spacecraft.json",
  "data/sky.json", "data/events.json", "catalog.tle",
];
self.addEventListener("install", (e) => {
  e.waitUntil(// cache: "reload" so a fresh install never copies stale files out of the HTTP cache (hosts like
  // GitHub Pages send max-age=600), which would pair a new app.js with an old feeds.js.
  caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  // Delete only our own old caches; other apps on the same origin (e.g. other github.io project pages) keep theirs.
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("skyhud-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return; // never touch API calls
  // network-first so updates arrive promptly; fall back to cache offline. cache: "no-cache" revalidates
  // with the server so a max-age HTTP cache entry cannot serve an old module after an upgrade.
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then((res) => {
      if (res.ok && !url.search) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => {
      const nav = e.request.mode === "navigate";
      // Only page navigations fall back to the app shell; a missing file or data request fails as a
      // network error instead of getting HTML with a 200.
      return caches.match(e.request, { ignoreSearch: nav }).then((r) => r || (nav ? caches.match("index.html") : Response.error()));
    }),
  );
});
