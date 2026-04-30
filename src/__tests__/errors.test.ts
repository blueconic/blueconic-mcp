import {
  BLUECONIC_CONFIGURATION_REQUIRED_MESSAGE,
  BlueConicConfigError,
  BlueConicHttpError,
  BlueConicTimeoutError,
  getClientFacingErrorMessage
} from "../errors.js";

describe("getClientFacingErrorMessage", () => {
  it("returns a safe configuration message for config errors", () => {
    expect(getClientFacingErrorMessage(new BlueConicConfigError("raw config detail"))).toBe(
      BLUECONIC_CONFIGURATION_REQUIRED_MESSAGE
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

  it("maps timeout failures to a retryable message", () => {
    expect(getClientFacingErrorMessage(new BlueConicTimeoutError(30_000))).toBe(
      "BlueConic timed out while processing the request. Please try again."
    );
  });

  it("maps rate limits to a retryable message", () => {
    const error = new BlueConicHttpError("429 detail", {
      operation: "GET /segments",
      status: 429,
      statusText: "Too Many Requests",
      responseBody: "{\"message\":\"rate limited\"}"
    });

    expect(getClientFacingErrorMessage(error)).toBe(
      "BlueConic is rate limiting requests right now. Please try again in a moment."
    );
  });

  it("maps server failures to a temporary availability message", () => {
    const error = new BlueConicHttpError("503 detail", {
      operation: "GET /segments",
      status: 503,
      statusText: "Service Unavailable",
      responseBody: "{\"message\":\"busy\"}"
    });

    expect(getClientFacingErrorMessage(error)).toBe(
      "BlueConic is temporarily unavailable. Please try again later."
    );
  });

  it("falls back to a generic message for unknown errors", () => {
    expect(getClientFacingErrorMessage(new Error("raw upstream text"))).toBe(
      "BlueConic could not complete this request. Please try again later."
    );
  });
});
