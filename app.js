const SEA = { lat: 47.6062, lon: -122.3321, alt: 50 };
const TZ = "America/Los_Angeles";
const BOOT = Date.now();

const PROJECTS = {
  globe: {
    kicker: "Do now · 10 min",
    title: "Globe at Night",
    body: "Step outside more than an hour after sunset, let your eyes adapt, and report how many stars you can see. Seattle's city glow makes each measurement useful for light-pollution science.",
    href: "https://globeatnight.org/",
    filter: "outside",
  },
  iss: {
    kicker: "Catch a pass",
    title: "ISS · Video",
    body: "When the countdown hits, face the listed direction and shoot a 20–40 second phone video of the station crossing. That clip is the seed for backyard satellite photometry.",
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

const FALLBACK_TLE = [
  "1 25544U 98067A   26231.79184849  .00010403  00000-0  19311-3 0  9990",
  "2 25544  51.6331 345.2935 0007660  63.7133 296.4642 15.49516880581615",
];

let satrec = null;
let nextPass = null;
let lastAlertTier = null;
let logLines = [];

function fmtTime(d) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(d);
}

function fmtDate(d) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", month: "short", day: "numeric",
  }).format(d).toUpperCase();
}

function pad(n) {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

function formatTminus(ms) {
  if (!Number.isFinite(ms)) return "T— --:--";
  const sign = ms < 0 ? "+" : "—";
  const abs = Math.abs(ms) / 1000;
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = Math.floor(abs % 60);
  if (h > 0) return `T${sign} ${h}:${pad(m)}:${pad(s)}`;
  return `T${sign} ${pad(m)}:${pad(s)}`;
}

function moonPhase(date) {
  const synodic = 29.53058867;
  const known = Date.UTC(2000, 0, 6, 18, 14, 0);
  const days = (date.getTime() - known) / 86400000;
  const age = ((days % synodic) + synodic) % synodic;
  const illum = (1 - Math.cos((2 * Math.PI * age) / synodic)) / 2;
  const pct = Math.round(illum * 100);
  let name = "WAXING";
  if (age < 1.8 || age > 27.7) name = "NEW";
  else if (age < 6.1) name = "WAXING CRES";
  else if (age < 8.9) name = "FIRST Q";
  else if (age < 13.8) name = "WAXING GIB";
  else if (age < 16.8) name = "FULL";
  else if (age < 21.7) name = "WANING GIB";
  else if (age < 24.7) name = "LAST Q";
  else name = "WANING CRES";
  const toNew = (synodic - age) * 86400000;
  const toFull = (((14.765 - age + synodic) % synodic)) * 86400000;
  return { pct, name, toNew, toFull };
}

function log(msg, level = "norm") {
  const t = fmtTime(new Date());
  logLines.unshift({ t, msg, level });
  logLines = logLines.slice(0, 12);
  const ul = document.getElementById("log-list");
  ul.innerHTML = logLines
    .map((l) => `<li class="${l.level === "alert" ? "alert" : l.level === "hi" ? "hi" : ""}">[${l.t}] ${l.msg}</li>`)
    .join("");
}

function showToast(msg, urgent = false) {
  const el = document.getElementById("toast");
  document.getElementById("toast-msg").textContent = msg;
  el.classList.toggle("urgent", urgent);
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { el.hidden = true; }, 400);
  }, urgent ? 8000 : 5000);
}

function notifyDesktop(title, body) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    try { new Notification(title, { body, silent: false }); } catch (_) {}
  }
}

function tickClock() {
  const now = new Date();
  document.getElementById("clock").textContent = fmtTime(now) + " PDT";
  document.getElementById("date-line").textContent = fmtDate(now);
  const m = moonPhase(now);
  document.getElementById("moon-line").textContent = `MOON ${m.pct}% · ${m.name}`;
  const nextFull = new Date(now.getTime() + m.toFull);
  const nextNew = new Date(now.getTime() + m.toNew);
  const nearerNew = m.toNew < m.toFull;
  const nxt = nearerNew ? nextNew : nextFull;
  document.getElementById("moon-next").textContent =
    (nearerNew ? "NEXT NEW " : "NEXT FULL ") +
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(nxt).toUpperCase();

  const up = Math.floor((Date.now() - BOOT) / 1000);
  document.getElementById("uptime").textContent =
    `UP ${pad(Math.floor(up / 3600))}:${pad(Math.floor((up % 3600) / 60))}:${pad(up % 60)}`;
}

function pickEvent() {
  const now = Date.now();
  const upcoming = EVENTS
    .map((e) => ({ ...e, t: new Date(e.start).getTime() }))
    .filter((e) => new Date(e.end).getTime() > now)
    .sort((a, b) => a.t - b.t)[0];
  document.getElementById("event-text").textContent = upcoming
    ? upcoming.text
    : "Quiet calendar · classify online tonight";
}

function applyTle(l1, l2) {
  if (!window.satellite || !l1 || !l2) return false;
  satrec = satellite.twoline2satrec(l1, l2);
  return !!satrec;
}

