import "./_load-engine.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const S = await import("../js/score.js");
const F = await import("../js/feeds.js");
const M = await import("../js/showers.js");
const U = await import("../js/util.js");

const clear = { cloudLow: 0, cloudMid: 0, cloudHigh: 0, cloudTotal: 0, visibility: 40000, humidity: 50, wind: 0, temp: 10, dewPoint: 0, sunAlt: -30, moonAlt: -10, moonIllum: 0, bortle: 1 };

test("score: perfect dark clear night = 100, Excellent", () => {
  const r = S.scoreHour(clear);
  assert.equal(r.score, 100);
  assert.equal(r.band, "Excellent");
});

test("score: weights sum to 1 and each factor moves the score by its weight", () => {
  assert.equal(Object.values(S.WEIGHTS).reduce((a, b) => a + b, 0).toFixed(10), "1.0000000000");
  assert.equal(S.scoreHour({ ...clear, bortle: 9 }).score, 90); // LP weight .10
  assert.equal(S.scoreHour({ ...clear, sunAlt: 0 }).score, 85); // darkness .15
  assert.equal(S.scoreHour({ ...clear, moonAlt: 90, moonIllum: 1 }).score, 80); // moon .20
  assert.equal(S.scoreHour({ ...clear, cloudLow: 80, cloudTotal: 80 }).score, 64); // clouds .45×.8 = 36
});

test("score: cloud ≥ 90% caps the score at 10", () => {
  const r = S.scoreHour({ ...clear, cloudHigh: 95, cloudTotal: 95 });
  assert.equal(r.score, 10);
  assert.equal(r.capped, true);
  assert.equal(r.band, "Bad");
});

test("score: missing weather → null score, never a made-up number", () => {
  const r = S.scoreHour({ ...clear, cloudLow: undefined });
  assert.equal(r.score, null);
  assert.ok(r.missing.includes("cloudLow"));
});

test("Kp parser handles current list-of-objects and legacy list-of-lists", () => {
  const objs = F.parseKp([{ time_tag: "2026-10-24T00:00:00", Kp: 2.33, a_running: 9, station_count: 8 }, { time_tag: "2026-10-24T03:00:00", Kp: 5, a_running: 48, station_count: 8 }]);
  assert.equal(objs.length, 2);
  assert.equal(objs[1].kp, 5);
  assert.equal(objs[1].t.toISOString(), "2026-10-24T03:00:00.000Z");
  const arrs = F.parseKp([["time_tag", "Kp", "a_running", "station_count"], ["2026-10-24 00:00:00.000", "2.33", "9", "8"]]);
  assert.equal(arrs[0].kp, 2.33);
  assert.equal(arrs[0].t.toISOString(), "2026-10-24T00:00:00.000Z");
  const fc = F.parseKp([["time_tag", "kp", "observed", "noaa_scale"], ["2026-10-25 00:00:00", "3.67", "predicted", null]]);
  assert.equal(fc[0].status, "predicted");
  assert.throws(() => F.parseKp({}));
  assert.equal(F.gScale(5), "G1");
  assert.equal(F.gScale(4.67), "G0");
});

test("Open-Meteo parser maps unixtime hourly arrays", () => {
  const rows = F.parseForecast({ hourly: { time: [1798070400], cloud_cover: [12], cloud_cover_low: [1], cloud_cover_mid: [2], cloud_cover_high: [10], visibility: [24000], relative_humidity_2m: [70], dew_point_2m: [3], temperature_2m: [8], wind_speed_10m: [5], precipitation_probability: [0] } });
  assert.equal(rows[0].t.toISOString(), "2026-12-24T00:00:00.000Z");
  assert.equal(rows[0].cloudHigh, 10);
  assert.throws(() => F.parseForecast({}));
});

test("Forecast URL rounds coordinates to 0.01° and asks only for weather fields", () => {
  const u = new URL(F.forecastUrl(47.606209, -122.332071));
  assert.equal(u.searchParams.get("latitude"), "47.61");
  assert.equal(u.searchParams.get("longitude"), "-122.33");
  assert.equal(u.origin, "https://api.open-meteo.com");
});

