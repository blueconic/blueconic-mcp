import { fetch } from "undici";

let openApiSpec: any = null;
let tools: any[] = [];

/** Load OpenAPI specification from the user's tenant */
export async function loadOpenApiSpec(tenantUrl?: string, version?: string): Promise<void> {
  if (!tenantUrl) return;
  const OPENAPI_SPEC_URL = `${tenantUrl}/rest/v2/openapi.json?prettyPrint=true`;

  try {
    console.error(`Loading OpenAPI spec from: ${OPENAPI_SPEC_URL}`);

    const response = await fetch(OPENAPI_SPEC_URL, {
      headers: {
        "Accept": "application/json",
        "User-Agent": `BlueConic-MCP-Client/${version}`
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to load OpenAPI spec: ${response.status} ${response.statusText}`);
    }

    openApiSpec = await response.json();
    generateToolsFromSpec();

    console.error(`Loaded ${tools.length} API endpoints as MCP tools`);
  } catch (error: any) {
    console.error("Failed to load OpenAPI spec:", error.message, error);
    throw error;
  }
}

/** Generate MCP tools from OpenAPI specification. */
function generateToolsFromSpec(): void {
  tools = [];

  if (!openApiSpec || !openApiSpec.paths) {
    return;
  }

  for (const [path, pathObj] of Object.entries(openApiSpec.paths)) {
    for (const [method, operation] of Object.entries(pathObj as any)) {
      const op = operation as any;
      if (!["get"].includes(method.toLowerCase())) {
        continue;
      }

      const toolName = generateToolName(method, path, op);
      const tool = {
        name: toolName,
        description: op.summary || op.description || `${method.toUpperCase()} ${path}`,
        inputSchema: generateInputSchema(op, path),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        }
      };

      tools.push({
        ...tool,
        method: method.toUpperCase(),
        path: path,
        operation: op
      });
    }
  }
}

/** Generate a unique tool name from method and path. */
function generateToolName(method: string, path: string, operation: any): string {
  if (operation.operationId) {
    return operation.operationId;
  }

  // path examples: /auditEvents or /channels/{channelId}
  const cleanPath = path
    .replace(/\{([^}]+)\}/g, "by_$1")
    .replace(/[\/\-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  return `${method.toLowerCase()}_${cleanPath}`;
}

/** Generate input schema for a tool based on OpenAPI operation. */
export function generateInputSchema(operation: any, path: string): any {
  const schema: any = {
    type: "object",
    properties: {},
    required: []
  };

  const pathParams = path.match(/\{([^}]+)\}/g);
  if (pathParams) {
    pathParams.forEach(param => {
      const paramName = param.slice(1, -1);
      schema.properties[paramName] = {
        type: "string",
        description: `Path parameter: ${paramName}`
      };
      schema.required.push(paramName);
    });
  }

  if (operation.parameters) {
    operation.parameters.forEach((param: any) => {
      if (param.in === "query") {
        schema.properties[param.name] = {
          type: param.schema?.type || "string",
          description: param.description
        };
        if (param.schema?.type === "array") {
          // For array types, include items schema
          schema.properties[param.name].items = param.schema.items || { type: "string" };
        }
        if (param.required) {
          schema.required.push(param.name);
        }
      }
    });
  }

  if (operation.requestBody && ["POST", "PUT", "PATCH"].includes(operation.method)) {
    const jsonContent = operation.requestBody.content?.["application/json"];
    if (jsonContent?.schema) {
      schema.properties.requestBody = {
        type: "object",
        description: "Request body payload",
        ...jsonContent.schema
      };
    }
  }

  return schema;
}

export { tools };
