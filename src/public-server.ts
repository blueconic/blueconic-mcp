/**
 * Bridge to the MCP server that runs inside a BlueConic tenant, at
 * `https://<tenant>/mcp`.
 *
 * Claude Desktop starts a local server over stdio and cannot send a custom
 * header to a remote one, and the MCPB format has no remote server type. So
 * this file is the local half: it reads a JSON-RPC message from standard
 * input, posts it to the tenant with the credentials, and writes the answer
 * back out.
 *
 * The one rule this file exists to keep: it never exits on a problem. A host
 * starts the server before the person has filled in the settings, and probes
 * it before anybody asks it anything. A server that exits on a missing
 * setting or an unreachable tenant closes the connection during that probe,
 * and the host reports a failure that names neither cause. So a problem
 * becomes an answer with a reason in it, and the server stays up.
 */

import { createInterface } from "node:readline";

export const SERVER_NAME = "blueconic-public-mcp";
export const SERVER_VERSION = "1.0.0";

const FALLBACK_PROTOCOL_VERSION = "2025-06-18";
const REQUEST_TIMEOUT_MS = 60_000;
const INTERNAL_ERROR = -32603;

export type JsonRpcMessage = {
  id?: number | string | null;
  method?: string;
  params?: { protocolVersion?: string } & Record<string, unknown>;
};

export type EndpointResolution = { url: URL; reason?: undefined } | { url?: undefined; reason: string };
export type AuthResolution =
  | { headers: Record<string, string>; reason?: undefined }
  | { headers?: undefined; reason: string };

/**
 * A setting the host left empty can arrive as the placeholder itself rather
 * than as an empty string, and a placeholder is not a credential.
 */
export function readSetting(value: string | undefined): string {
  const text = (value ?? "").trim();
  return /^\$\{.*\}$/.test(text) ? "" : text;
}

/** A tenant on the developer's own machine, the one case plain HTTP is safe. */
function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

/**
 * Builds the MCP endpoint of a tenant out of what the person typed. Accepts
 * the bare host, the tenant URL and the full endpoint, so a reader of the
 * support article and a reader of the field label both arrive at the same
 * address.
 */
export function resolveEndpoint(raw: string | undefined): EndpointResolution {
  const value = readSetting(raw);
  if (!value) {
    return {
      reason:
        "This extension has no tenant URL yet. Open Settings > Extensions, select BlueConic, " +
        "and fill in the tenant URL, for example https://tenantname.blueconic.net"
    };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { reason: `The tenant URL in the extension settings is not a URL: '${value}'` };
  }

  if (url.protocol === "http:" && !isLoopback(url.hostname)) {
    // The credentials travel as request headers, so plain HTTP puts the client
    // secret on the wire in the clear. Loopback stays allowed for a developer
    // running a tenant on their own machine.
    return {
      reason:
        `The tenant URL must use HTTPS. '${url.hostname}' was given over plain HTTP, which would send the ` +
        "client secret unencrypted."
    };
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path !== "" && path !== "/mcp") {
    return { reason: `The tenant URL must end at the host or at /mcp, and this one has the path '${url.pathname}'` };
  }

  url.pathname = "/mcp";
  url.search = "";
  url.hash = "";
  return { url };
}

/**
 * The credentials, as request headers. A bearer token wins over the client
 * credentials, which is the order the tenant servlet reads them in.
 */
export function resolveAuthHeaders(env: NodeJS.ProcessEnv): AuthResolution {
  const token = readSetting(env.BLUECONIC_OAUTH_TOKEN);
  if (token) {
    return { headers: { Authorization: /^bearer /i.test(token) ? token : `Bearer ${token}` } };
  }

  const clientId = readSetting(env.OAUTH_CLIENT_ID ?? env.BLUECONIC_CLIENT_ID);
  const clientSecret = readSetting(env.OAUTH_CLIENT_SECRET ?? env.BLUECONIC_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    return {
      reason:
        "This extension has no credentials yet. Open Settings > Extensions, select BlueConic, and fill in " +
        "the OAuth client ID and client secret of an application of your tenant."
    };
  }

  return { headers: { "X-BlueConic-Client-ID": clientId, "X-BlueConic-Client-Secret": clientSecret } };
}

