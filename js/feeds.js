// Live data feeds (all keyless, CORS-open, HTTPS). Parsers are pure and unit-tested.
// Every fetch failure is surfaced to the UI as an "unavailable" state — we never substitute numbers.

export const ENDPOINTS = {
  forecast: "https://api.open-meteo.com/v1/forecast",
  geocode: "https://geocoding-api.open-meteo.com/v1/search",
  kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
  kpForecast: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
  xray: "https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json",
  wind: "https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json",
  mag: "https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json",
  aurora: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
  issNow: "https://api.wheretheiss.at/v1/satellites/25544",
  tle: "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle",
};

const HOURLY = ["cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility", "relative_humidity_2m", "dew_point_2m", "temperature_2m", "wind_speed_10m", "precipitation_probability"];

/** Open-Meteo URL. Coordinates are rounded to 0.01° (~1 km) before leaving the browser. */
export function forecastUrl(lat, lon) {
  const q = new URLSearchParams({ latitude: lat.toFixed(2), longitude: lon.toFixed(2), hourly: HOURLY.join(","), forecast_days: "3", timezone: "auto", timeformat: "unixtime" });
  return `${ENDPOINTS.forecast}?${q}`;
}

export function geocodeUrl(name) {
  return `${ENDPOINTS.geocode}?${new URLSearchParams({ name, count: "6", language: "en", format: "json" })}`;
}

/** A cloud-cover percentage: a finite number in 0–100, else null (missing). Out-of-range values are not clamped,
 * because a bad 150% or −20% is not evidence of 100% or 0% cloud. */
export const cloudPct = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null);

/** Open-Meteo hourly → [{t: Date, cloudTotal, cloudLow, …}] */
export function parseForecast(j) {
  const h = j && j.hourly;
  if (!h || !Array.isArray(h.time)) throw new Error("Unexpected forecast shape");
  return h.time.map((t, i) => ({
    t: new Date((typeof t === "number" ? t : Date.parse(t + "Z") / 1000) * 1000),
    cloudTotal: cloudPct(h.cloud_cover?.[i]), cloudLow: cloudPct(h.cloud_cover_low?.[i]), cloudMid: cloudPct(h.cloud_cover_mid?.[i]), cloudHigh: cloudPct(h.cloud_cover_high?.[i]),
    visibility: h.visibility?.[i], humidity: h.relative_humidity_2m?.[i], dewPoint: h.dew_point_2m?.[i], temp: h.temperature_2m?.[i],
    wind: h.wind_speed_10m?.[i], precip: h.precipitation_probability?.[i],
  }));
}

export function parseGeocode(j) {
  return (j && Array.isArray(j.results) ? j.results : []).map((r) => ({
    name: [r.name, r.admin1, r.country_code].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude, tz: r.timezone,
  }));
}

/**
 * NOAA SWPC planetary K-index. Accepts the current array-of-objects shape
 * ({time_tag, Kp}) and the older array-of-arrays shape with a header row.
 */
export function parseKp(j) {
  if (!Array.isArray(j) || !j.length) throw new Error("Unexpected Kp shape");
  let rows;
  if (Array.isArray(j[0])) {
    const head = j[0].map((x) => String(x).toLowerCase());
    const ti = head.indexOf("time_tag"), ki = head.findIndex((x) => x === "kp" || x === "kp_index");
    if (ti < 0 || ki < 0) throw new Error("Unexpected Kp header");
    rows = j.slice(1).map((r) => ({ time: r[ti], kp: r[ki], status: head.includes("observed") ? r[head.indexOf("observed")] : "observed" }));
  } else {
    rows = j.map((r) => ({ time: r.time_tag, kp: r.Kp ?? r.kp ?? r.kp_index, status: r.observed ?? "observed" }));
  }
  return rows
    .map((r) => ({ t: new Date(/Z|[+-]\d\d:?\d\d$/.test(r.time) ? r.time : String(r.time).replace(" ", "T") + "Z"), kp: Number(r.kp), status: r.status }))
    .filter((r) => !Number.isNaN(r.t.getTime()) && Number.isFinite(r.kp));
}

/** NOAA G-scale for a Kp value (Kp 5 → G1 … Kp 9 → G5). */
export const gScale = (kp) => (kp >= 9 ? "G5" : kp >= 8 ? "G4" : kp >= 7 ? "G3" : kp >= 6 ? "G2" : kp >= 5 ? "G1" : "G0");

