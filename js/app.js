// SKYHUD main module. Client-side only: no keys, no analytics, no third-party scripts.
import * as A from "./astro.js";
import { scoreHour, WEIGHTS, SCORE_VERSION, band } from "./score.js";
import { ENDPOINTS, forecastUrl, geocodeUrl, parseForecast, parseGeocode, parseKp, gScale, parseIssNow, parseTle } from "./feeds.js";
import { upcomingShowers, IMO_SOURCE } from "./showers.js";
import { drawChart, hitTest } from "./chart.js";
import { round2, geoErrorText, dateShortUTC, numCell, isRedShortcut } from "./util.js";

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
    const r = { ...l, lat: round2(l.lat), lon: round2(l.lon) };
    // An older version may have saved more precise coordinates: replace the stored copy with the rounded one.
    if (r.lat !== l.lat || r.lon !== l.lon) store.set("loc", r);
    return r;
  })(),
  utc: store.get("utc", false),
  red: store.get("red", false),
  rkey: store.get("rkey", true),
  dim: store.get("dim", 70),
  bortle: store.get("bortle", 5),
  offsetMin: 0,
  sky: null, forecast: null, forecastAt: null, forecastErr: null,
  tles: null, tleSource: null, passes: null, satPos: [], kp: null, events: [],
  layers: { const: true, ecl: true, sat: true, rad: true },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const tz = () => (state.utc ? "UTC" : state.loc.tz || Intl.DateTimeFormat().resolvedOptions().timeZone);
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
      setLocation({ name: `${lat.toFixed(2)}, ${lon.toFixed(2)} (device)`, lat, lon, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }); },
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
  state.loc = { name: loc.name, lat: round2(loc.lat), lon: round2(loc.lon), tz: loc.tz || null };
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
    const r = await fetch(url, { signal: ctl.signal, credentials: "omit", referrerPolicy: "strict-origin-when-cross-origin" });
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
    if (!state.loc.tz && json.timezone && json.timezone !== "GMT") { state.loc.tz = json.timezone; store.set("loc", state.loc); renderAll(); }
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
function renderScore() {
  const el = $("score");
  $("bortle").value = String(state.bortle);
  if (!state.forecast) {
    el.innerHTML = state.forecastErr ? `<p class="warn">${esc(state.forecastErr)}</p>` : '<div class="skel skel-score"></div>';
    return;
  }
  const rows = nightRows();
  if (!rows.length) {
    el.innerHTML = `<p>The forecast has no dark hours left for tonight here (the Sun stays above −6° or the night is over).</p>${staleNote()}`;
    return;
  }
  const scored = rows.filter((r) => r.res.score != null);
  if (!scored.length) { el.innerHTML = `<p class="warn">The forecast is missing fields the score needs, so no score is shown.</p>`; return; }
  const best = scored.reduce((a, b) => (b.res.score > a.res.score ? b : a));
  const avg = Math.round(scored.reduce((a, b) => a + b.res.score, 0) / scored.length);
  const b = best.res;
  const table = Object.keys(WEIGHTS).map((k) => `<tr><th scope="row">${FACTOR_LABEL[k]}</th><td>${WEIGHTS[k].toFixed(2)}</td><td>${b.sub[k].toFixed(2)}</td><td>${esc(factorInputs(k, best.inp))}</td></tr>`).join("");
  el.innerHTML = `
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
    </details>`;
}
function staleNote() {
  if (!state.forecastAt) return "";
  return `<p class="fine">Open-Meteo forecast fetched ${dateTime(state.forecastAt)} ${tzLabel()}.${state.forecastErr ? " " + esc(state.forecastErr) : ""}</p>`;
}

