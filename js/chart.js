// All-sky chart: stereographic projection centred on the zenith, north up, east left (as seen lying
// on your back looking up). Stars are J2000 (d3-celestial) rotated to the horizon by Astronomy Engine,
// which applies precession, nutation and refraction.
import * as A from "./astro.js";

const OBL = 23.4392911 * A.DEG; // J2000 mean obliquity
const BV_COLORS = [[-0.4, "#9bb2ff"], [0, "#cad7ff"], [0.4, "#f8f7ff"], [0.8, "#fff4e8"], [1.2, "#ffd2a1"], [2, "#ffb46b"]];
function bvColor(bv) { for (const [b, c] of BV_COLORS) if (bv <= b) return c; return "#ffb46b"; }

let probeEl = null;
function colorProbe() {
  if (!probeEl) { probeEl = document.createElement("span"); probeEl.hidden = true; probeEl.setAttribute("aria-hidden", "true"); document.body.appendChild(probeEl); }
  return probeEl;
}

export function drawChart(canvas, { t, lat, lon, sky, sats, layers, showers, red, css }) {
  // Resolve custom properties to concrete colours: canvas can't parse calc()/var() values (red theme).
  const probe = colorProbe();
  const v = (n, d) => {
    if (!css.getPropertyValue(n).trim()) return d;
    probe.style.color = `var(${n})`;
    return getComputedStyle(probe).color || d;
  };
  const col = {
    bg: v("--chart-bg", "#02040a"), horizon: v("--chart-horizon", "#3a4a66"), grid: v("--chart-grid", "#1b2538"),
    line: v("--chart-line", "#3d5a85"), label: v("--chart-label", "#8fa6c8"), text: v("--text", "#e8eef8"),
    planet: v("--chart-planet", "#ffd76a"), moon: v("--chart-moon", "#f2f2e6"), sat: v("--chart-sat", "#7dffb2"),
    satDim: v("--chart-sat-dim", "#4b6b5c"), ecl: v("--chart-ecl", "#8a6d2e"), rad: v("--chart-rad", "#ff7ab8"),
    star: v("--chart-star", "#ffffff"),
  };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 640;
  const size = Math.round(cssW * dpr);
  if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  const ctx = canvas.getContext("2d");
  const W = size, cx = W / 2, cy = W / 2, R = W / 2 - 22 * dpr;
  const proj = A.horizonProjector(t, lat, lon);
  const xy = (alt, az) => {
    const rho = R * Math.tan(((90 - alt) * A.DEG) / 2);
    return [cx - rho * Math.sin(az * A.DEG), cy - rho * Math.cos(az * A.DEG)];
  };
  const objects = [];
  ctx.fillStyle = col.bg; ctx.fillRect(0, 0, W, W);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();
  // altitude rings 30°, 60°
  ctx.strokeStyle = col.grid; ctx.lineWidth = 1 * dpr;
  for (const a of [30, 60]) { const r = R * Math.tan(((90 - a) * A.DEG) / 2); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke(); }
  // ecliptic
  if (layers.ecl) {
    ctx.strokeStyle = col.ecl; ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.beginPath();
    let pen = false;
    for (let l = 0; l <= 360; l += 2) {
      const L = l * A.DEG;
      const dec = Math.asin(Math.sin(OBL) * Math.sin(L)) / A.DEG;
      const ra = A.norm360(Math.atan2(Math.cos(OBL) * Math.sin(L), Math.cos(L)) / A.DEG);
      const h = proj(ra, dec, false);
      if (h.alt < -2) { pen = false; continue; }
      const [x, y] = xy(h.alt, h.az);
      pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true;
    }
    ctx.stroke(); ctx.setLineDash([]);
  }
  // constellation lines + labels
  if (layers.const && sky) {
    ctx.strokeStyle = col.line; ctx.lineWidth = 1 * dpr; ctx.beginPath();
    for (const polys of Object.values(sky.lines)) for (const poly of polys) {
      let prev = null;
      for (const [ra, dec] of poly) {
        const h = proj(ra, dec, false);
        const p = h.alt > -5 ? xy(h.alt, h.az) : null;
        if (p && prev) { ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); }
        prev = p;
      }
    }
    ctx.stroke();
    ctx.fillStyle = col.label; ctx.font = `${11 * dpr}px system-ui, sans-serif`; ctx.textAlign = "center";
    for (const [, name, ra, dec] of sky.constellations) {
      const h = proj(ra, dec, false);
      if (h.alt > 8) { const [x, y] = xy(h.alt, h.az); ctx.fillText(name, x, y); }
    }
  }
  // stars
  if (sky) {
    for (const [ra, dec, mag, bv, name] of sky.stars) {
      const h = proj(ra, dec, true);
      if (h.alt < 0) continue;
      const [x, y] = xy(h.alt, h.az);
      const r = Math.max(0.6, (5.4 - mag) * 0.75) * dpr;
      ctx.fillStyle = red ? col.star : bvColor(bv);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
      if (name) objects.push({ kind: "star", label: name, alt: h.alt, az: h.az, mag, x, y });
      if (name && mag < 1.6) { ctx.fillStyle = col.label; ctx.textAlign = "left"; ctx.fillText(name, x + r + 3 * dpr, y + 4 * dpr); }
    }
  }
  // meteor radiants
  if (layers.rad) for (const s of showers) {
    const h = proj(s.ra, s.dec, false);
    if (h.alt < 0) continue;
    const [x, y] = xy(h.alt, h.az);
    ctx.strokeStyle = col.rad; ctx.lineWidth = 1.5 * dpr;
    for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 4 * dpr, y + Math.sin(a) * 4 * dpr); ctx.lineTo(x + Math.cos(a) * 10 * dpr, y + Math.sin(a) * 10 * dpr); ctx.stroke(); }
    ctx.fillStyle = col.rad; ctx.textAlign = "left"; ctx.fillText(`${s.name} radiant`, x + 12 * dpr, y - 6 * dpr);
    objects.push({ kind: "radiant", label: `${s.name} radiant (ZHR ${s.zhr})`, alt: h.alt, az: h.az, x, y });
  }
  // satellites
  for (const s of sats || []) {
    const [x, y] = xy(s.el, s.az);
    const iss = s.norad === 25544;
    ctx.fillStyle = s.lit ? col.sat : col.satDim;
    const r = (iss ? 4 : 2.2) * dpr;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    if (iss) { ctx.textAlign = "left"; ctx.fillText("ISS", x + 6 * dpr, y - 4 * dpr); }
    objects.push({ kind: "sat", label: `${s.name}${s.lit ? " (sunlit)" : " (not visible)"}`, alt: s.el, az: s.az, mag: null, x, y });
  }
  // Sun, Moon, planets
  for (const k of ["sun", "moon", ...A.PLANET_KEYS]) {
    const p = A.bodyPosition(k, t, lat, lon);
    if (p.alt < -0.5) continue;
    const [x, y] = xy(p.alt, p.az);
    const ill = A.bodyIllumination(k, t);
    const r = (k === "moon" || k === "sun" ? 8 : 4.5) * dpr;
    ctx.fillStyle = k === "moon" ? col.moon : k === "sun" ? col.planet : col.planet;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = col.text; ctx.textAlign = "left"; ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
    ctx.fillText(A.bodyName(k), x + r + 3 * dpr, y + 4 * dpr);
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    objects.push({ kind: k === "sun" || k === "moon" ? k : "planet", label: A.bodyName(k), alt: p.alt, az: p.az, mag: ill.mag, x, y });
  }
  ctx.restore();
  // horizon + compass
  ctx.strokeStyle = col.horizon; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
  ctx.fillStyle = col.text; ctx.font = `700 ${13 * dpr}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const [lab, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]]) {
    const x = cx - (R + 11 * dpr) * Math.sin(az * A.DEG), y = cy - (R + 11 * dpr) * Math.cos(az * A.DEG);
    ctx.fillText(lab, x, y);
  }
  ctx.textBaseline = "alphabetic";
  return { objects, dpr };
}

export function hitTest(scene, x, y, radius) {
  let best = null, bd = radius * radius;
  for (const o of scene.objects) {
    const d = (o.x - x) ** 2 + (o.y - y) ** 2;
    if (d < bd || (best && d === bd && (o.mag ?? 9) < (best.mag ?? 9))) { bd = d; best = o; }
  }
  return best;
}
