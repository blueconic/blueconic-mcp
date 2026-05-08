import { fetchWithTimeout } from "./http.js";
import { BlueConicConfigError, BlueConicHttpError } from "./errors.js";

export type QueryParamScalar = boolean | number | string;
export type QueryParamValue = QueryParamScalar | QueryParamScalar[];
export type RequestBodyContentType =
  | "application/json"
  | "application/x-www-form-urlencoded"
  | "multipart/form-data";
export type ExistingConfigurationRetentionPolicy = {
  ignoredReadStatuses?: readonly number[];
  readPath: string;
  readQueryFromRequestBodyItems?: {
    count?: number;
    itemIdField: string;
    operator?: "=" | "==";
    queryParam: string;
  };
  readResponseBodyPath?: readonly string[];
  readToolName: string;
  requestBodyAllowedFields?: readonly string[];
  requestBodyPath?: readonly string[];
  requestBodySchema?: Record<string, unknown>;
  requiredScopes?: readonly string[];
};
type FetchOptions = NonNullable<Parameters<typeof fetchWithTimeout>[1]>;
type BinaryFormValue = {
  base64: string;
  contentType?: string;
  filename?: string;
};
const DEFAULT_IGNORED_EXISTING_CONFIGURATION_STATUSES = [404] as const;
const SERVER_MANAGED_FIELD_NAMES = new Set([
  "canDelete",
  "creationDate",
  "creator",
  "favorite",
  "filterTypeSuggestion",
  "imageURL",
  "itemCount",
  "itemsPerPage",
  "lastModifiedDate",
  "lastModifiedUser",
  "lastProfileMutationDate",
  "links",
  "modelHash",
  "modelUrl",
  "profileCount",
  "readOnly",
  "startIndex",
  "statistics",
  "totalPages",
  "totalProfileCount",
  "totalResults"
]);

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

function getPathValue(value: unknown, path: readonly string[] = []): unknown {
  return path.reduce<unknown>((currentValue, segment) => {
    if (!isPlainObject(currentValue)) {
      return undefined;
    }

    return currentValue[segment];
  }, value);
}

function setPathValue(value: unknown, path: readonly string[] = [], pathValue: unknown): unknown {
  if (path.length === 0) {
    return pathValue;
  }

  const [segment, ...remainingPath] = path;
  const nextValue = isPlainObject(value) ? { ...value } : {};
  nextValue[segment] = setPathValue(nextValue[segment], remainingPath, pathValue);
  return nextValue;
}

function getObjectId(value: unknown, idField: string): string | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const idValue = value[idField];
  if (typeof idValue !== "string" && typeof idValue !== "number") {
    return undefined;
  }

  return String(idValue);
}

function mergeArrayByObjectId(existingValues: unknown[], patchValues: unknown[]): unknown[] | undefined {
  const patchEntries = patchValues
    .map((value, index) => ({ id: getObjectId(value, "id"), index, value }))
    .filter((entry): entry is { id: string; index: number; value: unknown } => entry.id !== undefined);

  if (patchEntries.length !== patchValues.length) {
    return undefined;
  }

  const patchEntriesById = new Map(patchEntries.map((entry) => [entry.id, entry]));
  const mergedValues = existingValues.map((existingValue) => {
    const existingId = getObjectId(existingValue, "id");
    const patchEntry = existingId ? patchEntriesById.get(existingId) : undefined;

    if (!patchEntry) {
      return existingValue;
    }

    patchEntriesById.delete(patchEntry.id);
    return mergeConfiguration(existingValue, patchEntry.value);
  });

  return [
    ...mergedValues,
    ...[...patchEntriesById.values()]
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.value)
  ];
}

function mergeConfiguration(existingValue: unknown, patchValue: unknown): unknown {
  if (patchValue === undefined) {
    return existingValue;
  }

  if (Array.isArray(existingValue) && Array.isArray(patchValue)) {
    if (patchValue.length === 0) {
      return [];
    }

    return mergeArrayByObjectId(existingValue, patchValue) ?? patchValue;
  }

  if (isPlainObject(existingValue) && isPlainObject(patchValue)) {
    const mergedValue: Record<string, unknown> = { ...existingValue };

    for (const [key, value] of Object.entries(patchValue)) {
      mergedValue[key] = mergeConfiguration(existingValue[key], value);
    }

    return mergedValue;
  }

  return patchValue;
}

