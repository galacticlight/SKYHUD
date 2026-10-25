// World map (plate carrée) on a canvas: coastlines, ISS ground track and position, your location,
// and your location. No libraries.
import { cssColor } from "./chart.js";

/** lon/lat → canvas x/y for a W×H plate carrée map centred on 0°. */
export const project = (lon, lat, W, H) => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];

/** Split a polyline wherever it jumps across the antimeridian, so it isn't drawn across the whole map. */
export function splitAntimeridian(points) {
  const out = [];
  let cur = [];
  for (const p of points) {
    const prev = cur[cur.length - 1];
    if (prev && Math.abs(p.lon - prev.lon) > 180) { if (cur.length > 1) out.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

export function drawMap(canvas, { coast, track = [], iss = null, home = null, css }) {
  const col = {
    bg: cssColor(css, "--chart-bg", "#02040a"), grid: cssColor(css, "--chart-grid", "#1b2538"),
    land: cssColor(css, "--map-coast", "#5f7aa8"), track: cssColor(css, "--chart-sat-dim", "#4b6b5c"),
    iss: cssColor(css, "--chart-sat", "#7dffb2"), text: cssColor(css, "--text", "#e8eef8"), home: cssColor(css, "--chart-planet", "#ffd76a"),
  };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round((canvas.clientWidth || 720) * dpr), H = Math.round(W / 2);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext("2d");
  const P = (lon, lat) => project(lon, lat, W, H);
  ctx.fillStyle = col.bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = col.grid; ctx.lineWidth = 1 * dpr; ctx.beginPath();
  for (let lon = -150; lon < 180; lon += 30) { const [x] = P(lon, 0); ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let lat = -60; lat <= 60; lat += 30) { const [, y] = P(0, lat); ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  if (coast) {
    ctx.strokeStyle = col.land; ctx.lineWidth = 1 * dpr; ctx.beginPath();
    for (const l of coast.lines) {
      for (let i = 0; i < l.length; i += 2) {
        const [x, y] = P(l[i], l[i + 1]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
  }
  // ground track: past solid-dim, future dashed
  const now = Date.now();
  for (const [part, dash] of [[track.filter((p) => p.t <= now), []], [track.filter((p) => p.t >= now - 60e3), [5 * dpr, 4 * dpr]]]) {
    ctx.strokeStyle = col.iss; ctx.globalAlpha = dash.length ? 0.9 : 0.5; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash(dash);
    for (const seg of splitAntimeridian(part)) {
      ctx.beginPath();
      seg.forEach((p, i) => { const [x, y] = P(p.lon, p.lat); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`; ctx.textBaseline = "middle";
  if (home) {
    const [x, y] = P(home.lon, home.lat);
    ctx.strokeStyle = col.home; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.moveTo(x - 6 * dpr, y); ctx.lineTo(x + 6 * dpr, y); ctx.moveTo(x, y - 6 * dpr); ctx.lineTo(x, y + 6 * dpr); ctx.stroke();
    ctx.fillStyle = col.home; ctx.textAlign = x > W - 60 * dpr ? "right" : "left";
    ctx.fillText("You", x + (ctx.textAlign === "right" ? -9 : 9) * dpr, y);
  }
  if (iss) {
    const [x, y] = P(iss.lon, iss.lat);
    ctx.fillStyle = col.bg; ctx.beginPath(); ctx.arc(x, y, 8 * dpr, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = col.iss; ctx.beginPath(); ctx.arc(x, y, 5.5 * dpr, 0, 2 * Math.PI); ctx.fill();
    ctx.textAlign = x > W - 60 * dpr ? "right" : "left";
    ctx.fillText(iss.computed ? "ISS (computed)" : "ISS", x + (ctx.textAlign === "right" ? -11 : 11) * dpr, y);
  }
  ctx.textBaseline = "alphabetic";
}
