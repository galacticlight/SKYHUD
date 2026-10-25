import { test } from "node:test";
import assert from "node:assert/strict";
import "./_load-engine.mjs";
import * as U from "../js/util.js";

test("countdown formats with and without seconds", () => {
  assert.equal(U.countdown(0), "now");
  assert.equal(U.countdown(-5), "now");
  assert.equal(U.countdown(NaN), "now");
  assert.equal(U.countdown(65e3), "1 m 05 s");
  assert.equal(U.countdown(65e3, false), "1 m");
  assert.equal(U.countdown(20e3, false), "1 m");
  assert.equal(U.countdown((2 * 3600 + 5 * 60 + 9) * 1e3), "2 h 05 m 09 s");
  assert.equal(U.countdown((2 * 3600 + 5 * 60 + 9) * 1e3, false), "2 h 05 m");
  assert.equal(U.countdown(3 * 86400e3 + 4 * 3600e3), "3 d 4 h");
});

test("nextAfter keeps only future, valid dates, soonest first", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const c = [
    { t: new Date("2026-10-24T11:00:00Z"), label: "past" },
    { t: new Date("2026-10-24T15:00:00Z"), label: "c" },
    { t: new Date("2026-10-24T13:00:00Z"), label: "a" },
    { t: new Date("invalid"), label: "bad" },
    null,
    { t: new Date("2026-10-24T14:00:00Z"), label: "b" },
    { t: new Date("2026-10-24T16:00:00Z"), label: "d" },
  ];
  assert.deepEqual(U.nextAfter(c, now, 3).map((x) => x.label), ["a", "b", "c"]);
});

test("isStale: old or missing timestamps are stale", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  assert.equal(U.isStale(new Date("2026-10-24T11:59:00Z"), now, 5 * 60e3), false);
  assert.equal(U.isStale(new Date("2026-10-24T11:50:00Z"), now, 5 * 60e3), true);
  assert.equal(U.isStale(null, now, 5 * 60e3), true);
  assert.equal(U.isStale(new Date("x"), now, 5 * 60e3), true);
});

test("twilightBand thresholds (−0.833°, −6°, −12°, −18°)", () => {
  assert.equal(U.twilightBand(10), "day");
  assert.equal(U.twilightBand(-0.5), "day");
  assert.equal(U.twilightBand(-1), "civil");
  assert.equal(U.twilightBand(-6.1), "nautical");
  assert.equal(U.twilightBand(-12.1), "astro");
  assert.equal(U.twilightBand(-18.1), "night");
});

test("runs merges consecutive equal samples", () => {
  const r = U.runs([{ t: 0, v: "a" }, { t: 1, v: "a" }, { t: 2, v: "b" }, { t: 3, v: "a" }]);
  assert.deepEqual(r, [{ from: 0, to: 2, v: "a" }, { from: 2, to: 3, v: "b" }, { from: 3, to: 3, v: "a" }]);
});

test("map: plate carrée projection and antimeridian split", async () => {
  const M = await import("../js/map.js");
  assert.deepEqual(M.project(-180, 90, 720, 360), [0, 0]);
  assert.deepEqual(M.project(0, 0, 720, 360), [360, 180]);
  assert.deepEqual(M.project(180, -90, 720, 360), [720, 360]);
  const segs = M.splitAntimeridian([{ lon: 170, lat: 0 }, { lon: 178, lat: 1 }, { lon: -176, lat: 2 }, { lon: -170, lat: 3 }]);
  assert.equal(segs.length, 2);
  assert.deepEqual(segs.map((s) => s.length), [2, 2]);
});

test("svgviz: Kp classes, bars and gauge", async () => {
  const V = await import("../js/svgviz.js");
  assert.equal(V.kpClass(3.67), "kp-q"); assert.equal(V.kpClass(4), "kp-a"); assert.equal(V.kpClass(5), "kp-s");
  const t = Date.UTC(2026, 9, 24);
  const svg = V.kpBars([{ t, kp: 2 }, { t: t + 3 * 3600e3, kp: 6, predicted: true }], { nowMs: t + 3600e3, title: "x" });
  assert.equal((svg.match(/<rect /g) || []).length, 2);
  assert.match(svg, /kp-s pred/); assert.match(svg, />now</);
  assert.equal(V.kpBars([]), "");
  assert.match(V.kpGauge(9.5), />9\.50</);
});

