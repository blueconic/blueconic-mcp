import { jest } from "@jest/globals";

function setGlobalFetch(mockFetch: typeof fetch): void {
  Object.defineProperty(globalThis, "fetch", {
    value: mockFetch,
    configurable: true,
    writable: true
  });
}

describe("fetchWithTimeout", () => {
  const originalFetch = globalThis.fetch;

  async function loadHttpModule(mockFetch: typeof fetch) {
    jest.resetModules();
    setGlobalFetch(mockFetch);
    return await import("../http.js");
  }

  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
    jest.restoreAllMocks();
    setGlobalFetch(originalFetch);
  });

  it("rejects hung requests after the configured timeout", async () => {
    jest.useFakeTimers();
    const mockFetch = jest.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const { fetchWithTimeout } = await loadHttpModule(mockFetch);

    const requestPromise = fetchWithTimeout("https://example.com", undefined, 25);
    const rejectionExpectation = expect(requestPromise).rejects.toMatchObject({
      name: "BlueConicTimeoutError",
      message: "BlueConic request timed out after 25ms"
    });

    await jest.advanceTimersByTimeAsync(25);

    await rejectionExpectation;
  });

  it("returns successful responses before the timeout elapses", async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue(new Response("ok", { status: 200 }));
    const { fetchWithTimeout } = await loadHttpModule(mockFetch);

    await expect(fetchWithTimeout("https://example.com", undefined, 25)).resolves.toBeInstanceOf(Response);
  });

  it("rejects when an external abort signal is triggered", async () => {
    jest.useFakeTimers();
    const mockFetch = jest.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const { fetchWithTimeout } = await loadHttpModule(mockFetch);
    const abortController = new AbortController();
    const externalAbortError = new Error("caller cancelled request");
    const requestPromise = fetchWithTimeout(
      "https://example.com",
      { signal: abortController.signal },
      250
    );
    const rejectionExpectation = expect(requestPromise).rejects.toBe(externalAbortError);

    abortController.abort(externalAbortError);
    await jest.advanceTimersByTimeAsync(0);

    await rejectionExpectation;
  });
});
