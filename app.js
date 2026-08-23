/* SKYHUD — Seattle sky tracks + NASA intel (GitHub Pages static build) */
(function () {
  "use strict";

  var SEA = { lat: 47.6062, lon: -122.3321, altKm: 0.05 };
  var TZ = "America/Los_Angeles";
  var MIN_EL = 10;
  var ISS = 25544;
  var CSS = 48274;
  var HST = 20580;
  var FALLBACK = [
    "ISS (ZARYA)",
    "1 25544U 98067A   26234.50053383  .00009133  00000-0  17025-3 0  9998",
    "2 25544  51.6331 331.8814 0007668  72.6488 287.5339 15.49570248582031",
  ];
  var NAME_KEEP =
    /\b(ISS|ZARYA|CSS|TIANHE|WENTIAN|MENGTIAN|\bHST\b|NOAA[- ]?\d|METEOR[- ]?M|LANDSAT|TERRA\b|AQUA\b|ENVISAT|SENTINEL|SUOMI|JPSS|\bNPP\b|CALIPSO|CLOUDSAT|FENGYUN|YAOGAN|RESURS|KANOPUS|COSMOS[- ]?\d+|SL-16 R\/B|SL-14 R\/B|AO-\d+|SO-50|FO-\d+|IO-\d+|PO-\d+|METOP|JASON[- ]?\d)\b/i;
  var NAME_DROP = /STARLINK|ONEWEB|KUIPER|SPACEX|DUMMY|LEMUR/i;
  var PRIORITY = [25544,48274,20580,25338,28654,33591,43013,54234,25994,27424,39084,49260,41335,43437,40697,42063,35865,40069,37849,43689,29108,41240,27386,42969,44387,7530,27607,24278,39444];
  var AU = 149597870.7;
  var RE = 6378.137;
  var R2D = 180 / Math.PI;
  var BOOT = Date.now();

  var CITIZEN = [
    { id: "globe-ask", kind: "ask", kicker: "Do tonight · 10 min", title: "Globe at Night · count stars", sub: "Naked-eye magnitude from your Seattle block", body: "Step outside more than an hour after sunset, let your eyes adapt, and report how many stars you can see. Seattle skyglow makes each measurement useful for light-pollution science.", href: "https://www.globeatnight.org/", status: "ASK", source: "NSF / NOIRLab" },
    { id: "globe-clouds", kind: "ask", kicker: "Do now · phone", title: "GLOBE Observer · clouds", sub: "Photograph cloud cover for NASA Earth science", body: "Open GLOBE Observer, point at the sky, and log cloud type and cover. Scientists match your photo with satellite overpasses — including the Puget Sound marine layer.", href: "https://observer.globe.gov/", status: "ASK", source: "NASA GLOBE" },
    { id: "iss-ask", kind: "ask", kicker: "Catch a pass", title: "ISS · 20-second video", sub: "Face the listed azimuth and record the crossing", body: "When the HUD countdown hits, shoot a 20–40 second phone video of the station. That clip is the seed for backyard satellite photometry.", href: "https://spotthestation.nasa.gov/", status: "ASK", source: "NASA" },
    { id: "aurora", kind: "ask", kicker: "Solar storm nights", title: "Aurorasaurus", sub: "Report aurora (or a definite no-show) from 47N", body: "Mid-latitude auroras do reach Washington during strong geomagnetic storms. Submit a sighting or a verified negative report — both tighten the real-time oval.", href: "https://aurorasaurus.org/", status: "ASK", source: "NASA / NSF" },
    { id: "backyard", kind: "project", kicker: "Laptop · 15 min", title: "Backyard Worlds", sub: "Hunt brown dwarfs and Planet 9 in WISE scans", body: "Blink infrared images from NASA’s WISE telescope and flag moving objects. No telescope required.", href: "https://www.zooniverse.org/projects/marckuchner/backyard-worlds-planet-9", status: "OPEN", source: "NASA / Zooniverse" },
    { id: "binaries", kind: "project", kicker: "New 2026 project", title: "Backyard Worlds · Binaries", sub: "Spot brown-dwarf pairs in WISE animations", body: "NASA’s 2026 Backyard Worlds: Binaries asks you to find co-moving pairs so scientists can date the systems.", href: "https://science.nasa.gov/citizen-science/backyard-worlds-binaries/", status: "OPEN", source: "NASA" },
    { id: "tess", kind: "project", kicker: "Online classify", title: "Planet Hunters TESS", sub: "Mark transit dips in NASA TESS light curves", body: "Classify star brightness plots from NASA’s TESS mission and help confirm exoplanet candidates.", href: "https://www.zooniverse.org/projects/nora-dot-eisner/planet-hunters-tess", status: "OPEN", source: "NASA / Zooniverse" },
    { id: "dmp", kind: "project", kicker: "Daily task", title: "The Daily Minor Planet", sub: "Streak-hunt in DECam asteroid fields", body: "Each day a fresh batch of sky images needs human streak detection. Extra data streams were added in 2026.", href: "https://www.zooniverse.org/projects/fulsdavid/the-daily-minor-planet", status: "OPEN", source: "NASA / IAU" },
    { id: "jove", kind: "project", kicker: "Radio · DIY", title: "Radio JOVE", sub: "Listen to Jupiter and the Sun in HF radio", body: "Contribute Jupiter/solar radio observations to NASA GSFC’s Radio JOVE archive.", href: "https://radiojove.gsfc.nasa.gov/", status: "OPEN", source: "NASA GSFC" },
    { id: "landslide", kind: "project", kicker: "Pacific Northwest", title: "Landslide Reporter", sub: "Log slides after atmospheric-river storms", body: "NASA’s Cooperative Open Online Landslide Repository takes public reports. Puget Sound hillsides after heavy rain are scientifically valuable.", href: "https://landslides.nasa.gov/", status: "OPEN", source: "NASA" },
    { id: "gravity", kind: "project", kicker: "LIGO glitches", title: "Gravity Spy", sub: "Classify detector noise so mergers stay clean", body: "Help LIGO/Virgo scientists tag instrumental glitches so gravitational-wave detections stay clean.", href: "https://www.zooniverse.org/projects/zooniverse/gravity-spy", status: "OPEN", source: "NSF / Zooniverse" },
    { id: "nasa-catalog", kind: "project", kicker: "46 NASA projects", title: "NASA Citizen Science catalog", sub: "Official directory — no citizenship required", body: "NASA lists dozens of open projects across astrophysics, heliophysics, Earth, and planetary science.", href: "https://science.nasa.gov/citizen-science/", status: "OPEN", source: "NASA SMD" },
  ];

  var GRANTS = [
    { id: "roses-25", kicker: "Closes Aug 2026", title: "NASA ROSES-25", sub: "Omnibus space & Earth science research call", body: "Research Opportunities in Space and Earth Sciences 2025 remains open through August 2026. Proposals to most elements may be entirely or partly citizen-science based. Submit via NSPIRES; community groups can partner with U.S. institutions.", href: "https://science.nasa.gov/researchers/sara/grant-solicitations/", status: "OPEN", source: "NASA SMD" },
    { id: "nspires", kicker: "Required door", title: "NSPIRES registration", sub: "Create the account NASA uses for every proposal", body: "All NASA science proposals go through NSPIRES. Register, subscribe to the Science Mission Directorate list, and you will see ROSES amendments and the Citizen Science Seed Funding cycle when it reopens.", href: "https://nspires.nasaprs.com/external/", status: "OPEN", source: "NASA" },
    { id: "cssfp", kicker: "Next annual cycle", title: "Citizen Science Seed Funding", sub: "NASA CSSFP · incubate new citizen-science investigations", body: "ROSES F.9 CSSFP funds new or early citizen-science projects. The 2025/26 due date was 22 Jan 2026 (now closed). Watch ROSES-26 for the next seed round.", href: "https://science.nasa.gov/citizen-science/resources/", status: "WATCH", source: "NASA CSSFP" },
    { id: "space-apps", kicker: "Anyone · no PhD", title: "NASA Space Apps Challenge", sub: "Global hackathon — Seattle usually hosts a local site", body: "NASA’s annual Space Apps Challenge is the most direct citizen on-ramp: a weekend of open data challenges and a path to NASA global awards. No institutional affiliation required.", href: "https://www.spaceappschallenge.org/", status: "OPEN", source: "NASA" },
    { id: "aisl", kicker: "Informal STEM", title: "NSF AISL", sub: "Advancing Informal STEM Learning", body: "NSF AISL funds museums, clubs, community science, and public engagement — including night-sky programs. Nonprofits can be lead or partner organizations.", href: "https://www.nsf.gov/funding/opportunities/aisl-advancing-informal-stem-learning", status: "OPEN", source: "NSF" },
    { id: "sciact", kicker: "Education + science", title: "NASA Science Activation", sub: "Cooperative agreements for public NASA science", body: "Science Activation supports networks that help learners do NASA science. Community astronomy groups often join as informal-education partners.", href: "https://science.nasa.gov/learn/about-science-activation/", status: "OPEN", source: "NASA SciAct" },
    { id: "osip", kicker: "ESA · worldwide", title: "ESA OSIP Open Channel", sub: "Pitch novel space-science ideas, including citizen science", body: "ESA’s Open Space Innovation Platform accepts short ideas year-round. Open to individuals and organizations.", href: "https://ideas.esa.int/", status: "OPEN", source: "ESA" },
    { id: "sara", kicker: "Calendar", title: "NASA SARA grant desk", sub: "ROSES-26 watch · live due-date tables", body: "NASA’s SARA office posts the live ROSES table, due-date calendar, and amendment blog. Bookmark it before writing any citizen-science budget.", href: "https://science.nasa.gov/researchers/sara/grant-solicitations/", status: "WATCH", source: "NASA SARA" },
  ];

  var EVENTS = [
    { id: "sas", start: "2026-09-11T20:30:00-07:00", end: "2026-09-12T01:00:00-07:00", kicker: "Fri 11 Sep 2026", title: "SAS Star Party · Duvall", sub: "Big Rock Park · ~20:30–01:00 · free", body: "Seattle Astronomical Society public stargaze. Scopes often provided. Weather-dependent. Confirm at seattleastro.org before you drive out.", href: "https://www.seattleastro.org/", status: "QUEUED", source: "SAS", text: "SAS · Duvall Big Rock Park · Fri 20:30" },
    { id: "gan-window", start: "2026-09-01T00:00:00-07:00", end: "2026-09-15T00:00:00-07:00", kicker: "1–15 Sep 2026", title: "Globe at Night campaign window", sub: "September magnitude campaign", body: "The September Globe at Night window is the easiest all-city light-pollution sample. One observation from Seattle is enough to enter the map.", href: "https://www.globeatnight.org/", status: "OPEN", source: "NOIRLab", text: "Sept Globe at Night campaign window" },
  ];

  var FALLBACK_NEWS = [
    { id: "fb1", title: "APOD: 2026 August 22 – Mostly Perseids", url: "https://science.nasa.gov/", source: "NASA", published: "2026-08-22T04:05:00Z", summary: "NASA Astronomy Picture of the Day." },
    { id: "fb2", title: "NASA Shares Views of August Solar Eclipse from Ground, Air, Space", url: "https://science.nasa.gov/", source: "NASA", published: "2026-08-22T00:00:00Z", summary: "Heliophysics imaging of the August eclipse." },
    { id: "fb3", title: "650 NASA Volunteers Have Co-Authored Scientific Papers", url: "https://science.nasa.gov/citizen-science/", source: "NASA", published: "2026-05-05T00:00:00Z", summary: "Citizen scientists as co-authors on NASA papers." },
  ];

  var satLib = window.satellite || null;
  var observer = satLib
    ? {
        latitude: satLib.degreesToRadians(SEA.lat),
        longitude: satLib.degreesToRadians(SEA.lon),
        height: SEA.altKm,
      }
    : null;

  var sats = [];
  var passes = [];
  var selected = ISS;
  var lastTier = null;
  var logs = [];
  var computing = true;
  var filter = "sky";
  var newsItems = FALLBACK_NEWS.slice();
  var newsSource = "cache";
  var sheetItem = null;

  function $(id) {
    return document.getElementById(id);
  }
  function pad(n) {
    return String(Math.max(0, Math.floor(n))).padStart(2, "0");
  }
  function fmtTime(d) {
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
  }
  function fmtHm(d) {
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  }
  function fmtDate(d) {
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(d).toUpperCase();
  }
  function fmtNewsTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).toUpperCase();
  }
  function formatTminus(ms) {
    if (!isFinite(ms)) return "T— --:--";
    var sign = ms < 0 ? "+" : "—";
    var abs = Math.abs(ms) / 1000;
    var h = Math.floor(abs / 3600);
    var m = Math.floor((abs % 3600) / 60);
    var s = Math.floor(abs % 60);
    return h > 0 ? "T" + sign + " " + h + ":" + pad(m) + ":" + pad(s) : "T" + sign + " " + pad(m) + ":" + pad(s);
  }
  function azLabel(az) {
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((az % 360) + 360) % 360) / 45) % 8];
  }
  function moonPhase(date) {
    var synodic = 29.53058867;
    var known = Date.UTC(2000, 0, 6, 18, 14, 0);
    var days = (date.getTime() - known) / 86400000;
    var age = ((days % synodic) + synodic) % synodic;
    var pct = Math.round(((1 - Math.cos((2 * Math.PI * age) / synodic)) / 2) * 100);
    var name = "WAXING";
    if (age < 1.8 || age > 27.7) name = "NEW";
    else if (age < 6.1) name = "WAXING CRES";
    else if (age < 8.9) name = "FIRST Q";
    else if (age < 13.8) name = "WAXING GIB";
    else if (age < 16.8) name = "FULL";
    else if (age < 21.7) name = "WANING GIB";
    else if (age < 24.7) name = "LAST Q";
    else name = "WANING CRES";
    return { pct: pct, name: name };
  }
  function displayName(s) {
    if (s.norad === ISS) return "ISS";
    if (s.norad === CSS) return "CSS · TIANHE";
    if (s.norad === HST) return "HUBBLE";
    return String(s.name || "").replace(/\s+/g, " ").slice(0, 28).toUpperCase();
  }
  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (ch) {
      if (ch === "&") return "&" + "amp;";
      if (ch === "<") return "&" + "lt;";
      if (ch === ">") return "&" + "gt;";
      if (ch === '"') return "&" + "quot;";
      return "&#39;";
    });
  }

  function sunEciKm(date) {
    var n = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
    var L = (280.46 + 0.9856474 * n) % 360;
    var g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
    var lam = ((L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI) / 180;
    var eps = (23.439 * Math.PI) / 180;
    var r = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
    return { x: r * Math.cos(lam) * AU, y: r * Math.cos(eps) * Math.sin(lam) * AU, z: r * Math.sin(eps) * Math.sin(lam) * AU };
  }
  function sunlit(p, sun) {
    var sl = Math.sqrt(sun.x * sun.x + sun.y * sun.y + sun.z * sun.z) || 1;
    var ux = sun.x / sl, uy = sun.y / sl, uz = sun.z / sl;
    var dot = p.x * ux + p.y * uy + p.z * uz;
    if (dot > 0) return true;
    var dx = p.x - dot * ux, dy = p.y - dot * uy, dz = p.z - dot * uz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) > RE;
  }
  function lookAt(satrec, date) {
    if (!satLib || !observer) return null;
    var ev = satLib.propagate(satrec, date);
    if (!ev || !ev.position || ev.position === true) return null;
    var gmst = satLib.gstime(date);
    var gd = satLib.eciToGeodetic(ev.position, gmst);
    var look = satLib.ecfToLookAngles(observer, satLib.eciToEcf(ev.position, gmst));
    return {
      el: look.elevation * R2D,
      az: ((look.azimuth * R2D) % 360 + 360) % 360,
      rangeKm: look.rangeSat,
      lat: satLib.degreesLat(gd.latitude),
      lon: satLib.degreesLong(gd.longitude),
      altKm: gd.height,
      sunlit: sunlit(ev.position, sunEciKm(date)),
    };
  }
  function observerSunEl(date) {
    if (!satLib || !observer) return 0;
    var sun = sunEciKm(date);
    var look = satLib.ecfToLookAngles(observer, satLib.eciToEcf(sun, satLib.gstime(date)));
    return look.elevation * R2D;
  }

  function log(msg, level) {
    logs.unshift({ t: fmtTime(new Date()), msg: msg, level: level || "norm" });
    logs = logs.slice(0, 10);
    var ul = $("log-list");
    if (!ul) return;
    ul.innerHTML = logs
      .map(function (l) {
        var cls = l.level === "alert" ? "alert" : l.level === "hi" ? "hi" : "";
        return '<li class="' + cls + '">[' + l.t + "] " + esc(l.msg) + "</li>";
      })
      .join("");
  }
  function showToast(msg, urgent) {
    var el = $("toast");
    if (!el) return;
    $("toast-msg").textContent = msg;
    if (urgent) el.classList.add("urgent");
    else el.classList.remove("urgent");
    el.hidden = false;
    requestAnimationFrame(function () {
      el.classList.add("show");
    });
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () {
        el.hidden = true;
      }, 400);
    }, urgent ? 8000 : 5000);
  }

  function parseTleText(text) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var a = lines[i], b = lines[i + 1], c = lines[i + 2];
      if (a && a.indexOf("1 ") === 0 && b && b.indexOf("2 ") === 0) {
        out.push({ name: "NORAD " + a.slice(2, 7).trim(), norad: parseInt(a.slice(2, 7), 10), l1: a, l2: b });
        i += 1;
      } else if (b && b.indexOf("1 ") === 0 && c && c.indexOf("2 ") === 0) {
        out.push({ name: a.replace(/^0\s+/, ""), norad: parseInt(b.slice(2, 7), 10), l1: b, l2: c });
        i += 2;
      }
    }
    return out;
  }
  function keep(e) {
    if (!e.norad || NAME_DROP.test(e.name)) return false;
    if (PRIORITY.indexOf(e.norad) !== -1) return true;
    return NAME_KEEP.test(e.name);
  }
  function timedFetch(url, asJson) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 7000);
    var opts = { mode: "cors" };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (res) {
      if (!res.ok) return null;
      return asJson ? res.json() : res.text();
    }).catch(function () { return null; }).then(function (v) {
      clearTimeout(timer);
      return v;
    });
  }
  function grab(url) {
    return timedFetch(url, false).then(function (text) {
      if (text && text.indexOf("1 ") >= 0) return text;
      if (url.indexOf("http") !== 0) return text;
      return timedFetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(url), false);
    });
  }
  function mergeEntries(entries, sourceHint) {
    entries.filter(keep).forEach(function (e) {
      try {
        var rec = satLib.twoline2satrec(e.l1, e.l2);
        if (!rec) return;
        var prev = null;
        for (var i = 0; i < sats.length; i++) if (sats[i].norad === e.norad) { prev = sats[i]; break; }
        var row = { name: displayName(e), norad: e.norad, satrec: rec, l1: e.l1, l2: e.l2 };
        if (!prev) sats.push(row);
        else {
          prev.name = row.name; prev.satrec = rec; prev.l1 = e.l1; prev.l2 = e.l2;
        }
      } catch (_) {}
    });
    var hasIss = false;
    for (var j = 0; j < sats.length; j++) if (sats[j].norad === ISS) hasIss = true;
    if (!hasIss) {
      var rec = satLib.twoline2satrec(FALLBACK[1], FALLBACK[2]);
      sats.push({ name: "ISS", norad: ISS, satrec: rec, l1: FALLBACK[1], l2: FALLBACK[2] });
    }
    var srcEl = $("tle-source");
    if (srcEl) srcEl.textContent = sourceHint.toUpperCase();
    log("TLE lock · " + sourceHint + " · " + sats.length + " objects", "hi");
  }
  function loadCatalog() {
    if (!satLib) {
      log("Orbit library missing · sky tracks offline", "alert");
      computing = false;
      return Promise.resolve();
    }
    log("Loading orbital elements…");
    return grab("catalog.tle").then(function (bundled) {
      mergeEntries(bundled ? parseTleText(bundled) : [], bundled ? "bundle" : "fallback");
    });
  }
  function refreshLive() {
    if (!satLib) return Promise.resolve();
    return grab("https://live.ariss.org/iss.txt").then(function (ariss) {
      if (ariss) mergeEntries(parseTleText(ariss), "ariss+" + sats.length);
      function batch(start) {
        var slice = PRIORITY.slice(start, start + 4);
        if (!slice.length) return Promise.resolve();
        return Promise.all(slice.map(function (id) {
          return timedFetch("https://tle.ivanstanojevic.me/api/tle/" + id, true);
        })).then(function (rows) {
          var extra = [];
          for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            if (row && row.line1 && row.line2) {
              extra.push({ name: row.name || ("NORAD " + row.satelliteId), norad: row.satelliteId || 0, l1: row.line1, l2: row.line2 });
            }
          }
          if (extra.length) mergeEntries(extra, "live+" + sats.length);
          return new Promise(function (r) { setTimeout(r, 350); }).then(function () { return batch(start + 4); });
        });
      }
      return batch(0);
    });
  }

  function buildPass(s, rise, set, maxEl, maxT, azRise, azSet, optical) {
    var path = [];
    for (var t = rise; t <= set; t += 8000) {
      var o = lookAt(s.satrec, new Date(t));
      if (o && o.el >= 0) path.push({ t: t, az: o.az, el: o.el, sunlit: o.sunlit });
    }
    return { norad: s.norad, name: s.name, rise: rise, set: set, maxEl: maxEl, maxT: maxT, azRise: azRise, azSet: azSet, path: path, optical: optical };
  }
  function findPasses(s, from) {
    var start = from.getTime();
    var end = start + 12 * 3600 * 1000;
    var found = [];
    var inPass = false, rise = 0, maxEl = -90, maxT = 0, azRise = 0, azSet = 0, optical = false;
    for (var t = start; t <= end; t += 45000) {
      var o = lookAt(s.satrec, new Date(t));
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
  function computeTracks() {
    computing = true;
    var from = new Date();
    var found = [];
    function step(i) {
      if (i >= sats.length) {
        found.sort(function (a, b) { return a.rise - b.rise; });
        passes = found;
        computing = false;
        log("Pass lattice · " + passes.length + " Seattle tracks", "hi");
        return Promise.resolve();
      }
      found = found.concat(findPasses(sats[i], from));
      return new Promise(function (r) { setTimeout(r, 0); }).then(function () { return step(i + 1); });
    }
    return step(0);
  }

  function skyXY(az, el, cx, cy, r) {
    var rho = ((90 - Math.max(-2, el)) / 90) * r;
    var th = (az * Math.PI) / 180;
    return [cx + rho * Math.sin(th), cy - rho * Math.cos(th)];
  }
  function uniqueUpcoming(now) {
    var out = [], seen = {};
    for (var i = 0; i < passes.length; i++) {
      var p = passes[i];
      if (p.set < now) continue;
      if (seen[p.norad]) continue;
      seen[p.norad] = true;
      out.push(p);
      if (out.length >= 16) break;
    }
    return out;
  }
  function liveMarks(now) {
    var date = new Date(now);
    var out = [];
    for (var i = 0; i < sats.length; i++) {
      var look = lookAt(sats[i].satrec, date);
      if (look && look.el >= 0) out.push({ norad: sats[i].norad, name: sats[i].name, look: look });
    }
    out.sort(function (a, b) { return b.look.el - a.look.el; });
    return out;
  }

  function drawSky(now, marks) {
    var canvas = $("sky");
    var wrap = $("sky-wrap");
    if (!canvas || !wrap || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var size = Math.min(wrap.clientWidth || 320, wrap.clientHeight || wrap.clientWidth || 320);
    if (size < 40) size = 320;
    canvas.width = Math.floor(size * dpr);
    canvas.height = Math.floor(size * dpr);
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var red = document.body.classList.contains("red");
    var cx = size / 2, cy = size / 2, r = size * 0.42;
    var cyan = red ? "#ff6b5a" : "#7ecbff";
    var amber = red ? "#ff9a7a" : "#e8b86d";
    var green = red ? "#ff8a7a" : "#6dffb0";
    var dim = red ? "rgba(255,200,188,0.28)" : "rgba(126,203,255,0.28)";
    var faint = red ? "rgba(255,107,90,0.12)" : "rgba(126,203,255,0.12)";
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.strokeStyle = faint; ctx.lineWidth = 1; ctx.stroke();
    [0, 30, 60].forEach(function (el) {
      ctx.beginPath(); ctx.arc(cx, cy, ((90 - el) / 90) * r, 0, Math.PI * 2);
      ctx.strokeStyle = el === 0 ? dim : faint; ctx.lineWidth = el === 0 ? 1.25 : 1; ctx.stroke();
    });
    ctx.font = "10px 'Share Tech Mono', ui-monospace, monospace";
    ctx.fillStyle = dim; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("ZENITH", cx, cy - 10);
    [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(function (pair) {
      var p = skyXY(pair[1], -6, cx, cy, r);
      ctx.fillStyle = cyan; ctx.fillText(pair[0], p[0], p[1]);
    });
    ctx.strokeStyle = faint; ctx.lineWidth = 1;
    [0, 45, 90, 135, 180, 225, 270, 315].forEach(function (az) {
      var a = skyXY(az, 90, cx, cy, r), b = skyXY(az, 0, cx, cy, r);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    });
    uniqueUpcoming(now).slice(0, 14).forEach(function (p) {
      if (p.path.length < 2) return;
      var isIss = p.norad === ISS, isSel = p.norad === selected;
      ctx.beginPath();
      p.path.forEach(function (pt, i) {
        var xy = skyXY(pt.az, pt.el, cx, cy, r);
        if (i === 0) ctx.moveTo(xy[0], xy[1]); else ctx.lineTo(xy[0], xy[1]);
      });
      ctx.strokeStyle = isIss ? amber : isSel ? green : cyan;
      ctx.globalAlpha = isSel || isIss ? 0.95 : 0.45;
      ctx.lineWidth = isIss || isSel ? 2.2 : 1.15;
      ctx.stroke(); ctx.globalAlpha = 1;
    });
    marks.filter(function (m) { return m.look.el >= 0; }).forEach(function (m) {
      var xy = skyXY(m.look.az, m.look.el, cx, cy, r);
      var isIss = m.norad === ISS, isSel = m.norad === selected;
      ctx.beginPath(); ctx.arc(xy[0], xy[1], isIss ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isIss ? amber : isSel ? green : cyan; ctx.fill();
      ctx.fillStyle = isIss ? amber : cyan;
      ctx.font = (isIss ? 11 : 9) + "px 'Share Tech Mono', ui-monospace, monospace";
      ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(m.name, xy[0] + 8, xy[1] - 4);
    });
  }

  function renderList(now, marks) {
    var ul = $("pass-list");
    if (!ul) return;
    var rows = uniqueUpcoming(now);
    if (!rows.length) {
      ul.innerHTML = '<li class="pass-meta" style="padding:.7rem">' + (computing ? "Propagating orbits over 47.61N 122.33W…" : "No 10° passes in the next 12 hours.") + "</li>";
      return;
    }
    var night = observerSunEl(new Date(now)) < -6;
    ul.innerHTML = rows.map(function (p) {
      var live = null;
      for (var i = 0; i < marks.length; i++) if (marks[i].norad === p.norad && marks[i].look.el >= 0) { live = marks[i]; break; }
      var cls = (p.norad === ISS ? " iss" : "") + (selected === p.norad ? " active" : "");
      var tag = live && live.look.el >= 10 ? "OVERHEAD" : formatTminus(p.rise - now);
      var extra = live ? " · now " + live.look.el.toFixed(0) + "° " + azLabel(live.look.az) : "";
      var sun = p.optical && night ? " · SUNLIT" : "";
      return '<li><button type="button" class="pass-row' + cls + '" data-norad="' + p.norad + '">' +
        '<div class="row-top"><span class="pass-name">' + esc(p.name) + '</span><span class="tag">' + esc(tag) + "</span></div>" +
        '<div class="pass-meta">' + fmtHm(new Date(p.rise)) + "–" + fmtHm(new Date(p.set)) + " · " + azLabel(p.azRise) + "→" + azLabel(p.azSet) + " · max " + p.maxEl.toFixed(0) + "°" + extra + sun + "</div>" +
        "</button></li>";
    }).join("");
  }

  function openSheet(item) {
    sheetItem = item;
    $("sheet-kicker").textContent = item.kicker || item.source || "";
    $("sheet-title").textContent = item.title;
    $("sheet-body").textContent = item.body || item.summary || item.sub || "";
    $("sheet-link").href = item.href || item.url || "#";
    $("sheet").hidden = false;
  }
  function closeSheet() {
    $("sheet").hidden = true;
    sheetItem = null;
  }

  function currentIntel() {
    if (filter === "news") return newsItems.map(function (n) {
      return { id: n.id, kicker: n.source, title: n.title, sub: fmtNewsTime(n.published), body: n.summary || "", href: n.url, status: "LIVE", source: n.source };
    });
    if (filter === "citizen") return CITIZEN;
    if (filter === "grants") return GRANTS;
    if (filter === "events") return EVENTS;
    return [];
  }

  function renderIntel() {
    var ul = $("feed-list");
    var title = $("intel-title");
    var src = $("intel-src");
    if (!ul) return;
    var labels = { news: "NASA / ESA UPLINK", citizen: "CITIZEN ASKS · PROJECTS", grants: "OPEN GRANTS · FUNDING", events: "SEATTLE EVENTS" };
    if (title) title.textContent = labels[filter] || "UPLINK";
    if (src) src.textContent = filter === "news" ? newsSource.toUpperCase() : "CURATED";
    var rows = currentIntel();
    if (!rows.length) {
      ul.innerHTML = '<li class="pass-meta" style="padding:.7rem">No items on this channel.</li>';
      return;
    }
    ul.innerHTML = rows.map(function (p) {
      return '<li><button type="button" class="feed-row" data-intel="' + esc(p.id) + '">' +
        '<div class="row-top"><span class="kicker">' + esc(p.kicker) + '</span><span class="tag">' + esc(p.status || p.source) + "</span></div>" +
        '<div class="feed-title">' + esc(p.title) + "</div>" +
        '<div class="feed-meta">' + esc(p.sub) + (p.source ? " · " + esc(p.source) : "") + "</div>" +
        "</button></li>";
    }).join("");
  }

  function applyFilter(next) {
    filter = next;
    document.querySelectorAll(".chip").forEach(function (c) {
      if (c.getAttribute("data-filter") === next) c.classList.add("active");
      else c.classList.remove("active");
    });
    var showSky = next === "sky";
    $("stage").hidden = !showSky;
    $("intel").hidden = showSky;
    if (!showSky) renderIntel();
    log("Filter · " + next.toUpperCase());
  }

  function tick() {
    var now = Date.now();
    var d = new Date(now);
    $("clock").textContent = fmtTime(d) + " PDT";
    $("date-line").textContent = fmtDate(d);
    var m = moonPhase(d);
    $("moon-line").textContent = "MOON " + m.pct + "% · " + m.name;
    var up = Math.floor((now - BOOT) / 1000);
    $("uptime").textContent = "UP " + pad(Math.floor(up / 3600)) + ":" + pad(Math.floor((up % 3600) / 60)) + ":" + pad(up % 60);
    var upcoming = EVENTS.map(function (e) { return { text: e.text, t: new Date(e.start).getTime(), end: new Date(e.end).getTime() }; })
      .filter(function (e) { return e.end > now; })
      .sort(function (a, b) { return a.t - b.t; })[0];
    $("event-text").textContent = upcoming ? upcoming.text : "Quiet calendar · classify online tonight";

    var marks = liveMarks(now);
    var overhead = marks.filter(function (x) { return x.look.el >= 10; });
    var night = observerSunEl(d) < -6;
    $("ops-count").textContent = overhead.length + " OVERHEAD · " + (night ? "ASTRONOMICAL DARK" : "DAYLIGHT GEOMETRY");
    $("track-count").textContent = computing ? "COMPUTING TRACKS…" : passes.length + " PASSES / 12H";

    var nextIss = null;
    for (var i = 0; i < passes.length; i++) if (passes[i].norad === ISS && passes[i].set >= now) { nextIss = passes[i]; break; }
    var panel = $("iss-panel");
    panel.classList.remove("imminent");
    if (!nextIss) {
      $("iss-countdown").textContent = "T— --:--";
      $("iss-when").textContent = computing ? "acquiring lock…" : "no 10° pass in 12h";
      $("iss-meta").textContent = "";
      document.title = "SKYHUD · STANDBY";
    } else {
      var ms = nextIss.rise - now;
      $("iss-countdown").textContent = formatTminus(ms);
      $("iss-when").textContent = fmtTime(new Date(nextIss.rise)) + " · max " + nextIss.maxEl.toFixed(0) + "°";
      $("iss-meta").textContent = azLabel(nextIss.azRise) + " → " + azLabel(nextIss.azSet) + " · " + Math.max(1, Math.round((nextIss.set - nextIss.rise) / 60000)) + " min";
      $("iss-arc").style.width = Math.round(Math.max(0, Math.min(1, 1 - ms / (6 * 3600 * 1000))) * 100) + "%";
      var tier = "far";
      if (ms <= 5 * 60 * 1000 && ms > -30 * 1000) tier = "imminent";
      else if (ms <= 30 * 60 * 1000 && ms > 0) tier = "soon";
      if (now >= nextIss.rise && now <= nextIss.set) tier = "imminent";
      if (tier === "imminent") panel.classList.add("imminent");
      document.title = now >= nextIss.rise && now <= nextIss.set ? "SKYHUD · ISS OVERHEAD" : "SKYHUD · " + formatTminus(ms) + " ISS";
      if (tier !== lastTier) {
        if (tier === "soon") { log("ISS approach · T-30 min window", "hi"); showToast("ISS pass in ~" + Math.round(ms / 60000) + " min · " + azLabel(nextIss.azRise) + "→" + azLabel(nextIss.azSet)); }
        if (tier === "imminent") { log("ISS VISUAL WINDOW · LOOK UP", "alert"); showToast("ISS OVERHEAD SOON · " + azLabel(nextIss.azRise) + "→" + azLabel(nextIss.azSet), true); }
        lastTier = tier;
      }
    }

    if (filter === "sky") {
      drawSky(now, marks);
      renderList(now, marks);
    }
  }

  function loadNews() {
    var urls = [
      "https://api.spaceflightnewsapi.net/v4/articles/?limit=12&news_site=NASA",
      "https://api.spaceflightnewsapi.net/v4/articles/?limit=8&news_site=ESA",
      "https://api.spaceflightnewsapi.net/v4/blogs/?limit=8",
      "https://api.spaceflightnewsapi.net/v4/articles/?limit=8&search=citizen%20science",
    ];
    return Promise.all(urls.map(function (u) {
      return fetch(u, { mode: "cors" }).then(function (r) { return r.ok ? r.json() : { results: [] }; }).catch(function () { return { results: [] }; });
    })).then(function (packs) {
      var seen = {};
      var items = [];
      packs.forEach(function (pack) {
        var rows = pack && pack.results ? pack.results : [];
        rows.forEach(function (row) {
          if (!row || !row.title || !row.url || seen[row.url]) return;
          seen[row.url] = true;
          items.push({
            id: String(row.id || row.url),
            title: row.title,
            url: row.url,
            source: row.news_site || "SPACE",
            published: row.published_at || "",
            summary: (row.summary || "").slice(0, 280),
          });
        });
      });
      items.sort(function (a, b) { return a.published < b.published ? 1 : -1; });
      if (items.length) {
        newsItems = items.slice(0, 20);
        newsSource = "snapi";
        log("News uplink · " + newsItems.length + " NASA/ESA items", "hi");
      } else {
        log("News uplink · using cached headlines");
      }
      if (filter === "news") renderIntel();
    }).catch(function () {
      log("News uplink failed · cached headlines", "alert");
    });
  }

  function bind() {
    $("pass-list").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-norad]") : null;
      if (!btn) return;
      selected = Number(btn.getAttribute("data-norad"));
      tick();
    });
    $("feed-list").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-intel]") : null;
      if (!btn) return;
      var id = btn.getAttribute("data-intel");
      var rows = currentIntel();
      for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === id) { openSheet(rows[i]); break; }
    });
    $("sky").addEventListener("click", function (e) {
      var canvas = $("sky");
      var rect = canvas.getBoundingClientRect();
      var x = e.clientX - rect.left, y = e.clientY - rect.top;
      var size = rect.width, cx = size / 2, cy = size / 2, r = size * 0.42;
      var marks = liveMarks(Date.now());
      var best = null;
      marks.forEach(function (m) {
        var p = skyXY(m.look.az, m.look.el, cx, cy, r);
        var d = Math.sqrt((p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y));
        if (d < 18 && (!best || d < best.d)) best = { norad: m.norad, d: d };
      });
      if (best) { selected = best.norad; tick(); }
    });
    document.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () { applyFilter(chip.getAttribute("data-filter")); });
    });
    $("red-toggle").addEventListener("click", function () {
      var on = document.body.classList.toggle("red");
      $("red-toggle").setAttribute("aria-pressed", on ? "true" : "false");
      log(on ? "Red-light mode engaged" : "Red-light mode off", "hi");
      tick();
    });
    $("notify-btn").addEventListener("click", function () {
      if (typeof Notification === "undefined") { log("Notifications unsupported", "alert"); return; }
      Notification.requestPermission().then(function (perm) {
        if (perm === "granted") {
          $("notify-btn").classList.add("on");
          $("notify-btn").textContent = "ALERTS ON";
          log("Desktop alerts armed", "hi");
          showToast("Pass alerts enabled");
        } else log("Alert permission denied", "alert");
      });
    });
    $("sheet-close").addEventListener("click", closeSheet);
    $("sheet").addEventListener("click", function (e) { if (e.target === $("sheet")) closeSheet(); });
  }

  function boot() {
    log("SKYHUD boot · Seattle node");
    if (!satLib) log("satellite.js missing · tracks limited", "alert");
    bind();
    tick();
    setInterval(tick, 1000);
    window.addEventListener("resize", function () { tick(); });
    fetch("https://api.open-meteo.com/v1/forecast?latitude=47.6062&longitude=-122.3321&current=cloud_cover&timezone=America%2FLos_Angeles")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var c = data && data.current && data.current.cloud_cover;
        if (typeof c === "number") {
          var label = c < 25 ? "CLEAR" : c < 60 ? "PARTLY CLOUDY" : "OVERCAST";
          $("cloud-line").textContent = "SKY " + label + " · " + c + "%";
          log("Wx uplink · " + label + " " + c + "%");
        }
      })
      .catch(function () { $("cloud-line").textContent = "SKY  check outside"; });
    loadNews();
    loadCatalog().then(computeTracks).then(tick).then(function () { return refreshLive().then(computeTracks).then(tick); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
