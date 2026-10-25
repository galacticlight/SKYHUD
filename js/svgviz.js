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
