// The Pages artifact (scripts/build-site.mjs) must publish every file the site uses, byte for byte, and nothing else.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SITE, REPO_ONLY, siteFiles, buildSite } from "../scripts/build-site.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (f) => readFileSync(join(root, f), "utf8");
const files = new Set(siteFiles(root));
let tracked = null;
try { tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean); } catch { /* not a git checkout */ }

test("every tracked file is either published or explicitly repository-only", { skip: !tracked && "no git" }, () => {
  const under = (f, list) => list.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p));
  const unclassified = tracked.filter((f) => !under(f, SITE) && !under(f, REPO_ONLY));
  assert.deepEqual(unclassified, []);
  const published = tracked.filter((f) => under(f, SITE) && !f.split("/").some((s) => s.startsWith(".")));
  assert.deepEqual(published.filter((f) => !files.has(f)), [], "tracked site files missing from the artifact");
});

test("artifact has no tests, scripts, workflows, docs, package or dot files", () => {
  const bad = [...files].filter((f) => /^(tests|scripts|docs|\.github|node_modules)\//.test(f) || /^(README\.md|package(-lock)?\.json)$/.test(f) || f.split("/").some((s) => s.startsWith(".")));
  assert.deepEqual(bad, []);
});

test("every file the service worker precaches is published", () => {
  const assets = JSON.parse(read("sw.js").match(/const ASSETS = (\[[\s\S]*?\]);/)[1].replace(/,\s*\]/, "]"));
  assert.deepEqual(assets.filter((a) => a !== "./" && !files.has(a)), []);
});

test("every same-origin file the pages, manifest and modules reference is published", () => {
  const refs = new Set();
  for (const h of ["index.html", "404.html"]) for (const m of read(h).matchAll(/(?:src|href)="([^"#:?]+)"/g)) refs.add(m[1].replace(/^\/SKYHUD\//, ""));
  for (const i of JSON.parse(read("manifest.webmanifest")).icons) refs.add(i.src);
  refs.add("manifest.webmanifest"); refs.add("sw.js");
  for (const f of readdirSync(join(root, "js"))) {
    const s = read(`js/${f}`);
    for (const m of s.matchAll(/(?:from|import\()\s*["']\.\/([\w.-]+\.js)["']/g)) refs.add(`js/${m[1]}`);
    for (const m of s.matchAll(/["'](?:\.\.?\/)?((?:data|vendor|icons|js)\/[\w.-]+\.\w+|catalog\.tle)["']/g)) refs.add(m[1]);
  }
  refs.delete(""); refs.delete("/SKYHUD/"); refs.delete("./");
  const missing = [...refs].filter((r) => !files.has(r));
  assert.deepEqual(missing, []);
  assert.ok(refs.size >= 25, `found only ${refs.size} references`);
});

test("buildSite copies the files byte for byte", () => {
  const out = mkdtempSync(join(tmpdir(), "skyhud-site-"));
  try {
    const list = buildSite(out, root);
    assert.deepEqual(list, [...files]);
    for (const f of list) assert.ok(readFileSync(join(out, f)).equals(readFileSync(join(root, f))), f);
    assert.throws(() => buildSite(root, root), /refusing/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("npm test runs exactly the tests/*.test.mjs files (not helpers or fixtures)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.test, "node --test tests/*.test.mjs");
  const files = readdirSync(new URL("../tests/", import.meta.url));
  assert.ok(files.filter((f) => f.endsWith(".test.mjs")).length >= 9);
  assert.ok(files.some((f) => f.startsWith("_") && f.endsWith(".mjs")), "helper modules exist and are not matched");
});

test("tracker reserved heights: one per breakpoint, documented with how they were measured and how to re-measure", () => {
  const css = read("styles.css");
  const i = css.indexOf("/* Launch tracker (lazy)"), block = css.slice(i, css.indexOf(".lt-controls", i));
  assert.ok(i > 0, "tracker block");
  // Exactly three reserves: default (measured at 1280 px), <=900px (at 900) and <=560px (at 390), each a whole px.
  const rules = [...block.matchAll(/^(?:@media \(max-width: (\d+)px\) \{ )?\.tracker \{ min-height: (\d+)px; \}/gm)].map((m) => [m[1] || "", +m[2]]);
  assert.deepEqual(rules.map((r) => r[0]), ["", "900", "560"]);
  for (const [, px] of rules) assert.ok(px > 1000 && px < 5000, `plausible ${px}`);
  // Narrower layouts wrap more, so each reserve must be taller than the wider one.
  assert.ok(rules[0][1] < rules[1][1] && rules[1][1] < rules[2][1], rules.join(" | "));
  // The comment says what was measured and how to redo it (the e2e fails on any mismatch).
  for (const s of ["natural height", "min-height: 0", "1280", "900", "390", "data/launches.json", "tracker-e2e.mjs",
    "Re-measure", "getBoundingClientRect", "Last measured"]) assert.ok(block.includes(s), `comment mentions ${s}`);
});
