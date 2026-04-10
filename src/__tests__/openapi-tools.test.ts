import { generateInputSchema } from "../openapi-tools.js";

describe("generateInputSchema", () => {
  it("should generate schema for path params", () => {
    const operation = { parameters: [] };
    const path = "/foo/{bar}";
    const schema = generateInputSchema(operation, path);
    expect(schema.properties.bar).toBeDefined();
    expect(schema.required).toContain("bar");
  });

  it("should handle query parameters", () => {
    const operation = { parameters: [{ in: "query", name: "q", schema: { type: "string" }, required: true }] };
    const path = "/foo";
    const schema = generateInputSchema(operation, path);
    expect(schema.properties.q).toBeDefined();
    expect(schema.required).toContain("q");
  });

  it("should handle array query parameters", () => {
    const operation = { parameters: [{ in: "query", name: "tags", schema: { type: "array", items: { type: "string" } }, required: false }] };
    const path = "/foo";
    const schema = generateInputSchema(operation, path);
    expect(schema.properties.tags).toBeDefined();
    expect(schema.properties.tags.type).toBe("array");
    expect(schema.properties.tags.items).toEqual({ type: "string" });
    expect(schema.required).not.toContain("tags");
  });

  it("should handle request body schema", () => {
    const operation = {
      parameters: [],
      method: "POST",
      requestBody: {
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { foo: { type: "string" } },
              required: ["foo"]
            }
          }
        }
      }
    };
    const path = "/foo";
    const schema = generateInputSchema(operation, path);
    expect(schema.properties.requestBody).toBeDefined();
    expect(schema.properties.requestBody.type).toBe("object");
    expect(schema.properties.requestBody.properties.foo.type).toBe("string");
  });

  it("should handle no parameters or path params", () => {
    const operation = {};
    const path = "/foo";
    const schema = generateInputSchema(operation, path);
    expect(schema.type).toBe("object");
    expect(schema.required.length).toBe(0);
  });

  it("should handle optional query parameters", () => {
    const operation = { parameters: [{ in: "query", name: "opt", schema: { type: "string" }, required: false }] };
    const path = "/foo";
    const schema = generateInputSchema(operation, path);
    expect(schema.properties.opt).toBeDefined();
    expect(schema.required).not.toContain("opt");
  });
});
