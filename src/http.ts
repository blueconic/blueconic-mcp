const fetch = globalThis.fetch?.bind(globalThis);

if (!fetch) {
  throw new Error("This runtime does not provide a global fetch implementation");
}

export { fetch };
