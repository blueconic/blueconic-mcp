import { fetchWithTimeout } from "./http.js";
import { BlueConicHttpError } from "./errors.js";

export type InputSchema = {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  type: "object";
};

type OpenApiParameter = {
  description?: string;
  in?: string;
  name: string;
  required?: boolean;
  schema?: Record<string, unknown>;
};

type OpenApiOperation = {
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, { schema?: Record<string, unknown> }>;
    required?: boolean;
  };
  security?: Array<Record<string, string[]>>;
  summary?: string;
};

type OpenApiSpec = {
  components?: {
    schemas?: Record<string, Record<string, unknown>>;
  };
  paths?: Record<string, Record<string, OpenApiOperation>>;
};

export const SUPPORTED_HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
const REQUEST_BODY_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data"
] as const;

type SupportedHttpMethod = typeof SUPPORTED_HTTP_METHODS[number];
type RequestBodyContentType = typeof REQUEST_BODY_CONTENT_TYPES[number];
type ApprovedOperationPolicy = {
  method: SupportedHttpMethod;
  operationId: string;
  path: string;
  /** Set to false only for reviewed OpenAPI operations that intentionally do not use OAuth. */
  requiresAuth?: boolean;
  requiredScopes: readonly string[];
};

export type DynamicTool = {
  annotations: {
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
    readOnlyHint: boolean;
  };
  description: string;
  inputSchema: InputSchema;
  method: string;
  name: string;
  path: string;
  requestBodyContentType?: RequestBodyContentType;
  requiredScopes: string[];
  requiresAuth: boolean;
};

export let tools: DynamicTool[] = [];

