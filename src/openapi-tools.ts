import { fetchWithTimeout } from "./http.js";
import { BlueConicHttpError } from "./errors.js";
import {
  buildToolDescription,
  CONFIRMATION_TOKEN_PLACEMENT_MESSAGE,
  getOperationAnnotations,
  type OperationSafetyPolicy,
  type ToolAnnotations
} from "./safety.js";
import type { ExistingConfigurationRetentionPolicy } from "./api-client.js";

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
type ApprovedOperationPolicy = OperationSafetyPolicy & {
  method: SupportedHttpMethod;
  operationId: string;
  path: string;
  retainExistingConfiguration?: Omit<ExistingConfigurationRetentionPolicy, "requestBodySchema">;
  /** Set to false only for reviewed OpenAPI operations that intentionally do not use OAuth. */
  requiresAuth?: boolean;
  requiredScopes: readonly string[];
};
type ApprovedOperationGroup = {
  name: string;
  operations: readonly ApprovedOperationPolicy[];
};

export type DynamicTool = {
  annotations: ToolAnnotations;
  description: string;
  inputSchema: InputSchema;
  maxBatchSize?: number;
  method: string;
  name: string;
  path: string;
  retainExistingConfiguration?: ExistingConfigurationRetentionPolicy;
  requestBodyContentType?: RequestBodyContentType;
  requiredScopes: string[];
  requiresConfirmation: boolean;
  requiresAuth: boolean;
  risk: OperationSafetyPolicy["risk"];
};

export let tools: DynamicTool[] = [];

const READ_OPERATION_POLICY = {
  requiresConfirmation: false,
  risk: "read"
} as const satisfies OperationSafetyPolicy;

const ADDITIVE_WRITE_OPERATION_POLICY = {
  requiresConfirmation: false,
  risk: "additive_write"
} as const satisfies OperationSafetyPolicy;

const DESTRUCTIVE_WRITE_OPERATION_POLICY = {
  requiresConfirmation: true,
  risk: "destructive_write"
} as const satisfies OperationSafetyPolicy;

