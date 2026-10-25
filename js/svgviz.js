// Small SVG charts, built as strings with no libraries. Colours come from CSS classes so the red
// theme restyles them. Every chart has a text or table equivalent next to it in the page.

const f1 = (x) => (Math.round(x * 10) / 10).toString();
const escAttr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Kp activity class used for colour: quiet (<4), active (4–<5) or storm (≥5, G1+). */
export const kpClass = (kp) => (kp >= 5 ? "kp-s" : kp >= 4 ? "kp-a" : "kp-q");

/**
 * Kp bar chart. `bars` = [{t: ms, kp, predicted}] in time order, `nowMs` draws a marker,
 * `label(ms)` formats day ticks (called at local midnights supplied in `days`).
 */
export function kpBars(bars, { nowMs, days = [], label = String, title = "" } = {}) {
  const W = 400, H = 150, L = 22, R = 4, T = 8, B = 22, ch = H - T - B;
  if (!bars.length) return "";
  const t0 = bars[0].t, t1 = bars[bars.length - 1].t + 3 * 3600e3, x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (kp) => T + ch - (Math.max(0, Math.min(9, kp)) / 9) * ch;
  const bw = Math.max(1, x(t0 + 3 * 3600e3) - x(t0) - 1);
  const grid = [0, 3, 5, 7, 9].map((k) => `<line class="ax" x1="${L}" x2="${W - R}" y1="${y(k)}" y2="${y(k)}"/><text class="tk" x="${L - 4}" y="${y(k) + 4}" text-anchor="end">${k}</text>`).join("");
  const rects = bars.map((b) => `<rect class="${kpClass(b.kp)}${b.predicted ? " pred" : ""}" x="${f1(x(b.t))}" y="${f1(y(b.kp))}" width="${f1(bw)}" height="${f1(Math.max(0.5, y(0) - y(b.kp)))}"/>`).join("");
  const ticks = days.filter((d) => d > t0 && d < t1).map((d) => `<line class="ax" x1="${f1(x(d))}" x2="${f1(x(d))}" y1="${T}" y2="${H - B}"/><text class="tk" x="${f1(x(d) + 3)}" y="${H - 6}">${escAttr(label(d))}</text>`).join("");
  const now = nowMs > t0 && nowMs < t1 ? `<line class="now" x1="${f1(x(nowMs))}" x2="${f1(x(nowMs))}" y1="${T - 4}" y2="${H - B}"/><text class="tk now-t" x="${f1(x(nowMs) - 3)}" y="${T + 6}" text-anchor="end">now</text>` : "";
  return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escAttr(title)}"><g aria-hidden="true">${grid}${ticks}${rects}${now}</g></svg>`;
}

/** Semicircular Kp gauge 0–9 with a needle at `kp`. */
export function kpGauge(kp, { title = "" } = {}) {
  const cx = 100, cy = 100, r = 80;
  const pt = (k, rr = r) => { const a = Math.PI * (1 - k / 9); return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)]; };
  const arc = (k0, k1, cls) => { const [x0, y0] = pt(k0), [x1, y1] = pt(k1); return `<path class="${cls}" d="M${f1(x0)} ${f1(y0)} A${r} ${r} 0 0 1 ${f1(x1)} ${f1(y1)}"/>`; };
  const v = Math.max(0, Math.min(9, kp));
  const [nx, ny] = pt(v, r - 14);
  const labels = [0, 3, 5, 7, 9].map((k) => { const [lx, ly] = pt(k, r + 12); return `<text class="tk" x="${f1(lx)}" y="${f1(ly + 4)}" text-anchor="middle">${k}</text>`; }).join("");
  return `<svg class="viz gauge" viewBox="0 0 200 118" role="img" aria-label="${escAttr(title)}"><g aria-hidden="true">
    ${arc(0, 4, "g-arc kp-q")}${arc(4, 5, "g-arc kp-a")}${arc(5, 9, "g-arc kp-s")}${labels}
    <line class="needle" x1="${cx}" y1="${cy}" x2="${f1(nx)}" y2="${f1(ny)}"/><circle class="needle-hub" cx="${cx}" cy="${cy}" r="5"/>
    <text class="g-val" x="${cx}" y="${cy - 22}" text-anchor="middle">${kp.toFixed(2)}</text></g></svg>`;
}

/**
 * Line chart. series = [{pts: [[ms, value]], cls}], y = {min, max, log}, yTicks = [{v, label}],
 * bands = [{from, to, label, cls}] shaded horizontal ranges, xTicks = [{t, label}].
 * Gaps longer than `gapMs` break the line instead of drawing across missing data.
 */
