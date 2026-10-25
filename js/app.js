// SKYHUD main module. Client-side only: no keys, no analytics, no third-party scripts.
import * as A from "./astro.js";
import { scoreHour, WEIGHTS, SCORE_VERSION, band } from "./score.js";
import { ENDPOINTS, forecastUrl, geocodeUrl, parseForecast, parseGeocode, parseKp, gScale, parseIssNow, parseTle, parseXray, parseRtsw } from "./feeds.js";
import { upcomingShowers, IMO_SOURCE } from "./showers.js";
import { drawChart, hitTest } from "./chart.js";
import { round2, geoErrorText, dateShortUTC, numCell, isRedShortcut, validTz, browserTz, countdown, nextAfter, twilightBand } from "./util.js";
import { drawMap, parseOvation, auroraAt, auroraSectors } from "./map.js";
import { kpBars, kpGauge, lineChart, xrayClass, cloudStrip } from "./svgviz.js";
import { every, runSoon, setPaused, isPaused, onPause, reducedMotion } from "./live.js";

const $ = (id) => document.getElementById(id);
const DEFAULT_LOC = { name: "Seattle, WA (default)", lat: 47.6062, lon: -122.3321, tz: "America/Los_Angeles" };
const store = {
  get(k, d) { try { const v = localStorage.getItem("skyhud." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("skyhud." + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem("skyhud." + k); } catch { /* blocked */ } },
};
const dlg = $("loc-dlg");


const state = {
  loc: (() => {
    const l = store.get("loc", DEFAULT_LOC);
    if (l === DEFAULT_LOC) return l;
    const r = { ...l, lat: round2(l.lat), lon: round2(l.lon), tz: validTz(l.tz) ? l.tz : null };
    // An older version may have saved more precise coordinates (or a bad zone): replace the stored copy.
    if (r.lat !== l.lat || r.lon !== l.lon || r.tz !== (l.tz ?? null)) store.set("loc", r);
    return r;
  })(),
  utc: store.get("utc", false),
  red: store.get("red", false),
  rkey: store.get("rkey", true),
  dim: (() => { const d = Number(store.get("dim", 70)); return Number.isFinite(d) ? Math.min(100, Math.max(20, d)) : 70; })(),
  bortle: store.get("bortle", 5),
  offsetMin: 0,
  sky: null, forecast: null, forecastAt: null, forecastErr: null,
  tles: null, tleSource: null, passes: null, satPos: [], kp: null, events: [],
  layers: { const: true, ecl: true, sat: true, rad: true },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// A saved or Open-Meteo zone name is checked before use; anything this browser rejects falls back to its own zone.
const tz = () => (state.utc ? "UTC" : validTz(state.loc.tz) ? state.loc.tz : browserTz());
const tzLabel = () => (state.utc ? "UTC" : shortTz());
function shortTz() {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz(), timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName").value; } catch { return tz(); }
}
const fmt = (d, opts) => (d ? new Intl.DateTimeFormat("en-US", { timeZone: tz(), ...opts }).format(d) : "—");
const hm = (d) => fmt(d, { hour: "numeric", minute: "2-digit" });
const dayHm = (d) => fmt(d, { weekday: "short", hour: "numeric", minute: "2-digit" });
const dateShort = (d) => fmt(d, { month: "short", day: "numeric" });

const dateTime = (d) => fmt(d, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const deg = (x, p = 0) => `${x.toFixed(p)}°`;
const viewTime = () => new Date(Date.now() + state.offsetMin * 60e3);
const status = (msg) => { $("status").textContent = msg; };

// ---------- theme ----------
function applyTheme() {
  document.documentElement.dataset.theme = state.red ? "red" : "dark";
  document.documentElement.style.setProperty("--night-level", String(state.dim / 100));
  $("red-btn").setAttribute("aria-pressed", String(state.red));
  $("dim-wrap").hidden = !state.red;
  $("dim").value = state.dim;
  document.querySelector('meta[name="theme-color"]').content = state.red ? "#000000" : "#05070c";
  requestDraw();
  window.dispatchEvent(new Event("skyhud-theme"));
}
$("red-btn").addEventListener("click", () => { state.red = !state.red; store.set("red", state.red); applyTheme(); });
$("dim").addEventListener("input", (e) => { state.dim = Number(e.target.value); store.set("dim", state.dim); applyTheme(); });
// Single-key shortcut (WCAG 2.1.4): can be switched off, ignored on repeats, with modifiers and
// whenever focus is on an interactive control or editable text.
document.addEventListener("keydown", (e) => {
  if (dlg.open || !isRedShortcut(e, document.activeElement, state.rkey)) return;
  state.red = !state.red; store.set("red", state.red); applyTheme();
});
$("rkey").checked = state.rkey;
$("rkey").addEventListener("change", (e) => { state.rkey = e.target.checked; store.set("rkey", state.rkey); });
$("tz-btn").addEventListener("click", () => { state.utc = !state.utc; store.set("utc", state.utc); renderAll(); });

// ---------- location ----------
$("loc-btn").addEventListener("click", () => { $("lat").value = state.loc.lat; $("lon").value = state.loc.lon; $("loc-msg").textContent = ""; dlg.showModal(); });
$("loc-close").addEventListener("click", () => dlg.close());
$("geo-btn").addEventListener("click", () => {
  if (!navigator.geolocation) { $("loc-msg").textContent = "Geolocation isn't available in this browser. Search for a place or enter coordinates instead."; return; }
  $("loc-msg").textContent = "Asking your browser for location…";
  navigator.geolocation.getCurrentPosition(
    (p) => { const lat = round2(p.coords.latitude), lon = round2(p.coords.longitude);
      setLocation({ name: `${lat.toFixed(2)}, ${lon.toFixed(2)} (device)`, lat, lon, tz: browserTz() }); },
    (err) => { $("loc-msg").textContent = `${geoErrorText(err)} Search for a place or enter coordinates instead.`; },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
  );
});
$("loc-forget").addEventListener("click", () => {
  store.del("loc"); store.del("wx");
  state.loc = { ...DEFAULT_LOC }; state.forecast = null; state.forecastAt = null; state.forecastErr = null;
  state.passes = null; state.satPos = [];
  $("loc-name").textContent = state.loc.name;
  $("lat").value = state.loc.lat; $("lon").value = state.loc.lon;
  $("loc-msg").textContent = "Saved location and cached forecast deleted from this browser. Showing the Seattle default.";
  renderAll(); loadForecast(); runSatellites();
});
async function citySearch() {
  const q = $("city").value.trim();
  const ul = $("city-results");
  if (q.length < 2) { $("loc-msg").textContent = "Type at least 2 letters."; return; }
  $("loc-msg").textContent = "Searching…";
  try {
    const res = parseGeocode(await getJson(geocodeUrl(q)));
    ul.innerHTML = res.length ? "" : "<li>No matches.</li>";
    res.forEach((r) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn link";
      b.textContent = `${r.name} (${r.lat.toFixed(2)}, ${r.lon.toFixed(2)})`;
      b.addEventListener("click", () => setLocation(r));
      li.append(b); ul.append(li);
    });
    $("loc-msg").textContent = `${res.length} result(s). Location data based on GeoNames, via Open-Meteo.`;
  } catch {
    $("loc-msg").textContent = "Place search is unavailable right now. Enter coordinates instead.";
  }
}
$("city-go").addEventListener("click", citySearch);
$("city").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); citySearch(); } });
$("ll-go").addEventListener("click", () => {
  const lat = Number($("lat").value), lon = Number($("lon").value);
  if (!$("lat").value || !$("lon").value || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) { $("loc-msg").textContent = "Enter a latitude between −90 and 90 and a longitude between −180 and 180."; return; }
  setLocation({ name: `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon, tz: null });
});
function setLocation(loc) {
  // Stored and used at 0.01° (about 1 km): enough for astronomy and weather, no street-level precision.
  state.loc = { name: loc.name, lat: round2(loc.lat), lon: round2(loc.lon), tz: validTz(loc.tz) ? loc.tz : null };
  store.set("loc", state.loc);
  dlg.open && dlg.close();
  state.forecast = null; state.passes = null; state.satPos = [];
  renderAll(); loadForecast(); runSatellites();
}

$("bortle").addEventListener("change", (e) => { state.bortle = Number(e.target.value); store.set("bortle", state.bortle); renderScore(); renderHourly(); });

// ---------- fetch helpers ----------
async function getJson(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    // cache: "no-cache" revalidates with the server every time, so a success really is a fresh fetch and the
    // "checked" time we show is true. Offline it fails, and the caller falls back to its labelled saved copy.
    const r = await fetch(url, { signal: ctl.signal, credentials: "omit", referrerPolicy: "strict-origin-when-cross-origin", cache: "no-cache" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
async function getText(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: "omit" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

// ---------- forecast ----------
async function loadForecast() {
  const { lat, lon } = state.loc;
  const key = `wx:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = store.get("wx", null);
  if (cached && cached.key === key && Date.now() - cached.at < 30 * 60e3) {
    useForecast(cached.json, new Date(cached.at), false);
    return;
  }
  try {
    const json = await getJson(forecastUrl(lat, lon));
    store.set("wx", { key, at: Date.now(), json });
    useForecast(json, new Date(), false);
  } catch (e) {
    if (cached && cached.key === key && Date.now() - cached.at < 24 * 3600e3) {
      useForecast(cached.json, new Date(cached.at), true);
    } else {
      state.forecast = null; state.forecastErr = "The forecast is unavailable (offline or Open-Meteo unreachable). The score needs cloud data, so it isn't shown. Astronomy times below still work offline.";
      renderScore(); renderHourly();
    }
  }
}
function useForecast(json, at, stale) {
  try {
    state.forecast = parseForecast(json);
    state.forecastAt = at;
    state.forecastErr = stale ? "Offline: showing the last saved forecast." : null;
    if (!state.loc.tz && validTz(json.timezone) && json.timezone !== "GMT") { state.loc.tz = json.timezone; store.set("loc", state.loc); renderAll(); }
  } catch { state.forecast = null; state.forecastErr = "The forecast data had an unexpected format, so it isn't shown."; }
  renderScore(); renderHourly();
}

// ---------- score ----------
function hourInputs(row) {
  const { lat, lon } = state.loc;
  const sun = A.bodyPosition("sun", row.t, lat, lon);
  const moon = A.bodyPosition("moon", row.t, lat, lon);
  return { ...row, sunAlt: sun.alt, moonAlt: moon.alt, moonIllum: A.moonPhase(row.t).illum, bortle: state.bortle };
}
function nightRows() {
  if (!state.forecast) return [];
  const n = A.nightTimes(new Date(), state.loc.lat, state.loc.lon);
  const from = n.astroDusk || n.nauticalDusk || n.civilDusk || n.sunset || n.noon;
  const to = n.astroDawn || n.nauticalDawn || n.civilDawn || n.sunrise || new Date(n.noon.getTime() + 86400e3);
  return state.forecast.filter((r) => r.t >= new Date(from.getTime() - 30 * 60e3) && r.t <= to && r.t >= new Date(Date.now() - 3600e3))
    .map((r) => ({ row: r, inp: hourInputs(r) }))
    .filter((x) => x.inp.sunAlt < -6)
    .map((x) => ({ ...x, res: scoreHour(x.inp) }));
}
const FACTOR_LABEL = { clouds: "Clouds", moon: "Moon", darkness: "Darkness", light_pollution: "Light pollution", transparency: "Transparency / haze", seeing_comfort: "Wind & dew" };
function factorInputs(k, i) {
  switch (k) {
    case "clouds": return `low ${i.cloudLow}%, mid ${i.cloudMid}%, high ${i.cloudHigh}% (total ${i.cloudTotal}%)`;
    case "moon": return i.moonAlt > 0 ? `${(i.moonIllum * 100).toFixed(0)}% lit, ${deg(i.moonAlt)} up` : "below horizon";
    case "darkness": return `Sun ${deg(i.sunAlt)}`;
    case "light_pollution": return `Bortle ${i.bortle} (your setting)`;
    case "transparency": return `visibility ${(i.visibility / 1000).toFixed(0)} km, RH ${i.humidity}%`;
    case "seeing_comfort": return `wind ${i.wind} km/h, T−Td ${(i.temp - i.dewPoint).toFixed(1)} °C`;
  }
  return "";
}
let lastScoreHtml = null;
function renderScore() {
  const el = $("score");
  // #score is an aria-live region: only touch it when the content actually changes, so screen readers
  // aren't re-announced the same score on every refresh (and an open "Why this score?" stays open).
  const put = (html) => { if (html !== lastScoreHtml) { el.innerHTML = html; lastScoreHtml = html; } };
  $("bortle").value = String(state.bortle);
  if (!state.forecast) {
    put(state.forecastErr ? `<p class="warn">${esc(state.forecastErr)}</p>` : '<div class="skel skel-score"></div>');
    return;
  }
  const rows = nightRows();
  if (!rows.length) {
    put(`<p>The forecast has no dark hours left for tonight here (the Sun stays above −6° or the night is over).</p>${staleNote()}`);
    return;
  }
  const scored = rows.filter((r) => r.res.score != null);
  if (!scored.length) { put(`<p class="warn">The forecast is missing fields the score needs, so no score is shown.</p>`); return; }
  const best = scored.reduce((a, b) => (b.res.score > a.res.score ? b : a));
  const avg = Math.round(scored.reduce((a, b) => a + b.res.score, 0) / scored.length);
  const b = best.res;
  const table = Object.keys(WEIGHTS).map((k) => `<tr><th scope="row">${FACTOR_LABEL[k]}</th><td>${WEIGHTS[k].toFixed(2)}</td><td>${b.sub[k].toFixed(2)}</td><td>${esc(factorInputs(k, best.inp))}</td></tr>`).join("");
  put(`
    <div class="score-num band-${b.band.toLowerCase()}"><span class="big">${b.score}</span><span class="band">${b.band}</span></div>
    <div class="score-meta">
      <p>Best hour: <strong>${dayHm(best.row.t)}</strong> ${tzLabel()}</p>
      <p>Average over ${scored.length} dark hour${scored.length > 1 ? "s" : ""}: <strong>${avg} (${band(avg)})</strong></p>
      ${b.capped ? '<p class="warn">Capped at 10: cloud cover is 90% or more.</p>' : ""}
      ${staleNote()}
    </div>
    <details class="why"><summary>Why this score?</summary>
      <table><caption>${SCORE_VERSION} at the best hour. Score = 100 × Σ weight × sub-score. Our own heuristic.</caption>
      <thead><tr><th scope="col">Factor</th><th scope="col">Weight</th><th scope="col">Sub-score</th><th scope="col">Inputs</th></tr></thead><tbody>${table}</tbody></table>
    </details>`);
}
function staleNote() {
  if (!state.forecastAt) return "";
  return `<p class="fine">Open-Meteo forecast fetched ${dateTime(state.forecastAt)} ${tzLabel()}.${state.forecastErr ? " " + esc(state.forecastErr) : ""}</p>`;
}

// Only finite numbers count as forecast values; anything else (null, strings, NaN) is "no data".
const fin = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function renderCloudStrip() {
  const el = $("cloudstrip");
  if (!state.forecast) { el.innerHTML = state.forecastErr ? `<p class="warn">Cloud layers unavailable: ${esc(state.forecastErr)}</p>` : ""; return; }
  const now = Date.now(), start = Math.floor(now / 3600e3) * 3600e3;
  const hrs = state.forecast.filter((r) => r.t.getTime() >= start && r.t.getTime() < start + 48 * 3600e3)
    .map((r) => ({ t: r.t.getTime(), low: fin(r.cloudLow), mid: fin(r.cloudMid), high: fin(r.cloudHigh), band: twilightBand(A.bodyPosition("sun", new Date(r.t.getTime() + 1800e3), state.loc.lat, state.loc.lon).alt) }));
  if (!hrs.length) { el.innerHTML = '<p class="warn">Cloud layers unavailable: the saved forecast has no hours from now on.</p>'; return; }
  const ticks = hourTicks(hrs[0].t, hrs[hrs.length - 1].t + 3600e3, 6).map((k) => (k.label === "12a" ? { ...k, label: fmt(new Date(k.t), { weekday: "short" }) } : k));
  const dark = hrs.filter((h) => h.band === "night");
  const clearDark = dark.filter((h) => Math.max(h.low ?? 100, h.mid ?? 100) < 30 && (h.high ?? 100) < 60).length;
  const pct = (v) => (v == null ? "no data" : Math.round(v) + "%");
  const gaps = hrs.filter((h) => h.low == null || h.mid == null || h.high == null).length;
  el.innerHTML = `<h3>Cloud layers, next ${hrs.length} hours</h3>
    ${cloudStrip(hrs, { ticks, nowMs: now, title: `Low, mid and high cloud for the next ${hrs.length} hours over the darkness of each hour. ${clearDark} of ${dark.length} hours of full darkness look mostly clear.${gaps ? ` ${gaps} hours have missing layers (hatched).` : ""} A table follows.` })}
    <p class="fine">Brighter cells = more cloud; hatched cells = no data. Background: daylight to full darkness, as in the darkness timeline. ${clearDark} of ${dark.length} hours of full darkness look mostly clear (low and mid cloud under 30%, high under 60%). Forecast from Open-Meteo, fetched ${dateTime(state.forecastAt)} ${tzLabel()}${state.forecastErr ? `; <strong class="warn">${esc(state.forecastErr)}</strong>` : ""}.</p>
    <details><summary>Cloud layers as a table</summary><div class="scroll-x" tabindex="0" role="region" aria-label="Cloud layers table"><table><caption>Hourly cloud cover by layer (${tzLabel()})</caption>
      <thead><tr><th scope="col">Hour</th><th scope="col">Sky</th><th scope="col">Low</th><th scope="col">Mid</th><th scope="col">High</th></tr></thead><tbody>
      ${hrs.map((h) => `<tr><td>${fmt(new Date(h.t), { weekday: "short", hour: "numeric" })}</td><td>${BAND_NAME[h.band] || h.band}</td><td>${pct(h.low)}</td><td>${pct(h.mid)}</td><td>${pct(h.high)}</td></tr>`).join("")}</tbody></table></div></details>`;
}

function renderHourly() {
  renderCloudStrip();
  const el = $("hourly");
  if (!state.forecast) {
    el.innerHTML = state.forecastErr ? `<p class="warn">${esc(state.forecastErr)}</p>` : '<div class="skel skel-strip"></div>';
    $("wx-stamp").textContent = "";
    return;
  }
  const now = Date.now() - 3600e3;
  const rows = state.forecast.filter((r) => r.t >= now).slice(0, 24).map((r) => ({ r, s: scoreHour(hourInputs(r)), sun: A.bodyPosition("sun", r.t, state.loc.lat, state.loc.lon).alt }));
  // Upstream values are numbers; anything else is shown as a dash, never inserted as markup.
  const cell = numCell;
  el.innerHTML = `<table class="hourly"><caption class="sr">Next 24 hours. The score is only shown when the Sun is below −6°.</caption>
    <thead><tr><th scope="row">Time (${tzLabel()})</th>${rows.map((x) => `<th scope="col">${fmt(x.r.t, { hour: "numeric" })}</th>`).join("")}</tr></thead>
    <tbody>
      <tr><th scope="row">Score</th>${rows.map((x) => `<td class="${x.sun < -6 && x.s.band ? "b-" + x.s.band.toLowerCase() : ""}">${x.sun < -6 && x.s.score != null ? x.s.score : x.sun < -6 ? "—" : "day"}</td>`).join("")}</tr>
      <tr><th scope="row">Cloud %</th>${rows.map((x) => `<td>${cell(x.r.cloudTotal)}</td>`).join("")}</tr>
      <tr><th scope="row">Low/mid/high</th>${rows.map((x) => `<td>${cell(x.r.cloudLow)}/${cell(x.r.cloudMid)}/${cell(x.r.cloudHigh)}</td>`).join("")}</tr>
      <tr><th scope="row">Precip. %</th>${rows.map((x) => `<td>${cell(x.r.precip)}</td>`).join("")}</tr>
      <tr><th scope="row">Humidity %</th>${rows.map((x) => `<td>${cell(x.r.humidity)}</td>`).join("")}</tr>
      <tr><th scope="row">Wind km/h</th>${rows.map((x) => `<td>${cell(x.r.wind)}</td>`).join("")}</tr>
      <tr><th scope="row">Temp °C</th>${rows.map((x) => `<td>${cell(x.r.temp)}</td>`).join("")}</tr>
    </tbody></table>`;
  $("wx-stamp").textContent = `Fetched ${dateTime(state.forecastAt)} ${tzLabel()}.`;
}

// ---------- darkness & moon ----------
function renderTwilight() {
  const { lat, lon } = state.loc;
  const n = A.nightTimes(new Date(), lat, lon);
  const row = (label, d, missing) => `<tr><th scope="row">${label}</th><td>${d ? dayHm(d) : `<span class="muted">${missing}</span>`}</td></tr>`;
  const dark = n.astroDusk && n.astroDawn ? `${((n.astroDawn - n.astroDusk) / 3600e3).toFixed(1)} h of full darkness` : "No full astronomical darkness tonight";
  $("twilight").innerHTML = `<table><caption>Tonight (${tzLabel()}) · ${esc(dark)}</caption><tbody>
    ${row("Sunset", n.sunset, "Sun doesn't set")}
    ${row("Civil dusk (−6°)", n.civilDusk, "doesn't happen")}
    ${row("Nautical dusk (−12°)", n.nauticalDusk, "doesn't happen")}
    ${row("Astronomical dusk (−18°)", n.astroDusk, "doesn't happen")}
    ${row("Astronomical dawn", n.astroDawn, "doesn't happen")}
    ${row("Nautical dawn", n.nauticalDawn, "doesn't happen")}
    ${row("Civil dawn", n.civilDawn, "doesn't happen")}
    ${row("Sunrise", n.sunrise, "Sun doesn't rise")}
  </tbody></table>`;
}

// CSP has no 'unsafe-inline' for styles, so positions go in data-l / data-w (percent) and are applied through CSSOM.
function placeAll(root) {
  for (const el of root.querySelectorAll("[data-l]")) {
    el.style.left = `${el.dataset.l}%`;
    if (el.dataset.w) el.style.width = `${el.dataset.w}%`;
  }
}
// Darkness timeline: local noon to noon, built from the same exact crossings as the twilight table, with the Moon's time above the horizon.
const BAND_NAME = { day: "Daylight", civil: "Civil twilight", nautical: "Nautical twilight", astro: "Astronomical twilight", night: "Full darkness" };
let twiSpan = null;
function renderTwibar() {
  const { lat, lon } = state.loc;
  const n = A.nightTimes(new Date(), lat, lon);
  const t0 = n.noon.getTime(), span = 86400e3;
  const pct = (t) => (((t - t0) / span) * 100).toFixed(2);
  const w = (a, b) => (((b - a) / span) * 100).toFixed(2);
  const { bands, exact } = A.darknessBands(n, t0, t0 + span, lat, lon);
  const moonUp = A.moonUpRuns(t0, t0 + span, lat, lon);
  const illum = A.moonPhase(new Date(t0 + span / 2)).illum;
  const ticks = [];
  for (let h = 0; h <= 24; h += 3) ticks.push(`<span class="tw-tick${h % 6 ? " tw-odd" : ""}" data-l="${pct(t0 + h * 3600e3)}">${esc(fmt(new Date(t0 + h * 3600e3), { hour: "numeric" }))}</span>`);
  const summary = bands.map((b) => `${BAND_NAME[b.v]} ${hm(new Date(b.from))}–${hm(new Date(b.to))}`).join("; ");
  $("twibar").innerHTML = `<p class="fine">Darkness timeline, ${esc(dateShort(new Date(t0)))} midday to midday (${tzLabel()}). Computed on your device${exact ? "" : "; approximate, to the minute"}.</p>
    <div class="tw" role="img" aria-label="${esc(`Darkness timeline: ${summary}. Moon up: ${moonUp.length ? moonUp.map((r) => `${hm(new Date(r.from))}–${hm(new Date(r.to))}`).join(", ") : "not tonight"}.${exact ? "" : " Times are approximate (to the minute)."} Times are in the table below.`)}">
      <div class="tw-bands">${bands.map((b) => `<span class="tw-b tw-${b.v}" data-l="${pct(b.from)}" data-w="${w(b.from, b.to)}"></span>`).join("")}</div>
      <div class="tw-moon">${moonUp.map((r) => `<span class="tw-m" data-l="${pct(r.from)}" data-w="${w(r.from, r.to)}"></span>`).join("")}</div>
      <div class="tw-ticks" aria-hidden="true">${ticks.join("")}</div>
      <div id="tw-now" class="tw-now" aria-hidden="true"><span>now</span></div>
    </div>
    <ul class="tw-legend" aria-hidden="true">${["day", "civil", "nautical", "astro", "night"].map((k) => `<li><span class="tw-sw tw-${k}"></span>${BAND_NAME[k]}</li>`).join("")}<li><span class="tw-sw tw-msw"></span>Moon up (${Math.round(illum * 100)}% lit)</li></ul>`;
  placeAll($("twibar"));
  twiSpan = { t0, span };
  moveTwiNow();
}
function moveTwiNow() {
  const el = $("tw-now");
  if (!el || !twiSpan) return;
  const f = (Date.now() - twiSpan.t0) / twiSpan.span;
  if (f > 1) { renderTwibar(); return; }
  el.hidden = f < 0;
  el.style.left = `${(Math.max(0, f) * 100).toFixed(2)}%`;
}

function moonSvg(age, illum, size = 64) {
  // Lit-portion drawing: terminator ellipse with x-radius r·|cos(phase)|. Northern-hemisphere orientation.
  const r = 28, k = Math.cos((age * Math.PI) / 180);
  const waxing = age < 180;
  const rx = Math.abs(k) * r;
  const sweepOuter = waxing ? 1 : 0;
  const sweepInner = (k > 0) === waxing ? 0 : 1;
  const d = `M32 4 A${r} ${r} 0 0 ${sweepOuter} 32 60 A${rx.toFixed(2)} ${r} 0 0 ${sweepInner} 32 4 Z`;
  return `<svg class="moon-svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="Moon ${Math.round(illum * 100)}% illuminated"><circle cx="32" cy="32" r="${r}" class="moon-dark"/><path d="${d}" class="moon-lit"/></svg>`;
}
function renderMoon() {
  const { lat, lon } = state.loc;
  const now = new Date();
  const p = A.moonPhase(now);
  const rts = A.riseTransitSet("moon", new Date(now.getTime() - 2 * 3600e3), lat, lon);
  const pos = A.bodyPosition("moon", now, lat, lon);
  const phases = A.nextPhases(now, 4);
  $("moon").innerHTML = `<div class="moon-head">${moonSvg(p.age, p.illum)}<div><p><strong>${p.name}</strong>, ${(p.illum * 100).toFixed(0)}% lit</p>
    <p class="fine">Now ${pos.alt > 0 ? `${deg(pos.alt)} up in the ${A.compass(pos.az)}` : "below the horizon"}</p></div></div>
    <table><caption>Moon times (${tzLabel()})</caption><tbody>
    <tr><th scope="row">Moonrise</th><td>${rts.rise ? dayHm(rts.rise) : `<span class="muted">${rts.state || "none in 24 h"}</span>`}</td></tr>
    <tr><th scope="row">Moonset</th><td>${rts.set ? dayHm(rts.set) : `<span class="muted">${rts.state || "none in 24 h"}</span>`}</td></tr>
    ${phases.map((x) => `<tr><th scope="row">${x.name}</th><td>${dateTime(x.date)}</td></tr>`).join("")}
    </tbody></table>`;
}

// ---------- planets ----------
function renderPlanets() {
  const { lat, lon } = state.loc;
  const now = new Date();
  const start = new Date(now.getTime() - 3 * 3600e3);
  const rows = A.PLANET_KEYS.map((k) => {
    const pos = A.bodyPosition(k, now, lat, lon);
    const ill = A.bodyIllumination(k, now);
    const rts = A.riseTransitSet(k, start, lat, lon);
    const elong = A.separation(pos.ra, pos.dec, A.bodyPosition("sun", now, lat, lon).ra, A.bodyPosition("sun", now, lat, lon).dec);
    return `<tr><th scope="row">${A.bodyName(k)}</th><td>${ill.mag.toFixed(1)}</td>
      <td>${pos.alt > 0 ? `${deg(pos.alt)} ${A.compass(pos.az)}` : '<span class="muted">down</span>'}</td>
      <td>${rts.rise ? hm(rts.rise) : "—"}</td><td>${rts.set ? hm(rts.set) : "—"}</td><td>${deg(elong)}${elong < 15 ? ' <span class="muted">(too near Sun)</span>' : ""}</td></tr>`;
  }).join("");
  $("planets").innerHTML = `<table><caption>Now and the next 24 h (${tzLabel()}). Mag = visual magnitude; lower is brighter.</caption>
    <thead><tr><th scope="col">Planet</th><th scope="col">Mag</th><th scope="col">Now</th><th scope="col">Rise</th><th scope="col">Set</th><th scope="col">From Sun</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- satellites ----------
let worker = null, reqId = 0;
const pending = new Map();
function sat(kind, payload) {
  if (!worker) {
    worker = new Worker("js/sat-worker.js");
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.ok ? p.res(e.data.result) : p.rej(new Error(e.data.error)); } };
    worker.onerror = (e) => { for (const p of pending.values()) p.rej(new Error(e.message)); pending.clear(); };
  }
  const id = ++reqId;
  return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage({ id, kind, payload }); });
}
async function loadTles() {
  const cached = store.get("tle", null);
  if (cached && Date.now() - cached.at < 6 * 3600e3) return { list: parseTle(cached.text), source: "CelesTrak (cached)", at: new Date(cached.at) };
  try {
    const text = await getText(ENDPOINTS.tle);
    const list = parseTle(text);
    if (list.length < 10) throw new Error("too few element sets");
    store.set("tle", { at: Date.now(), text });
    return { list, source: "CelesTrak", at: new Date() };
  } catch {
    const text = await getText("catalog.tle");
    return { list: parseTle(text), source: "bundled copy (CelesTrak unreachable)", at: null };
  }
}
async function runSatellites() {
  try {
    if (!state.tles) {
      const t = await loadTles();
      state.tles = t.list; state.tleSource = t;
    }
    const tl = state.tles.map(({ name, l1, l2, norad }) => ({ name, l1, l2, norad }));
    const passes = await sat("predict", { tles: tl, lat: state.loc.lat, lon: state.loc.lon, start: Date.now() - 10 * 60e3, hours: 24 });
    state.passes = passes;
    renderPasses();
    runSoon("iss-track");
    updateSatPositions();
  } catch (e) {
    state.satFailed = true;
    if (!iss.trackTried) renderIss();
    $("passes").innerHTML = `<p class="warn">Satellite predictions are unavailable (${esc(e.message)}).</p>`;
  }
}
let satBusy = false;
async function updateSatPositions() {
  if (!state.tles || satBusy || !state.layers.sat) return;
  satBusy = true;
  try {
    state.satPos = await sat("positions", { tles: state.tles.map(({ name, l1, l2, norad }) => ({ name, l1, l2, norad })), lat: state.loc.lat, lon: state.loc.lon, at: viewTime().getTime() });
    requestDraw();
  } catch { state.satPos = []; } finally { satBusy = false; }
}
function renderPasses() {
  nextCands = null;
  const ps = state.passes || [];
  const iss = ps.filter((p) => p.norad === 25544);
  const vis = ps.filter((p) => p.visible && p.norad !== 25544 && p.maxEl >= 30).sort((a, b) => a.visStart - b.visStart).slice(0, 8);
  const row = (p) => `<tr><th scope="row">${esc(p.name)}</th><td>${dayHm(new Date(p.visible ? p.visStart : p.rise))}</td><td>${deg(p.maxEl)} ${A.compass(p.maxAz)}</td><td>${A.compass(p.riseAz)} → ${A.compass(p.setAz)}</td><td>${p.visible ? "Visible" : '<span class="muted">not visible (sunlit sky or in shadow)</span>'}</td></tr>`;
  const head = `<thead><tr><th scope="col">Object</th><th scope="col">Start</th><th scope="col">Highest</th><th scope="col">Path</th><th scope="col">Naked eye</th></tr></thead>`;
  $("passes").innerHTML = `
    <div class="scroll-x" tabindex="0" role="region" aria-label="ISS passes"><table><caption>ISS passes peaking ≥10° in the next 24 h (${tzLabel()}). Times approximate, ±1 min.</caption>${head}<tbody>${iss.length ? iss.map(row).join("") : '<tr><td colspan="5">No ISS passes above 10° in the next 24 h.</td></tr>'}</tbody></table></div>
    <div class="scroll-x" tabindex="0" role="region" aria-label="Other visible passes"><table><caption>Other visible passes, highest point ≥30° (from CelesTrak's "visual" list)</caption>${head}<tbody>${vis.length ? vis.map(row).join("") : '<tr><td colspan="5">None in the next 24 h.</td></tr>'}</tbody></table></div>`;
  const t = state.tleSource;
  const epochs = state.tles.map((s) => s.epoch.getTime()).sort((a, b) => a - b);
  const median = new Date(epochs[Math.floor(epochs.length / 2)]);
  const ageD = (Date.now() - median) / 86400e3;
  $("tle-stamp").innerHTML = `Elements: ${esc(t.source)}${t.at ? `, fetched ${dateTime(t.at)} ${tzLabel()}` : ""}. Median element age ${ageD.toFixed(1)} days.${ageD > 7 ? ' <strong class="warn">Elements are over a week old. Pass times may be off by minutes.</strong>' : ""} Times are approximate (±1 min): start of the visible part when visible, otherwise rise above the horizon.`;
}
// ---------- Earth map: ISS ----------
// Live dot from wheretheiss.at, polled every 10 s while the map is on screen (their limit is about 1 request/s).
// The ground track is computed here with SGP4 from CelesTrak elements. If the live feed is down or stale,
// the dot falls back to the computed position and says so.
const mapCanvas = $("map");
const iss = { live: null, liveAt: 0, track: [], coast: null, coastState: "idle", aurora: null };
const ISS_STALE_MS = 60e3;
async function pollIss() {
  try {
    iss.live = parseIssNow(await getJson(ENDPOINTS.issNow, 8000));
    iss.liveAt = Date.now();
  } catch { /* keep the last fix; it is labelled stale below */ }
  iss.liveTried = true;
  renderIss();
}
async function refreshTrack() {
  const tle = state.tles && state.tles.find((x) => x.norad === 25544);
  if (!tle) return;
  const now = Date.now();
  iss.track = await sat("track", { tle: { l1: tle.l1, l2: tle.l2 }, from: now - 45 * 60e3, to: now + 95 * 60e3, stepMin: 1 });
  iss.trackEpoch = tle.epoch;
  iss.trackTried = true;
  renderIss();
}
function computedIss() {
  const now = Date.now();
  let best = null;
  for (const p of iss.track) if (!best || Math.abs(p.t - now) < Math.abs(best.t - now)) best = p;
  return best && Math.abs(best.t - now) <= 60e3 ? { ...best, computed: true } : null;
}
function renderIss() {
  if (!iss.coast && iss.coastState === "idle") {
    iss.coastState = "loading";
    getJson("data/coast110.json").then((c) => { iss.coast = c; iss.coastState = "ok"; renderIss(); }).catch(() => { iss.coastState = "failed"; });
  }
  const fresh = iss.live && Date.now() - iss.liveAt < ISS_STALE_MS;
  const pos = fresh ? { lat: iss.live.lat, lon: iss.live.lon } : computedIss();
  drawMap(mapCanvas, { coast: iss.coast, track: iss.track, iss: pos, home: state.loc, aurora: iss.aurora, red: state.red, dim: state.red ? state.dim / 100 : 1, css: getComputedStyle(document.documentElement) });
  const at = (d) => `${fmt(d, { hour: "numeric", minute: "2-digit", second: "2-digit" })} ${tzLabel()}`;
  let line;
  if (fresh) line = `ISS over ${iss.live.lat.toFixed(1)}°, ${iss.live.lon.toFixed(1)}°${iss.live.altKm != null ? ` at ${iss.live.altKm.toFixed(0)} km` : ""}, ${iss.live.visibility === "eclipsed" ? "in Earth's shadow" : "in sunlight"}. Source: wheretheiss.at, updated ${at(iss.live.t)}. Position approximate.`;
  else if (pos) line = `${iss.live ? `Live ISS feed is stale (last update ${at(iss.live.t)}). ` : "Live ISS feed (wheretheiss.at) unavailable. "}Showing the position computed on your device from CelesTrak elements: ${pos.lat.toFixed(1)}°, ${pos.lon.toFixed(1)}°. Approximate.`;
  else if (!iss.liveTried || (!iss.trackTried && !state.satFailed)) line = "ISS position loading: waiting for the live feed (wheretheiss.at) and the orbital elements.";
  else line = "ISS position unavailable: the live feed (wheretheiss.at) did not answer and no orbital elements are loaded yet.";
  const loading = !fresh && !pos && line.startsWith("ISS position loading");
  $("map-stamp").innerHTML = loading ? `<strong>Loading:</strong> ${esc(line)}` : `${fresh ? "" : '<strong class="warn">' + (pos ? "Computed" : "Unavailable") + ":</strong> "}${esc(line)}`;
  $("iss-now").textContent = line;
  const future = iss.track.filter((p) => p.t >= Date.now() - 30e3 && [p.lat, p.lon, p.altKm].every(Number.isFinite)).filter((_, i) => i % 10 === 0).slice(0, 10);
  $("track-table").innerHTML = future.length ? `<table><caption>ISS ground track, computed (SGP4, CelesTrak elements${iss.trackEpoch ? `, epoch ${esc(dateTime(iss.trackEpoch))} ${tzLabel()}` : ""}). Approximate.</caption>
    <thead><tr><th scope="col">Time (${tzLabel()})</th><th scope="col">Latitude</th><th scope="col">Longitude</th><th scope="col">Height</th></tr></thead><tbody>
    ${future.map((p) => `<tr><td>${hm(new Date(p.t))}</td><td>${p.lat.toFixed(1)}°</td><td>${p.lon.toFixed(1)}°</td><td>${p.altKm.toFixed(0)} km</td></tr>`).join("")}</tbody></table>`
    : "<p>Ground track unavailable until the orbital elements load.</p>";
  mapCanvas.setAttribute("aria-label", `World map. ${line} ${iss.auroraText || ""} Dashed line: the next 95 minutes of ground track; solid: the last 45. Cross: your location. A table of the track follows.`);
}
new ResizeObserver(() => { if (iss.coast) renderIss(); }).observe(mapCanvas);
window.addEventListener("skyhud-theme", () => { if (iss.coast) renderIss(); });

// Aurora oval: NOAA OVATION 30–90 minute forecast, about 140 KB gzipped, fetched every 10 minutes only while
// the map is on screen. A compact copy (one character per grid cell) is saved for offline use.
const packGrid = (g) => { let s = ""; for (let i = 0; i < g.length; i += 4096) s += String.fromCharCode(...g.subarray(i, i + 4096).map((v) => v + 32)); return s; };
const unpackGrid = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) - 32);
async function loadAurora() {
  const el = $("aurora-stamp");
  let res;
  try { res = await cachedFeed("aurora", ENDPOINTS.aurora, (j) => { const o = parseOvation(j); return { g: packGrid(o.grid), observed: o.observed, forecast: o.forecast }; }, 30000); }
  catch { iss.aurora = null; iss.auroraText = "Aurora forecast unavailable."; el.innerHTML = '<strong class="warn">Unavailable:</strong> aurora forecast (NOAA SWPC OVATION) did not load and there is no saved copy.'; renderIss(); return; }
  const grid = unpackGrid(res.data.g);
  iss.aurora = { grid, at: res.data.forecast + "|" + res.at.getTime() };
  const fc = Number.isFinite(res.data.forecast) ? `${dateTime(new Date(res.data.forecast))} ${tzLabel()}` : "time unknown";
  const here = auroraAt(grid, state.loc.lat, state.loc.lon);
  const sec = auroraSectors(grid, 10);
  const mine = sec.find((x) => state.loc.lon >= x.from && state.loc.lon < x.to) || sec[0];
  const edge = state.loc.lat >= 0 ? mine.north : mine.south;
  iss.auroraText = `Aurora oval forecast (${fc}): probability at your location ${here}%.`;
  el.innerHTML = `<strong>Aurora:</strong> ${here}% chance of visible aurora overhead at your location (nearest 1° grid point)${edge != null ? `; the 10% edge in your longitudes is near ${Math.abs(edge)}°${edge >= 0 ? "N" : "S"}` : "; nowhere in your longitudes reaches 10%"}. The glow on the map is brighter where aurora is likelier.
    ${feedStamp(SWPC + " OVATION aurora model (forecast " + fc + ")", res, res.data.observed, 60 * 60e3, "observation")}`;
  $("aurora-table").innerHTML = `<table><caption>Aurora oval by longitude: lowest latitude reaching 10% probability (NOAA OVATION, forecast ${fc})</caption>
    <thead><tr><th scope="col">Longitudes</th><th scope="col">North edge</th><th scope="col">South edge</th><th scope="col">Peak</th></tr></thead><tbody>
    ${sec.map((x) => `<tr><td>${x.from}° to ${x.to}°</td><td>${x.north == null ? "—" : x.north + "°N"}</td><td>${x.south == null ? "—" : -x.south + "°S"}</td><td>${x.peak}%</td></tr>`).join("")}</tbody></table>`;
  renderIss();
}

// ---------- space weather ----------
// Fetch a feed, keep a slimmed copy in localStorage, and fall back to that copy (clearly labelled) when the
// network fails. Returns {data, at: Date fetched, saved: bool} or throws if there is nothing at all.
async function cachedFeed(key, url, slim, ms = 15000) {
  try {
    const data = slim(await getJson(url, ms));
    try { store.set("feed." + key, { at: Date.now(), data }); } catch { /* storage full: live copy still shown */ }
    return { data, at: new Date(), saved: false };
  } catch (e) {
    const c = store.get("feed." + key, null);
    if (c && c.data) return { data: c.data, at: new Date(c.at), saved: true };
    throw e;
  }
}
/** Caption for a live card: source, when fetched, and a stale/saved warning when the data is old. */
function feedStamp(src, res, newest, staleMs, what) {
  if (!Number.isFinite(newest)) return `<p class="stamp">${res.saved ? `<strong class="warn">Saved copy:</strong> the live feed is unavailable, showing data fetched ${dateTime(res.at)} ${tzLabel()}. ` : ""}Source: ${src}. Time of the newest ${what} unknown; checked ${hm(res.at)} ${tzLabel()}.</p>`;
  const age = Date.now() - newest;
  const warn = res.saved
    ? `<strong class="warn">Saved copy:</strong> the live feed is unavailable, showing data fetched ${dateTime(res.at)} ${tzLabel()}. `
    : age > staleMs ? `<strong class="warn">Stale:</strong> the newest ${what} is ${countdown(age)} old. ` : "";
  return `<p class="stamp">${warn}Source: ${src}. Newest ${what} ${dateTime(new Date(newest))} ${tzLabel()}; checked ${hm(res.at)} ${tzLabel()}.</p>`;
}
const SWPC = '<a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer">NOAA SWPC</a>';
const slimKp = (j) => parseKp(j).map((r) => ({ t: r.t.getTime(), kp: r.kp, status: r.status }));

function localMidnights(t0, t1) {
  const out = [];
  for (let t = Math.ceil(t0 / 3600e3) * 3600e3; t < t1; t += 3600e3) if (Number(fmt(new Date(t), { hour: "numeric", hourCycle: "h23" })) % 24 === 0) out.push(t);
  return out;
}
async function loadKp() {
  const el = $("kp");
  let obs, fc = null;
  try { obs = await cachedFeed("kp", ENDPOINTS.kp, slimKp); }
  catch { el.innerHTML = '<p class="warn">Kp index (NOAA SWPC) unavailable right now, and there is no saved copy.</p>'; return; }
  try { fc = await cachedFeed("kpf", ENDPOINTS.kpForecast, slimKp); } catch { /* forecast optional */ }
  const now = Date.now();
  const past = obs.data.filter((r) => r.t > now - 3 * 86400e3);
  const last = obs.data[obs.data.length - 1];
  const pred = fc ? fc.data.filter((r) => r.status !== "observed" && r.t > last.t && r.t < now + 72 * 3600e3) : [];
  const bars = [...past.map((r) => ({ ...r, predicted: false })), ...pred.map((r) => ({ ...r, predicted: true }))];
  const t0 = bars[0].t, t1 = bars[bars.length - 1].t + 3 * 3600e3;
  const days = localMidnights(t0, t1);
  const mx = pred.length ? pred.reduce((a, b) => (b.kp > a.kp ? b : a)) : null;
  const summary = `Latest planetary Kp ${last.kp.toFixed(2)} (${gScale(last.kp)}) for the 3 hours from ${dateTime(new Date(last.t))} ${tzLabel()}.${mx ? ` Highest predicted in the next 3 days: ${mx.kp.toFixed(2)} (${gScale(mx.kp)}) around ${dateTime(new Date(mx.t))}.` : " Forecast unavailable."}`;
  el.innerHTML = `<div class="kp-top">${kpGauge(last.kp, { title: `Gauge: latest Kp ${last.kp.toFixed(2)} of 9` })}
      <p><strong>Kp ${last.kp.toFixed(2)}</strong>, NOAA scale ${gScale(last.kp)} (${last.kp >= 5 ? "geomagnetic storm" : last.kp >= 4 ? "active" : "quiet"}).${mx ? ` Forecast peak ${mx.kp.toFixed(2)} (${gScale(mx.kp)}) around ${dateTime(new Date(mx.t))} ${tzLabel()}.` : ""}</p></div>
    ${kpBars(bars, { nowMs: now, days, label: (d) => fmt(new Date(d), { weekday: "short" }), title: `Kp bars, last 3 days observed and next 3 days predicted. ${summary} A table follows.` })}
    <p class="fine">Solid bars: observed. Faint dashed bars: NOAA forecast (estimated and predicted). Kp 5 or more (G1+) is a storm; aurora reaches lower latitudes as Kp rises.</p>
    ${feedStamp(SWPC + " planetary K-index" + (fc ? " and 3-day forecast" : ""), obs, last.t + 3 * 3600e3, 6 * 3600e3, "Kp period ended")}
    <details><summary>Kp as a table</summary><div class="scroll-x" tabindex="0" role="region" aria-label="Kp table"><table><caption>3-hour planetary Kp (${tzLabel()})</caption>
      <thead><tr><th scope="col">From</th><th scope="col">Kp</th><th scope="col">Scale</th><th scope="col">Status</th></tr></thead><tbody>
      ${bars.slice().reverse().map((b) => `<tr><td>${dateTime(new Date(b.t))}</td><td>${b.kp.toFixed(2)}</td><td>${gScale(b.kp)}</td><td>${b.predicted ? "predicted" : "observed"}</td></tr>`).join("")}</tbody></table></div></details>`;
}

const XRAY_BANDS = [["A", 1e-8], ["B", 1e-7], ["C", 1e-6], ["M", 1e-5], ["X", 1e-4]];
function hourTicks(t0, t1, stepH = 1) {
  const out = [];
  for (let t = Math.ceil(t0 / 3600e3) * 3600e3; t <= t1; t += 3600e3) {
    const h = Number(fmt(new Date(t), { hour: "numeric", hourCycle: "h23" })) % 24;
    if (h % stepH === 0) out.push({ t, label: fmt(new Date(t), { hour: "numeric" }).replace(/\s?(AM|PM)/, (m, p) => p[0].toLowerCase()) });
  }
  return out;
}
async function loadXray() {
  const el = $("xray");
  let res;
  try { res = await cachedFeed("xray", ENDPOINTS.xray, (j) => parseXray(j).map((r) => [r.t, r.flux])); }
  catch { el.innerHTML = '<p class="warn">Solar X-ray data (NOAA SWPC, GOES) unavailable right now, and there is no saved copy.</p>'; return; }
  const pts = res.data, last = pts[pts.length - 1];
  const t1 = last[0], t0 = t1 - 6 * 3600e3;
  const peak = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  const hourly = [];
  for (let t = t1; t > t0; t -= 3600e3) {
    const inH = pts.filter((p) => p[0] > t - 3600e3 && p[0] <= t);
    if (inH.length) { const m = inH.reduce((a, b) => (b[1] > a[1] ? b : a)); hourly.push({ from: t - 3600e3, to: t, m }); }
  }
  const summary = `Now ${xrayClass(last[1])} (${last[1].toExponential(1)} W/m²) at ${hm(new Date(last[0]))} ${tzLabel()}; 6-hour peak ${xrayClass(peak[1])} at ${hm(new Date(peak[0]))}.`;
  el.innerHTML = `<p><strong>${xrayClass(last[1])}</strong> now · 6 h peak <strong>${xrayClass(peak[1])}</strong> at ${hm(new Date(peak[0]))} ${tzLabel()}.</p>
    ${lineChart({ series: [{ pts, cls: "ln-x" }], t0, t1, y: { min: 1e-9, max: 1e-3, log: true },
      yTicks: [-8, -6, -4].map((e) => ({ v: 10 ** e, label: "1e" + e })),
      bands: XRAY_BANDS.map(([c, lo], i) => ({ from: lo, to: lo * 10, label: c, cls: i % 2 ? "b-odd" : "b-even" })),
      xTicks: hourTicks(t0, t1, 2), title: `GOES X-ray flux, 0.1–0.8 nm, last 6 hours, log scale with flare classes A to X. ${summary} A table follows.` })}
    <p class="fine">GOES 0.1–0.8 nm X-ray flux, log scale. Bands are flare classes: each letter is 10× the one before. M and X flares can cause radio blackouts on the day side.</p>
    ${feedStamp(SWPC + " GOES X-ray (primary satellite)", res, last[0], 15 * 60e3, "reading")}
    <details><summary>X-ray as a table</summary><div class="scroll-x" tabindex="0" role="region" aria-label="X-ray table"><table><caption>Hourly peak X-ray class (${tzLabel()})</caption>
      <thead><tr><th scope="col">Hour ending</th><th scope="col">Peak class</th><th scope="col">Flux (W/m²)</th></tr></thead><tbody>
      ${hourly.map((h) => `<tr><td>${hm(new Date(h.to))}</td><td>${xrayClass(h.m[1])}</td><td>${h.m[1].toExponential(2)}</td></tr>`).join("")}</tbody></table></div></details>`;
}

// Solar wind: the 1-minute files are large (about 95 KB gzipped each), so they load only when this panel is
// on screen, at most every 15 minutes, and only the last 2 hours from the active spacecraft are kept.
async function loadWind() {
  const el = $("wind");
  const [w, m] = await Promise.allSettled([
    cachedFeed("wind", ENDPOINTS.wind, (j) => parseRtsw(j, ["proton_speed", "proton_density"]), 30000),
    cachedFeed("mag", ENDPOINTS.mag, (j) => parseRtsw(j, ["bt", "bz_gsm"]), 30000),
  ]);
  if (w.status !== "fulfilled" && m.status !== "fulfilled") { el.innerHTML = '<p class="warn">Solar-wind data (NOAA SWPC real-time solar wind) unavailable right now, and there is no saved copy.</p>'; return; }
  const W = w.status === "fulfilled" ? w.value : null, M = m.status === "fulfilled" ? m.value : null;
  const ends = [W, M].filter(Boolean).map((x) => x.data.rows[x.data.rows.length - 1][0]);
  const t1 = Math.max(...ends), t0 = t1 - 2 * 3600e3;
  const lastOf = (res, i) => { if (!res) return null; for (let k = res.data.rows.length - 1; k >= 0; k--) if (res.data.rows[k][i] != null) return res.data.rows[k][i]; return null; };
  const col = (res, i) => (res ? res.data.rows.map((r) => [r[0], r[i]]) : []);
  const rng = (pts, pad, minSpan) => { const v = pts.map((p) => p[1]).filter((x) => x != null); if (!v.length) return { min: 0, max: 1 }; let lo = Math.min(...v), hi = Math.max(...v); if (hi - lo < minSpan) { const c = (hi + lo) / 2; lo = c - minSpan / 2; hi = c + minSpan / 2; } return { min: lo - pad, max: hi + pad }; };
  const ticks = (r, n = 3) => { const d = r.max - r.min < 10 ? 1 : 0, out = []; for (let i = 0; i < n; i++) { const v = r.min + ((r.max - r.min) * (i + 0.5)) / n; out.push({ v, label: v.toFixed(d) }); } return out; };
  const xt = hourTicks(t0, t1, 1);
  const sp = lastOf(W, 1), de = lastOf(W, 2), bt = lastOf(M, 1), bz = lastOf(M, 2);
  const val = (v, u, d = 0) => (v == null ? '<span class="muted">unavailable</span>' : `<strong>${v.toFixed(d)}</strong> ${u}`);
  const chart = (pts, r, cls, title, extra = []) => lineChart({ series: [{ pts, cls }, ...extra], t0, t1, y: r, yTicks: ticks(r), xTicks: xt, H: 78, title });
  const sR = rng(col(W, 1), 20, 60), dR = rng(col(W, 2), 0.5, 2), bR = rng([...col(M, 1), ...col(M, 2)], 1, 4);
  const summary = `Speed ${sp == null ? "unavailable" : sp.toFixed(0) + " km/s"}, density ${de == null ? "unavailable" : de.toFixed(1) + " per cm³"}, Bt ${bt == null ? "unavailable" : bt.toFixed(1) + " nT"}, Bz ${bz == null ? "unavailable" : bz.toFixed(1) + " nT"}.`;
  const rows10 = [];
  for (let t = t1; t > t0; t -= 10 * 60e3) {
    const near = (res) => (res ? res.data.rows.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a), res.data.rows[0]) : null);
    const a = near(W), b2 = near(M);
    rows10.push({ t, sp: a && Math.abs(a[0] - t) < 5 * 60e3 ? a[1] : null, de: a && Math.abs(a[0] - t) < 5 * 60e3 ? a[2] : null, bt: b2 && Math.abs(b2[0] - t) < 5 * 60e3 ? b2[1] : null, bz: b2 && Math.abs(b2[0] - t) < 5 * 60e3 ? b2[2] : null });
  }
  const cell = (v, d) => (v == null ? '<td class="muted">—</td>' : `<td>${v.toFixed(d)}</td>`);
  el.innerHTML = `<p>Speed ${val(sp, "km/s")} · density ${val(de, "/cm³", 1)} · Bt ${val(bt, "nT", 1)} · Bz ${val(bz, "nT", 1)}</p>
    <p class="viz-l">Speed (km/s)</p>${chart(col(W, 1), sR, "ln-a", `Solar wind speed, last 2 hours. ${summary}`)}
    <p class="viz-l">Density (protons/cm³)</p>${chart(col(W, 2), dR, "ln-b", "Solar wind density, last 2 hours.")}
    <p class="viz-l">Magnetic field Bt and Bz (dashed) (nT)</p>${chart(col(M, 1), bR, "ln-x", "Interplanetary magnetic field Bt and Bz, last 2 hours.", [{ pts: col(M, 2), cls: "ln-c dash" }])}
    <p class="fine">Measured at the L1 point, about an hour upstream of Earth. Fast wind (over 500 km/s) with Bz pointing south (negative) favours aurora.</p>
    ${W ? feedStamp(`${SWPC} real-time solar wind (plasma, ${esc(W.data.source)})`, W, W.data.rows[W.data.rows.length - 1][0], 30 * 60e3, "plasma reading") : '<p class="stamp"><strong class="warn">Unavailable:</strong> solar-wind plasma (speed, density).</p>'}
    ${M ? feedStamp(`${SWPC} real-time solar wind (magnetometer, ${esc(M.data.source)})`, M, M.data.rows[M.data.rows.length - 1][0], 30 * 60e3, "field reading") : '<p class="stamp"><strong class="warn">Unavailable:</strong> magnetic field (Bt, Bz).</p>'}
    <details><summary>Solar wind as a table</summary><div class="scroll-x" tabindex="0" role="region" aria-label="Solar wind table"><table><caption>Solar wind every 10 minutes (${tzLabel()})</caption>
      <thead><tr><th scope="col">Time</th><th scope="col">Speed km/s</th><th scope="col">Density /cm³</th><th scope="col">Bt nT</th><th scope="col">Bz nT</th></tr></thead><tbody>
      ${rows10.map((r) => `<tr><td>${hm(new Date(r.t))}</td>${cell(r.sp, 0)}${cell(r.de, 1)}${cell(r.bt, 1)}${cell(r.bz, 1)}</tr>`).join("")}</tbody></table></div></details>`;
}

