import "./_load-engine.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const S = await import("../js/score.js");
const F = await import("../js/feeds.js");
const M = await import("../js/showers.js");

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
