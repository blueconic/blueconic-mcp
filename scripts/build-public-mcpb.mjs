import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const bundleDir = resolve(repoRoot, "public-mcp");
const serverOutputDir = resolve(bundleDir, "server");
const bundleEntryPoint = resolve(repoRoot, "src", "public-server-entry.ts");
const bundleOutputFile = resolve(serverOutputDir, "index.mjs");
const distDir = resolve(repoRoot, "dist");

await rm(serverOutputDir, { recursive: true, force: true });
await mkdir(serverOutputDir, { recursive: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [bundleEntryPoint],
  outfile: bundleOutputFile,
  bundle: true,
  format: "esm",
  legalComments: "none",
  minify: true,
  platform: "node",
  sourcemap: false,
  target: "node18"
});

// The bundle directory is packed on its own, so the icon the manifest names
// has to sit beside that manifest rather than at the repository root.
for (const icon of ["icon.png", "icon-dark.png"]) {
  await copyFile(resolve(repoRoot, icon), resolve(bundleDir, icon));
}

const bundleStats = await stat(bundleOutputFile);
console.error(`Built the public MCP entry point at public-mcp/server/index.mjs (${bundleStats.size} bytes)`);
