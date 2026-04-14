import { fetch } from "./http.js";

let accessToken: string | null = null;
let cachedCredentialKey: string | null = null;
let tokenExpiry: number | null = null;

/** Get an OAuth2 access token using the client credentials flow. */
export async function getAccessToken(
  tenantUrl: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  if (!tenantUrl || !clientId || !clientSecret) {
    throw new Error("OAuth credentials or tenant URL not configured");
  }

  const credentialKey = `${tenantUrl}::${clientId}`;
  if (accessToken && tokenExpiry && cachedCredentialKey === credentialKey && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const response = await fetch(`${tenantUrl}/rest/v2/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "read:segments read:profiles read:connections read:interactions"
    }).toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OAuth token request failed: ${response.status} ${response.statusText}. ${errorText}`);
  }

  const tokenData = await response.json() as { access_token: string; expires_in?: number };
  accessToken = tokenData.access_token;
  cachedCredentialKey = credentialKey;

  const expiresInSeconds = tokenData.expires_in ?? 3600;
  tokenExpiry = Date.now() + (expiresInSeconds * 1000 * 0.9);

  return accessToken;
}
