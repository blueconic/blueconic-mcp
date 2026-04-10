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
    const response = await fetch(`${tenantUrl}/rest/v2/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
      },
      body: "grant_type=client_credentials&scope=read:segments read:profiles read:connections read:interactions"
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OAuth token request failed: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const tokenData = await response.json() as { access_token: string; expires_in?: number };
    accessToken = tokenData.access_token;

    // Set expiry to 90% of actual expiry (seconds * 1000 * 0.9).
    const expiresIn = tokenData.expires_in || 3600;
    tokenExpiry = Date.now() + (expiresIn * 1000 * 0.9);

    return accessToken!;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to get OAuth token:", message);
    throw error;
  }
}

export { getAccessToken };
