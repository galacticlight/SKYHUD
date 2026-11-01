// Static checks on the GitHub Actions workflows (QA v9): pinned actions, Pages deploy wiring, safe pushes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wf = (f) => readFileSync(new URL(`../.github/workflows/${f}`, import.meta.url), "utf8");
const pages = wf("pages.yml"), launches = wf("launches.yml");
/** The text of one top-level job (from "  name:" to the next two-space key). */
const job = (src, name) => { const m = src.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [\\w-]+:\\n|$)`)); assert.ok(m, `job ${name}`); return m[1]; };

// Verified with `git ls-remote --tags https://github.com/<repo>` on 2026-11-01.
const PINS = {
  "actions/checkout": ["3d3c42e5aac5ba805825da76410c181273ba90b1", "v7.0.1"],
  "actions/setup-node": ["949feb2413d6458794dcd2491c4babbbce0c15c1", "v7.1.0"],
  "actions/upload-pages-artifact": ["fc324d3547104276b827a68afc52ff2a11cc49c9", "v5.0.0"],
  "actions/deploy-pages": ["368f82528645a54fb793d4d04e342629a3f51346", "v5.0.1"],
};

test("every action is pinned to the verified commit SHA of its tag", () => {
  for (const [f, src] of [["pages.yml", pages], ["launches.yml", launches]]) {
    for (const m of src.matchAll(/uses:\s*([^\s#]+)(?:\s*#\s*(\S+))?/g)) {
      const [ref, tag] = [m[1], m[2]];
      if (ref.startsWith("./")) continue;
      const [repo, sha] = ref.split("@");
      assert.ok(PINS[repo], `${f}: unexpected action ${repo}`);
      assert.equal(sha, PINS[repo][0], `${f}: ${repo} pin`);
      assert.equal(tag, PINS[repo][1], `${f}: ${repo} tag comment`);
    }
  }
});

test("pages.yml: triggers, permissions, environment, concurrency, site-only artifact", () => {
  assert.match(pages, /\non:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\n  workflow_call:/);
  assert.match(pages, /\npermissions:\n  contents: read\n/);
  const deploy = job(pages, "deploy"), build = job(pages, "build"), check = job(pages, "check");
  assert.match(deploy, /permissions:\n      pages: write\n      id-token: write\n/);
  assert.match(deploy, /environment:\n      name: github-pages/);
  assert.match(deploy, /concurrency:\n      group: pages\n      cancel-in-progress: false/);
  assert.match(deploy, /needs: build/);
  assert.match(build, /if: needs\.check\.outputs\.source == 'workflow'/);
  assert.match(build, /ref: refs\/heads\/main #/);
  assert.match(build, /persist-credentials: false/);
  assert.match(build, /node scripts\/build-site\.mjs _site\n/);
  assert.match(build, /upload-pages-artifact@\w+ # v[\d.]+\n        with:\n          path: _site$/);
  assert.match(check, /gh api "repos\/\$REPO\/pages" --jq \.build_type/);
  assert.match(check, /else cat err\.txt >&2; exit 1; fi/, "an unexpected API error fails loudly");
  assert.doesNotMatch(pages, /contents: write/);
});

test("launches.yml deploys through pages.yml after a data commit", () => {
  const deploy = job(launches, "deploy");
  assert.match(deploy, /needs: update\n    if: needs\.update\.outputs\.pushed == 'true'/);
  assert.match(deploy, /\n    uses: \.\/\.github\/workflows\/pages\.yml$/);
  assert.match(deploy, /permissions:\n      contents: read\n      pages: write\n      id-token: write/);
  assert.match(launches, /pushed: \$\{\{ steps\.push\.outputs\.pushed \}\}/);
});

test("launches.yml pushes fast-forward only: no pull, rebase, merge, force or fallback", () => {
  const pushes = [...launches.matchAll(/^\s*(?:git\b.*\s)?push\b.*$/gm)].map((m) => m[0].trim());
  assert.equal(pushes.length, 1, pushes.join(" | "));
  assert.match(pushes[0], /^git (-c "[^"]+" )?push origin HEAD:main$/);
  assert.doesNotMatch(launches, /git (pull|rebase|merge|fetch)\b|--force|\s-f\s|\+HEAD|\|\|/);
});

test("launches.yml re-enables itself at the end of every run (60-day auto-disable)", () => {
  const keep = job(launches, "keep-enabled");
  assert.match(keep, /needs: \[update, deploy\]\n    if: always\(\)/);
  assert.match(keep, /permissions:\n      actions: write\n    steps:/);
  assert.match(keep, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(keep, /run: gh api -X PUT "repos\/\$REPO\/actions\/workflows\/launches\.yml\/enable"/);
  assert.match(keep, /REPO: \$\{\{ github\.repository \}\}/);
  assert.ok(launches.trimEnd().endsWith('launches.yml/enable"'), "it is the final step");
  // Only this job may write to Actions.
  assert.equal([...launches.matchAll(/actions: write/g)].length, 1);
});

test("launches.yml: no persisted credentials; only the push step gets the token, contents: write only on update", () => {
  assert.match(launches, /persist-credentials: false/);
  assert.doesNotMatch(launches, /persist-credentials: true/);
  assert.match(launches, /\npermissions:\n  contents: read\n/);
  assert.match(job(launches, "update"), /permissions:\n      contents: write/);
  assert.equal([...launches.matchAll(/contents: write/g)].length, 1);
  // Steps of the update job, split on "- name:" / "- uses:".
  const steps = job(launches, "update").split(/\n      - /).slice(1);
  const withToken = steps.filter((st) => /github\.token|secrets\.GITHUB_TOKEN|GH_TOKEN/.test(st));
  assert.equal(withToken.length, 1);
  assert.match(withToken[0], /^name: Push \(fast-forward only\)/);
  assert.match(withToken[0], /if: steps\.commit\.outputs\.changed == 'true'/);
  assert.match(withToken[0], /echo "::add-mask::\$auth"/);
  assert.match(withToken[0], /git -c "http\.https:\/\/github\.com\/\.extraheader=AUTHORIZATION: basic \$auth" push origin HEAD:main/);
  assert.doesNotMatch(withToken[0], /git config/, "the header is never written to .git/config");
  assert.doesNotMatch(steps.find((st) => st.startsWith("name: Fetch")), /token/i);
});

test("both workflows act only on main (a manual run from another branch can't push to or deploy main)", () => {
  const GUARD = "if: github.ref == 'refs/heads/main'";
  assert.match(job(launches, "update"), new RegExp(`^    #[^\\n]*\\n    ${GUARD.replace(/[.()]/g, "\\$&")}\\n`));
  assert.match(job(pages, "check"), new RegExp(`\\n    ${GUARD.replace(/[.()]/g, "\\$&")}\\n`));
  // build needs check (skipped off main => build skipped) and deploy needs build.
  assert.match(job(pages, "build"), /needs: check\n    if: needs\.check\.outputs\.source == 'workflow'/);
  assert.match(job(pages, "deploy"), /needs: build/);
  // The guard is on the job that pushes, and deploy only follows a push.
  assert.match(job(launches, "deploy"), /needs: update\n    if: needs\.update\.outputs\.pushed == 'true'/);
  // Paths that must keep working on main: push to main, manual dispatch, and the call from launches.yml.
  assert.match(pages, /\non:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\n  workflow_call:/);
  assert.equal([...pages.matchAll(/github\.ref\b/g)].length, 2, "guard + its comment only; no other ref logic");
});

test("deploys are ordered: one pages.yml run at a time, never cancelled mid-flight, each building the current main", () => {
  // Workflow-level group spans check, build and deploy, for every trigger including the call from launches.yml.
  assert.match(pages, /\nconcurrency:\n  group: pages-site\n  cancel-in-progress: false\n/);
  assert.doesNotMatch(pages, /cancel-in-progress: true/);
  assert.doesNotMatch(launches, /cancel-in-progress: true/);
  // Static name, different from the caller's own group (a shared group deadlocks a called workflow).
  assert.doesNotMatch(pages, /group: .*github\.workflow/);
  assert.match(launches, /\nconcurrency:\n  group: launch-data\n/);
  // The build ships the tip of main, not the commit that triggered the run, so an older run can't roll back.
  const build = job(pages, "build");
  assert.match(build, /actions\/checkout@\w+ # v[\d.]+\n        with:\n          ref: refs\/heads\/main #/);
  assert.doesNotMatch(pages, /inputs\.ref|github\.sha/);
  assert.doesNotMatch(launches, /outputs\.sha|rev-parse/);
});

test("pages.yml build and deploy run only after their needs succeed (no always(), failure() or cancelled())", () => {
  // An `if:` without a status function implies success(), so a skipped check (off main, or source not
  // "GitHub Actions") skips build, and a skipped or failed build skips deploy.
  assert.doesNotMatch(pages, /\b(always|failure|cancelled)\(\)/);
  assert.doesNotMatch(job(pages, "deploy"), /^    if:/m, "deploy has no condition of its own; it follows build");
  assert.equal([...job(pages, "build").matchAll(/^    if:/gm)].length, 1);
  // The one always() in launches.yml is keep-enabled, which must run even after a failed update.
  assert.equal([...launches.matchAll(/\b(always|failure|cancelled)\(\)/g)].length, 1);
  assert.match(job(launches, "keep-enabled"), /\n    if: always\(\)\n/);
});

test("the main-only guard's limits and the settings that make it hard are documented", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  for (const s of [launches, readme]) {
    assert.match(s, /github-pages[\s\S]{0,40}environment[\s\S]{0,80}deployment branches[\s\S]{0,40}main only|`github-pages` environment's deployment branches to `main` only/);
    assert.match(s, /ruleset[\s\S]{0,80}force[\s#]+pushes and deletion/);
    assert.match(s, /pull requests[\s\S]{0,80}(also block|block the bot's data push)/);
  }
});
