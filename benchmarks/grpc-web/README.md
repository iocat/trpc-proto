# gRPC-Web transport benchmark

The harness compares:

1. **Native gRPC** — direct native client baseline.
2. **Direct dispatch** — `serveGrpcWeb({ mode: 'direct' })`; no native gRPC loopback.
3. **Forwarding proxy** — `serveGrpcWeb({ mode: 'forward' })` to the native backend.
4. **Envoy** — `envoy.filters.http.grpc_web` to the native backend.

Every gRPC-Web path runs raw and grpc-web-text/base64 framing with uncompressed
and per-message gzip-compressed requests. Stream responses are not compressed
by this dimension.

## Run

Direct dispatch and project forwarding:

```sh
pnpm bench:grpc-web
```

Direct dispatch, project forwarding, and Envoy:

```sh
brew install envoy
pnpm bench:grpc-web:envoy
```

Use `ENVOY_BIN` or `--envoy-bin` when the executable is not named `envoy`.

The default run uses 32 concurrent workers, a one-second warmup per scenario, three rotated measurement rounds of three seconds each, 256-byte payloads, and 16 messages per server stream.

Useful overrides:

```sh
pnpm bench:grpc-web:envoy -- \
  --concurrency 64 \
  --duration 10 \
  --warmup 2 \
  --rounds 5 \
  --payload-bytes 1024 \
  --stream-messages 32 \
  --workload all \
  --report benchmarks/grpc-web/results/custom.md
```

- `--workload`: `unary`, `stream`, or `all`.
- `--report`: Markdown report path. Defaults to `benchmarks/grpc-web/results/latest.md`.
- `--json`: also emit machine-readable metadata and results to stdout. Progress remains on stderr.
- `--envoy`: include Envoy when invoking the package script directly.
- `--envoy-bin`: Envoy executable path or command name.
- `--project-cpu-profile`: write a V8 CPU profile for only the project forwarding process.
- Time values are seconds.

The command builds `@trpc-proto/runtime`, starts all services, validates every response, writes the Markdown report, and exits nonzero if any operation fails. Measurement order rotates each round to reduce ordering and thermal bias.

## Latest result

[`results/latest.md`](results/latest.md) contains the most recent machine/runtime metadata, configuration, latency percentiles, native-relative throughput, Envoy-versus-forwarding throughput, and gzip-versus-uncompressed throughput delta.

## Comparison topology

The load generator, direct-dispatch server, native gRPC backend, forwarding
proxy, and optional Envoy run as separate native processes on the same machine.

- Direct dispatch receives HTTP/1.1 gRPC-Web and invokes the router in its
  process. It does not start or dial a native gRPC server.
- The forwarding proxy and Envoy receive the same HTTP/1.1 gRPC-Web calls and
  forward HTTP/2 native gRPC to the same backend process.
- Every server process runs one JavaScript worker. Access logging and request
  timeouts are disabled.
- Every path receives the same request sequence from the same client
  implementation.

This avoids Docker virtualization and prevents servers from sharing the load
generator's event loop. The direct-versus-forwarding difference includes the
removed native gRPC client, HTTP/2 loopback, backend gRPC server, and associated
serialization boundary.

## Measurement boundary

Each operation is timed immediately before the tRPC client call and completes only after the decoded unary response or final stream trailer. The number therefore includes:

- client-side protobuf and gRPC-Web framing;
- Fetch and HTTP/1.1;
- direct mode's in-process protobuf conversion and tRPC procedure, or the
  forwarding path's translation, native gRPC loopback, and backend procedure;
- response framing, client decoding, and validation.

Client-side costs and the router workload are common to all paths, but they are
not subtracted. The Envoy-versus-forwarding delta primarily reflects proxy
implementation. Direct-versus-forwarding measures the complete cost removed by
in-process dispatch, not a proxy-only microbenchmark.

Profile only the project forwarding process while keeping the normal workload:

```sh
pnpm bench:grpc-web -- \
  --workload stream \
  --project-cpu-profile /tmp/project-proxy.cpuprofile \
  --report /tmp/project-proxy.md
```

The result is still a local relative benchmark, not a production capacity claim. Deployment sizing should isolate the load generator, proxies, and backend on separate machines and additionally record CPU, heap/GC, resident memory, network bytes, and open connections.
