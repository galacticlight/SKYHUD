// Loads the vendored Astronomy Engine (browser build) into globalThis, as the page's <script> tag does.
import { readFileSync } from "node:fs";
import vm from "node:vm";
const src = readFileSync(new URL("../vendor/astronomy.browser.min.js", import.meta.url), "utf8");
vm.runInThisContext(src, { filename: "astronomy.browser.min.js" });
