#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { buildApiUrl, makeApiCall, type QueryParamScalar, type QueryParamValue } from "./api-client.js";
import { getAccessToken } from "./auth.js";
import { normalizeTenantUrl, readBulkSafetyLimits } from "./config.js";
import {
  BLUECONIC_CONFIGURATION_REQUIRED_MESSAGE,
  BLUECONIC_TLS_CONFIGURATION_MESSAGE,
  getClientFacingErrorMessage
} from "./errors.js";
import { logError } from "./logging.js";
import { loadOpenApiSpec, tools, type DynamicTool } from "./openapi-tools.js";
import {
  buildDryRunSummary,
  CONFIRMATION_TOKEN_PLACEMENT_MESSAGE,
  estimateObjectCount,
  getConfirmationTokenUsage,
  getEffectiveMaxBatchSize,
  getMisplacedConfirmationToken
} from "./safety.js";
import { createLazyLoadGuard } from "./tool-loader.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

type ServerConfig = {
  clientId: string;
  clientSecret: string;
  tenantUrl: string;
};

type ParsedToolArguments = {
  confirmationToken?: string;
  dryRun: boolean;
  misplacedConfirmationToken?: string;
  pathParams: Record<string, string>;
  queryParams: Record<string, QueryParamValue>;
  requestBody: unknown;
};

type ToolResult = {
  content: Array<{
    text: string;
    type: "text";
  }>;
  isError?: boolean;
};

type ConfirmationRecord = {
  expiresAtMs: number;
  fingerprint: string;
  toolName: string;
};

const CONFIRMATION_TOKEN_TTL_MS = 10 * 60 * 1000;
const confirmationTokens = new Map<string, ConfirmationRecord>();

function readServerConfig(): ServerConfig | null {
  const tenantUrl = normalizeTenantUrl(process.env.BLUECONIC_TENANT_URL);
  const clientId = process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;

  if (!tenantUrl || !clientId || !clientSecret) {
    return null;
  }

  return {
    tenantUrl,
    clientId,
    clientSecret
  };
}

function isInsecureTlsBypassEnabled(): boolean {
  return process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0";
}

function getRuntimeValidationMessage(): string | null {
  if (isInsecureTlsBypassEnabled()) {
    return BLUECONIC_TLS_CONFIGURATION_MESSAGE;
  }

  if (!serverConfig) {
    return BLUECONIC_CONFIGURATION_REQUIRED_MESSAGE;
  }

  return null;
}

function coerceQueryParamScalar(value: unknown): QueryParamScalar {
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function coerceQueryParamValue(value: unknown): QueryParamValue {
  if (Array.isArray(value)) {
    return value.map((item) => coerceQueryParamScalar(item));
  }

  return coerceQueryParamScalar(value);
}

function formatToolResult(result: unknown): string {
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

function textToolResult(text: string, isError = false): ToolResult {
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    ...(isError ? { isError: true } : {})
  };
}

function parseToolArguments(tool: DynamicTool, args: Record<string, unknown>): ParsedToolArguments {
  const pathParams: Record<string, string> = {};
  const queryParams: Record<string, QueryParamValue> = {};
  let requestBody: unknown = null;
  let dryRun = false;
  let confirmationToken: string | undefined;

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (key === "dryRun") {
      dryRun = value === true;
      continue;
    }

    if (key === "confirmationToken") {
      confirmationToken = typeof value === "string" ? value : undefined;
      continue;
    }

    if (key === "requestBody") {
      requestBody = value;
      continue;
    }

    if (tool.path.includes(`{${key}}`)) {
      pathParams[key] = String(value);
      continue;
    }

    queryParams[key] = coerceQueryParamValue(value);
  }

  return {
    confirmationToken,
    dryRun,
    misplacedConfirmationToken: getMisplacedConfirmationToken(requestBody),
    pathParams,
    queryParams,
    requestBody
  };
}

function createToolFingerprint(
  tool: DynamicTool,
  pathParams: Record<string, string>,
  queryParams: Record<string, QueryParamValue>,
  requestBody: unknown
): string {
  const stablePayload = stableJsonStringify({
    method: tool.method,
    path: tool.path,
    pathParams,
    queryParams,
    requestBody,
    toolName: tool.name
  });

  return createHash("sha256").update(stablePayload).digest("hex");
}

function createConfirmationToken(toolName: string, fingerprint: string): string {
  cleanupExpiredConfirmationTokens();

  const token = randomBytes(24).toString("base64url");
  confirmationTokens.set(token, {
    expiresAtMs: Date.now() + CONFIRMATION_TOKEN_TTL_MS,
    fingerprint,
    toolName
  });

  return token;
}

