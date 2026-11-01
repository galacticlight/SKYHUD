// Copies only the files the site serves into a directory for GitHub Pages (used by .github/workflows/pages.yml).
// Today's branch deploy serves the whole repository; the site's own files below are served unchanged, byte for
// byte, and the repository-only files (tests, scripts, workflows, docs, package files) are left out.
// Every tracked file must be listed in SITE or REPO_ONLY, so a new file can't be published or dropped by accident
// (tests/site.test.mjs checks this).
//
// Usage: node scripts/build-site.mjs [outDir=_site]
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Served paths: files, or directories (trailing "/") copied whole. */
export const SITE = [
  "index.html", "404.html", "styles.css", "sw.js", "manifest.webmanifest", "favicon.svg", "catalog.tle", "LICENSE",
  "icons/", "js/", "vendor/", "data/",
];
/** Tracked paths that are never published. ".nojekyll" only matters for branch deploys (artifact deploys skip Jekyll). */
export const REPO_ONLY = [".github/", ".nojekyll", "README.md", "docs/", "package.json", "package-lock.json", "scripts/", "tests/"];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every file (relative path) the site serves from `root`. */
export function siteFiles(root = ROOT) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = `${rel}${e.name}`;
      if (e.isDirectory()) walk(`${r}/`); else out.push(r);
    }
  };
  for (const p of SITE) {
    if (!existsSync(join(root, p))) throw new Error(`build-site: ${p} is missing`);
    if (p.endsWith("/")) walk(p); else out.push(p);
  }
  return out.sort();
}

export function buildSite(outDir, root = ROOT) {
  const out = resolve(outDir);
  if (out === resolve(root)) throw new Error("build-site: refusing to write into the repository root");
  rmSync(out, { recursive: true, force: true });
  const files = siteFiles(root);
  for (const f of files) {
    mkdirSync(dirname(join(out, f)), { recursive: true });
    cpSync(join(root, f), join(out, f));
  }
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || "_site";
  const files = buildSite(dir);
  const bytes = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  console.log(`build-site: ${files.length} files, ${bytes} bytes -> ${dir}`);
}
