// Red mode is applied before first paint (js/theme.js) and the brightness slider is shown by CSS, so a
// red-mode visit has no dark frame and no header reflow when app.js arrives (QA v11 P2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const src = read("js/theme.js"), html = read("index.html"), css = read("styles.css"), app = read("js/app.js");

/** Run theme.js against a fake <html>, theme-color meta and localStorage; return what it set. */
function run(stored, { throws = false } = {}) {
  const attrs = {}, props = {}, meta = { content: "#05070c", setAttribute(k, v) { this[k] = v; } };
  const documentElement = { setAttribute: (k, v) => { attrs[k] = v; }, style: { setProperty: (k, v) => { props[k] = v; } } };
  const localStorage = { getItem: (k) => { if (throws) throw new Error("blocked"); return k in stored ? stored[k] : null; } };
  runInNewContext(src, { document: { documentElement, querySelector: (s) => (s === 'meta[name="theme-color"]' ? meta : null) }, localStorage });
  return { theme: attrs["data-theme"], level: props["--night-level"], color: meta.content };
}

test("theme.js: saved red mode and brightness are applied the way app.js reads them", () => {
  assert.deepEqual(run({ "skyhud.red": "true", "skyhud.dim": "40" }), { theme: "red", level: "0.4", color: "#000000" });
  assert.deepEqual(run({ "skyhud.red": "false" }), { theme: "dark", level: "0.7", color: "#05070c" });
  assert.deepEqual(run({}), { theme: "dark", level: "0.7", color: "#05070c" });
  assert.equal(run({ "skyhud.red": "true", "skyhud.dim": "5" }).level, "0.2"); // clamped like app.js (20..100)
  assert.equal(run({ "skyhud.red": "true", "skyhud.dim": "500" }).level, "1");
  assert.equal(run({ "skyhud.red": "true", "skyhud.dim": '"x"' }).level, "0.7");
  assert.deepEqual(run({ "skyhud.red": "{bad json" }), { theme: "dark", level: "0.7", color: "#05070c" });
  assert.deepEqual(run({ "skyhud.red": "true" }, { throws: true }), { theme: "dark", level: "0.7", color: "#05070c" });
  // Same storage keys and defaults as app.js's state.
  assert.match(app, /red: store\.get\("red", false\)/);
  assert.match(app, /store\.get\("dim", 70\)/);
});

test("index.html loads theme.js as a blocking same-origin script in <head>, before the stylesheet; CSP has no inline script", () => {
  const head = html.slice(0, html.indexOf("</head>"));
  const tag = head.match(/<script src="js\/theme\.js"([^>]*)><\/script>/);
  assert.ok(tag, "theme.js in <head>");
  assert.equal(tag[1], "", "no async, defer or type=module: it must run before the body is parsed");
  assert.ok(head.indexOf("js/theme.js") < head.indexOf('rel="stylesheet"'), "before the stylesheet, so it doesn't wait for CSS");
  assert.match(head, /script-src 'self';/);
  assert.doesNotMatch(head, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, "no inline <script>");
  assert.match(read("sw.js"), /"js\/theme\.js"/, "precached for offline");
});

test("the brightness slider is shown by CSS in red mode, not by a hidden attribute toggled later", () => {
  assert.match(html, /<label class="dim" id="dim-wrap" title=/);
  assert.doesNotMatch(html, /id="dim-wrap"[^>]*\bhidden\b/);
  assert.doesNotMatch(app, /dim-wrap/);
  assert.match(css, /#dim-wrap \{ display: none; \}/);
  assert.match(css, /\[data-theme="red"\] #dim-wrap \{ display: flex; \}/);
});
