import { createHash } from "node:crypto";

import { fetchWithTimeout } from "./http.js";
import { BlueConicConfigError, BlueConicHttpError } from "./errors.js";

type CachedToken = {
  accessToken: string;
  tokenExpiry: number;
};

const tokenCache = new Map<string, CachedToken>();

function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes)].sort();
}

function createCredentialKey(
  tenantUrl: string,
  clientId: string,
  clientSecret: string,
  scopes: readonly string[]
): string {
  const normalizedScopes = normalizeScopes(scopes).join(" ");
  const credentialHash = createHash("sha256")
    .update(`${clientId.length}:${clientId}:${clientSecret}`)
    .digest("hex");
  return `${tenantUrl}::${credentialHash}::${normalizedScopes}`;
}

/** Get an OAuth2 access token using the client credentials flow. */
export async function getAccessToken(
  tenantUrl: string,
  clientId: string,
  clientSecret: string,
  scopes: readonly string[] = []
): Promise<string> {
  if (!tenantUrl || !clientId || !clientSecret) {
    throw new BlueConicConfigError("OAuth credentials or tenant URL not configured");
  }

  const credentialKey = createCredentialKey(tenantUrl, clientId, clientSecret, scopes);
  const cachedToken = tokenCache.get(credentialKey);
  if (cachedToken && Date.now() < cachedToken.tokenExpiry) {
    return cachedToken.accessToken;
  }

  const requestBody = new URLSearchParams({
    grant_type: "client_credentials"
  });

  const normalizedScopes = normalizeScopes(scopes);
  if (normalizedScopes.length > 0) {
    requestBody.set("scope", normalizedScopes.join(" "));
  }

  const response = await fetchWithTimeout(`${tenantUrl}/rest/v2/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
    },
    body: requestBody.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new BlueConicHttpError("BlueConic OAuth token request failed", {
      operation: "POST /rest/v2/oauth/token",
      responseBody: errorText,
      status: response.status,
      statusText: response.statusText
    });
  }

  const tokenData = await response.json() as { access_token: string; expires_in?: number };
  const expiresInSeconds = tokenData.expires_in ?? 3600;
  tokenCache.set(credentialKey, {
    accessToken: tokenData.access_token,
    tokenExpiry: Date.now() + (expiresInSeconds * 1000 * 0.9)
  });

  return tokenData.access_token;
}
