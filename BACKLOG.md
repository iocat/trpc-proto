# Backlog

This backlog tracks the gap between the current `@trpc-proto/runtime` gRPC-Web implementation, Connect RPC server behavior, and a bounded subset of Envoy proxying.

## Scope decision

The runtime should provide:

1. Connect-grade RPC correctness, safety, and server ergonomics.
2. A safe and observable forwarding gateway for simple deployments.

It should not attempt complete Envoy parity. Envoy is a general-purpose data plane; distributed routing, traffic management, certificate operations, and control-plane features remain deployment concerns.

Priority definitions:

- **P0:** required before public production exposure.
- **P1:** production-quality parity.
- **P2:** optional protocol or product expansion.
- **External:** deliberately delegated to Envoy or another edge proxy.

## Current baseline

Implemented today:

- Binary and base64 gRPC-Web.
- Unary and server-streaming RPCs.
- Direct router dispatch and single-backend native gRPC forwarding.
- Exact-origin CORS handling.
- String request metadata and bearer authorization forwarding.
- Opt-in gzip request compression, automatic negotiated gzip responses, and response decompression.
- Browser cancellation propagation to direct resolvers and upstream calls.
- Incremental response decoding across arbitrary Fetch chunks.
- Required final in-body gRPC status trailers.

## P0: production blockers

### 1. Bound request and response resources

- [ ] Add a configurable maximum HTTP request body size.
- [ ] Add encoded-frame and decompressed-message size limits.
- [ ] Bound gzip expansion while decompressing, not after allocation completes.
- [ ] Reject a second unary request data frame immediately instead of accumulating frames.
- [ ] Add maximum concurrent-call and queued-response-byte limits.
- [ ] Return `RESOURCE_EXHAUSTED` consistently when an RPC limit is exceeded.

Acceptance: oversized, compressed-expansion, many-frame, excessive-concurrency, and slow-consumer inputs cannot cause unbounded memory growth.

### 2. Enforce a strict protocol state machine

- [ ] Reject unknown or reserved frame flags.
- [ ] Reject trailers before request data.
- [ ] Reject data or additional trailers after a trailer frame.
- [ ] Reject incomplete frames at end of input.
- [ ] Reject compressed flags without a supported negotiated encoding.
- [ ] Validate method, content type, text/binary mode, and encoding combinations.
- [ ] Add negative conformance tests for every rejected state transition.

Acceptance: malformed requests fail deterministically and cannot reach a resolver or upstream method.

### 3. Enforce deadlines and liveness timeouts

- [ ] Parse `grpc-timeout` using the gRPC timeout grammar.
- [ ] Clamp client deadlines to a configured server maximum.
- [ ] Propagate deadlines to grpc-js call options.
- [ ] Abort direct resolvers when the deadline expires.
- [ ] Return `DEADLINE_EXCEEDED` for locally expired calls.
- [ ] Add request-header, request-body, stream-idle, and total-call timeouts.
- [ ] Define deterministic precedence for cancellation, deadline expiry, and upstream status races.

Acceptance: expired work stops locally and upstream; no stream can remain open indefinitely without progress.

### 4. Restrict the forwarding security boundary

- [x] Forward only explicitly registered service methods.
- [x] Derive the allowlist from service descriptors when available.
- [ ] Provide an explicit method allowlist for raw forwarding configurations.
- [ ] Add a `requestGate` that runs after headers but before reading, decompressing, or parsing the body.
- [ ] Default-deny arbitrary request metadata.
- [ ] Strip reserved, pseudo, gRPC-Web control, and hop-by-hop headers.
- [ ] Bound metadata key count, value count, and total bytes.

Acceptance: unauthenticated requests can be rejected before body work, and an exposed forwarding handler cannot invoke an unregistered backend method.

### 5. Apply end-to-end backpressure

- [ ] Pause the grpc-js response stream when the browser-facing response is blocked.
- [ ] Resume grpc-js only after the downstream response drains.
- [ ] Bound data received between pause and drain.
- [ ] Keep direct-dispatch streaming consumption demand-driven.
- [ ] Cancel the upstream call when the downstream connection cannot recover.

Acceptance: a slow or disconnected browser cannot create an unbounded promise or response-buffer queue.

### 6. Add graceful lifecycle management

- [ ] Track active calls owned by each server handle.
- [ ] Reject new calls after draining starts.
- [ ] Wait for active calls for a configurable shutdown interval.
- [ ] Cancel remaining calls after the interval expires.
- [ ] Close every owned grpc-js client and channel.
- [ ] Make repeated `close()` calls deterministic and safe.

