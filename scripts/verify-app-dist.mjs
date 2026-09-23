#!/usr/bin/env node
// Fail-fast guard for release workflows that bundle the app (e.g. the Android
// APK job): Metro resolves workspace packages to their dist/ outputs, so a
// missing build only surfaces after tens of minutes inside Gradle. This check
// runs right after the workspace builds and fails in seconds instead.
//
// The package set is derived from packages/app dependencies, so it cannot
// drift when the app gains or drops a workspace dependency.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appManifest = JSON.parse(
  readFileSync(join(rootDir, "packages", "app", "package.json"), "utf8"),
);
const packages = Object.keys(appManifest.dependencies ?? {})
  .filter((name) => name.startsWith("@getpaseo/"))
  .map((name) => name.slice("@getpaseo/".length));

function isFileTarget(value) {
  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    /^(dist|build|src|lib|out)\//.test(value)
  );
}

function collectDistTargets(value, into) {
  if (typeof value === "string") {
    if (isFileTarget(value)) into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectDistTargets(entry, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectDistTargets(entry, into);
  }
}

let missing = [];
for (const name of packages) {
  const packageDir = join(rootDir, "packages", name);
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const targets = new Set();
  collectDistTargets(manifest.exports, targets);
  collectDistTargets(manifest.main, targets);
  for (const target of targets) {
    if (target.includes("*")) {
      // "./dist/*.js" style patterns stand for per-module outputs.
      const dir = join(packageDir, dirname(target));
      const extension = target.slice(target.lastIndexOf("."));
      const present =
        existsSync(dir) && readdirSync(dir).some((entry) => entry.endsWith(extension));
      if (!present) missing.push(`${name}: ${target}`);
      continue;
    }
    if (!existsSync(join(packageDir, target))) missing.push(`${name}: ${target}`);
  }
}

if (missing.length > 0) {
  for (const entry of missing) console.error(`::error::Missing app bundle input: ${entry}`);
  console.error(
    "Workspace dist outputs are missing. Run the app workspace builds (npm run build:app-deps) before bundling.",
  );
  process.exit(1);
}
console.log(`App bundle inputs present for: ${packages.join(", ")}`);
