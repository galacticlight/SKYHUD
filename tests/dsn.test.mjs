import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { xmlTree } from "./_xml.mjs";
const F = await import("../js/feeds.js");
const xml = readFileSync(new URL("./fixtures/dsn.xml", import.meta.url), "utf8");
const names = JSON.parse(readFileSync(new URL("../data/dsn-spacecraft.json", import.meta.url), "utf8"));
const live = () => xmlTree(xml);

test("DSN: real DSN Now feed parses into complexes, dishes and named spacecraft; placeholders are not spacecraft", () => {
  const d = F.parseDsn(live(), names);
  assert.deepEqual(d.stations.map((s) => s.name), ["Goldstone", "Madrid", "Canberra"]);
  assert.equal(d.dishes, 14);
  assert.equal(d.t, 1793519103000);
  assert.ok(!d.craft.includes("DSN") && !d.craft.includes("TEST")); // DSS14/26/55 "DSN", DSS36 "TEST"
  const vgr = d.stations[2].dishes.find((x) => x.dish === "DSS43").targets[0];
  assert.equal(vgr.name, "Voyager 2");
  assert.equal(vgr.down, true);
  assert.equal(vgr.up, false);
  assert.equal(vgr.rate, 160);
  assert.equal(vgr.rtlt, null); // feed sends -1: unknown, not 0
  const sta = d.stations[1].dishes.find((x) => x.dish === "DSS53").targets[0];
  assert.equal(sta.up && sta.down, true);
  const esc = d.stations[0].dishes.find((x) => x.dish === "DSS23").targets[0];
  assert.equal(esc.code, "ESCB"); // id 99 but a real craft: placeholders are matched by name, not id
  assert.equal(esc.up || esc.down, false); // inactive signals are not "talking"
});

test("DSN: unknown spacecraft codes show the raw code, flagged; missing name list still works", () => {
  const d = F.parseDsn(xmlTree(xml.replace(/VGR2/g, "ZZQ9")), names);
  const t = d.stations[2].dishes.find((x) => x.dish === "DSS43").targets[0];
  assert.equal(t.name, "ZZQ9");
  assert.equal(t.known, false);
  assert.equal(F.parseDsn(live(), {}).craft.length, 10);
});

test("DSN: drifted or malformed feeds throw (shown as unavailable), never 'nothing tracked'", () => {
  const drift = [
    xml.replace(/<dsn>/, "<deepspace>").replace(/<\/dsn>/, "</deepspace>"), // root renamed
    xml.replace(/<station /g, "<complex "), // stations renamed -> dishes orphaned
    xml.replace(/<dish /g, "<antenna ").replace(/<\/dish>/g, "</antenna>"), // dishes renamed
    xml.replace(/<target /g, "<craft "), // targets renamed: an all-idle network is not assumed
    xml.replace(/<timestamp>\d+<\/timestamp>/, "").replace(/timeUTC="\d+"/g, 'timeUTC=""'), // no time at all
    "<dsn></dsn>",
    '<dsn><station name="gdscc" friendlyName="Goldstone" timeUTC="1793519103000"/></dsn>',
  ];
  for (const s of drift) assert.throws(() => F.parseDsn(xmlTree(s), names), /DSN feed/, s.slice(0, 60));
  for (const bad of [null, undefined, {}, { tag: "dsn" }, { tag: "html", children: [] }]) assert.throws(() => F.parseDsn(bad, names), /DSN feed/);
  // the test XML reader (like DOMParser in the page) rejects broken XML outright
  assert.throws(() => xmlTree(xml.slice(0, 500)));
  assert.throws(() => xmlTree("<html><body>Access denied</body>"));
});

test("DSN: dish names that don't look like DSSnn are skipped and counted, not shown", () => {
  const d = F.parseDsn(xmlTree(xml.replace('name="DSS43"', 'name="<b>x</b>"'.replace(/[<>]/g, ""))), names);
  assert.equal(d.skipped, 1);
  assert.equal(d.dishes, 13);
});

test("DSN: staleness labels from the feed's own timestamp (feed allows 1 h HTTP caching)", () => {
  const t = 1793519103000;
  assert.equal(F.dsnAge(t, t + 60e3), "fresh");
  assert.equal(F.dsnAge(t, t + 6 * 60e3), "stale");
  assert.equal(F.dsnAge(t, t + 3600e3), "stale");
  assert.equal(F.dsnAge(t, t - 10 * 60e3), "future");
  assert.equal(F.dsnAge(NaN, t), "stale");
  assert.ok(F.DSN_POLL_MS >= 60e3); // at most once a minute
});

test("DSN: rate and light-time text", () => {
  assert.equal(F.dataRateText(160), "160 b/s");
  assert.equal(F.dataRateText(73510), "73.5 kb/s");
  assert.equal(F.dataRateText(2.1e6), "2.1 Mb/s");
  assert.equal(F.dataRateText(-1), "—");
  assert.equal(F.lightTimeText(2.6), "2.6 s");
  assert.equal(F.lightTimeText(45 * 3600), "45 h 0 min");
  assert.equal(F.lightTimeText(-1), "—");
});

test("DSN: fixed URL, host in connect-src, credit + unofficial label, XML parsed with DOMParser text/xml", () => {
  assert.equal(F.ENDPOINTS.dsn, "https://eyes.nasa.gov/dsn/data/dsn.xml");
  const csp = readFileSync(new URL("../index.html", import.meta.url), "utf8").match(/connect-src ([^;]+);/)[1].split(/\s+/);
  assert.ok(csp.includes("https://eyes.nasa.gov"));
  const js = readFileSync(new URL("../js/dsn.js", import.meta.url), "utf8");
  assert.match(js, /parseFromString\(text, "text\/xml"\)/);
  assert.match(js, /parsererror/);
  assert.match(js, /Unofficial:/);
  assert.match(js, /NASA\/JPL/);
  assert.doesNotMatch(js, /state\.loc|innerHTML\s*=\s*text/);
});
