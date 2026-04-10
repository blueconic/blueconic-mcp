#!/usr/bin/env node
/**
 * Client-Side BlueConic MCP Server.
 * This runs locally on each user's machine with their own tenant credentials.
 * Dynamically loads OpenAPI spec from the user's tenant and exposes all endpoints.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getAccessToken } from "./auth.js";
import { loadOpenApiSpec, tools } from "./openapi-tools.js";
import { makeApiCall } from "./api-client.js";

import packageJson from "../package.json" with { type: "json" };

// User-specific configuration from environment variables.
// e.g., https://tenant1.blueconic.net/rest/v2
let TENANT_URL = process.env.BLUECONIC_TENANT_URL;
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;

// Normalize TENANT_URL
if (TENANT_URL) {
  if (!TENANT_URL.startsWith("http")) {
    TENANT_URL = `https://${TENANT_URL}`;
  }
  if (TENANT_URL.endsWith("/")) {
    TENANT_URL = TENANT_URL.slice(0, -1);
  }
}

/**
 * Create and configure the MCP server using the high-level McpServer API.
 * Icons use the standard MCP Implementation schema, compatible with any MCP client.
 */
const mcpServer = new McpServer(
  {
    name: "blueconic-mcp-server",
    version: packageJson.version,
    description: "BlueConic Dynamic MCP Server - Multi-tenant OpenAPI adapter",
    icons: [
      {
        src: "https://images.ctfassets.net/cffoc7tw1rd0/51Zn92vyin9dGIvTp0sJiK/428ca35f423f26a87284a5ec896e36b3/BC-logo-partial-white.svg",
        mimeType: "image/svg+xml",
        theme: "dark"
      }
    ]
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

/**
 * Register dynamically discovered tools from the tenant's OpenAPI spec.
 */
function registerDynamicTools(): void {
  for (const tool of tools) {
    mcpServer.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations
      },
      async (args: Record<string, unknown>) => {
        console.error(`Executing tool: ${tool.name} with args: ${JSON.stringify(args)}`);

        const token = await getAccessToken(TENANT_URL!, OAUTH_CLIENT_ID!, OAUTH_CLIENT_SECRET!);

        try {
          const pathParams: Record<string, string> = {};
          const queryParams: Record<string, string> = {};
          let requestBody: unknown = null;

          for (const [key, value] of Object.entries(args || {})) {
            if (key === "requestBody") {
              requestBody = value;
            } else if (tool.path.includes(`{${key}}`)) {
              pathParams[key] = String(value);
            } else {
              queryParams[key] = String(value);
            }
          }

          const result = await makeApiCall(TENANT_URL!, token, tool.method, tool.path, packageJson.version, pathParams, queryParams, requestBody);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2)
              }
            ]
          };

        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${message}`
              }
            ],
            isError: true
          };
        }
      }
    );
  }
}

async function main() {
  if (!TENANT_URL || !OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET) {
    console.error("Error: Missing required environment variables");
    console.error("Please set:");
    console.error("  BLUECONIC_TENANT_URL=https://tenant1.blueconic.net");
    console.error("  OAUTH_CLIENT_ID=your_client_id");
    console.error("  OAUTH_CLIENT_SECRET=your_client_secret");
    console.error("Optional:");
    console.error("  NODE_TLS_REJECT_UNAUTHORIZED=0 (for self-signed certs in dev)");
    process.exit(1);
  }

  try {
    await loadOpenApiSpec(TENANT_URL, packageJson.version);
    registerDynamicTools();

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    console.error(`BlueConic Dynamic MCP Server started successfully (version: ${packageJson.version})`);
    console.error(`Tenant: ${TENANT_URL}`);
    console.error(`Loaded ${tools.length} API endpoints`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to start server:", message);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  console.error("Shutting down BlueConic Dynamic MCP Server...");
  await mcpServer.close();
  process.exit(0);
});

main().catch((error: unknown) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
