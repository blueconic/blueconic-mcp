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

  it("caches tokens for the same tenant and client id", async () => {
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
});
