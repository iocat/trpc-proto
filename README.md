# trpc-proto

Generate protobuf from a tRPC 11 + Zod 4 router. The TypeScript client keeps talking tRPC; the wire is gRPC.

This is **opinionated**. Only a subset of `appRouter` is a proto contract. That subset is **enforced** at generate and at runtime (`grpcLink` / `schemaFromRouter`). Anything outside it is rejected, not approximated.

```
packages/plugin      @trpc-proto/plugin          evaluate appRouter → .proto + schema.json
packages/runtime     @trpc-proto/runtime         grpcLink, serveGrpc, gRPC-Web

packages/schema_ir   @trpc-proto/schema_ir       ProtoSchema IR, prevalidate, proto text
examples/users       @trpc-proto/example-users   users/org API + Go gRPC backend
examples/todo        @trpc-proto/example-todo    todo API + Go gRPC backend
examples/trpc        @trpc-proto/example-trpc    TypeScript tRPC backend + protobuf gRPC
```

Requires **tRPC 11** and **Zod 4**. Runtime does not host a gRPC server.

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
import { noopForNonTsBackend, type ProtoMeta } from '@trpc-proto/runtime';
import { z } from 'zod';

const t = initTRPC.meta<ProtoMeta>().create({
  defaultMeta: {
    proto: {
      package: 'example.v1',
      cache: 'generated/schema.json',
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
  }),
});

export type AppRouter = typeof appRouter;
```

`noopForNonTsBackend` is a schema-only resolver. A non-TS service that implements the generated proto is the real backend. For a TypeScript backend, implement real resolvers and call `bindRouter` (below).

The plugin evaluates `export const appRouter` (the runtime value, not the type) so it can read the Zod parsers.

## 2. Generate

```bash
trpc-proto generate \
  --router src/router.ts \
  --export appRouter \
  --out generated
```

`--package` / `--cache` override `defaultMeta.proto`. Prevalidate failures print the report and exit 1.

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

`grpcLink` walks the live Zod parsers on `appRouter` (same subset). It dials gRPC itself (default `127.0.0.1:50051`). No `schema.json` on the client.

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

TypeScript tRPC — `serveGrpc` is the server-side counterpart of `grpcLink`:

```ts
import { serveGrpc } from '@trpc-proto/runtime';
import { appRouter } from './router.js';

await serveGrpc(appRouter, {
  address: '127.0.0.1:50051',
  createContext: () => ({}),
});
```

If you already have generated stubs (connect, grpc-js `protoc`, Go, …), use `bindRouter(appRouter)` and plug `stubs.UserService.GetById` into that server instead.

Nested routers become service names (`user.getById` → `UserService.GetById`).

Or implement the generated proto in another language. The Go examples do that.

Cross-origin browser access is opt-in and uses exact serialized origins:

```ts
import { createGrpcWebHop } from '@trpc-proto/runtime';

const hop = createGrpcWebHop({
  address: '127.0.0.1:50051',
  cors: {
    allowedOrigins: ['https://app.example.com'],
    additionalAllowedHeaders: ['x-trace-id'],
  },
});
```

The hop answers valid preflight requests, rejects disallowed origins, methods,
and headers before contacting gRPC, and adds the matching CORS headers to
gRPC-Web responses. Omit `cors` for same-origin deployments.

## gRPC-Web backlog

The current hop supports binary unary calls and server streaming through one
reused grpc-js client. This table tracks the remaining proxy work.

| Priority | Area | Backlog item | Acceptance |
| --- | --- | --- | --- |
| P0 | Text encoding | Negotiate `application/grpc-web-text` and incrementally decode/encode base64 chunks. | Binary and text requests and responses pass interoperability tests, including padding split across chunks. |
| P0 | Framing | Validate frame flags, reject data after trailers, require final trailers, and reject truncated stream EOF. | Malformed framing has table-driven negative tests; trailers are always final. |
| P0 | Cancellation | Parse `grpc-timeout`, apply an upstream deadline, and cancel the grpc-js call when the browser disconnects or aborts. | Deadline and disconnect tests observe cancellation at the backend. |
| P0 | Boundary | Limit request-body size and restrict forwarded gRPC service/method paths. | Oversized bodies and unknown methods are rejected before an upstream call. |
| P1 | Streaming | Replace the private `x-grpc-web-stream` contract with descriptor-driven server-streaming and add end-to-end stream tests. | Standard gRPC-Web clients can consume server streams without private headers. |
| P1 | HTTP | Support and test HTTP/1.1 and HTTP/2 browser ingress. | The same unary and streaming suite passes over both ingress protocols. |
| P1 | Metadata | Support binary `*-bin` metadata and configurable request/response header forwarding. | Binary metadata round-trips; hop-by-hop and disallowed headers never cross the boundary. |
| P1 | Status | Percent-decode `grpc-message` and reject successful HTTP responses missing a valid final status. | Encoded error messages and malformed status responses have interoperability tests. |
| P1 | Connections | Add client lifecycle cleanup and explicit pooling for multiple upstream targets. | Channels are reused, bounded, observable, and closed deterministically. |
| P2 | Resilience | Add circuit breaking, active health checks, and rate limiting. | Each policy is configurable and covered by failure/recovery scenarios. |
| P2 | Observability | Add structured access logs and request, latency, status, stream, and upstream metrics. | Operators can attribute failures and saturation to route and upstream. |

## Examples

```bash
pnpm --filter @trpc-proto/example-users generate
pnpm --filter @trpc-proto/example-users generate:go
pnpm --filter @trpc-proto/example-users server   # Go gRPC on :50051
pnpm --filter @trpc-proto/example-users web      # http://127.0.0.1:3000
```

Todo: `pnpm --filter @trpc-proto/example-todo generate` then `server` / `web` (`:3001`).

TypeScript backend (protobuf over gRPC, `bindRouter`):

```bash
pnpm --filter @trpc-proto/example-trpc generate
pnpm --filter @trpc-proto/example-trpc server   # :50053
pnpm --filter @trpc-proto/example-trpc web      # :3002
```
