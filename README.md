# trpc-proto

Generate protobuf from a tRPC 11 + Zod 4 router. The TypeScript client keeps talking tRPC; the wire is gRPC.

This is **opinionated**. Only a subset of `appRouter` is a proto contract. That subset is **enforced during generation**. Anything outside it is rejected, not approximated.

```
packages/plugin      @trpc-proto/plugin          evaluate appRouter → .proto + schema.ts
packages/runtime     @trpc-proto/runtime         grpcLink, serveGrpc, gRPC-Web

packages/schema_ir   @trpc-proto/schema_ir       ProtoSchema IR, prevalidate, proto text
examples/users       @trpc-proto/example-users   users/org API + Go gRPC backend
examples/todo        @trpc-proto/example-todo    todo API + Go gRPC backend
examples/trpc        @trpc-proto/example-trpc    TypeScript tRPC backend + protobuf gRPC
```

Requires **tRPC 11** and **Zod 4**. The runtime can serve a TypeScript router over gRPC or connect clients and a gRPC-Web gateway to an external gRPC backend.

## Enforced subset

Prevalidate collects every issue, then aborts on errors (no stack). Generate prints the router file path.

### Router

|                                                               |                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| `initTRPC.meta<ProtoMeta>()` with `defaultMeta.proto.package` | required                                                     |
| `proto.syntax`                                                | optional; proto3 only (omitted → proto3)                     |
| `proto.cache`                                                 | optional; stable field numbers; dropped tags emit `reserved` |
| `proto.options`                                               | optional (`go_package`, …)                                   |
| `proto` on a procedure `.meta()`                              | forbidden (file header is router-global)                     |
| procedure `.output()`                                         | required                                                     |
| procedure `.input()`                                          | optional (omitted → `google.protobuf.Empty`)                 |
| chained `.input()`                                            | forbidden (merge into one Zod schema)                        |
| procedure type                                                | query/mutation (unary) or subscription (server-streaming)    |
| validators                                                    | Zod 4 only                                                   |

### Zod → proto

| Zod                                                        | Proto                                 |
| ---------------------------------------------------------- | ------------------------------------- |
| `z.object`, nested objects                                 | `message`                             |
| `.meta({ protoMessageName: 'User' })`                      | named message; **must be PascalCase** |
| `.meta({ protoUseKnownType: 'google.protobuf.Duration' })` | encode as that well-known type        |
| `.meta({ protoEnumName: 'UserRole' })`                     | named enum; **must be PascalCase**    |

| unnamed nested object | nested message named from the field |
| `z.string`, template literal | `string` (`email` is still `string`) |
| `z.boolean` | `bool` |
| `z.number` / `z.int` | `double` / `int32` (int formats: int32, int64, …) |
| `z.bigint` | `int64` |
| `z.date` | `google.protobuf.Timestamp` |
| `z.enum`, same-type literal union | `enum` |
| `z.discriminatedUnion` | `oneof` of variant messages |
| `z.array` / `z.set` | `repeated` |
| `z.record` / `z.map` | `map<key, value>` (scalar keys) |
| `z.any` / `z.unknown` | `google.protobuf.Value` |
| `z.record` of any/unknown | `google.protobuf.Struct` |
| void / undefined / never / null input or output | `google.protobuf.Empty` |
| `z.optional` / `z.nullable` | `optional` field |
| `zAsyncIterable({ yield: schema })` | server stream; protobuf response uses `schema` |

Rejected (translate throws): open unions, mixed-type literals, mixed int/float literals, non-PascalCase `protoMessageName` / `protoEnumName`, non-scalar map keys, anything else `Unsupported Zod type`.

Do not expect tRPC-only features (middleware-only procedures, output inference without `.output()`, superjson-only types) to round-trip through protobuf.

```
src/router.ts
error: procedure ping missing required output
  ping: t.procedure
    .output(z.object({ ok: z.boolean() }))
    .query(...)
```

## Install

```bash
pnpm install
pnpm build
```

## 1. Router

```ts
import { initTRPC } from '@trpc/server';
import {
  noopForNonTsBackend,
  zAsyncIterable,
  type ProtoMeta,
} from '@trpc-proto/runtime';
import { z } from 'zod';

const t = initTRPC.meta<ProtoMeta>().create({
  defaultMeta: {
    proto: {
      package: 'example.v1',
      cache: 'generated/schema.ts',
      options: { go_package: 'users/backend/gen/examplev1' },
    },
  },
});

const User = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .meta({ protoMessageName: 'User' });

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

    onChange: t.procedure
      .output(zAsyncIterable({ yield: User }))
      .subscription(noopForNonTsBackend),
  }),
});

export type AppRouter = typeof appRouter;
```

`noopForNonTsBackend` is a schema-only resolver for queries, mutations, and subscriptions. Use it when another service implements the generated proto. For a TypeScript subscription, pass an async-generator resolver as documented by tRPC; `zAsyncIterable` validates each yield and exposes its item schema to protobuf generation.

The plugin evaluates `export const appRouter` (the runtime value, not the type) so it can read the Zod parsers.

## 2. Generate

```bash
trpc-proto generate \
  --router src/router.ts \
  --export appRouter \
  --out generated
```

This command writes the `.proto` and an importable `schema.ts` under `--out`.
`schema.ts` is both the runtime protobuf schema and the persisted field-number
cache. Override its path with `--cache` or `defaultMeta.proto.cache`.

With the options above, it writes:

- `generated/example_v1.proto` — feed this to **your** stub codegen (`protoc`, connect-es, …)
- `generated/schema.ts` — complete runtime IR + `generateCache` for stable field numbers

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