export function lineChart({ series, t0, t1, y, yTicks = [], bands = [], xTicks = [], title = "", W = 400, H = 150, gapMs = 10 * 60e3, nowMs }) {
  const L = 34, R = bands.length ? 16 : 4, T = 6, B = 20, ch = H - T - B;
  const tf = (v) => (y.log ? Math.log10(Math.max(v, y.min)) : v);
  const lo = tf(y.min), hi = tf(y.max);
  const X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const Y = (v) => T + ch - ((Math.min(hi, Math.max(lo, tf(v))) - lo) / (hi - lo)) * ch;
  const band = bands.map((b) => `<rect class="band ${b.cls || ""}" x="${L}" width="${W - L - R}" y="${f1(Y(b.to))}" height="${f1(Y(b.from) - Y(b.to))}"/><text class="tk band-l" x="${W - R + 3}" y="${f1((Y(b.to) + Y(b.from)) / 2 + 4)}">${escAttr(b.label)}</text>`).join("");
  const grid = yTicks.map((k) => `<line class="ax" x1="${L}" x2="${W - R}" y1="${f1(Y(k.v))}" y2="${f1(Y(k.v))}"/><text class="tk" x="${L - 4}" y="${f1(Y(k.v) + 4)}" text-anchor="end">${escAttr(k.label)}</text>`).join("");
  const xt = xTicks.filter((k) => k.t >= t0 && k.t <= t1).map((k) => `<line class="ax" x1="${f1(X(k.t))}" x2="${f1(X(k.t))}" y1="${T}" y2="${H - B}"/><text class="tk" x="${f1(X(k.t))}" y="${H - 5}" text-anchor="middle">${escAttr(k.label)}</text>`).join("");
  const lines = series.map((s) => {
    let d = "", prev = null;
    for (const [t, v] of s.pts) {
      if (t < t0 || t > t1 || v == null || !Number.isFinite(v)) { prev = null; continue; }
      d += `${prev == null || t - prev > gapMs ? "M" : "L"}${f1(X(t))} ${f1(Y(v))}`;
      prev = t;
    }
    return d ? `<path class="ln ${s.cls || ""}" d="${d}"/>` : "";
  }).join("");
  const now = nowMs ? `<line class="now" x1="${f1(X(nowMs))}" x2="${f1(X(nowMs))}" y1="${T}" y2="${H - B}"/>` : "";
  return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escAttr(title)}"><g aria-hidden="true">${band}${grid}${xt}${lines}${now}</g></svg>`;
}

/** GOES X-ray flare class for a 0.1–0.8 nm flux in W/m² (e.g. 1.2e-6 → "C1.2"). */
export function xrayClass(flux) {
  if (!(flux > 0)) return "—";
  const tiers = [["X", 1e-4], ["M", 1e-5], ["C", 1e-6], ["B", 1e-7], ["A", 1e-8]];
  for (const [c, base] of tiers) if (flux >= base) return c + (Math.floor((flux / base) * 10) / 10).toFixed(1);
  return "A" + (Math.floor((flux / 1e-8) * 10) / 10).toFixed(1);
}

/**
 * 48-hour cloud strip: three rows (high, mid, low) of hourly cloud cover drawn over the darkness band
 * of each hour. hours = [{t: ms, low, mid, high, band}] one per hour; ticks = [{t, label}].
 */
export function cloudStrip(hours, { ticks = [], nowMs, title = "" } = {}) {
  if (!hours.length) return "";
  const W = 480, L = 46, R = 2, T = 2, rowH = 20, gap = 2, B = 20, H = T + 3 * rowH + 2 * gap + B;
  const t0 = hours[0].t, t1 = hours[hours.length - 1].t + 3600e3, X = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const cw = (W - L - R) / hours.length;
  const rows = [["high", "High"], ["mid", "Mid"], ["low", "Low"]];
  let g = "";
  rows.forEach(([k, lab], i) => {
    const y = T + i * (rowH + gap);
    g += `<text class="tk" x="${L - 4}" y="${y + rowH - 4}" text-anchor="end">${lab}</text>`;
    for (const h of hours) {
      const x = f1(X(h.t)), w = f1(cw + 0.3);
      g += `<rect class="cs-${h.band}" x="${x}" y="${y}" width="${w}" height="${rowH}"/>`;
      const v = h[k];
      // Missing or non-numeric values are drawn hatched ("no data"), never as clear sky.
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) g += `<rect class="cs-na" x="${x}" y="${y}" width="${w}" height="${rowH}"/>`;
      else if (v > 0) g += `<rect class="cs-cloud" x="${x}" y="${y}" width="${w}" height="${rowH}" fill-opacity="${(v / 100 * 0.9).toFixed(2)}"/>`;
    }
  });
  const yb = T + 3 * rowH + 2 * gap;
  for (const k of ticks) if (k.t >= t0 && k.t <= t1) g += `<line class="ax" x1="${f1(X(k.t))}" x2="${f1(X(k.t))}" y1="${yb}" y2="${yb + 4}"/><text class="tk" x="${f1(X(k.t))}" y="${H - 2}" text-anchor="middle">${escAttr(k.label)}</text>`;
  if (nowMs >= t0 && nowMs <= t1) g += `<line class="now" x1="${f1(X(nowMs))}" x2="${f1(X(nowMs))}" y1="0" y2="${yb}"/>`;
  const defs = '<defs><pattern id="cs-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="cs-hatch" x1="0" y1="0" x2="0" y2="6"/></pattern></defs>';
  return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escAttr(title)}">${defs}<g aria-hidden="true">${g}</g></svg>`;
}
