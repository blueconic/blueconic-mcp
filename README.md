# BlueConic MCP

BlueConic MCP is a local MCP server that loads a BlueConic tenant's OpenAPI specification at startup and turns the tenant's supported REST operations into MCP tools. This repository supports:

- Claude Desktop through a packaged `.mcpb` connector
- Standard stdio MCP clients such as Cursor, VS Code, and other MCP-capable tools
- Local development from TypeScript source under `src/`

More information is available in the BlueConic support docs:
https://support.blueconic.com/en/articles/415706-blueconic-mcp-client-for-ai-coding-assistants

## Security

Opening a BlueConic tenant to any MCP client can expose sensitive data if the model is used carelessly. Only connect this server to AI tools you trust, and make sure the host application is configured in a way that matches your security and data-handling requirements.

## Project Layout

```text
src/
  client-side-server.ts
  api-client.ts
  auth.ts
  logging.ts
  openapi-tools.ts
  __tests__/
scripts/
  build-mcpb.mjs
  check-mcpb-bundle.mjs
manifest.json
.mcpbignore
```

`src/` is the source of truth for development and the npm package build. `server/index.mjs` is generated only for Claude Desktop bundling and is intentionally excluded from git.

## Quick Start

Install dependencies:

```bash
npm install
```

Set your BlueConic credentials for local stdio development:

```bash
export BLUECONIC_TENANT_URL="https://yourtenant.blueconic.net"
export OAUTH_CLIENT_ID="your_client_id"
export OAUTH_CLIENT_SECRET="your_client_secret"
```

This connector requires normal TLS certificate verification. Self-signed certificate bypass is not supported.

Run from source:

```bash
npm start
```

Common development commands:

```bash
npm run build
npm test
npm run validate:mcpb
npm run pack:mcpb
```

`npm test` runs both the TypeScript unit tests and a Claude Desktop bundle regression check.

## Claude Desktop

The repo includes a Claude Desktop `manifest.json` using the current MCPB schema. Claude's secure `user_config` fields map onto the same environment variables used by the stdio server.

Build and validate the Claude bundle:

```bash
npm run validate:mcpb
```

Create the installable connector:

```bash
npm run pack:mcpb
```

This generates a versioned `.mcpb` bundle in `dist/`.

Install flow:

1. Build the bundle with `npm run pack:mcpb`.
2. Open `dist/` and install the generated `blueconic-mcp-*.mcpb` file in Claude Desktop.
3. Enter your tenant URL, client ID, and client secret when Claude prompts for connector configuration.
4. Reinstall the `.mcpb` after each connector rebuild so Claude picks up the new bundle.

The Claude packaging flow stays intentionally small:

- `server/index.mjs` is a single generated runtime bundle
- `.mcpbignore` removes source, tests, docs, configs, dev dependencies, and local artifacts
- The packaged connector ships only `manifest.json`, `icon.png`, `icon-dark.png`, `package.json`, and `server/index.mjs`

`npm run check:mcpb` is the fast regression guard for the Claude runtime. It verifies that:

- the generated bundle does not include the unsupported dynamic-require shim
- startup reaches the expected credential validation path instead of crashing during module load
- `.mcpbignore` does not exclude `package.json`, which the runtime reads for the connector version

## Cursor

Add this to `.cursor/mcp.json` when using the published npm package:

```json
{
  "mcpServers": {
    "blueconic": {
      "command": "npx",
      "args": ["@blueconic/blueconic-mcp"],
      "env": {
        "BLUECONIC_TENANT_URL": "https://yourtenant.blueconic.net",
        "OAUTH_CLIENT_ID": "your_client_id",
        "OAUTH_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

For local development from source:

```json
{
  "mcpServers": {
    "blueconic": {
      "command": "npx",
      "args": [
        "tsx",
        "/path/to/blueconic-mcp/src/client-side-server.ts"
      ],
      "env": {
        "BLUECONIC_TENANT_URL": "https://yourtenant.blueconic.net",
        "OAUTH_CLIENT_ID": "your_client_id",
        "OAUTH_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

## VS Code GitHub Copilot

Add this to your MCP server settings when using the npm package:

```json
{
  "servers": {
    "blueconic": {
      "name": "BlueConic MCP Server",
      "description": "BlueConic MCP Server",
      "command": "npx",
      "args": ["@blueconic/blueconic-mcp"],
      "env": {
        "BLUECONIC_TENANT_URL": "${input:blueconic-tenant-url}",
        "OAUTH_CLIENT_ID": "${input:blueconic-oauth2-client-id}",
        "OAUTH_CLIENT_SECRET": "${input:blueconic-oauth2-client-secret}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "blueconic-tenant-url",
      "description": "BlueConic tenant URL, for example https://mytenant.blueconic.net",
      "password": false
    },
    {
      "type": "promptString",
      "id": "blueconic-oauth2-client-id",
      "description": "BlueConic OAuth 2.0 Client ID",
      "password": true
    },
    {
      "type": "promptString",
      "id": "blueconic-oauth2-client-secret",
      "description": "BlueConic OAuth 2.0 Client secret",
      "password": true
    }
  ]
}
```

For local development, point the command to `src/client-side-server.ts` in the same way as the Cursor example.

## Behavior

- The server discovers schemas dynamically from the tenant's OpenAPI specification at startup, but only exposes operations that are explicitly listed in `APPROVED_OPERATION_POLICIES` in `src/openapi-tools.ts`.
- The approved surface currently covers reviewed BlueConic REST API v2 data operations. OAuth authorization, token issuance, and token revocation endpoints are intentionally excluded.
- Tool annotations are derived from the HTTP method and operation text so clients can distinguish read-only, write, and destructive operations.
- Write-capable tools can create/update content stores and content store items, bulk delete content store items, create/update/delete models, create/update/delete groups and profiles through bulk endpoints, create/update/delete profile or group properties, create/update URL mappings, and register interaction or pageview events.
- Each tool requests only the OAuth scopes declared by its OpenAPI operation when it is called.
- OAuth tokens are cached in memory and refreshed automatically before expiration.
- Responses are returned as formatted JSON when possible, with text or base64 fallbacks for non-JSON payloads.

## BlueConic Credentials

To create a suitable OAuth client in BlueConic:

1. Log into your BlueConic tenant.
2. Go to `Settings > Access management > Applications`.
3. Create an application using the client credentials flow.
4. Grant the read and/or write scopes for the tools you want the MCP client to use.
5. Copy the client ID and client secret into your MCP configuration.

Common read scopes include:

- `read:segments`
- `read:profiles`
- `read:connections`
- `read:content_stores`
- `read:models`

Common write scopes include:

- `write:profiles`
- `write:groups`
- `write:profile-properties`
- `write:content_stores`
- `write:models`
- `write:url-mappings`
