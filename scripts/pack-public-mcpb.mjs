import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const distDir = resolve(repoRoot, "dist");
const bundleDir = resolve(repoRoot, "public-mcp");
const manifestPath = resolve(bundleDir, "manifest.json");

// This bundle carries its own version. It tracks the tenant servlet rather
// than the npm package, so the two release cadences stay apart.
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const outputFile = resolve(distDir, `blueconic-public-mcp-${manifest.version}.mcpb`);

await rm(outputFile, { force: true });

const packResult = spawnSync("mcpb", ["pack", bundleDir, outputFile], {
  cwd: repoRoot,
  stdio: "inherit"
});

if (packResult.error) {
  throw packResult.error;
}

if (packResult.status !== 0) {
  process.exit(packResult.status ?? 1);
}
