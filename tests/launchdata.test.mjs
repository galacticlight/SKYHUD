// Launch tracker: the Action's snapshot builder (scripts/update-launches.mjs), the page's parser/tally
// (js/launchdata.js), and the committed data/launches.json. The workflow runs this file before committing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { UPCOMING, buildSnapshot, checkPage, trimLaunch, pastUrl, upcomingUrl, sameData, payloadsByLaunch, providerMap } from "../scripts/update-launches.mjs";
import { parseSnapshot, tally, tallyText, outcomeOf, whenText, payloadText, natureText, snapshotAge, dedupe, readRow, NOT_FINAL, PAYLOAD_NONE } from "../js/launchdata.js";

const J = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const RAW = J("./fixtures/ll2-previous-page.json");
const SNAP = J("./fixtures/launches-snapshot.json");
const clone = (x) => JSON.parse(JSON.stringify(x));
const UP = { count: 0, results: [] };
const build = (pages, extra = {}) => buildSnapshot({ year: 2026, pastPages: pages, upcoming: UP, fetchedAt: "2026-11-01T08:00:00Z", ...extra });

// ---------- Action: URLs ----------
test("action queries one UTC year of orbital launches, 100 per page, and upcoming only to year end", () => {
  const u = new URL(pastUrl(2026, 200));
  assert.equal(u.searchParams.get("net__gte"), "2026-01-01T00:00:00Z");
  assert.equal(u.searchParams.get("net__lt"), "2027-01-01T00:00:00Z");
  assert.equal(u.searchParams.get("include_suborbital"), "false");
  assert.equal(u.searchParams.get("limit"), "100");
  assert.equal(u.searchParams.get("offset"), "200");
  assert.equal(u.hostname, "ll.thespacedevs.com");
  assert.equal(new URL(upcomingUrl(2026)).searchParams.get("net__lt"), "2027-01-01T00:00:00Z");
});

// ---------- Action: snapshot builder ----------
test("builder trims real LL2 rows, keeps the failure reason, and stores no image URLs", () => {
  const s = build([RAW]);
  assert.equal(s.launches.length, 3);
  const f = s.launches.find((r) => r.status_id === 4);
  assert.equal(f.name, "PSLV-DL | EOS-N1 and others");
  assert.match(f.failreason, /3rd stage/);
  assert.equal(f.vehicle, "PSLV-DL");
  assert.equal(s.pages.expected, 1);
  assert.doesNotMatch(JSON.stringify(s), /\.(jpe?g|png|webp)\b/i);
});

test("drifted page shapes are refused (non-array results, missing count, not an object)", () => {
  assert.throws(() => checkPage({ count: 1, results: {} }, "p"), /not an array/);
  assert.throws(() => checkPage({ results: [] }, "p"), /no count/);
  assert.throws(() => checkPage([], "p"), /not a JSON object/);
  const bad = clone(RAW); bad.results = null;
  assert.throws(() => build([bad]), /not an array/);
});

test("a missing page is refused, never published as a short year", () => {
  const p = clone(RAW); p.count = 254; // says 3 pages, only 1 received
  assert.throws(() => build([p]), /incomplete: 1 of 3 pages/);
});

test("rows that don't add up to the API count are refused (list shifted between pages)", () => {
  const p = clone(RAW); p.count = 4;
  assert.throws(() => build([p]), /incomplete/);
});

test("renamed fields (feed drift) are refused, not counted as zero or as success", () => {
  const p = clone(RAW); p.results.forEach((r) => { r.window_start = r.net; delete r.net; });
  assert.throws(() => build([p]), /feed drift: 3 of 3 rows unreadable/);
  const q = clone(RAW); q.results.forEach((r) => { r.state = r.status; delete r.status; });
  assert.throws(() => build([q]), /feed drift: 3 launches have no status id/);
});

test("rows outside the UTC year are refused (net__lt filter must have been applied)", () => {
  const p = clone(RAW); p.results[0].net = "2027-01-01T00:00:00Z";
  assert.throws(() => build([p]), /outside 2026 UTC/);
  const q = clone(RAW); q.results[0].net = "2025-12-31T23:59:59Z";
  assert.throws(() => build([q]), /outside 2026 UTC/);
});

test("a duplicate id across pages counts once; suborbital rows are excluded", () => {
  const again = { count: 3, results: [clone(RAW.results[2])] }; // list shifted: page 2 repeats the last row
  assert.equal(build([RAW, again]).launches.length, 3);
  const c = clone(RAW); c.results[1].mission.orbit = { abbrev: "Sub" };
  const s = build([c]);
  assert.equal(s.launches.length, 2);
  assert.equal(s.pages.suborbital, 1);
});

