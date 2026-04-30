import {
  APPROVED_OPERATION_POLICIES,
  buildToolsFromSpec,
  filterApprovedOpenApiSpec,
  generateInputSchema,
  SUPPORTED_HTTP_METHODS
} from "../openapi-tools.js";

function buildSpecFromApprovedPolicies() {
  const paths: Record<string, Record<string, {
    operationId: string;
    security?: Array<Record<string, string[]>>;
    summary: string;
  }>> = {};

  for (const policy of APPROVED_OPERATION_POLICIES) {
    paths[policy.path] ??= {};
    paths[policy.path][policy.method] = {
      operationId: policy.operationId,
      summary: policy.operationId,
      ...(policy.requiredScopes.length > 0
        ? { security: [{ oauth2: [...policy.requiredScopes] }] }
        : {})
    };
  }

  return { paths };
}

describe("APPROVED_OPERATION_POLICIES", () => {
  it("clearly enumerates every reviewed BlueConic MCP tool", () => {
    const policyKeys = APPROVED_OPERATION_POLICIES.map(({ method, operationId, path }) =>
      `${method.toUpperCase()} ${path} :: ${operationId}`
    );

    expect(APPROVED_OPERATION_POLICIES).toHaveLength(61);
    expect(new Set(policyKeys).size).toBe(61);
    expect(policyKeys).toEqual(expect.arrayContaining([
      "GET /profiles :: searchProfiles",
      "PUT /profiles :: createUpdateDeleteProfiles",
      "POST /contentStores :: createContentStore",
      "DELETE /models/{model} :: deleteModel",
      "POST /interactionEvents :: createEvent"
    ]));
    expect(policyKeys).not.toEqual(expect.arrayContaining([
      "GET /oauth/authorize :: startAuthorizationCodeFlow",
      "POST /oauth/revoke :: revokeToken",
      "POST /oauth/token :: getToken"
    ]));
  });
});

describe("SUPPORTED_HTTP_METHODS", () => {
  it("includes the HTTP operations BlueConic exposes as tools", () => {
    expect(SUPPORTED_HTTP_METHODS).toEqual(["get", "post", "put", "patch", "delete"]);
  });
});

describe("filterApprovedOpenApiSpec", () => {
  it("keeps only explicitly approved method, path, and operationId combinations", () => {
    const filteredSpec = filterApprovedOpenApiSpec({
      paths: {
        "/connections": {
          get: { summary: "List connections", operationId: "getAllConnections" },
          post: { summary: "Create connection", operationId: "createConnection" }
        },
        "/users": {
          get: { summary: "List users", operationId: "getAllUsers" }
        },
        "/profiles": {
          put: { summary: "Update profile", operationId: "createUpdateDeleteProfiles" },
          post: { summary: "Unexpected profile write", operationId: "unexpectedProfileWrite" }
        },
        "/segments": {
          get: { summary: "Wrong operation name", operationId: "listSegments" }
        }
      }
    });

    expect(filteredSpec.paths).toEqual({
      "/connections": {
        get: { summary: "List connections", operationId: "getAllConnections" }
      },
      "/users": {
        get: { summary: "List users", operationId: "getAllUsers" }
      },
      "/profiles": {
        put: { summary: "Update profile", operationId: "createUpdateDeleteProfiles" }
      }
    });
  });
});

