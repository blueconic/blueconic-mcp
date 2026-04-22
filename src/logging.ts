import { BlueConicHttpError, BlueConicTimeoutError } from "./errors.js";

export function formatErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof BlueConicHttpError) {
    return {
      name: error.name,
      message: error.message,
      operation: error.operation,
      status: error.status,
      statusText: error.statusText
    };
  }

  if (error instanceof BlueConicTimeoutError) {
    return {
      name: error.name,
      message: error.message,
      timeoutMs: error.timeoutMs
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return {
    value: String(error)
  };
}

export function logError(context: string, error: unknown): void {
  console.error(context, formatErrorForLog(error));
}