test("TLE parser validates checksums and reads the bundled catalog", () => {
  const sats = F.parseTle(readFileSync(new URL("../catalog.tle", import.meta.url), "utf8"));
  assert.ok(sats.length > 100, `${sats.length} sats`);
  assert.ok(sats.some((s) => s.norad === 25544));
  const bad = sats[0].l1.slice(0, 68) + ((Number(sats[0].l1[68]) + 1) % 10);
  assert.equal(F.parseTle(`X\n${bad}\n${sats[0].l2}`).length, 0);
});

test("Meteor showers: Geminids 2026 window, computed peak and Moon at peak", () => {
  const list = M.upcomingShowers(new Date("2026-10-24T00:00:00Z"), 90);
  const gem = list.find((s) => s.code === "GEM");
  assert.ok(gem);
  assert.ok(Math.abs(gem.peak - new Date("2026-12-14T14:00:00Z")) < 2 * 3600e3);
  assert.ok(gem.moonIllum > 0.15 && gem.moonIllum < 0.35, `${gem.moonIllum}`); // IMO web 15%, engine ~25%
  const qua = list.find((s) => s.code === "QUA");
  assert.equal(qua.peak.getUTCFullYear(), 2027);
  const ori = list.find((s) => s.code === "ORI");
  assert.ok(ori.active, "Orionids active until Nov 7");
});

