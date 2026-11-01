import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const F = await import("../js/feeds.js");
const live = JSON.parse(readFileSync(new URL("./fixtures/rll-next5.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-01T08:00:00Z");

test("launches: real RocketLaunch.Live 'next 5' response parses, sorted, with precision per row", () => {
  const { rows, skipped } = F.parseLaunches(live, NOW);
  assert.equal(rows.length, 5);
  assert.equal(skipped, 0);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].t <= r.t));
  assert.equal(rows[0].precision, "window"); // win_open set, t0 null
  assert.equal(rows[0].t, Date.parse("2026-11-02T16:00Z"));
  assert.equal(rows[2].precision, "exact"); // t0 set
  assert.equal(rows[2].vehicle, "Falcon 9");
  assert.equal(rows[2].site, "Vandenberg SFB");
  // text only: no media, weather or links are carried through
  for (const r of rows) for (const k of Object.keys(r)) assert.ok(["name", "t", "precision", "dateStr", "provider", "vehicle", "site", "country"].includes(k), k);
});

test("launches: a drifted or empty feed throws (shown as unavailable), never an empty 'no launches' list", () => {
  for (const bad of [null, "", [], {}, { result: {} }, { results: live.result }, { data: live }, { result: [] }, { count: 0, result: [] }])
    assert.throws(() => F.parseLaunches(bad, NOW), /launch feed/, JSON.stringify(bad)?.slice(0, 40));
  // every row unreadable (renamed fields) -> throws, not a list of blanks
  const renamed = { result: live.result.map(({ name, t0, win_open, sort_date, ...r }) => ({ ...r, title: name, net: t0 || win_open })) };
  assert.throws(() => F.parseLaunches(renamed, NOW), /no readable launches/);
  const badTimes = { result: [{ name: "X", t0: "soon", win_open: "2026-13-45", sort_date: "abc" }, { name: "Y", sort_date: 12 }] };
  assert.throws(() => F.parseLaunches(badTimes, NOW), /no readable launches/);
});

test("launches: unreadable rows are skipped and counted; day-only dates are labelled as such", () => {
  const mixed = { result: [...live.result.slice(0, 2), { name: "" }, { t0: "2026-11-03T00:00Z" }, { name: "Day only", sort_date: "1794000000", date_str: "Nov 06" }] };
  const { rows, skipped } = F.parseLaunches(mixed, NOW);
  assert.equal(skipped, 2);
  const d = rows.find((r) => r.name === "Day only");
  assert.equal(d.precision, "day");
  assert.equal(d.dateStr, "Nov 06");
});

test("launches: past entries drop out (2 h grace for a slipping window); all-past is detectable", () => {
  const { rows } = F.parseLaunches(live, NOW);
  assert.equal(F.upcomingLaunches(rows, NOW).length, 5);
  const later = Date.parse("2026-11-06T00:00:00Z");
  assert.equal(F.upcomingLaunches(rows, later).length, 0);
  assert.equal(F.upcomingLaunches(rows, rows[0].t + 3600e3).length, 5); // within the grace period
});

test("launches: fixed URL (no location or parameters), cache at least 15 minutes, host in CSP connect-src", () => {
  assert.equal(F.ENDPOINTS.launches, "https://fdo.rocketlaunch.live/json/launches/next/5");
  assert.ok(F.LAUNCH_CACHE_MS >= 15 * 60e3);
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const csp = html.match(/connect-src ([^;]+);/)[1].split(/\s+/);
  assert.ok(csp.includes("https://fdo.rocketlaunch.live"));
  const js = readFileSync(new URL("../js/launches.js", import.meta.url), "utf8");
  assert.match(js, /Data by \$\{RLL\}/); // visible credit
  assert.doesNotMatch(js, /<img|\.media\b|state\.loc/);
});
