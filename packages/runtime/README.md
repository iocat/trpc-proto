# @trpc-proto/runtime

Runtime transports for protobuf contracts generated from tRPC 11 and Zod 4 routers.

## Install

```bash
pnpm add @trpc-proto/runtime @trpc/client @trpc/server @grpc/grpc-js zod
```

## Exports

- `@trpc-proto/runtime` — native gRPC clients and servers plus the Node gRPC-Web wrapper.
- `@trpc-proto/runtime/web` — browser `grpcWebLink`, including optional unary batching.
- `@trpc-proto/runtime/batch` — standalone browser batch link and batch protocol metadata.
- `@trpc-proto/runtime/batch.proto` — built-in batch protocol for external tooling.
- `@trpc-proto/runtime/proto_codec` — runtime protobuf codec.

See the [repository README](https://github.com/iocat/trpc-proto#readme) for direct and forwarding deployment examples.
