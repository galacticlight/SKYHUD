// Response size caps (QA v9 P3): the Action's LL2 fetch (5 MB) and the DSN feed (512 KB) never read past the cap.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCapped } from "../js/util.js";
import { MAX_RESPONSE_BYTES } from "../scripts/update-launches.mjs";

/** A body that streams `chunk`-byte pieces of "a" forever (or up to `total`), counting what was pulled. */
function stream(chunk, total = Infinity) {
  const st = { pulled: 0, cancelled: false };
  const body = new ReadableStream({
    pull(c) {
      if (st.pulled >= total) return c.close();
      const n = Math.min(chunk, total - st.pulled);
      st.pulled += n; c.enqueue(new Uint8Array(n).fill(97));
    },
    cancel() { st.cancelled = true; },
  }, { highWaterMark: 0 });
  return { body, st };
}

test("readCapped returns the text when under the cap (multi-byte UTF-8 split across chunks)", async () => {
  const bytes = new TextEncoder().encode("Δ-v ✓ 🚀");
  const body = new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close(); } });
  assert.equal(await readCapped(new Response(body), 100), "Δ-v ✓ 🚀");
  assert.equal(await readCapped(new Response("x".repeat(100)), 100), "x".repeat(100), "exactly the cap is allowed");
});

test("readCapped refuses a declared Content-Length over the cap without reading the body", async () => {
  const { body, st } = stream(1024);
  const res = new Response(body, { headers: { "content-length": "2000" } });
  await assert.rejects(readCapped(res, 1000, "feed"), /feed: response too large \(2000 bytes, limit 1000\)/);
  assert.equal(st.pulled, 0);
});

test("readCapped stops an endless or under-declared stream as soon as it passes the cap", async () => {
  const { body, st } = stream(4096);
  await assert.rejects(readCapped(new Response(body), 10000), /response too large \(over 10000 bytes/);
  assert.ok(st.pulled <= 10000 + 4096, `pulled ${st.pulled}`);
  assert.ok(st.cancelled, "the stream is cancelled");
  const lie = stream(4096, 50000);
  await assert.rejects(readCapped(new Response(lie.body, { headers: { "content-length": "10" } }), 10000), /too large/);
});

test("update-launches: an oversized LL2 response fails the run and leaves the snapshot untouched", () => {
  assert.equal(MAX_RESPONSE_BYTES, 5 * 1024 * 1024);
  const dir = mkdtempSync(join(tmpdir(), "skyhud-cap-"));
  try {
    const snap = join(dir, "launches.json"), prov = join(dir, "providers.json");
    copyFileSync(new URL("../data/launches.json", import.meta.url), snap);
    copyFileSync(new URL("../scripts/launch-providers.json", import.meta.url), prov);
    const before = readFileSync(snap), provBefore = readFileSync(prov);
    // Every request gets an endless 200 response of spaces (valid JSON whitespace, so only the cap stops it).
    const stub = `globalThis.fetch = async () => { globalThis.__pulled = 0;
      return new Response(new ReadableStream({ pull(c) { globalThis.__pulled += 65536; c.enqueue(new Uint8Array(65536).fill(32)); } }, { highWaterMark: 0 }), { status: 200 }); };`;
    const r = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(stub)}`,
      new URL("../scripts/update-launches.mjs", import.meta.url).pathname, "--out", dir, "--providers", prov],
      { encoding: "utf8", timeout: 30000 });
    assert.notEqual(r.status, 0, "the run fails");
    assert.match(r.stderr, /response too large \(over 5242880 bytes/);
    assert.deepEqual(readFileSync(snap), before, "snapshot not overwritten");
    assert.deepEqual(readFileSync(prov), provBefore, "provider cache not overwritten");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
