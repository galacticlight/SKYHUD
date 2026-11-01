// SKYHUD ISS map and space-weather panels (NOAA SWPC Kp, X-rays, scales/alerts/flare odds, solar wind, OVATION
// aurora). Loaded by app.js with a same-origin dynamic import after the forecast lands, or as soon as one of
// these cards is scrolled near, so the score card at the top isn't waiting on this code.
import { $, state, store, esc, fmt, hm, dateTime, tzLabel, getJson, sat, VERDICT_GLYPH, hourTicks } from "./app.js";
import { ENDPOINTS, parseKp, gScale, parseIssNow, parseXray, parseRtsw, cleanTrack, issReadingFresh, parseScales, parseAlerts, parseFlareProb, flareStale, FLARE_STALE_DAYS } from "./feeds.js";
import { dateShortUTC, countdown, toMs } from "./util.js";
import { drawMap, parseOvation, auroraAt, auroraSectors } from "./map.js";
import { kpBars, kpGauge, lineChart, xrayClass } from "./svgviz.js";
import { every } from "./live.js";
// ---------- Earth map: ISS ----------
// Live dot from wheretheiss.at, polled every 10 s while the map is on screen (their limit is about 1 request/s).
// The ground track is computed here with SGP4 from CelesTrak elements. If the live feed is down or stale,
// the dot falls back to the computed position and says so.
const mapCanvas = $("map");
const iss = { live: null, liveAt: 0, track: [], trackErr: "", coast: null, coastState: "idle", aurora: null };
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
  if (!state.tles) return; // still waiting for the orbital elements
  const tle = state.tles.find((x) => x.norad === 25544);
  iss.trackErr = "";
  if (!tle) {
    iss.track = [];
    iss.trackErr = "the orbital elements have no entry for the ISS";
  } else {
    const now = Date.now();
    try {
      iss.track = cleanTrack(await sat("track", { tle: { l1: tle.l1, l2: tle.l2 }, from: now - 45 * 60e3, to: now + 95 * 60e3, stepMin: 1 }));
      iss.trackEpoch = tle.epoch;
      if (!iss.track.length) iss.trackErr = "the ground-track calculation returned no usable points";
    } catch {
      iss.track = [];
      iss.trackErr = "the ground-track calculation failed";
    }
  }
  iss.trackTried = true;
  renderIss();
}
function computedIss() {
  const now = Date.now();
  let best = null;
  for (const p of cleanTrack(iss.track)) if (!best || Math.abs(p.t - now) < Math.abs(best.t - now)) best = p;
  return best && Math.abs(best.t - now) <= 60e3 ? { ...best, computed: true } : null;
}
function renderIss() {
  if (!iss.coast && iss.coastState === "idle") {
    iss.coastState = "loading";
    getJson("data/coast110.json").then((c) => { iss.coast = c; iss.coastState = "ok"; renderIss(); }).catch(() => { iss.coastState = "failed"; });
  }
  const fresh = !!iss.live && issReadingFresh(iss.live.t, Date.now(), ISS_STALE_MS);
  const pos = fresh ? { lat: iss.live.lat, lon: iss.live.lon } : computedIss();
  drawMap(mapCanvas, { coast: iss.coast, track: iss.track, iss: pos, home: state.loc, aurora: iss.aurora, red: state.red, dim: state.red ? state.dim / 100 : 1, css: getComputedStyle(document.documentElement) });
  // Time of day for today's readings; an older (or future-dated) reading also gets its date, and the year if it differs.
  const at = (d) => {
    const day = (x) => fmt(x, { year: "numeric", month: "numeric", day: "numeric" });
    const today = day(d) === day(new Date());
    const thisYear = fmt(d, { year: "numeric" }) === fmt(new Date(), { year: "numeric" });
    return `${fmt(d, { ...(today ? {} : { month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }) }), hour: "numeric", minute: "2-digit", second: "2-digit" })} ${tzLabel()}`;
  };
  let line;
  if (fresh) line = `ISS over ${iss.live.lat.toFixed(1)}°, ${iss.live.lon.toFixed(1)}°${iss.live.altKm != null ? ` at ${iss.live.altKm.toFixed(0)} km` : ""}, ${iss.live.visibility === "eclipsed" ? "in Earth's shadow" : "in sunlight"}. Source: wheretheiss.at, updated ${at(iss.live.t)}. Position approximate.`;
  else if (pos) line = `${iss.live ? `Live ISS feed is stale (its latest reading is stamped ${at(iss.live.t)}). ` : "Live ISS feed (wheretheiss.at) unavailable. "}Showing the position computed on your device from CelesTrak elements: ${pos.lat.toFixed(1)}°, ${pos.lon.toFixed(1)}°. Approximate.`;
  else if (!iss.liveTried || (!iss.trackTried && !(state.satFailed && !state.tles))) line = "Loading the ISS position: waiting for the live feed (wheretheiss.at) and the orbital elements.";
  else {
    const feed = iss.live ? `the live feed (wheretheiss.at) is stale (latest reading stamped ${at(iss.live.t)})` : "the live feed (wheretheiss.at) did not answer";
    const calc = !state.tles ? "no orbital elements are loaded yet"
      : iss.trackErr ? iss.trackErr
      : "the computed track does not cover the current time";
    line = `ISS position unavailable: ${feed} and ${calc}.`;
  }
  const loading = !fresh && !pos && line.startsWith("Loading");
  $("map-stamp").innerHTML = loading ? esc(line) : `${fresh ? "" : '<strong class="warn">' + (pos ? "Computed" : "Unavailable") + ":</strong> "}${esc(line)}`;
  $("iss-now").textContent = line;
  const future = cleanTrack(iss.track).filter((p) => p.t >= Date.now() - 30e3).filter((_, i) => i % 10 === 0).slice(0, 10);
  $("track-table").innerHTML = future.length ? `<table><caption>ISS ground track, computed (SGP4, CelesTrak elements${iss.trackEpoch ? `, epoch ${esc(dateTime(iss.trackEpoch))} ${tzLabel()}` : ""}). Approximate.</caption>
    <thead><tr><th scope="col">Time (${tzLabel()})</th><th scope="col">Latitude</th><th scope="col">Longitude</th><th scope="col">Height</th></tr></thead><tbody>
    ${future.map((p) => `<tr><td>${hm(new Date(p.t))}</td><td>${p.lat.toFixed(1)}°</td><td>${p.lon.toFixed(1)}°</td><td>${p.altKm.toFixed(0)} km</td></tr>`).join("")}</tbody></table>`
    : `<p>${!state.tles ? "Ground track unavailable until the orbital elements load." : iss.trackErr ? `Ground track unavailable: ${esc(iss.trackErr)}.` : "Ground track unavailable for the current time."}</p>`;
  mapCanvas.setAttribute("aria-label", `World map. ${[line, iss.auroraText, future.length ? "Dashed line: the next 95 minutes of ground track; solid: the last 45." : "", "Cross: your location.", future.length ? "A table of the track follows." : ""].filter(Boolean).join(" ")}`);
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
  newest = toMs(newest); // callers pass epoch ms; a Date is accepted too
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

// NOAA space weather scales (R radio blackouts, S solar radiation storms, G geomagnetic storms), the latest alerts
// and flare odds. Same origin as the other SWPC feeds; each feed shows "unavailable" on its own.
const SCALE_WORD = ["none", "minor", "moderate", "strong", "severe", "extreme"];
const SCALE_NAME = { R: "Radio blackouts", S: "Solar radiation storm", G: "Geomagnetic storm" };
const scaleKey = (n) => (n == null ? null : n === 0 ? "good" : n <= 2 ? "ok" : "bad");
function scaleBadge(k, n) {
  if (n == null) return `<span class="scale-b"><span class="muted">${k}: unavailable</span></span>`;
  const v = scaleKey(n);
  return `<span class="scale-b verdict v-${v}" title="${SCALE_NAME[k]}"><span aria-hidden="true">${VERDICT_GLYPH[v]}</span> ${k}${n} ${SCALE_WORD[n]}<span class="sr"> (${SCALE_NAME[k]})</span></span>`;
}
const utcDayLabel = (d) => (/^\d{4}-\d\d-\d\d$/.test(d) ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : "—");
const pc = (v) => (v == null ? "—" : `${v}%`);
async function loadScales() {
  const el = $("scales");
  const [sc, al, fp] = await Promise.allSettled([
    cachedFeed("scales", ENDPOINTS.scales, parseScales),
    cachedFeed("alerts", ENDPOINTS.alerts, (j) => parseAlerts(j)),
    cachedFeed("flareprob", ENDPOINTS.flareProb, (j) => parseFlareProb(j)),
  ]);
  const un = (what) => `<p class="warn">${what} (NOAA SWPC) unavailable right now, and there is no saved copy.</p>`;
  let html = "";
  if (sc.status === "fulfilled") {
    const d = sc.value.data;
    html += `<p class="scales">${["R", "S", "G"].map((k) => scaleBadge(k, d.now[k])).join(" ")}</p>
      ${d.prev ? `<p class="fine">Previous UTC day's highest: ${["R", "S", "G"].map((k) => `${k}${d.prev[k] ?? "?"}`).join(" · ")}.</p>` : ""}
      <div class="scroll-x" tabindex="0" role="region" aria-label="NOAA 3-day outlook table"><table><caption>NOAA 3-day outlook (days are UTC dates)</caption>
        <thead><tr><th scope="col">Day</th><th scope="col">R1–R2 chance</th><th scope="col">R3+ chance</th><th scope="col">S1+ chance</th><th scope="col">G expected</th></tr></thead><tbody>
        ${d.days.map((x) => `<tr><th scope="row">${utcDayLabel(x.date)}</th><td>${pc(x.rMinor)}</td><td>${pc(x.rMajor)}</td><td>${pc(x.s)}</td><td>${x.g == null ? "—" : `G${x.g} ${SCALE_WORD[x.g]}`}</td></tr>`).join("")}</tbody></table></div>
      ${feedStamp(SWPC + " space weather scales", sc.value, d.issued, 6 * 3600e3, "update")}`;
  } else html += un("NOAA scales");
  if (fp.status === "fulfilled") {
    const f = fp.value.data;
    html += `<p class="viz-l">Flare odds, next 3 days (NOAA forecast)</p>
      <div class="scroll-x" tabindex="0" role="region" aria-label="Flare probability table"><table><caption class="sr">Chance of C, M and X class flares and a 10 MeV proton event, days 1 to 3</caption>
        <thead><tr><th scope="col">Class</th><th scope="col">Day 1</th><th scope="col">Day 2</th><th scope="col">Day 3</th></tr></thead><tbody>
        ${[["C flare", f.c], ["M flare", f.m], ["X flare", f.x], ["Proton event (10 MeV)", f.p10]].map(([n, v]) => `<tr><th scope="row">${n}</th>${v.map((x) => `<td>${pc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="stamp">${fp.value.saved ? `<strong class="warn">Saved copy:</strong> the live feed is unavailable, showing data fetched ${dateTime(fp.value.at)} ${tzLabel()}. ` : ""}${flareStale(f.date) ? `<strong class="warn">Stale:</strong> this forecast was issued more than ${FLARE_STALE_DAYS} days ago. ` : ""}Source: ${SWPC} solar flare probabilities, issued for ${esc(dateShortUTC(new Date(f.date)))} (UTC date); checked ${hm(fp.value.at)} ${tzLabel()}.</p>`;
  } else html += un("Flare probabilities");
  if (al.status === "fulfilled") {
    const a = al.value.data;
    html += `<p class="viz-l">Alerts and warnings, last 48 h</p>${a.length ? `<ul class="alerts">${a.map((x) => `<li><details><summary><time datetime="${new Date(x.t).toISOString()}">${dateTime(new Date(x.t))}</time> ${esc(x.title)}</summary><pre class="alert-txt" tabindex="0">${esc(x.text)}</pre></details></li>`).join("")}</ul>` : '<p class="fine">No NOAA alerts, watches or warnings in the last 48 hours.</p>'}
      ${feedStamp(SWPC + " alerts, watches and warnings", al.value, a.length ? a[0].t : NaN, 7 * 86400e3, "message")}`;
  } else html += un("Alerts");
  html += `<details><summary>What R, S and G mean</summary><ul class="fine">
      <li><strong>R (radio blackouts)</strong> follow X-ray flares: R1 is an M1 flare, R3 an X1, R5 an X20. They disturb HF radio on the sunlit side of Earth.</li>
      <li><strong>S (solar radiation storms)</strong> follow energetic protons: S1 starts at 10 particle flux units of 10 MeV protons, and each step is 10× more. They matter for polar flights and satellites.</li>
      <li><strong>G (geomagnetic storms)</strong> follow Kp: G1 is Kp 5 up to G5 at Kp 9. They bring aurora further from the poles.</li>
      <li>Level 0 means none. SKYHUD shows NOAA's numbers as published; it does not compute them.</li></ul></details>`;
  el.innerHTML = html;
}

const XRAY_BANDS = [["A", 1e-8], ["B", 1e-7], ["C", 1e-6], ["M", 1e-5], ["X", 1e-4]];
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

// Solar wind: the 1-minute files are large (about 95 KB gzipped for wind, 141 KB for the magnetic field), so they load only when this panel is
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


/** app.js calls this if satellite elements could not be loaded, so the map says the track is unavailable. */
export function issTrackUnavailable() { if (!iss.trackTried) renderIss(); }

let started = false;
export function start() {
  if (started) return;
  started = true;
  every("iss", 10e3, pollIss, { el: mapCanvas, reducedMs: 60e3 });
  every("iss-track", 5 * 60e3, refreshTrack, { el: mapCanvas });
  every("aurora", 10 * 60e3, loadAurora, { el: mapCanvas });
  every("kp", 10 * 60e3, loadKp, { el: $("kp") });
  every("xray", 5 * 60e3, loadXray, { el: $("xray") });
  every("scales", 15 * 60e3, loadScales, { el: $("scales") });
  every("wind", 15 * 60e3, loadWind, { el: $("wind") });
}
