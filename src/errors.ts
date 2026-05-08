type BlueConicHttpErrorOptions = {
  operation: string;
  responseBody?: string;
  status: number;
  statusText: string;
};

export const BLUECONIC_CONFIGURATION_REQUIRED_MESSAGE =
  "BlueConic requires configuration before it can be used. See the documentation for setup instructions.";
export const BLUECONIC_TLS_CONFIGURATION_MESSAGE =
  "BlueConic requires standard TLS certificate verification. Configure a trusted certificate before using this server.";

export class BlueConicConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlueConicConfigError";
  }
}

export class BlueConicTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`BlueConic request timed out after ${timeoutMs}ms`);
    this.name = "BlueConicTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class BlueConicHttpError extends Error {
  readonly operation: string;
  readonly responseBody?: string;
  readonly status: number;
  readonly statusText: string;

  constructor(message: string, options: BlueConicHttpErrorOptions) {
    super(message);
    this.name = "BlueConicHttpError";
    this.operation = options.operation;
    this.responseBody = options.responseBody;
    this.status = options.status;
    this.statusText = options.statusText;
  }
}

function getStringField(value: unknown, field: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === "string" ? fieldValue : undefined;
}

function sanitizeUpstreamMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 300);
}

function getUpstreamErrorMessage(responseBody?: string): string | undefined {
  if (!responseBody) {
    return undefined;
  }

  try {
    const parsedBody = JSON.parse(responseBody) as unknown;
    const message =
      getStringField(parsedBody, "message") ??
      getStringField(parsedBody, "error_description");

    if (message) {
      return sanitizeUpstreamMessage(message);
    }

    const errorValue = typeof parsedBody === "object" && parsedBody !== null && !Array.isArray(parsedBody)
      ? (parsedBody as Record<string, unknown>).error
      : undefined;

    if (typeof errorValue === "string") {
      return sanitizeUpstreamMessage(errorValue);
    }

    if (typeof errorValue === "object" && errorValue !== null && !Array.isArray(errorValue)) {
      const nestedMessage = getStringField(errorValue, "message");
      return nestedMessage ? sanitizeUpstreamMessage(nestedMessage) : undefined;
    }
  } catch {
    const trimmedBody = responseBody.trim();
    if (!trimmedBody || trimmedBody.startsWith("<")) {
      return undefined;
    }

    return sanitizeUpstreamMessage(trimmedBody);
  }

  return undefined;
}

export function getClientFacingErrorMessage(
  error: unknown,
  fallbackMessage = "BlueConic could not complete this request. Please try again later."
): string {
  if (error instanceof BlueConicConfigError) {
    return BLUECONIC_CONFIGURATION_REQUIRED_MESSAGE;
  }

  if (error instanceof BlueConicTimeoutError) {
    return "BlueConic timed out while processing the request. Please try again.";
  }

  if (error instanceof BlueConicHttpError) {
    if (error.status === 400) {
      const upstreamMessage = getUpstreamErrorMessage(error.responseBody);

      if (error.operation === "POST /rest/v2/oauth/token") {
        return "BlueConic rejected the requested OAuth scopes. Grant the OAuth application the scopes required by this tool and try again.";
      }

      return upstreamMessage
        ? `BlueConic could not process this request: ${upstreamMessage}`
        : "BlueConic could not process this request. Please review the tool inputs and try again.";
    }

    if (error.status === 401 || error.status === 403) {
      return "BlueConic rejected the request. Please verify the configured credentials and permissions.";
    }

    if (error.status === 404) {
      return "BlueConic could not find the requested resource.";
    }

    if (error.status === 408 || error.status === 504) {
      return "BlueConic timed out while processing the request. Please try again.";
    }

    if (error.status === 429) {
      return "BlueConic is rate limiting requests right now. Please try again in a moment.";
    }

    if (error.status >= 500) {
      return "BlueConic is temporarily unavailable. Please try again later.";
    }
  }

  return fallbackMessage;
}
