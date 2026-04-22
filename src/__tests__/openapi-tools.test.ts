import {
  APPROVED_PATH_POLICIES,
  APPROVED_READ_SCOPES,
  buildToolsFromSpec,
  filterApprovedOpenApiSpec,
  generateInputSchema
} from "../openapi-tools.js";

describe("APPROVED_PATH_POLICIES", () => {
  it("lists every explicitly approved BlueConic GET endpoint", () => {
    expect(APPROVED_PATH_POLICIES.map(({ path }) => path)).toEqual([
      "/connections",
      "/connections/{connection}",
      "/connections/{connection}/runs",
      "/interactions",
      "/profileEvents/{profileId}",
      "/profiles",
      "/profiles/{profileId}",
      "/segments",
      "/segments/{segment}/profiles"
    ]);
  });

  it("keeps OAuth scopes aligned with the approved endpoint list", () => {
    expect(APPROVED_READ_SCOPES).toEqual([
      "read:connections",
      "read:interactions",
      "read:profiles",
      "read:segments"
    ]);
  });
});

describe("filterApprovedOpenApiSpec", () => {
  it("keeps only explicitly approved GET endpoints", () => {
    const filteredSpec = filterApprovedOpenApiSpec({
      paths: {
        "/connections": {
          get: { summary: "List connections" }
        },
        "/profileEvents/{profileId}": {
          get: { summary: "Get profile events" }
        },
        "/profiles/{profileId}": {
          get: { summary: "Get profile" }
        },
        "/segments/{segment}/profiles": {
          get: { summary: "List segment profiles" }
        },
        "/users": {
          get: { summary: "List users" }
        },
        "/profiles": {
          post: { summary: "Update profile" }
        }
      }
    });

    expect(filteredSpec.paths).toEqual({
      "/connections": {
        get: { summary: "List connections" }
      },
      "/profileEvents/{profileId}": {
        get: { summary: "Get profile events" }
      },
      "/profiles/{profileId}": {
        get: { summary: "Get profile" }
      },
      "/segments/{segment}/profiles": {
        get: { summary: "List segment profiles" }
      }
    });
  });
});

describe("buildToolsFromSpec", () => {
  it("builds tools only for approved paths", () => {
    const dynamicTools = buildToolsFromSpec({
      paths: {
        "/segments": {
          get: {
            summary: "List segments",
            operationId: "listSegments"
          }
        },
        "/profileEvents/{profileId}": {
          get: {
            summary: "Get profile events",
            operationId: "getProfileEvents"
          }
        },
        "/internal/audit": {
          get: {
            summary: "List audit entries",
            operationId: "listAuditEntries"
          }
        }
      }
    });

    expect(dynamicTools).toHaveLength(2);
    expect(dynamicTools).toEqual([
      expect.objectContaining({
        name: "listSegments",
        path: "/segments",
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        }
      }),
      expect.objectContaining({
        name: "getProfileEvents",
        path: "/profileEvents/{profileId}"
      })
    ]);
  });

  it("does not exclude any approved path from a current-spec sample", () => {
    const currentTenantGetSpec = {
      paths: {
        "/auditEvents": { get: { summary: "Get audit events" } },
        "/channels": { get: { summary: "Get all channels" } },
        "/channels/{channelId}": { get: { summary: "Get one channel" } },
        "/connections": { get: { summary: "Get all connections" } },
        "/connections/{connection}": { get: { summary: "Get one connection" } },
        "/connections/{connection}/runs": { get: { summary: "Get the run history of a batch connection" } },
        "/dialogues": { get: { summary: "Get all dialogues" } },
        "/interactions": { get: { summary: "Get interactions" } },
        "/oauth/authorize": { get: { summary: "Start Authorization Code Flow" } },
        "/profileEvents/{profileId}": { get: { summary: "Get profile events" } },
        "/profiles": { get: { summary: "Search profiles" } },
        "/profiles/{profileId}": { get: { summary: "Get one profile" } },
        "/roles": { get: { summary: "Get all roles" } },
        "/segments": { get: { summary: "Get all segments" } },
        "/segments/{segment}/profiles": { get: { summary: "Get profiles in segment" } },
        "/users": { get: { summary: "Get all users" } }
      }
    };

    expect(buildToolsFromSpec(currentTenantGetSpec).map(({ path }) => path)).toEqual([
      "/connections",
      "/connections/{connection}",
      "/connections/{connection}/runs",
      "/interactions",
      "/profileEvents/{profileId}",
      "/profiles",
      "/profiles/{profileId}",
      "/segments",
      "/segments/{segment}/profiles"
    ]);
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
});
