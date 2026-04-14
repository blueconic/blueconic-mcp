import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const bundleOutputFile = resolve(repoRoot, "server", "index.mjs");
const mcpbIgnoreFile = resolve(repoRoot, ".mcpbignore");

const [bundleSource, mcpbIgnore] = await Promise.all([
  readFile(bundleOutputFile, "utf8"),
  readFile(mcpbIgnoreFile, "utf8")
]);

if (bundleSource.includes("Dynamic require of")) {
  throw new Error("Claude Desktop bundle contains a dynamic require shim and may fail under ESM");
}

const ignoredLines = mcpbIgnore
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));

if (ignoredLines.includes("package.json")) {
  throw new Error(".mcpbignore excludes package.json, but the Claude Desktop runtime reads it at startup");
}

const startupResult = spawnSync(process.execPath, [bundleOutputFile], {
  cwd: repoRoot,
  env: {
    ...process.env,
    BLUECONIC_TENANT_URL: "",
    OAUTH_CLIENT_ID: "",
    OAUTH_CLIENT_SECRET: ""
  },
  encoding: "utf8"
});

if (startupResult.error) {
  throw startupResult.error;
}

const startupOutput = `${startupResult.stdout}${startupResult.stderr}`;

if (startupResult.status !== 1) {
  throw new Error(
    `Expected bundle startup without credentials to exit with status 1, received ${startupResult.status}`
  );
}

if (!startupOutput.includes("Missing required environment variables")) {
  throw new Error(
    "Bundle startup did not reach the expected credential validation path. Check server/index.mjs output."
  );
}

console.error("Verified Claude Desktop bundle startup and packaging regression checks");
