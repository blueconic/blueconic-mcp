import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * The public MCP bundle must not exit when it is misconfigured, which is the
 * opposite of what check-mcpb-bundle.mjs asserts for the REST connector.
 *
 * The reason is the host. Claude Desktop starts an extension as soon as it is
 * installed, before anybody has filled in the settings, and probes it before
 * anybody asks it anything. A server that exits during that probe is reported
 * as "the connection closed during the server/discover probe", which names
 * neither the missing setting nor the unreachable tenant. So this bundle
 * answers the handshake and reports the reason in the next answer instead.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const bundleOutputFile = resolve(repoRoot, "public-mcp", "server", "index.mjs");

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check", version: "1" } }
};
const TOOLS_LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };

const child = spawn(process.execPath, [bundleOutputFile], {
  cwd: repoRoot,
  env: { ...process.env, BLUECONIC_TENANT_URL: "", OAUTH_CLIENT_ID: "", OAUTH_CLIENT_SECRET: "" },
  stdio: ["pipe", "pipe", "pipe"]
});

const answers = [];
let exited = false;
let buffer = "";

child.stdout.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (line.trim().length > 0) {
      answers.push(JSON.parse(line));
    }
  }
});
child.on("exit", () => {
  exited = true;
});

child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
await new Promise((done) => setTimeout(done, 500));
child.stdin.write(`${JSON.stringify(TOOLS_LIST)}\n`);
await new Promise((done) => setTimeout(done, 500));

if (exited) {
  throw new Error("The bundle exited while it was misconfigured. A host reports that as a closed connection.");
}

const handshake = answers.find((answer) => answer.id === 0);
if (!handshake?.result?.protocolVersion) {
  throw new Error("The bundle did not answer the handshake while it was misconfigured");
}

const toolsList = answers.find((answer) => answer.id === 1);
if (!toolsList?.error?.message?.includes("tenant URL")) {
  throw new Error("The bundle did not report the missing tenant URL as the reason it cannot answer");
}

child.kill();
console.error("Public MCP bundle stays up when misconfigured, and names the setting to fill in.");