Acceptance: shutdown has a bounded completion time and leaves no runtime-owned active calls, listeners, or channels.

### 7. Stabilize the error boundary

- [ ] Define mappings for malformed input, application errors, upstream errors, cancellation, deadlines, and internal failures.
- [ ] Prevent arbitrary exception messages and stack details from reaching clients.
- [ ] Preserve safe application status messages explicitly marked for clients.
- [ ] Produce a valid final status trailer for every response path that has committed gRPC-Web headers.

Acceptance: equivalent failures produce the same status in direct and forwarding modes without leaking internal details.

## P1: Connect-grade runtime semantics

### 8. Common interceptor and context pipeline

- [ ] Apply the same interceptor contract to direct and forwarding calls.
- [ ] Support unary and streaming response interception.
- [ ] Add typed per-request context values.
- [ ] Allow controlled leading-header and trailing-metadata mutation.
- [ ] Keep authentication in the earlier `requestGate`, not a post-parse interceptor.

### 9. Complete metadata handling

- [ ] Preserve repeated ASCII metadata values without comma joining.
- [ ] Decode and encode `-bin` metadata as bytes.
- [ ] Preserve upstream leading metadata.
- [ ] Preserve repeated and binary trailing metadata.
- [ ] Enforce reserved-name and size rules in both directions.

### 10. Structured error details

- [ ] Support typed protobuf error details.
- [ ] Preserve upstream status details across forwarding.
- [ ] Expose a stable application API for constructing status details.
- [ ] Verify details with an independent gRPC-Web client.

### 11. Response compression negotiation

- [x] Negotiate `identity` and `gzip` responses correctly.
- [ ] Add a configurable minimum response size for compression.
- [x] Compress direct unary and streaming messages independently.
- [x] Recompress grpc-js responses when the browser negotiated compression.
- [ ] Reject unsupported request encodings with a stable status.

Brotli is optional and should follow only if Connect protocol support requires it.

### 12. Observability contract

- [ ] Emit structured access events for service, method, mode, status, and latency.
- [ ] Record request/response bytes and message counts.
- [ ] Record cancellation, deadline expiry, rejection, and upstream timing.
- [ ] Expose active-call and queued-byte gauges.
- [ ] Propagate standard trace context.
- [ ] Provide OpenTelemetry-compatible hooks without requiring one telemetry backend.

### 13. HTTP/2-capable adapter

- [ ] Add an HTTP/2 server adapter.
- [ ] Provide a TLS integration point without managing certificates in the runtime.
- [ ] Preserve the HTTP/1.1 helper for browser gRPC-Web.
- [ ] Verify unary and server-streaming behavior over HTTP/2.

### 14. Protocol conformance and interoperability suite

- [ ] Exercise raw and text unary calls with an independent client.
- [ ] Exercise raw and text server streaming with arbitrary transport chunk boundaries.
- [ ] Cover compression, metadata, cancellation, and deadline races.
- [ ] Cover malformed frame flags and trailer ordering.
- [ ] Cover slow-consumer backpressure and shutdown during active streams.
- [ ] Run the same observable-contract cases against direct and forwarding modes.

## P1: standalone forwarding gateway

Implement this section only if forwarding mode must operate in production without Envoy.

### 15. Backend registry and channel pool

- [ ] Configure multiple named backends.
- [ ] Route registered methods to a backend explicitly.
- [ ] Reuse and own bounded grpc-js channel pools.
- [ ] Configure upstream authority, SNI, and credentials per backend.
- [ ] Close all pools through the server lifecycle.

### 16. Load balancing and endpoint health

- [ ] Start with round-robin selection across static endpoints.
- [ ] Add active gRPC health checks.
- [ ] Add bounded passive failure tracking.
- [ ] Remove unhealthy endpoints without interrupting unrelated calls.
- [ ] Expose endpoint health and selection metrics.

### 17. Circuit breaking and admission control

- [ ] Limit active calls per backend.
- [ ] Limit pending calls and connection attempts.
- [ ] Limit concurrent retries.
- [ ] Fail fast with `UNAVAILABLE` or `RESOURCE_EXHAUSTED` when limits are reached.
- [ ] Export breaker state and rejection counters.

### 18. Safe retries

- [ ] Retry only methods explicitly declared idempotent.
- [ ] Retry unary calls only and only before response data is committed.
- [ ] Add exponential backoff and jitter.
- [ ] Enforce retry budgets and maximum attempts.
- [ ] Apply per-try deadlines within the total RPC deadline.
- [ ] Never retry mutations or streams by default.