function getSchemaProperty(schema: unknown, key: string): Record<string, unknown> | undefined {
  if (!isPlainObject(schema) || !isPlainObject(schema.properties)) {
    return undefined;
  }

  const propertySchema = schema.properties[key];
  return isPlainObject(propertySchema) ? propertySchema : undefined;
}

function stripReadOnlyFields(value: unknown, schema: unknown): unknown {
  if (isPlainObject(schema) && schema.readOnly === true) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const itemSchema = isPlainObject(schema) ? schema.items : undefined;
    return value
      .map((item) => stripReadOnlyFields(item, itemSchema))
      .filter((item) => item !== undefined);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const strippedValue: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    const fieldSchema = getSchemaProperty(schema, key);

    if (SERVER_MANAGED_FIELD_NAMES.has(key) || fieldSchema?.readOnly === true) {
      continue;
    }

    const strippedFieldValue = stripReadOnlyFields(fieldValue, fieldSchema);
    if (strippedFieldValue !== undefined) {
      strippedValue[key] = strippedFieldValue;
    }
  }

  return strippedValue;
}

function keepAllowedFields(value: unknown, allowedFields?: readonly string[]): unknown {
  if (!allowedFields || !isPlainObject(value)) {
    return value;
  }

  const allowedFieldSet = new Set(allowedFields);
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => allowedFieldSet.has(key))
  );
}

function sanitizeRetainedRequestBody(
  requestBody: unknown,
  policy: ExistingConfigurationRetentionPolicy
): unknown {
  const strippedRequestBody = stripReadOnlyFields(requestBody, policy.requestBodySchema);
  const allowedFields = policy.requestBodyAllowedFields;

  if (!allowedFields) {
    return strippedRequestBody;
  }

  const requestBodyPath = policy.requestBodyPath ?? [];
  const selectedValue = getPathValue(strippedRequestBody, requestBodyPath);
  const sanitizedSelection = Array.isArray(selectedValue)
    ? selectedValue.map((item) => keepAllowedFields(item, allowedFields))
    : keepAllowedFields(selectedValue, allowedFields);

  return setPathValue(strippedRequestBody, requestBodyPath, sanitizedSelection);
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

function resolvePath(path: string, pathParams: Record<string, string>): string {
  let finalPath = path;
  for (const [key, value] of Object.entries(pathParams)) {
    finalPath = finalPath.replace(`{${key}}`, encodeURIComponent(value));
  }

  return finalPath;
}

export function buildApiUrl(
  tenantUrl: string,
  path: string,
  pathParams: Record<string, string>,
  queryParams: Record<string, QueryParamValue>
): { finalPath: string; url: URL } {
  const finalPath = resolvePath(path, pathParams);
  const url = new URL(`/rest/v2${finalPath}`, `${tenantUrl}/`);
  appendQueryParams(url, queryParams);

  return { finalPath, url };
}

function buildHeaders(version: string, toolName: string, token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": `BlueConic-MCP-Client/${version}`,
    "X-BlueConic-MCP-Tool-Call": toolName,
    "Accept": "application/json, text/plain;q=0.9, */*;q=0.8"
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}

async function parseResponseBody(response: Response): Promise<unknown> {
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

async function readExistingConfiguration(
  tenantUrl: string,
  token: string | null,
  version: string,
  pathParams: Record<string, string>,
  policy: ExistingConfigurationRetentionPolicy,
  queryParams: Record<string, QueryParamValue> = {}
): Promise<unknown | undefined> {
  const { finalPath, url } = buildApiUrl(tenantUrl, policy.readPath, pathParams, queryParams);
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: buildHeaders(version, policy.readToolName, token)
  });

  const ignoredStatuses = policy.ignoredReadStatuses ?? DEFAULT_IGNORED_EXISTING_CONFIGURATION_STATUSES;
  if (!response.ok) {
    if (ignoredStatuses.includes(response.status)) {
      return undefined;
    }

    const errorText = await response.text();
    throw new BlueConicHttpError("BlueConic API request failed", {
      operation: `GET ${finalPath}`,
      responseBody: errorText,
      status: response.status,
      statusText: response.statusText
    });
  }

  return await parseResponseBody(response);
}

