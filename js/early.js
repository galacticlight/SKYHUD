// SKYHUD early start: begin the Open-Meteo forecast request while the rest of the page's code is still
// downloading, so the score card isn't waiting on two things in a row. Same URL, host and fetch options as
// app.js; app.js picks up this promise (or makes its own request if this one didn't start or doesn't match).
import { forecastUrl, DEFAULT_LOC } from "./feeds.js";

function saved(k, d) { try { const v = localStorage.getItem("skyhud." + k); return v == null ? d : JSON.parse(v); } catch { return d; } }

try {
  const l = saved("loc", DEFAULT_LOC);
  const lat = Number(l && l.lat), lon = Number(l && l.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    const key = `wx:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const wx = saved("wx", null);
    const fresh = wx && wx.key === key && Date.now() - wx.at < 30 * 60e3; // app.js uses the saved copy then
    if (!fresh && navigator.onLine !== false) {
      const url = forecastUrl(lat, lon);
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 12000);
      const p = fetch(url, { signal: ctl.signal, credentials: "omit", referrerPolicy: "strict-origin-when-cross-origin", cache: "no-cache" })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .finally(() => clearTimeout(t));
      p.catch(() => {}); // app.js handles the failure when it takes the promise
      globalThis.__skyhudEarlyForecast = { url, p };
    }
  }
} catch { /* app.js fetches normally */ }
