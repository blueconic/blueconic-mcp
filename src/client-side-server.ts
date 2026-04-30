#!/usr/bin/env node

import { createRequire } from "node:module";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { makeApiCall, type QueryParamScalar, type QueryParamValue } from "./api-client.js";
import { getAccessToken } from "./auth.js";
import { normalizeTenantUrl } from "./config.js";
import {
  BLUECONIC_CONFIGURATION_REQUIRED_MESSAGE,
  BLUECONIC_TLS_CONFIGURATION_MESSAGE,
  getClientFacingErrorMessage
} from "./errors.js";
import { logError } from "./logging.js";
import { loadOpenApiSpec, tools } from "./openapi-tools.js";
import { createLazyLoadGuard } from "./tool-loader.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

type ServerConfig = {
  clientId: string;
  clientSecret: string;
  tenantUrl: string;
};

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

const serverConfig = readServerConfig();
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

    const token = tool.requiresAuth
      ? await getAccessToken(
        currentServerConfig.tenantUrl,
        currentServerConfig.clientId,
        currentServerConfig.clientSecret,
        tool.requiredScopes
      )
      : null;

    const pathParams: Record<string, string> = {};
    const queryParams: Record<string, QueryParamValue> = {};
    let requestBody: unknown = null;

    for (const [key, value] of Object.entries(args)) {
      if (value === undefined || value === null) {
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
      tool.requiresAuth
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
