# BlueConic MCP

A client-side MCP server that dynamically exposes **all** BlueConic REST API endpoints for use with AI assistants including Claude Desktop, Cursor, and VS Code GitHub Copilot.

More information can be found on the support documentation: https://support.blueconic.com/en/articles/415706-blueconic-mcp-client-for-ai-coding-assistants.

## IMPORTANT NOTE ##

Opening up your BlueConic tenant with MCP can be dangerous, as you need to trust the model to use it in a sensible and safe manner. If used incorrectly, it could lead to sensitive data being leaked.
Make sure that the MCP host you're using, doesn't use the MCP context for training their models!

## Multi-Tenant SaaS ✨

- 🏢 **No server deployment** - Each user runs locally
- 🔄 **Dynamic API discovery** - Auto-loads from tenant's OpenAPI spec
- 🔐 **Per-user credentials** - Each user uses their own OAuth tokens
- 🚀 **Instant setup** - Works with any BlueConic tenant
- 📡 **All APIs exposed** - Every endpoint in your OpenAPI spec becomes available

## Quick Start

### 1. Install Dependencies

Make sure Node.js (>= 22.x) is installed, along with NPM (node package manager).

```bash
npm install
```

### 2. Configure Your Tenant

```bash
# Your BlueConic tenant
export BLUECONIC_TENANT_URL="https://yourtenant.blueconic.net"

# Your OAuth app credentials
export OAUTH_CLIENT_ID="your_client_id"
export OAUTH_CLIENT_SECRET="your_client_secret"

# For development with self-signed certs
export NODE_TLS_REJECT_UNAUTHORIZED="0"
```

### 3. Run the MCP Server

```bash
npm start
```

You should see:
```
Loading OpenAPI spec from: https://yourtenant.blueconic.net/rest/v2/openapi.json?prettyPrint=true
Loaded 24 API endpoints as MCP tools
BlueConic Dynamic MCP Server started successfully (version: xxx)
```

## Integration with AI Tools

### Claude Desktop (Desktop Extension)

Install directly from the Claude Connectors Directory:

1. Open Claude Desktop
2. Go to **Settings > Connectors > Browse Connectors > Desktop Extensions**
3. Search for **BlueConic** and click **Install**
4. Enter your BlueConic tenant URL, OAuth Client ID, and Client Secret when prompted

Alternatively, install from a `.mcpb` bundle file by dragging it into the Claude Desktop window.

### Cursor

Add to your Cursor settings (`.cursor/mcp.json`):

When using the NPM package:

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

For local development:

```json
{
  "mcpServers": {
    "blueconic": {
			"command": "npx",
			"args": [
        "tsx",
        "/path/to/blueconic-mcp-client/client-side-server.ts"
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

### VS Code GitHub Copilot

Add to your VS Code settings. When using the NPM package:

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
  "inputs": [{
      "type": "promptString",
      "id": "blueconic-tenant-url",
      "description": "BlueConic tenant URL, e.g. https://mytenant.blueconic.net",
      "password": false
    }, {
      "type": "promptString",
      "id": "blueconic-oauth2-client-id",
      "description": "BlueConic OAuth2.0 Client ID",
      "password": true
    },{
      "type": "promptString",
      "id": "blueconic-oauth2-client-secret",
      "description": "BlueConic OAuth2.0 Client secret",
      "password": true
    }]
}
```

For local development:

```json
{
  "servers": {
    "blueconic": {
      "name": "BlueConic MCP Server",
      "description": "BlueConic MCP Server",
			"command": "npx",
			"args": [
        "tsx",
        "/path/to/blueconic-mcp-client/client-side-server.ts"
      ],
      "env": {
        "BLUECONIC_TENANT_URL": "${input:blueconic-tenant-url}",
        "OAUTH_CLIENT_ID": "${input:blueconic-oauth2-client-id}",
        "OAUTH_CLIENT_SECRET": "${input:blueconic-oauth2-client-secret}"
      }
    }
  },
  "inputs": [{
      "type": "promptString",
      "id": "blueconic-tenant-url",
      "description": "BlueConic tenant URL, e.g. https://mytenant.blueconic.net",
      "password": false
    }, {
      "type": "promptString",
      "id": "blueconic-oauth2-client-id",
      "description": "BlueConic OAuth2.0 Client ID",
      "password": true
    },{
      "type": "promptString",
      "id": "blueconic-oauth2-client-secret",
      "description": "BlueConic OAuth2.0 Client secret",
      "password": true
    }]
}
```

