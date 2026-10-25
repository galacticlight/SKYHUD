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

/** Resolve a CSS custom property to a concrete colour string the canvas can use. */
export function cssColor(css, name, fallback) {
  if (!css.getPropertyValue(name).trim()) return fallback;
  const probe = colorProbe();
  probe.style.color = `var(${name})`;
  return getComputedStyle(probe).color || fallback;
}

export function drawChart(canvas, { t, lat, lon, sky, sats, layers, showers, red, css, moonAge = null, moonBright = false }) {
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
  // Boxes already drawn (labels, planet/Moon/ISS markers), so meteor badges can avoid covering them.
  const taken = [];
  const labelBox = (text, x, y) => { const w = ctx.measureText(text).width; taken.push([x, y - 11 * dpr, w, 14 * dpr]); };
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
      if (name && mag < 1.6) { ctx.fillStyle = col.label; ctx.textAlign = "left"; ctx.fillText(name, x + r + 3 * dpr, y + 4 * dpr); labelBox(name, x + r + 3 * dpr, y + 4 * dpr); }
    }
  }
  // satellites
  for (const s of sats || []) {
    const [x, y] = xy(s.el, s.az);
    const iss = s.norad === 25544;
    ctx.fillStyle = s.lit ? col.sat : col.satDim;
    const r = (iss ? 4 : 2.2) * dpr;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    if (iss) { ctx.fillStyle = col.text; ctx.textAlign = "left"; ctx.fillText("ISS", x + 6 * dpr, y - 4 * dpr); labelBox("ISS", x + 6 * dpr, y - 4 * dpr); taken.push([x - r, y - r, 2 * r, 2 * r]); }
    objects.push({ kind: "sat", label: `${s.name}${s.lit ? " (sunlit)" : " (not visible)"}`, alt: s.el, az: s.az, mag: null, x, y });
  }
  // Sun, Moon, planets
  for (const k of ["sun", "moon", ...A.PLANET_KEYS]) {
    const p = A.bodyPosition(k, t, lat, lon);
    if (p.alt < -0.5) continue;
    const [x, y] = xy(p.alt, p.az);
    const ill = A.bodyIllumination(k, t);
    const r = (k === "moon" ? 10 : k === "sun" ? 8 : 4.5) * dpr;
    if (k === "moon" && moonAge != null) drawMoonPhase(ctx, x, y, r, moonAge, col.moon, col.grid);
    else { ctx.fillStyle = col.planet; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); }
    ctx.fillStyle = col.text; ctx.textAlign = "left"; ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
    ctx.fillText(A.bodyName(k), x + r + 3 * dpr, y + 4 * dpr);
    labelBox(A.bodyName(k), x + r + 3 * dpr, y + 4 * dpr); taken.push([x - r, y - r, 2 * r, 2 * r]);
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    objects.push({ kind: k === "sun" || k === "moon" ? k : "planet", label: A.bodyName(k), alt: p.alt, az: p.az, mag: ill.mag, x, y });
  }
  // meteor radiants: live altitude + ZHR badge, drawn faint when a bright Moon washes out faint meteors
  if (layers.rad) {
    for (const s of showers) {
      const h = proj(s.ra, s.dec, false);
      if (h.alt < 0) continue;
      const [x, y] = xy(h.alt, h.az);
      ctx.globalAlpha = moonBright ? 0.5 : 1;
      ctx.strokeStyle = col.rad; ctx.lineWidth = 1.5 * dpr;
      for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 4 * dpr, y + Math.sin(a) * 4 * dpr); ctx.lineTo(x + Math.cos(a) * 10 * dpr, y + Math.sin(a) * 10 * dpr); ctx.stroke(); }
      ctx.globalAlpha = 1;
      // Badge text uses the text colour (red-mode contrast floor); only the border and rays dim. A dashed border marks "dimmed by moonlight".
      const badge = `${s.name} · ZHR ${s.zhr} · ${Math.round(h.alt)}° up${moonBright ? " · bright Moon" : ""}`;
      ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
      const bw = ctx.measureText(badge).width + 8 * dpr, bh = 16 * dpr;
      // Try spots around the radiant (above/below, right/left, then stepping further out) and take the first that
      // covers no planet, Moon, ISS or star label and no other badge; if none is free, use the least-crowded one.
      const clampX = (v) => Math.max(2 * dpr, Math.min(v, W - bw - 2 * dpr));
      const hits = (bx, by) => taken.reduce((n, r) => n + (bx < r[0] + r[2] + 2 * dpr && bx + bw + 2 * dpr > r[0] && by < r[1] + r[3] + 2 * dpr && by + bh + 2 * dpr > r[1] ? 1 : 0), 0);
      let best = null;
      for (let step = 0; step < 6 && !(best && best.n === 0); step++) {
        const d = step * (bh + 3 * dpr);
        for (const [bx, by] of [[x + 12 * dpr, y - 22 * dpr - d], [x + 12 * dpr, y + 8 * dpr + d], [x - 12 * dpr - bw, y - 22 * dpr - d], [x - 12 * dpr - bw, y + 8 * dpr + d]]) {
          const c = { bx: clampX(bx), by, n: 0 };
          c.n = hits(c.bx, c.by);
          if (!best || c.n < best.n) best = c;
          if (c.n === 0) break;
        }
      }
      const { bx, by } = best;
      taken.push([bx, by, bw, bh]);
      ctx.fillStyle = col.bg; ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = col.rad; ctx.lineWidth = 1 * dpr; if (moonBright) ctx.setLineDash([3 * dpr, 2 * dpr]);
      ctx.strokeRect(bx, by, bw, bh); ctx.setLineDash([]);
      ctx.fillStyle = col.text; ctx.textAlign = "left"; ctx.fillText(badge, bx + 4 * dpr, by + 12 * dpr);
      ctx.font = `${11 * dpr}px system-ui, sans-serif`;
      objects.push({ kind: "radiant", label: `${s.name} radiant (ZHR ${s.zhr}${moonBright ? ", bright Moon: expect far fewer" : ""})`, alt: h.alt, az: h.az, x, y });
    }
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

/** Moon disc with the lit part drawn from the phase age (0 new, 180 full); northern-hemisphere orientation. */
function drawMoonPhase(ctx, x, y, r, age, lit, dark) {
  ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
  const k = Math.cos((age * Math.PI) / 180), waxing = age < 180;
  ctx.fillStyle = lit; ctx.beginPath();
  // outer limb: right half when waxing, left half when waning
  ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, !waxing);
  // terminator: half-ellipse back to the top
  ctx.ellipse(x, y, Math.max(0.01, Math.abs(k) * r), r, 0, Math.PI / 2, -Math.PI / 2, k > 0 ? waxing : !waxing);
  ctx.fill();
  ctx.strokeStyle = lit; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.stroke();
}

export function hitTest(scene, x, y, radius) {
  let best = null, bd = radius * radius;
  for (const o of scene.objects) {
    const d = (o.x - x) ** 2 + (o.y - y) ** 2;
    if (d < bd || (best && d === bd && (o.mag ?? 9) < (best.mag ?? 9))) { bd = d; best = o; }
  }
  return best;
}
