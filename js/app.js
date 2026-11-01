// SKYHUD main module. Client-side only: no keys, no analytics, no third-party scripts.
import * as A from "./astro.js";
import { scoreHour, WEIGHTS, SCORE_VERSION, band, bestWindow, mainLimit, verdict, DEW_SPREAD_C, nightStatus } from "./score.js";
import { ENDPOINTS, DEFAULT_LOC, savedLoc, forecastUrl, geocodeUrl, parseForecast, parseGeocode, parseKp, gScale, parseIssNow, parseTle, parseXray, parseRtsw, cleanTrack, issReadingFresh, cloudPct, parseScales, parseAlerts, parseFlareProb } from "./feeds.js";
import { upcomingShowers, IMO_SOURCE } from "./showers.js";
import { drawChart, hitTest } from "./chart.js";
import { round2, geoErrorText, dateShortUTC, numCell, isRedShortcut, validTz, browserTz, countdown, nextAfter, twilightBand, toMs, runsText, tleShouldFetch, planAdvice } from "./util.js";
import { cloudStrip } from "./svgviz.js";
import { every, runSoon, setPaused, isPaused, onPause, reducedMotion } from "./live.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("skyhud." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("skyhud." + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem("skyhud." + k); } catch { /* blocked */ } },
};
const dlg = $("loc-dlg");


const state = {
  loc: (() => {
    const raw = store.get("loc", DEFAULT_LOC);
    if (raw === DEFAULT_LOC) return raw;
    const l = savedLoc(raw);
    if (!l) { store.del("loc"); return { ...DEFAULT_LOC }; } // unusable saved place (e.g. lat 999 or NaN)
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
  try { return dtf({ timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName").value; } catch { return tz(); }
}
// Building an Intl.DateTimeFormat is slow, and the page formats hundreds of times per render: reuse one per zone + options.
const dtfCache = new Map();
function dtf(opts) {
  const zone = tz(), key = zone + JSON.stringify(opts);
  let f = dtfCache.get(key);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: zone, ...opts }); dtfCache.set(key, f); }
  return f;
}
// Tonight's Sun crossings are asked for by several cards in one render; compute them once per minute and place.
let nightMemo = null;
function nightNow(lat, lon) {
  const key = `${Math.floor(Date.now() / 60e3)},${lat},${lon}`;
  if (!nightMemo || nightMemo.key !== key) nightMemo = { key, n: A.nightTimes(new Date(), lat, lon) };
  return nightMemo.n;
}
const fmt = (d, opts) => (d ? dtf(opts).format(d) : "—");
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
    const url = forecastUrl(lat, lon);
    // js/early.js may already have this exact request in flight; use it once, else fetch now.
    const early = globalThis.__skyhudEarlyForecast;
    globalThis.__skyhudEarlyForecast = null;
    const json = early && early.url === url ? await early.p : await getJson(url);
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
    state.forecastErr = stale ? (navigator.onLine === false ? "Offline: showing the saved forecast." : "The live forecast is unavailable right now (Open-Meteo returned an error or could not be reached): showing the saved forecast.") : null;
    if (!state.loc.tz && validTz(json.timezone) && json.timezone !== "GMT") { state.loc.tz = json.timezone; store.set("loc", state.loc); renderAll(); }
  } catch { state.forecast = null; state.forecastErr = "The forecast data had an unexpected format, so it isn't shown."; }
  renderScore();
  // The 24-hour table sits lower on the page: let the score card paint first.
  requestAnimationFrame(() => setTimeout(renderHourly, 0));
}

