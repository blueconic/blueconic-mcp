import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// npm version bumps package.json (and package-lock.json) but has no idea manifest.json also
// carries a version, so a release built right after "npm version patch" used to pack a .mcpb
// whose MCPB manifest still reported the previous version. Runs as the "version" lifecycle
// script, which fires after npm has written the new package.json version but before it commits
// and tags - so the manifest.json update in this script lands in that same version commit.

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const manifestFile = resolve(repoRoot, "manifest.json");
const packageFile = resolve(repoRoot, "package.json");

const [manifestSource, packageSource] = await Promise.all([
  readFile(manifestFile, "utf8"),
  readFile(packageFile, "utf8")
]);

const { version } = JSON.parse(packageSource);
if (!version) {
  throw new Error("package.json has no version to sync into manifest.json");
}

// A targeted line replacement, not a JSON.parse/stringify round trip, so every other field in
// manifest.json keeps its exact formatting.
const versionLine = /^( +)"version": "[^"]*",?$/m;
if (!versionLine.test(manifestSource)) {
  throw new Error("manifest.json has no top-level \"version\" field to update");
}

const updated = manifestSource.replace(versionLine, (match, indent) => `${indent}"version": "${version}",`);

if (updated === manifestSource) {
  console.error(`manifest.json version is already ${version}`);
} else {
  await writeFile(manifestFile, updated);
  console.error(`Synced manifest.json version to ${version}`);
}
