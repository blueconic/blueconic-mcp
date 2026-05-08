import {
  DEFAULT_MAX_BULK_ITEMS,
  DEFAULT_MAX_DESTRUCTIVE_BULK_ITEMS,
  normalizeTenantUrl,
  readBulkSafetyLimits
} from "../config.js";

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

describe("readBulkSafetyLimits", () => {
  it("uses conservative defaults", () => {
    expect(readBulkSafetyLimits({})).toEqual({
      maxBulkItems: DEFAULT_MAX_BULK_ITEMS,
      maxDestructiveBulkItems: DEFAULT_MAX_DESTRUCTIVE_BULK_ITEMS
    });
  });

  it("accepts positive integer environment overrides", () => {
    expect(readBulkSafetyLimits({
      BLUECONIC_MAX_BULK_ITEMS: "50",
      BLUECONIC_MAX_DESTRUCTIVE_BULK_ITEMS: "10"
    })).toEqual({
      maxBulkItems: 50,
      maxDestructiveBulkItems: 10
    });
  });

  it("ignores invalid environment overrides", () => {
    expect(readBulkSafetyLimits({
      BLUECONIC_MAX_BULK_ITEMS: "0",
      BLUECONIC_MAX_DESTRUCTIVE_BULK_ITEMS: "not-a-number"
    })).toEqual({
      maxBulkItems: DEFAULT_MAX_BULK_ITEMS,
      maxDestructiveBulkItems: DEFAULT_MAX_DESTRUCTIVE_BULK_ITEMS
    });
  });
});
