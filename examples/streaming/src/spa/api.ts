import { createTRPCClient } from '@trpc/client';
import { grpcWebLink } from '@trpc-proto/runtime/web';
import { protoSchema } from '../../generated/schema.js';
import type { AppRouter } from '../router.js';

export const client = createTRPCClient<AppRouter>({
  links: [
    grpcWebLink<AppRouter>({
      schema: protoSchema,
      url: `${location.protocol}//${location.hostname}:3103`,
      encoding: 'raw',
      compress: true,
    }),
  ],
});
