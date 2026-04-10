import { fetch } from "undici";


// Use require for compatibility with Jest/ts-jest
const packageJson: { version: string } = { version: "0.0.1" };
try {
  // @ts-ignore
  packageJson = require('./package.json');
} catch (e) {
  // fallback for environments where require is not available
}

/** Make authenticated API call to BlueConic */
export async function makeApiCall(
  tenantUrl: string,
  token: string,
  method: string,
  path: string,
  pathParams: Record<string, string> = {},
  queryParams: Record<string, string> = {},
  requestBody: any = null
): Promise<any> {
  // Replace path parameters
  let finalPath = path;
  for (const [key, value] of Object.entries(pathParams)) {
    finalPath = finalPath.replace(`{${key}}`, encodeURIComponent(value));
  }

  // Add query parameters
  const queryString = new URLSearchParams(queryParams).toString();
  const url = `${tenantUrl}/rest/v2${finalPath}${queryString ? `?${queryString}` : ""}`;

  const fetchOptions: any = {
    method: method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "User-Agent": `BlueConic-MCP-Client/${packageJson.version}`,
      "X-BlueConic-MCP-Tool-Call": method
    }
  };

  let parseResponseAsJson = false;
  if (!path.endsWith("/model")) {
    // For almost all endpoints, we expect JSON responses
    fetchOptions.headers["Accept"] = "application/json";
    parseResponseAsJson = true;
  }

  if (requestBody && ["POST", "PUT", "PATCH"].includes(method)) {
    fetchOptions.headers["Content-Type"] = "application/json";
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
  } catch (error: any) {
    console.error(`Failed to call ${method} ${path}:`, error.message, error);
    throw error;
  }
}