// ---------- showers & events ----------
function renderShowers() {
  const list = upcomingShowers(new Date(), 100);
  const lat = state.loc.lat;
  $("showers").innerHTML = `<table><caption>Active now or starting within 100 days</caption>
    <thead><tr><th scope="col">Shower</th><th scope="col">Active</th><th scope="col">Peak ≈ (${tzLabel()})</th><th scope="col">ZHR</th><th scope="col">Moon at peak</th><th scope="col">Radiant max alt. here</th></tr></thead><tbody>
    ${list.map((s) => `<tr><th scope="row">${esc(s.name)}${s.active ? ' <span class="tag">active</span>' : ""}</th><td>${dateShortUTC(s.activeFrom)}–${dateShortUTC(new Date(s.activeTo - 86400e3))} UTC</td>
      <td>${dateTime(s.peak)}</td><td>${s.zhr}</td><td>${Math.round(s.moonIllum * 100)}%</td><td>${A.maxAltitude(s.dec, lat) > 0 ? deg(A.maxAltitude(s.dec, lat)) : '<span class="muted">never rises</span>'}${s.note ? `<br><span class="fine">${esc(s.note)}</span>` : ""}</td></tr>`).join("")}
    </tbody></table>`;
}
async function loadEvents() {
  try {
    const j = await getJson("data/events.json");
    state.events = j.events;
  } catch { state.events = null; }
  renderEvents();
}
function renderEvents() {
  nextCands = null;
  const el = $("events");
  if (!state.events) { el.innerHTML = "<li>Event list unavailable.</li>"; return; }
  const now = Date.now() - 86400e3;
  const up = state.events.filter((e) => Date.parse(e.date_utc) > now).slice(0, 10);
  el.innerHTML = up.length ? up.map((e) => `<li><time datetime="${esc(e.date_utc)}">${dateTime(new Date(e.date_utc))}</time> <strong>${esc(e.title)}</strong>: ${esc(e.details)} <span class="fine">${esc(e.visibility_note)} · <a href="${esc(e.source_url)}" target="_blank" rel="noopener noreferrer">source</a></span></li>`).join("")
    : "<li>There are no checked events in the list after today. Moon phases and meteor showers above are worked out live.</li>";
}

