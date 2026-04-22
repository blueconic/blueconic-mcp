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
  schema?: {
    items?: Record<string, unknown>;
    type?: string;
  };
};

type OpenApiOperation = {
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  summary?: string;
};

type OpenApiSpec = {
  paths?: Record<string, Record<string, OpenApiOperation>>;
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
};

type ApprovedPathPolicy = {
  annotations: DynamicTool["annotations"];
  path: string;
  requiredScopes: readonly string[];
};

export let tools: DynamicTool[] = [];

const READ_ONLY_TOOL_ANNOTATIONS: DynamicTool["annotations"] = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

// Anthropic review requires the Claude-callable surface to be explicit.
// The approved list below matches the read-only BlueConic scopes this connector requests.
// New BlueConic endpoints do not become tools unless we review and add them here.
export const APPROVED_PATH_POLICIES: readonly ApprovedPathPolicy[] = [
  { path: "/connections", annotations: READ_ONLY_TOOL_ANNOTATIONS, requiredScopes: ["read:connections"] },
  {
    path: "/connections/{connection}",
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    requiredScopes: ["read:connections"]
  },
  {
    path: "/connections/{connection}/runs",
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    requiredScopes: ["read:connections"]
  },
  { path: "/interactions", annotations: READ_ONLY_TOOL_ANNOTATIONS, requiredScopes: ["read:interactions"] },
  {
    path: "/profileEvents/{profileId}",
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    requiredScopes: ["read:profiles"]
  },
  { path: "/profiles", annotations: READ_ONLY_TOOL_ANNOTATIONS, requiredScopes: ["read:profiles"] },
  { path: "/profiles/{profileId}", annotations: READ_ONLY_TOOL_ANNOTATIONS, requiredScopes: ["read:profiles"] },
  { path: "/segments", annotations: READ_ONLY_TOOL_ANNOTATIONS, requiredScopes: ["read:segments"] },
  {
    path: "/segments/{segment}/profiles",
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    requiredScopes: ["read:segments"]
  }
];

export const APPROVED_READ_SCOPES = [...new Set(
  APPROVED_PATH_POLICIES.flatMap(({ requiredScopes }) => [...requiredScopes])
)].sort();

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

  console.error(`Loaded ${tools.length} approved API endpoints as MCP tools`);
}

function getApprovedPathPolicy(path: string): ApprovedPathPolicy | undefined {
  return APPROVED_PATH_POLICIES.find((policy) => policy.path === path);
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
      if (!getApprovedPathPolicy(path)) {
        return [];
      }

      const getOperations = Object.fromEntries(
        Object.entries(pathDefinition).filter(([method]) => method.toLowerCase() === "get")
      );

      if (Object.keys(getOperations).length === 0) {
        return [];
      }

      return [[path, getOperations]];
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
    const approvedPathPolicy = getApprovedPathPolicy(path);
    if (!approvedPathPolicy) {
      continue;
    }

    for (const [method, operation] of Object.entries(pathDefinition)) {
      if (method.toLowerCase() !== "get") {
        continue;
      }

      dynamicTools.push({
        annotations: {
          ...approvedPathPolicy.annotations
        },
        description: operation.summary || operation.description || `${method.toUpperCase()} ${path}`,
        inputSchema: generateInputSchema(operation, path, method),
        method: method.toUpperCase(),
        name: generateToolName(method, path, operation),
        path
      });
    }
  }

  return dynamicTools;
}

function generateToolsFromSpec(openApiSpec: OpenApiSpec): void {
  tools = buildToolsFromSpec(openApiSpec);
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
  method?: string
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
      type: parameter.schema?.type || "string",
      description: parameter.description
    };

    if (parameter.schema?.type === "array") {
      schema.properties[parameter.name].items = parameter.schema.items || { type: "string" };
    }

    if (parameter.required) {
      required.add(parameter.name);
    }
  }

  if (operation.requestBody && method && ["post", "put", "patch"].includes(method.toLowerCase())) {
    const jsonContent = operation.requestBody.content?.["application/json"];
    if (jsonContent?.schema) {
      schema.properties.requestBody = {
        type: "object",
        description: "Request body payload",
        ...jsonContent.schema
      };
    }
  }

  schema.required = [...required];
  return schema;
}
