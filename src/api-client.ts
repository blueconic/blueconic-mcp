import { fetchWithTimeout } from "./http.js";
import { BlueConicConfigError, BlueConicHttpError } from "./errors.js";

export type QueryParamScalar = boolean | number | string;
export type QueryParamValue = QueryParamScalar | QueryParamScalar[];
export type RequestBodyContentType =
  | "application/json"
  | "application/x-www-form-urlencoded"
  | "multipart/form-data";
type FetchOptions = NonNullable<Parameters<typeof fetchWithTimeout>[1]>;
type BinaryFormValue = {
  base64: string;
  contentType?: string;
  filename?: string;
};

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBinaryFormValue(value: unknown): value is BinaryFormValue {
  return isPlainObject(value) && typeof value.base64 === "string";
}

function serializeFormValue(value: unknown): string {
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return String(value);
  }

  return JSON.stringify(value);
}

function buildUrlEncodedBody(requestBody: unknown): URLSearchParams {
  if (!isPlainObject(requestBody)) {
    return new URLSearchParams();
  }

  const formBody = new URLSearchParams();
  for (const [key, value] of Object.entries(requestBody)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        formBody.append(key, serializeFormValue(item));
      }
      continue;
    }

    formBody.set(key, serializeFormValue(value));
  }

  return formBody;
}

function buildMultipartBody(requestBody: unknown): FormData {
  const formBody = new FormData();
  if (!isPlainObject(requestBody)) {
    return formBody;
  }

  for (const [key, value] of Object.entries(requestBody)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (isBinaryFormValue(value)) {
      const contentType = value.contentType ?? "application/octet-stream";
      const binaryBlob = new Blob([Buffer.from(value.base64, "base64")], { type: contentType });
      formBody.append(key, binaryBlob, value.filename ?? key);
      continue;
    }

    if (isPlainObject(value) || Array.isArray(value)) {
      formBody.append(key, new Blob([JSON.stringify(value)], { type: "application/json" }));
      continue;
    }

    formBody.append(key, String(value));
  }

  return formBody;
}

function attachRequestBody(
  fetchOptions: FetchOptions,
  headers: Record<string, string>,
  requestBody: unknown,
  requestBodyContentType: RequestBodyContentType
): void {
  if (requestBodyContentType === "application/json") {
    headers["Content-Type"] = requestBodyContentType;
    fetchOptions.body = JSON.stringify(requestBody);
    return;
  }

  if (requestBodyContentType === "application/x-www-form-urlencoded") {
    headers["Content-Type"] = requestBodyContentType;
    fetchOptions.body = buildUrlEncodedBody(requestBody).toString();
    return;
  }

  fetchOptions.body = buildMultipartBody(requestBody);
}

/** Make an authenticated API call to BlueConic. */
export async function makeApiCall(
  tenantUrl: string,
  token: string | null,
  method: string,
  path: string,
  version: string,
  toolName: string,
  pathParams: Record<string, string> = {},
  queryParams: Record<string, QueryParamValue> = {},
  requestBody: unknown = null,
  requestBodyContentType: RequestBodyContentType = "application/json",
  requiresAuth = true
): Promise<unknown> {
  if (requiresAuth && !token) {
    throw new BlueConicConfigError("OAuth access token not configured");
  }

  let finalPath = path;
  for (const [key, value] of Object.entries(pathParams)) {
    finalPath = finalPath.replace(`{${key}}`, encodeURIComponent(value));
  }

  const url = new URL(`/rest/v2${finalPath}`, `${tenantUrl}/`);
  appendQueryParams(url, queryParams);

  const headers: Record<string, string> = {
    "User-Agent": `BlueConic-MCP-Client/${version}`,
    "X-BlueConic-MCP-Tool-Call": toolName,
    "Accept": "application/json, text/plain;q=0.9, */*;q=0.8"
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const fetchOptions: FetchOptions = {
    method,
    headers
  };

  if (requestBody !== null && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    attachRequestBody(fetchOptions, headers, requestBody, requestBodyContentType);
  }

  const response = await fetchWithTimeout(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    throw new BlueConicHttpError("BlueConic API request failed", {
      operation: `${method} ${finalPath}`,
      responseBody: errorText,
      status: response.status,
      statusText: response.statusText
    });
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
