// Accuracy tests for js/astro.js (Astronomy Engine wrapper) against published references:
//  • timeanddate.com reference cases (SF sun 2026-12-21, SF moon 2026-12-14, Tromsø polar night 2026-12-21)
//  • JPL Horizons alt/az, illumination, rise/set and Moon phases (tests/fixtures/horizons.json, see gen_fixtures.py)
//  • IMO 2026/2027 meteor-shower maxima
// Run: npm test   (or: node --test tests/)
import "./_load-engine.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const A = await import("../js/astro.js");
const fx = JSON.parse(readFileSync(new URL("./fixtures/horizons.json", import.meta.url)));
const MIN = 60e3;
const near = (date, iso, tolMin, label) => {
  assert.ok(date, `${label}: got null`);
  const err = Math.abs(date - new Date(iso)) / MIN;
  assert.ok(err <= tolMin, `${label}: ${date.toISOString()} vs ${iso} (off ${err.toFixed(2)} min)`);
  return err;
};
// Published references print whole minutes. timeanddate truncates (true instant in [ref, ref+1 min));
// Horizons R_T_S flags the 1-minute step that brackets the event (true instant in (ref−1 min, ref]).
// "±1 min" therefore means ±1 min of that bracketing interval.
const nearTrunc = (date, iso, label) => {
  assert.ok(date, `${label}: got null`);
  const r = new Date(iso).getTime(), t = date.getTime();
  assert.ok(t >= r - MIN && t <= r + 2 * MIN, `${label}: ${date.toISOString()} vs published ${iso} (truncated minute)`);
};
const nearStep = (date, iso, label) => {
  assert.ok(date, `${label}: got null`);
  const r = new Date(iso).getTime(), t = date.getTime();
  assert.ok(t >= r - 2 * MIN && t <= r + MIN, `${label}: ${date.toISOString()} vs Horizons step ${iso}`);
};

// ---- timeanddate reference cases (published to the minute; tolerance ±1 min) ----
test("San Francisco 2026-12-21: sunrise, sunset and twilight within ±1 min of timeanddate", () => {
  const [lat, lon] = [37.7749, -122.4194];
  const n = A.nightTimes(new Date("2026-12-21T22:00:00Z"), lat, lon);
  near(n.sunset, "2026-12-22T00:54:00Z", 1, "sunset");
  near(n.nauticalDusk, "2026-12-22T01:56:00Z", 1, "nautical dusk");
  near(n.astroDusk, "2026-12-22T02:28:00Z", 1, "astronomical dusk");
  const morning = A.nightTimes(new Date("2026-12-21T10:00:00Z"), lat, lon);
  near(morning.astroDawn, "2026-12-21T13:47:00Z", 1, "astronomical dawn");
  near(morning.civilDawn, "2026-12-21T14:52:00Z", 1, "civil dawn");
  near(morning.sunrise, "2026-12-21T15:21:00Z", 1, "sunrise");
});

test("San Francisco 2026-12-14: moonrise/moonset within ±1 min and illumination 28.9% (timeanddate)", () => {
  const [lat, lon] = [37.7749, -122.4194];
  const start = new Date("2026-12-14T08:00:00Z"); // midnight PST
  near(A.searchRiseSet("moon", "rise", start, lat, lon), "2026-12-14T19:06:00Z", 1, "moonrise");
  near(A.searchRiseSet("moon", "set", new Date("2026-12-14T19:06:00Z"), lat, lon), "2026-12-15T06:10:00Z", 1, "moonset");
  const k = A.moonPhase(new Date("2026-12-15T00:34:00Z")).illum * 100;
  assert.ok(Math.abs(k - 28.9) < 0.1, `illumination ${k.toFixed(2)}%`);
});