Ideally, `grpcLink` and `grpcWebLink` could accept `appRouter` and derive both the
tRPC types and protobuf schema from one value. Client code should import
`AppRouter` with `import type`, however, and TypeScript erases that import before
runtime. Importing the `appRouter` value instead would make the client bundler
traverse resolver modules and could pull database clients, Node built-ins, and
other backend-only dependencies into the client.

The generated `protoSchema` is the data-only runtime boundary: it retains the
cache-assigned protobuf field numbers without importing server code.
`grpcLink` uses it to dial gRPC directly (default `127.0.0.1:50051`).

```ts
import { createTRPCClient } from '@trpc/client';
import { grpcLink } from '@trpc-proto/runtime';
import { protoSchema } from './generated/schema.js';
import type { AppRouter } from './router.js';

const client = createTRPCClient<AppRouter>({
  links: [
    grpcLink<AppRouter>({
      schema: protoSchema,
      address: '127.0.0.1:50051',
      auth: { token: process.env.AUTH_TOKEN },
    }),
  ],
});

await client.user.getById.query({ id: '1' });
```

## 4. Server

Choose one backend approach. Both expose the same generated protobuf contract, so clients do not change when the implementation language changes.

### Approach A: TypeScript tRPC backend

Implement the router procedures with real resolvers, then expose that router as a gRPC server with `serveGrpc`:

```ts
import { serveGrpc } from '@trpc-proto/runtime';
import { protoSchema } from './generated/schema.js';
import { appRouter } from './router.js';

await serveGrpc(appRouter, {
  schema: protoSchema,
  address: '127.0.0.1:50051',
  createContext: () => ({}),
});
```

`serveGrpc` owns the grpc-js server lifecycle and is the direct server-side counterpart of `grpcLink`. If an existing TypeScript server already owns generated grpc-js service registration, use `bindRouter(appRouter, { schema: protoSchema })` instead; it returns proto-shaped handlers that delegate to the router.

### Approach B: External gRPC backend

Keep schema-only router procedures on the TypeScript side with `noopForNonTsBackend`, generate the `.proto`, then implement that contract in Go or another gRPC-supported language:

```bash
trpc-proto generate \
  --router src/router.ts \
  --export appRouter \
  --out generated

# Run your language's protobuf/stub generator, then start that gRPC server.
```

The external server does not execute the tRPC router and does not need
`schema.ts`; browser clients and the forwarding handler import it for protobuf
encoding and RPC cardinality. The [`users`](examples/users) and
[`todo`](examples/todo) examples use Go backends.

With either approach, nested routers become gRPC service names (`user.getById` → `UserService.GetById`).

### Browser gRPC-Web ingress

`serveGrpcWeb` supports direct router dispatch and forwarding to a separately
hosted native gRPC server.

Direct mode decodes protobuf and invokes the tRPC router in-process:

```ts
import { serveGrpcWeb } from '@trpc-proto/runtime';

await serveGrpcWeb({
  mode: 'direct',
  router: appRouter,
  schema: protoSchema,
  address: '127.0.0.1:50052',
  cors: {
    allowedOrigins: ['https://app.example.com'],
    additionalAllowedHeaders: ['x-trace-id'],
  },
});
```

Successful CORS preflights are browser-cached for 600 seconds by default.
Configure `cors.maxAgeSeconds` to change the cache lifetime.

Forward mode owns the same HTTP listener but sends calls to an existing gRPC
backend:

```ts
await serveGrpcWeb({
  mode: 'forward',
  schema: protoSchema,
  backend: { address: '127.0.0.1:50051' },
  address: '127.0.0.1:50052',
});
```

Use
`createForwardingGrpcWebHttpHandler({ schema: protoSchema, address: '127.0.0.1:50051' })`
instead when an existing Node HTTP server must own routing, and call the
handler's `close()` method during shutdown. Omitted `credentials` default to
`{ type: 'insecure' }`. Provide `{ type: 'mtls', ... }` for verified TLS and
optional client identity; grpc-js watches those certificate files for rotation.
Both server APIs answer valid preflight requests, reject disallowed origins,
methods, and headers, and add matching CORS headers to gRPC-Web responses.
Omit `cors` for same-origin deployments.

See the [gRPC-Web runtime protocol](packages/runtime/GRPC_WEB.md) for the
implemented wire behavior, CORS semantics, and security boundary.

Planned transport, Connect RPC, and forwarding-proxy work is tracked in the
[project backlog](BACKLOG.md).

## Examples

```bash
pnpm --filter @trpc-proto/example-users generate
pnpm --filter @trpc-proto/example-users generate:go
pnpm --filter @trpc-proto/example-users server   # Go gRPC on :50051
pnpm --filter @trpc-proto/example-users web      # UI :3000; forwarded gRPC-Web :3100
```

Todo: `pnpm --filter @trpc-proto/example-todo generate` then `server` and `web` (UI `:3001`; forwarded gRPC-Web `:3101`).

TypeScript router:

```bash
pnpm --filter @trpc-proto/example-trpc generate
pnpm --filter @trpc-proto/example-trpc web      # UI :3002; direct gRPC-Web :3102
```

Live incident operations with a Rust backend, editable drag-and-drop board,
response checklists, typed CRUD, rich protobuf messages, and resumable
server-streaming events:

```bash
pnpm --filter @trpc-proto/example-streaming generate
pnpm --filter @trpc-proto/example-streaming test:rust # Rust CRUD + stream tests
pnpm --filter @trpc-proto/example-streaming server    # Rust gRPC :50054
pnpm --filter @trpc-proto/example-streaming web       # React UI :3003; gRPC-Web :3103
```
