import { createTRPCClient } from '@trpc/client';
import { grpcLink } from '@trpc-proto/runtime';
import { appRouter, type AppRouter } from './router.js';


/**
 * Bearer token required by the Go example gRPC server.
 * Must match `authToken` in `packages/example/backend/main.go`.
 */
const AUTH_TOKEN = 'ae_9f2e4c8b7a1d6e0f3c5b8a2d7e4f1c90';

const client = createTRPCClient<AppRouter>({
  links: [
    grpcLink({
      router: appRouter,
      auth: {
        token: AUTH_TOKEN,
      },
    }),
  ],
});

const health = await client.health.query();
const hello = await client.hello.query({ name: 'Ada' });
const echo = await client.echo.query('analytical engine');
const listed = await client.user.list.query({ q: 'Ada', role: 'admin' });
const created = await client.user.create.mutate({
  name: 'Charles',
  email: 'charles@example.com',
  role: 'member',
  tags: ['diff-engine'],
  address: { city: 'London' },
});
const fetched = await client.user.getById.query({ id: created.id });
const stats = await client.org.workspace.stats.query();

process.stdout.write(
  `${JSON.stringify(
    { health, hello, echo, listed, created, fetched, stats },
    (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    2,
  )}\n`,
);
