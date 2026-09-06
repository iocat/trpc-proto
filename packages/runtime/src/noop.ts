/**
 * Empty procedure body. tRPC requires a resolver; `.input()` / `.output()`
 * are the contract. A non-TS service that implements the generated proto
 * is the real backend.
 *
 * Return type `never` is assignable to any output, so this type-checks.
 * At runtime the function returns `undefined` and does no work.
 */
export function noopForNonTsBackend(_opts?: unknown): never {
  return undefined as never;
}
