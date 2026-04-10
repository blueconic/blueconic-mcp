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

import packageJson from "./package.json" with { type: "json" };

import {
  setGlobalDispatcher,
  Agent,
} from "undici";

// User-specific configuration from environment variables.
// e.g., https://tenant1.blueconic.net/rest/v2
let TENANT_URL = process.env.BLUECONIC_TENANT_URL;
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;

// Normalize TENANT_URL
if (TENANT_URL) {
  if (!TENANT_URL.startsWith("http")) {
    // Add https:// prefix if missing
    TENANT_URL = `https://${TENANT_URL}`;
  }
  if (TENANT_URL.endsWith("/")) {
    // Remove trailing slash
    TENANT_URL = TENANT_URL.slice(0, -1);
  }
}

// Allow self-signed certificates for local development
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
  setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));
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
 * Each tool is registered via McpServer.registerTool() with its annotations
 * and a callback that handles authentication and API calls.
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
          // Extract parameters
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

          // Make the API call
          const result = await makeApiCall(TENANT_URL!, token, tool.method, tool.path, pathParams, queryParams, requestBody);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2)
              }
            ]
          };

        } catch (error: any) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${error.message}`
              }
            ],
            isError: true
          };
        }
      }
    );
  }
}

/**
 * Start the server
 */
async function main() {
  // Validate required environment variables
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
    // Load OpenAPI spec on startup and register tools dynamically
    await loadOpenApiSpec(TENANT_URL, packageJson.version);
    registerDynamicTools();

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    console.error(`BlueConic Dynamic MCP Server started successfully (version: ${packageJson.version})`);
    console.error(`Tenant: ${TENANT_URL}`);
    console.error(`Loaded ${tools.length} API endpoints`);
  } catch (error: any) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.error("Shutting down BlueConic Dynamic MCP Server...");
  await mcpServer.close();
  process.exit(0);
});

// Start the server
main().catch((error: any) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
