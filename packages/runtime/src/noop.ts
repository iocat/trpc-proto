import type { TRPCSubscriptionProcedure } from '@trpc/server';

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

interface NoopSubscriptionBuilder<TOutput> {
  subscription(resolver: (_options?: unknown) => TOutput): unknown;
}

/**
 * Creates a typed, empty-input subscription for a non-TypeScript backend.
 */
export function noopSubscriptionForNonTsBackend<
  TOutput,
  TInput = Record<string, never>,
>(
  builder: NoopSubscriptionBuilder<TOutput>,
): TRPCSubscriptionProcedure<{
  input: TInput;
  output: AsyncIterable<TOutput, void, unknown>;
  meta: unknown;
}> {
  return builder.subscription(noopForNonTsBackend<TOutput>) as never;
}