test("Tromsø 2026-12-21: Sun never rises (polar night), twilight still occurs (timeanddate)", () => {
  const [lat, lon] = [69.6496, 18.956];
  const n = A.nightTimes(new Date("2026-12-21T02:00:00Z"), lat, lon);
  assert.equal(n.sunrise, null, "no sunrise");
  const rts = A.riseTransitSet("sun", new Date("2026-12-20T23:00:00Z"), lat, lon);
  assert.equal(rts.rise, null);
  assert.equal(rts.set, null);
  assert.equal(rts.state, "never rises");
  near(n.astroDawn, "2026-12-21T05:28:00Z", 1, "astronomical dawn (06:28 CET)");
  near(n.nauticalDawn, "2026-12-21T06:46:00Z", 1, "nautical dawn (07:46 CET)");
  near(n.civilDawn, "2026-12-21T08:31:00Z", 1, "civil dawn (09:31 CET)");
  const eve = A.nightTimes(new Date("2026-12-21T12:00:00Z"), lat, lon);
  assert.equal(eve.sunset, null, "no sunset");
  near(eve.civilDusk, "2026-12-21T12:53:00Z", 1, "civil dusk (13:53 CET)");
  near(eve.nauticalDusk, "2026-12-21T14:37:00Z", 1, "nautical dusk (15:37 CET)");
  near(eve.astroDusk, "2026-12-21T15:56:00Z", 1, "astronomical dusk (16:56 CET)");
});

test("Moon phases Oct 2026–Jan 2027 within ±1 min of timeanddate (UTC table)", () => {
  // https://www.timeanddate.com/moon/phases/timezone/utc?year=2026 (published truncated to the minute)
  const ref = [
    ["Full Moon", "2026-10-26T04:11Z"], ["Last quarter", "2026-11-01T20:28Z"], ["New Moon", "2026-11-09T07:02Z"],
    ["First quarter", "2026-11-17T11:47Z"], ["Full Moon", "2026-11-24T14:53Z"], ["Last quarter", "2026-12-01T06:08Z"],
    ["New Moon", "2026-12-09T00:51Z"], ["First quarter", "2026-12-17T05:42Z"], ["Full Moon", "2026-12-24T01:28Z"],
    ["Last quarter", "2026-12-30T18:59Z"],
  ];
  const ours = A.nextPhases(new Date("2026-10-24T00:00:00Z"), ref.length);
  ref.forEach(([name, iso], i) => {
    assert.equal(ours[i].name, name);
    nearTrunc(ours[i].date, iso, name);
  });
});

// ---- JPL Horizons fixtures ----
function skySep(az1, alt1, az2, alt2) {
  const d = Math.PI / 180;
  const c = Math.sin(alt1 * d) * Math.sin(alt2 * d) + Math.cos(alt1 * d) * Math.cos(alt2 * d) * Math.cos((az1 - az2) * d);
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
}

test("Sun, Moon and planet alt/az within 1′ of JPL Horizons (3 sites × 2 dates, airless)", () => {
  const worst = {};
  for (const p of fx.positions) {
    const r = A.bodyPosition(p.body, new Date(p.utc), p.lat, p.lon, false);
    const sep = skySep(r.az, r.alt, p.az, p.alt) * 60;
    worst[p.body] = Math.max(worst[p.body] || 0, sep);
    assert.ok(sep < 1, `${p.body} @ ${p.site} ${p.utc}: off ${sep.toFixed(2)}′`);
  }
  console.log("worst separation vs Horizons (arcmin):", Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v.toFixed(2)])));
});

// Horizons QUANTITIES 10 is topocentric; the engine's Illumination() is geocentric. Lunar parallax
// (≤1°) shifts the phase angle — up to ~0.8 pp near quarter phase — so allow 1 percentage point.
test("Moon illuminated fraction within 1 percentage point of JPL Horizons", () => {
  for (const p of fx.positions.filter((x) => x.body === "moon")) {
    const ours = A.moonPhase(new Date(p.utc)).illum * 100;
    assert.ok(Math.abs(ours - p.illum) < 1, `${p.utc}: ${ours.toFixed(3)}% vs ${p.illum}%`);
  }
});

test("Sun and Moon rise/set within ±1 min of JPL Horizons (refracted, ideal horizon)", () => {
  for (const e of fx.riseSet) {
    const t = A.searchRiseSet(e.body, e.type, new Date(e.start), e.lat, e.lon, 1);
    nearStep(t, e.utc, `${e.body} ${e.type} @ ${e.site}`);
  }
});

