// "Tonight at a glance" helpers in js/score.js: best window and main limiting factor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bestWindow, mainLimit } from "../js/score.js";

const H = 3600e3, T0 = Date.UTC(2026, 9, 31, 4);
const hrs = (scores) => scores.map((score, i) => ({ t: new Date(T0 + i * H), score }));

test("bestWindow: run within 10 points of the best hour, consecutive hours only", () => {
  const w = bestWindow(hrs([30, 62, 70, 75, 68, 40, 74]));
  assert.deepEqual(w, { from: T0 + 2 * H, to: T0 + 4 * H, peak: 75, low: 68, n: 3 });
});
test("bestWindow: missing scores break nothing; gaps in time end the run; no scores -> null", () => {
  assert.equal(bestWindow(hrs([null, NaN, "50"])), null);
  assert.equal(bestWindow([]), null);
  const gap = [{ t: T0, score: 70 }, { t: T0 + 3 * H, score: 70 }];
  assert.equal(bestWindow(gap).n, 1);
  // a date and a number must give the same answer (toMs bug class)
  assert.deepEqual(bestWindow([{ t: T0, score: 50 }]), bestWindow([{ t: new Date(T0), score: 50 }]));
});
test("mainLimit: biggest weighted loss, null when under 3 points", () => {
  const sub = { clouds: 1, moon: 0.2, darkness: 1, light_pollution: 0.5, transparency: 1, seeing_comfort: 1 };
  assert.equal(mainLimit(sub), "moon"); // 0.2*0.8 = 0.16 > 0.1*0.5
  assert.equal(mainLimit({ ...sub, clouds: 0.5 }), "clouds"); // 0.45*0.5 = 0.225
  assert.equal(mainLimit({ clouds: 1, moon: 1, darkness: 1, light_pollution: 0.9, transparency: 1, seeing_comfort: 1 }), null);
  assert.equal(mainLimit(null), null);
});