// ---------- score ----------
// Sun and Moon for one forecast hour depend only on the hour and the place; several cards score the same
// hours, so keep them (bounded) instead of recomputing per card.
const hourSky = new Map();
function hourInputs(row) {
  const { lat, lon } = state.loc;
  const k = `${+row.t},${lat},${lon}`;
  let sky = hourSky.get(k);
  if (!sky) {
    if (hourSky.size > 400) hourSky.clear();
    sky = { sunAlt: A.bodyPosition("sun", row.t, lat, lon).alt, moonAlt: A.bodyPosition("moon", row.t, lat, lon).alt, moonIllum: A.moonPhase(row.t).illum };
    hourSky.set(k, sky);
  }
  return { ...row, ...sky, bortle: state.bortle };
}
function nightRows() {
  if (!state.forecast) return [];
  const n = nightNow(state.loc.lat, state.loc.lon);
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
  renderGlance();
  $("bortle").value = String(state.bortle);
  if (!state.forecast) {
    put(state.forecastErr ? `<p class="warn">${esc(state.forecastErr)}</p>` : '<div class="skel skel-score"></div>');
    return;
  }
  const rows = nightRows();
  const night = nightStatus(rows.map((r) => r.res));
  if (night === "none") {
    put(`<p>The forecast has no dark hours left for tonight here (the Sun stays above −6° or the night is over).</p>${staleNote()}`);
    return;
  }
  const scored = rows.filter((r) => r.res.score != null);
  if (night === "incomplete") { put(`<p class="warn">The forecast is missing fields the score needs, so no score is shown.</p>${staleNote()}`); return; }
  const best = scored.reduce((a, b) => (b.res.score > a.res.score ? b : a));
  const avg = Math.round(scored.reduce((a, b) => a + b.res.score, 0) / scored.length);
  const b = best.res;
  const table = Object.keys(WEIGHTS).map((k) => `<tr><th scope="row">${FACTOR_LABEL[k]}</th><td>${WEIGHTS[k].toFixed(2)}</td><td>${b.sub[k].toFixed(2)}</td><td>${esc(factorInputs(k, best.inp))}</td></tr>`).join("");
  put(`
    <div class="score-num band-${b.band.toLowerCase()}"><span class="big">${b.score}</span><span class="band">${b.band}</span></div>
    <div class="score-meta">
      <p>Best hour: <strong>${dayHm(best.row.t)}</strong> ${tzLabel()}</p>
      <p>Average over ${scored.length} dark hour${scored.length > 1 ? "s" : ""}: <strong>${avg} (${band(avg)})</strong>${scored.length < rows.length ? ` <span class="muted">(${rows.length - scored.length} hour${rows.length - scored.length > 1 ? "s" : ""} with missing data excluded)</span>` : ""}</p>
      ${b.capped ? '<p class="warn">Capped at 10: cloud cover is 90% or more.</p>' : ""}
      ${staleNote()}
    </div>
    <details class="why"><summary>Why this score?</summary>
      <table><caption>${SCORE_VERSION} at the best hour. Score = 100 × Σ weight × sub-score. Our own heuristic.</caption>
      <thead><tr><th scope="col">Factor</th><th scope="col">Weight</th><th scope="col">Sub-score</th><th scope="col">Inputs</th></tr></thead><tbody>${table}</tbody></table>
    </details>`);
}
// "Tonight at a glance": the best window, Moon, full darkness and the score's main limit in one strip.
// Everything is computed on the device from the forecast already loaded; nothing new is fetched.
const LIMIT_TEXT = {
  clouds: (i) => `clouds (low ${i.cloudLow}%, mid ${i.cloudMid}%, high ${i.cloudHigh}%)`,
  moon: (i) => `the Moon (${Math.round(i.moonIllum * 100)}% lit, up)`,
  darkness: () => "twilight (the Sun is not far enough below the horizon)",
  light_pollution: (i) => `light pollution (your Bortle ${i.bortle} setting)`,
  transparency: (i) => `haze (visibility ${(i.visibility / 1000).toFixed(0)} km, humidity ${i.humidity}%)`,
  seeing_comfort: (i) => `wind or dew (wind ${i.wind} km/h, temperature ${(i.temp - i.dewPoint).toFixed(1)} °C above the dew point)`,
};
function renderGlance() {
  const el = $("glance");
  if (!el) return;
  const { lat, lon } = state.loc;
  const n = nightNow(lat, lon);
  const item = (k, v, png = false) => `<div class="glance-i"${png ? " data-png" : ""}><dt>${k}</dt><dd>${v}</dd></div>`;
  const dark = n.astroDusk && n.astroDawn ? `${hm(n.astroDusk)}–${hm(n.astroDawn)} <span class="muted">(${((n.astroDawn - n.astroDusk) / 3600e3).toFixed(1)} h)</span>` : "None tonight: the Sun stays above −18°";
  const from = (n.civilDusk || n.sunset || n.noon).getTime(), to = (n.civilDawn || n.sunrise || new Date(n.noon.getTime() + 86400e3)).getTime();
  const illum = A.moonPhase(new Date((from + to) / 2)).illum;
  const up = runsText(A.moonUpRuns(from, to, lat, lon), hm);
  const moon = `${Math.round(illum * 100)}% lit · ${up.length ? `up ${up.join(", ")}` : "below the horizon all night"}`;
  // `real` marks a best window and score worth putting on the share card (data-png); status lines stay off it.
  let best = `<span class="muted">${state.forecastErr ? "Cloud data unavailable" : "Waiting for the forecast"}</span>`, verdict = best, src, real = false;
  if (state.forecast) {
    const all = nightRows();
    const night = nightStatus(all.map((r) => r.res));
    const rows = all.filter((r) => r.res.score != null);
    const w = night === "scored" ? bestWindow(rows.map((r) => ({ t: r.row.t, score: r.res.score }))) : null;
    if (w) {
      real = true;
      const top = rows.reduce((a, b) => (b.res.score > a.res.score ? b : a)); // the best hour, as in the score below
      best = w.n > 1 ? `${hm(new Date(w.from))}–${hm(new Date(w.to))} <span class="muted">(${w.n} hours scoring ${w.low}–${w.peak})</span>` : `around ${hm(new Date(w.from))} <span class="muted">(score ${w.peak})</span>`;
      const lim = mainLimit(top.res.sub);
      const word = band(w.peak);
      verdict = `<span class="verdict v-${verdictKey(word)}"><span aria-hidden="true">${VERDICT_GLYPH[verdictKey(word)]}</span> ${w.peak} ${word}</span> · ${lim ? `main limit: ${esc(LIMIT_TEXT[lim](top.inp))}` : "nothing much holds it back"}`;
    } else if (night === "incomplete") {
      best = verdict = "<span class=\"muted\">Forecast incomplete: it is missing fields the score needs</span>";
    } else {
      best = verdict = "<span class=\"muted\">No dark hours left in the forecast tonight</span>";
    }
    // A saved copy (after an error like HTTP 500, or offline) is labelled here too, not only in the score card.
    src = `${state.forecastErr ? '<strong class="warn">Saved copy:</strong> ' : ""}Computed on your device (${SCORE_VERSION}) from the Open-Meteo forecast fetched ${dateTime(state.forecastAt)} ${tzLabel()}.${state.forecastErr ? " " + esc(state.forecastErr) : ""}`;
  } else {
    src = `Moon and darkness computed on your device. ${state.forecastErr ? esc(state.forecastErr) : "Waiting for the Open-Meteo forecast."}`;
  }
  el.innerHTML = `<h3 class="sr">Tonight at a glance</h3><dl class="glance-l">${item("Best window", best, real)}${item("Score", verdict, real)}${item("Moon", moon)}${item("Full darkness", dark)}</dl><p class="fine prov">${src}</p>`;
}
// Verdict words always come with a glyph and a word, never colour alone (red mode shows them by text only).
const VERDICT_GLYPH = { good: "●", ok: "◐", bad: "○" };
const verdictKey = (b) => (b === "Excellent" || b === "Good" ? "good" : b === "Fair" ? "ok" : "bad");
function staleNote() {
  if (!state.forecastAt) return "";
  return `<p class="fine">Open-Meteo forecast fetched ${dateTime(state.forecastAt)} ${tzLabel()}.${state.forecastErr ? " " + esc(state.forecastErr) : ""}</p>`;
}

