// World map (plate carrée) on a canvas: coastlines, ISS ground track and position, your location,
// and optionally the NOAA OVATION aurora probability grid as a heat overlay. No libraries.
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

let auroraCache = null; // { key, canvas }
function auroraLayer(aurora, red) {
  const key = `${aurora.at}|${red}`;
  if (auroraCache && auroraCache.key === key) return auroraCache.canvas;
  const c = document.createElement("canvas");
  c.width = 360; c.height = 181;
  const g = c.getContext("2d"), img = g.createImageData(360, 181);
  for (let lat = -90; lat <= 90; lat++) for (let lon = 0; lon < 360; lon++) {
    const v = aurora.grid[(lat + 90) * 360 + lon];
    if (v < 3) continue;
    const x = (lon + 180) % 360, y = 90 - lat, i = (y * 360 + x) * 4, f = Math.min(1, v / 40);
    if (red) { img.data[i] = 150 + 105 * f; img.data[i + 1] = 0; img.data[i + 2] = 0; }
    else { img.data[i] = 255 * Math.max(0, f * 2 - 1); img.data[i + 1] = 200 + 55 * f; img.data[i + 2] = 80 * (1 - f); }
    img.data[i + 3] = 35 + 200 * f;
  }
  g.putImageData(img, 0, 0);
  auroraCache = { key, canvas: c };
  return c;
}

export function drawMap(canvas, { coast, track = [], iss = null, home = null, aurora = null, red = false, css }) {
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
  if (aurora && aurora.grid) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(auroraLayer(aurora, red), 0, 0, 360, 181, 0, -H / 360, W, H + H / 180);
  }
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

/** OVATION JSON → {grid: Uint8Array(360*181) indexed (lat+90)*360+lon (lon 0–359 east), observed, forecast}. */
export function parseOvation(j) {
  const co = j && j.coordinates;
  if (!Array.isArray(co) || co.length < 1000) throw new Error("Unexpected aurora shape");
  const grid = new Uint8Array(360 * 181);
  for (const c of co) {
    const lon = Math.round(c[0]), lat = Math.round(c[1]), v = c[2];
    if (lon >= 0 && lon < 360 && lat >= -90 && lat <= 90 && v > 0) grid[(lat + 90) * 360 + lon] = Math.min(100, Math.round(v));
  }
  const t = (s) => Date.parse(/Z$/.test(s) ? s : s + "Z");
  return { grid, observed: t(j["Observation Time"]), forecast: t(j["Forecast Time"]) };
}
/** Probability (%) at the nearest grid point to a location. */
export const auroraAt = (grid, lat, lon) => grid[(Math.round(lat) + 90) * 360 + ((Math.round(lon) % 360) + 360) % 360];
/**
 * Text equivalent of the oval: for each 30° longitude sector and hemisphere, the latitude closest to the
 * equator where the probability reaches `min`%, and the sector's peak. null = never reaches it.
 */
export function auroraSectors(grid, min = 10) {
  const out = [];
  for (let s = -180; s < 180; s += 30) {
    const row = { from: s, to: s + 30, north: null, south: null, peak: 0 };
    for (let l = s; l < s + 30; l++) {
      const lon = (l + 360) % 360;
      for (let lat = -90; lat <= 90; lat++) {
        const v = grid[(lat + 90) * 360 + lon];
        if (v > row.peak) row.peak = v;
        if (v >= min) {
          if (lat > 0 && (row.north == null || lat < row.north)) row.north = lat;
          if (lat < 0 && (row.south == null || lat > row.south)) row.south = lat;
        }
      }
    }
    out.push(row);
  }
  return out;
}