// ---------- sky chart ----------
const canvas = $("chart");
let drawQueued = false;
function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}
let lastScene = null;
function draw() {
  if (!state.sky) return;
  const t = viewTime();
  const css = getComputedStyle(document.documentElement);
  const showers = upcomingShowers(t, 0).filter((s) => s.active);
  const ph = A.moonPhase(t), moonAlt = A.bodyPosition("moon", t, state.loc.lat, state.loc.lon).alt;
  // "Bright Moon": over half lit and above the horizon. Meteor counts drop sharply then, so the radiant is drawn faint.
  const moonBright = ph.illum > 0.5 && moonAlt > 0;
  lastScene = drawChart(canvas, { t, lat: state.loc.lat, lon: state.loc.lon, sky: state.sky, sats: state.layers.sat ? state.satPos : [], layers: state.layers, showers, red: state.red, css, moonAge: ph.age, moonBright });
  renderUpList(lastScene, t);
  $("dome-moon").innerHTML = `${moonSvg(ph.age, ph.illum, 32)}<span>${esc(ph.name)}, ${(ph.illum * 100).toFixed(0)}% lit${moonAlt > 0 ? "" : " (below horizon)"}</span>`;
  $("dome-stamp").textContent = state.offsetMin === 0
    ? `Live, computed on your device. Drawn ${fmt(t, { hour: "numeric", minute: "2-digit", second: "2-digit" })} ${tzLabel()}${isPaused() ? " (paused)" : ""}.`
    : `Computed on your device for ${dayHm(t)} ${tzLabel()} (scrubbed ${state.offsetMin > 0 ? "ahead" : "back"}).`;
}
function renderUpList(scene, t) {
  $("up-time").textContent = `at ${dayHm(t)} ${tzLabel()}`;
  const items = scene.objects.filter((o) => (o.kind === "star" ? o.mag < 1.5 : o.kind !== "sat" || /sunlit/.test(o.label))).sort((a, b) => (a.kind === "radiant" ? -1 : 0) - (b.kind === "radiant" ? -1 : 0) || (a.mag ?? 9) - (b.mag ?? 9)).slice(0, 18);
  $("up-list").innerHTML = items.length ? items.map((o) => `<li>${esc(o.label)}: ${deg(o.alt)} up, ${A.compass(o.az)} (az ${deg(o.az)})</li>`).join("") : "<li>Nothing bright is above the horizon.</li>";
  canvas.setAttribute("aria-label", `All-sky chart for ${dayHm(t)} ${tzLabel()}, with ${scene.objects.length} objects above the horizon. The text list follows the chart.`);
}
function sliderLabel() {
  const v = Number($("time-slider").value);
  $("time-out").textContent = v === 0 ? "now" : `${v > 0 ? "+" : "−"}${Math.floor(Math.abs(v) / 60)}h${String(Math.abs(v) % 60).padStart(2, "0")} (${dayHm(viewTime())})`;
}
$("time-slider").addEventListener("input", (e) => { state.offsetMin = Number(e.target.value); sliderLabel(); requestDraw(); updateSatPositions(); });
$("now-btn").addEventListener("click", () => { $("time-slider").value = 0; state.offsetMin = 0; sliderLabel(); requestDraw(); updateSatPositions(); });
for (const [id, key] of [["l-const", "const"], ["l-ecl", "ecl"], ["l-sat", "sat"], ["l-rad", "rad"]]) {
  $(id).addEventListener("change", (e) => { state.layers[key] = e.target.checked; if (key === "sat") updateSatPositions(); requestDraw(); });
}
function showTip(ev) {
  if (!lastScene) return;
  const r = canvas.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * canvas.width, y = ((ev.clientY - r.top) / r.height) * canvas.height;
  const o = hitTest(lastScene, x, y, 14 * (canvas.width / r.width));
  const tip = $("tip");
  if (!o) { tip.hidden = true; return; }
  tip.textContent = `${o.label} · ${deg(o.alt)} up, ${A.compass(o.az)}${o.mag != null ? ` · mag ${o.mag.toFixed(1)}` : ""}`;
  tip.hidden = false;
  tip.style.left = `${Math.min(ev.clientX - r.left + 12, r.width - 180)}px`;
  tip.style.top = `${ev.clientY - r.top + 12}px`;
}
canvas.addEventListener("pointermove", showTip);
canvas.addEventListener("pointerdown", showTip);
canvas.addEventListener("pointerleave", () => { $("tip").hidden = true; });
new ResizeObserver(() => requestDraw()).observe(canvas);

