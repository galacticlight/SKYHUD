// Live data feeds (all keyless, CORS-open, HTTPS). Parsers are pure and unit-tested.
// Every fetch failure is surfaced to the UI as an "unavailable" state — we never substitute numbers.

export const ENDPOINTS = {
  forecast: "https://api.open-meteo.com/v1/forecast",
  geocode: "https://geocoding-api.open-meteo.com/v1/search",
  kp: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
  kpForecast: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
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

/** Open-Meteo hourly → [{t: Date, cloudTotal, cloudLow, …}] */
export function parseForecast(j) {
  const h = j && j.hourly;
  if (!h || !Array.isArray(h.time)) throw new Error("Unexpected forecast shape");
  return h.time.map((t, i) => ({
    t: new Date((typeof t === "number" ? t : Date.parse(t + "Z") / 1000) * 1000),
    cloudTotal: h.cloud_cover?.[i], cloudLow: h.cloud_cover_low?.[i], cloudMid: h.cloud_cover_mid?.[i], cloudHigh: h.cloud_cover_high?.[i],
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
  if (!j || typeof j.latitude !== "number") throw new Error("Unexpected ISS shape");
  return { lat: j.latitude, lon: j.longitude, altKm: j.altitude, velKmh: j.velocity, visibility: j.visibility, t: new Date(j.timestamp * 1000) };
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