// Only finite numbers count as forecast values; anything else (null, strings, NaN) is "no data".
const fin = cloudPct; // 0–100 or null (missing)
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
      <tr><th scope="row">Sky</th>${rows.map((x) => { const v = x.sun < -6 ? verdict(x.s.score) : null; return `<td>${v ? `<span class="verdict v-${v.key}"><span aria-hidden="true">${VERDICT_GLYPH[v.key]}</span> ${v.word}</span>` : x.sun < -6 ? "—" : '<span class="muted">day</span>'}</td>`; }).join("")}</tr>
      <tr><th scope="row">Score</th>${rows.map((x) => `<td class="${x.sun < -6 && x.s.band ? "b-" + x.s.band.toLowerCase() : ""}">${x.sun < -6 && x.s.score != null ? x.s.score : x.sun < -6 ? "—" : "day"}</td>`).join("")}</tr>
      <tr><th scope="row">Cloud %</th>${rows.map((x) => `<td>${cell(x.r.cloudTotal)}</td>`).join("")}</tr>
      <tr><th scope="row">Low/mid/high</th>${rows.map((x) => `<td>${cell(x.r.cloudLow)}/${cell(x.r.cloudMid)}/${cell(x.r.cloudHigh)}</td>`).join("")}</tr>
      <tr><th scope="row">Precip. %</th>${rows.map((x) => `<td>${cell(x.r.precip)}</td>`).join("")}</tr>
      <tr><th scope="row">Humidity %</th>${rows.map((x) => `<td>${cell(x.r.humidity)}</td>`).join("")}</tr>
      <tr><th scope="row">Wind km/h</th>${rows.map((x) => `<td>${cell(x.r.wind)}</td>`).join("")}</tr>
      <tr><th scope="row">Temp °C</th>${rows.map((x) => `<td>${cell(x.r.temp)}</td>`).join("")}</tr>
      <tr><th scope="row">Above dew pt °C</th>${rows.map((x) => { const d = Number.isFinite(x.r.temp) && Number.isFinite(x.r.dewPoint) ? Math.round((x.r.temp - x.r.dewPoint) * 10) / 10 : null; return `<td>${d == null ? "—" : d <= DEW_SPREAD_C ? `<strong>${d} dew</strong>` : d}</td>`; }).join("")}</tr>
      <tr><th scope="row">Visibility km</th>${rows.map((x) => `<td>${Number.isFinite(x.r.visibility) ? Math.round(x.r.visibility / 1000) : "—"}</td>`).join("")}</tr>
    </tbody></table>
    <p class="fine prov">Sky row computed on your device (${SCORE_VERSION}): <span class="verdict v-good"><span aria-hidden="true">${VERDICT_GLYPH.good}</span> Good</span> = score 60+, <span class="verdict v-ok"><span aria-hidden="true">${VERDICT_GLYPH.ok}</span> OK</span> = 40–59, <span class="verdict v-bad"><span aria-hidden="true">${VERDICT_GLYPH.bad}</span> Poor</span> = under 40; shown only when the Sun is below −6°. “dew” = air within ${DEW_SPREAD_C} °C of its dew point, so lenses may fog.</p>`;
  $("wx-stamp").textContent = `Fetched ${dateTime(state.forecastAt)} ${tzLabel()}.`;
}

// ---------- darkness & moon ----------
const sgnDeg = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}°`;
function renderTwilight() {
  const { lat, lon } = state.loc;
  const n = nightNow(lat, lon);
  const row = (label, d, missing) => `<tr><th scope="row">${label}</th><td>${d ? dayHm(d) : `<span class="muted">${missing}</span>`}</td></tr>`;
  const ph = A.photoHours(n, lat, lon);
  const span = (r) => (r.from && r.to ? `${hm(r.from)}–${hm(r.to)}` : r.to ? `until ${hm(r.to)}` : r.from ? `from ${hm(r.from)}` : '<span class="muted">doesn\'t happen</span>');
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
  </tbody></table>
  <table><caption>Golden &amp; blue hour (${tzLabel()})</caption><tbody>
    ${[["Evening golden hour", ph.eveningGolden], ["Evening blue hour", ph.eveningBlue], ["Morning blue hour", ph.morningBlue], ["Morning golden hour", ph.morningGolden]]
      .map(([l, r]) => `<tr><th scope="row">${l}</th><td>${span(r)}</td></tr>`).join("")}
  </tbody></table>
  <p class="fine">Computed on your device. Golden hour here is the Sun between ${sgnDeg(A.PHOTO.GOLDEN_TOP)} and ${sgnDeg(A.PHOTO.GOLDEN_BOTTOM)}, blue hour between ${sgnDeg(A.PHOTO.GOLDEN_BOTTOM)} and ${sgnDeg(A.PHOTO.BLUE_BOTTOM)} (photographers' definitions vary). Clouds and terrain change the real light.</p>`;
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
  const n = nightNow(lat, lon);
  const t0 = n.noon.getTime(), span = 86400e3;
  const pct = (t) => (((t - t0) / span) * 100).toFixed(2);
  const w = (a, b) => (((b - a) / span) * 100).toFixed(2);
  const { bands, exact } = A.darknessBands(n, t0, t0 + span, lat, lon);
  const moonUp = A.moonUpRuns(t0, t0 + span, lat, lon);
  const illum = A.moonPhase(new Date(t0 + span / 2)).illum;
  const ticks = [];
  for (let h = 0; h <= 24; h += 3) ticks.push(`<span class="tw-tick${h % 6 ? " tw-odd" : ""}" data-l="${pct(t0 + h * 3600e3)}">${esc(fmt(new Date(t0 + h * 3600e3), { hour: "numeric" }))}</span>`);
  const summary = runsText(bands, hm, (b) => `${BAND_NAME[b.v]} `).join("; ");
  const moonText = runsText(moonUp, hm);
  $("twibar").innerHTML = `<p class="fine">Darkness timeline, ${esc(dateShort(new Date(t0)))} midday to midday (${tzLabel()}). Computed on your device${exact ? "" : "; approximate, to the minute"}.</p>
    <div class="tw" role="img" aria-label="${esc(`Darkness timeline: ${summary}. Moon up: ${moonText.length ? moonText.join(", ") : "not tonight"}.${exact ? "" : " Times are approximate (to the minute)."} Times are in the table below.`)}">
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
const km = (x) => `${Math.round(x).toLocaleString("en-US")} km`;
const libText = (v, pos, neg) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? pos : neg}`;
function renderMoon() {
  const { lat, lon } = state.loc;
  const now = new Date();
  const p = A.moonPhase(now);
  const rts = A.riseTransitSet("moon", new Date(now.getTime() - 2 * 3600e3), lat, lon);
  const pos = A.bodyPosition("moon", now, lat, lon);
  const phases = A.nextPhases(now, 4);
  const d = A.moonDetail(now);
  $("moon").innerHTML = `<div class="moon-head">${moonSvg(p.age, p.illum)}<div><p><strong>${p.name}</strong>, ${(p.illum * 100).toFixed(0)}% lit</p>
    <p class="fine">Now ${pos.alt > 0 ? `${deg(pos.alt)} up in the ${A.compass(pos.az)}` : "below the horizon"}</p></div></div>
    <table><caption>Moon times (${tzLabel()})</caption><tbody>
    <tr><th scope="row">Moonrise</th><td>${rts.rise ? dayHm(rts.rise) : `<span class="muted">${rts.state || "none in 24 h"}</span>`}</td></tr>
    <tr><th scope="row">Moonset</th><td>${rts.set ? dayHm(rts.set) : `<span class="muted">${rts.state || "none in 24 h"}</span>`}</td></tr>
    ${phases.map((x) => `<tr><th scope="row">${x.name}</th><td>${dateTime(x.date)}</td></tr>`).join("")}
    </tbody></table>
    <table><caption>Moon distance &amp; libration (computed on your device)</caption><tbody>
    <tr><th scope="row">Distance now</th><td>${km(d.distKm)} (${(d.diamDeg * 60).toFixed(1)}′ across)</td></tr>
    ${[d.perigee, d.apogee].sort((a, b) => a.date - b.date).map((x) => `<tr><th scope="row">Next ${x === d.perigee ? "perigee (closest)" : "apogee (farthest)"}</th><td>${dateTime(x.date)}, ${km(x.distKm)}</td></tr>`).join("")}
    <tr><th scope="row">Libration</th><td>${libText(d.libLon, "E", "W")}, ${libText(d.libLat, "N", "S")}</td></tr>
    </tbody></table>
    <p class="fine">Libration is the Moon's slow wobble as seen from Earth: these angles say which edge is tipped toward you (positive longitude east, latitude north, in lunar coordinates), so features near that limb are easier to see. The Moon's apparent size changes about 14% between apogee and perigee.</p>`;
}

// ---------- planets ----------
// Tonight's highest point for each object between civil dusk and civil dawn (from now if the night has begun),
// sampled every 10 minutes, feeds the plain-language advice column. Computed on the device.
function tonightBest(k, lat, lon) {
  const n = nightNow(lat, lon);
  const dusk = n.civilDusk || n.sunset, dawn = n.civilDawn || n.sunrise;
  if (!dusk && !dawn && A.bodyPosition("sun", n.noon, lat, lon).alt > -6) return { none: "day" }; // polar day / white night
  const from = Math.max((dusk || n.noon).getTime(), Date.now() - 15 * 60e3), to = (dawn || new Date(n.noon.getTime() + 86400e3)).getTime();
  let best = null;
  for (let t = from; t <= to; t += 10 * 60e3) {
    const p = A.bodyPosition(k, new Date(t), lat, lon);
    if (!best || p.alt > best.alt) best = { alt: p.alt, az: p.az, t };
  }
  return best;
}
function renderPlanets() {
  const { lat, lon } = state.loc;
  const now = new Date();
  const start = new Date(now.getTime() - 3 * 3600e3);
  const sunNow = A.bodyPosition("sun", now, lat, lon);
  const rows = ["moon", ...A.PLANET_KEYS].map((k) => {
    const pos = A.bodyPosition(k, now, lat, lon);
    const ill = A.bodyIllumination(k, now);
    const rts = A.riseTransitSet(k, start, lat, lon);
    const elong = A.separation(pos.ra, pos.dec, sunNow.ra, sunNow.dec);
    const tb = tonightBest(k, lat, lon);
    const advice = tb?.none ? "No dark sky tonight (the Sun stays above −6°)" : planAdvice({ mag: ill.mag, elong: k === "moon" ? 90 : elong, maxAlt: tb && tb.alt > 0 ? tb.alt : null, dir: tb ? A.compass(tb.az) : "", when: tb ? `around ${hm(new Date(tb.t))}` : "" });
    return `<tr><th scope="row">${A.bodyName(k)}</th><td>${ill.mag.toFixed(1)}</td>
      <td>${pos.alt > 0 ? `${deg(pos.alt)} ${A.compass(pos.az)}` : '<span class="muted">down</span>'}</td>
      <td>${rts.rise ? hm(rts.rise) : "—"}</td><td>${rts.set ? hm(rts.set) : "—"}</td><td>${k === "moon" ? "—" : `${deg(elong)}${elong < 15 ? ' <span class="muted">(too near Sun)</span>' : ""}`}</td>
      <td class="advice">${esc(advice)}</td></tr>`;
  }).join("");
  $("planets").innerHTML = `<table><caption>Now and the next 24 h (${tzLabel()}). Mag = visual magnitude; lower is brighter.</caption>
    <thead><tr><th scope="col">Object</th><th scope="col">Mag</th><th scope="col">Now</th><th scope="col">Rise</th><th scope="col">Set</th><th scope="col">From Sun</th><th scope="col">Tonight (computed)</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="fine prov">“Tonight” is computed on your device: each object's highest point between civil dusk and dawn, with plain advice. Thresholds are listed under About.</p>`;
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
  const fresh = cached && Date.now() - cached.at < 6 * 3600e3;
  if (tleShouldFetch(cached && cached.at, store.get("tleFail", null), Date.now())) {
    try {
      const text = await getText(ENDPOINTS.tle);
      const list = parseTle(text);
      if (list.length < 10) throw new Error("too few element sets");
      store.set("tle", { at: Date.now(), text });
      store.del("tleFail");
      return { list, source: "CelesTrak", at: new Date() };
    } catch {
      store.set("tleFail", Date.now());
    }
  }
  if (cached && cached.text) {
    const list = parseTle(cached.text);
    if (list.length >= 10) return { list, source: fresh ? "CelesTrak (cached)" : "CelesTrak (saved copy; CelesTrak unreachable, retrying within the hour)", at: new Date(cached.at) };
  }
  const text = await getText("catalog.tle");
  return { list: parseTle(text), source: "bundled copy (CelesTrak unreachable, retrying within the hour)", at: null };
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
    if (state.tles) runSoon("iss-track"); // pass prediction failed, but the ISS track may still be computable
    else if (space) space.issTrackUnavailable();
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
// ISS map and space-weather panels live in js/space.js, loaded after the forecast (or when scrolled near).
function hourTicks(t0, t1, stepH = 1) {
  const out = [];
  for (let t = Math.ceil(t0 / 3600e3) * 3600e3; t <= t1; t += 3600e3) {
    const h = Number(fmt(new Date(t), { hour: "numeric", hourCycle: "h23" })) % 24;
    if (h % stepH === 0) out.push({ t, label: fmt(new Date(t), { hour: "numeric" }).replace(/\s?(AM|PM)/, (m, p) => p[0].toLowerCase()) });
  }
  return out;
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

let skyEvCache = null;
function renderSkyEvents() {
  const { lat, lon } = state.loc;
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${new Date().toDateString()}`;
  if (!skyEvCache || skyEvCache.key !== key) skyEvCache = { key, list: A.skyEvents(new Date(), lat, lon, 365) };
  const list = skyEvCache.list.filter((e) => e.t > Date.now() - 6 * 3600e3).slice(0, 12);
  $("sky-events").innerHTML = list.length ? list.map((e) => `<li><time datetime="${new Date(e.t).toISOString()}">${dateTime(new Date(e.t))}</time> <strong>${esc(e.title)}</strong>: ${esc(e.detail)}</li>`).join("")
    : "<li>No computed events in the next 12 months.</li>";
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
// Share card (js/share.js): the dome canvas plus a caption, made and saved on the device. Loaded on first click.
$("png-btn").addEventListener("click", () => {
  import("./share.js").then((m) => m.savePng({ $, state, canvas, viewTime, dayHm, tzLabel, status }))
    .catch(() => status("Couldn't load the image tool. Check the connection and try again."));
});

const pauseBtn = $("pause-btn");
pauseBtn.addEventListener("click", () => setPaused(!isPaused()));
onPause((p) => {
  pauseBtn.setAttribute("aria-pressed", String(p));
  pauseBtn.textContent = p ? "Resume live updates" : "Pause live updates";
  document.documentElement.classList.toggle("is-paused", p);
  if (p) { renderCountdown(); requestDraw(); }
});


// ---------- ISS map & space weather (lazy) ----------
// Same-origin dynamic import (CSP script-src 'self'); the panels keep their loading text until it arrives.
let space = null, spaceLoading = null;
const SPACE_PANELS = ["scales", "kp", "xray", "wind"];
function loadSpace() {
  if (!spaceLoading) spaceLoading = import("./space.js").then((m) => { space = m; m.start(); }).catch(() => { spaceLoading = null; spaceFailed(); });
  return spaceLoading;
}
// The panels' code didn't arrive (offline before it was cached, a blocked file): say so in each panel instead
// of leaving "Loads when on screen." and a shimmering skeleton up forever, and offer a retry.
function spaceFailed() {
  status("The ISS map and space-weather panels failed to load. Use Try again, or reload.");
  for (const id of SPACE_PANELS) if ($(id)) $(id).innerHTML = '<p class="warn">This panel failed to load. <button type="button" class="chip" data-space-retry>Try again</button></p>';
  if ($("map-stamp")) $("map-stamp").textContent = "The ISS map failed to load. Use Try again in the space-weather card, or reload.";
  if ($("iss-now")) $("iss-now").textContent = "ISS live position unavailable: the map failed to load.";
}
document.addEventListener("click", (e) => {
  if (!e.target.closest?.("[data-space-retry]")) return;
  for (const id of SPACE_PANELS) if ($(id)) $(id).innerHTML = '<p class="fine">Loading…</p>';
  loadSpace();
});
export { $, state, store, esc, fmt, hm, dateTime, tzLabel, getJson, sat, VERDICT_GLYPH, hourTicks };

// ---------- boot ----------
function renderAll(firstPaint = false) {
  nextCands = null;
  $("loc-name").textContent = state.loc.name;
  $("tz-name").textContent = state.utc ? "UTC" : `Local (${shortTz()})`;
  $("tz-btn").setAttribute("aria-pressed", String(state.utc));
  $("lp-map").href = `https://www.lightpollutionmap.info/#zoom=9&lat=${state.loc.lat.toFixed(2)}&lon=${state.loc.lon.toFixed(2)}`;
  renderScore(); sliderLabel();
  const rest = [renderTwilight, renderTwibar, renderMoon, renderPlanets, renderShowers, renderHourly,
    () => { if (state.passes) renderPasses(); if (state.events) renderEvents(); }, renderSkyEvents];
  // On first load, paint the score card first, then fill the heavier cards (rise/set searches, a year of
  // computed events) one per task after that paint, so no single long task holds up the page. Later
  // re-renders stay synchronous.
  if (firstPaint) {
    const step = () => { const f = rest.shift(); if (f) { f(); setTimeout(step, 0); } };
    requestAnimationFrame(() => setTimeout(step, 0));
  } else rest.forEach((f) => f());
  requestDraw();
}

async function boot() {
  if (!globalThis.Astronomy) { status("The astronomy engine failed to load. Reload the page."); return; }
  applyTheme();
  renderAll(true);
  // The forecast drives the score card at the top, so its request goes first; star data, the events list and
  // the satellite download (larger, lower on the page) follow once it lands and paints, or after 1.5 s if it is slow.
  const wx = loadForecast();
  const later = () => {
    fetch("data/sky.json").then((r) => r.json()).then((s) => { state.sky = s; requestDraw(); }).catch(() => status("Star data failed to load. The chart shows planets only."));
    loadEvents();
    setTimeout(runSatellites, 300);
    loadSpace();
  };
  // Scrolling to the map or space-weather cards before that loads them straight away.
  if ("IntersectionObserver" in globalThis) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); loadSpace(); } }, { rootMargin: "600px 0px" });
    for (const id of ["map", ...SPACE_PANELS]) if ($(id)) io.observe($(id));
  }
  // Wait one frame past the forecast so the score card paints before these requests and their parsing start.
  Promise.race([wx, new Promise((r) => setTimeout(r, 1500))]).catch(() => {})
    .then(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))).then(later);
  // One shared loop (js/live.js): paused when the tab is hidden, when Pause is pressed, or when the card is off screen.
  every("dome", 1000, () => { if (state.offsetMin === 0) draw(); }, { el: canvas, reducedMs: 60e3 });
  every("dome-sats", 10e3, () => { if (state.offsetMin === 0) updateSatPositions(); }, { el: canvas, reducedMs: 60e3, immediate: false });
  every("countdown", 1000, renderCountdown, { el: $("next-up"), reducedMs: 60e3 });
  every("twibar", 60e3, moveTwiNow, { el: $("twibar"), immediate: false });
  every("cards", 5 * 60e3, () => { renderTwilight(); renderTwibar(); renderMoon(); renderPlanets(); renderScore(); renderCloudStrip(); nextCands = null; }, { immediate: false });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
boot();
