// SKYHUD astronomy layer — thin wrapper over the vendored Astronomy Engine 2.1.19
// (MIT, © Don Cross, https://github.com/cosinekitty/astronomy), loaded as the global `Astronomy`
// by vendor/astronomy.browser.min.js before this module. All inputs/outputs are JS Dates (UTC)
// and degrees. Accuracy is verified in tests/astro.test.mjs against JPL Horizons and timeanddate.
const A = globalThis.Astronomy;
if (!A) throw new Error("Astronomy Engine not loaded");

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const norm360 = (x) => ((x % 360) + 360) % 360;
export const norm180 = (x) => { const y = norm360(x); return y > 180 ? y - 360 : y; };

export const PLANET_KEYS = ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"];
export const BODY_KEYS = ["sun", "moon", ...PLANET_KEYS];
const BODY = { sun: "Sun", moon: "Moon", mercury: "Mercury", venus: "Venus", mars: "Mars", jupiter: "Jupiter", saturn: "Saturn", uranus: "Uranus", neptune: "Neptune" };
export const bodyName = (k) => BODY[k];

const obs = (lat, lon, h = 0) => new A.Observer(lat, lon, h);
const toDate = (t) => (t ? t.date : null);

/**
 * Topocentric position of a solar-system body. `refract` (default true) applies standard
 * atmospheric refraction to the altitude; pass false for airless values (as JPL Horizons QUANTITIES 4).
 */
export function bodyPosition(key, date, lat, lon, refract = true) {
  const o = obs(lat, lon);
  const eq = A.Equator(BODY[key], date, o, true, true);
  const hor = A.Horizon(date, o, eq.ra, eq.dec, refract ? "normal" : undefined);
  return { key, ra: eq.ra * 15, dec: eq.dec, distAU: eq.dist, alt: hor.altitude, az: hor.azimuth };
}

/** Visual magnitude and illuminated fraction (Astronomy Engine; Saturn includes rings). */
export function bodyIllumination(key, date) {
  const i = A.Illumination(BODY[key], date);
  return { mag: i.mag, fraction: i.phase_fraction, phaseAngle: i.phase_angle };
}

/** Moon phase: age = Moon−Sun geocentric ecliptic longitude (0 new, 90 FQ, 180 full, 270 LQ). */
export function moonPhase(date) {
  const age = A.MoonPhase(date);
  const ill = A.Illumination("Moon", date);
  return { age, illum: ill.phase_fraction, phaseAngle: ill.phase_angle, waxing: age < 180, name: phaseName(age) };
}

export function phaseName(age) {
  if (age < 6 || age >= 354) return "New Moon";
  if (age < 84) return "Waxing crescent";
  if (age < 96) return "First quarter";
  if (age < 174) return "Waxing gibbous";
  if (age < 186) return "Full Moon";
  if (age < 264) return "Waning gibbous";
  if (age < 276) return "Last quarter";
  return "Waning crescent";
}

const QUARTERS = ["New Moon", "First quarter", "Full Moon", "Last quarter"];
/** Next `count` principal Moon phases after `from`. */
export function nextPhases(from, count = 4) {
  const out = [];
  let q = A.SearchMoonQuarter(from);
  for (let i = 0; i < count; i++) {
    out.push({ name: QUARTERS[q.quarter], quarter: q.quarter, date: q.time.date });
    q = A.NextMoonQuarter(q);
  }
  return out;
}

/** Next rise/set (direction +1 rise, −1 set) of a body within `days` after `start`, or null. */
export function searchRiseSet(key, type, start, lat, lon, days = 1) {
  return toDate(A.SearchRiseSet(BODY[key], obs(lat, lon), type === "rise" ? +1 : -1, start, days));
}

/** Rise, upper transit and set in the 24 h after `start`. Polar cases return nulls + state. */
export function riseTransitSet(key, start, lat, lon) {
  const rise = searchRiseSet(key, "rise", start, lat, lon, 1);
  const set = searchRiseSet(key, "set", start, lat, lon, 1);
  const ha = A.SearchHourAngle(BODY[key], obs(lat, lon), 0, start, +1);
  const transit = ha.time.date - start <= 86400e3 ? { date: ha.time.date, alt: ha.hor.altitude } : null;
  let state = null;
  if (!rise && !set) state = bodyPosition(key, start, lat, lon).alt > 0 ? "always up" : "never rises";
  return { rise, set, transit, state };
}

