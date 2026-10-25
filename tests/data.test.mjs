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