test("a big drop against the previous snapshot keeps the old file", () => {
  const prev = { year: 2026, launches: Array.from({ length: 10 }, (_, i) => ({ id: String(i) })) };
  assert.throws(() => build([RAW], { prev }), /count dropped from 10 to 3/);
  assert.doesNotThrow(() => build([RAW], { prev: { ...prev, year: 2025 } }));
});

test("upcoming repeats of launched rows are dropped from the list and the count", () => {
  const up = { count: 5, results: [clone(RAW.results[0])] };
  const s = build([RAW], { upcoming: up });
  assert.equal(s.upcoming.length, 0);
  assert.equal(s.upcoming_count, 4);
});

test("payload names attach only from LL2 payload records; provider country from agency records", () => {
  const id = RAW.results[0].id;
  const pm = payloadsByLaunch({ count: 2, results: [
    { launch: { id }, payload: { name: "Sat A" }, amount: 2 },
    { launch: { id }, payload: { name: "Sat B" } },
  ] });
  assert.deepEqual(pm[id], ["Sat A (x2)", "Sat B"]);
  const prov = providerMap([{ count: 1, results: [{ id: 121, name: "SpaceX", country: [{ alpha_3_code: "USA" }] }] }]);
  const r = trimLaunch(RAW.results[0], prov, pm);
  assert.equal(r.provider_country, "USA");
  assert.deepEqual(r.payloads, ["Sat A (x2)", "Sat B"]);
  assert.equal(trimLaunch(RAW.results[2], prov, pm).payloads.length, 0);
});

test("sameData ignores only the fetch time", () => {
  const a = build([RAW]), b = { ...a, fetched_at: "2026-11-02T00:00:00Z" };
  assert.ok(sameData(a, b));
  assert.ok(!sameData(a, { ...b, upcoming_count: 9 }));
});

// ---------- Page: parser and tally ----------
test("outcomes are only Success / Failure / Partial failure; anything else is not success", () => {
  assert.equal(outcomeOf({ status_id: 3 }), "Success");
  assert.equal(outcomeOf({ status_id: 4 }), "Failure");
  assert.equal(outcomeOf({ status_id: 7 }), "Partial failure");
  for (const x of [{ status_id: 6 }, { status_id: 9 }, { status_id: 99 }, {}, { status_id: "3" }, null]) assert.equal(outcomeOf(x), NOT_FINAL);
});

test("fixture tally: 7 known failures, partial, pending, UTC-year boundary, dupes and suborbital", () => {
  const s = parseSnapshot(SNAP);
  const T = tally(s);
  assert.deepEqual({ success: T.success, failure: T.failure, partial: T.partial, pending: T.pending, attempts: T.attempts },
    { success: 9, failure: 7, partial: 1, pending: 3, attempts: 20 });
  const fails = s.launches.filter((r) => r.outcome === "Failure").map((r) => r.name);
  for (const n of ["PSLV-DL | EOS-N1", "Long March 3B/E | Shijian 32", "Ceres-2 | Demo Flight", "KAIROS | Flight 3",
    "Tianlong-3 | Demo Flight", "New Glenn | BlueBird 7", "Long March 7A | ChinaSat 4B"]) assert.ok(fails.some((f) => f.startsWith(n)), n);
  assert.equal(s.skipped, 2);
  assert.equal(new Date(T.first).toISOString(), "2026-01-01T07:30:00.000Z"); // Dec 31 PST evening = 2026 UTC
  assert.equal(T.scheduled, 12);
  assert.match(tallyText(T), /^2026: 20 orbital launches, 9 success, 7 failure, 1 partial failure, 3 awaiting outcome; 12 more scheduled/);
});

test("a launch late on Dec 31 Pacific counts in the next UTC year, one earlier counts in the old year", () => {
  const s = parseSnapshot(SNAP);
  assert.ok(s.launches.find((r) => r.id === "fx-boundary-out"));
  assert.equal(tally(s, 2025).attempts, 1);
  const w = whenText(s.launches.find((r) => r.id === "fx-boundary-in"), "America/Los_Angeles");
  assert.equal(w.utc, "Jan 1, 2026, 07:30 UTC");
  assert.equal(w.local, "Dec 31, 11:30 PM PST");
});

test("DST change day: same 1:30 AM wall time shows PDT then PST", () => {
  const s = parseSnapshot(SNAP);
  assert.equal(whenText(s.launches.find((r) => r.id === "fx-dst-pdt"), "America/Los_Angeles").local, "Nov 1, 1:30 AM PDT");
  assert.equal(whenText(s.launches.find((r) => r.id === "fx-dst-pst"), "America/Los_Angeles").local, "Nov 1, 1:30 AM PST");
});