// ---------- next-event countdown ----------
let nextCands = null;
function buildCandidates() {
  const { lat, lon } = state.loc, now = new Date(), out = [];
  for (const base of [now, new Date(now.getTime() + 20 * 3600e3)]) {
    const n = A.nightTimes(base, lat, lon);
    for (const [k, label] of [["sunset", "Sunset"], ["astroDusk", "Full darkness begins (astronomical dusk)"], ["astroDawn", "Full darkness ends (astronomical dawn)"], ["sunrise", "Sunrise"]]) {
      if (n[k]) out.push({ t: n[k], label, src: "computed" });
    }
  }
  const m = A.riseTransitSet("moon", now, lat, lon);
  if (m.rise) out.push({ t: m.rise, label: "Moonrise", src: "computed" });
  if (m.set) out.push({ t: m.set, label: "Moonset", src: "computed" });
  for (const p of (state.passes || []).filter((x) => x.norad === 25544 && x.visible)) out.push({ t: new Date(p.visStart), label: `Visible ISS pass, up to ${Math.round(p.maxEl)}°`, src: "computed from CelesTrak elements, ±1 min" });
  for (const e of state.events || []) out.push({ t: new Date(e.date_utc), label: e.title, src: "events list" });
  // de-duplicate the same event found from both search starts
  const seen = new Set();
  return out.filter((c) => { const key = c.label + Math.round(c.t / 60e3); if (seen.has(key)) return false; seen.add(key); return true; });
}
function renderCountdown() {
  if (!nextCands) nextCands = buildCandidates();
  const now = new Date();
  const up = nextAfter(nextCands, now, 3);
  if (up.length < 3) nextCands = null;
  const secs = !reducedMotion.matches && !isPaused();
  $("next-up").innerHTML = up.length ? `<strong>Next:</strong> ${up.map((c, i) => `<span class="nx${i ? "" : " nx-1"}">${esc(c.label)} in <span class="num">${countdown(c.t - now, secs && i === 0)}</span> <span class="fine">(${dayHm(c.t)} ${tzLabel()}, ${esc(c.src)})</span></span>`).join(" ")}` : "No upcoming events found.";
}

