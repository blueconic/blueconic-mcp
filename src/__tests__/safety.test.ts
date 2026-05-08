import {
  buildDryRunSummary,
  buildToolDescription,
  estimateObjectCount,
  getMisplacedConfirmationToken,
  getEffectiveMaxBatchSize,
  getOperationAnnotations,
  type OperationSafetyPolicy
} from "../safety.js";

describe("operation safety helpers", () => {
  const readPolicy = {
    requiresConfirmation: false,
    risk: "read"
  } as const satisfies OperationSafetyPolicy;
  const additiveWritePolicy = {
    requiresConfirmation: false,
    risk: "additive_write"
  } as const satisfies OperationSafetyPolicy;
  const destructiveWritePolicy = {
    maxBatchSize: 100,
    requiresConfirmation: true,
    risk: "destructive_write"
  } as const satisfies OperationSafetyPolicy;

  it("derives MCP annotations from explicit risk policy", () => {
    expect(getOperationAnnotations(readPolicy, "post")).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false
    });
    expect(getOperationAnnotations(additiveWritePolicy, "post")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false
    });
    expect(getOperationAnnotations(destructiveWritePolicy, "put")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true
    });
  });

  it("prepends warning guidance to write descriptions", () => {
    expect(buildToolDescription("List segments", readPolicy)).toBe("List segments");
    expect(buildToolDescription("Create model", additiveWritePolicy)).toContain(
      "WARNING: This tool modifies live BlueConic data."
    );
    expect(buildToolDescription("Update model", destructiveWritePolicy)).toContain(
      "Execution requires user confirmation or a one-time confirmationToken."
    );
  });

  it("estimates object counts without treating nested metadata arrays as bulk records", () => {
    expect(estimateObjectCount({ items: [{ id: "a" }, { id: "b" }] })).toBe(2);
    expect(estimateObjectCount({ metadata: { tags: ["A", "B", "C"] } })).toBe(1);
    expect(estimateObjectCount(null, { ids: ["a", "b"] })).toBe(2);
  });

  it("applies stricter destructive bulk caps", () => {
    expect(getEffectiveMaxBatchSize(additiveWritePolicy, {
      maxBulkItems: 100,
      maxDestructiveBulkItems: 25
    })).toBe(100);
    expect(getEffectiveMaxBatchSize(destructiveWritePolicy, {
      maxBulkItems: 100,
      maxDestructiveBulkItems: 25
    })).toBe(25);
  });

  it("builds dry-run summaries for write calls", () => {
    expect(buildDryRunSummary({
      estimatedObjectCount: 2,
      finalPath: "/contentStores/store-a/items",
      maxBatchSize: 25,
      method: "PUT",
      path: "/contentStores/{contentStore}/items",
      pathParams: { contentStore: "store-a" },
      policy: destructiveWritePolicy,
      queryParams: {},
      targetEndpoint: "https://tenant.blueconic.net/rest/v2/contentStores/store-a/items",
      tenantUrl: "https://tenant.blueconic.net",
      toolName: "addContentItemsToStore"
    })).toMatchObject({
      dryRun: true,
      executed: false,
      destructive: true,
      requiresConfirmation: true,
      confirmationTokenUsage: {
        argumentName: "confirmationToken",
        placement: "top-level tool argument",
        siblingOf: "requestBody",
        doNotPlaceInside: "requestBody"
      },
      estimatedObjectCount: 2,
      maxBatchSize: 25,
      wouldExceedMaxBatchSize: false
    });
  });

  it("detects confirmation tokens misplaced inside requestBody", () => {
    expect(getMisplacedConfirmationToken({
      confirmationToken: "token-123",
      items: []
    })).toBe("token-123");
    expect(getMisplacedConfirmationToken({
      items: []
    })).toBeUndefined();
  });
});