export const APPROVED_READ_OPERATION_GROUPS = [
  {
    name: "Audit events",
    operations: [
      { ...READ_OPERATION_POLICY, method: "get", path: "/auditEvents", operationId: "getAuditEvents", requiredScopes: ["read:audit-events"] }
    ]
  },
  {
    name: "Content stores",
    operations: [
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/contentStores/{contentStore}/items",
        operationId: "getContentItemsFromStore",
        requiredScopes: ["read:content_stores"]
      },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/contentStores",
        operationId: "getAllContentStores",
        requiredScopes: ["read:content_stores"]
      }
    ]
  },
  {
    name: "Connections and experiences",
    operations: [
      { ...READ_OPERATION_POLICY, method: "get", path: "/connections", operationId: "getAllConnections", requiredScopes: ["read:connections"] },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/connections/{connection}",
        operationId: "getOneConnection",
        requiredScopes: ["read:connections"]
      },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/connections/{connection}/runs",
        operationId: "getConnectionRuns",
        requiredScopes: ["read:connections"]
      },
      { ...READ_OPERATION_POLICY, method: "get", path: "/dialogues", operationId: "getAllDialogues", requiredScopes: ["read:dialogues"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/dialogues/{dialogue}", operationId: "getOneDialogue", requiredScopes: ["read:dialogues"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/listeners", operationId: "getAllListeners", requiredScopes: ["read:listeners"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/listeners/{listener}", operationId: "getOneListener", requiredScopes: ["read:listeners"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/plugins/{plugin}", operationId: "getOnePlugin", requiredScopes: ["read:plugins"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/plugins", operationId: "getAllPlugins", requiredScopes: ["read:plugins"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/channels", operationId: "getAllChannels", requiredScopes: ["read:channels"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/channels/{channelId}", operationId: "getOneChannel", requiredScopes: ["read:channels"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/interactions", operationId: "getInteractions", requiresAuth: false, requiredScopes: [] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/lifecycles", operationId: "getAllLifecycles", requiredScopes: ["read:lifecycles"] },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/lifecycles/{lifecycle}",
        operationId: "getOneLifecycle",
        requiredScopes: ["read:lifecycles"]
      },
      { ...READ_OPERATION_POLICY, method: "get", path: "/objectives", operationId: "getAllObjectives", requiredScopes: ["read:objectives"] },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/objectives/{objective}",
        operationId: "getOneObjective",
        requiredScopes: ["read:objectives"]
      }
    ]
  },
  {
    name: "Models",
    operations: [
      { ...READ_OPERATION_POLICY, method: "get", path: "/models", operationId: "getAllModels", requiredScopes: ["read:models"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/models/{model}", operationId: "getOneModelMetadata", requiredScopes: ["read:models"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/models/{model}/model", operationId: "getModelONNXBinary", requiredScopes: ["read:models"] }
    ]
  },
  {
    name: "Profiles, groups, and segments",
    operations: [
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/groups/{grouptype}/{group}",
        operationId: "getOneGroupOfGroupType",
        requiredScopes: ["read:groups"]
      },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/groups/{grouptype}",
        operationId: "getAllGroupsByGroupType",
        requiredScopes: ["read:groups"]
      },
      { ...READ_OPERATION_POLICY, method: "get", path: "/groupTypes", operationId: "getAllGroupTypes", requiredScopes: ["read:group-types"] },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/profileEvents/{profileId}",
        operationId: "getProfileEvents",
        requiredScopes: ["read:profiles"]
      },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/profileProperties/{propertyId}",
        operationId: "getOneProfileOrGroupProperty",
        requiredScopes: ["read:profile-properties"]
      },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/profileProperties",
        operationId: "getAllProfileOrGroupProperties",
        requiredScopes: ["read:profile-properties"]
      },
      { ...READ_OPERATION_POLICY, method: "get", path: "/profiles", operationId: "searchProfiles", requiredScopes: ["read:profiles"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/profiles/{profileId}", operationId: "getOneProfile", requiredScopes: ["read:profiles"] },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/segments/{segment}/profiles",
        operationId: "getProfilesInSegment",
        requiredScopes: ["read:segments"]
      },
      { ...READ_OPERATION_POLICY, method: "get", path: "/segments", operationId: "getAllSegments", requiredScopes: ["read:segments"] }
    ]
  },
  {
    name: "Timeline, recommendations, and reporting",
    operations: [
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/timelineEventTypes/{timelineEventType}",
        operationId: "getOneTimelineEventType",
        requiredScopes: ["read:timeline-event-types"]
      },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/timelineEventTypes",
        operationId: "getTimelineEventTypes",
        requiredScopes: ["read:timeline-event-types"]
      },
      {
        ...READ_OPERATION_POLICY,
        method: "post",
        path: "/recommendations",
        operationId: "getRecommendationsPostJsonpAsync",
        requiresAuth: false,
        requiredScopes: []
      },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/reporting/dialogues",
        operationId: "getDialogueStatistics",
        requiredScopes: ["read:dialogues"]
      },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/timelineEventRollups",
        operationId: "getAllRollups",
        requiredScopes: ["read:timeline_event_rollups"]
      },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/timelineEventRollups/{rollup}",
        operationId: "getOneRollup",
        requiredScopes: ["read:timeline_event_rollups"]
      }
    ]
  },
  {
    name: "URL mappings",
    operations: [
      { ...READ_OPERATION_POLICY, method: "get", path: "/urlmappings/{id}", operationId: "getOneURLMapping", requiredScopes: ["read:url-mappings"] }
    ]
  },
  {
    name: "Administration and notebooks",
    operations: [
      { ...READ_OPERATION_POLICY, method: "get", path: "/roles", operationId: "getAllRoles", requiredScopes: ["read:roles"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/roles/{role}", operationId: "getOneRole", requiredScopes: ["read:roles"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/users", operationId: "getAllUsers", requiredScopes: ["read:users"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/users/{user}", operationId: "getOneUser", requiredScopes: ["read:users"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/notebooks", operationId: "getAllNotebooks", requiredScopes: ["read:notebooks"] },
      { ...READ_OPERATION_POLICY, method: "get", path: "/notebooks/{notebook}", operationId: "getOneNotebook", requiredScopes: ["read:notebooks"] },
      {
        ...READ_OPERATION_POLICY,
        method: "get",
        path: "/notebooks/{notebook}/runs",
        operationId: "getNotebookRunHistory",
        requiredScopes: ["read:notebooks"]
      }
    ]
  }
] as const satisfies readonly ApprovedOperationGroup[];

export const APPROVED_WRITE_OPERATION_GROUPS = [
  {
    name: "Content store writes",
    operations: [
      {
        ...DESTRUCTIVE_WRITE_OPERATION_POLICY,
        maxBatchSize: 100,
        method: "put",
        path: "/contentStores/{contentStore}/items",
        operationId: "addContentItemsToStore",
        retainExistingConfiguration: {
          readPath: "/contentStores/{contentStore}/items",
          readQueryFromRequestBodyItems: {
            count: 1,
            itemIdField: "id",
            operator: "==",
            queryParam: "filterValue"
          },
          readResponseBodyPath: ["items"],
          readToolName: "getContentItemsFromStore",
          requestBodyPath: ["items"],
          requiredScopes: ["read:content_stores"]
        },
        requiredScopes: ["write:content_stores"]
      },
      {
        ...ADDITIVE_WRITE_OPERATION_POLICY,
        method: "post",
        path: "/contentStores",
        operationId: "createContentStore",
        requiredScopes: ["write:content_stores"]
      }
    ]
  },
  {
    name: "Event registration writes",
    operations: [
      {
        ...ADDITIVE_WRITE_OPERATION_POLICY,
        method: "post",
        path: "/interactionEvents",
        operationId: "createEvent",
        requiresAuth: false,
        requiredScopes: []
      },
      {
        ...ADDITIVE_WRITE_OPERATION_POLICY,
        method: "post",
        path: "/pageviewEvents",
        operationId: "createPageviewEvent",
        requiresAuth: false,
        requiredScopes: []
      }
    ]
  },
  {
    name: "Model writes",
    operations: [
      { ...ADDITIVE_WRITE_OPERATION_POLICY, method: "post", path: "/models", operationId: "createModel", requiredScopes: ["write:models"] },
      {
        ...DESTRUCTIVE_WRITE_OPERATION_POLICY,
        method: "put",
        path: "/models/{model}",
        operationId: "updateModel",
        retainExistingConfiguration: {
          readPath: "/models/{model}",
          readToolName: "getOneModelMetadata",
          requestBodyPath: ["metadata"],
          requiredScopes: ["read:models"]
        },
        requiredScopes: ["write:models"]
      }
    ]
  },
  {
    name: "Profile and group writes",
    operations: [
      {
        ...DESTRUCTIVE_WRITE_OPERATION_POLICY,
        method: "put",
        path: "/profileProperties/{propertyId}",
        operationId: "createUpdateProfileOrGroupProperty",
        retainExistingConfiguration: {
          readPath: "/profileProperties/{propertyId}",
          readToolName: "getOneProfileOrGroupProperty",
          requestBodyAllowedFields: [
            "availableForSegmentation",
            "canRead",
            "canWrite",
            "createNewProfile",
            "currency",
            "dataSensitivity",
            "description",
            "filterType",
            "groupTypeId",
            "id",
            "indexed",
            "mergeStrategy",
            "name",
            "permissionLevel",
            "precision",
            "showInUI",
            "tags",
            "unit",
            "values"
          ],
          requiredScopes: ["read:profile-properties"]
        },
        requiredScopes: ["write:profile-properties"]
      }
    ]
  },
  {
    name: "URL mapping writes",
    operations: [
      { ...ADDITIVE_WRITE_OPERATION_POLICY, method: "post", path: "/urlmappings", operationId: "createURLMapping", requiredScopes: ["write:url-mappings"] },
      {
        ...DESTRUCTIVE_WRITE_OPERATION_POLICY,
        method: "put",
        path: "/urlmappings/{id}",
        operationId: "updateURLMapping",
        retainExistingConfiguration: {
          readPath: "/urlmappings/{id}",
          readToolName: "getOneURLMapping",
          requiredScopes: ["read:url-mappings"]
        },
        requiredScopes: ["write:url-mappings"]
      }
    ]
  }
] as const satisfies readonly ApprovedOperationGroup[];

function flattenOperationGroups(groups: readonly ApprovedOperationGroup[]): ApprovedOperationPolicy[] {
  return groups.flatMap(({ operations }) => [...operations]);
}

export const APPROVED_OPERATION_POLICIES: readonly ApprovedOperationPolicy[] = [
  ...flattenOperationGroups(APPROVED_READ_OPERATION_GROUPS),
  ...flattenOperationGroups(APPROVED_WRITE_OPERATION_GROUPS)
];

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
      const requestBodySchema = getResolvedRequestBodySchema(operation, requestBodyContentType, openApiSpec);
      const baseDescription = operation.summary || operation.description || `${method.toUpperCase()} ${path}`;

      dynamicTools.push({
        annotations: getOperationAnnotations(approvedOperationPolicy, approvedOperationPolicy.method),
        description: buildToolDescription(baseDescription, approvedOperationPolicy),
        inputSchema: generateInputSchema(
          operation,
          path,
          approvedOperationPolicy.method,
          openApiSpec,
          approvedOperationPolicy
        ),
        ...(approvedOperationPolicy.maxBatchSize === undefined
          ? {}
          : { maxBatchSize: approvedOperationPolicy.maxBatchSize }),
        method: approvedOperationPolicy.method.toUpperCase(),
        name: generateToolName(approvedOperationPolicy.method, path, operation),
        path,
        ...(approvedOperationPolicy.retainExistingConfiguration
          ? {
            retainExistingConfiguration: {
              ...approvedOperationPolicy.retainExistingConfiguration,
              requestBodySchema
            }
          }
          : {}),
        requestBodyContentType,
        requiredScopes: [...approvedOperationPolicy.requiredScopes],
        requiresAuth: approvedOperationPolicy.requiresAuth ?? true,
        requiresConfirmation: approvedOperationPolicy.requiresConfirmation,
        risk: approvedOperationPolicy.risk
      });
    }
  }

  return dynamicTools;
}

