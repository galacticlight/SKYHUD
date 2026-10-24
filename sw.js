// SKYHUD service worker: caches only this site's own files so the astronomy works offline.
// Third-party API responses are never cached here; the app keeps its own short-lived copies and
// labels them with their fetch time.
const CACHE = "skyhud-v2";
const ASSETS = [
  "./", "index.html", "styles.css", "favicon.svg", "manifest.webmanifest", "404.html",
  "vendor/astronomy.browser.min.js", "vendor/satellite.min.js",
  "js/app.js", "js/astro.js", "js/chart.js", "js/feeds.js", "js/score.js", "js/showers.js", "js/sat-worker.js",
  "data/sky.json", "data/events.json", "catalog.tle",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return; // never touch API calls
  // network-first so updates arrive promptly; fall back to cache offline
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))),
  );
});
