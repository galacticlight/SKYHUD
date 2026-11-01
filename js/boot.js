// SKYHUD boot: loads app.js. If that import fails, most often because a service-worker update was caught
// half-way (one module from the old cache, another from the new build), it reloads the page once after the
// new worker has taken over. A sessionStorage guard stops reload loops; offline or after one try, it shows a
// message instead.
export const RELOAD_KEY = "skyhud.bootReload";
export const GUARD_MS = 60e3;

/** Reload only when online and no boot reload happened in this tab in the last GUARD_MS (loop guard). */
export function shouldReload(last, now, online) {
  if (online === false) return false;
  const t = Number(last);
  return !(last != null && Number.isFinite(t) && now - t < GUARD_MS);
}

/** Resolve when a new service worker takes control, or right away if none is on its way (at most `ms`). */
async function newWorker(ms = 8000) {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  await new Promise((done) => {
    const t = setTimeout(done, ms);
    sw.addEventListener("controllerchange", () => { clearTimeout(t); done(); }, { once: true });
    sw.getRegistration().then(async (reg) => {
      if (!reg) return done();
      if (!reg.installing && !reg.waiting) await reg.update().catch(() => {});
      if (!reg.installing && !reg.waiting) done();
    }).catch(done);
  });
}

function giveUp(err) {
  const el = document.getElementById("status");
  if (el) el.textContent = "SKYHUD couldn't load its code (an update may be half-finished, or you're offline). Reload the page to try again.";
  console.warn("SKYHUD boot:", err);
}

if (typeof document !== "undefined") {
  import("./app.js").catch(async (err) => {
    let last = null;
    try { last = sessionStorage.getItem(RELOAD_KEY); } catch { return giveUp(err); }
    if (!shouldReload(last, Date.now(), navigator.onLine)) return giveUp(err);
    try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { return giveUp(err); }
    await newWorker();
    location.reload();
  });
}
