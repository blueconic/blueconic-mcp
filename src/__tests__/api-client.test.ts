import { jest } from "@jest/globals";

describe("makeApiCall", () => {
  const originalFetch = globalThis.fetch;

  function setGlobalFetch(mockFetch: typeof fetch): void {
    Object.defineProperty(globalThis, "fetch", {
      value: mockFetch,
      configurable: true,
      writable: true
    });
  }

  async function loadApiClientModule(mockFetch: typeof fetch) {
    jest.resetModules();
    setGlobalFetch(mockFetch);
    return await import("../api-client.js");
  }

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    setGlobalFetch(originalFetch);
  });

  it("throws when the OAuth token is missing", async () => {
    const { makeApiCall } = await loadApiClientModule(jest.fn<typeof fetch>());

    await expect(
      makeApiCall("https://example.com", "", "GET", "/segments", "1.0.2", "getAllSegments")
    ).rejects.toThrow("OAuth access token not configured");
  });

  it("adds a timeout-backed abort signal to API requests", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }));
    const { makeApiCall } = await loadApiClientModule(mockFetch);

    await expect(
      makeApiCall("https://example.com", "token", "GET", "/segments", "1.0.2", "getAllSegments")
    ).resolves.toEqual({ ok: true });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-BlueConic-MCP-Tool-Call": "getAllSegments"
        }),
        signal: expect.any(AbortSignal)
      })
    );
  });

  it("can call OpenAPI operations that do not require bearer authentication", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }));
    const { makeApiCall } = await loadApiClientModule(mockFetch);

    await expect(
      makeApiCall(
        "https://example.com",
        null,
        "POST",
        "/interactionEvents",
        "1.0.2",
        "createEvent",
        {},
        {},
        { profile: "profile-1" },
        "application/json",
        false
      )
    ).resolves.toEqual({ ok: true });

    const [, requestInit] = mockFetch.mock.calls[0];
    expect((requestInit?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("serializes form-url-encoded request bodies", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 200 }));
    const { makeApiCall } = await loadApiClientModule(mockFetch);

    await makeApiCall(
      "https://example.com",
      null,
      "POST",
      "/formSubmit",
      "1.0.2",
      "submitForm",
      {},
      {},
      { grant_type: "client_credentials", scope: ["read:profiles", "write:profiles"] },
      "application/x-www-form-urlencoded",
      false
    );

    const [, requestInit] = mockFetch.mock.calls[0];
    expect((requestInit?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(requestInit?.body).toBe(
      "grant_type=client_credentials&scope=read%3Aprofiles&scope=write%3Aprofiles"
    );
  });

  it("sends request bodies for delete operations", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 200 }));
    const { makeApiCall } = await loadApiClientModule(mockFetch);

    await makeApiCall(
      "https://example.com",
      "token",
      "DELETE",
      "/contentStores/{contentStore}/items/bulk",
      "1.0.2",
      "deleteContentItemsFromStore",
      { contentStore: "store-a" },
      {},
      { ids: ["item-a"] }
    );

    const [, requestInit] = mockFetch.mock.calls[0];
    expect(requestInit?.body).toBe(JSON.stringify({ ids: ["item-a"] }));
  });

  it("serializes plain multipart form fields", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 200 }));
    const { makeApiCall } = await loadApiClientModule(mockFetch);

    await makeApiCall(
      "https://example.com",
      "token",
      "POST",
      "/models",
      "1.0.2",
      "createModel",
      {},
      {},
      { name: "Model name", enabled: true },
      "multipart/form-data"
    );

    const [, requestInit] = mockFetch.mock.calls[0];
    const body = requestInit?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("name")).toBe("Model name");
    expect(body.get("enabled")).toBe("true");
    expect((requestInit?.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("serializes object and array multipart fields as JSON blobs", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 200 }));
    const { makeApiCall } = await loadApiClientModule(mockFetch);

    await makeApiCall(
      "https://example.com",
      "token",
      "POST",
      "/models",
      "1.0.2",
      "createModel",
      {},
      {},
      { metadata: { type: "GENERAL" }, tags: ["A", "B"] },
      "multipart/form-data"
    );

    const [, requestInit] = mockFetch.mock.calls[0];
    const body = requestInit?.body as FormData;
    const metadata = body.get("metadata") as Blob;
    const tags = body.get("tags") as Blob;

    await expect(metadata.text()).resolves.toBe(JSON.stringify({ type: "GENERAL" }));
    await expect(tags.text()).resolves.toBe(JSON.stringify(["A", "B"]));
    expect(metadata.type).toBe("application/json");
    expect(tags.type).toBe("application/json");
  });

  it("serializes binary multipart fields from base64 payloads", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 200 }));
    const { makeApiCall } = await loadApiClientModule(mockFetch);

    await makeApiCall(
      "https://example.com",
      "token",
      "POST",
      "/models",
      "1.0.2",
      "createModel",
      {},
      {},
      {
        model: {
          base64: Buffer.from("onnx-bytes").toString("base64"),
          contentType: "application/octet-stream",
          filename: "model.onnx"
        }
      },
      "multipart/form-data"
    );

    const [, requestInit] = mockFetch.mock.calls[0];
    const body = requestInit?.body as FormData;
    const model = body.get("model") as Blob & { name?: string };

    await expect(model.text()).resolves.toBe("onnx-bytes");
    expect(model.type).toBe("application/octet-stream");
    expect(model.name).toBe("model.onnx");
  });

  it("serializes non-object multipart request bodies as an empty form", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 200 }));
    const { makeApiCall } = await loadApiClientModule(mockFetch);

    await makeApiCall(
      "https://example.com",
      null,
      "POST",
      "/models",
      "1.0.2",
      "createModel",
      {},
      {},
      "not-an-object",
      "multipart/form-data",
      false
    );

    const [, requestInit] = mockFetch.mock.calls[0];
    const body = requestInit?.body as FormData;
    expect([...body.entries()]).toEqual([]);
  });

  it("retains existing JSON configuration before update requests", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "favorite_color",
        name: "Favorite color",
        description: "Old description",
        mergeStrategy: "BOTH",
        tags: ["Preferences"],
        isIdProperty: false,
        range: { min: 0, max: 100 },
        useValidation: true,
        creationDate: "2026-01-01T00:00:00.000Z",
        creator: { userName: "system" },
        links: [{ href: "https://example.com/rest/v2/profileProperties/favorite_color" }]
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    const { makeApiCall } = await loadApiClientModule(mockFetch);

    await expect(makeApiCall(
      "https://example.com",
      "token",
      "PUT",
      "/profileProperties/{propertyId}",
      "1.0.2",
      "createUpdateProfileOrGroupProperty",
      { propertyId: "favorite_color" },
      {},
      { description: "New description" },
      "application/json",
      true,
      {
        readPath: "/profileProperties/{propertyId}",
        readToolName: "getOneProfileOrGroupProperty",
        requestBodyAllowedFields: [
          "description",
          "id",
          "mergeStrategy",
          "name",
          "tags"
        ],
        requestBodySchema: {
          type: "object",
          properties: {
            creationDate: { type: "string", readOnly: true },
            creator: { type: "object", readOnly: true },
            description: { type: "string" },
            id: { type: "string" },
            isIdProperty: { type: "boolean" },
            mergeStrategy: { type: "string" },
            name: { type: "string" },
            range: { type: "object", readOnly: true },
            tags: { type: "array", items: { type: "string" } }
          }
        }
      },
      "read-token"
    )).resolves.toEqual({ ok: true });

    const [readUrl, readRequestInit] = mockFetch.mock.calls[0];
    expect(String(readUrl)).toBe("https://example.com/rest/v2/profileProperties/favorite_color");
    expect(readRequestInit?.method).toBe("GET");
    expect((readRequestInit?.headers as Record<string, string>)["X-BlueConic-MCP-Tool-Call"]).toBe(
      "getOneProfileOrGroupProperty"
    );
    expect((readRequestInit?.headers as Record<string, string>).Authorization).toBe("Bearer read-token");

    const [, updateRequestInit] = mockFetch.mock.calls[1];
    expect((updateRequestInit?.headers as Record<string, string>).Authorization).toBe("Bearer token");
    expect(JSON.parse(String(updateRequestInit?.body))).toEqual({
      id: "favorite_color",
      name: "Favorite color",
      description: "New description",
      mergeStrategy: "BOTH",
      tags: ["Preferences"]
    });
  });

  it("keeps the original update body when there is no existing configuration", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    const { makeApiCall } = await loadApiClientModule(mockFetch);

    await makeApiCall(
      "https://example.com",
      "token",
      "PUT",
      "/profileProperties/{propertyId}",
      "1.0.2",
      "createUpdateProfileOrGroupProperty",
      { propertyId: "new_property" },
      {},
      { id: "new_property", name: "New property", useValidation: true },
      "application/json",
      true,
      {
        readPath: "/profileProperties/{propertyId}",
        readToolName: "getOneProfileOrGroupProperty",
        requestBodyAllowedFields: ["id", "name"]
      }
    );

    const [, updateRequestInit] = mockFetch.mock.calls[1];
    expect(JSON.parse(String(updateRequestInit?.body))).toEqual({
      id: "new_property",
      name: "New property"
    });
  });

  it("retains existing multipart metadata while preserving binary updates", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "model-1",
        name: "Existing model",
        type: "GENERAL",
        tags: ["Models"],
        creationDate: "2026-01-01T00:00:00.000Z",
        modelHash: "server-managed"
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    const { makeApiCall } = await loadApiClientModule(mockFetch);

    await makeApiCall(
      "https://example.com",
      "token",
      "PUT",
      "/models/{model}",
      "1.0.2",
      "updateModel",
      { model: "model-1" },
      {},
      {
        metadata: { description: "Updated model" },
        model: {
          base64: Buffer.from("updated-onnx").toString("base64"),
          contentType: "application/octet-stream",
          filename: "model.onnx"
        }
      },
      "multipart/form-data",
      true,
      {
        readPath: "/models/{model}",
        readToolName: "getOneModelMetadata",
        requestBodyPath: ["metadata"],
        requestBodySchema: {
          type: "object",
          properties: {
            metadata: {
              type: "object",
              properties: {
                creationDate: { type: "string", readOnly: true },
                description: { type: "string" },
                id: { type: "string" },
                modelHash: { type: "string", readOnly: true },
                name: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
                type: { type: "string" }
              }
            },
            model: { type: "string" }
          }
        }
      }
    );

    const [, updateRequestInit] = mockFetch.mock.calls[1];
    const body = updateRequestInit?.body as FormData;
    const metadata = body.get("metadata") as Blob;
    const model = body.get("model") as Blob & { name?: string };

    await expect(metadata.text()).resolves.toBe(JSON.stringify({
      id: "model-1",
      name: "Existing model",
      type: "GENERAL",
      tags: ["Models"],
      description: "Updated model"
    }));
    await expect(model.text()).resolves.toBe("updated-onnx");
    expect(model.name).toBe("model.onnx");
  });

  it("retains existing configuration for content store items by item id", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          id: "article-1",
          name: "Existing article",
          description: "Old article",
          properties: [
            { id: "category", values: ["Business"] },
            { id: "creator", values: ["BlueConic"] }
          ],
          creationDate: "2026-01-01T00:00:00.000Z",
          statistics: { view: 12 }
        }]
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    const { makeApiCall } = await loadApiClientModule(mockFetch);

    await makeApiCall(
      "https://example.com",
      "token",
      "PUT",
      "/contentStores/{contentStore}/items",
      "1.0.2",
      "addContentItemsToStore",
      { contentStore: "store-1" },
      {},
      {
        items: [{
          id: "article-1",
          description: "Updated article",
          properties: [{ id: "category", values: ["Technology"] }]
        }]
      },
      "application/json",
      true,
      {
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
        requestBodySchema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  creationDate: { type: "string", readOnly: true },
                  description: { type: "string" },
                  id: { type: "string" },
                  name: { type: "string" },
                  properties: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        values: { type: "array", items: { type: "string" } }
                      }
                    }
                  },
                  statistics: { type: "object", readOnly: true }
                }
              }
            }
          }
        }
      }
    );

    const [readUrl] = mockFetch.mock.calls[0];
    const parsedReadUrl = new URL(String(readUrl));
    expect(parsedReadUrl.searchParams.get("filterValue")).toBe("id==article-1");
    expect(parsedReadUrl.searchParams.get("count")).toBe("1");

    const [, updateRequestInit] = mockFetch.mock.calls[1];
    expect(JSON.parse(String(updateRequestInit?.body))).toEqual({
      items: [{
        id: "article-1",
        name: "Existing article",
        description: "Updated article",
        properties: [
          { id: "category", values: ["Technology"] },
          { id: "creator", values: ["BlueConic"] }
        ]
      }]
    });
  });
});
