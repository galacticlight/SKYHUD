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
  assert.match(build, /ref: \$\{\{ inputs\.ref \}\}/);
  assert.match(build, /persist-credentials: false/);
  assert.match(build, /node scripts\/build-site\.mjs _site\n/);
  assert.match(build, /upload-pages-artifact@\w+ # v[\d.]+\n        with:\n          path: _site$/);
  assert.match(check, /gh api "repos\/\$REPO\/pages" --jq \.build_type/);
  assert.match(check, /else cat err\.txt >&2; exit 1; fi/, "an unexpected API error fails loudly");
  assert.doesNotMatch(pages, /contents: write/);
});

test("launches.yml deploys its own data commit through pages.yml", () => {
  const deploy = job(launches, "deploy");
  assert.match(deploy, /needs: update\n    if: needs\.update\.outputs\.pushed == 'true'/);
  assert.match(deploy, /uses: \.\/\.github\/workflows\/pages\.yml\n    with:\n      ref: \$\{\{ needs\.update\.outputs\.sha \}\}/);
  assert.match(deploy, /permissions:\n      contents: read\n      pages: write\n      id-token: write/);
  assert.match(launches, /echo "sha=\$\(git rev-parse HEAD\)" >> "\$GITHUB_OUTPUT"/);
  assert.match(launches, /echo "pushed=false" >> "\$GITHUB_OUTPUT"; exit 0/);
});

test("launches.yml pushes fast-forward only: no pull, rebase, merge, force or fallback", () => {
  const pushes = [...launches.matchAll(/^\s*(?:git\b.*\s)?push\b.*$/gm)].map((m) => m[0].trim());
  assert.equal(pushes.length, 1, pushes.join(" | "));
  assert.match(pushes[0], /^git (-c "[^"]+" )?push origin HEAD:main$/);
  assert.doesNotMatch(launches, /git (pull|rebase|merge|fetch)\b|--force|\s-f\s|\+HEAD|\|\|/);
});
