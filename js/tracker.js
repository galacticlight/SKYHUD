// SKYHUD launch tracker: every orbital launch this year, who flew it, what it carried (where public) and how it
// went, with a year tally and a per-provider breakdown. Reads only the same-origin snapshot data/launches.json,
// which a scheduled GitHub Action refreshes from Launch Library 2 about every 2 hours: visitors' browsers never
// call LL2, so there is no third-party request and no CSP host for this card. Loaded by app.js only when this
// card comes near the screen.
import { $, esc, fmt, tz, tzLabel, state } from "./app.js";
import { SNAPSHOT_URL, archiveUrl, parseSnapshot, tally, tallyText, snapshotAge, whenText, natureText, payloadText,
  countryText, filterRows, NOT_FINAL, PAYLOAD_NONE } from "./launchdata.js";
import { countdown } from "./util.js";
import { every } from "./live.js";

const el = $("tracker");
const PAGE_ROWS = 40;
const LL2 = '<a href="https://thespacedevs.com/llapi" target="_blank" rel="noopener noreferrer">Launch Library 2</a> by The Space Devs (thespacedevs.com)';
const snaps = {}; // year -> parsed snapshot
let view = { year: null, provider: "", outcome: "", shown: PAGE_ROWS }, loadErr = null, current = null;