function logToHost(message: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

function writeToClient(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function isRequest(message: JsonRpcMessage): boolean {
  return message.id !== undefined && message.id !== null;
}

export type ForwardOutcome = { lines: string[] } | { failure: string };

/** Posts one message to the tenant and reads the answer, or names why it could not. */
export async function forwardToTenant(
  message: JsonRpcMessage,
  endpoint: string,
  headers: Record<string, string>,
  protocolVersion: string | null
): Promise<ForwardOutcome> {
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...headers
  };
  if (protocolVersion) {
    requestHeaders["MCP-Protocol-Version"] = protocolVersion;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(message),
      signal: controller.signal
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { failure: `The tenant at ${endpoint} could not be reached: ${detail}` };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    return {
      failure:
        `The tenant refused the credentials (HTTP ${response.status}). Check the client ID and secret in the ` +
        "extension settings, and that the OAuth application is enabled."
    };
  }
  if (!response.ok) {
    return { failure: `The tenant answered HTTP ${response.status}.` };
  }

  const body = (await response.text()).trim();
  if (response.status === 202 || body === "") {
    return { lines: [] };
  }
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return {
      lines: body
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((line) => line.length > 0)
    };
  }
  return { lines: [body] };
}

/** Starts the bridge. Resolves when standard input closes. */
export async function run(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const endpoint = resolveEndpoint(env.BLUECONIC_TENANT_URL);
  const auth = resolveAuthHeaders(env);
  const target =
    endpoint.url && auth.headers ? { address: endpoint.url.toString(), headers: auth.headers } : null;
  const unavailable = endpoint.reason ?? auth.reason ?? "This extension is not configured yet.";
  let protocolVersion: string | null = null;

  if (target) {
    logToHost(`Connecting to ${target.address}`);
  } else {
    logToHost(unavailable);
  }

  function answerHandshake(message: JsonRpcMessage): void {
    protocolVersion = message.params?.protocolVersion ?? FALLBACK_PROTOCOL_VERSION;
    writeToClient({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      }
    });
  }

  async function handle(line: string): Promise<void> {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      logToHost(`Ignored a line that is not JSON: ${line.slice(0, 120)}`);
      return;
    }

    if (message.method === "initialize" && message.params?.protocolVersion) {
      protocolVersion = message.params.protocolVersion;
    }

    if (!target) {
      if (message.method === "initialize") {
        answerHandshake(message);
        return;
      }
      if (message.method === "ping") {
        writeToClient({ jsonrpc: "2.0", id: message.id, result: {} });
        return;
      }
      if (isRequest(message)) {
        writeToClient({ jsonrpc: "2.0", id: message.id, error: { code: INTERNAL_ERROR, message: unavailable } });
      }
      return;
    }

    const outcome = await forwardToTenant(message, target.address, target.headers, protocolVersion);
    if ("failure" in outcome) {
      logToHost(outcome.failure);
      if (message.method === "initialize") {
        // Answer the handshake anyway. A host that cannot complete it reports
        // a closed connection, which says nothing about the cause.
        answerHandshake(message);
        return;
      }
      if (isRequest(message)) {
        writeToClient({ jsonrpc: "2.0", id: message.id, error: { code: INTERNAL_ERROR, message: outcome.failure } });
      }
      return;
    }

    for (const answer of outcome.lines) {
      process.stdout.write(`${answer}\n`);
    }
  }

  const reader = createInterface({ input: process.stdin });
  let queue: Promise<void> = Promise.resolve();

  reader.on("line", (line) => {
    if (line.trim().length === 0) {
      return;
    }
    // One message at a time, so the answers keep the order the client sent.
    queue = queue.then(() => handle(line)).catch((error: unknown) => {
      logToHost(`Failed to handle a message: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  await new Promise<void>((resolve) => {
    reader.on("close", () => resolve());
  });
}
