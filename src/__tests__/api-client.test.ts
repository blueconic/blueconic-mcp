import { makeApiCall } from "../api-client.js";

describe("makeApiCall", () => {
  it("throws when the OAuth token is missing", async () => {
    await expect(
      makeApiCall("https://example.com", "", "GET", "/segments", "1.0.0")
    ).rejects.toThrow("OAuth access token not configured");
  });
});
