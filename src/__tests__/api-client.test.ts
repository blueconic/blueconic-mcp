import { makeApiCall } from "../api-client.js";

describe("makeApiCall", () => {
  it("should throw error for missing token", async () => {
    await expect(
      makeApiCall("https://example.com", "", "GET", "/test", "0.0.1")
    ).rejects.toThrow();
  });
  // Add more tests as needed, e.g., for path/query params, requestBody, etc.
});
