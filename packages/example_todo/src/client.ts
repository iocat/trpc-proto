import { createTRPCClient } from '@trpc/client';
import { grpcLink } from '@trpc-proto/runtime';
import { appRouter, type AppRouter } from './router.js';

/** gRPC dial target for the todo Go server. */
const GRPC_ADDRESS = '127.0.0.1:50052';

/**
 * Bearer token required by the Go todo gRPC server.
 * Must match `authToken` in `packages/example_todo/backend/main.go`.
 */
const AUTH_TOKEN = 'td_c4a8e1b6f0d39725a8e4b1c7d6f2a905';

const client = createTRPCClient<AppRouter>({
  links: [
    grpcLink({
      router: appRouter,
      address: GRPC_ADDRESS,
      auth: {
        token: AUTH_TOKEN,
      },
    }),
  ],
});

const health = await client.health.query();
const created = await client.todo.create.mutate({
  title: 'Ship protobuf link',
  notes: 'wire tRPC to Go',
});
const listedOpen = await client.todo.list.query({ done: false });
const fetched = await client.todo.getById.query({ id: created.id });
const completed = await client.todo.setDone.mutate({
  id: created.id,
  done: true,
});
const listedDone = await client.todo.list.query({ done: true });
const removed = await client.todo.remove.mutate({ id: created.id });

process.stdout.write(
  `${JSON.stringify(
    { health, created, listedOpen, fetched, completed, listedDone, removed },
    null,
    2,
  )}\n`,
);
