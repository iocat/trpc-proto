import type { TrackedEnvelope } from '@trpc/server';
import { isTrackedEnvelope, tracked } from '@trpc/server';
import { z } from 'zod';

const YIELD_SCHEMA = Symbol.for('@trpc-proto/zAsyncIterable/yield');

type MarkedSchema = z.ZodType & {
  [YIELD_SCHEMA]?: z.ZodType;
};

function isAsyncIterable<TValue, TReturn = unknown>(
  value: unknown,
): value is AsyncIterable<TValue, TReturn> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AsyncIterable<TValue, TReturn>)[Symbol.asyncIterator] ===
      'function'
  );
}

const trackedEnvelopeSchema =
  z.custom<TrackedEnvelope<unknown>>(isTrackedEnvelope);

export function asyncIterableYieldSchema(
  schema: unknown,
): z.ZodType | undefined {
  if (schema === null || typeof schema !== 'object') return undefined;
  return (schema as MarkedSchema)[YIELD_SCHEMA];
}

/** Validates an async iterable and each value it yields. */
export function zAsyncIterable<
  TYieldIn,
  TYieldOut,
  TReturnIn = void,
  TReturnOut = void,
  Tracked extends boolean = false,
>(options: {
  yield: z.ZodType<TYieldOut, TYieldIn>;
  return?: z.ZodType<TReturnOut, TReturnIn>;
  tracked?: Tracked;
}): z.ZodType<
  AsyncIterable<
    Tracked extends true ? TrackedEnvelope<TYieldOut> : TYieldOut,
    TReturnOut,
    unknown
  >,
  AsyncIterable<
    Tracked extends true ? TrackedEnvelope<TYieldIn> : TYieldIn,
    TReturnIn,
    unknown
  >
> {
  const schema = z
    .custom<
      AsyncIterable<
        Tracked extends true ? TrackedEnvelope<TYieldIn> : TYieldIn,
        TReturnIn
      >
    >(isAsyncIterable)
    .transform(async function* (iterable) {
      const iterator = iterable[Symbol.asyncIterator]();

      try {
        let next = await iterator.next();
        while (!next.done) {
          if (options.tracked) {
            const [id, value] = trackedEnvelopeSchema.parse(next.value);
            yield tracked(id, await options.yield.parseAsync(value));
          } else {
            yield await options.yield.parseAsync(next.value);
          }
          next = await iterator.next();
        }

        if (options.return) {
          return await options.return.parseAsync(next.value);
        }
      } finally {
        await iterator.return?.();
      }
    }) as z.ZodType<
    AsyncIterable<
      Tracked extends true ? TrackedEnvelope<TYieldOut> : TYieldOut,
      TReturnOut,
      unknown
    >,
    AsyncIterable<
      Tracked extends true ? TrackedEnvelope<TYieldIn> : TYieldIn,
      TReturnIn,
      unknown
    >
  >;

  Object.defineProperty(schema, YIELD_SCHEMA, { value: options.yield });
  return schema;
}
