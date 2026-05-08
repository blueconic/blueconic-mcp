import {
  APPROVED_OPERATION_POLICIES,
  APPROVED_READ_OPERATION_GROUPS,
  APPROVED_WRITE_OPERATION_GROUPS,
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
  it("keeps reviewed operations organized by read and write groups", () => {
    expect(APPROVED_READ_OPERATION_GROUPS.map(({ name }) => name)).toEqual([
      "Audit events",
      "Content stores",
      "Connections and experiences",
      "Models",
      "Profiles, groups, and segments",
      "Timeline, recommendations, and reporting",
      "URL mappings",
      "Administration and notebooks"
    ]);
    expect(APPROVED_WRITE_OPERATION_GROUPS.map(({ name }) => name)).toEqual([
      "Content store writes",
      "Event registration writes",
      "Model writes",
      "Profile and group writes",
      "URL mapping writes"
    ]);
    expect(APPROVED_OPERATION_POLICIES).toEqual([
      ...APPROVED_READ_OPERATION_GROUPS.flatMap(({ operations }) => operations),
      ...APPROVED_WRITE_OPERATION_GROUPS.flatMap(({ operations }) => operations)
    ]);
  });

  it("clearly enumerates every reviewed BlueConic MCP tool", () => {
    const policyKeys = APPROVED_OPERATION_POLICIES.map(({ method, operationId, path }) =>
      `${method.toUpperCase()} ${path} :: ${operationId}`
    );

    expect(APPROVED_OPERATION_POLICIES).toHaveLength(55);
    expect(new Set(policyKeys).size).toBe(55);
    expect(policyKeys).toEqual(expect.arrayContaining([
      "GET /profiles :: searchProfiles",
      "POST /contentStores :: createContentStore",
      "POST /models :: createModel",
      "PUT /profileProperties/{propertyId} :: createUpdateProfileOrGroupProperty",
      "POST /interactionEvents :: createEvent"
    ]));
    expect(policyKeys).not.toEqual(expect.arrayContaining([
      "DELETE /contentStores/{contentStore}/items/bulk :: deleteContentItemsFromStore",
      "PUT /contentStores/{contentStore} :: updateContentStore",
      "DELETE /models/{model} :: deleteModel",
      "PUT /profiles :: createUpdateDeleteProfiles",
      "PUT /groups :: createUpdateDeleteGroups",
      "DELETE /profileProperties/{propertyId} :: deleteProfileOrGroupProperty",
      "GET /oauth/authorize :: startAuthorizationCodeFlow",
      "POST /oauth/revoke :: revokeToken",
      "POST /oauth/token :: getToken"
    ]));
  });

  it("assigns explicit risk and confirmation policy to every reviewed operation", () => {
    expect(APPROVED_OPERATION_POLICIES.every((policy) => typeof policy.risk === "string")).toBe(true);
    expect(APPROVED_OPERATION_POLICIES.every((policy) => typeof policy.requiresConfirmation === "boolean")).toBe(true);

    expect(APPROVED_OPERATION_POLICIES.find((policy) =>
      policy.operationId === "searchProfiles"
    )).toMatchObject({
      risk: "read",
      requiresConfirmation: false
    });
    expect(APPROVED_OPERATION_POLICIES.find((policy) =>
      policy.operationId === "createModel"
    )).toMatchObject({
      risk: "additive_write",
      requiresConfirmation: false
    });
    expect(APPROVED_OPERATION_POLICIES.find((policy) =>
      policy.operationId === "addContentItemsToStore"
    )).toMatchObject({
      risk: "destructive_write",
      requiresConfirmation: true,
      maxBatchSize: 100
    });
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
        "/models": {
          post: { summary: "Create model", operationId: "createModel" }
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
      "/models": {
        post: { summary: "Create model", operationId: "createModel" }
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
        "/models": {
          post: {
            summary: "Create model",
            operationId: "createModel",
            security: [{ oauth2: ["write:models"] }]
          }
        },
        "/profileProperties/{propertyId}": {
          put: {
            summary: "Create or update property",
            operationId: "createUpdateProfileOrGroupProperty",
            security: [{ oauth2: ["write:profile-properties"] }]
          }
        },
        "/profiles": {
          put: {
            summary: "Create, update, or delete profiles",
            operationId: "createUpdateDeleteProfiles",
            security: [{ oauth2: ["write:profiles"] }]
          }
        },
        "/removedProfileProperties/{propertyId}": {
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
        requiresAuth: false,
        risk: "additive_write",
        requiresConfirmation: false,
        description: expect.stringContaining("WARNING: This tool modifies live BlueConic data."),
        inputSchema: expect.objectContaining({
          properties: expect.objectContaining({
            dryRun: expect.objectContaining({ type: "boolean" })
          })
        })
      }),
      expect.objectContaining({
        name: "createModel",
        path: "/models",
        requiredScopes: ["write:models"],
        risk: "additive_write",
        requiresConfirmation: false,
        annotations: expect.objectContaining({
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false
        })
      }),
      expect.objectContaining({
        name: "createUpdateProfileOrGroupProperty",
        path: "/profileProperties/{propertyId}",
        requiredScopes: ["write:profile-properties"],
        risk: "destructive_write",
        requiresConfirmation: true,
        annotations: expect.objectContaining({
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true
        }),
        description: expect.stringContaining("Execution requires user confirmation"),
        inputSchema: expect.objectContaining({
          properties: expect.objectContaining({
            confirmationToken: expect.objectContaining({
              type: "string",
              description: expect.stringContaining("top level of the tool arguments")
            }),
            dryRun: expect.objectContaining({ type: "boolean" })
          })
        })
      })
    ]);
  });

  it("does not exclude any explicitly approved operation from a current-spec-shaped sample", () => {
    const currentTenantSpec = buildSpecFromApprovedPolicies();

    expect(buildToolsFromSpec(currentTenantSpec)).toHaveLength(APPROVED_OPERATION_POLICIES.length);
  });

  it("adds retained-configuration policies to update tools", () => {
    const dynamicTools = buildToolsFromSpec(buildSpecFromApprovedPolicies());
    const toolsByName = new Map(dynamicTools.map((tool) => [tool.name, tool]));

    expect(toolsByName.get("createUpdateProfileOrGroupProperty")?.retainExistingConfiguration).toMatchObject({
      readPath: "/profileProperties/{propertyId}",
      readToolName: "getOneProfileOrGroupProperty",
      requestBodyAllowedFields: expect.arrayContaining([
        "availableForSegmentation",
        "filterType",
        "id",
        "mergeStrategy",
        "name",
        "tags"
      ]),
      requiredScopes: ["read:profile-properties"]
    });
    expect(toolsByName.get("updateModel")?.retainExistingConfiguration).toMatchObject({
      readPath: "/models/{model}",
      readToolName: "getOneModelMetadata",
      requestBodyPath: ["metadata"],
      requiredScopes: ["read:models"]
    });
    expect(toolsByName.get("updateURLMapping")?.retainExistingConfiguration).toMatchObject({
      readPath: "/urlmappings/{id}",
      readToolName: "getOneURLMapping",
      requiredScopes: ["read:url-mappings"]
    });
    expect(toolsByName.get("addContentItemsToStore")?.retainExistingConfiguration).toMatchObject({
      readPath: "/contentStores/{contentStore}/items",
      readResponseBodyPath: ["items"],
      requestBodyPath: ["items"],
      requiredScopes: ["read:content_stores"]
    });
  });

  it("exposes the correct risk-specific argument surface for every generated tool", () => {
    const dynamicTools = buildToolsFromSpec(buildSpecFromApprovedPolicies());

    const readTools = dynamicTools.filter((tool) => tool.risk === "read");
    const additiveWriteTools = dynamicTools.filter((tool) => tool.risk === "additive_write");
    const destructiveWriteTools = dynamicTools.filter((tool) => tool.risk === "destructive_write");

    expect(readTools).not.toHaveLength(0);
    expect(additiveWriteTools.map((tool) => tool.name).sort()).toEqual([
      "createContentStore",
      "createEvent",
      "createModel",
      "createPageviewEvent",
      "createURLMapping"
    ]);
    expect(destructiveWriteTools.map((tool) => tool.name).sort()).toEqual([
      "addContentItemsToStore",
      "createUpdateProfileOrGroupProperty",
      "updateModel",
      "updateURLMapping"
    ]);

    expect(readTools.every((tool) =>
      tool.annotations.readOnlyHint &&
      !tool.annotations.destructiveHint &&
      !tool.inputSchema.properties.dryRun &&
      !tool.inputSchema.properties.confirmationToken
    )).toBe(true);

    expect(additiveWriteTools.every((tool) =>
      !tool.requiresConfirmation &&
      !tool.annotations.readOnlyHint &&
      !tool.annotations.destructiveHint &&
      tool.description.includes("WARNING: This tool modifies live BlueConic data.") &&
      tool.description.includes("Use dryRun: true") &&
      tool.inputSchema.properties.dryRun?.type === "boolean" &&
      !tool.inputSchema.properties.confirmationToken
    )).toBe(true);

    expect(destructiveWriteTools.every((tool) =>
      tool.requiresConfirmation &&
      !tool.annotations.readOnlyHint &&
      tool.annotations.destructiveHint &&
      tool.description.includes("WARNING: This is a destructive BlueConic write.") &&
      tool.inputSchema.properties.dryRun?.type === "boolean" &&
      tool.inputSchema.properties.confirmationToken?.type === "string" &&
      String(tool.inputSchema.properties.confirmationToken.description).includes("top level of the tool arguments") &&
      String(tool.inputSchema.properties.confirmationToken.description).includes("Do not put confirmationToken inside requestBody.")
    )).toBe(true);
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

  it("resolves nested component references inside query parameter schemas", () => {
    const schema = generateInputSchema(
      {
        parameters: [{
          in: "query",
          name: "filters",
          schema: {
            type: "array",
            items: { $ref: "#/components/schemas/SearchFilter" }
          }
        }]
      },
      "/profiles",
      "get",
      {
        components: {
          schemas: {
            SearchFilter: {
              type: "object",
              properties: {
                value: { type: "string" }
              }
            }
          }
        }
      }
    );

    expect(JSON.stringify(schema)).not.toContain("\"$ref\"");
    expect(schema.properties.filters).toMatchObject({
      type: "array",
      items: {
        type: "object",
        properties: {
          value: { type: "string" }
        }
      }
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

  it("resolves nested component references inside request body schemas", () => {
    const schema = generateInputSchema(
      {
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ContentStoreItemsRequest"
              }
            }
          }
        }
      },
      "/contentStores/{contentStore}/items",
      "put",
      {
        components: {
          schemas: {
            ContentStoreItemsRequest: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ContentStoreItem" }
                }
              }
            },
            ContentStoreItem: {
              type: "object",
              properties: {
                id: { type: "string" },
                variants: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ContentStoreItemVariant" }
                }
              }
            },
            ContentStoreItemVariant: {
              type: "object",
              properties: {
                value: { type: "string" }
              }
            }
          }
        }
      }
    );

    expect(JSON.stringify(schema)).not.toContain("\"$ref\"");
    expect(schema.properties.requestBody).toMatchObject({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              variants: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    value: { type: "string" }
                  }
                }
              }
            }
          }
        }
      }
    });
  });
});