test("events.json: every event has a source URL and no unverified items", () => {
  const ev = JSON.parse(readFileSync(new URL("../data/events.json", import.meta.url), "utf8")).events;
  assert.ok(ev.length >= 10);
  for (const e of ev) {
    assert.match(e.source_url, /^https:\/\//);
    assert.ok(!/UNVERIFIED|Spica|occult/i.test(JSON.stringify(e)), e.title);
    assert.ok(!Number.isNaN(Date.parse(e.date_utc)), e.date_utc);
  }
});

test("Meteor peaks: computed from IMO solar longitude, within 1 day of IMO 2026/27 calendar peaks", () => {
  // IMO calendar peak instants (UT). Taurid maxima are broad; IMO gives the date only (noon used).
  const ref = { STA: "2026-11-05T12:00Z", NTA: "2026-11-12T12:00Z", LEO: "2026-11-17T23:45Z", GEM: "2026-12-14T14:00Z", URS: "2026-12-22T22:00Z", QUA: "2027-01-04T03:25Z" };
  const from = new Date("2026-10-24T00:00Z");
  for (const [code, iso] of Object.entries(ref)) {
    const w = M.showerWindow(M.SHOWERS.find((s) => s.code === code), from);
    const offH = (w.peak - new Date(iso)) / 3600e3;
    assert.ok(Math.abs(offH) <= 24, `${code}: computed ${w.peak.toISOString()} vs IMO ${iso} (off ${offH.toFixed(1)} h)`);
  }
});

test("Shower windows are formatted as UTC dates (no one-day shift west of UTC)", () => {
  const w = M.showerWindow(M.SHOWERS.find((s) => s.code === "LEO"), new Date("2026-10-24T00:00Z"));
  assert.equal(U.dateShortUTC(w.activeFrom), "Nov 6");
  assert.equal(U.dateShortUTC(new Date(w.activeTo - 86400e3)), "Nov 30");
});

test("Location privacy helpers: 0.01° rounding and geolocation error codes", () => {
  assert.equal(U.round2(40.712776), 40.71);
  assert.equal(U.round2(-74.005974), -74.01);
  assert.match(U.geoErrorText({ code: 1 }), /denied/);
  assert.match(U.geoErrorText({ code: 2 }), /couldn't determine/);
  assert.match(U.geoErrorText({ code: 3 }), /timed out/);
  assert.match(U.geoErrorText({}), /Couldn't get/);
});

test("Forecast cells render only finite numbers (no markup from upstream)", () => {
  assert.equal(U.numCell(42, "%"), "42%");
  assert.equal(U.numCell("12.5"), "—"); // strings are not numbers: same rule as the score, which treats them as missing
  assert.equal(U.numCell('<img src=x onerror=alert(1)>'), "—");
  assert.equal(U.numCell(null), "—");
  assert.equal(U.numCell(NaN), "—");
  assert.equal(U.numCell(true), "—");
});

test("R shortcut: off switch, repeats, modifiers and focused controls are ignored", () => {
  const k = (o = {}) => ({ key: "r", repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
  const body = { tagName: "BODY", isContentEditable: false };
  assert.equal(U.isRedShortcut(k(), body, true), true);
  assert.equal(U.isRedShortcut(k(), body, false), false);
  assert.equal(U.isRedShortcut(k({ repeat: true }), body, true), false);
  for (const m of ["ctrlKey", "metaKey", "altKey", "shiftKey"]) assert.equal(U.isRedShortcut(k({ [m]: true }), body, true), false, m);
  for (const tag of ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "SUMMARY", "A"]) assert.equal(U.isRedShortcut(k(), { tagName: tag }, true), false, tag);
  assert.equal(U.isRedShortcut(k(), { tagName: "DIV", isContentEditable: true }, true), false);
  assert.equal(U.isRedShortcut(k({ key: "x" }), body, true), false);
});

test("events.json: Dec 27 Moon–Jupiter is labelled computed / secondary source, not confirmed", () => {
  const ev = JSON.parse(readFileSync(new URL("../data/events.json", import.meta.url), "utf8")).events;
  const e = ev.find((x) => x.date_utc.startsWith("2026-12-27"));
  assert.match(e.details, /computed \(astronomy-engine\)/i);
  assert.match(e.details, /secondary source/i);
  assert.match(e.details, /not confirmed/i);
});

test("time zones: bad saved or upstream zone names are rejected without throwing", async () => {
  const U = await import("../js/util.js");
  assert.equal(U.validTz("America/Los_Angeles"), true);
  assert.equal(U.validTz("UTC"), true);
  for (const bad of ["Mars/Olympus_Mons", "", null, undefined, 42, "x".repeat(100), "<script>"]) assert.equal(U.validTz(bad), false, String(bad));
  assert.equal(U.validTz(U.browserTz()), true);
});

test("score: non-numeric forecast values (strings, NaN, Infinity, objects) → no score, never NaN or Bad", () => {
  for (const bad of ["12", "n/a", NaN, Infinity, {}, [], true]) {
    for (const k of ["cloudLow", "cloudTotal", "visibility", "wind", "dewPoint", "sunAlt", "bortle"]) {
      const r = S.scoreHour({ ...clear, [k]: bad });
      assert.equal(r.score, null, `${k}=${String(bad)}`);
      assert.equal(r.band, null, `${k}=${String(bad)}`);
      assert.ok(r.missing.includes(k));
      for (const v of Object.values(r.sub)) assert.ok(v === null || Number.isFinite(v), `${k}: sub-score ${v}`);
    }
  }
});

test("events: eclipse times are UTC (NASA TD − 69 s) and agree with Astronomy Engine within 20 s", () => {
  const ev = JSON.parse(readFileSync(new URL("../data/events.json", import.meta.url))).events.filter((e) => e.type.startsWith("eclipse"));
  assert.ok(ev.length >= 3);
  const E = globalThis.Astronomy;
  for (const e of ev) {
    const t = Date.parse(e.date_utc);
    const m = e.details.match(/(\d\d):(\d\d):(\d\d) TD/);
    assert.ok(m, `${e.title}: TD source time quoted`);
    const td = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate(), +m[1], +m[2], +m[3]);
    assert.equal((td - t) / 1000, 69, `${e.title}: UTC = TD − 69 s`);
    const peak = e.type === "eclipse_lunar" ? E.SearchLunarEclipse(new Date(t - 5 * 86400e3)).peak : E.SearchGlobalSolarEclipse(new Date(t - 5 * 86400e3)).peak;
    // Cross-check only: the engine extrapolates ΔT ≈ 75.7 s for 2027 (real TT − UTC is 69.2 s) and models the
    // lunar shadow differently, so it lands 6–13 s early. A TD/UTC mix-up would be 69 s off, so 20 s still catches it.
    assert.ok(Math.abs(peak.date.getTime() - t) < 20e3, `${e.title}: engine ${peak.date.toISOString()} vs ${e.date_utc}`);
  }
});

test("service-worker precache list and manifest icons point at files that exist", async () => {
  const fs = await import("node:fs");
  const root = new URL("../", import.meta.url);
  const sw = fs.readFileSync(new URL("sw.js", root), "utf8");
  const assets = JSON.parse(sw.match(/const ASSETS = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));
  for (const a of assets) if (a !== "./") assert.ok(fs.existsSync(new URL(a, root)), `missing precached file ${a}`);
  const man = JSON.parse(fs.readFileSync(new URL("manifest.webmanifest", root), "utf8"));
  for (const i of man.icons) {
    assert.ok(fs.existsSync(new URL(i.src, root)), `missing icon ${i.src}`);
    assert.ok(assets.includes(i.src), `icon ${i.src} is not precached`);
  }
  assert.ok(man.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
  // PNG icons: real PNG signature, and the IHDR pixel size matches the "sizes" the manifest declares.
  for (const i of man.icons.filter((x) => x.type === "image/png")) {
    const b = fs.readFileSync(new URL(i.src, root));
    assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${i.src} is not a PNG`);
    assert.equal(b.toString("latin1", 12, 16), "IHDR", `${i.src} has no IHDR first`);
    assert.equal(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`, i.sizes, `${i.src} pixel size vs manifest`);
  }
});

test("runsText skips runs that read as zero-width to the minute (QA v6 b)", () => {
  const hm = (d) => d.toISOString().slice(11, 16);
  const t = (s) => Date.parse(`2026-12-31T${s}Z`);
  const bands = [
    { from: t("11:12:16"), to: t("11:12:40"), v: "nautical" },
    { from: t("11:12:40"), to: t("15:34:14"), v: "astro" },
    { from: t("15:34:14"), to: t("15:34:59"), v: "night" },
  ];
  assert.deepEqual(U.runsText(bands, hm, (b) => `${b.v} `), ["astro 11:12–15:34"]);
  assert.deepEqual(U.runsText([{ from: t("11:44:01"), to: t("11:44:30") }], hm), []);
  assert.deepEqual(U.runsText([{ from: t("11:44:01"), to: t("11:45:01") }], hm), ["11:44–11:45"]);
});

test("tleShouldFetch: fresh cache, or a failure in the last hour, skips CelesTrak (QA v6 TLE console nit)", () => {
  const now = Date.parse("2026-10-31T12:00:00Z"), h = 3600e3;
  assert.equal(U.tleShouldFetch(null, null, now), true);
  assert.equal(U.tleShouldFetch(now - 5 * h, null, now), false);
  assert.equal(U.tleShouldFetch(now - 7 * h, null, now), true);
  assert.equal(U.tleShouldFetch(now - 7 * h, now - 0.5 * h, now), false);
  assert.equal(U.tleShouldFetch(null, now - 2 * h, now), true);
  assert.equal(U.tleShouldFetch(new Date(now - 1 * h), undefined, new Date(now)), false);
  // A future stamp (clock change) is not trusted as fresh.
  assert.equal(U.tleShouldFetch(now + 2 * h, now + 2 * h, now), true);
});

// NOAA scales / alerts / flare probabilities (fixtures: real SWPC responses, 2026-11-01 05:20 UTC, trimmed)
{
  const F = await import("../js/feeds.js");
  const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
  test("parseScales: current R/S/G, previous day, 3-day outlook; bad input throws or nulls", () => {
    const d = F.parseScales(fx("swpc-scales.json"));
    assert.deepEqual(d.now, { R: 0, S: 0, G: 0 });
    assert.deepEqual(d.prev, { R: 0, S: 0, G: 2 });
    assert.equal(d.issued, Date.UTC(2026, 10, 1, 5, 20));
    assert.equal(d.days.length, 3);
    assert.deepEqual(d.days[0], { date: "2026-11-01", rMinor: 1, rMajor: 1, s: 1, g: 1 });
    assert.throws(() => F.parseScales([]));
    const odd = F.parseScales({ 0: { DateStamp: "x", R: { Scale: "9" }, S: { Scale: 2 }, G: { Scale: "<b>" } } });
    assert.deepEqual(odd.now, { R: null, S: 2, G: null });
    assert.equal(odd.issued, null);
  });
  test("parseAlerts: newest first, last 48 h, title line, UTC issue time", () => {
    const now = Date.UTC(2026, 10, 1, 5, 30);
    const a = F.parseAlerts(fx("swpc-alerts.json"), now);
    assert.ok(a.length >= 1 && a.length <= 3);
    assert.equal(a[0].t, Date.UTC(2026, 10, 1, 1, 17, 17));
    assert.match(a[0].title, /^ALERT: Geomagnetic K-index of 5/);
    assert.ok(a.every((x, i) => i === 0 || a[i - 1].t >= x.t));
    assert.equal(F.parseAlerts(fx("swpc-alerts.json"), now + 5 * 86400e3).length, 0);
    assert.throws(() => F.parseAlerts({}));
  });
  test("parseAlerts: a drifted feed (renamed field, epoch ms, string rows) throws instead of reading as all quiet", () => {
    const rows = fx("swpc-alerts.json");
    const now = Date.UTC(2026, 9, 31, 12);
    assert.equal(F.parseAlerts([], now).length, 0); // genuinely empty feed is a real "none"
    assert.throws(() => F.parseAlerts(rows.map(({ issue_datetime, ...r }) => ({ ...r, issued: issue_datetime })), now), /no dated rows/);
    assert.throws(() => F.parseAlerts(rows.map((r) => ({ ...r, issue_datetime: now - 3600e3 })), now), /no dated rows/);
    assert.throws(() => F.parseAlerts(["ALERT: something", "WATCH: else"], now), /no dated rows/);
    assert.throws(() => F.parseAlerts([{ issue_datetime: "nope", message: "x" }], now), /no dated rows/);
    // one unreadable row among dated ones is skipped, not fatal
    assert.equal(F.parseAlerts([{ issue_datetime: "nope", message: "x" }, { issue_datetime: "2026-10-31 10:00:00.000", message: "ALERT: y" }], now).length, 1);
  });
  test("parseFlareProb: newest day's C/M/X and proton odds", () => {
    const f = F.parseFlareProb(fx("swpc-flareprob.json"));
    assert.equal(f.date, Date.UTC(2026, 9, 31));
    assert.deepEqual(f.c, [25, 25, 25]);
    assert.deepEqual(f.x, [1, 1, 1]);
    assert.throws(() => F.parseFlareProb([]));
  });
  test("parseFlareProb: skips future-dated rows, reads fractions as percentages; stale wording matches its threshold (QA v7 P2)", () => {
    const now = Date.UTC(2026, 10, 1, 7);
    const row = (date, v) => Object.fromEntries([["date", date], ...["c_class", "m_class", "x_class", "10mev_protons"].flatMap((k) => [1, 2, 3].map((d) => [`${k}_${d}_day`, v]))]);
    // a row dated next week must not win over today's issue
    const f = F.parseFlareProb([row("2026-11-08T00:00:00", 99), row("2026-11-01T00:00:00", 25)], now);
    assert.equal(f.date, Date.UTC(2026, 10, 1)); assert.deepEqual(f.c, [25, 25, 25]);
    assert.throws(() => F.parseFlareProb([row("2026-11-08T00:00:00", 5)], now), /no dated rows/);
    // fractions: 0.25 means 25%, not 0.25%
    const fr = F.parseFlareProb([{ ...row("2026-11-01T00:00:00", 0.01), c_class_1_day: 0.25, m_class_1_day: 0.05 }], now);
    assert.deepEqual(fr.c, [25, 1, 1]); assert.deepEqual(fr.m, [5, 1, 1]);
    // whole 0/1 values stay percentages (what the feed sends today)
    assert.deepEqual(F.parseFlareProb([row("2026-11-01T00:00:00", 1)], now).x, [1, 1, 1]);
    // staleness: the threshold is the documented number of days, and the panel words its warning from it
    assert.equal(F.FLARE_STALE_DAYS, 2);
    assert.equal(F.flareStale(now - 1.5 * 86400e3, now), false);
    assert.equal(F.flareStale(now - 2.1 * 86400e3, now), true);
    const space = readFileSync(new URL("../js/space.js", import.meta.url), "utf8");
    assert.doesNotMatch(space, /more than a day old/);
    assert.match(space, /more than \$\{FLARE_STALE_DAYS\} days ago/);
  });
}

test("service worker bypasses the HTTP cache on install and on fetch (QA v7 P1-3)", async () => {
  // Runs sw.js in a sandbox with fake caches/fetch. Without cache:"reload" on install and cache:"no-cache"
  // on fetch, an upgrade on a max-age host can cache a new app.js next to an old feeds.js.
  const fs = await import("node:fs");
  const vm = await import("node:vm");
  const src = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const handlers = {}, added = [], fetched = [];
  class Req { constructor(u, init = {}) { this.url = typeof u === "string" ? new URL(u, "https://x.test/SKYHUD/sw.js").href : u.url; this.cache = init.cache ?? u.cache ?? "default"; this.method = "GET"; this.mode = u.mode || "cors"; } }
  const cache = { addAll: async (rs) => { added.push(...rs); }, put: async () => {} };
  const self = {
    location: new URL("https://x.test/SKYHUD/sw.js"),
    addEventListener: (t, f) => { handlers[t] = f; },
    skipWaiting: async () => {}, clients: { claim: async () => {} },
  };
  const ctx = { self, URL, Request: Req, Response: { error: () => null }, console,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => null },
    fetch: async (r, init = {}) => { fetched.push({ r, init }); return { ok: true, clone() { return this; } }; } };
  vm.runInNewContext(src, ctx);
  let p; handlers.install({ waitUntil: (x) => { p = x; } }); await p;
  assert.ok(added.length > 10);
  for (const r of added) assert.equal(typeof r === "string" ? "default" : r.cache, "reload", `precache of ${r.url || r} may come from the HTTP cache`);
  handlers.fetch({ request: { url: "https://x.test/SKYHUD/js/feeds.js", method: "GET", mode: "cors" }, respondWith: (x) => { p = x; } }); await p;
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].init.cache, "no-cache", "network-first fetch may be served stale by the HTTP cache");
  assert.match(src, /const CACHE = "skyhud-v(\d+)"/);
  assert.ok(Number(src.match(/skyhud-v(\d+)/)[1]) >= 12, "cache name must be bumped past v11 for this fix");
});

