// Meteor showers: IMO 2026 Meteor Shower Calendar, Table 5 (https://www.imo.net/files/meteor-shower/cal2026.pdf)
// and IMO 2027 calendar (https://www.imo.net/files/meteor-shower/cal2027.pdf). Peak instants are computed
// from the IMO solar longitude λ☉ (J2000) for any year, so they are APPROXIMATE (±1 day; some showers
// have broad or variable maxima). Activity windows are IMO's 2026 dates and shift little year to year.
import { dateOfSolarLongitude, moonPhase } from "./astro.js";

export const IMO_SOURCE = "https://www.imo.net/files/meteor-shower/cal2026.pdf";
// [code, name, activeStart MM-DD, activeEnd MM-DD, λ☉ peak, radiant RA°, Dec°, v km/s, ZHR, note]
const TABLE = [
  ["QUA", "Quadrantids", "12-28", "01-12", 283.15, 230, 49, 41, 80, "Sharp peak (hours); ZHR varies ≈60–200"],
  ["LYR", "Lyrids", "04-14", "04-30", 32.32, 271, 34, 49, 18, ""],
  ["ETA", "η-Aquariids", "04-19", "05-28", 45.5, 338, -1, 66, 50, "Best from the southern hemisphere"],
  ["SDA", "Southern δ-Aquariids", "07-12", "08-23", 128, 340, -16, 41, 25, ""],
  ["CAP", "α-Capricornids", "07-03", "08-15", 128, 307, -10, 23, 5, "Slow, sometimes bright"],
  ["PER", "Perseids", "07-17", "08-24", 140.0, 48, 58, 59, 100, ""],
  ["AUR", "Aurigids", "08-28", "09-05", 158.6, 91, 39, 66, 6, ""],
  ["SPE", "September ε-Perseids", "09-05", "09-21", 166.7, 48, 40, 64, 8, ""],
  ["DRA", "Draconids", "10-06", "10-10", 195.4, 262, 54, 20, 5, "Variable; occasional outbursts"],
  ["ORI", "Orionids", "10-02", "11-07", 208, 95, 16, 66, 20, ""],
  ["STA", "Southern Taurids", "09-20", "11-20", 223, 52, 15, 27, 7, "Broad maximum"],
  ["NTA", "Northern Taurids", "10-20", "12-10", 230, 58, 22, 29, 5, "Broad maximum"],
  ["LEO", "Leonids", "11-06", "11-30", 235.27, 152, 22, 71, 15, ""],
  ["GEM", "Geminids", "12-04", "12-20", 262.2, 112, 33, 35, 150, "Broad maximum"],
  ["URS", "Ursids", "12-17", "12-26", 270.7, 217, 76, 33, 10, "Northern hemisphere"],
];

export const SHOWERS = TABLE.map(([code, name, start, end, lambda, ra, dec, v, zhr, note]) => ({ code, name, start, end, lambda, ra, dec, v, zhr, note }));

const md = (year, s) => new Date(`${year}-${s}T00:00:00Z`);

/** Activity window containing or following `date` for a shower, plus computed peak and Moon. */
export function showerWindow(sh, date) {
  for (const y of [date.getUTCFullYear() - 1, date.getUTCFullYear(), date.getUTCFullYear() + 1]) {
    const start = md(y, sh.start);
    let end = md(sh.end < sh.start ? y + 1 : y, sh.end);
    end = new Date(end.getTime() + 86400e3);
    if (end > date) {
      const peakYear = sh.end < sh.start && sh.lambda > 270 ? y + 1 : y;
      const peak = dateOfSolarLongitude(sh.lambda, peakYear);
      const moon = moonPhase(peak);
      return { ...sh, activeFrom: start, activeTo: end, peak, active: date >= start, moonIllum: moon.illum, moonName: moon.name };
    }
  }
  return null;
}

/** Showers active now or peaking within `days`, sorted by peak. */
export function upcomingShowers(date, days = 120) {
  return SHOWERS.map((s) => showerWindow(s, date))
    .filter((w) => w && (w.active || w.activeFrom - date < days * 86400e3))
    .sort((a, b) => a.peak - b.peak);
}
