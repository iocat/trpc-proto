import { TRPCError, type AnyRouter } from '@trpc/server';

export interface InvokeRequest {
  path: string;
  input?: unknown;
  ctx?: unknown;
  signal?: AbortSignal;
}

export type Invoker = (request: InvokeRequest) => Promise<unknown>;

type Procedure = {
  _def: { type: 'query' | 'mutation' | 'subscription' };
  (opts: {
    path: string;
    getRawInput: () => Promise<unknown>;
    ctx: unknown;
    type: 'query' | 'mutation' | 'subscription';
    signal?: AbortSignal;
    batchIndex?: number;
  }): Promise<unknown>;
};

function procedureAt(router: AnyRouter, path: string) {
  const procedures = router._def.procedures as Record<string, Procedure | undefined>;
  return procedures[path];
}

/** Call a tRPC procedure by path. Wire this into any gRPC/Connect stub. */
export function createInvoker(
  router: AnyRouter,
  opts?: { createContext?: () => unknown | Promise<unknown> },
): Invoker {
  return async (request) => {
    const procedure = procedureAt(router, request.path);
    if (!procedure) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `No procedure on path "${request.path}"`,
      });
    }
    const ctx =
      request.ctx ??
      (opts?.createContext ? await opts.createContext() : {});
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
