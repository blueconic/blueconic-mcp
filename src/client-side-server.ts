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
import { loadOpenApiSpec, tools } from "./openapi-tools.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };

type ServerConfig = {
  clientId: string;
  clientSecret: string;
  tenantUrl: string;
};

function normalizeTenantUrl(rawTenantUrl?: string): string | undefined {
  if (!rawTenantUrl) {
    return undefined;
  }

  const tenantUrl = rawTenantUrl.startsWith("http") ? rawTenantUrl : `https://${rawTenantUrl}`;
  return tenantUrl.endsWith("/") ? tenantUrl.slice(0, -1) : tenantUrl;
}

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
  if (!serverConfig) {
    throw new Error("BlueConic MCP server configuration is incomplete");
  }

  if (tools.length === 0) {
    await loadOpenApiSpec(serverConfig.tenantUrl, packageJson.version);
  }

  return {
    tools: tools.map(({ annotations, description, inputSchema, name }) => ({
      name,
      description,
      inputSchema,
      annotations
    }))
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!serverConfig) {
    return {
      content: [
        {
          type: "text",
          text: "Error: Missing required BlueConic credentials"
        }
      ],
      isError: true
    };
  }

  const toolName = request.params.name;
  const tool = tools.find((candidate) => candidate.name === toolName);

  if (!tool) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Unknown tool: ${toolName}`
        }
      ],
      isError: true
    };
  }

  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  console.error(`Executing tool: ${toolName} with args: ${JSON.stringify(args)}`);

  try {
    const token = await getAccessToken(
      serverConfig.tenantUrl,
      serverConfig.clientId,
      serverConfig.clientSecret
    );

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
      serverConfig.tenantUrl,
      token,
      tool.method,
      tool.path,
      packageJson.version,
      pathParams,
      queryParams,
      requestBody
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
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${message}`
        }
      ],
      isError: true
    };
  }
});

async function main(): Promise<void> {
  if (!serverConfig) {
    console.error("Error: Missing required environment variables");
    console.error("Please set:");
    console.error("  BLUECONIC_TENANT_URL=https://tenant1.blueconic.net");
    console.error("  OAUTH_CLIENT_ID=your_client_id");
    console.error("  OAUTH_CLIENT_SECRET=your_client_secret");
    console.error("Optional:");
    console.error("  NODE_TLS_REJECT_UNAUTHORIZED=0 (for self-signed certs in development)");
    process.exit(1);
  }

  try {
    await loadOpenApiSpec(serverConfig.tenantUrl, packageJson.version);

    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error(`BlueConic MCP server started successfully (version: ${packageJson.version})`);
    console.error(`Tenant: ${serverConfig.tenantUrl}`);
    console.error(`Loaded ${tools.length} API endpoints`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to start server:", message);
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
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
  process.exit(1);
});

main().catch((error: unknown) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
