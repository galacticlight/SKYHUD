// Boot loader (QA v9 P3): reload once when the app module fails to load (SW update caught half-way), never loop.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldReload, GUARD_MS, RELOAD_KEY } from "../js/boot.js";

test("shouldReload: once when online, never twice within the guard, never offline", () => {
  const now = 1_800_000_000_000;
  assert.equal(GUARD_MS, 60e3);
  assert.equal(RELOAD_KEY, "skyhud.bootReload");
  assert.equal(shouldReload(null, now, true), true, "first failure reloads");
  assert.equal(shouldReload(null, now, undefined), true, "unknown online state counts as online");
  assert.equal(shouldReload(null, now, false), false, "offline: a reload can't help");
  assert.equal(shouldReload(String(now - 1000), now, true), false, "just reloaded: loop guard");
  assert.equal(shouldReload(String(now - GUARD_MS + 1), now, true), false);
  assert.equal(shouldReload(String(now - GUARD_MS), now, true), true, "a later failure may reload again");
  assert.equal(shouldReload(String(now + 5000), now, true), false, "clock moved back: stay safe");
  assert.equal(shouldReload("junk", now, true), true, "unreadable guard value is ignored");
});

test("index.html boots through boot.js with app.js preloaded; early.js imports feeds.js inside its try", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<link rel="modulepreload" href="js\/app\.js">\n<script src="js\/boot\.js" type="module"><\/script>/);
  assert.doesNotMatch(html, /<script src="js\/app\.js"/);
  const early = readFileSync(new URL("../js/early.js", import.meta.url), "utf8");
  assert.doesNotMatch(early, /^import /m, "no static import that could throw outside the try");
  assert.match(early, /try \{\n  const \{ forecastUrl, DEFAULT_LOC, savedLoc \} = await import\("\.\/feeds\.js"\);/);
  const boot = readFileSync(new URL("../js/boot.js", import.meta.url), "utf8");
  assert.match(boot, /import\("\.\/app\.js"\)\.catch\(/);
  assert.match(boot, /sessionStorage\.setItem\(RELOAD_KEY, String\(Date\.now\(\)\)\)/);
  assert.ok(boot.indexOf("sessionStorage.setItem") < boot.indexOf("location.reload()"), "guard is written before reloading");
  assert.match(readFileSync(new URL("../sw.js", import.meta.url), "utf8"), /"js\/boot\.js"/);
});