async function getSnap(url) {
  // no-cache: revalidate with the server so a new snapshot shows; the service worker falls back to its saved
  // copy when offline, and the stamp below then shows how old it is.
  const r = await fetch(url, { cache: "no-cache", credentials: "same-origin" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseSnapshot(await r.json());
}

async function refresh() {
  try {
    current = await getSnap(SNAPSHOT_URL);
    snaps[current.year] = current;
    loadErr = null;
    if (view.year == null) view.year = current.year;
  } catch (e) {
    loadErr = String(e.message || e);
  }
}

const stamp = (t) => `${esc(fmt(new Date(t), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))} ${tzLabel()}`;
const utcDay = (t) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(t));
const OUT_CLASS = { Success: "ok", Failure: "bad", "Partial failure": "part" };

/** Horizontal stacked bars for the top providers (decorative: the table has the same numbers). */
function providerBars(list) {
  const top = list.slice(0, 10), max = Math.max(1, ...top.map((p) => p.total));
  const W = 400, row = 20, L = 150, H = top.length * row;
  const x = (n) => (n / max) * (W - L - 30);
  const short = (n) => (n.length > 26 ? `${n.slice(0, 25)}…` : n);
  const bars = top.map((p, i) => {
    let at = L;
    const seg = (n, cls) => { if (!n) return ""; const w = Math.max(1.5, x(n)); const s = `<rect class="${cls}" x="${at.toFixed(1)}" y="${i * row + 4}" width="${w.toFixed(1)}" height="${row - 8}"/>`; at += w; return s; };
    return `<text class="tk" x="${L - 6}" y="${i * row + 14}" text-anchor="end">${esc(short(p.provider))}</text>`
      + seg(p.success, "lt-ok") + seg(p.partial, "lt-part") + seg(p.failure, "lt-bad") + seg(p.pending, "lt-pend")
      + `<text class="tk" x="${(at + 4).toFixed(1)}" y="${i * row + 14}">${p.total}</text>`;
  }).join("");
  return `<svg class="viz lt-bars" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">${bars}</svg>`;
}

function providerTable(T) {
  return `<div class="scroll-x" tabindex="0" role="region" aria-label="Launches by provider table"><table><caption>${T.year} orbital launches by provider${T.complete ? "" : " (incomplete: lower bounds)"}</caption>
    <thead><tr><th scope="col">Provider</th><th scope="col">Country</th><th scope="col">Launches</th><th scope="col">Success</th><th scope="col">Failure</th><th scope="col">Partial</th><th scope="col">Awaiting</th></tr></thead><tbody>
    ${T.byProvider.map((p) => `<tr><th scope="row">${esc(p.provider)}</th><td>${esc(countryText(p.country))}</td><td>${p.total}</td><td>${p.success}</td><td>${p.failure}</td><td>${p.partial}</td><td>${p.pending}</td></tr>`).join("")}</tbody></table></div>`;
}

function launchRow(r, snap) {
  const w = whenText(r, tz());
  const out = `<span class="lt-out ${OUT_CLASS[r.outcome] || "pend"}">${esc(r.outcome)}</span>${r.failreason && r.outcome !== "Success" ? `<br><span class="fine">${esc(r.failreason)}</span>` : ""}`;
  const about = r.description ? `<details><summary>About ${esc(r.name.split(" | ").slice(1).join(" | ") || "this mission")}</summary><p class="fine">${esc(r.description)}</p></details>` : '<span class="muted">No description listed</span>';
  return `<tr><th scope="row">${esc(r.name)}</th><td>${esc(w.utc)}${w.local && !state.utc ? `<br><span class="fine">${esc(w.local)}</span>` : ""}</td>
    <td>${esc(r.provider)}<br><span class="fine">${esc(countryText(r.providerCountry))}; ${esc(r.vehicle)}</span></td>
    <td>${esc(natureText(r))}${r.location ? `<br><span class="fine">${esc(r.location)}</span>` : ""}</td>
    <td>${esc(payloadText(r, snap.payloadRecords))}</td><td>${out}</td><td>${about}</td></tr>`;
}

function upcomingList(snap) {
  if (snap.archived || !snap.upcoming.length) return "";
  const rows = snap.upcoming.slice(0, 5).map((r) => {
    const w = whenText(r, tz());
    return `<li><strong>${esc(r.name)}</strong> <span class="fine">${esc(r.provider)}; ${esc(r.vehicle)}</span><br>${esc(w.utc)}${w.local && !state.utc ? ` <span class="fine">(${esc(w.local)})</span>` : ""}; status ${esc(r.statusText || "not listed")}</li>`;
  }).join("");
  return `<h3>Next on Launch Library 2's schedule</h3><ul class="launch-list">${rows}</ul>
    <p class="fine">From the same snapshot (as of ${stamp(snap.fetchedAt)}), not live. The separate "Rocket launches" card uses RocketLaunch.Live, so its times can differ from these.</p>`;
}

export function render(now = Date.now()) {
  if (!current && loadErr) {
    el.innerHTML = `<p class="warn"><strong>Launch data unavailable</strong> (snapshot missing or unreadable). Nothing is counted rather than showing a total that might be wrong.</p>`;
    return;
  }
  if (!current) return;
  const snap = snaps[view.year] || current;
  const T = tally(snap, view.year);
  const age = snapshotAge(snap.fetchedAt, now);
  const warn = snap.archived ? "" : age === "stale" ? `<strong class="warn">Stale:</strong> this snapshot is ${countdown(now - snap.fetchedAt, false)} old; the scheduled update may be delayed. `
    : age === "future" ? '<strong class="warn">Time unclear:</strong> the snapshot is stamped ahead of this device\'s clock. ' : "";
  const offline = loadErr ? '<strong class="warn">Saved copy:</strong> the latest snapshot did not load. ' : "";
  const range = T.first != null ? `Counted: launches with a final outcome from ${utcDay(T.first)} to ${utcDay(T.last)} (UTC dates).` : "No launches with a final outcome yet.";
  const years = [current.year, ...current.archiveYears.slice().sort((a, b) => b - a)];
  const provs = T.byProvider.map((p) => p.provider);
  const rows = filterRows(snap.launches, view).sort((a, b) => b.t - a.t);
  const shown = rows.slice(0, view.shown);
  el.innerHTML = `<div class="lt-controls">
      <label>Year <select id="lt-year">${years.map((y) => `<option value="${y}"${y === view.year ? " selected" : ""}>${y}</option>`).join("")}</select></label>
    </div>
    <p class="lt-tally"><strong>${esc(tallyText(T))}</strong></p>
    <p class="fine">${range} Counted by UTC year: orbital launch attempts only. Success, failure and partial failure come from Launch Library 2's status; anything else (in flight, awaiting confirmation) is never counted as a success.${T.complete ? "" : ' <strong class="warn">Incomplete:</strong> part of the year\'s data did not arrive, so these are lower bounds.'}</p>
    <p class="stamp">${offline}${warn}Data: ${LL2}; snapshot as of ${stamp(snap.fetchedAt)}${snap.archived ? " (final for the year)" : ""}.</p>
    <h3>By provider</h3>
    ${T.byProvider.length ? `<p>${T.byProvider.length} provider${T.byProvider.length === 1 ? "" : "s"}. Most launches: ${T.byProvider.slice(0, 3).map((p) => `${esc(p.provider)} ${p.total}`).join(", ")}.</p>
    ${providerBars(T.byProvider)}<p class="fine">Chart: top ${Math.min(10, T.byProvider.length)} providers; solid = success, lighter = partial failure, outlined = failure, dashed = awaiting outcome. Every provider's numbers are in the table.</p>
    <details><summary>All ${T.byProvider.length} providers as a table</summary>${providerTable(T)}</details>` : '<p class="muted">No launches in this year.</p>'}
    <h3>Launches</h3>
    <div class="lt-controls">
      <label>Provider <select id="lt-prov"><option value="">All providers</option>${provs.map((p) => `<option${p === view.provider ? " selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
      <label>Outcome <select id="lt-out"><option value="">All outcomes</option>${["Success", "Failure", "Partial failure", NOT_FINAL].map((o) => `<option${o === view.outcome ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></label>
    </div>
    <p class="fine" role="status" aria-live="polite">${rows.length ? `Showing ${shown.length} of ${rows.length} launch${rows.length === 1 ? "" : "es"}, newest first.` : "No launches match these filters."}</p>
    ${rows.length ? `<div class="scroll-x lt-list" tabindex="0" role="region" aria-label="Launch list table"><table><caption>${view.year} orbital launches${view.provider ? ` by ${esc(view.provider)}` : ""}${view.outcome ? `: ${esc(view.outcome)}` : ""}</caption>
      <thead><tr><th scope="col">Launch</th><th scope="col">Time</th><th scope="col">Provider, country, vehicle</th><th scope="col">Nature</th><th scope="col">Payloads</th><th scope="col">Outcome</th><th scope="col">Mission</th></tr></thead>
      <tbody>${shown.map((r) => launchRow(r, snap)).join("")}</tbody></table></div>` : ""}
    ${rows.length > shown.length ? `<button type="button" class="chip" id="lt-more">Show ${Math.min(PAGE_ROWS, rows.length - shown.length)} more</button>` : ""}
    <p class="fine">Payloads come from Launch Library 2's structured payload records, which itemise payloads for only some launches. Elsewhere the payload shows as "${PAYLOAD_NONE}": that means only that LL2 has no payload record for the launch, not that the payload is secret, and the mission text is the best public description. Nothing is guessed.</p>
    ${view.year === current.year ? upcomingList(current) : ""}
    <p class="fine">Counts can differ slightly between trackers. Jonathan McDowell's GCAT, for example, is 2 higher for 2026 because it counts SpaceX Starship flights (May 22 and Jul 24) as orbital; Launch Library 2 lists them as suborbital.</p>`;
}

function onChange(e) {
  const t = e.target;
  if (t.id === "lt-year") {
    const y = Number(t.value);
    view = { ...view, year: y, provider: "", outcome: "", shown: PAGE_ROWS };
    if (!snaps[y]) {
      el.setAttribute("aria-busy", "true");
      getSnap(archiveUrl(y)).then((s) => { snaps[y] = s; }).catch(() => { view.year = current.year; loadErr = `The ${y} archive did not load.`; })
        .finally(() => { el.removeAttribute("aria-busy"); render(); $("lt-year")?.focus(); });
      return;
    }
  } else if (t.id === "lt-prov") view = { ...view, provider: t.value, shown: PAGE_ROWS };
  else if (t.id === "lt-out") view = { ...view, outcome: t.value, shown: PAGE_ROWS };
  else return;
  render();
  $(t.id)?.focus();
}

let started = false;
export function start() {
  if (started) return;
  started = true;
  el.addEventListener("change", onChange);
  el.addEventListener("click", (e) => {
    if (e.target.id !== "lt-more") return;
    view.shown += PAGE_ROWS;
    const before = view.shown - PAGE_ROWS;
    render();
    // Keep keyboard focus in the list: move to the first newly shown row's header.
    el.querySelectorAll(".lt-list tbody th")[before]?.setAttribute("tabindex", "-1");
    el.querySelectorAll(".lt-list tbody th")[before]?.focus();
  });
  // Re-render when the page switches between local time and UTC.
  $("tz-btn")?.addEventListener("click", () => setTimeout(() => render(), 0));
  // Load once now (even with live updates paused: it is one same-origin file), then re-check every 30 minutes
  // while the card is on screen; the snapshot itself changes at most every 2 hours.
  refresh().then(() => render());
  every("tracker", 30 * 60e3, async () => { await refresh(); render(); }, { el, reducedMs: 30 * 60e3, immediate: false });
}
