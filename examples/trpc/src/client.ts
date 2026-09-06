import { createTRPCClient } from '@trpc/client';
import { grpcLink } from '@trpc-proto/runtime';
import { GRPC_ADDRESS } from './address.js';
import { appRouter, type AppRouter } from './router.js';
const client = createTRPCClient<AppRouter>({
  links: [
    grpcLink({
      router: appRouter,
      address: GRPC_ADDRESS,
    }),
  ],
});

const health = await client.health.query();
const echo = await client.echo.query('protobuf');
const put = await client.note.put.mutate({ id: 'n1', body: 'from tRPC' });
const got = await client.note.get.query({ id: put.id });

process.stdout.write(`${JSON.stringify({ health, echo, put, got }, null, 2)}\n`);