/** Sun crossing of `alt` degrees (direction −1 descending/dusk, +1 ascending/dawn). */
export function sunAltitudeCrossing(alt, direction, start, lat, lon, days = 1) {
  return toDate(A.SearchAltitude("Sun", obs(lat, lon), direction, start, days, alt));
}

/**
 * Twilight sequence for one night, anchored on local mean noon (from longitude). Dusk events are
 * searched in [noon, noon+13 h], dawn events in [noon+11 h, noon+24 h]. If `around` is during the
 * night (or before dawn) you get that night; in daytime you get the coming night.
 * A null entry means the Sun never reaches that altitude that night (polar day / polar night).
 */
export function nightTimes(around, lat, lon) {
  let noon = new Date(around);
  noon.setUTCHours(0, 0, 0, 0);
  noon = new Date(noon.getTime() + (12 - lon / 15) * 3600e3);
  while (noon > around) noon = new Date(noon.getTime() - 86400e3);
  while (around - noon >= 86400e3) noon = new Date(noon.getTime() + 86400e3);
  const morning = around - noon >= 12 * 3600e3;
  if (morning && bodyPosition("sun", around, lat, lon).alt > -0.833) noon = new Date(noon.getTime() + 86400e3);
  const o = obs(lat, lon);
  const mid = new Date(noon.getTime() + 12 * 3600e3);
  // Descending crossings happen between solar noon and solar midnight, ascending ones between solar
  // midnight and the next solar noon. Solar midnight is within ~16 min of local mean midnight (equation of
  // time), so the windows overlap mean midnight by an hour; otherwise a brief polar darkness right at
  // midnight (e.g. Tromsø mid-September, ~5 min) loses its dusk or dawn.
  const H = 3600e3;
  const dusk = (h) => toDate(A.SearchAltitude("Sun", o, -1, noon, 13 / 24, h));
  const dawn = (h) => toDate(A.SearchAltitude("Sun", o, +1, new Date(mid.getTime() - H), 13 / 24, h));
  return {
    noon, midnight: mid,
    sunset: toDate(A.SearchRiseSet("Sun", o, -1, noon, 13 / 24)),
    civilDusk: dusk(-6), nauticalDusk: dusk(-12), astroDusk: dusk(-18),
    astroDawn: dawn(-18), nauticalDawn: dawn(-12), civilDawn: dawn(-6),
    sunrise: toDate(A.SearchRiseSet("Sun", o, +1, new Date(mid.getTime() - H), 13 / 24)),
  };
}

const bandOf = (alt) => (alt > -0.833 ? "day" : alt > -6 ? "civil" : alt > -12 ? "nautical" : alt > -18 ? "astro" : "night");
/**
 * Daylight/twilight bands between t0 and t1 (ms) built from the exact nightTimes() crossings, so a
 * timeline drawn from them matches the twilight table to the second. Each band is checked against the
 * Sun's geometric altitude at its midpoint; if anything is inconsistent (e.g. polar edge cases where a
 * crossing falls outside the search window) it falls back to 1-minute sampling and sets exact=false.
 */
export function darknessBands(n, t0, t1, lat, lon) {
  const geo = (t) => bandOf(bodyPosition("sun", new Date(t), lat, lon, false).alt);
  // Each table edge is a transition [time, band before, band after]. The bar is exact only if every edge in
  // the window chains onto the previous one (so every edge is used) and each band agrees with the Sun's
  // altitude at its midpoint; otherwise it is sampled and labelled approximate.
  const edges = [[n.sunset, "day", "civil"], [n.civilDusk, "civil", "nautical"], [n.nauticalDusk, "nautical", "astro"], [n.astroDusk, "astro", "night"],
    [n.astroDawn, "night", "astro"], [n.nauticalDawn, "astro", "nautical"], [n.civilDawn, "nautical", "civil"], [n.sunrise, "civil", "day"]]
    .filter(([d]) => d && d.getTime() > t0 && d.getTime() < t1).map(([d, a, b]) => [d.getTime(), a, b]).sort((a, b) => a[0] - b[0]);
  const bands = [];
  let from = t0, v = edges.length ? edges[0][1] : geo(t0), chained = true;
  for (const [t, before, after] of edges) {
    if (before !== v) { chained = false; break; }
    bands.push({ from, to: t, v }); from = t; v = after;
  }
  bands.push({ from, to: t1, v });
  if (chained && bands.every((b) => geo((b.from + b.to) / 2) === b.v)) return { bands, exact: true };
  const out = [];
  for (let t = t0; t < t1; t += 60e3) {
    const bv = geo(t), last = out[out.length - 1];
    if (last && last.v === bv) last.to = Math.min(t + 60e3, t1); else out.push({ from: t, to: Math.min(t + 60e3, t1), v: bv });
  }
  return { bands: out, exact: false };
}

