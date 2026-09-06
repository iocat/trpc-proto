# trpc-proto

Generate protobuf from a tRPC 11 + Zod 4 router. The TypeScript client keeps talking tRPC; the wire is gRPC.

```
packages/plugin      @trpc-proto/plugin      evaluate appRouter → .proto + schema.json
packages/runtime     @trpc-proto/runtime     codec, grpcLink, invoker
packages/schema_ir   @trpc-proto/schema_ir   ProtoSchema IR, prevalidate, proto text
packages/example     @trpc-proto/example     Zod router + Go gRPC backend
packages/example_todo                        smaller Go-backed demo
```

Requires **tRPC 11** and **Zod 4**. Runtime does not host a gRPC server.

## Install

```bash
pnpm install
pnpm build
```

## 1. Router

`proto.package` is required. Omitted `syntax` is proto3. `cache` is optional (stable field numbers across generates). Every procedure needs `.output()`. Do not set `proto` on a procedure.

Named Zod objects (`.meta({ id: 'User' })`) become proto messages.

```ts
import { initTRPC } from '@trpc/server';
import {
  createProtoTransformer,
  noopForNonTsBackend,
  type ProtoMeta,
} from '@trpc-proto/runtime';
import { z } from 'zod';

const t = initTRPC.meta<ProtoMeta>().create({
  transformer: createProtoTransformer(),
  defaultMeta: {
    proto: {
      package: 'example.v1',
      cache: 'generated/schema.json',
      options: { go_package: 'example/backend/gen/examplev1' },
    },
  },
});

const User = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .meta({ id: 'User' });

export const appRouter = t.router({
  hello: t.procedure
    .input(z.object({ name: z.string() }))
    .output(z.object({ message: z.string() }))
    .query(noopForNonTsBackend),

  user: t.router({
    getById: t.procedure
      .input(z.object({ id: z.string() }))
      .output(User)
      .query(noopForNonTsBackend),
  }),
});

export type AppRouter = typeof appRouter;
```

`noopForNonTsBackend` is a schema-only resolver. A non-TS service that implements the generated proto is the real backend. For a TypeScript backend, use a real resolver and `createInvoker` (below).

The plugin evaluates `export const appRouter` (the runtime value, not the type) so it can read the Zod parsers.

## 2. Generate

```bash
trpc-proto generate \
  --router src/router.ts \
  --export appRouter \
  --out generated
```

`--package` / `--cache` override `defaultMeta.proto`. Prevalidate failures print a report (no stack) and exit 1.

Writes:

- `generated/example_v1.proto` — feed this to **your** stub codegen (`protoc`, connect-es, …)
- `generated/schema.json` — IR + `generateCache` (field-number assignments)

Deleted fields stay in the cache. Their numbers are emitted as `reserved` so they are not reused:

```
message User {
  optional string id = 1;
  reserved 2, 4;
}
```

```ts
import { generate } from '@trpc-proto/plugin';

await generate({
  routerFile: 'src/router.ts',
  routerExport: 'appRouter',
  outDir: 'generated',
});
```

## 3. Client

`grpcLink` walks the live Zod parsers on `appRouter`. It dials gRPC itself (default `127.0.0.1:50051`). No `schema.json` on the client.

```ts
import { createTRPCClient } from '@trpc/client';
import { grpcLink } from '@trpc-proto/runtime';
import { appRouter, type AppRouter } from './router.js';

const client = createTRPCClient<AppRouter>({
  links: [
    grpcLink({
      router: appRouter,
      address: '127.0.0.1:50051',
      auth: { token: process.env.AUTH_TOKEN },
    }),
  ],
});

await client.user.getById.query({ id: '1' });
```

## 4. Backend

Bind generated stubs to `createInvoker` if the backend is still tRPC:

```ts
import { bindStubHandlers, createInvoker } from '@trpc-proto/runtime';
import { appRouter } from './router.js';
import schema from './generated/schema.json';

const invoke = createInvoker(appRouter);
const stubs = bindStubHandlers(schema, invoke);

server.addService(UserService, {
  getById: (call, callback) => {
    stubs.UserService.GetById(call.request).then(
      (res) => callback(null, res),
      (err) => callback(err),
    );
  },
});
```

Or implement the generated proto in another language. The example Go server does that.

## Example

```bash
pnpm --filter @trpc-proto/example generate
pnpm --filter @trpc-proto/example generate:go
pnpm --filter @trpc-proto/example server   # Go gRPC on :50051
pnpm --filter @trpc-proto/example client
```

`pnpm --filter @trpc-proto/example spin` generates, starts Go + the dashboard (`http://127.0.0.1:3000`).

## Prevalidate

Runs at generate and when `grpcLink` / `schemaFromRouter` load the router. All issues are collected; only errors abort.

| | |
|---|---|
| `proto.package` missing | error |
| procedure missing `.output()` | error |
| procedure sets `proto` meta | error |
| `syntax` set to something other than proto3 | error |
| `cache` missing | allowed |

```
src/router.ts
error: procedure ping missing required output
  ping: t.procedure
    .output(z.object({ ok: z.boolean() }))
    .query(...)
```