test("X-ray: flare class and parser", async () => {
  const V = await import("../js/svgviz.js");
  const F = await import("../js/feeds.js");
  assert.equal(V.xrayClass(1.2e-6), "C1.2"); assert.equal(V.xrayClass(9.99e-6), "C9.9");
  assert.equal(V.xrayClass(1e-5), "M1.0"); assert.equal(V.xrayClass(2.3e-3), "X23.0");
  assert.equal(V.xrayClass(5e-9), "A0.5"); assert.equal(V.xrayClass(0), "—");
  const rows = F.parseXray([
    { time_tag: "2026-10-24T12:01:00Z", energy: "0.1-0.8nm", flux: 3e-7 },
    { time_tag: "2026-10-24T12:00:00Z", energy: "0.1-0.8nm", flux: 2e-7 },
    { time_tag: "2026-10-24T12:00:00Z", energy: "0.05-0.4nm", flux: 9e-9 },
    { time_tag: "2026-10-24T12:02:00Z", energy: "0.1-0.8nm", flux: -1 },
  ]);
  assert.deepEqual(rows.map((r) => r.flux), [2e-7, 3e-7]);
  assert.equal(rows[0].t, Date.UTC(2026, 9, 24, 12));
  assert.throws(() => F.parseXray([]));
  const svg = V.lineChart({ series: [{ pts: [[0, 1], [60e3, 2], [3600e3, 3], [3660e3, 4]] }], t0: 0, t1: 3660e3, y: { min: 0, max: 5 } });
  assert.equal((svg.match(/M/g) || []).length, 2, "gap breaks the line");
});

test("solar wind: active spacecraft only, last 2 h, oldest first", async () => {
  const F = await import("../js/feeds.js");
  const row = (min, active, src, v) => ({ time_tag: `2026-10-24T${String(10 + Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`, active, source: src, proton_speed: v, proton_density: null });
  const j = [row(200, true, "SOLAR1", 400), row(200, false, "ACE", 999), row(100, true, "SOLAR1", 390), row(70, true, "SOLAR1", 380), row(0, true, "SOLAR1", 370)];
  const r = F.parseRtsw(j, ["proton_speed", "proton_density"]);
  assert.equal(r.source, "SOLAR1");
  assert.deepEqual(r.rows.map((x) => x[1]), [390, 400]);
  assert.equal(r.rows[0][2], null);
  assert.equal(r.rows[1][0], Date.UTC(2026, 9, 24, 13, 20));
  assert.throws(() => F.parseRtsw([row(0, false, "ACE", 1)], ["proton_speed"]));
});

test("aurora: OVATION parse, lookup and sector edges", async () => {
  const M = await import("../js/map.js");
  const co = [];
  for (let lon = 0; lon < 360; lon++) for (let lat = -90; lat <= 90; lat++) co.push([lon, lat, lat === 62 && lon >= 230 && lon < 260 ? 25 : lat === 70 ? 12 : 0]);
  const o = M.parseOvation({ "Observation Time": "2026-10-24T23:30:00Z", "Forecast Time": "2026-10-25T00:20:00Z", coordinates: co });
  assert.equal(o.forecast, Date.UTC(2026, 9, 25, 0, 20));
  assert.equal(M.auroraAt(o.grid, 62, -122), 25);
  assert.equal(M.auroraAt(o.grid, 47.6, -122.3), 0);
  const sec = M.auroraSectors(o.grid, 10);
  assert.equal(sec.length, 12);
  const w = sec.find((x) => x.from === -150);
  assert.equal(w.north, 62); assert.equal(w.peak, 25); assert.equal(w.south, null);
  assert.equal(sec.find((x) => x.from === 0).north, 70);
  assert.throws(() => M.parseOvation({}));
});

test("cloud strip: one background and one cloud cell per layer-hour", async () => {
  const V = await import("../js/svgviz.js");
  const t = Date.UTC(2026, 9, 24, 0);
  const svg = V.cloudStrip([{ t, low: 0, mid: 50, high: 100, band: "night" }, { t: t + 3600e3, low: null, mid: 10, high: 0, band: "day" }], { nowMs: t + 1800e3 });
  assert.equal((svg.match(/class="cs-(night|day)"/g) || []).length, 6);
  assert.equal((svg.match(/class="cs-cloud"/g) || []).length, 3);
  assert.match(svg, /fill-opacity="0\.90"/);
  assert.equal(V.cloudStrip([]), "");
});
