import { jest } from "@jest/globals";

function setGlobalFetch(mockFetch: typeof fetch): void {
  Object.defineProperty(globalThis, "fetch", {
    value: mockFetch,
    configurable: true,
    writable: true
  });
}

function createTokenResponse(accessToken: string, expiresIn = 3600): Response {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: expiresIn }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("getAccessToken", () => {
  const originalFetch = globalThis.fetch;

  async function loadAuthModule(mockFetch: typeof fetch) {
    jest.resetModules();
    setGlobalFetch(mockFetch);
    return await import("../auth.js");
  }

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    setGlobalFetch(originalFetch);
  });

  it("caches tokens for the same tenant, client id, secret, and scopes", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(createTokenResponse("token-1"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(
      getAccessToken("https://tenant.blueconic.net", "client-a", "secret-a")
    ).resolves.toBe("token-1");
    await expect(
      getAccessToken("https://tenant.blueconic.net", "client-a", "secret-a")
    ).resolves.toBe("token-1");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not reuse cached tokens across different tenant and client pairs", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createTokenResponse("token-a"))
      .mockResolvedValueOnce(createTokenResponse("token-b"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(
      getAccessToken("https://tenant-a.blueconic.net", "client-a", "secret-a")
    ).resolves.toBe("token-a");
    await expect(
      getAccessToken("https://tenant-b.blueconic.net", "client-a", "secret-a")
    ).resolves.toBe("token-b");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not reuse cached tokens across different client secrets", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createTokenResponse("token-a"))
      .mockResolvedValueOnce(createTokenResponse("token-b"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(
      getAccessToken("https://tenant.blueconic.net", "client-a", "secret-a")
    ).resolves.toBe("token-a");
    await expect(
      getAccessToken("https://tenant.blueconic.net", "client-a", "secret-b")
    ).resolves.toBe("token-b");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does not reuse cached tokens across different scope sets", async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createTokenResponse("read-token"))
      .mockResolvedValueOnce(createTokenResponse("write-token"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(
      getAccessToken("https://tenant.blueconic.net", "client-a", "secret-a", ["read:profiles"])
    ).resolves.toBe("read-token");
    await expect(
      getAccessToken("https://tenant.blueconic.net", "client-a", "secret-a", ["write:profiles"])
    ).resolves.toBe("write-token");

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("sends requested scopes in sorted order", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(createTokenResponse("token-1"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(
      getAccessToken("https://tenant.blueconic.net", "client-a", "secret-a", [
        "write:profiles",
        "read:profiles"
      ])
    ).resolves.toBe("token-1");

    const [, requestInit] = mockFetch.mock.calls[0];
    expect(requestInit?.body).toBe("grant_type=client_credentials&scope=read%3Aprofiles+write%3Aprofiles");
  });

  it("sends OAuth requests with a timeout-backed abort signal", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(createTokenResponse("token-1"));
    const { getAccessToken } = await loadAuthModule(mockFetch);

    await expect(
      getAccessToken("https://tenant.blueconic.net", "client-a", "secret-a")
    ).resolves.toBe("token-1");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://tenant.blueconic.net/rest/v2/oauth/token",
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    );
  });
});