function consumeConfirmationToken(token: string, toolName: string, fingerprint: string): string | null {
  cleanupExpiredConfirmationTokens();

  const record = confirmationTokens.get(token);
  if (!record) {
    return "The confirmation token is missing, invalid, or expired. Re-run the tool without confirmationToken to request a fresh confirmation.";
  }

  confirmationTokens.delete(token);
  if (record.toolName !== toolName || record.fingerprint !== fingerprint) {
    return "The confirmation token does not match this exact tool call. Re-run the tool without confirmationToken to request a fresh confirmation for these arguments.";
  }

  return null;
}

function cleanupExpiredConfirmationTokens(now = Date.now()): void {
  for (const [token, record] of confirmationTokens) {
    if (record.expiresAtMs <= now) {
      confirmationTokens.delete(token);
    }
  }
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => [key, sortJsonValue(entryValue)])
  );
}

const serverConfig = readServerConfig();
const bulkSafetyLimits = readBulkSafetyLimits();
const ensureOpenApiToolsLoaded = createLazyLoadGuard(
  () => tools.length > 0,
  () => loadOpenApiSpec(serverConfig?.tenantUrl, packageJson.version)
);

const server = new Server(
  {
    name: "blueconic-mcp",
    version: packageJson.version
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

async function requestDestructiveConfirmation(params: {
  confirmationToken?: string;
  dryRunSummary: unknown;
  estimatedObjectCount: number;
  fingerprint: string;
  maxBatchSize?: number;
  targetEndpoint: string;
  tool: DynamicTool;
}): Promise<{ confirmed: true } | { confirmed: false; result: ToolResult }> {
  if (params.confirmationToken) {
    const tokenError = consumeConfirmationToken(
      params.confirmationToken,
      params.tool.name,
      params.fingerprint
    );

    if (tokenError) {
      return {
        confirmed: false,
        result: textToolResult(tokenError, true)
      };
    }

    return { confirmed: true };
  }

  const elicitationResult = await elicitDestructiveConfirmation(params);
  if (elicitationResult === "accepted") {
    return { confirmed: true };
  }

  if (elicitationResult === "declined") {
    return {
      confirmed: false,
      result: textToolResult("The destructive BlueConic operation was not executed because confirmation was declined.", true)
    };
  }

  const confirmationToken = createConfirmationToken(params.tool.name, params.fingerprint);
  return {
    confirmed: false,
    result: textToolResult(formatToolResult({
      executed: false,
      requiresConfirmation: true,
      confirmationToken,
      expiresInSeconds: CONFIRMATION_TOKEN_TTL_MS / 1000,
      confirmationTokenUsage: getConfirmationTokenUsage(),
      confirmationTokenDisplayHint: {
        showInChat: false,
        message: "The confirmationToken is for the follow-up tool call only. Do not display the token value in end-user chat."
      },
      message: [
        "This destructive BlueConic operation was not executed.",
        "Inspect the dry-run summary, confirm the tenant and target identifiers, then call the same tool again with the same arguments plus confirmationToken to execute.",
        "The confirmationToken is for the follow-up tool call only; surfaces should not display the token value in end-user chat.",
        CONFIRMATION_TOKEN_PLACEMENT_MESSAGE
      ].join(" "),
      dryRun: params.dryRunSummary
    }))
  };
}

async function elicitDestructiveConfirmation(params: {
  estimatedObjectCount: number;
  maxBatchSize?: number;
  targetEndpoint: string;
  tool: DynamicTool;
}): Promise<"accepted" | "declined" | "unavailable"> {
  if (!server.getClientCapabilities()?.elicitation) {
    return "unavailable";
  }

  try {
    const result = await server.elicitInput({
      message: [
        `Confirm destructive BlueConic tool execution for ${params.tool.name}.`,
        `Target: ${params.targetEndpoint}`,
        `Estimated object count: ${params.estimatedObjectCount}`,
        ...(params.maxBatchSize === undefined ? [] : [`Maximum allowed object count: ${params.maxBatchSize}`])
      ].join("\n"),
      requestedSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            title: "Confirm execution",
            description: "Execute this live destructive BlueConic write."
          }
        },
        required: ["confirm"]
      }
    });

    return result.action === "accept" && result.content?.confirm === true
      ? "accepted"
      : "declined";
  } catch (error: unknown) {
    logError("BlueConic destructive confirmation elicitation failed", error);
    return "unavailable";
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const runtimeValidationMessage = getRuntimeValidationMessage();
  if (runtimeValidationMessage) {
    throw new Error(runtimeValidationMessage);
  }

  try {
    await ensureOpenApiToolsLoaded();

    return {
      tools: tools.map(({ annotations, description, inputSchema, name }) => ({
        name,
        description,
        inputSchema,
        annotations
      }))
    };
  } catch (error: unknown) {
    logError("Failed to prepare BlueConic tools", error);
    throw new Error(
      getClientFacingErrorMessage(
        error,
        "BlueConic tools are currently unavailable. Please try again later."
      )
    );
  }
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const runtimeValidationMessage = getRuntimeValidationMessage();
  if (runtimeValidationMessage) {
    return {
      content: [
        {
          type: "text",
          text: runtimeValidationMessage
        }
      ],
      isError: true
    };
  }

  const currentServerConfig = serverConfig;
  if (!currentServerConfig) {
    return {
      content: [
        {
          type: "text",
          text: BLUECONIC_CONFIGURATION_REQUIRED_MESSAGE
        }
      ],
      isError: true
    };
  }

  const toolName = request.params.name;

  try {
    await ensureOpenApiToolsLoaded();
    const tool = tools.find((candidate) => candidate.name === toolName);

    if (!tool) {
      return {
        content: [
          {
            type: "text",
            text: "The requested BlueConic tool is unavailable."
          }
        ],
        isError: true
      };
    }

    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    console.error(`Executing tool: ${toolName}`);

    const {
      confirmationToken,
      dryRun,
      misplacedConfirmationToken,
      pathParams,
      queryParams,
      requestBody
    } = parseToolArguments(tool, args);
    const { finalPath, url } = buildApiUrl(
      currentServerConfig.tenantUrl,
      tool.path,
      pathParams,
      queryParams
    );
    const estimatedObjectCount = estimateObjectCount(requestBody, queryParams);
    const maxBatchSize = getEffectiveMaxBatchSize(tool, bulkSafetyLimits);
    const dryRunSummary = buildDryRunSummary({
      estimatedObjectCount,
      finalPath,
      maxBatchSize,
      method: tool.method,
      path: tool.path,
      pathParams,
      policy: tool,
      queryParams,
      targetEndpoint: url.toString(),
      tenantUrl: currentServerConfig.tenantUrl,
      toolName: tool.name
    });

    if (dryRun && tool.risk !== "read") {
      return textToolResult(formatToolResult(dryRunSummary));
    }

    if (tool.requiresConfirmation && misplacedConfirmationToken) {
      return textToolResult(formatToolResult({
        executed: false,
        blocked: true,
        reason: CONFIRMATION_TOKEN_PLACEMENT_MESSAGE,
        confirmationTokenUsage: getConfirmationTokenUsage()
      }), true);
    }

    if (maxBatchSize !== undefined && estimatedObjectCount > maxBatchSize) {
      return textToolResult(formatToolResult({
        executed: false,
        blocked: true,
        reason: `Estimated object count ${estimatedObjectCount} exceeds the configured maximum of ${maxBatchSize}.`,
        dryRun: dryRunSummary
      }), true);
    }

    if (tool.requiresConfirmation) {
      const fingerprint = createToolFingerprint(tool, pathParams, queryParams, requestBody);
      const confirmationResult = await requestDestructiveConfirmation({
        confirmationToken,
        dryRunSummary,
        estimatedObjectCount,
        fingerprint,
        maxBatchSize,
        targetEndpoint: url.toString(),
        tool
      });

      if (!confirmationResult.confirmed) {
        return confirmationResult.result;
      }
    }

    const token = tool.requiresAuth
      ? await getAccessToken(
        currentServerConfig.tenantUrl,
        currentServerConfig.clientId,
        currentServerConfig.clientSecret,
        tool.requiredScopes
      )
      : null;
    const existingConfigurationToken = tool.requiresAuth && tool.retainExistingConfiguration?.requiredScopes
      ? await getAccessToken(
        currentServerConfig.tenantUrl,
        currentServerConfig.clientId,
        currentServerConfig.clientSecret,
        tool.retainExistingConfiguration.requiredScopes
      )
      : token;

    const result = await makeApiCall(
      currentServerConfig.tenantUrl,
      token,
      tool.method,
      tool.path,
      packageJson.version,
      tool.name,
      pathParams,
      queryParams,
      requestBody,
      tool.requestBodyContentType,
      tool.requiresAuth,
      tool.retainExistingConfiguration,
      existingConfigurationToken
    );

    return {
      content: [
        {
          type: "text",
          text: formatToolResult(result)
        }
      ]
    };
  } catch (error: unknown) {
    logError(`BlueConic tool execution failed for ${toolName}`, error);
    return {
      content: [
        {
          type: "text",
          text: getClientFacingErrorMessage(error)
        }
      ],
      isError: true
    };
  }
});

async function main(): Promise<void> {
  const runtimeValidationMessage = getRuntimeValidationMessage();
  if (runtimeValidationMessage) {
    console.error(runtimeValidationMessage);
    process.exit(1);
  }

  try {
    await ensureOpenApiToolsLoaded();

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error(`BlueConic MCP server started successfully (version: ${packageJson.version})`);
    console.error(`Loaded ${tools.length} OpenAPI operations`);
  } catch (error: unknown) {
    logError("Failed to start server", error);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  console.error("Shutting down BlueConic MCP server...");
  await server.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.error("Shutting down BlueConic MCP server...");
  await server.close();
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  logError("Uncaught exception", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logError("Unhandled rejection", reason);
  process.exit(1);
});

main().catch((error: unknown) => {
  logError("Failed to start server", error);
  process.exit(1);
});
