import { BlueConicTimeoutError } from "./errors.js";

const fetch = globalThis.fetch?.bind(globalThis);

if (!fetch) {
  throw new Error("This runtime does not provide a global fetch implementation");
}

export const REQUEST_TIMEOUT_MS = 30_000;

type FetchInput = Parameters<typeof fetch>[0];
type FetchOptions = Parameters<typeof fetch>[1];

function createAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }

  return new Error("The request was aborted.");
}

export async function fetchWithTimeout(
  input: FetchInput,
  init?: FetchOptions,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const timeoutController = new AbortController();
  const requestInit = init ?? {};
  const cleanupCallbacks: Array<() => void> = [];

  const timeoutPromise = new Promise<Response>((_, reject) => {
    const timeoutId = setTimeout(() => {
      timeoutController.abort();
      reject(new BlueConicTimeoutError(timeoutMs));
    }, timeoutMs);

    cleanupCallbacks.push(() => clearTimeout(timeoutId));
  });

  const requestPromises: Array<Promise<Response>> = [
    fetch(input, {
      ...requestInit,
      signal: timeoutController.signal
    }),
    timeoutPromise
  ];

  if (requestInit.signal) {
    if (requestInit.signal.aborted) {
      throw createAbortError(requestInit.signal);
    }

    const forwardAbort = () => {
      timeoutController.abort();
    };

    requestInit.signal.addEventListener("abort", forwardAbort, { once: true });
    cleanupCallbacks.push(() => requestInit.signal?.removeEventListener("abort", forwardAbort));

    requestPromises.push(new Promise<Response>((_, reject) => {
      const onAbort = () => {
        reject(createAbortError(requestInit.signal as AbortSignal));
      };

      requestInit.signal?.addEventListener("abort", onAbort, { once: true });
      cleanupCallbacks.push(() => requestInit.signal?.removeEventListener("abort", onAbort));
    }));
  }

  try {
    return await Promise.race(requestPromises);
  } finally {
    for (const cleanup of cleanupCallbacks) {
      cleanup();
    }
  }
}

export { fetch };
