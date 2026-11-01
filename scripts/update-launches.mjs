// Builds data/launches.json from Launch Library 2 (The Space Devs). Run by .github/workflows/launches.yml
// about every 2 hours, never by visitors' browsers: TSD asks apps to cache its API rather than have clients
// query it directly, and the free tier allows 15 calls per hour per IP.
//
// One run makes 5 calls (3 pages of this UTC year's past orbital launches at 100 per page, 1 page of
// upcoming launches, and 1 page of LL2's structured payload records, which cover only a few launches), plus up to 4
// agency-list calls only when a launch provider appears that is not yet in
// scripts/launch-providers.json. Any failed page (after one retry with back-off) fails the run WITHOUT writing:
// the last good snapshot stays in place and the page shows its "as of" time. No images are kept (many LL2
// images are CC BY-NC), and no request carries anything about visitors.
//
// Usage: node scripts/update-launches.mjs [--out data] [--year 2026] [--providers scripts/launch-providers.json]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readCapped } from "../js/util.js";

export const API = "https://ll.thespacedevs.com/2.3.0/";
export const PAGE = 100, MAX_PAGES = 5, UPCOMING = 25;
// A real 100-launch page is well under 1 MB; anything over this is refused (the run fails, nothing is written).
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const SCHEMA = 1;
export const FINAL = { 3: "Success", 4: "Failure", 7: "Partial failure" };
const UA = "SKYHUD launch snapshot (+https://github.com/galacticlight/SKYHUD)";