export function parseIssNow(j) {
  const ok = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  if (!j || !ok(j.latitude, -90, 90) || !ok(j.longitude, -180, 180) || !ok(j.timestamp, 1e9, 1e11)) throw new Error("Unexpected ISS shape");
  return { lat: j.latitude, lon: j.longitude, altKm: ok(j.altitude, 100, 2000) ? j.altitude : null, velKmh: ok(j.velocity, 0, 1e5) ? j.velocity : null, visibility: j.visibility, t: new Date(j.timestamp * 1000) };
}

/** Parse 3-line TLE text → [{name, l1, l2, norad, epoch: Date}] (validates checksums). */
export function parseTle(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length + 0; i++) {
    if (lines[i + 1]?.startsWith("1 ") && lines[i + 2]?.startsWith("2 ") && !lines[i].startsWith("1 ") && !lines[i].startsWith("2 ")) {
      const l1 = lines[i + 1], l2 = lines[i + 2];
      if (checksum(l1) && checksum(l2)) out.push({ name: lines[i].trim(), l1, l2, norad: Number(l1.slice(2, 7)), epoch: tleEpoch(l1) });
      i += 2;
    }
  }
  return out;
}

function checksum(line) {
  if (line.length < 69) return false;
  let s = 0;
  for (const c of line.slice(0, 68)) s += c === "-" ? 1 : /\d/.test(c) ? Number(c) : 0;
  return s % 10 === Number(line[68]);
}

export function tleEpoch(l1) {
  const yy = Number(l1.slice(18, 20)), doy = Number(l1.slice(20, 32));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(year, 0, 1) + (doy - 1) * 86400e3);
}

/** GOES primary X-ray, 6-hour, 1-minute data → [{t: ms, flux}] for the 0.1–0.8 nm channel that defines flare class. */
export function parseXray(j) {
  if (!Array.isArray(j)) throw new Error("Unexpected X-ray shape");
  const rows = j.filter((r) => r && r.energy === "0.1-0.8nm" && Number(r.flux) > 0)
    .map((r) => ({ t: Date.parse(/Z$/.test(r.time_tag) ? r.time_tag : r.time_tag + "Z"), flux: Number(r.flux) }))
    .filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  if (!rows.length) throw new Error("No X-ray rows");
  return rows;
}

/**
 * NOAA real-time solar wind (1-minute, several spacecraft). Keeps only rows from the spacecraft NOAA marks
 * `active`, within `spanMs` of the newest such row → {source, rows: [[ms, ...fields]]} oldest first.
 */
export function parseRtsw(j, fields, spanMs = 2 * 3600e3) {
  if (!Array.isArray(j)) throw new Error("Unexpected solar-wind shape");
  const act = j.filter((r) => r && r.active === true && r.time_tag)
    .map((r) => ({ t: Date.parse(/Z$/.test(r.time_tag) ? r.time_tag : r.time_tag + "Z"), r }))
    .filter((x) => Number.isFinite(x.t));
  if (!act.length) throw new Error("No active solar-wind rows");
  const newest = Math.max(...act.map((x) => x.t));
  const rows = act.filter((x) => x.t > newest - spanMs).sort((a, b) => a.t - b.t)
    .map((x) => [x.t, ...fields.map((f) => (x.r[f] == null || !Number.isFinite(Number(x.r[f])) ? null : Number(x.r[f])))]);
  const src = act.find((x) => x.t === newest).r.source;
  return { source: String(src || "unknown"), rows };
}

// Computed ground-track rows from the satellite worker: keep only rows with a real time, a latitude in
// -90..90, a longitude in -180..180 and a finite height, so a bad row can never render as "NaN°".
export function cleanTrack(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
    Number.isFinite(p.lon) && Math.abs(p.lon) <= 180 && Number.isFinite(p.altKm));
}

// Age of a live ISS reading, judged by the feed's own timestamp (not when it reached us), so a cached or
// delayed answer is labelled stale. Readings stamped more than 5 minutes in the future are treated as stale too.
// Accepts a Date (what parseIssNow returns) or epoch milliseconds.
export function issReadingFresh(t, now, staleMs) {
  const ms = t instanceof Date ? t.getTime() : typeof t === "number" ? t : NaN;
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return false;
  const age = nowMs - ms;
  return age < staleMs && age > -5 * 60e3;
}
