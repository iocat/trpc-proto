import { createTRPCClient, loggerLink } from '@trpc/client';
import { grpcWebLink } from '@trpc-proto/runtime/web';
import { protoSchema } from '../../generated/schema.js';
import type { AppRouter } from '../router.js';

export const client = createTRPCClient<AppRouter>({
  links: [
    loggerLink<AppRouter>(),
    grpcWebLink<AppRouter>({
      schema: protoSchema,
      url: `${location.protocol}//${location.hostname}:3103`,
      encoding: 'raw',
      compress: true,
      batch: true,
      interceptors: [
        async (context, next) => {
          const startedAt = performance.now();
          if (context.path === 'batch.execute') {
            const request = context.input as {
              calls?: Array<{
                id: number;
                path: string;
                input?: Uint8Array;
              }>;
            };
            console.groupCollapsed(
              `[gRPC-Web batch] ${request.calls?.length ?? 0} ${context.type} operations`,
            );
            console.table(
              (request.calls ?? []).map((call) => ({
                id: call.id,
                path: call.path,
                bytes: call.input?.byteLength ?? 0,
              })),
            );
            console.groupEnd();
          }

          try {
            const response = await next(context);
            console.debug(`[gRPC-Web] ${context.grpcPath}`, {
              durationMs: Math.round(performance.now() - startedAt),
              responseBytes:
                response instanceof Uint8Array
                  ? response.byteLength
                  : undefined,
            });
            return response;
          } catch (error) {
            console.error(`[gRPC-Web] ${context.grpcPath}`, {
              durationMs: Math.round(performance.now() - startedAt),
              error,
            });
            throw error;
          }
        },
      ],
    }),
  ],
});
