/**
 * Empty procedure body. tRPC requires a resolver; `.input()` / `.output()`
 * are the contract. A non-TS service that implements the generated proto
 * is the real backend.
 *
 * The generic return type lets schema-only procedures state their resolver
 * output explicitly. At runtime the function returns `undefined`.
 */
export function noopForNonTsBackend<T>(_opts?: unknown): T {
  return undefined as T;
}

/**
 * Empty subscription body for a non-TypeScript backend.
 */
export function noopSubscriptionForNonTsBackend<T>(
  _opts?: unknown,
): AsyncIterable<T> {
  return undefined as unknown as AsyncIterable<T>;
}