// Claude connector review requires the callable surface to be explicit.
// The list below is the reviewed BlueConic REST API v2 tool surface from the current OpenAPI definition.
// OAuth management endpoints are intentionally excluded because auth plumbing should not be model-callable.
// New BlueConic operations do not become MCP tools until they are reviewed and added here.
export const APPROVED_OPERATION_POLICIES = [
  { method: "get", path: "/auditEvents", operationId: "getAuditEvents", requiredScopes: ["read:audit-events"] },
  {
    method: "get",
    path: "/contentStores/{contentStore}/items",
    operationId: "getContentItemsFromStore",
    requiredScopes: ["read:content_stores"]
  },
  {
    method: "put",
    path: "/contentStores/{contentStore}/items",
    operationId: "addContentItemsToStore",
    requiredScopes: ["write:content_stores"]
  },
  { method: "get", path: "/contentStores", operationId: "getAllContentStores", requiredScopes: ["read:content_stores"] },
  { method: "post", path: "/contentStores", operationId: "createContentStore", requiredScopes: ["write:content_stores"] },
  {
    method: "delete",
    path: "/contentStores/{contentStore}/items/bulk",
    operationId: "deleteContentItemsFromStore",
    requiredScopes: ["write:content_stores"]
  },
  {
    method: "put",
    path: "/contentStores/{contentStore}",
    operationId: "updateContentStore",
    requiredScopes: ["write:content_stores"]
  },
  { method: "get", path: "/connections", operationId: "getAllConnections", requiredScopes: ["read:connections"] },
  { method: "get", path: "/connections/{connection}", operationId: "getOneConnection", requiredScopes: ["read:connections"] },
  {
    method: "get",
    path: "/connections/{connection}/runs",
    operationId: "getConnectionRuns",
    requiredScopes: ["read:connections"]
  },
  { method: "get", path: "/dialogues", operationId: "getAllDialogues", requiredScopes: ["read:dialogues"] },
  { method: "get", path: "/dialogues/{dialogue}", operationId: "getOneDialogue", requiredScopes: ["read:dialogues"] },
  { method: "get", path: "/listeners", operationId: "getAllListeners", requiredScopes: ["read:listeners"] },
  { method: "get", path: "/listeners/{listener}", operationId: "getOneListener", requiredScopes: ["read:listeners"] },
  { method: "get", path: "/plugins/{plugin}", operationId: "getOnePlugin", requiredScopes: ["read:plugins"] },
  { method: "get", path: "/plugins", operationId: "getAllPlugins", requiredScopes: ["read:plugins"] },
  { method: "get", path: "/channels", operationId: "getAllChannels", requiredScopes: ["read:channels"] },
  { method: "get", path: "/channels/{channelId}", operationId: "getOneChannel", requiredScopes: ["read:channels"] },
  { method: "post", path: "/interactionEvents", operationId: "createEvent", requiresAuth: false, requiredScopes: [] },
  { method: "get", path: "/interactions", operationId: "getInteractions", requiresAuth: false, requiredScopes: [] },
  {
    method: "post",
    path: "/pageviewEvents",
    operationId: "createPageviewEvent",
    requiresAuth: false,
    requiredScopes: []
  },
  { method: "get", path: "/lifecycles", operationId: "getAllLifecycles", requiredScopes: ["read:lifecycles"] },
  { method: "get", path: "/lifecycles/{lifecycle}", operationId: "getOneLifecycle", requiredScopes: ["read:lifecycles"] },
  { method: "get", path: "/models", operationId: "getAllModels", requiredScopes: ["read:models"] },
  { method: "post", path: "/models", operationId: "createModel", requiredScopes: ["write:models"] },
  { method: "get", path: "/models/{model}", operationId: "getOneModelMetadata", requiredScopes: ["read:models"] },
  { method: "put", path: "/models/{model}", operationId: "updateModel", requiredScopes: ["write:models"] },
  { method: "delete", path: "/models/{model}", operationId: "deleteModel", requiredScopes: ["write:models"] },
  { method: "get", path: "/models/{model}/model", operationId: "getModelONNXBinary", requiredScopes: ["read:models"] },
  { method: "get", path: "/objectives", operationId: "getAllObjectives", requiredScopes: ["read:objectives"] },
  { method: "get", path: "/objectives/{objective}", operationId: "getOneObjective", requiredScopes: ["read:objectives"] },
  {
    method: "get",
    path: "/groups/{grouptype}/{group}",
    operationId: "getOneGroupOfGroupType",
    requiredScopes: ["read:groups"]
  },
  {
    method: "get",
    path: "/groups/{grouptype}",
    operationId: "getAllGroupsByGroupType",
    requiredScopes: ["read:groups"]
  },
  { method: "put", path: "/groups", operationId: "createUpdateDeleteGroups", requiredScopes: ["write:groups"] },
  { method: "get", path: "/groupTypes", operationId: "getAllGroupTypes", requiredScopes: ["read:group-types"] },
  {
    method: "get",
    path: "/profileEvents/{profileId}",
    operationId: "getProfileEvents",
    requiredScopes: ["read:profiles"]
  },
  {
    method: "get",
    path: "/profileProperties/{propertyId}",
    operationId: "getOneProfileOrGroupProperty",
    requiredScopes: ["read:profile-properties"]
  },
  {
    method: "put",
    path: "/profileProperties/{propertyId}",
    operationId: "createUpdateProfileOrGroupProperty",
    requiredScopes: ["write:profile-properties"]
  },
  {
    method: "delete",
    path: "/profileProperties/{propertyId}",
    operationId: "deleteProfileOrGroupProperty",
    requiredScopes: ["write:profile-properties"]
  },
  {
    method: "get",
    path: "/profileProperties",
    operationId: "getAllProfileOrGroupProperties",
    requiredScopes: ["read:profile-properties"]
  },
  { method: "get", path: "/profiles", operationId: "searchProfiles", requiredScopes: ["read:profiles"] },
  { method: "put", path: "/profiles", operationId: "createUpdateDeleteProfiles", requiredScopes: ["write:profiles"] },
  { method: "get", path: "/profiles/{profileId}", operationId: "getOneProfile", requiredScopes: ["read:profiles"] },
  {
    method: "get",
    path: "/segments/{segment}/profiles",
    operationId: "getProfilesInSegment",
    requiredScopes: ["read:segments"]
  },
  { method: "get", path: "/segments", operationId: "getAllSegments", requiredScopes: ["read:segments"] },
  {
    method: "get",
    path: "/timelineEventTypes/{timelineEventType}",
    operationId: "getOneTimelineEventType",
    requiredScopes: ["read:timeline-event-types"]
  },
  {
    method: "get",
    path: "/timelineEventTypes",
    operationId: "getTimelineEventTypes",
    requiredScopes: ["read:timeline-event-types"]
  },
  {
    method: "post",
    path: "/recommendations",
    operationId: "getRecommendationsPostJsonpAsync",
    requiresAuth: false,
    requiredScopes: []
  },
  { method: "get", path: "/reporting/dialogues", operationId: "getDialogueStatistics", requiredScopes: ["read:dialogues"] },
  {
    method: "get",
    path: "/timelineEventRollups",
    operationId: "getAllRollups",
    requiredScopes: ["read:timeline_event_rollups"]
  },
  {
    method: "get",
    path: "/timelineEventRollups/{rollup}",
    operationId: "getOneRollup",
    requiredScopes: ["read:timeline_event_rollups"]
  },
  { method: "post", path: "/urlmappings", operationId: "createURLMapping", requiredScopes: ["write:url-mappings"] },
  { method: "get", path: "/urlmappings/{id}", operationId: "getOneURLMapping", requiredScopes: ["read:url-mappings"] },
  { method: "put", path: "/urlmappings/{id}", operationId: "updateURLMapping", requiredScopes: ["write:url-mappings"] },
  { method: "get", path: "/roles", operationId: "getAllRoles", requiredScopes: ["read:roles"] },
  { method: "get", path: "/roles/{role}", operationId: "getOneRole", requiredScopes: ["read:roles"] },
  { method: "get", path: "/users", operationId: "getAllUsers", requiredScopes: ["read:users"] },
  { method: "get", path: "/users/{user}", operationId: "getOneUser", requiredScopes: ["read:users"] },
  { method: "get", path: "/notebooks", operationId: "getAllNotebooks", requiredScopes: ["read:notebooks"] },
  { method: "get", path: "/notebooks/{notebook}", operationId: "getOneNotebook", requiredScopes: ["read:notebooks"] },
  {
    method: "get",
    path: "/notebooks/{notebook}/runs",
    operationId: "getNotebookRunHistory",
    requiredScopes: ["read:notebooks"]
  }
] as const satisfies readonly ApprovedOperationPolicy[];