test("Moon phases within ±1 min of JPL Horizons-derived instants", () => {
  const ours = A.nextPhases(new Date("2026-10-01T00:00:00Z"), fx.moonPhases.length);
  fx.moonPhases.forEach((ref, i) => { assert.equal(ours[i].name, ref.name); near(ours[i].date, ref.utc, 1, ref.name); });
});

// ---- other computed values ----
test("Seattle late October: twilight sequence ordered, ~10 h astronomical night", () => {
  const n = A.nightTimes(new Date("2026-10-24T22:00:00Z"), 47.6062, -122.3321);
  const order = ["sunset", "civilDusk", "nauticalDusk", "astroDusk", "astroDawn", "nauticalDawn", "civilDawn", "sunrise"];
  for (let i = 1; i < order.length; i++) assert.ok(n[order[i]] > n[order[i - 1]], `${order[i]} after ${order[i - 1]}`);
  const h = (n.astroDawn - n.astroDusk) / 3600e3;
  assert.ok(h > 9.5 && h < 10.8, `astronomical night ${h.toFixed(2)} h`);
  // asking at 2 a.m. local returns the same night
  const same = A.nightTimes(new Date("2026-10-25T09:00:00Z"), 47.6062, -122.3321);
  assert.equal(same.sunset.getTime(), n.sunset.getTime());
});

test("Reykjavík June solstice: no astronomical night", () => {
  const n = A.nightTimes(new Date("2026-06-21T12:00:00Z"), 64.1466, -21.9426);
  assert.equal(n.astroDusk, null);
  assert.equal(n.astroDawn, null);
  assert.ok(n.sunset && n.sunrise);
});

test("Solar longitude λ☉ (J2000) reproduces IMO 2026/2027 shower maxima", () => {
  const cases = [
    ["Orionids", 208, "2026-10-21T12:00Z", 24], ["Leonids", 235.27, "2026-11-17T23:45Z", 1],
    ["Geminids", 262.2, "2026-12-14T14:00Z", 1], ["Ursids", 270.7, "2026-12-22T22:00Z", 1],
    ["Quadrantids", 283.15, "2027-01-04T03:25Z", 2],
  ];
  for (const [name, lam, iso, tolH] of cases) {
    const t = A.dateOfSolarLongitude(lam, new Date(iso).getUTCFullYear());
    const errH = Math.abs(t - new Date(iso)) / 3600e3;
    assert.ok(errH <= tolH, `${name}: ${t.toISOString()} vs IMO ${iso} (${errH.toFixed(1)} h)`);
  }
});

test("Star projector agrees with Astronomy Engine Horizon() for Vega", () => {
  const d = new Date("2026-10-25T04:00:00Z"), lat = 47.6062, lon = -122.3321;
  const p = A.horizonProjector(d, lat, lon)(279.2347, 38.7837, false);
  const o = new globalThis.Astronomy.Observer(lat, lon, 0);
  const eq = globalThis.Astronomy.EquatorFromVector(globalThis.Astronomy.RotateVector(
    globalThis.Astronomy.Rotation_EQJ_EQD(d), globalThis.Astronomy.VectorFromSphere({ lat: 38.7837, lon: 279.2347, dist: 1 }, d)));
  const h = globalThis.Astronomy.Horizon(d, o, eq.ra, eq.dec);
  assert.ok(skySep(p.az, p.alt, h.azimuth, h.altitude) < 0.01);
});

test("Planet magnitudes in physical ranges (Venus near inferior conjunction)", () => {
  const d = new Date("2026-10-24T00:00:00Z");
  const ranges = { mercury: [-2.6, 5.8], venus: [-4.9, -2.9], mars: [-3, 1.9], jupiter: [-2.95, -1.6], saturn: [-0.6, 1.5], uranus: [5.3, 6.1], neptune: [7.6, 8.0] };
  for (const [k, [lo, hi]] of Object.entries(ranges)) {
    const m = A.bodyIllumination(k, d).mag;
    assert.ok(m >= lo && m <= hi, `${k} mag ${m.toFixed(2)}`);
  }
});
