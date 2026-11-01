// SKYHUD rocket launches: the next five launches worldwide from RocketLaunch.Live's free feed.
// Loaded by app.js only when this card comes near the screen. The feed is fetched at most once every
// 15 minutes (a saved copy is reused in between) and only while the card is on screen; the URL is fixed,
// so no location is sent. Text only: no media, no images.
import { $, store, esc, fmt, dateTime, tzLabel, getJson } from "./app.js";
import { ENDPOINTS, parseLaunches, upcomingLaunches, LAUNCH_CACHE_MS } from "./feeds.js";
import { countdown, dateShortUTC } from "./util.js";
import { every } from "./live.js";

const el = $("launches");
const RLL = '<a href="https://www.rocketlaunch.live/" target="_blank" rel="noopener noreferrer">RocketLaunch.Live</a>';
const KEY = "feed.launches";
let mem = null; // {at, data, saved}

async function refresh() {
  const c = store.get(KEY, null);
  const fresh = c && c.data && Array.isArray(c.data.rows) && Date.now() - c.at < LAUNCH_CACHE_MS && Date.now() >= c.at;
  if (fresh) { mem = { at: c.at, data: c.data, saved: false }; return; }
  try {
    const data = parseLaunches(await getJson(ENDPOINTS.launches, 12000));
    mem = { at: Date.now(), data, saved: false };
    try { store.set(KEY, { at: mem.at, data }); } catch { /* storage full: live copy still shown */ }
  } catch (e) {
    mem = c && c.data && Array.isArray(c.data.rows) ? { at: c.at, data: c.data, saved: true, err: String(e.message || e) } : { err: String(e.message || e) };
  }
}

function when(r) {
  if (r.precision === "day") return `${esc(r.dateStr || dateShortUTC(new Date(r.t)))} (UTC date; launch time not set yet)`;
  return `${esc(fmt(new Date(r.t), { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }))} (${r.precision === "exact" ? "planned lift-off" : "window opens"})`;
}
function inText(r, now) {
  if (r.precision === "day") return "";
  const d = r.t - now;
  return d > 0 ? `in ${countdown(d, false)}` : "window may be open now";
}
const nameOf = (r) => (r.name === "TBD" ? "Mission name not announced" : esc(r.name));
const what = (r) => [r.vehicle, r.provider].filter(Boolean).map(esc).join(" · ") || "Vehicle not given";
const where = (r) => [r.site, r.country].filter(Boolean).map(esc).join(", ") || "Site not given";

export function render(now = Date.now()) {
  if (!mem) return;
  if (!mem.data) {
    el.innerHTML = `<p class="warn"><strong>Unavailable:</strong> the launch list (${RLL}) did not load or its format has changed, and there is no saved copy. Nothing is listed rather than a list that might be wrong.</p>`;
    return;
  }
  const rows = upcomingLaunches(mem.data.rows, now);
  const checked = `${esc(dateTime(new Date(mem.at)))} ${tzLabel()}`;
  if (!rows.length) {
    el.innerHTML = `<p class="warn"><strong>Unavailable:</strong> ${mem.saved ? `the live feed is down and the saved copy (fetched ${checked})` : "the feed"} lists only launches that have already passed.</p>`;
    return;
  }
  const warn = mem.saved ? `<strong class="warn">Saved copy:</strong> the live feed is unavailable, showing the list fetched ${checked}. Times may have changed. ` : "";
  const skipped = mem.data.skipped ? ` ${mem.data.skipped} entr${mem.data.skipped === 1 ? "y" : "ies"} in the feed could not be read and ${mem.data.skipped === 1 ? "is" : "are"} left out.` : "";
  el.innerHTML = `<ol class="launch-list">${rows.map((r) => `<li><strong>${nameOf(r)}</strong>
      <span class="fine">${what(r)}</span><span class="fine">${where(r)}</span>
      <span>${when(r)}${inText(r, now) ? ` <span class="muted">${inText(r, now)}</span>` : ""}</span></li>`).join("")}</ol>
    <p class="stamp">${warn}Data by ${RLL}; checked ${checked}. Dates slip often: confirm with the provider before travelling.${skipped}</p>
    <details><summary>Launches as a table</summary><div class="scroll-x" tabindex="0" role="region" aria-label="Launch table"><table><caption>Next launches. Data by RocketLaunch.Live.</caption>
      <thead><tr><th scope="col">Mission</th><th scope="col">Vehicle</th><th scope="col">Provider</th><th scope="col">Site</th><th scope="col">Time</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${nameOf(r)}</td><td>${esc(r.vehicle || "—")}</td><td>${esc(r.provider || "—")}</td><td>${where(r)}</td><td>${when(r)}</td></tr>`).join("")}</tbody></table></div></details>`;
}

let started = false;
export function start() {
  if (started) return;
  started = true;
  // Runs every minute while the card is visible so the "in 3 h" text stays current; the network is only
  // touched when the saved copy is older than 15 minutes.
  every("launches", 60e3, async () => { await refresh(); render(); }, { el });
}
