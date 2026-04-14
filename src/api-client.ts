import { fetch } from "./http.js";

export type QueryParamScalar = boolean | number | string;
export type QueryParamValue = QueryParamScalar | QueryParamScalar[];
type FetchOptions = Parameters<typeof fetch>[1];

function appendQueryParams(url: URL, queryParams: Record<string, QueryParamValue>): void {
  for (const [key, value] of Object.entries(queryParams)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
      continue;
    }

    url.searchParams.set(key, String(value));
  }
}

/** Make an authenticated API call to BlueConic. */
export async function makeApiCall(
  tenantUrl: string,
  token: string,
  method: string,
  path: string,
  version: string,
  pathParams: Record<string, string> = {},
  queryParams: Record<string, QueryParamValue> = {},
  requestBody: unknown = null
): Promise<unknown> {
  if (!token) {
    throw new Error("OAuth access token not configured");
  }

  let finalPath = path;
  for (const [key, value] of Object.entries(pathParams)) {
    finalPath = finalPath.replace(`{${key}}`, encodeURIComponent(value));
  }

  const url = new URL(`/rest/v2${finalPath}`, `${tenantUrl}/`);
  appendQueryParams(url, queryParams);

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "User-Agent": `BlueConic-MCP-Client/${version}`,
    "X-BlueConic-MCP-Tool-Call": method,
    "Accept": "application/json, text/plain;q=0.9, */*;q=0.8"
  };

  const fetchOptions: FetchOptions = {
    method,
    headers
  };

  if (requestBody !== null && ["POST", "PUT", "PATCH"].includes(method)) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(requestBody);
  }

  console.error(`Making ${method} request to: ${url.toString()}`);
  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API call failed: ${response.status} ${response.statusText}. ${errorText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }

  if (
    contentType.startsWith("text/") ||
    contentType.includes("application/xml") ||
    contentType.includes("image/svg+xml")
  ) {
    return await response.text();
  }

  const responseBuffer = Buffer.from(await response.arrayBuffer());
  return {
    contentType: contentType || "application/octet-stream",
    base64: responseBuffer.toString("base64")
  };
}
