import { BlueConicHttpError, BlueConicTimeoutError } from "../errors.js";
import { formatErrorForLog } from "../logging.js";

describe("formatErrorForLog", () => {
  it("always omits upstream response bodies from logs", () => {
    expect(
      formatErrorForLog(
        new BlueConicHttpError("BlueConic API request failed", {
          operation: "GET /profiles",
          responseBody: "{\"stack\":\"internal trace\"}",
          status: 500,
          statusText: "Internal Server Error"
        })
      )
    ).toEqual({
      name: "BlueConicHttpError",
      message: "BlueConic API request failed",
      operation: "GET /profiles",
      status: 500,
      statusText: "Internal Server Error"
    });
  });

  it("serializes timeout metadata explicitly", () => {
    expect(formatErrorForLog(new BlueConicTimeoutError(30_000))).toEqual({
      name: "BlueConicTimeoutError",
      message: "BlueConic request timed out after 30000ms",
      timeoutMs: 30_000
    });
  });

  it("serializes generic errors without stack traces", () => {
    expect(formatErrorForLog(new Error("plain failure"))).toEqual({
      name: "Error",
      message: "plain failure"
    });
  });

  it("serializes non-error values safely", () => {
    expect(formatErrorForLog("plain string")).toEqual({
      value: "plain string"
    });
  });
});
