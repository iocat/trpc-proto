import { TRPCError, type AnyRouter } from '@trpc/server';
import { isAsyncIterable } from '@trpc-proto/utility';

export type RouterInvoker = (request: {
  path: string;
  input?: unknown;
  signal?: AbortSignal;
  context?: unknown;
}) => Promise<unknown>;

type Procedure = {
  _def: {
    type: 'query' | 'mutation' | 'subscription';
  };
  (opts: {
    path: string;
    getRawInput: () => Promise<unknown>;
    ctx: unknown;
    type: 'query' | 'mutation' | 'subscription';
    signal?: AbortSignal;
    batchIndex?: number;
  }): Promise<unknown>;
};

export function createRouterInvoker(
  router: AnyRouter,
  opts?: { createContext?: () => unknown | Promise<unknown> },
): RouterInvoker {
  return async (request) => {
    const procedure = (
      router._def.procedures as Record<string, Procedure | undefined>
    )[request.path];
    if (!procedure) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `No procedure on path "${request.path}"`,
      });
    }
    const ctx =
      'context' in request
        ? request.context
        : opts?.createContext
          ? await opts.createContext()
          : {};
    return procedure({
      path: request.path,
      getRawInput: async () => request.input,
      ctx,
      type: procedure._def.type,
      signal: request.signal,
      batchIndex: 0,
    });
  };
}

function isObservable(value: unknown): value is {
  subscribe: (observer: {
    next: (item: unknown) => void;
    error: (error: unknown) => void;
    complete: () => void;
  }) => { unsubscribe?: () => void };
} {
  return (
    value !== null &&
    typeof value === 'object' &&
    'subscribe' in value &&
    typeof (value as { subscribe?: unknown }).subscribe === 'function'
  );
}

export async function* toAsyncIterable(
  result: unknown,
): AsyncIterable<unknown> {
  const value = await result;
  if (isAsyncIterable(value)) {
    yield* value;
    return;
  }
  if (isObservable(value)) {
    const pending: unknown[] = [];
    let done = false;
    let failure: unknown;
    let notify: (() => void) | undefined;
    const subscription = value.subscribe({
      next: (item) => {
        pending.push(item);
        notify?.();
      },
      error: (error) => {
        failure = error;
        done = true;
        notify?.();
      },
      complete: () => {
        done = true;
        notify?.();
      },
    });
    try {
      while (!done || pending.length > 0) {
        if (pending.length > 0) {
          yield pending.shift();
          continue;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
      if (failure) throw failure;
    } finally {
      subscription.unsubscribe?.();
    }
    return;
  }
  yield value;
}