const s = (v, n = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : null);
const iso = (v) => (typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

export const pastUrl = (year, offset = 0) =>
  `${API}launches/previous/?net__gte=${year}-01-01T00:00:00Z&net__lt=${year + 1}-01-01T00:00:00Z&include_suborbital=false&ordering=net&limit=${PAGE}&offset=${offset}&mode=normal`;
// Upcoming is limited to the rest of the same UTC year, so its count is "still scheduled this year".
export const upcomingUrl = (year) => `${API}launches/upcoming/?net__lt=${year + 1}-01-01T00:00:00Z&include_suborbital=false&ordering=net&limit=${UPCOMING}&mode=normal`;
export const payloadsUrl = () => `${API}payload_flights/?limit=100&mode=normal`;
export const agenciesUrl = (offset = 0) => `${API}agencies/?limit=100&offset=${offset}&mode=normal&ordering=id`;

/** One LL2 launch -> the trimmed snapshot row. Returns null when id or NET is unreadable. */
export function trimLaunch(r, providers = {}, payloadMap = {}) {
  if (!r || typeof r !== "object") return null;
  const id = s(r.id, 64), net = iso(r.net);
  if (!id || !net) return null;
  const st = r.status && typeof r.status === "object" ? r.status : {};
  const lsp = r.launch_service_provider && typeof r.launch_service_provider === "object" ? r.launch_service_provider : {};
  const m = r.mission && typeof r.mission === "object" ? r.mission : {};
  const pad = r.pad && typeof r.pad === "object" ? r.pad : {};
  const conf = r.rocket && r.rocket.configuration && typeof r.rocket.configuration === "object" ? r.rocket.configuration : {};
  const orbit = m.orbit && typeof m.orbit === "object" ? m.orbit : {};
  const prov = providers[String(lsp.id)];
  const payloads = Array.isArray(payloadMap[id]) ? payloadMap[id] : [];
  return {
    id, name: s(r.name, 160), net,
    net_precision: s(r.net_precision && r.net_precision.abbrev, 8),
    window_end: iso(r.window_end),
    status_id: Number.isInteger(st.id) ? st.id : null,
    status: s(st.abbrev, 40),
    failreason: s(r.failreason, 400) || null,
    provider: s(lsp.name, 120), provider_id: Number.isInteger(lsp.id) ? lsp.id : null,
    provider_type: s(lsp.type && lsp.type.name, 40),
    provider_country: prov && Array.isArray(prov.countries) && prov.countries.length ? prov.countries.join("/") : null,
    vehicle: s(conf.full_name || conf.name, 120),
    pad: s(pad.name, 120), location: s(pad.location && pad.location.name, 120),
    pad_country: s(pad.country && pad.country.alpha_3_code, 3),
    mission: s(m.name, 160), mission_type: s(m.type, 60),
    mission_description: s(m.description, 600),
    orbit: s(orbit.abbrev, 12),
    orbital: orbit.abbrev ? orbit.abbrev !== "Sub" : null,
    payloads,
    source_url: `${API}launches/${encodeURIComponent(id)}/`,
    source_last_updated: iso(r.last_updated),
    year_count: Number.isInteger(r.orbital_launch_attempt_count_year) ? r.orbital_launch_attempt_count_year : null,
  };
}

/** Validates one LL2 list page. Throws on anything that isn't {count:int, results:[...]}. */
export function checkPage(j, what) {
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error(`${what}: not a JSON object`);
  if (!Number.isInteger(j.count) || j.count < 0) throw new Error(`${what}: no count`);
  if (!Array.isArray(j.results)) throw new Error(`${what}: results is not an array`);
  return j;
}

/**
 * Pure snapshot builder. pastPages: the year's previous-launch pages in order; upcoming: one upcoming page.
 * Throws (so nothing is written) when pages are missing, rows don't add up to the API count, or rows fall
 * outside the UTC year (the net__lt filter is checked here rather than trusted).
 */
export function buildSnapshot({ year, pastPages, upcoming, providers = {}, payloadPage = null, fetchedAt, prev = null }) {
  const payloadMap = payloadPage ? payloadsByLaunch(payloadPage) : {};
  if (!Number.isInteger(year)) throw new Error("year missing");
  if (!Array.isArray(pastPages) || !pastPages.length) throw new Error("no past pages");
  pastPages.forEach((p, i) => checkPage(p, `past page ${i + 1}`));
  const count = pastPages[0].count;
  const expected = Math.max(1, Math.ceil(count / PAGE));
  if (pastPages.length < expected) throw new Error(`incomplete: ${pastPages.length} of ${expected} pages`);
  const lo = Date.UTC(year, 0, 1), hi = Date.UTC(year + 1, 0, 1);
  const byId = new Map();
  let skipped = 0, outside = 0, suborbital = 0;
  for (const raw of pastPages.flatMap((p) => p.results)) {
    const r = trimLaunch(raw, providers, payloadMap);
    if (!r) { skipped++; continue; }
    if (r.orbital === false) { suborbital++; continue; } // include_suborbital=false should already drop these
    const t = Date.parse(r.net);
    if (t < lo || t >= hi) { outside++; continue; }
    byId.set(r.id, r); // later pages win: an id repeated across pages (list shifted between calls) counts once
  }
  // Unreadable rows mean the feed changed shape (a renamed field): refuse rather than publish a short year.
  if (skipped > Math.max(2, count * 0.02)) throw new Error(`feed drift: ${skipped} of ${count} rows unreadable`);
  if (outside) throw new Error(`${outside} rows outside ${year} UTC: net filter not applied`);
  const launches = [...byId.values()].sort((a, b) => Date.parse(a.net) - Date.parse(b.net));
  if (launches.length + skipped + suborbital < count) throw new Error(`incomplete: ${launches.length + skipped} rows for count ${count} (list shifted between pages?)`);
  const noStatus = launches.filter((r) => r.status_id == null).length;
  if (noStatus > Math.max(2, count * 0.02)) throw new Error(`feed drift: ${noStatus} launches have no status id`);
  if (prev && prev.year === year && Array.isArray(prev.launches) && launches.length < prev.launches.length * 0.95)
    throw new Error(`count dropped from ${prev.launches.length} to ${launches.length}: keeping the old snapshot`);
  checkPage(upcoming, "upcoming page");
  const up = upcoming.results.map((x) => trimLaunch(x, providers, payloadMap)).filter((r) => r && !byId.has(r.id));
  const last = launches[launches.length - 1];
  return {
    schema: SCHEMA,
    source: { name: "Launch Library 2 (The Space Devs)", url: "https://thespacedevs.com/llapi", api: API },
    fetched_at: fetchedAt,
    year,
    definition: `Orbital launch attempt = Launch Library 2 launch with include_suborbital=false, NET in [${year}-01-01T00:00Z, ${year + 1}-01-01T00:00Z) UTC.`,
    pages: { expected, received: pastPages.length, count, rows: launches.length, skipped, suborbital },
    crosscheck: { ll2_orbital_launch_attempt_count_year: last ? last.year_count : null },
    launches,
    upcoming: up,
    // Upcoming can briefly repeat a launch that is already in the past pages; don't count it twice.
    upcoming_count: Math.max(0, upcoming.count - upcoming.results.filter((x) => x && byId.has(String(x.id))).length),
    // false when the payload-records call failed: the page then says the list is unavailable, not "none".
    payload_records: !!payloadPage,
  };
}

/** Same data, ignoring fetched_at: used to commit only when something changed (or the stamp is >6 h old). */
export function sameData(a, b) {
  if (!a || !b) return false;
  const strip = (x) => JSON.stringify({ ...x, fetched_at: null });
  return strip(a) === strip(b);
}

/** payload_flights page -> {launchId: ["Payload name", "Other (x3)"]}. Names only, as LL2 publishes them. */
export function payloadsByLaunch(page) {
  const out = {};
  for (const f of checkPage(page, "payload records").results) {
    const lid = f && f.launch && s(f.launch.id, 64), name = f && f.payload && s(f.payload.name, 120);
    if (!lid || !name) continue;
    const n = Number.isInteger(f.amount) && f.amount > 0 ? f.amount : 1;
    (out[lid] ||= {})[name] = (out[lid][name] || 0) + n;
  }
  for (const k of Object.keys(out)) out[k] = Object.entries(out[k]).map(([nm, n]) => (n > 1 ? `${nm} (x${n})` : nm));
  return out;
}

export function providerMap(pages) {
  const out = {};
  for (const p of pages) for (const a of checkPage(p, "agencies").results) {
    if (!a || !Number.isInteger(a.id)) continue;
    out[a.id] = { name: s(a.name, 120), countries: Array.isArray(a.country) ? a.country.map((c) => s(c && c.alpha_3_code, 3)).filter(Boolean) : [] };
  }
  return out;
}

// ---------- network (only when run as a script) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
async function getJson(url, tries = 2) {
  for (let i = 1; ; i++) {
    calls++;
    let res, err;
    try {
      res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(30000) });
    } catch (e) { err = e; }
    if (res && res.ok) return JSON.parse(await readCapped(res, MAX_RESPONSE_BYTES, url));
    const why = res ? `HTTP ${res.status}` : String(err && err.message);
    if (i >= tries || (res && res.status !== 429 && res.status < 500)) throw new Error(`${url}: ${why}`);
    const ra = res && Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra, 300) * 1000 : 60000;
    console.warn(`${why}; retrying in ${wait / 1000} s`);
    await sleep(wait);
  }
}
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

