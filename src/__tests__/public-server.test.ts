import { readSetting, resolveAuthHeaders, resolveEndpoint } from "../public-server.js";

describe("readSetting", () => {
  it("treats a placeholder the host did not substitute as empty", () => {
    expect(readSetting("${user_config.oauth_token}")).toBe("");
  });

  it("keeps a real value, without the surrounding blanks", () => {
    expect(readSetting("  a-client-id  ")).toBe("a-client-id");
  });

  it("treats an absent value as empty", () => {
    expect(readSetting(undefined)).toBe("");
  });
});

describe("resolveEndpoint", () => {
  it("builds the endpoint out of a bare host", () => {
    expect(resolveEndpoint("tenantname.blueconic.net").url?.toString()).toBe("https://tenantname.blueconic.net/mcp");
  });

  it("builds the endpoint out of the tenant URL", () => {
    expect(resolveEndpoint("https://tenantname.blueconic.net").url?.toString()).toBe(
      "https://tenantname.blueconic.net/mcp"
    );
  });

  it("accepts the endpoint itself, and a trailing slash", () => {
    expect(resolveEndpoint("https://tenantname.blueconic.net/mcp/").url?.toString()).toBe(
      "https://tenantname.blueconic.net/mcp"
    );
  });

  it("drops a query and a fragment", () => {
    expect(resolveEndpoint("https://tenantname.blueconic.net/mcp?a=1#b").url?.toString()).toBe(
      "https://tenantname.blueconic.net/mcp"
    );
  });

  it("names the missing setting rather than throwing", () => {
    expect(resolveEndpoint("").reason).toContain("no tenant URL yet");
  });

  it("refuses plain HTTP, because the credentials travel as headers", () => {
    expect(resolveEndpoint("http://tenantname.blueconic.net").reason).toContain("must use HTTPS");
  });

  it("allows plain HTTP on loopback, for a tenant on the developer's own machine", () => {
    expect(resolveEndpoint("http://localhost:3737").url?.toString()).toBe("http://localhost:3737/mcp");
    expect(resolveEndpoint("http://127.0.0.1:8080").url?.toString()).toBe("http://127.0.0.1:8080/mcp");
  });

  it("refuses a URL that carries some other path", () => {
    expect(resolveEndpoint("https://tenantname.blueconic.net/rest/v2").reason).toContain("/rest/v2");
  });
});

describe("resolveAuthHeaders", () => {
  it("sends the client credentials as two headers", () => {
    const { headers } = resolveAuthHeaders({ OAUTH_CLIENT_ID: "id", OAUTH_CLIENT_SECRET: "secret with spaces" });

    expect(headers).toEqual({
      "X-BlueConic-Client-ID": "id",
      "X-BlueConic-Client-Secret": "secret with spaces"
    });
  });

  it("prefers a token over the client credentials, as the servlet does", () => {
    const { headers } = resolveAuthHeaders({
      BLUECONIC_OAUTH_TOKEN: "abc",
      OAUTH_CLIENT_ID: "id",
      OAUTH_CLIENT_SECRET: "secret"
    });

    expect(headers).toEqual({ Authorization: "Bearer abc" });
  });

  it("keeps a token that already carries its scheme", () => {
    expect(resolveAuthHeaders({ BLUECONIC_OAUTH_TOKEN: "Bearer abc" }).headers).toEqual({
      Authorization: "Bearer abc"
    });
  });

  it("names the missing credentials rather than throwing", () => {
    expect(resolveAuthHeaders({}).reason).toContain("no credentials yet");
  });

  it("ignores a placeholder the host did not substitute", () => {
    expect(
      resolveAuthHeaders({
        BLUECONIC_OAUTH_TOKEN: "${user_config.oauth_token}",
        OAUTH_CLIENT_ID: "id",
        OAUTH_CLIENT_SECRET: "secret"
      }).headers
    ).toEqual({ "X-BlueConic-Client-ID": "id", "X-BlueConic-Client-Secret": "secret" });
  });
});