describe("buildToolsFromSpec", () => {
  it("builds tools for approved operations", () => {
    const dynamicTools = buildToolsFromSpec({
      paths: {
        "/segments": {
          get: {
            summary: "List segments",
            operationId: "getAllSegments",
            security: [{ oauth2: ["read:segments"] }]
          }
        },
        "/interactionEvents": {
          post: {
            summary: "Create interaction event",
            operationId: "createEvent"
          }
        },
        "/profiles": {
          put: {
            summary: "Create, update, or delete profiles",
            operationId: "createUpdateDeleteProfiles",
            security: [{ oauth2: ["write:profiles"] }]
          }
        },
        "/profileProperties/{propertyId}": {
          delete: {
            summary: "Delete property",
            operationId: "deleteProfileOrGroupProperty",
            security: [{ oauth2: ["write:profile-properties"] }]
          }
        },
        "/unsupported": {
          trace: {
            summary: "Trace unsupported operation",
            operationId: "traceUnsupported"
          } as never
        }
      }
    });

    expect(dynamicTools).toHaveLength(4);
    expect(dynamicTools).toEqual([
      expect.objectContaining({
        name: "getAllSegments",
        path: "/segments",
        requiredScopes: ["read:segments"],
        requiresAuth: true,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        }
      }),
      expect.objectContaining({
        name: "createEvent",
        path: "/interactionEvents",
        requiredScopes: [],
        requiresAuth: false
      }),
      expect.objectContaining({
        name: "createUpdateDeleteProfiles",
        path: "/profiles",
        requiredScopes: ["write:profiles"],
        annotations: expect.objectContaining({
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true
        })
      }),
      expect.objectContaining({
        name: "deleteProfileOrGroupProperty",
        path: "/profileProperties/{propertyId}",
        requiredScopes: ["write:profile-properties"],
        annotations: expect.objectContaining({
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true
        })
      })
    ]);
  });

  it("does not exclude any explicitly approved operation from a current-spec-shaped sample", () => {
    const currentTenantSpec = buildSpecFromApprovedPolicies();

    expect(buildToolsFromSpec(currentTenantSpec)).toHaveLength(APPROVED_OPERATION_POLICIES.length);
  });
});

describe("generateInputSchema", () => {
  it("generates schema entries for path params", () => {
    const schema = generateInputSchema({ parameters: [] }, "/segments/{segmentId}");

    expect(schema.properties.segmentId).toBeDefined();
    expect(schema.required).toContain("segmentId");
  });

  it("handles required query parameters", () => {
    const schema = generateInputSchema(
      {
        parameters: [{ in: "query", name: "limit", schema: { type: "number" }, required: true }]
      },
      "/segments"
    );

    expect(schema.properties.limit).toBeDefined();
    expect(schema.required).toContain("limit");
  });

  it("preserves array query parameter metadata", () => {
    const schema = generateInputSchema(
      {
        parameters: [{ in: "query", name: "tags", schema: { type: "array", items: { type: "string" } } }]
      },
      "/profiles"
    );

    expect(schema.properties.tags).toEqual({
      type: "array",
      description: undefined,
      items: { type: "string" }
    });
  });

  it("includes request body schema for write operations", () => {
    const schema = generateInputSchema(
      {
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  foo: { type: "string" }
                },
                required: ["foo"]
              }
            }
          }
        }
      },
      "/profiles",
      "post"
    );

    expect(schema.properties.requestBody).toMatchObject({
      type: "object",
      properties: {
        foo: { type: "string" }
      }
    });
  });

  it("marks required request bodies for delete operations", () => {
    const schema = generateInputSchema(
      {
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ids: { type: "array", items: { type: "string" } }
                }
              }
            }
          },
          required: true
        }
      },
      "/contentStores/{contentStore}/items/bulk",
      "delete"
    );

    expect(schema.required).toEqual(["contentStore", "requestBody"]);
  });

  it("resolves component references for request body schemas", () => {
    const schema = generateInputSchema(
      {
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                $ref: "#/components/schemas/CreateModelBean"
              }
            }
          }
        }
      },
      "/models",
      "post",
      {
        components: {
          schemas: {
            CreateModelBean: {
              type: "object",
              properties: {
                metadata: { type: "object" }
              },
              required: ["metadata"]
            }
          }
        }
      }
    );

    expect(schema.properties.requestBody).toMatchObject({
      type: "object",
      properties: {
        metadata: { type: "object" }
      }
    });
  });
});
