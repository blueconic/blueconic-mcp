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
      makeApiCall("https://example.com", "", "GET", "/segments", "1.0.2")
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
      makeApiCall("https://example.com", "token", "GET", "/segments", "1.0.2")
    ).resolves.toEqual({ ok: true });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });
});
