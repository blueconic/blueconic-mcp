export type BulkSafetyLimits = {
  maxBulkItems: number;
  maxDestructiveBulkItems: number;
};

export const DEFAULT_MAX_BULK_ITEMS = 100;
export const DEFAULT_MAX_DESTRUCTIVE_BULK_ITEMS = 25;

export function normalizeTenantUrl(rawTenantUrl?: string): string | undefined {
  if (!rawTenantUrl) {
    return undefined;
  }

  const tenantUrl = rawTenantUrl
    .replace(/^http:\/\//i, "https://")
    .replace(/^(?!https:\/\/)/i, "https://");
  return tenantUrl.endsWith("/") ? tenantUrl.slice(0, -1) : tenantUrl;
}

export function readBulkSafetyLimits(env: Record<string, string | undefined> = process.env): BulkSafetyLimits {
  const maxBulkItems = readPositiveIntegerEnv(
    env.BLUECONIC_MAX_BULK_ITEMS,
    DEFAULT_MAX_BULK_ITEMS
  );
  const maxDestructiveBulkItems = readPositiveIntegerEnv(
    env.BLUECONIC_MAX_DESTRUCTIVE_BULK_ITEMS,
    DEFAULT_MAX_DESTRUCTIVE_BULK_ITEMS
  );

  return {
    maxBulkItems,
    maxDestructiveBulkItems
  };
}

function readPositiveIntegerEnv(value: string | undefined, fallbackValue: number): number {
  if (!value) {
    return fallbackValue;
  }

  const parsedValue = Number(value);
  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    return fallbackValue;
  }

  return parsedValue;
}