function buildExistingItemQuery(
  requestedItem: unknown,
  policy: ExistingConfigurationRetentionPolicy
): Record<string, QueryParamValue> | undefined {
  const itemReadPolicy = policy.readQueryFromRequestBodyItems;
  if (!itemReadPolicy) {
    return undefined;
  }

  const itemId = getObjectId(requestedItem, itemReadPolicy.itemIdField);
  if (!itemId) {
    return undefined;
  }

  return {
    [itemReadPolicy.queryParam]: `${itemReadPolicy.itemIdField}${itemReadPolicy.operator ?? "="}${itemId}`,
    ...(itemReadPolicy.count ? { count: itemReadPolicy.count } : {})
  };
}

async function readExistingConfigurationSelection(
  tenantUrl: string,
  token: string | null,
  version: string,
  pathParams: Record<string, string>,
  requestBody: unknown,
  policy: ExistingConfigurationRetentionPolicy
): Promise<unknown | undefined> {
  const requestBodyPath = policy.requestBodyPath ?? [];
  const requestBodySelection = getPathValue(requestBody, requestBodyPath);

  if (policy.readQueryFromRequestBodyItems && Array.isArray(requestBodySelection)) {
    const existingItems: unknown[] = [];

    for (const requestedItem of requestBodySelection) {
      const existingItemQuery = buildExistingItemQuery(requestedItem, policy);
      if (!existingItemQuery) {
        continue;
      }

      const existingConfiguration = await readExistingConfiguration(
        tenantUrl,
        token,
        version,
        pathParams,
        policy,
        existingItemQuery
      );
      const existingSelection = getPathValue(existingConfiguration, policy.readResponseBodyPath ?? []);
      const existingItem = Array.isArray(existingSelection)
        ? existingSelection.find((candidate) =>
          getObjectId(candidate, policy.readQueryFromRequestBodyItems?.itemIdField ?? "id") ===
          getObjectId(requestedItem, policy.readQueryFromRequestBodyItems?.itemIdField ?? "id")
        )
        : undefined;

      if (existingItem !== undefined) {
        existingItems.push(existingItem);
      }
    }

    return existingItems.length > 0 ? existingItems : undefined;
  }

  const existingConfiguration = await readExistingConfiguration(tenantUrl, token, version, pathParams, policy);
  return getPathValue(existingConfiguration, policy.readResponseBodyPath ?? []);
}

async function retainExistingConfiguration(
  tenantUrl: string,
  token: string | null,
  version: string,
  pathParams: Record<string, string>,
  requestBody: unknown,
  policy: ExistingConfigurationRetentionPolicy
): Promise<unknown> {
  const existingSelection = await readExistingConfigurationSelection(
    tenantUrl,
    token,
    version,
    pathParams,
    requestBody,
    policy
  );

  if (existingSelection === undefined) {
    return sanitizeRetainedRequestBody(requestBody, policy);
  }

  const requestBodyPath = policy.requestBodyPath ?? [];
  const requestBodySelection = getPathValue(requestBody, requestBodyPath);
  const mergedSelection = mergeConfiguration(existingSelection, requestBodySelection);
  const mergedRequestBody = setPathValue(requestBody, requestBodyPath, mergedSelection);

  return sanitizeRetainedRequestBody(mergedRequestBody, policy);
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
  requiresAuth = true,
  existingConfigurationRetentionPolicy?: ExistingConfigurationRetentionPolicy,
  existingConfigurationToken: string | null = token
): Promise<unknown> {
  if (requiresAuth && !token) {
    throw new BlueConicConfigError("OAuth access token not configured");
  }

  const { finalPath, url } = buildApiUrl(tenantUrl, path, pathParams, queryParams);
  const headers = buildHeaders(version, toolName, token);

  const fetchOptions: FetchOptions = {
    method,
    headers
  };

  let finalRequestBody = requestBody;
  if (finalRequestBody !== null && existingConfigurationRetentionPolicy) {
    finalRequestBody = await retainExistingConfiguration(
      tenantUrl,
      existingConfigurationToken,
      version,
      pathParams,
      finalRequestBody,
      existingConfigurationRetentionPolicy
    );
  }

  if (finalRequestBody !== null && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    attachRequestBody(fetchOptions, headers, finalRequestBody, requestBodyContentType);
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

  return await parseResponseBody(response);
}