### 19. Local rate limiting and overload admission

- [ ] Add bounded token-bucket policies by route or authenticated principal.
- [ ] Add global concurrency and memory-pressure admission.
- [ ] Return stable overload statuses and retry guidance.
- [ ] Leave distributed quota enforcement to an external service or proxy.

## P2: Connect protocol expansion

This is a separate protocol project, not part of gRPC-Web hardening.

### 20. Connect unary protocol

- [ ] Support `application/proto`.
- [ ] Support `application/json`.
- [ ] Implement Connect HTTP status and JSON error semantics.
- [ ] Implement Connect timeout, compression, and metadata rules.

### 21. Idempotent unary GET

- [ ] Permit GET only for schema-declared side-effect-free methods.
- [ ] Use deterministic serialization.
- [ ] Support URL-safe base64 for binary messages.
- [ ] Enforce URL and decoded-message size limits.
- [ ] Produce cache-safe and stable request URLs.

### 22. Connect streaming protocol

- [ ] Support `application/connect+proto` and `application/connect+json`.
- [ ] Implement Connect envelope flags and final `EndStreamResponse` semantics.
- [ ] Support client streaming.
- [ ] Support bidirectional streaming over HTTP/2.
- [ ] Propagate cancellation, deadlines, metadata, and backpressure in both directions.

### 23. Optional native gRPC and ecosystem services

- [ ] Decide whether one Node endpoint must serve Connect, gRPC, and gRPC-Web.
- [ ] Add native gRPC multiplexing only if that deployment shape is required.
- [ ] Add standard health and reflection services.
- [ ] Add optional validation integration using the existing interceptor contract.

## External: leave to Envoy

The runtime should not implement:

- xDS or dynamic listener, cluster, and route discovery.
- Locality-aware, priority-based, or weighted load balancing.
- Traffic splitting, mirroring, and canary routing.
- TLS termination, certificate rotation, SDS, OCSP, CRLs, or FIPS operation.
- External authorization filter infrastructure.
- Global distributed rate-limit services.
- Envoy's full passive outlier-detection policy matrix.
- Hot restart or connection migration.
- Process-wide overload-manager actions.
- WASM, Lua, or native proxy-filter ecosystems.
- HTTP/3 or QUIC proxying.
- Envoy-compatible administration or configuration APIs.

Recommended production boundary:

```text
Browser
   | gRPC-Web
   v
Envoy or managed ingress
   | TLS, routing, rate limits, retries, health, metrics
   v
trpc-proto direct handler or native gRPC backend
   | schema dispatch, application context, status details
```

## Delivery order

### Milestone A: hardened transport

Complete items 1–7. Do not start protocol expansion first.

Exit criteria: malformed or oversized traffic cannot cause unbounded resource use, arbitrary upstream methods cannot be reached, deadlines stop local and upstream work, and shutdown releases all runtime-owned resources.

### Milestone B: production RPC runtime

Complete items 8–14.

Exit criteria: direct and forwarding modes expose the same policy, metadata, error, cancellation, compression, and observability model.

### Milestone C: bounded standalone gateway

Complete items 15–19 only when standalone production forwarding is a supported deployment model. Otherwise document Envoy as required and keep forwarding mode intentionally small.

Exit criteria: endpoint loss cannot wedge the process, retries cannot amplify an outage without bounds, and every proxy decision is observable.

### Milestone D: Connect protocol

Complete items 20–23 as an explicit product expansion with separate public APIs and interoperability tests.

## Reference material

### Connect RPC

- [Connect protocol specification](https://connectrpc.com/docs/protocol/)
- [Connect Node server plugins](https://connectrpc.com/docs/node/server-plugins/)
- [Connect interceptors and context values](https://connectrpc.com/docs/node/interceptors/)
- [Connect timeouts](https://connectrpc.com/docs/node/timeouts/)

### Envoy

- [gRPC-Web filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/grpc_web_filter)
- [HTTP routing and retry semantics](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/http/http_routing#retry-semantics)
- [Circuit breaking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/circuit_breaking)
- [Health checking](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/health_checking)
- [Outlier detection](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier)
- [Load balancing](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/load_balancing/overview)
- [gRPC statistics filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/grpc_stats_filter)
- [Global rate limiting](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/other_features/global_rate_limiting)
- [External authorization](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_authz_filter)
- [Overload manager](https://www.envoyproxy.io/docs/envoy/latest/configuration/operations/overload_manager/overload_manager)
- [TLS](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/security/ssl)