## Available Tools (Dynamic)

The server automatically discovers and exposes **ALL** API endpoints from your tenant's OpenAPI specification, such as:

- `/segments` - Retrieve all segments
- `/profiles` - Search profiles
- `/profiles/{profileId}` - Get one profile by ID
- `/segments/{segment}/profiles` - Get profiles from a segemnt
- And many more...

## Example Usage

Once configured, you can ask your AI assistant:

- *"Get all segments from my BlueConic tenant"*
- *"Show me profiles in the 'high-value-customers' segment"*
- *"Can you retrieve 1000 profiles from the allvisitors segment and tell me what stands out"*

The AI will automatically use the appropriate API endpoint with your credentials.

## Security Features

✅ **Client-side only** - No server infrastructure needed
✅ **Per-user credentials** - Each user's own OAuth tokens (Per BlueConic Application)
✅ **Dynamic scopes** - Uses whatever permissions the user's OAuth app has
✅ **Token caching** - Automatic refresh when tokens expire
✅ **Input validation** - Sanitizes all API parameters
✅ **HTTPS only** - Secure communication with your tenant

### Option A: Direct Installation
Users clone this repository and configure locally.

### Option B: NPM Package
Publish as a global package:

```bash
npm install -g @blueconic/blueconic-mcp
blueconic-mcp --tenant https://yourtenant.blueconic.net
```

## For BlueConic Customers

### Getting Your OAuth Credentials

1. Log into your BlueConic tenant
2. Navigate to **Settings > Access management > Applications**
3. Create a new application with "client credentials" and enable it
4. Grant the scopes you need (e.g., `read:segments`, `read:profiles`)
5. Copy the **Client ID** and **Client Secret**
6. Use these in your MCP configuration

### Required OAuth Scopes

The adapter works with any scopes your read OAuth application has.
Write scopes are not supported yet.

- `read:segments` - For segment operations
- `read:profiles` - For profile data
- `read:connections` - For connection management
- `read:interactions` - For interaction data

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Cursor/VS     │◄───┤  MCP Client     │◄───┤ BlueConic       │
│   Code Copilot  │    │  (Local)        │    │ Tenant API      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │ OpenAPI Spec    │
                       │ Auto-Discovery  │
                       └─────────────────┘
```

## Troubleshooting

### OpenAPI Spec Not Loading
- Verify your `BLUECONIC_TENANT_URL` is correct
- Check that `/rest/v2/openapi.json` is accessible
- Ensure network connectivity to your tenant

### OAuth Authentication Failed
- Verify client credentials are correct
- Check OAuth app has required scopes enabled
- Ensure token endpoint is accessible

### No Tools Appearing in AI Assistant
- Check server startup logs for errors
- Verify OpenAPI spec loaded successfully
- Restart Cursor/VS Code after configuration changes

## Usage Examples

**Explore your segments:**
> "List all segments in my BlueConic tenant and show me which ones have the most profiles."

**Analyze customer profiles:**
> "Get 100 profiles from the 'high-value-customers' segment and summarize the common attributes."

**Inspect connections and data flows:**
> "Show me all connections in my tenant and their recent run history. Are any failing?"

**Review dialogues and interactions:**
> "What dialogues are currently active? Show me the statistics for the top 3 by impressions."

**Audit tenant configuration:**
> "List all lifecycle stages and tell me how they're structured. Are there any that seem unused?"

## Packaging as Desktop Extension

To build a `.mcpb` bundle for Claude Desktop:

```bash
npm run pack
```

This compiles TypeScript and packages everything into a `.mcpb` file that can be installed in Claude Desktop.

## Privacy Policy

This MCP server runs entirely on your local machine. Your BlueConic credentials (tenant URL, client ID, client secret) are stored securely in your OS keychain when installed as a Claude Desktop Extension and are never transmitted to any third party. API calls are made directly from your machine to your BlueConic tenant. No data is collected, stored, or shared by this extension.

For BlueConic's privacy policy, see: https://www.blueconic.com/privacy-policy

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Support

- Documentation: https://support.blueconic.com/en/articles/415706-blueconic-mcp-client-for-ai-coding-assistants
- Issues: Report via your BlueConic support channel
- NPM Package: https://www.npmjs.com/package/@blueconic/blueconic-mcp
