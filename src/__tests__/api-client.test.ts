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
});
