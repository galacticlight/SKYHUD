// SKYHUD launch tracker: pure logic over the same-origin snapshot data/launches.json, which a scheduled
// GitHub Action builds from Launch Library 2 (scripts/update-launches.mjs). No DOM, no network: unit-tested.
//
// Honesty rules:
// - Outcomes are exactly Success, Failure, Partial failure, or "Not yet launched / unknown". The outcome comes
//   only from LL2's status id (3, 4, 7). A missing or other status is never read as success.
// - Counts use the UTC year. Only launches with a final outcome are counted as success/failure/partial; launches
//   in flight or awaiting confirmation are shown as pending.
// - Each launch counts once (deduplicated by LL2 id, newest record wins), so a launch whose date moved or that was
//   scrubbed and re-listed is not counted twice.
// - A snapshot with missing pages gives counts marked as lower bounds. A snapshot that fails to parse throws, so
//   the page shows "unavailable", never zero.
export const SNAPSHOT_URL = "data/launches.json";
export const archiveUrl = (y) => `data/launches-${y}.json`;
export const STALE_MS = 12 * 3600e3;
export const OUTCOME = { 3: "Success", 4: "Failure", 7: "Partial failure" };
export const NOT_FINAL = "Not yet launched / unknown";
export const PAYLOAD_NONE = "Undisclosed / not listed";

const str = (v, n = 600) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, n) : null);
const isoT = (v) => (typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/.test(v) ? Date.parse(v) : NaN);

export const outcomeOf = (r) => (r && Number.isInteger(r.status_id) && OUTCOME[r.status_id]) || NOT_FINAL;
export const utcYear = (t) => new Date(t).getUTCFullYear();

/** Normalises one snapshot row; null when the id or launch time can't be read (counted as skipped). */
export function readRow(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const id = str(x.id, 64), t = isoT(x.net);
  if (!id || !Number.isFinite(t)) return null;
  return {
    id, t, name: str(x.name, 160) || "Unnamed launch",
    precision: str(x.net_precision, 8),
    statusId: Number.isInteger(x.status_id) ? x.status_id : null,
    statusText: str(x.status, 40),
    outcome: outcomeOf(x),
    failreason: str(x.failreason, 400),
    provider: str(x.provider, 120) || "Provider not listed",
    providerCountry: str(x.provider_country, 20),
    vehicle: str(x.vehicle, 120) || "Vehicle not listed",
    pad: str(x.pad, 120), location: str(x.location, 120), padCountry: str(x.pad_country, 3),
    missionType: str(x.mission_type, 60), orbit: str(x.orbit, 12),
    orbital: x.orbital === false ? false : x.orbital === true ? true : null,
    description: str(x.mission_description, 600),
    payloads: Array.isArray(x.payloads) ? x.payloads.map((p) => str(p, 120)).filter(Boolean) : [],
    updated: isoT(x.source_last_updated),
    sourceUrl: typeof x.source_url === "string" && x.source_url.startsWith("https://ll.thespacedevs.com/") ? x.source_url : null,
  };
}

/** Keeps one row per id: the most recently updated record (a moved or re-listed launch counts once). */
export function dedupe(rows) {
  const m = new Map();
  for (const r of rows) {
    const o = m.get(r.id);
    if (!o || (Number.isFinite(r.updated) ? r.updated : -1) >= (Number.isFinite(o.updated) ? o.updated : -1)) m.set(r.id, r);
  }
  return [...m.values()];
}

/** Parses data/launches.json. Throws on any drift in the top-level shape. */
export function parseSnapshot(j) {
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("Launch snapshot: not an object");
  if (j.schema !== 1) throw new Error("Launch snapshot: unknown schema");
  if (!Number.isInteger(j.year) || j.year < 1957 || j.year > 3000) throw new Error("Launch snapshot: no year");
  const at = isoT(j.fetched_at);
  if (!Number.isFinite(at)) throw new Error("Launch snapshot: no fetch time");
  if (!Array.isArray(j.launches)) throw new Error("Launch snapshot: launches is not a list");
  const p = j.pages && typeof j.pages === "object" ? j.pages : null;
  if (!p || !Number.isInteger(p.expected) || !Number.isInteger(p.received) || !Number.isInteger(p.count)) throw new Error("Launch snapshot: page record missing");
  let skipped = 0;
  const read = (list) => (Array.isArray(list) ? list : []).map((x) => readRow(x) || (skipped++, null)).filter(Boolean);
  const all = read(j.launches);
  if (j.launches.length && !all.length) throw new Error("Launch snapshot: no readable launches");
  const past = dedupe(all);
  const pastIds = new Set(past.map((r) => r.id));
  const upcoming = dedupe(read(j.upcoming)).filter((r) => !pastIds.has(r.id)).sort((a, b) => a.t - b.t);
  // Complete only when every page arrived and the rows add up to the API's own count.
  const complete = p.received >= p.expected && past.length + skipped + (Number.isInteger(p.suborbital) ? p.suborbital : 0) >= p.count;
  return {
    year: j.year, fetchedAt: at, complete, pages: p, skipped,
    launches: past.sort((a, b) => a.t - b.t), upcoming,
    upcomingCount: Number.isInteger(j.upcoming_count) ? j.upcoming_count : null,
    payloadRecords: j.payload_records !== false,
    ll2Count: j.crosscheck && Number.isInteger(j.crosscheck.ll2_orbital_launch_attempt_count_year) ? j.crosscheck.ll2_orbital_launch_attempt_count_year : null,
    archiveYears: Array.isArray(j.archive_years) ? j.archive_years.filter((y) => Number.isInteger(y) && y < j.year) : [],
    archived: j.archived === true,
  };
}