async function loadTle() {
  const urls = [
    "https://live.ariss.org/iss.txt",
    "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text.trim().split(/\r?\n/).map((l) => l.trim());
      const l1 = lines.find((l) => l.startsWith("1 "));
      const l2 = lines.find((l) => l.startsWith("2 "));
      if (applyTle(l1, l2)) {
        log("TLE lock · ISS (ZARYA)", "hi");
        return;
      }
    } catch (_) {}
  }
  applyTle(FALLBACK_TLE[0], FALLBACK_TLE[1]);
  log("TLE fallback · cached elements", "hi");
}

function observe(date) {
  if (!satrec || !window.satellite) return null;
  const gmst = satellite.gstime(date);
  const ev = satellite.propagate(satrec, date);
  if (!ev.position) return null;
  const gd = satellite.eciToGeodetic(ev.position, gmst);
  const look = satellite.ecfToLookAngles(
    {
      latitude: satellite.degreesToRadians(SEA.lat),
      longitude: satellite.degreesToRadians(SEA.lon),
      height: SEA.alt / 1000,
    },
    satellite.eciToEcf(ev.position, gmst)
  );
  return {
    lat: satellite.radiansToDegrees(gd.latitude),
    lon: satellite.radiansToDegrees(gd.longitude),
    alt: gd.height,
    el: satellite.radiansToDegrees(look.elevation),
    az: satellite.radiansToDegrees(look.azimuth),
  };
}

function azLabel(az) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((((az % 360) + 360) % 360) / 45) % 8];
}

function findNextPass(from = new Date()) {
  if (!satrec) return null;
  const start = from.getTime();
  let inPass = false;
  let rise = null;
  let maxEl = -90;
  let maxT = null;
  let azRise = 0;
  let azSet = 0;
  for (let t = start; t < start + 36 * 3600 * 1000; t += 15000) {
    const o = observe(new Date(t));
    if (!o) continue;
    if (!inPass && o.el >= 10) {
      inPass = true;
      rise = t;
      azRise = o.az;
      maxEl = o.el;
      maxT = t;
    } else if (inPass) {
      if (o.el > maxEl) { maxEl = o.el; maxT = t; }
      if (o.el < 10) {
        azSet = o.az;
        return { rise, set: t, maxEl, maxT, azRise, azSet };
      }
    }
  }
  return null;
}

function updateIss() {
  const now = new Date();
  const panel = document.getElementById("iss-panel");
  const card = document.getElementById("iss-card");
  const status = document.getElementById("iss-card-status");
  const o = observe(now);

  if (o) {
    document.getElementById("iss-now").textContent =
      `ISS NOW  ${o.lat.toFixed(1)}°  ${o.lon.toFixed(1)}°  ${Math.round(o.alt)} km`;
  } else {
    document.getElementById("iss-now").textContent = "ISS  TLE lock pending";
  }

  if (!nextPass || now.getTime() > nextPass.set + 60000) {
    nextPass = findNextPass(now);
    if (nextPass) log(`Pass window computed · max ${nextPass.maxEl.toFixed(0)}°`, "hi");
  }

  if (!nextPass) {
    document.getElementById("iss-countdown").textContent = "T— --:--";
    document.getElementById("iss-when").textContent = "no 10° pass in 36h";
    document.title = "SKYHUD · STANDBY";
    panel.classList.remove("soon", "imminent");
    card.classList.remove("hot");
    status.dataset.status = "STANDBY";
    status.textContent = "STANDBY";
    document.getElementById("ops-count").textContent = "1 ACTIVE OP";
    return;
  }

  const ms = nextPass.rise - now.getTime();
  const tStr = formatTminus(ms);
  document.getElementById("iss-countdown").textContent = tStr;
  const when = new Date(nextPass.rise);
  document.getElementById("iss-when").textContent =
    `${fmtTime(when)} · max ${nextPass.maxEl.toFixed(0)}°`;
  document.getElementById("iss-meta").textContent =
    `${azLabel(nextPass.azRise)} → ${azLabel(nextPass.azSet)} · ${Math.max(1, Math.round((nextPass.set - nextPass.rise) / 60000))} min`;
  document.getElementById("iss-card-sub").textContent =
    `Visible ${fmtTime(when)} · ${azLabel(nextPass.azRise)} → ${azLabel(nextPass.azSet)}`;

  const windowMs = 6 * 3600 * 1000;
  const p = Math.max(0, Math.min(1, 1 - ms / windowMs));
  document.getElementById("iss-arc").style.width = `${Math.round(p * 100)}%`;

  if (ms > 0) document.title = `SKYHUD · ${tStr} ISS`;
  else if (now.getTime() < nextPass.set) document.title = "SKYHUD · ISS OVERHEAD";
  else document.title = "SKYHUD · STANDBY";

  panel.classList.remove("soon", "imminent");
  card.classList.remove("hot");
  let tier = "far";
  if (ms <= 5 * 60 * 1000 && ms > -30 * 1000) {
    tier = "imminent";
    panel.classList.add("imminent");
    card.classList.add("hot");
    status.dataset.status = "ACTIVE";
    status.textContent = "ACTIVE";
  } else if (ms <= 30 * 60 * 1000) {
    tier = "soon";
    panel.classList.add("soon");
    status.dataset.status = "LOCKED";
    status.textContent = "LOCKED";
  } else {
    status.dataset.status = "STANDBY";
    status.textContent = "STANDBY";
  }

  document.getElementById("ops-count").textContent =
    tier === "imminent" ? "2 ACTIVE OPS" : "1 ACTIVE OP";

  if (tier !== lastAlertTier) {
    if (tier === "soon" && lastAlertTier !== "imminent") {
      log(`ISS approach · T-30 min window`, "hi");
      showToast(`ISS pass in ~${Math.round(ms / 60000)} min · ${azLabel(nextPass.azRise)}→${azLabel(nextPass.azSet)}`);
      notifyDesktop("SKYHUD · ISS inbound", `Pass in about ${Math.round(ms / 60000)} minutes over Seattle`);
    }
    if (tier === "imminent") {
      log(`ISS VISUAL WINDOW · LOOK UP`, "alert");
      showToast(`ISS OVERHEAD SOON · ${azLabel(nextPass.azRise)}→${azLabel(nextPass.azSet)}`, true);
      notifyDesktop("SKYHUD · ISS NOW", "Visible pass starting — grab your phone");
    }
    lastAlertTier = tier;
  }

  if (ms < 0 && now.getTime() < nextPass.set) {
    status.dataset.status = "ACTIVE";
    status.textContent = "OVERHEAD";
    card.classList.add("hot");
  }
}

