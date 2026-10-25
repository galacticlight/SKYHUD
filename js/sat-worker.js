// Satellite pass prediction (classic Web Worker so it never blocks the page).
// SGP4 via vendored satellite.js v5 (MIT). Message in: {tles:[{name,l1,l2,norad}], lat, lon, heightKm, start (ms), hours}
// Message out: {passes:[…]} — each pass has rise/max/set times, max elevation, directions, and a
// "visible" flag (satellite sunlit while the observer's Sun is below −6°). Brightness is not predicted.
/* global satellite */
importScripts("../vendor/satellite.min.js");

const DEG = Math.PI / 180;
const AU_KM = 149597870.7;
const RE = 6378.137;

// Low-precision Sun vector (ECI, km) — Astronomical Almanac, accurate to ~0.01°; ample for shadow tests.
function sunEci(date) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 4e-7 * n) * DEG;
  const R = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)) * AU_KM;
  return { x: R * Math.cos(lam), y: R * Math.cos(eps) * Math.sin(lam), z: R * Math.sin(eps) * Math.sin(lam) };
}

// Cylindrical Earth-shadow test
function sunlit(p, s) {
  const sl = Math.hypot(s.x, s.y, s.z);
  const ux = s.x / sl, uy = s.y / sl, uz = s.z / sl;
  const dot = p.x * ux + p.y * uy + p.z * uz;
  if (dot > 0) return true;
  const px = p.x - dot * ux, py = p.y - dot * uy, pz = p.z - dot * uz;
  return Math.hypot(px, py, pz) > RE;
}

function sunElevation(date, gd) {
  const s = sunEci(date);
  const gmst = satellite.gstime(date);
  const look = satellite.ecfToLookAngles(gd, satellite.eciToEcf(s, gmst));
  return look.elevation / DEG;
}

function look(rec, date, gd) {
  const pv = satellite.propagate(rec, date);
  if (!pv || !pv.position || typeof pv.position === "boolean") return null;
  const gmst = satellite.gstime(date);
  const la = satellite.ecfToLookAngles(gd, satellite.eciToEcf(pv.position, gmst));
  return { el: la.elevation / DEG, az: ((la.azimuth / DEG) % 360 + 360) % 360, range: la.rangeSat, pos: pv.position };
}

function predict({ tles, lat, lon, heightKm = 0, start, hours = 24, minEl = 10 }) {
  const gd = { latitude: lat * DEG, longitude: lon * DEG, height: heightKm };
  const t0 = start, t1 = start + hours * 3600e3, step = 30e3;
  const passes = [];
  for (const s of tles) {
    let rec;
    try { rec = satellite.twoline2satrec(s.l1, s.l2); } catch { continue; }
    if (rec.error) continue;
    let prev = look(rec, new Date(t0), gd);
    let cur = null;
    for (let t = t0 + step; t <= t1 && prev; t += step) {
      const l = look(rec, new Date(t), gd);
      if (!l) break;
      if (prev.el < 0 && l.el >= 0) cur = { rise: t, riseAz: l.az, max: l, maxT: t, track: [], vis: [] };
      if (cur) {
        if (l.el > cur.max.el) { cur.max = l; cur.maxT = t; }
        const date = new Date(t);
        const lit = sunlit(l.pos, sunEci(date));
        const dark = sunElevation(date, gd) < -6;
        cur.track.push([t, +l.az.toFixed(1), +l.el.toFixed(1), lit && dark ? 1 : 0]);
        if (lit && dark && l.el >= minEl) cur.vis.push(t);
      }
      if (cur && prev.el >= 0 && l.el < 0) {
        if (cur.max.el >= minEl) {
          passes.push({
            name: s.name, norad: s.norad, rise: cur.rise, set: t, riseAz: cur.riseAz, setAz: l.az,
            maxT: cur.maxT, maxEl: cur.max.el, maxAz: cur.max.az, visible: cur.vis.length > 0,
            visStart: cur.vis[0] ?? null, visEnd: cur.vis[cur.vis.length - 1] ?? null, track: cur.track,
          });
        }
        cur = null;
      }
      prev = l;
    }
  }
  passes.sort((a, b) => a.rise - b.rise);
  return passes;
}

/** Current alt/az of every satellite at time `at` (for the sky chart). */
function positions({ tles, lat, lon, heightKm = 0, at }) {
  const gd = { latitude: lat * DEG, longitude: lon * DEG, height: heightKm };
  const date = new Date(at), sun = sunEci(date), dark = sunElevation(date, gd) < -6;
  const out = [];
  for (const s of tles) {
    try {
      const rec = satellite.twoline2satrec(s.l1, s.l2);
      const l = look(rec, date, gd);
      if (l && l.el > 0) out.push({ name: s.name, norad: s.norad, az: l.az, el: l.el, lit: sunlit(l.pos, sun) && dark });
    } catch { /* skip bad element set */ }
  }
  return out;
}

// Sub-satellite ground track: geodetic lat/lon every `stepMin` minutes from `from` to `to` (ms).
function track({ tle, from, to, stepMin = 1 }) {
  const rec = satellite.twoline2satrec(tle.l1, tle.l2);
  const out = [];
  for (let t = from; t <= to; t += stepMin * 60e3) {
    const d = new Date(t), pv = satellite.propagate(rec, d);
    if (!pv || !pv.position || typeof pv.position === "boolean") continue;
    const g = satellite.eciToGeodetic(pv.position, satellite.gstime(d));
    out.push({ t, lat: g.latitude / DEG, lon: ((g.longitude / DEG + 540) % 360) - 180, altKm: g.height });
  }
  return out;
}

self.onmessage = (e) => {
  const { id, kind, payload } = e.data;
  try {
    const result = kind === "positions" ? positions(payload) : kind === "track" ? track(payload) : predict(payload);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
// Node test hook
if (typeof module !== "undefined") module.exports = { predict, positions, track, sunEci, sunlit };
