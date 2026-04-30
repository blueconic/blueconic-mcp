export function normalizeTenantUrl(rawTenantUrl?: string): string | undefined {
  if (!rawTenantUrl) {
    return undefined;
  }

  const tenantUrl = rawTenantUrl
    .replace(/^http:\/\//i, "https://")
    .replace(/^(?!https:\/\/)/i, "https://");
  return tenantUrl.endsWith("/") ? tenantUrl.slice(0, -1) : tenantUrl;
}