test("service worker activate deletes only its own old caches (QA v7 P2)", async () => {
  const fs = await import("node:fs");
  const vm = await import("node:vm");
  const src = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const cur = src.match(/const CACHE = "([^"]+)"/)[1];
  const handlers = {}, deleted = [];
  const self = { location: new URL("https://x.test/SKYHUD/sw.js"), addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  vm.runInNewContext(src, { self, URL, Request: class {}, console,
    caches: { keys: async () => ["skyhud-v9", cur, "other-app-v1", "workbox-precache"], delete: async (k) => { deleted.push(k); return true; } } });
  let p; handlers.activate({ waitUntil: (x) => { p = x; } }); await p;
  assert.deepEqual(deleted, ["skyhud-v9"]);
});

test("savedLoc rejects unusable saved places so boot falls back to the default (QA v7 P2)", () => {
  for (const bad of [null, "x", 5, {}, { lat: 999, lon: 0 }, { lat: 0, lon: 181 }, { lat: NaN, lon: 0 }, { lat: null, lon: 0 }, { lat: "47.6", lon: "-122.3" }, { lat: 47, lon: Infinity }])
    assert.equal(F.savedLoc(bad), null, JSON.stringify(bad));
  assert.deepEqual(F.savedLoc({ name: "Oslo", lat: 59.91, lon: 10.75, tz: "Europe/Oslo" }), { name: "Oslo", lat: 59.91, lon: 10.75, tz: "Europe/Oslo" });
  assert.deepEqual(F.savedLoc({ lat: -90, lon: 180 }), { name: "Saved place", lat: -90, lon: 180, tz: null });
});

