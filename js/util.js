// Small pure helpers shared by the UI and the tests.

/** Round to 0.01° (about 1 km): the precision SKYHUD stores and sends. */
export const round2 = (x) => Math.round(Number(x) * 100) / 100;

/** Message for a GeolocationPositionError, by code (1 denied, 2 unavailable, 3 timeout). */
export const geoErrorText = (err) => ({
  1: "Location permission was denied.",
  2: "Your device couldn't determine its position.",
  3: "Getting your location timed out.",
}[err && err.code] || "Couldn't get your location.");

/** Calendar dates such as IMO activity windows are UTC dates; format them in UTC so they don't shift. */
export const dateShortUTC = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(d);

/** A forecast value as safe text: finite numbers only, anything else becomes a dash. */
export const numCell = (v, unit = "") => (typeof v !== "number" || !Number.isFinite(v) ? "—" : `${v}${unit}`);

/** Should a keydown toggle red mode? (WCAG 2.1.4: can be turned off, no repeats/modifiers, not in controls.) */
export function isRedShortcut(e, active, enabled) {
  if (!enabled || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  if (typeof e.key !== "string" || e.key.toLowerCase() !== "r") return false;
  if (active && (active.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(active.tagName))) return false;
  return true;
}

const tzOk = new Map();
/** True if `z` is a time-zone name this browser accepts (cached). Never throws. */
export function validTz(z) {
  if (typeof z !== "string" || !z || z.length > 64) return false;
  if (!tzOk.has(z)) {
    let ok = false;
    try { new Intl.DateTimeFormat("en-US", { timeZone: z }).format(0); ok = true; } catch { ok = false; }
    tzOk.set(z, ok);
  }
  return tzOk.get(z);
}
/** The browser's own zone, or UTC if even that is unavailable. */
let browserZone = null;
export function browserTz() {
  if (browserZone) return browserZone;
  try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; browserZone = validTz(z) ? z : "UTC"; } catch { browserZone = "UTC"; }
  return browserZone;
}

/** "2 h 05 m" or, with seconds, "2 h 05 m 09 s". Negative or missing becomes "now". */
export function countdown(ms, withSeconds = true) {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p2 = (n) => String(n).padStart(2, "0");
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return withSeconds ? `${h} h ${p2(m)} m ${p2(sec)} s` : `${h} h ${p2(m)} m`;
  return withSeconds ? `${m} m ${p2(sec)} s` : `${Math.max(1, m)} m`;
}

/** The next `n` candidates ({t: Date, ...}) strictly after `now`, soonest first. */
export function nextAfter(cands, now, n = 3) {
  return cands.filter((c) => c && c.t instanceof Date && Number.isFinite(c.t.getTime()) && c.t > now).sort((a, b) => a.t - b.t).slice(0, n);
}

/** Epoch milliseconds from a Date or a number; anything else (or an invalid Date) is NaN. Use this before
 * Number.isFinite, which is always false for a Date. */
export const toMs = (t) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : NaN);

/** Is a feed's newest sample (Date or epoch ms) older than `maxAgeMs`? Missing timestamps count as stale. */
export const isStale = (at, now, maxAgeMs) => { const a = toMs(at), n = toMs(now); return !Number.isFinite(a) || !Number.isFinite(n) || n - a > maxAgeMs; };

/** Sky darkness band for a solar altitude (degrees): day, civil, nautical, astronomical twilight, or night. */
export function twilightBand(sunAlt) {
  if (sunAlt > -0.833) return "day";
  if (sunAlt > -6) return "civil";
  if (sunAlt > -12) return "nautical";
  if (sunAlt > -18) return "astro";
  return "night";
}

/** Merge consecutive samples [{t, v}] with equal v into runs [{from, to, v}] (each run ends at the next sample). */
export function runs(samples) {
  const out = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i], end = samples[i + 1] ? samples[i + 1].t : s.t;
    const last = out[out.length - 1];
    if (last && last.v === s.v) last.to = end; else out.push({ from: s.t, to: end, v: s.v });
  }
  return out;
}

// Text for a list of {from, to} runs, skipping any that would read as zero-width ("12:12 PM–12:12 PM") once
// times are shown to the minute. The bar still draws them; neighbouring runs already meet at that minute.
export function runsText(list, hmFn, name = () => "") {
  return list
    .map((r) => ({ r, a: hmFn(new Date(r.from)), b: hmFn(new Date(r.to)) }))
    .filter(({ a, b }) => a !== b)
    .map(({ r, a, b }) => `${name(r)}${a}–${b}`);
}

// Whether to ask CelesTrak for new elements. A fresh copy (< 6 h) is used as is. After a failed download (CelesTrak
// throttles repeat downloads and answers 403, which the browser itself logs as a console error that page code
// cannot silence), wait an hour before asking again instead of retrying on every load.
export const TLE_FRESH_MS = 6 * 3600e3, TLE_RETRY_MS = 3600e3;
export function tleShouldFetch(cachedAt, failedAt, now) {
  const c = toMs(cachedAt), f = toMs(failedAt), n = toMs(now);
  if (Number.isFinite(c) && n - c >= 0 && n - c < TLE_FRESH_MS) return false;
  if (Number.isFinite(f) && n - f >= 0 && n - f < TLE_RETRY_MS) return false;
  return true;
}

// Observing planner advice (computed; thresholds also listed under About). Input: the object's magnitude,
// angle from the Sun, and its highest point between civil dusk and civil dawn tonight (maxAlt in degrees, dir as
// a compass word, when as text, or maxAlt null when it never clears the horizon after dark).
export const PLAN = { GLARE_DEG: 15, LOW_DEG: 10, EYE_MAG: 6, DARK_SKY_MAG: 4.5, BINO_MAG: 8.5 };
export function planAdvice({ mag, elong, maxAlt, dir, when }) {
  if (Number.isFinite(elong) && elong < PLAN.GLARE_DEG) return "Lost in the Sun's glare";
  if (maxAlt == null || !Number.isFinite(maxAlt) || maxAlt <= 0) return "Not up after dark";
  const where = maxAlt < PLAN.LOW_DEG ? `Low in the ${dir}, best ${when}: needs a clear ${dir} horizon` : `Best ${when}, ${Math.round(maxAlt)}° up in the ${dir}`;
  const eye = !Number.isFinite(mag) ? "" : mag > PLAN.BINO_MAG ? "telescope needed" : mag > PLAN.EYE_MAG ? "binoculars needed" : mag > PLAN.DARK_SKY_MAG ? "naked eye only from a dark site; binoculars help" : "easy naked eye";
  return eye ? `${where}; ${eye}` : where;
}

/**
 * Read a fetch Response body as text, but never more than `max` bytes: a declared Content-Length over the cap
 * is refused before reading, and the stream is cancelled as soon as the running total passes it.
 */
export async function readCapped(res, max, what = "response") {
  const tooBig = (n) => new Error(`${what}: response too large (${n} bytes, limit ${max})`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > max) { if (res.body) res.body.cancel().catch(() => {}); throw tooBig(declared); }
  if (!res.body) return "";
  const reader = res.body.getReader(), chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { reader.cancel().catch(() => {}); throw tooBig(`over ${max}`); }
    chunks.push(value);
  }
  const buf = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(buf);
}
