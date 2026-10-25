// SKYHUD stargazing score — "SKYHUD heuristic v1". The weights and sub-score curves are our own
// design choices (not a published standard); every input and sub-score is shown in the UI.
export const SCORE_VERSION = "SKYHUD heuristic v1";
export const WEIGHTS = { clouds: 0.45, moon: 0.2, darkness: 0.15, light_pollution: 0.1, transparency: 0.05, seeing_comfort: 0.05 };
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * @param {object} h hourly inputs: cloudLow, cloudMid, cloudHigh, cloudTotal (%), visibility (m),
 *   humidity (%), wind (km/h), temp, dewPoint (°C), sunAlt (deg), moonAlt (deg), moonIllum (0–1), bortle (1–9)
 * Missing or non-numeric weather inputs → that factor is null and the score is null (we never invent numbers).
 */
export function scoreHour(h) {
  const need = ["cloudLow", "cloudMid", "cloudHigh", "cloudTotal", "visibility", "humidity", "wind", "temp", "dewPoint"];
  // Anything that is not a finite number (null, NaN, a string, an object) counts as missing: no score, never NaN.
  const num = (k) => typeof h[k] === "number" && Number.isFinite(h[k]);
  const missing = need.filter((k) => !num(k));
  const s = {};
  s.clouds = missing.length ? null : 1 - Math.min(1, (1.0 * h.cloudLow + 0.8 * h.cloudMid + 0.5 * h.cloudHigh) / 100);
  s.moon = !num("moonAlt") || !num("moonIllum") ? null : h.moonAlt <= 0 ? 1 : 1 - h.moonIllum * (0.5 + 0.5 * Math.sin((h.moonAlt * Math.PI) / 180));
  s.darkness = !num("sunAlt") ? null : h.sunAlt < -18 ? 1 : h.sunAlt < -12 ? 0.6 : h.sunAlt < -6 ? 0.2 : 0;
  s.light_pollution = !num("bortle") ? null : (9 - h.bortle) / 8;
  for (const k of ["moonAlt", "moonIllum", "sunAlt", "bortle"]) if (!num(k)) missing.push(k);
  s.transparency = missing.length ? null : 0.5 * Math.min(1, h.visibility / 30000) + 0.5 * (1 - clamp01(Math.max(0, h.humidity - 60) / 40));
  s.seeing_comfort = missing.length ? null : 0.5 * (1 - Math.min(1, h.wind / 40)) + 0.5 * clamp01((h.temp - h.dewPoint) / 5);
  for (const k of Object.keys(s)) if (s[k] != null) s[k] = clamp01(s[k]);
  if (missing.length) return { score: null, band: null, capped: false, sub: s, missing };
  let score = Math.round(100 * Object.entries(WEIGHTS).reduce((a, [k, w]) => a + w * s[k], 0));
  const capped = h.cloudTotal >= 90 && score > 10;
  if (h.cloudTotal >= 90) score = Math.min(score, 10);
  return { score, band: band(score), capped, sub: s, missing };
}

export function band(score) {
  if (score == null) return null;
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Fair";
  if (score >= 20) return "Poor";
  return "Bad";
}
