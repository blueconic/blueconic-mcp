import { generateInputSchema } from "../openapi-tools.js";

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