async function main() {
  const args = process.argv.slice(2);
  const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : "data";
  const year = args.includes("--year") ? Number(args[args.indexOf("--year") + 1]) : new Date().getUTCFullYear();
  const file = join(out, "launches.json");
  // Provider countries come from LL2 agency records, cached next to this script (the browser never needs them).
  const provFile = args.includes("--providers") ? args[args.indexOf("--providers") + 1] : new URL("./launch-providers.json", import.meta.url).pathname;
  const prev = readJson(file);
  let providers = readJson(provFile) || {};
  const fetchedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const pastPages = [await getJson(pastUrl(year, 0))];
  const expected = Math.ceil(checkPage(pastPages[0], "past page 1").count / PAGE);
  if (expected > MAX_PAGES) throw new Error(`${expected} pages needed; raise MAX_PAGES (rate limit is 15 calls/h)`);
  for (let i = 1; i < expected; i++) pastPages.push(await getJson(pastUrl(year, i * PAGE)));
  const upcoming = await getJson(upcomingUrl(year));
  let payloadPage = null;
  try { payloadPage = checkPage(await getJson(payloadsUrl(), 1), "payload records"); } catch (e) { console.warn(`payload records unavailable: ${e.message}`); }

  const ids = new Set([...pastPages, upcoming].flatMap((p) => p.results).map((r) => r && r.launch_service_provider && r.launch_service_provider.id).filter(Number.isInteger));
  if ([...ids].some((id) => !providers[id])) {
    const first = await getJson(agenciesUrl(0));
    const pages = [first];
    for (let o = 100; o < Math.min(first.count, 400); o += 100) pages.push(await getJson(agenciesUrl(o)));
    providers = { ...providers, ...providerMap(pages) };
    writeFileSync(provFile, JSON.stringify(providers, null, 0) + "\n");
  }

  const snap = buildSnapshot({ year, pastPages, upcoming, providers, payloadPage, fetchedAt, prev });
  // Year rollover: keep last year's final snapshot as data/launches-<year>.json for the year selector.
  if (prev && Number.isInteger(prev.year) && prev.year < year && !existsSync(join(out, `launches-${prev.year}.json`)))
    writeFileSync(join(out, `launches-${prev.year}.json`), JSON.stringify({ ...prev, upcoming: [], upcoming_count: null, archived: true }) + "\n");
  snap.archive_years = [...new Set([...(prev && Array.isArray(prev.archive_years) ? prev.archive_years : []), ...(prev && prev.year < year ? [prev.year] : [])])].sort();
  const stale = !prev || !prev.fetched_at || Date.now() - Date.parse(prev.fetched_at) > 6 * 3600e3;
  if (sameData(snap, prev) && !stale) { console.log(`unchanged (${snap.launches.length} launches, ${calls} calls)`); return; }
  mkdirSync(out, { recursive: true });
  writeFileSync(file, JSON.stringify(snap) + "\n");
  const t = snap.launches.reduce((a, r) => ((a[FINAL[r.status_id] || "other"] = (a[FINAL[r.status_id] || "other"] || 0) + 1), a), {});
  console.log(`wrote ${file}: ${snap.launches.length} launches ${JSON.stringify(t)}, LL2 running count ${snap.crosscheck.ll2_orbital_launch_attempt_count_year}, ${snap.upcoming.length} upcoming, ${calls} calls`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => { console.error(`launch snapshot NOT updated: ${e.message}`); process.exit(1); });
}