async function weatherHint() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${SEA.lat}&longitude=${SEA.lon}&current=cloud_cover&timezone=America%2FLos_Angeles`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("wx");
    const data = await res.json();
    const c = data?.current?.cloud_cover;
    if (typeof c === "number") {
      const label = c < 25 ? "CLEAR" : c < 60 ? "PARTLY CLOUDY" : "OVERCAST";
      document.getElementById("cloud-line").textContent = `SKY ${label} · ${c}%`;
      log(`Wx uplink · ${label} ${c}%`);
      return;
    }
  } catch (_) {}
  document.getElementById("cloud-line").textContent = "SKY  check outside";
}

const CHATTER = [
  "Magnetosphere quiet",
  "Starfield calibration OK",
  "Node heartbeat · Seattle",
  "Orbital elements fresh",
  "No debris alerts",
  "Pass predictor idle",
  "Link to Spot the Station OK",
  "Citizen mesh online",
];
function ambientChatter() {
  if (Math.random() > 0.55) return;
  log(CHATTER[Math.floor(Math.random() * CHATTER.length)]);
}

const sheet = document.getElementById("sheet");
function openSheet(id) {
  const p = PROJECTS[id];
  if (!p) return;
  document.getElementById("sheet-kicker").textContent = p.kicker;
  document.getElementById("sheet-title").textContent = p.title;
  document.getElementById("sheet-body").textContent = p.body;
  document.getElementById("sheet-link").href = p.href;
  sheet.hidden = false;
  log(`Mission brief · ${p.title}`, "hi");
}
function closeSheet() { sheet.hidden = true; }

document.querySelectorAll(".card").forEach((btn) => {
  btn.addEventListener("click", () => openSheet(btn.dataset.id));
});
document.getElementById("sheet-close").addEventListener("click", closeSheet);
sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    const f = chip.dataset.filter;
    document.querySelectorAll(".card").forEach((card) => {
      const id = card.dataset.id;
      if (f === "all") card.hidden = false;
      else if (f === "online") card.hidden = id !== "globe";
      else card.hidden = PROJECTS[id].filter !== f;
    });
    log(`Filter · ${f.toUpperCase()}`);
  });
});

document.getElementById("red-toggle").addEventListener("click", () => {
  const on = document.body.classList.toggle("red");
  document.getElementById("red-toggle").setAttribute("aria-pressed", String(on));
  log(on ? "Red-light mode engaged" : "Red-light mode off", "hi");
});

document.getElementById("notify-btn").addEventListener("click", async () => {
  if (typeof Notification === "undefined") {
    log("Notifications unsupported", "alert");
    return;
  }
  const perm = await Notification.requestPermission();
  const btn = document.getElementById("notify-btn");
  if (perm === "granted") {
    btn.classList.add("on");
    btn.textContent = "ALERTS ON";
    log("Desktop alerts armed", "hi");
    showToast("Pass alerts enabled");
  } else {
    log("Alert permission denied", "alert");
  }
});

log("SKYHUD boot · Seattle node");
log("Loading orbital elements…");
tickClock();
pickEvent();
weatherHint();
setInterval(tickClock, 1000);
setInterval(pickEvent, 60000);
setInterval(ambientChatter, 28000);

loadTle().then(() => {
  updateIss();
  setInterval(updateIss, 1000);
  log("All subsystems nominal", "hi");
});
