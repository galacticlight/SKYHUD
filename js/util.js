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
export const numCell = (v, unit = "") => (v == null || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v)) ? "—" : `${Number(v)}${unit}`);

/** Should a keydown toggle red mode? (WCAG 2.1.4: can be turned off, no repeats/modifiers, not in controls.) */
export function isRedShortcut(e, active, enabled) {
  if (!enabled || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  if (typeof e.key !== "string" || e.key.toLowerCase() !== "r") return false;
  if (active && (active.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(active.tagName))) return false;
  return true;
}