/** Load the OpenAPI specification from the user's tenant. */
export async function loadOpenApiSpec(tenantUrl?: string, version = "0.0.0"): Promise<void> {
  if (!tenantUrl) {
    return;
  }

  const openApiSpecUrl = new URL("/rest/v2/openapi.json?prettyPrint=true", `${tenantUrl}/`);
  console.error("Loading BlueConic OpenAPI specification");

  const response = await fetchWithTimeout(openApiSpecUrl, {
    headers: {
      "Accept": "application/json",
      "User-Agent": `BlueConic-MCP-Client/${version}`
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new BlueConicHttpError("Failed to load OpenAPI spec", {
      operation: "GET /rest/v2/openapi.json",
      responseBody: errorText,
      status: response.status,
      statusText: response.statusText
    });
  }

  const openApiSpec = await response.json() as OpenApiSpec;
  generateToolsFromSpec(openApiSpec);

  console.error(`Loaded ${tools.length} approved OpenAPI operations as MCP tools`);
}

function isSupportedHttpMethod(method: string): method is SupportedHttpMethod {
  return SUPPORTED_HTTP_METHODS.includes(method.toLowerCase() as SupportedHttpMethod);
}

function getApprovedOperationPolicy(
  path: string,
  method: string,
  operation: OpenApiOperation
): ApprovedOperationPolicy | undefined {
  if (!isSupportedHttpMethod(method)) {
    return undefined;
  }

  const normalizedMethod = method.toLowerCase() as SupportedHttpMethod;
  return APPROVED_OPERATION_POLICIES.find((policy) =>
    policy.path === path &&
    policy.method === normalizedMethod &&
    policy.operationId === operation.operationId
  );
}

export function filterApprovedOpenApiSpec(openApiSpec: OpenApiSpec): OpenApiSpec {
  if (!openApiSpec.paths) {
    return {
      ...openApiSpec,
      paths: {}
    };
  }

  const filteredPaths = Object.fromEntries(
    Object.entries(openApiSpec.paths).flatMap(([path, pathDefinition]) => {
      const approvedOperations = Object.fromEntries(
        Object.entries(pathDefinition).filter(([method, operation]) =>
          getApprovedOperationPolicy(path, method, operation) !== undefined
        )
      );

      if (Object.keys(approvedOperations).length === 0) {
        return [];
      }

      return [[path, approvedOperations]];
    })
  );

  return {
    ...openApiSpec,
    paths: filteredPaths
  };
}

export function buildToolsFromSpec(openApiSpec: OpenApiSpec): DynamicTool[] {
  const dynamicTools: DynamicTool[] = [];
  const filteredOpenApiSpec = filterApprovedOpenApiSpec(openApiSpec);

  if (!filteredOpenApiSpec.paths) {
    return dynamicTools;
  }

  for (const [path, pathDefinition] of Object.entries(filteredOpenApiSpec.paths)) {
    for (const [method, operation] of Object.entries(pathDefinition)) {
      const approvedOperationPolicy = getApprovedOperationPolicy(path, method, operation);
      if (!approvedOperationPolicy) {
        continue;
      }

      const requestBodyContentType = getPreferredRequestBodyContentType(operation);

      dynamicTools.push({
        annotations: getOperationAnnotations(approvedOperationPolicy.method, operation),
        description: operation.summary || operation.description || `${method.toUpperCase()} ${path}`,
        inputSchema: generateInputSchema(operation, path, approvedOperationPolicy.method, openApiSpec),
        method: approvedOperationPolicy.method.toUpperCase(),
        name: generateToolName(approvedOperationPolicy.method, path, operation),
        path,
        requestBodyContentType,
        requiredScopes: [...approvedOperationPolicy.requiredScopes],
        requiresAuth: approvedOperationPolicy.requiresAuth ?? true
      });
    }
  }

  return dynamicTools;
}

function generateToolsFromSpec(openApiSpec: OpenApiSpec): void {
  tools = buildToolsFromSpec(openApiSpec);
}

function getOperationAnnotations(
  method: SupportedHttpMethod,
  operation: OpenApiOperation
): DynamicTool["annotations"] {
  const methodUpperCase = method.toUpperCase();
  const operationText = [
    operation.operationId,
    operation.summary,
    operation.description
  ].filter(Boolean).join(" ").toLowerCase();

  return {
    readOnlyHint: method === "get",
    destructiveHint: method === "delete" || /\b(delete|remove|revoke)\b/.test(operationText),
    idempotentHint: ["GET", "PUT", "DELETE"].includes(methodUpperCase),
    openWorldHint: false
  };
}

function getPreferredRequestBodyContentType(operation: OpenApiOperation): RequestBodyContentType | undefined {
  const content = operation.requestBody?.content;
  if (!content) {
    return undefined;
  }

  return REQUEST_BODY_CONTENT_TYPES.find((contentType) => content[contentType]);
}

function generateToolName(method: string, path: string, operation: OpenApiOperation): string {
  if (operation.operationId) {
    return operation.operationId;
  }

  const cleanPath = path
    .replace(/\{([^}]+)\}/g, "by_$1")
    .replace(/[\/-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  return `${method.toLowerCase()}_${cleanPath}`;
}

/** Generate the input schema for an MCP tool from an OpenAPI operation. */
export function generateInputSchema(
  operation: OpenApiOperation,
  path: string,
  method?: string,
  openApiSpec?: OpenApiSpec
): InputSchema {
  const required = new Set<string>();
  const schema: InputSchema = {
    type: "object",
    properties: {},
    required: []
  };

  const pathParams = path.match(/\{([^}]+)\}/g);
  if (pathParams) {
    for (const pathParam of pathParams) {
      const paramName = pathParam.slice(1, -1);
      schema.properties[paramName] = {
        type: "string",
        description: `Path parameter: ${paramName}`
      };
      required.add(paramName);
    }
  }

  for (const parameter of operation.parameters ?? []) {
    if (parameter.in !== "query") {
      continue;
    }

    schema.properties[parameter.name] = {
      ...generateParameterInputSchema(parameter)
    };

    if (parameter.required) {
      required.add(parameter.name);
    }
  }

  if (operation.requestBody && method && ["post", "put", "patch", "delete"].includes(method.toLowerCase())) {
    const requestBodyContentType = getPreferredRequestBodyContentType(operation);
    const requestBodySchema = requestBodyContentType
      ? operation.requestBody.content?.[requestBodyContentType]?.schema
      : undefined;

    if (requestBodySchema) {
      schema.properties.requestBody = {
        type: "object",
        description: `Request body payload (${requestBodyContentType})`,
        ...resolveSchemaReference(requestBodySchema, openApiSpec)
      };

      if (operation.requestBody.required) {
        required.add("requestBody");
      }
    }
  }

  schema.required = [...required];
  return schema;
}

function generateParameterInputSchema(parameter: OpenApiParameter): Record<string, unknown> {
  const parameterSchema = parameter.schema ?? {};

  if (typeof parameterSchema.$ref === "string") {
    return {
      type: "object",
      description: parameter.description
    };
  }

  return {
    ...parameterSchema,
    type: parameterSchema.type || "string",
    description: parameter.description
  };
}

function resolveSchemaReference(
  schema: Record<string, unknown>,
  openApiSpec?: OpenApiSpec
): Record<string, unknown> {
  if (typeof schema.$ref !== "string") {
    return schema;
  }

  const schemaName = schema.$ref.replace("#/components/schemas/", "");
  return openApiSpec?.components?.schemas?.[schemaName] ?? schema;
}