function generateToolsFromSpec(openApiSpec: OpenApiSpec): void {
  tools = buildToolsFromSpec(openApiSpec);
}

function getPreferredRequestBodyContentType(operation: OpenApiOperation): RequestBodyContentType | undefined {
  const content = operation.requestBody?.content;
  if (!content) {
    return undefined;
  }

  return REQUEST_BODY_CONTENT_TYPES.find((contentType) => content[contentType]);
}

function getResolvedRequestBodySchema(
  operation: OpenApiOperation,
  requestBodyContentType?: RequestBodyContentType,
  openApiSpec?: OpenApiSpec
): Record<string, unknown> | undefined {
  const requestBodySchema = requestBodyContentType
    ? operation.requestBody?.content?.[requestBodyContentType]?.schema
    : undefined;

  return requestBodySchema
    ? resolveSchemaReference(requestBodySchema, openApiSpec)
    : undefined;
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
  openApiSpec?: OpenApiSpec,
  safetyPolicy?: OperationSafetyPolicy
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
      ...generateParameterInputSchema(parameter, openApiSpec)
    };

    if (parameter.required) {
      required.add(parameter.name);
    }
  }

  if (safetyPolicy?.risk && safetyPolicy.risk !== "read") {
    schema.properties.dryRun = {
      type: "boolean",
      description: "When true, preview the resolved BlueConic endpoint, estimated object count, risk, caps, and confirmation requirements without making a live API call."
    };

    if (safetyPolicy.requiresConfirmation) {
      schema.properties.confirmationToken = {
        type: "string",
        description: `One-time confirmation token returned by the server for destructive writes when MCP elicitation is unavailable. ${CONFIRMATION_TOKEN_PLACEMENT_MESSAGE}`
      };
    }
  }

  if (operation.requestBody && method && ["post", "put", "patch", "delete"].includes(method.toLowerCase())) {
    const requestBodyContentType = getPreferredRequestBodyContentType(operation);
    const requestBodySchema = getResolvedRequestBodySchema(operation, requestBodyContentType, openApiSpec);

    if (requestBodySchema) {
      schema.properties.requestBody = {
        type: "object",
        description: `Request body payload (${requestBodyContentType})`,
        ...requestBodySchema
      };

      if (operation.requestBody.required) {
        required.add("requestBody");
      }
    }
  }

  schema.required = [...required];
  return schema;
}

