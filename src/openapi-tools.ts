import { fetch } from "./http.js";
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

export let tools: DynamicTool[] = [];

/** Load the OpenAPI specification from the user's tenant. */
export async function loadOpenApiSpec(tenantUrl?: string, version = "0.0.0"): Promise<void> {
  if (!tenantUrl) {
    return;
  }

  const openApiSpecUrl = new URL("/rest/v2/openapi.json?prettyPrint=true", `${tenantUrl}/`);
  console.error(`Loading OpenAPI spec from: ${openApiSpecUrl.toString()}`);

  const response = await fetch(openApiSpecUrl, {
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

  console.error(`Loaded ${tools.length} API endpoints as MCP tools`);
}

function generateToolsFromSpec(openApiSpec: OpenApiSpec): void {
  tools = [];

  if (!openApiSpec.paths) {
    return;
  }

  for (const [path, pathDefinition] of Object.entries(openApiSpec.paths)) {
    for (const [method, operation] of Object.entries(pathDefinition)) {
      if (method.toLowerCase() !== "get") {
        continue;
      }

      tools.push({
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        },
        description: operation.summary || operation.description || `${method.toUpperCase()} ${path}`,
        inputSchema: generateInputSchema(operation, path, method),
        method: method.toUpperCase(),
        name: generateToolName(method, path, operation),
        path
      });
    }
  }
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
