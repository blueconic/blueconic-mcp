# BlueConic MCP

BlueConic MCP is a local MCP server that loads a BlueConic tenant's OpenAPI specification at startup and turns the tenant's supported REST operations into MCP tools. This repository supports:

- Claude Desktop through a packaged `.mcpb` connector
- Standard stdio MCP clients such as Cursor, Gemini CLI, VS Code, and other MCP-capable tools
- Local development from TypeScript source under `src/`

## Two connectors, one repository

This repository builds two `.mcpb` bundles. They reach the same tenant by different routes, and a customer
installs the one that matches what they need.

| | `blueconic-mcp` | `blueconic-public-mcp` |
|---|---|---|
| Talks to | the tenant's **REST API**, tools built from its OpenAPI spec | the tenant's **public MCP server** at `https://<tenant>/mcp` |
| Operations | read and write, with confirmation and batch limits on a write | read only |
| Tools | the curated allowlist in `src/openapi-tools.ts` | whatever the tenant's own servlet registers, plus `search_objects` |
| Needs | any tenant with an OpenAPI spec | a tenant that serves `/mcp` |
| Built by | `npm run pack:mcpb` | `npm run pack:mcpb:public` |

`search_objects` is the reason the second bundle exists: it answers "how many X match Y" with an exact count
read out of the tenant's own index, rather than the length of one page of a list endpoint.

More information is available in the BlueConic support docs:
https://support.blueconic.com/en/articles/415706-blueconic-mcp-client-for-ai-coding-assistants

## Security

Opening a BlueConic tenant to any MCP client can expose sensitive data if the model is used carelessly. Only connect this server to AI tools you trust, and make sure the host application is configured in a way that matches your security and data-handling requirements.

## Project Layout

```text
src/
  client-side-server.ts
  public-server.ts
  public-server-entry.ts
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

### The public MCP connector

The second bundle lives in `public-mcp/`, and is built from `src/public-server.ts`:

```bash
npm run validate:mcpb:public
npm run pack:mcpb:public
```

This generates `dist/blueconic-public-mcp-<version>.mcpb`, which installs the same way. The bundle carries its
own version in `public-mcp/manifest.json`, because it tracks the tenant servlet rather than the npm package.

The bundle is a bridge, not a second client: it reads a JSON-RPC message from standard input, posts it to
`https://<tenant>/mcp` with the credentials as headers, and writes the answer back out. It needs a local
process at all because Claude Desktop starts local servers over stdio, its custom connector has no field for a
custom header, and the MCPB format has no remote server type.

**`npm run check:mcpb:public` asserts the opposite startup behaviour to `check:mcpb`, on purpose.** A host
starts an extension as soon as it is installed, before anybody fills in the settings, and probes it before
anybody asks it anything. A server that exits during that probe is reported as `Version negotiation failed:
the connection closed during the server/discover probe`, which names neither the missing setting nor an
unreachable tenant. So this bundle never exits on a problem: it answers the handshake itself, and returns the
reason as a JSON-RPC error naming the field to fix. The check drives it with no credentials and fails if the
process exits, or if the answer does not name the missing setting.

## Releases

A tag that starts with `v` publishes both bundles as assets of a GitHub release
(`.github/workflows/release.yml`). Nothing else triggers it: merging a pull request does not.

`npm version` already creates such a tag, so the existing `publish-release` script publishes the module
and the bundles together — as long as the tag reaches the remote:

```bash
npm run publish-release
git push --follow-tags
```

To release without touching the module, tag by hand:

```bash
git tag v1.1.3 && git push origin v1.1.3
```

The workflow also runs by hand from the Actions tab, where it asks for the tag to release. That tag has
to exist already.

Each release carries four assets: both bundles under their versioned names, and both under unversioned
names. The unversioned pair is what documentation should link, because the URL then survives every later
release:

```text
https://github.com/blueconic/blueconic-mcp/releases/latest/download/blueconic-mcp.mcpb
https://github.com/blueconic/blueconic-mcp/releases/latest/download/blueconic-public-mcp.mcpb
```

A release asset downloads without a GitHub account and does not expire. The `mcpb-bundles` artifact that
CI uploads on every run does neither — it is for a reviewer installing the build of one pull request, not
a way to hand a bundle to a customer.

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

## Gemini CLI

Add this to your Gemini CLI `settings.json` when using the published npm package. Gemini CLI reads project settings from `.gemini/settings.json` and user settings from `~/.gemini/settings.json`.

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
      },
      "trust": true
    }
  }
}
```

Use `/mcp` inside Gemini CLI to confirm the server is connected and the BlueConic tools are discovered.

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
- Every approved operation has an explicit risk policy: `read`, `additive_write`, or `destructive_write`, with confirmation and batch-size settings where needed.
- Tool annotations are emitted from that explicit risk policy so clients can distinguish read-only, additive write, and destructive write operations.
- Write-capable tools include warning-rich descriptions and support `dryRun: true` to preview the target endpoint, resolved path parameters, estimated object count, risk, caps, and confirmation requirements without making a live API call.
- Destructive write tools require server-enforced confirmation before execution. Clients with MCP elicitation support get an interactive confirmation request; other clients receive a one-time confirmation token that must be supplied on a second identical call as a top-level `confirmationToken` argument, next to `requestBody`, not inside it. Fallback responses include a display hint telling surfaces not to show the token value in end-user chat.
- Bulk write calls are capped by the MCP server. `BLUECONIC_MAX_BULK_ITEMS` defaults to `100`; `BLUECONIC_MAX_DESTRUCTIVE_BULK_ITEMS` defaults to `25`.
- Write-capable tools can create content stores, add or update content store items, create/update models, create/update profile or group properties, create/update URL mappings, and register interaction or pageview events.
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