test("a scrubbed-and-moved launch counts once, with its newest record", () => {
  const s = parseSnapshot(SNAP);
  const d = s.launches.filter((r) => r.id === "fx-dupe");
  assert.equal(d.length, 1);
  assert.equal(d[0].outcome, "Success");
  assert.equal(new Date(d[0].t).toISOString(), "2026-05-03T10:00:00.000Z");
  assert.equal(dedupe([readRow(SNAP.launches.at(-4)), readRow(SNAP.launches.at(-5))]).length, 1);
});

test("upcoming: TBD shows as NET month, already-flown repeats are dropped", () => {
  const s = parseSnapshot(SNAP);
  assert.equal(s.upcoming.length, 2);
  assert.equal(whenText(s.upcoming.find((r) => r.id === "fx-tbd"), "UTC").utc, "NET December 2026");
});

test("incomplete snapshot: counts are labelled lower bounds", () => {
  const j = clone(SNAP); j.pages = { ...j.pages, expected: 3, received: 2 };
  const T = tally(parseSnapshot(j));
  assert.equal(T.complete, false);
  assert.match(tallyText(T), /at least 20 orbital launches, at least 9 success/);
});

test("drifted snapshot throws (page shows unavailable, never zero)", () => {
  for (const mut of [(j) => (j.launches = {}), (j) => delete j.fetched_at, (j) => (j.schema = 2), (j) => delete j.pages,
    (j) => (j.launches = [{ nope: 1 }]), (j) => (j.year = "2026")]) {
    const j = clone(SNAP); mut(j);
    assert.throws(() => parseSnapshot(j));
  }
  assert.throws(() => parseSnapshot(null));
  assert.throws(() => parseSnapshot([]));
});

test("stale snapshot: older than 12 h is stale; a future stamp is flagged", () => {
  const at = Date.parse("2026-11-01T08:00:00Z");
  assert.equal(snapshotAge(at, at + 11 * 3600e3), "fresh");
  assert.equal(snapshotAge(at, at + 13 * 3600e3), "stale");
  assert.equal(snapshotAge(at + 3600e3, at), "future");
});

test("payload and nature text never guess", () => {
  const s = parseSnapshot(SNAP);
  const r = s.launches.find((x) => x.id === "fx-inflight");
  assert.equal(payloadText(r), PAYLOAD_NONE);
  assert.equal(PAYLOAD_NONE, "Not in LL2 payload records");
  assert.doesNotMatch(PAYLOAD_NONE, /undisclosed|secret|classified|withheld|hidden/i);
  assert.equal(payloadText(r, false), "Payload list unavailable");
  assert.equal(payloadText({ payloads: ["A", "B"] }), "A; B");
  assert.equal(natureText({ missionType: null, orbit: null }), "Mission type not listed in LL2, orbit not listed in LL2");
});

test("hostile strings stay plain data (rendering escapes them)", () => {
  const r = readRow({ id: "x", net: "2026-01-01T00:00:00Z", name: "<img src=x onerror=alert(1)>", source_url: "javascript:alert(1)" });
  assert.equal(r.name, "<img src=x onerror=alert(1)>");
  assert.equal(r.sourceUrl, null);
});

// ---------- The committed snapshot itself (the Action runs this before committing) ----------
test("data/launches.json parses, is complete, and agrees with LL2's own running count", { skip: !existsSync(new URL("../data/launches.json", import.meta.url)) }, () => {
  const j = J("../data/launches.json");
  const s = parseSnapshot(j);
  assert.ok(s.complete, "snapshot incomplete");
  assert.equal(s.pages.received, s.pages.expected);
  const T = tally(s);
  assert.equal(T.attempts, s.launches.filter((r) => r.orbital !== false).length);
  if (s.ll2Count != null) assert.equal(T.attempts, s.ll2Count);
  assert.ok(s.launches.every((r) => new Date(r.t).getUTCFullYear() === s.year));
});

test("payload wording never implies secrecy (QA v9 P2)", () => {
  for (const f of ["js/launchdata.js", "js/tracker.js", "README.md", "index.html"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /undisclosed/i, f);
  }
  const tracker = readFileSync(new URL("../js/tracker.js", import.meta.url), "utf8");
  assert.match(tracker, /shows as "\$\{PAYLOAD_NONE\}"/, "the tracker note quotes the same constant the table shows");
  assert.match(tracker, /not that the payload is secret/);
});

