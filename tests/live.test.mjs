import { test } from "node:test";
import assert from "node:assert/strict";
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
