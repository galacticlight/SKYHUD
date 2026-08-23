/* SKYHUD — Seattle sky tracks (GitHub Pages static build) */
(function () {
  const SEA = { lat: 47.6062, lon: -122.3321, altKm: 0.05 };
  const TZ = "America/Los_Angeles";
  const MIN_EL = 10;
  const ISS = 25544;
  const CSS = 48274;
  const HST = 20580;
  const FALLBACK = [
    "ISS (ZARYA)",
    "1 25544U 98067A   26234.50053383  .00009133  00000-0  17025-3 0  9998",
    "2 25544  51.6331 331.8814 0007668  72.6488 287.5339 15.49570248582031",
  ];
  const NAME_KEEP =
    /\b(ISS|ZARYA|CSS|TIANHE|WENTIAN|MENGTIAN|HST|HUBBLE|NOAA[- ]?\d|METEOR[- ]?M|LANDSAT|TERRA\b|AQUA\b|ENVISAT|SENTINEL[- ]?[123]|SUOMI|JPSS|\bNPP\b|CALIPSO|CLOUDSAT|FENGYUN|YAOGAN|RESURS|KANOPUS|COSMOS[- ]?\d+|SL-16 R\/B|SL-14 R\/B|AO-\d+|SO-50|FO-\d+|IO-\d+|PO-\d+)\b/i;
  const NAME_DROP = /STARLINK|ONEWEB|KUIPER|SPACEX|DUMMY/i;
  const PROJECTS = {
    globe: {
      kicker: "Do now · 10 min",
      title: "Globe at Night",
      body: "Step outside more than an hour after sunset, let your eyes adapt, and report how many stars you can see. Seattle city glow makes each measurement useful for light-pollution science.",
      href: "https://globeatnight.org/",
      filter: "outside",
    },
    iss: {
      kicker: "Catch a pass",
      title: "ISS · Video",
      body: "When the countdown hits, face the listed direction and shoot a 20–40 second phone video of the station crossing.",
      href: "https://spotthestation.nasa.gov/",
      filter: "outside",
    },
    sas: {
      kicker: "Next event",
      title: "SAS Star Party",
      body: "Seattle Astronomical Society public stargaze. Next: Friday 11 Sep 2026 · Duvall Big Rock Park (approx 20:30–01:00). Free. Scopes often provided. Weather-dependent. Confirm at seattleastro.org.",
      href: "https://www.seattleastro.org/",
      filter: "events",
    },
  };
  const EVENTS = [
    { start: "2026-09-11T20:30:00-07:00", end: "2026-09-12T01:00:00-07:00", text: "SAS · Duvall Big Rock Park · Fri 20:30" },
    { start: "2026-09-01T00:00:00-07:00", end: "2026-09-15T00:00:00-07:00", text: "Sept Globe at Night campaign window" },
  ];

  const sat = window.satellite;
  const observer = {
    latitude: sat.degreesToRadians(SEA.lat),
    longitude: sat.degreesToRadians(SEA.lon),
    height: SEA.altKm,
  };
  const AU = 149597870.7;
  const RE = 6378.137;
  const R2D = 180 / Math.PI;
  const BOOT = Date.now();

  let sats = [];
  let passes = [];
  let selected = ISS;
  let lastTier = null;
  let logs = [];
  let computing = true;

  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, "0");
  function fmtTime(d) {
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
  }
  function fmtHm(d) {
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  }
  function fmtDate(d) {
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(d).toUpperCase();
  }
  function formatTminus(ms) {
    if (!Number.isFinite(ms)) return "T— --:--";
    const sign = ms < 0 ? "+" : "—";
    const abs = Math.abs(ms) / 1000;
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const s = Math.floor(abs % 60);
    return h > 0 ? `T${sign} ${h}:${pad(m)}:${pad(s)}` : `T${sign} ${pad(m)}:${pad(s)}`;
  }
  function azLabel(az) {
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((az % 360) + 360) % 360) / 45) % 8];
  }
  function moonPhase(date) {
    const synodic = 29.53058867;
    const known = Date.UTC(2000, 0, 6, 18, 14, 0);
    const days = (date.getTime() - known) / 86400000;
    const age = ((days % synodic) + synodic) % synodic;
    const pct = Math.round(((1 - Math.cos((2 * Math.PI * age) / synodic)) / 2) * 100);
    let name = "WAXING";
    if (age < 1.8 || age > 27.7) name = "NEW";
    else if (age < 6.1) name = "WAXING CRES";
    else if (age < 8.9) name = "FIRST Q";
    else if (age < 13.8) name = "WAXING GIB";
    else if (age < 16.8) name = "FULL";
    else if (age < 21.7) name = "WANING GIB";
    else if (age < 24.7) name = "LAST Q";
    else name = "WANING CRES";
    return { pct, name };
  }
  function displayName(s) {
    if (s.norad === ISS) return "ISS";
    if (s.norad === CSS) return "CSS · TIANHE";
    if (s.norad === HST) return "HUBBLE";
    return String(s.name || "").replace(/\s+/g, " ").slice(0, 28).toUpperCase();
  }

  function sunEciKm(date) {
    const n = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
    const L = (280.46 + 0.9856474 * n) % 360;
    const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
    const lam = ((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI) / 180;
    const eps = (23.439 * Math.PI) / 180;
    const r = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
    return { x: r * Math.cos(lam) * AU, y: r * Math.cos(eps) * Math.sin(lam) * AU, z: r * Math.sin(eps) * Math.sin(lam) * AU };
  }
  function sunlit(p, sun) {
    const sl = Math.hypot(sun.x, sun.y, sun.z) || 1;
    const ux = sun.x / sl, uy = sun.y / sl, uz = sun.z / sl;
    const dot = p.x * ux + p.y * uy + p.z * uz;
    if (dot > 0) return true;
    return Math.hypot(p.x - dot * ux, p.y - dot * uy, p.z - dot * uz) > RE;
  }
  function lookAt(satrec, date) {
    const ev = sat.propagate(satrec, date);
    if (!ev || !ev.position || ev.position === true) return null;
    const gmst = sat.gstime(date);
    const gd = sat.eciToGeodetic(ev.position, gmst);
    const look = sat.ecfToLookAngles(observer, sat.eciToEcf(ev.position, gmst));
    return {
      el: look.elevation * R2D,
      az: ((look.azimuth * R2D) % 360 + 360) % 360,
      rangeKm: look.rangeSat,
      lat: sat.degreesLat(gd.latitude),
      lon: sat.degreesLong(gd.longitude),
      altKm: gd.height,
      sunlit: sunlit(ev.position, sunEciKm(date)),
    };
  }
  function observerSunEl(date) {
    const sun = sunEciKm(date);
    const look = sat.ecfToLookAngles(observer, sat.eciToEcf(sun, sat.gstime(date)));
    return look.elevation * R2D;
  }

  function log(msg, level) {
    logs.unshift({ t: fmtTime(new Date()), msg, level: level || "norm" });
    logs = logs.slice(0, 10);
    $("log-list").innerHTML = logs
      .map((l) => `<li class="${l.level === "alert" ? "alert" : l.level === "hi" ? "hi" : ""}">[${l.t}] ${l.msg}</li>`)
      .join("");
  }
  function showToast(msg, urgent) {
    const el = $("toast");
    $("toast-msg").textContent = msg;
    el.classList.toggle("urgent", !!urgent);
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => { el.hidden = true; }, 400);
    }, urgent ? 8000 : 5000);
  }

  function parseTleText(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i], b = lines[i + 1], c = lines[i + 2];
      if (a && a.startsWith("1 ") && b && b.startsWith("2 ")) {
        out.push({ name: "NORAD " + a.slice(2, 7).trim(), norad: parseInt(a.slice(2, 7), 10), l1: a, l2: b });
        i += 1;
      } else if (b && b.startsWith("1 ") && c && c.startsWith("2 ")) {
        out.push({ name: a.replace(/^0\s+/, ""), norad: parseInt(b.slice(2, 7), 10), l1: b, l2: c });
        i += 2;
      }
    }
    return out;
  }
  function keep(e) {
    if (!e.norad || NAME_DROP.test(e.name)) return false;
    return e.norad === ISS || e.norad === CSS || e.norad === HST || NAME_KEEP.test(e.name);
  }

  async function grab(url) {
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) return null;
      return await res.text();
    } catch (_) {
      return null;
    }
  }

  async function loadCatalog() {
    log("Loading orbital elements…");
    const collected = [];
    const [ariss, amsat, satnogs] = await Promise.all([
      grab("https://live.ariss.org/iss.txt"),
      grab("https://www.amsat.org/tle/current/nasabare.txt"),
      grab("https://db.satnogs.org/api/tle/?format=json"),
    ]);
    let source = "fallback";
    if (ariss) { collected.push(...parseTleText(ariss)); source = "ariss"; }
    if (amsat) { collected.push(...parseTleText(amsat)); source = "amsat"; }
    if (satnogs) {
      try {
        const rows = JSON.parse(satnogs);
        rows.forEach((r) => {
          if (r.tle1 && r.tle2) collected.push({ name: (r.tle0 || "").replace(/^0\s+/, ""), norad: r.norad_cat_id || 0, l1: r.tle1, l2: r.tle2 });
        });
        source = "satnogs+mirrors";
      } catch (_) {}
    }
    const by = new Map();
    collected.filter(keep).forEach((e) => {
      try {
        const rec = sat.twoline2satrec(e.l1, e.l2);
        if (!rec) return;
        const prev = by.get(e.norad);
        if (!prev || e.name.length > prev.name.length) by.set(e.norad, { ...e, satrec: rec, name: displayName(e) });
      } catch (_) {}
    });
    if (!by.has(ISS)) {
      const rec = sat.twoline2satrec(FALLBACK[1], FALLBACK[2]);
      by.set(ISS, { name: "ISS", norad: ISS, satrec: rec, l1: FALLBACK[1], l2: FALLBACK[2] });
    }
    sats = [...by.values()];
    $("tle-source").textContent = source.toUpperCase();
    log("TLE lock · " + source + " · " + sats.length + " objects", "hi");
  }

  function findPasses(s, from) {
    const start = from.getTime();
    const end = start + 12 * 3600 * 1000;
    const found = [];
    let inPass = false, rise = 0, maxEl = -90, maxT = 0, azRise = 0, azSet = 0, optical = false;
    for (let t = start; t <= end; t += 45000) {
      const o = lookAt(s.satrec, new Date(t));
      if (!o) continue;
      if (!inPass && o.el >= MIN_EL) {
        inPass = true; rise = t; azRise = o.az; maxEl = o.el; maxT = t; optical = o.sunlit;
      } else if (inPass) {
        if (o.el > maxEl) { maxEl = o.el; maxT = t; }
        if (o.sunlit) optical = true;
        if (o.el < MIN_EL) {
          azSet = o.az;
          found.push(buildPass(s, rise, t, maxEl, maxT, azRise, azSet, optical));
          inPass = false;
        }
      }
    }
    if (inPass) found.push(buildPass(s, rise, end, maxEl, maxT, azRise, azSet || azRise, optical));
    return found;
  }
  function buildPass(s, rise, set, maxEl, maxT, azRise, azSet, optical) {
    const path = [];
    for (let t = rise; t <= set; t += 8000) {
      const o = lookAt(s.satrec, new Date(t));
      if (o && o.el >= 0) path.push({ t, az: o.az, el: o.el, sunlit: o.sunlit });
    }
    return { norad: s.norad, name: s.name, rise, set, maxEl, maxT, azRise, azSet, path, optical };
  }

  async function computeTracks() {
    computing = true;
    const from = new Date();
    const found = [];
    for (let i = 0; i < sats.length; i++) {
      found.push(...findPasses(sats[i], from));
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    found.sort((a, b) => a.rise - b.rise);
    passes = found;
    computing = false;
    log("Pass lattice · " + passes.length + " Seattle tracks", "hi");
  }

  function skyXY(az, el, cx, cy, r) {
    const rho = ((90 - Math.max(-2, el)) / 90) * r;
    const th = (az * Math.PI) / 180;
    return [cx + rho * Math.sin(th), cy - rho * Math.cos(th)];
  }

  function drawSky(now, marks) {
    const canvas = $("sky");
    const wrap = $("sky-wrap");
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.min(wrap.clientWidth, wrap.clientHeight || wrap.clientWidth);
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const red = document.body.classList.contains("red");
    const cx = size / 2, cy = size / 2, r = size * 0.42;
    const cyan = red ? "#ff6b5a" : "#7ecbff";
    const amber = red ? "#ff9a7a" : "#e8b86d";
    const green = red ? "#ff8a7a" : "#6dffb0";
    const dim = red ? "rgba(255,200,188,0.28)" : "rgba(126,203,255,0.28)";
    const faint = red ? "rgba(255,107,90,0.12)" : "rgba(126,203,255,0.12)";
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.strokeStyle = faint; ctx.lineWidth = 1; ctx.stroke();
    [0, 30, 60].forEach((el) => {
      ctx.beginPath(); ctx.arc(cx, cy, ((90 - el) / 90) * r, 0, Math.PI * 2);
      ctx.strokeStyle = el === 0 ? dim : faint; ctx.lineWidth = el === 0 ? 1.25 : 1; ctx.stroke();
    });
    ctx.font = "10px 'Share Tech Mono', ui-monospace, monospace";
    ctx.fillStyle = dim; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("ZENITH", cx, cy - 10);
    [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([lab, az]) => {
      const p = skyXY(az, -6, cx, cy, r);
      ctx.fillStyle = cyan; ctx.fillText(lab, p[0], p[1]);
    });
    ctx.strokeStyle = faint; ctx.lineWidth = 1;
    [0, 45, 90, 135, 180, 225, 270, 315].forEach((az) => {
      const a = skyXY(az, 90, cx, cy, r), b = skyXY(az, 0, cx, cy, r);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    });
    const upcoming = uniqueUpcoming(now).slice(0, 14);
    upcoming.forEach((p) => {
      if (p.path.length < 2) return;
      const isIss = p.norad === ISS, isSel = p.norad === selected;
      ctx.beginPath();
      p.path.forEach((pt, i) => {
        const xy = skyXY(pt.az, pt.el, cx, cy, r);
        if (i === 0) ctx.moveTo(xy[0], xy[1]); else ctx.lineTo(xy[0], xy[1]);
      });
      ctx.strokeStyle = isIss ? amber : isSel ? green : cyan;
      ctx.globalAlpha = isSel || isIss ? 0.95 : 0.45;
      ctx.lineWidth = isIss || isSel ? 2.2 : 1.15;
      ctx.stroke(); ctx.globalAlpha = 1;
    });
    marks.filter((m) => m.look.el >= 0).forEach((m) => {
      const xy = skyXY(m.look.az, m.look.el, cx, cy, r);
      const isIss = m.norad === ISS, isSel = m.norad === selected;
      ctx.beginPath(); ctx.arc(xy[0], xy[1], isIss ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isIss ? amber : isSel ? green : cyan; ctx.fill();
      ctx.fillStyle = isIss ? amber : cyan;
      ctx.font = (isIss ? 11 : 9) + "px 'Share Tech Mono', ui-monospace, monospace";
      ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(m.name, xy[0] + 8, xy[1] - 4);
    });
  }

  function uniqueUpcoming(now) {
    const out = [], seen = new Set();
    for (const p of passes) {
      if (p.set < now) continue;
      if (seen.has(p.norad)) continue;
      seen.add(p.norad);
      out.push(p);
      if (out.length >= 16) break;
    }
    return out;
  }

  function liveMarks(now) {
    const date = new Date(now);
    const out = [];
    sats.forEach((s) => {
      const look = lookAt(s.satrec, date);
      if (look && look.el >= 0) out.push({ norad: s.norad, name: s.name, look });
    });
    out.sort((a, b) => b.look.el - a.look.el);
    return out;
  }

  function renderList(now, marks) {
    const ul = $("pass-list");
    const rows = uniqueUpcoming(now);
    if (!rows.length) {
      ul.innerHTML = `<li class="pass-meta" style="padding:.7rem">${computing ? "Propagating orbits over 47.61N 122.33W…" : "No 10° passes in the next 12 hours."}</li>`;
      return;
    }
    const night = observerSunEl(new Date(now)) < -6;
    ul.innerHTML = rows.map((p) => {
      const live = marks.find((m) => m.norad === p.norad && m.look.el >= 0);
      const cls = (p.norad === ISS ? " iss" : "") + (selected === p.norad ? " active" : "");
      const tag = live && live.look.el >= 10 ? "OVERHEAD" : formatTminus(p.rise - now);
      return `<li><button type="button" class="pass-row${cls}" data-norad="${p.norad}">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <span class="pass-name">${p.name}</span><span class="tag">${tag}</span>
        </div>
        <div class="pass-meta">${fmtHm(new Date(p.rise))}–${fmtHm(new Date(p.set))} · ${azLabel(p.azRise)}→${azLabel(p.azSet)} · max ${p.maxEl.toFixed(0)}°${live ? ` · now ${live.look.el.toFixed(0)}° ${azLabel(live.look.az)}` : ""}${p.optical && night ? " · SUNLIT" : ""}</div>
      </button></li>`;
    }).join("");
  }

  function tick() {
    const now = Date.now();
    const d = new Date(now);
    $("clock").textContent = fmtTime(d) + " PDT";
    $("date-line").textContent = fmtDate(d);
    const m = moonPhase(d);
    $("moon-line").textContent = `MOON ${m.pct}% · ${m.name}`;
    const up = Math.floor((now - BOOT) / 1000);
    $("uptime").textContent = `UP ${pad(Math.floor(up / 3600))}:${pad(Math.floor((up % 3600) / 60))}:${pad(up % 60)}`;
    const upcoming = EVENTS.map((e) => ({ ...e, t: new Date(e.start).getTime() })).filter((e) => new Date(e.end).getTime() > now).sort((a, b) => a.t - b.t)[0];
    $("event-text").textContent = upcoming ? upcoming.text : "Quiet calendar · classify online tonight";

    const marks = liveMarks(now);
    const overhead = marks.filter((x) => x.look.el >= 10);
    const night = observerSunEl(d) < -6;
    $("ops-count").textContent = `${overhead.length} OVERHEAD · ${night ? "ASTRONOMICAL DARK" : "DAYLIGHT GEOMETRY"}`;
    $("track-count").textContent = computing ? "COMPUTING TRACKS…" : `${passes.length} PASSES / 12H`;

    const nextIss = passes.find((p) => p.norad === ISS && p.set >= now);
    const panel = $("iss-panel");
    const status = $("iss-card-status");
    panel.classList.remove("imminent");
    if (!nextIss) {
      $("iss-countdown").textContent = "T— --:--";
      $("iss-when").textContent = computing ? "acquiring lock…" : "no 10° pass in 12h";
      $("iss-meta").textContent = "";
      document.title = "SKYHUD · STANDBY";
      if (status) { status.textContent = "STANDBY"; status.className = "st STANDBY"; }
    } else {
      const ms = nextIss.rise - now;
      $("iss-countdown").textContent = formatTminus(ms);
      $("iss-when").textContent = `${fmtTime(new Date(nextIss.rise))} · max ${nextIss.maxEl.toFixed(0)}°`;
      $("iss-meta").textContent = `${azLabel(nextIss.azRise)} → ${azLabel(nextIss.azSet)} · ${Math.max(1, Math.round((nextIss.set - nextIss.rise) / 60000))} min`;
      $("iss-card-sub").textContent = `Visible ${fmtHm(new Date(nextIss.rise))} · ${azLabel(nextIss.azRise)} → ${azLabel(nextIss.azSet)}`;
      $("iss-arc").style.width = `${Math.round(Math.max(0, Math.min(1, 1 - ms / (6 * 3600 * 1000))) * 100)}%`;
      let tier = "far";
      if (ms <= 5 * 60 * 1000 && ms > -30 * 1000) tier = "imminent";
      else if (ms <= 30 * 60 * 1000 && ms > 0) tier = "soon";
      if (now >= nextIss.rise && now <= nextIss.set) tier = "imminent";
      if (tier === "imminent") panel.classList.add("imminent");
      if (status) {
        status.textContent = tier === "imminent" ? "ACTIVE" : tier === "soon" ? "LOCKED" : "STANDBY";
        status.className = "st " + (tier === "imminent" ? "ACTIVE" : "STANDBY");
      }
      document.title = now >= nextIss.rise && now <= nextIss.set ? "SKYHUD · ISS OVERHEAD" : `SKYHUD · ${formatTminus(ms)} ISS`;
      if (tier !== lastTier) {
        if (tier === "soon") { log("ISS approach · T-30 min window", "hi"); showToast(`ISS pass in ~${Math.round(ms / 60000)} min · ${azLabel(nextIss.azRise)}→${azLabel(nextIss.azSet)}`); }
        if (tier === "imminent") { log("ISS VISUAL WINDOW · LOOK UP", "alert"); showToast(`ISS OVERHEAD SOON · ${azLabel(nextIss.azRise)}→${azLabel(nextIss.azSet)}`, true); }
        lastTier = tier;
      }
    }

    drawSky(now, marks);
    renderList(now, marks);
  }

  $("pass-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-norad]");
    if (!btn) return;
    selected = Number(btn.dataset.norad);
    tick();
  });
  $("sky").addEventListener("click", (e) => {
    const canvas = $("sky");
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const size = rect.width, cx = size / 2, cy = size / 2, r = size * 0.42;
    const marks = liveMarks(Date.now());
    let best = null;
    marks.forEach((m) => {
      const p = skyXY(m.look.az, m.look.el, cx, cy, r);
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < 18 && (!best || d < best.d)) best = { norad: m.norad, d };
    });
    if (best) { selected = best.norad; tick(); }
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const f = chip.dataset.filter;
      $("stage").hidden = !(f === "sky" || f === "all");
      $("missions").hidden = f === "sky";
      document.querySelectorAll(".mission").forEach((card) => {
        const id = card.dataset.id;
        if (f === "all" || f === "sky") card.hidden = false;
        else card.hidden = PROJECTS[id].filter !== f;
      });
      log("Filter · " + f.toUpperCase());
    });
  });
  $("red-toggle").addEventListener("click", () => {
    const on = document.body.classList.toggle("red");
    $("red-toggle").setAttribute("aria-pressed", String(on));
    log(on ? "Red-light mode engaged" : "Red-light mode off", "hi");
    tick();
  });
  $("notify-btn").addEventListener("click", async () => {
    if (typeof Notification === "undefined") { log("Notifications unsupported", "alert"); return; }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      $("notify-btn").classList.add("on");
      $("notify-btn").textContent = "ALERTS ON";
      log("Desktop alerts armed", "hi");
      showToast("Pass alerts enabled");
    } else log("Alert permission denied", "alert");
  });
  document.querySelectorAll(".mission").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = PROJECTS[btn.dataset.id];
      $("sheet-kicker").textContent = p.kicker;
      $("sheet-title").textContent = p.title;
      $("sheet-body").textContent = p.body;
      $("sheet-link").href = p.href;
      $("sheet").hidden = false;
    });
  });
  $("sheet-close").addEventListener("click", () => { $("sheet").hidden = true; });
  $("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) $("sheet").hidden = true; });

  fetch("https://api.open-meteo.com/v1/forecast?latitude=47.6062&longitude=-122.3321&current=cloud_cover&timezone=America%2FLos_Angeles")
    .then((r) => r.json())
    .then((data) => {
      const c = data && data.current && data.current.cloud_cover;
      if (typeof c === "number") {
        const label = c < 25 ? "CLEAR" : c < 60 ? "PARTLY CLOUDY" : "OVERCAST";
        $("cloud-line").textContent = `SKY ${label} · ${c}%`;
        log("Wx uplink · " + label + " " + c + "%");
      }
    })
    .catch(() => { $("cloud-line").textContent = "SKY  check outside"; });

  log("SKYHUD boot · Seattle node");
  tick();
  setInterval(tick, 1000);
  loadCatalog().then(computeTracks).then(tick);
})();
