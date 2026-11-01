// SKYHUD DSN Now: which spacecraft NASA's Deep Space Network dishes are talking to right now.
// Unofficial: reads the undocumented XML feed behind NASA/JPL's DSN Now page (eyes.nasa.gov/dsn), which can
// change or stop without notice. Loaded by app.js only when this card comes near the screen; polled at most
// once a minute and only while the card is on screen and the tab is visible. Fixed URL, no location sent.
import { $, store, esc, fmt, tzLabel } from "./app.js";
import { ENDPOINTS, parseDsn, dsnAge, dataRateText, lightTimeText, DSN_POLL_MS } from "./feeds.js";
import { countdown, readCapped } from "./util.js";
import { every } from "./live.js";

const el = $("dsn");
const KEY = "feed.dsn";
const MAX_BYTES = 512 * 1024;
const CREDIT = 'NASA/JPL <a href="https://eyes.nasa.gov/dsn/dsn.html" target="_blank" rel="noopener noreferrer">DSN Now</a>';
let names = null, mem = null;

async function fetchText(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    // cache: "no-cache" revalidates (the feed says max-age=3600), so a browser-cached copy is never shown as live.
    const r = await fetch(url, { signal: ctl.signal, credentials: "omit", referrerPolicy: "strict-origin-when-cross-origin", cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // Capped while streaming (and a larger Content-Length is refused up front), so a huge reply is never read whole.
    return await readCapped(r, MAX_BYTES, "DSN feed");
  } finally { clearTimeout(t); }
}
/** DOMParser text/xml -> plain tree for parseDsn. Malformed XML throws (DOMParser reports it as <parsererror>). */
export function xmlToTree(text) {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (doc.getElementsByTagName("parsererror").length || !doc.documentElement) throw new Error("DSN feed: not well-formed XML");
  const walk = (n, depth) => {
    if (depth > 6) return { tag: n.tagName, attrs: {}, text: "", children: [] };
    const children = [...n.children].slice(0, 400).map((c) => walk(c, depth + 1));
    const attrs = {};
    for (const a of n.attributes) attrs[a.name] = a.value;
    return { tag: n.tagName, attrs, text: children.length ? "" : (n.textContent || "").trim().slice(0, 40), children };
  };
  return walk(doc.documentElement, 0);
}

async function refresh() {
  if (!names) names = await fetch("data/dsn-spacecraft.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  try {
    const data = parseDsn(xmlToTree(await fetchText(ENDPOINTS.dsn)), names);
    mem = { at: Date.now(), data, saved: false };
    try { store.set(KEY, { at: mem.at, data }); } catch { /* storage full: live copy still shown */ }
  } catch (e) {
    const c = store.get(KEY, null);
    mem = c && c.data && Array.isArray(c.data.stations) ? { at: c.at, data: c.data, saved: true } : { err: String(e.message || e) };
  }
}

const UNOFFICIAL = '<p class="fine"><strong>Unofficial:</strong> this reads the undocumented feed behind NASA/JPL\'s DSN Now page. It can change or stop without notice, and SKYHUD is not affiliated with NASA.</p>';
const dishName = (d) => d.replace(/^DSS(\d+)$/, "DSS-$1");
const stamp = (t) => `${esc(fmt(new Date(t), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }))} ${tzLabel()}`;
function link(x) {
  const dir = x.up && x.down ? "two-way" : x.down ? "downlink" : x.up ? "uplink" : "no active signal";
  return [dir, x.bands.length ? `${x.bands.join("/")}-band` : "", x.rate ? dataRateText(x.rate) : ""].filter(Boolean).join(", ");
}
const craftName = (x) => `${esc(x.name)}${x.known ? "" : ' <span class="muted">(code not in NASA\'s list)</span>'}`;

export function render(now = Date.now()) {
  if (!mem) return;
  if (!mem.data) {
    el.innerHTML = `${UNOFFICIAL}<p class="warn"><strong>Unavailable:</strong> the DSN Now feed did not load or its format has changed, and there is no saved copy. Nothing is shown rather than a list that might be wrong.</p>`;
    return;
  }
  const d = mem.data, age = dsnAge(d.t, now);
  const warn = mem.saved ? `<strong class="warn">Saved copy:</strong> the live feed is unavailable; this is the copy stamped ${stamp(d.t)} (${countdown(now - d.t, false)} old). `
    : age === "stale" ? `<strong class="warn">Stale:</strong> the feed's own timestamp is ${countdown(now - d.t, false)} old (its server lets caches keep a copy for up to an hour). `
    : age === "future" ? '<strong class="warn">Time unclear:</strong> the feed is stamped ahead of this device\'s clock. ' : "";
  const summary = d.craft.length ? `${d.craft.length} spacecraft on ${d.dishes} dishes at ${d.stations.length} complexes.` : `No spacecraft listed on the ${d.dishes} dishes right now (maintenance or testing).`;
  el.innerHTML = `${UNOFFICIAL}<p><strong>${summary}</strong></p>
    <div class="dsn-grid">${d.stations.map((s) => `<div class="dsn-st"><h3>${esc(s.name)}</h3><ul class="dsn-list">${s.dishes.map((x) => `<li><span class="dsn-dish">${esc(dishName(x.dish))}</span> ${x.targets.length
      ? x.targets.map((t) => `${craftName(t)} <span class="fine">${esc(link(t))}</span>`).join("; ")
      : `<span class="muted">no spacecraft${x.activity ? ` (${esc(x.activity)})` : ""}</span>`}</li>`).join("")}</ul></div>`).join("")}</div>
    <p class="stamp">${warn}Data: ${CREDIT} (feed time ${stamp(d.t)}; checked ${stamp(mem.at)}).${d.skipped ? ` ${d.skipped} unreadable entr${d.skipped === 1 ? "y was" : "ies were"} left out.` : ""}</p>
    <details><summary>Deep Space Network as a table</summary><div class="scroll-x" tabindex="0" role="region" aria-label="Deep Space Network table"><table><caption>DSN dishes and spacecraft (unofficial, NASA/JPL DSN Now feed)</caption>
      <thead><tr><th scope="col">Complex</th><th scope="col">Dish</th><th scope="col">Spacecraft</th><th scope="col">Signal</th><th scope="col">Round-trip light time</th></tr></thead><tbody>
      ${d.stations.flatMap((s) => s.dishes.flatMap((x) => (x.targets.length ? x.targets : [null]).map((t) => `<tr><td>${esc(s.name)}</td><td>${esc(dishName(x.dish))}</td><td>${t ? craftName(t) : `none${x.activity ? ` (${esc(x.activity)})` : ""}`}</td><td>${t ? esc(link(t)) : "—"}</td><td>${t ? lightTimeText(t.rtlt) : "—"}</td></tr>`))).join("")}</tbody></table></div></details>`;
}

let started = false;
export function start() {
  if (started) return;
  started = true;
  // live.js runs this only while the card is on screen, the tab is visible and live updates aren't paused.
  every("dsn", DSN_POLL_MS, async () => { await refresh(); render(); }, { el, reducedMs: DSN_POLL_MS });
}