// ---------- mutants QA v9 found surviving ----------
test("complete is false when every page arrived but the rows don't add up to the API count", () => {
  const s = clone(SNAP);
  const base = parseSnapshot(s), rows = base.launches.length + base.skipped; // after dedupe, plus unreadable rows
  s.pages = { ...s.pages, expected: 1, received: 1, skipped: 0, suborbital: 0, count: rows };
  assert.equal(parseSnapshot(s).complete, true, "rows == count: complete");
  s.pages.count = rows + 1;
  const short = parseSnapshot(s);
  assert.equal(short.complete, false, "all pages arrived, one row short: incomplete");
  assert.match(tallyText(tally(short, short.year)), /at least/);
  s.pages.suborbital = 1;
  assert.equal(parseSnapshot(s).complete, true, "a dropped suborbital row makes up the count");
  s.pages = { ...s.pages, suborbital: 0, received: 0 };
  s.pages.count = rows;
  assert.equal(parseSnapshot(s).complete, false, "a missing page: incomplete even when the rows add up");
});

test("payload_records: the builder records whether the payload call worked, and the page honours it", () => {
  assert.equal(build([RAW]).payload_records, false, "no payload page: records unavailable");
  assert.equal(build([RAW], { payloadPage: { count: 0, next: null, previous: null, results: [] } }).payload_records, true);
  const s = clone(SNAP);
  const r = parseSnapshot(s).launches.find((x) => !x.payloads.length);
  s.payload_records = false;
  const off = parseSnapshot(s);
  assert.equal(off.payloadRecords, false);
  assert.equal(payloadText(r, off.payloadRecords), "Payload list unavailable");
  s.payload_records = true;
  assert.equal(parseSnapshot(s).payloadRecords, true);
  assert.equal(payloadText(r, parseSnapshot(s).payloadRecords), PAYLOAD_NONE);
  delete s.payload_records;
  assert.equal(parseSnapshot(s).payloadRecords, true, "older snapshots without the flag keep the old behaviour");
});

test("mission type and orbit: LL2 placeholders N/A and Unknown read as 'not listed in LL2', never as secret", () => {
  for (const v of ["N/A", "n/a", "Unknown", " UNKNOWN ", "", null, undefined]) {
    assert.equal(natureText({ missionType: v, orbit: v }), "Mission type not listed in LL2, orbit not listed in LL2", String(v));
  }
  assert.equal(natureText({ missionType: "Communications", orbit: "LEO" }), "Communications, orbit LEO");
  // Real values that merely contain the words stay verbatim.
  assert.equal(natureText({ missionType: "Unknown Payload Test", orbit: "N/A-ish" }), "Unknown Payload Test, orbit N/A-ish");
  // LL2's own category name is data, shown as is.
  assert.equal(natureText({ missionType: "Government/Top Secret", orbit: "LEO" }), "Government/Top Secret, orbit LEO");
  const both = natureText({ missionType: null, orbit: null });
  assert.doesNotMatch(both, /not public|undisclosed|secret|classified|withheld|hidden/i);
  // The fixture carries the real placeholders (as on NROL-97 and upcoming launches) and they parse through.
  const rows = parseSnapshot(clone(SNAP)).launches;
  const inFlight = rows.find((r) => r.name === "Fixture | In flight"), noStatus = rows.find((r) => r.name === "Fixture | No status");
  assert.equal(inFlight.orbit, "N/A");
  assert.equal(natureText(inFlight), "Earth Science, orbit not listed in LL2");
  assert.equal(noStatus.missionType, "Unknown");
  assert.equal(natureText(noStatus), "Mission type not listed in LL2, orbit SSO");
  for (const r of rows) assert.doesNotMatch(natureText(r), /\b(N\/A|Unknown)\b/, r.name);
});

test("upcoming_count is LL2's total scheduled to year end; the stored list is capped at UPCOMING and the card says so", () => {
  assert.equal(Number(new URL(upcomingUrl(2026)).searchParams.get("limit")), UPCOMING, "one call fetches the capped list");
  // LL2's count (all scheduled launches before Jan 1), not the length of the one page fetched.
  const s = build([RAW], { upcoming: { count: 104, results: [] } });
  assert.equal(s.upcoming_count, 104);
  assert.equal(s.upcoming.length, 0);
  const live = J("../data/launches.json");
  assert.ok(live.upcoming.length <= UPCOMING, "stored list never exceeds the cap");
  assert.ok(live.upcoming_count >= live.upcoming.length, "the total is never below the stored list");
  const tracker = readFileSync(new URL("../js/tracker.js", import.meta.url), "utf8");
  assert.match(tracker, /The next \$\{n\} of the \$\{total\} orbital launches LL2 lists as scheduled for the rest of/);
  assert.match(tracker, /total > n \?/, "the cap note appears only when the list is shorter than the total");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /stores only the next 25 of them \(`UPCOMING`/);
  assert.match(readme, new RegExp(`stores only the next ${UPCOMING} of them`), "README matches the constant");
});
