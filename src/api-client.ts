/** Make authenticated API call to BlueConic */
export async function makeApiCall(
  tenantUrl: string,
  token: string,
  method: string,
  path: string,
  version: string,
  pathParams: Record<string, string> = {},
  queryParams: Record<string, string> = {},
  requestBody: unknown = null
): Promise<unknown> {
  // Replace path parameters
  let finalPath = path;
  for (const [key, value] of Object.entries(pathParams)) {
    finalPath = finalPath.replace(`{${key}}`, encodeURIComponent(value));
  }

  // Add query parameters
  const queryString = new URLSearchParams(queryParams).toString();
  const url = `${tenantUrl}/rest/v2${finalPath}${queryString ? `?${queryString}` : ""}`;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "User-Agent": `BlueConic-MCP-Client/${version}`,
    "X-BlueConic-MCP-Tool-Call": method
  };

  let parseResponseAsJson = false;
  if (!path.endsWith("/model")) {
    headers["Accept"] = "application/json";
    parseResponseAsJson = true;
  }

  const fetchOptions: RequestInit = {
    method: method,
    headers
  };

  if (requestBody && ["POST", "PUT", "PATCH"].includes(method)) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(requestBody);
  }

  try {
    console.error(`Making ${method} request to: ${url}`);
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API call failed: ${response.status} ${response.statusText}. ${errorText}`);
    }

    if (parseResponseAsJson) {
      return await response.json();
    }
    return await response.arrayBuffer();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to call ${method} ${path}:`, message);
    throw error;
  }
}
