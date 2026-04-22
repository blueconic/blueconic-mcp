export function createLazyLoadGuard(
  isLoaded: () => boolean,
  load: () => Promise<void>
): () => Promise<void> {
  let inFlightLoad: Promise<void> | null = null;

  return async function ensureLoaded(): Promise<void> {
    if (isLoaded()) {
      return;
    }

    if (!inFlightLoad) {
      inFlightLoad = load().finally(() => {
        inFlightLoad = null;
      });
    }

    await inFlightLoad;
  };
}
