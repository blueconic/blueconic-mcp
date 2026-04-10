import { fetch } from "undici";

let accessToken: string | null = null;
let tokenExpiry: number | null = null;

/** Get OAuth2 access token using client credentials flow. */
async function getAccessToken(
  tenantUrl: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  if (!tenantUrl || !clientId || !clientSecret) {
    throw new Error("OAuth credentials or tenant URL not configured");
  }

  // Return cached token if still valid.
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  try {
    const dispatcher = process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
      ? (await import("undici")).getGlobalDispatcher()
      : undefined;
    const response = await fetch(`${tenantUrl}/rest/v2/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
      },
      body: "grant_type=client_credentials&scope=read:segments read:profiles read:connections read:interactions",
      dispatcher
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OAuth token request failed: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const tokenData = await response.json() as { access_token: string; expires_in?: number };
    accessToken = tokenData.access_token;

    // Set expiry to 90% of actual expiry.
    const expiresIn = tokenData.expires_in || 3600;
    tokenExpiry = Date.now() + (expiresIn * 900);

    return accessToken!;
  } catch (error: any) {
    console.error("Failed to get OAuth token:", error.message);
    throw error;
  }
}

export { getAccessToken };
