import { BlueConicConfigError, BlueConicHttpError, getClientFacingErrorMessage } from "../errors.js";

describe("getClientFacingErrorMessage", () => {
  it("returns a safe configuration message for config errors", () => {
    expect(getClientFacingErrorMessage(new BlueConicConfigError("raw config detail"))).toBe(
      "BlueConic is not configured correctly. Please verify the tenant URL and OAuth credentials."
    );
  });

  it("maps authentication failures to a sanitized message", () => {
    const error = new BlueConicHttpError("401 detail", {
      operation: "GET /segments",
      status: 401,
      statusText: "Unauthorized",
      responseBody: "{\"message\":\"invalid client\"}"
    });

    expect(getClientFacingErrorMessage(error)).toBe(
      "BlueConic rejected the request. Please verify the configured credentials and permissions."
    );
  });

  it("maps validation failures to a safe tool-input message", () => {
    const error = new BlueConicHttpError("400 detail", {
      operation: "GET /segments",
      status: 400,
      statusText: "Bad Request",
      responseBody: "{\"detail\":\"internal validation trace\"}"
    });

    expect(getClientFacingErrorMessage(error)).toBe(
      "BlueConic could not process this request. Please review the tool inputs and try again."
    );
  });

  it("falls back to a generic message for unknown errors", () => {
    expect(getClientFacingErrorMessage(new Error("raw upstream text"))).toBe(
      "BlueConic could not complete this request. Please try again later."
    );
  });
});
