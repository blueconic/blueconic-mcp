import { jest } from "@jest/globals";

import { createLazyLoadGuard } from "../tool-loader.js";

describe("createLazyLoadGuard", () => {
  it("deduplicates concurrent loads until the first one completes", async () => {
    let loaded = false;
    let resolveLoad: (() => void) | undefined;
    const load = jest.fn(() => new Promise<void>((resolve) => {
      resolveLoad = () => {
        loaded = true;
        resolve();
      };
    }));
    const ensureLoaded = createLazyLoadGuard(() => loaded, load);

    const firstLoad = ensureLoaded();
    const secondLoad = ensureLoaded();

    expect(load).toHaveBeenCalledTimes(1);

    resolveLoad?.();
    await Promise.all([firstLoad, secondLoad]);
  });

  it("retries after a failed load attempt", async () => {
    let loaded = false;
    const load = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockImplementation(() => {
        loaded = true;
        return Promise.resolve();
      });
    const ensureLoaded = createLazyLoadGuard(() => loaded, load);

    await expect(ensureLoaded()).rejects.toThrow("temporary failure");
    await expect(ensureLoaded()).resolves.toBeUndefined();

    expect(load).toHaveBeenCalledTimes(2);
  });
});