function generateParameterInputSchema(parameter: OpenApiParameter, openApiSpec?: OpenApiSpec): Record<string, unknown> {
  const parameterSchema = resolveSchemaReference(parameter.schema ?? {}, openApiSpec);

  return {
    ...parameterSchema,
    type: parameterSchema.type || "string",
    description: parameter.description
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getLocalSchemaReference(schemaReference: string, openApiSpec?: OpenApiSpec): Record<string, unknown> | undefined {
  const schemaName = schemaReference.replace("#/components/schemas/", "");
  return openApiSpec?.components?.schemas?.[schemaName];
}

function resolveSchemaReference(schema: Record<string, unknown>, openApiSpec?: OpenApiSpec): Record<string, unknown> {
  const resolvedSchema = resolveSchemaReferences(schema, openApiSpec);
  return isRecord(resolvedSchema) ? resolvedSchema : {};
}

function resolveSchemaReferences(
  schema: unknown,
  openApiSpec?: OpenApiSpec,
  seenReferences = new Set<string>()
): unknown {
  if (Array.isArray(schema)) {
    return schema.map((value) => resolveSchemaReferences(value, openApiSpec, seenReferences));
  }

  if (!isRecord(schema)) {
    return schema;
  }

  if (typeof schema.$ref === "string") {
    const siblingEntries = Object.entries(schema).filter(([key]) => key !== "$ref");
    const siblingSchema = Object.fromEntries(siblingEntries);
    const resolvedReference = getLocalSchemaReference(schema.$ref, openApiSpec);

    if (!resolvedReference || seenReferences.has(schema.$ref)) {
      return resolveSchemaReferences(
        Object.keys(siblingSchema).length > 0 ? siblingSchema : { type: "object" },
        openApiSpec,
        seenReferences
      );
    }

    const nextSeenReferences = new Set(seenReferences);
    nextSeenReferences.add(schema.$ref);
    const resolvedSchema = resolveSchemaReferences(resolvedReference, openApiSpec, nextSeenReferences);
    const resolvedSiblings = resolveSchemaReferences(siblingSchema, openApiSpec, seenReferences);

    if (!isRecord(resolvedSchema)) {
      return resolvedSiblings;
    }

    return {
      ...resolvedSchema,
      ...(isRecord(resolvedSiblings) ? resolvedSiblings : {})
    };
  }

  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, resolveSchemaReferences(value, openApiSpec, seenReferences)])
  );
}