test("service worker v15 upgrade: tracker modules precached, launch snapshot kept out of the precache, v14 removed, snapshot network-first with an offline copy", async () => {
  const fs = await import("node:fs");
  const vm = await import("node:vm");
  const src = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.ok(Number(src.match(/skyhud-v(\d+)/)[1]) >= 15, "cache name must be bumped past v14 for the launch tracker");
  // v20: styles.css (tracker reserve headroom, glance grid) and js/launchdata.js + js/tracker.js (upcomingView) changed after v19.
  assert.ok(Number(src.match(/skyhud-v(\d+)/)[1]) >= 20, "cache name must be bumped past v19 for the v14 CSS and tracker changes");
  const handlers = {}, added = [], deleted = [], store = new Map();
  let online = true;
  class Req { constructor(u, init = {}) { this.url = typeof u === "string" ? new URL(u, "https://x.test/SKYHUD/sw.js").href : u.url; this.cache = init.cache ?? "default"; this.method = "GET"; this.mode = "cors"; } }
  const cache = { addAll: async (rs) => { added.push(...rs.map((r) => r.url)); }, put: async (r, res) => { store.set(r.url, res); } };
  const self = { location: new URL("https://x.test/SKYHUD/sw.js"), addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  vm.runInNewContext(src, { self, URL, Request: Req, Response: { error: () => "network-error" }, console,
    caches: { open: async () => cache, keys: async () => ["skyhud-v19", src.match(/const CACHE = "([^"]+)"/)[1]], delete: async (k) => { deleted.push(k); return true; }, match: async (r) => store.get(r.url) || null },
    fetch: async (r) => { if (!online) throw new Error("offline"); return { ok: true, body: "fresh", clone() { return { ...this, body: "copy" }; } }; } });
  let p; handlers.install({ waitUntil: (x) => { p = x; } }); await p;
  for (const m of ["js/tracker.js", "js/launchdata.js"]) assert.ok(added.includes(`https://x.test/SKYHUD/${m}`), `${m} not precached`);
  assert.ok(!added.some((u) => /data\/launches/.test(u)), "the launch snapshot must not be precached (it would pin an old copy)");
  handlers.activate({ waitUntil: (x) => { p = x; } }); await p;
  assert.deepEqual(deleted, ["skyhud-v19"]);
  const get = async () => { let q; handlers.fetch({ request: { url: "https://x.test/SKYHUD/data/launches.json", method: "GET", mode: "cors" }, respondWith: (x) => { q = x; } }); return q; };
  assert.equal((await get()).body, "fresh"); // network first
  await new Promise((r) => setTimeout(r, 0));
  online = false;
  assert.equal((await get()).body, "copy"); // offline: last fetched copy (the card labels its age from fetched_at)
});

test("Privacy paragraph names the launch and DSN hosts and says LL2 is never contacted (QA v9)", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const para = html.match(/<summary>Privacy<\/summary>\s*<p>([^<]*)<\/p>/)[1];
  assert.ok(para.endsWith("The rocket launch list is fetched from RocketLaunch.Live (fdo.rocketlaunch.live) and the Deep Space Network card from NASA/JPL's DSN Now feed (eyes.nasa.gov), each at a fixed address that never includes your location; those services see your IP address and this site's address, like any web request. The launch tracker reads a copy of Launch Library 2 data stored on this site, so your browser never contacts Launch Library 2."));
  const csp = html.match(/connect-src ([^;]*)/)[1].split(" ");
  for (const host of ["https://fdo.rocketlaunch.live", "https://eyes.nasa.gov"]) assert.ok(csp.includes(host), host);
  // The claim holds: the CSP blocks any Launch Library 2 request (its links are plain <a> credits), and the
  // tracker's data comes from this site.
  assert.ok(!csp.some((h) => /thespacedevs/.test(h)));
  assert.match(readFileSync(new URL("../js/launchdata.js", import.meta.url), "utf8"), /SNAPSHOT_URL = "data\/launches\.json"/);
});