// ---------- pause ----------
const pauseBtn = $("pause-btn");
pauseBtn.addEventListener("click", () => setPaused(!isPaused()));
onPause((p) => {
  pauseBtn.setAttribute("aria-pressed", String(p));
  pauseBtn.textContent = p ? "Resume live updates" : "Pause live updates";
  document.documentElement.classList.toggle("is-paused", p);
  if (p) { renderCountdown(); requestDraw(); }
});

// ---------- boot ----------
function renderAll() {
  nextCands = null;
  $("loc-name").textContent = state.loc.name;
  $("tz-name").textContent = state.utc ? "UTC" : `Local (${shortTz()})`;
  $("tz-btn").setAttribute("aria-pressed", String(state.utc));
  $("lp-map").href = `https://www.lightpollutionmap.info/#zoom=9&lat=${state.loc.lat.toFixed(2)}&lon=${state.loc.lon.toFixed(2)}`;
  renderTwilight(); renderTwibar(); renderMoon(); renderPlanets(); renderShowers(); renderScore(); renderHourly(); sliderLabel();
  if (state.passes) renderPasses();
  if (state.events) renderEvents();
  requestDraw();
}

async function boot() {
  if (!globalThis.Astronomy) { status("The astronomy engine failed to load. Reload the page."); return; }
  applyTheme();
  renderAll();
  fetch("data/sky.json").then((r) => r.json()).then((s) => { state.sky = s; requestDraw(); }).catch(() => status("Star data failed to load. The chart shows planets only."));
  loadForecast(); loadEvents();
  // let first paint settle before the heavier satellite work
  setTimeout(runSatellites, 300);
  // One shared loop (js/live.js): paused when the tab is hidden, when Pause is pressed, or when the card is off screen.
  every("dome", 1000, () => { if (state.offsetMin === 0) draw(); }, { el: canvas, reducedMs: 60e3 });
  every("dome-sats", 10e3, () => { if (state.offsetMin === 0) updateSatPositions(); }, { el: canvas, reducedMs: 60e3, immediate: false });
  every("countdown", 1000, renderCountdown, { el: $("next-up"), reducedMs: 60e3 });
  every("iss", 10e3, pollIss, { el: mapCanvas, reducedMs: 60e3 });
  every("iss-track", 5 * 60e3, refreshTrack, { el: mapCanvas });
  every("aurora", 10 * 60e3, loadAurora, { el: mapCanvas });
  every("kp", 10 * 60e3, loadKp, { el: $("kp") });
  every("xray", 5 * 60e3, loadXray, { el: $("xray") });
  every("wind", 15 * 60e3, loadWind, { el: $("wind") });
  every("twibar", 60e3, moveTwiNow, { el: $("twibar"), immediate: false });
  every("cards", 5 * 60e3, () => { renderTwilight(); renderTwibar(); renderMoon(); renderPlanets(); renderScore(); renderCloudStrip(); nextCands = null; }, { immediate: false });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
boot();
