import { normalizeTenantUrl } from "../config.js";

describe("normalizeTenantUrl", () => {
  it("returns undefined when no tenant URL is configured", () => {
    expect(normalizeTenantUrl()).toBeUndefined();
    expect(normalizeTenantUrl("")).toBeUndefined();
  });

  it("prefixes bare hostnames with https", () => {
    expect(normalizeTenantUrl("tenant.blueconic.net")).toBe("https://tenant.blueconic.net");
  });

  it("preserves https URLs and removes a trailing slash", () => {
    expect(normalizeTenantUrl("https://tenant.blueconic.net/")).toBe("https://tenant.blueconic.net");
  });

  it("upgrades http URLs to https before credentials are used", () => {
    expect(normalizeTenantUrl("http://tenant.blueconic.net")).toBe("https://tenant.blueconic.net");
    expect(normalizeTenantUrl("HTTP://tenant.blueconic.net/")).toBe("https://tenant.blueconic.net");
  });
});