/** Year tally over a parsed snapshot. Only UTC-year launches; suborbital rows (if any slipped in) are excluded. */
export function tally(snap, year = snap.year) {
  const rows = snap.launches.filter((r) => utcYear(r.t) === year && r.orbital !== false);
  const T = { year, success: 0, failure: 0, partial: 0, pending: 0, final: 0, complete: snap.complete, first: null, last: null, byProvider: [] };
  const prov = new Map();
  for (const r of rows) {
    const k = r.outcome === "Success" ? "success" : r.outcome === "Failure" ? "failure" : r.outcome === "Partial failure" ? "partial" : "pending";
    T[k]++;
    if (k !== "pending") { T.final++; if (T.first == null || r.t < T.first) T.first = r.t; if (T.last == null || r.t > T.last) T.last = r.t; }
    const key = r.provider;
    const p = prov.get(key) || { provider: key, country: r.providerCountry, total: 0, success: 0, failure: 0, partial: 0, pending: 0 };
    p.total++; p[k]++;
    prov.set(key, p);
  }
  // Scheduled for the rest of the year: listed upcoming launches dated this UTC year (NET dates often slip).
  // LL2's own count of launches listed for the rest of the snapshot year (the upcoming query is limited to it).
  T.scheduled = year === snap.year && !snap.archived ? snap.upcomingCount : null;
  T.byProvider = [...prov.values()].sort((a, b) => b.total - a.total || a.provider.localeCompare(b.provider));
  T.attempts = T.final + T.pending;
  return T;
}

/** "2026: 254 launches, 247 success, 7 failure, 0 partial, 0 pending" with lower-bound wording when incomplete. */
export function tallyText(T) {
  const lb = T.complete ? "" : "at least ";
  return `${T.year}: ${lb}${T.attempts} orbital launch${T.attempts === 1 ? "" : "es"}, ${lb}${T.success} success, ${lb}${T.failure} failure, ${lb}${T.partial} partial failure, ${T.pending} awaiting outcome${T.scheduled != null ? `; ${T.scheduled} more scheduled (dates may slip)` : ""}`;
}

export function snapshotAge(at, now = Date.now()) {
  if (at - now > 10 * 60e3) return "future";
  return now - at > STALE_MS ? "stale" : "fresh";
}

/** UTC and local launch time, honouring LL2's NET precision (no false minutes for an hour/day/month estimate). */
export function whenText(r, tz) {
  const d = new Date(r.t);
  const f = (zone, o) => new Intl.DateTimeFormat("en-US", { timeZone: zone, ...o }).format(d);
  const p = r.precision || "MIN";
  if (/^(SEC|MIN|HR)$/.test(p)) {
    const o = { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
    const lo = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
    const est = p === "HR" ? " (to the hour)" : "";
    return { utc: `${f("UTC", o)} UTC${est}`, local: `${f(tz, lo)}${est}` };
  }
  if (p === "DAY") return { utc: `${f("UTC", { month: "short", day: "numeric", year: "numeric" })} (UTC date; time not set)`, local: "" };
  if (p === "M" || p === "MONTH") return { utc: `NET ${f("UTC", { month: "long", year: "numeric" })}`, local: "" };
  return { utc: `NET ${f("UTC", { year: "numeric" })} (${p.toLowerCase()} estimate)`, local: "" };
}

export const natureText = (r) => [r.missionType || "Mission type not public", r.orbit ? `orbit ${r.orbit}` : "orbit not public"].join(", ");
export const payloadText = (r, records = true) => (r.payloads.length ? r.payloads.join("; ") : records ? PAYLOAD_NONE : "Payload list unavailable");