function renderHourly() {
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

function moonSvg(age, illum) {
  // Lit-portion drawing: terminator ellipse with x-radius r·|cos(phase)|. Northern-hemisphere orientation.
  const r = 28, k = Math.cos((age * Math.PI) / 180);
  const waxing = age < 180;
  const rx = Math.abs(k) * r;
  const sweepOuter = waxing ? 1 : 0;
  const sweepInner = (k > 0) === waxing ? 0 : 1;
  const d = `M32 4 A${r} ${r} 0 0 ${sweepOuter} 32 60 A${rx.toFixed(2)} ${r} 0 0 ${sweepInner} 32 4 Z`;
  return `<svg class="moon-svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="Moon ${Math.round(illum * 100)}% illuminated"><circle cx="32" cy="32" r="${r}" class="moon-dark"/><path d="${d}" class="moon-lit"/></svg>`;
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
    updateSatPositions();
  } catch (e) {
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
async function loadIssNow() {
  try {
    const i = parseIssNow(await getJson(ENDPOINTS.issNow, 8000));
    $("iss-now").textContent = `ISS right now: over ${i.lat.toFixed(1)}°, ${i.lon.toFixed(1)}° at ${i.altKm.toFixed(0)} km, ${i.visibility === "eclipsed" ? "in Earth's shadow" : "in sunlight"} (wheretheiss.at, ${hm(i.t)} ${tzLabel()}).`;
  } catch {
    $("iss-now").textContent = "The ISS live position (wheretheiss.at) is unavailable. The pass predictions below are worked out on your device.";
  }
}

// ---------- space weather ----------
async function loadKp() {
  const el = $("kp");
  try {
    const [obs, fc] = await Promise.allSettled([getJson(ENDPOINTS.kp), getJson(ENDPOINTS.kpForecast)]);
    if (obs.status !== "fulfilled") throw new Error("Kp unavailable");
    const rows = parseKp(obs.value);
    const last = rows[rows.length - 1];
    let fcHtml = "";
    if (fc.status === "fulfilled") {
      try {
        const f = parseKp(fc.value).filter((r) => r.status === "predicted" && r.t > new Date() && r.t < new Date(Date.now() + 72 * 3600e3));
        if (f.length) { const mx = f.reduce((a, b) => (b.kp > a.kp ? b : a)); fcHtml = `<p>Highest forecast Kp in the next 3 days: <strong>${mx.kp.toFixed(2)}</strong> (${gScale(mx.kp)}) around ${dateTime(mx.t)} ${tzLabel()}.</p>`; }
      } catch { /* forecast optional */ }
    }
    // Offline, the browser's HTTP cache can still answer, so say how old the data is.
    const endH = (Date.now() - (last.t.getTime() + 3 * 3600e3)) / 3600e3;
    const stale = !navigator.onLine || endH > 6
      ? `<p class="warn">${!navigator.onLine ? "Offline: this may be an earlier saved copy. " : ""}Data may be stale: the latest Kp period ended ${Math.max(0, endH).toFixed(0)} h ago.</p>` : "";
    el.innerHTML = `${stale}<p>Latest planetary Kp: <strong>${last.kp.toFixed(2)}</strong> (NOAA scale ${gScale(last.kp)}) for the 3 hours starting ${dateTime(last.t)} ${tzLabel()}.</p>${fcHtml}
      <p class="fine">Kp 5 or more (G1+) is a geomagnetic storm. Aurora reaches lower latitudes as Kp rises. See NOAA's <a href="https://www.swpc.noaa.gov/products/aurora-30-minute-forecast" target="_blank" rel="noopener noreferrer">30-minute aurora forecast</a>. Source: NOAA SWPC, checked ${dateTime(new Date())} ${tzLabel()}.</p>`;
  } catch {
    el.innerHTML = '<p class="warn">Space-weather data (NOAA SWPC) is unavailable right now.</p>';
  }
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
  lastScene = drawChart(canvas, { t, lat: state.loc.lat, lon: state.loc.lon, sky: state.sky, sats: state.layers.sat ? state.satPos : [], layers: state.layers, showers, red: state.red, css });
  renderUpList(lastScene, t);
}
function renderUpList(scene, t) {
  $("up-time").textContent = `at ${dayHm(t)} ${tzLabel()}`;
  const items = scene.objects.filter((o) => (o.kind === "star" ? o.mag < 1.5 : o.kind !== "sat" || /sunlit/.test(o.label))).sort((a, b) => (a.mag ?? 9) - (b.mag ?? 9)).slice(0, 18);
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

// ---------- boot ----------
function renderAll() {
  $("loc-name").textContent = state.loc.name;
  $("tz-name").textContent = state.utc ? "UTC" : `Local (${shortTz()})`;
  $("tz-btn").setAttribute("aria-pressed", String(state.utc));
  $("lp-map").href = `https://www.lightpollutionmap.info/#zoom=9&lat=${state.loc.lat.toFixed(2)}&lon=${state.loc.lon.toFixed(2)}`;
  renderTwilight(); renderMoon(); renderPlanets(); renderShowers(); renderScore(); renderHourly(); sliderLabel();
  if (state.passes) renderPasses();
  if (state.events) renderEvents();
  requestDraw();
}

async function boot() {
  if (!globalThis.Astronomy) { status("The astronomy engine failed to load. Reload the page."); return; }
  applyTheme();
  renderAll();
  fetch("data/sky.json").then((r) => r.json()).then((s) => { state.sky = s; requestDraw(); }).catch(() => status("Star data failed to load. The chart shows planets only."));
  loadForecast(); loadKp(); loadIssNow(); loadEvents();
  // let first paint settle before the heavier satellite work
  setTimeout(runSatellites, 300);
  setInterval(() => { if (state.offsetMin === 0) { requestDraw(); updateSatPositions(); } }, 60e3);
  setInterval(() => { renderTwilight(); renderMoon(); renderPlanets(); renderScore(); }, 5 * 60e3);
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
boot();