/** Moon-above-horizon intervals between t0 and t1 (ms) from exact rise/set events. */
export function moonUpRuns(t0, t1, lat, lon) {
  const ev = [];
  for (const type of ["rise", "set"]) {
    let s = t0;
    for (let i = 0; i < 4; i++) {
      const d = searchRiseSet("moon", type, new Date(s), lat, lon, (t1 - s) / 86400e3);
      if (!d || d.getTime() >= t1) break;
      ev.push([d.getTime(), type]); s = d.getTime() + 60e3;
    }
  }
  ev.sort((a, b) => a[0] - b[0]);
  let up = ev.length ? ev[0][1] === "set" : bodyPosition("moon", new Date(t0), lat, lon).alt > 0;
  const out = [];
  let from = t0;
  for (const [t, type] of ev) {
    if (type === "set" && up) out.push({ from, to: t });
    if (type === "rise") from = t;
    up = type === "rise";
  }
  if (up) out.push({ from, to: t1 });
  return out;
}

/** Rotation for fast J2000 RA/Dec → horizontal (precession, nutation, Earth rotation). */
export function horizonProjector(date, lat, lon) {
  const r = A.Rotation_EQJ_HOR(date, obs(lat, lon)).rot;
  return (raDeg, decDeg, refract = true) => {
    const ra = raDeg * DEG, dec = decDeg * DEG;
    const x0 = Math.cos(dec) * Math.cos(ra), y0 = Math.cos(dec) * Math.sin(ra), z0 = Math.sin(dec);
    const x = r[0][0] * x0 + r[1][0] * y0 + r[2][0] * z0;
    const y = r[0][1] * x0 + r[1][1] * y0 + r[2][1] * z0;
    const z = r[0][2] * x0 + r[1][2] * y0 + r[2][2] * z0;
    let alt = Math.asin(Math.max(-1, Math.min(1, z))) * RAD;
    if (refract) alt += A.Refraction("normal", alt);
    return { alt, az: norm360(Math.atan2(-y, x) * RAD) };
  };
}

/** Geocentric Sun longitude on the mean ecliptic & equinox of J2000 — the λ☉ the IMO uses. */
export function solarLongitudeJ2000(date) {
  const v = A.RotateVector(A.Rotation_EQJ_ECL(), A.GeoVector("Sun", date, true));
  return norm360(Math.atan2(v.y, v.x) * RAD);
}

/** First instant in calendar `year` (UTC) when λ☉ (J2000) reaches `lambda` degrees. */
export function dateOfSolarLongitude(lambda, year) {
  let approx = Date.UTC(year, 2, 20) + (norm360(lambda) / 360) * 365.2422 * 86400e3;
  if (approx >= Date.UTC(year + 1, 0, 1)) approx -= 365.2422 * 86400e3;
  let lo = approx - 6 * 86400e3, hi = approx + 6 * 86400e3;
  for (let j = 0; j < 50; j++) {
    const mid = (lo + hi) / 2;
    if (norm180(solarLongitudeJ2000(new Date(mid)) - lambda) < 0) lo = mid; else hi = mid;
  }
  return new Date((lo + hi) / 2);
}

/** Angular separation (deg) between two RA/Dec points (deg). */
export function separation(ra1, dec1, ra2, dec2) {
  const c = Math.sin(dec1 * DEG) * Math.sin(dec2 * DEG) + Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.cos((ra1 - ra2) * DEG);
  return Math.acos(Math.max(-1, Math.min(1, c))) * RAD;
}

/** Highest altitude a fixed RA/Dec point reaches at latitude `lat` (no refraction). */
export const maxAltitude = (dec, lat) => 90 - Math.abs(lat - dec);

export function compass(az) {
  const pts = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return pts[Math.round(norm360(az) / 22.5) % 16];
}

export const engineVersion = "Astronomy Engine 2.1.19";
