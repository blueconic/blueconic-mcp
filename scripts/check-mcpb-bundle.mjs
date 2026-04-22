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

if (bundleSource.includes("BLUECONIC_MCP_DEBUG")) {
  throw new Error("Claude Desktop bundle still references the removed BLUECONIC_MCP_DEBUG escape hatch");
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

if (!startupOutput.includes("requires configuration before it can be used")) {
  throw new Error(
    "Bundle startup did not reach the expected credential validation path. Check server/index.mjs output."
  );
}

for (const forbiddenSnippet of [
  "tenant1.blueconic.net",
  "your_client_id",
  "your_client_secret",
  "NODE_TLS_REJECT_UNAUTHORIZED=0"
]) {
  if (startupOutput.includes(forbiddenSnippet)) {
    throw new Error(
      `Bundle startup leaked configuration guidance details (${forbiddenSnippet}) that should stay out of user-facing error output`
    );
  }
}

const insecureTlsResult = spawnSync(process.execPath, [bundleOutputFile], {
  cwd: repoRoot,
  env: {
    ...process.env,
    BLUECONIC_TENANT_URL: "",
    OAUTH_CLIENT_ID: "",
    OAUTH_CLIENT_SECRET: "",
    NODE_TLS_REJECT_UNAUTHORIZED: "0"
  },
  encoding: "utf8"
});

if (insecureTlsResult.error) {
  throw insecureTlsResult.error;
}

const insecureTlsOutput = `${insecureTlsResult.stdout}${insecureTlsResult.stderr}`;

if (insecureTlsResult.status !== 1) {
  throw new Error(
    `Expected bundle startup with insecure TLS disabled to exit with status 1, received ${insecureTlsResult.status}`
  );
}

if (!insecureTlsOutput.includes("requires standard TLS certificate verification")) {
  throw new Error(
    "Bundle startup did not reject insecure TLS configuration as expected. Check server/index.mjs output."
  );
}

if (insecureTlsOutput.includes("NODE_TLS_REJECT_UNAUTHORIZED")) {
  throw new Error("Bundle startup leaked the insecure TLS override variable name in user-facing output");
}

console.error("Verified Claude Desktop bundle startup and packaging regression checks");
