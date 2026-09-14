# gRPC-Web runtime

## Request path

```mermaid
sequenceDiagram
    participant App as Browser tRPC client
    participant WebLink as grpcWebLink
    participant Fetch as Browser Fetch
    participant Handler as createForwardingGrpcWebHttpHandler
    participant Client as grpc-js client
    participant Backend as Native gRPC backend

    App->>WebLink: tRPC query, mutation, or subscription
    WebLink->>Fetch: Prepare framed request body
    opt Cross-origin preflight
        Fetch->>Handler: OPTIONS with origin, method, and headers
        Handler-->>Fetch: 204 when allowed
    end
    Fetch->>Handler: POST gRPC-Web frames over HTTP
    Handler->>Handler: Validate origin, frame, and metadata
    Handler->>Client: One protobuf request message
    Client->>Backend: Native gRPC over multiplexed HTTP/2
    loop Unary once; server stream zero or more times
        Backend-->>Client: Protobuf response message
        Client-->>Handler: grpc-js data event
        Handler-->>Fetch: 0x00 gRPC-Web data frame
        Fetch-->>WebLink: Response body chunk
    end
    Backend-->>Client: Final gRPC status and metadata
    Client-->>Handler: grpc-js status event
    Handler-->>Fetch: Final 0x80 in-body trailer frame
    Fetch-->>WebLink: Final response body chunk
    WebLink-->>App: Decoded result or gRPC-Web error
```

This document describes the behavior currently implemented by
`@trpc-proto/runtime`. It is an implementation reference, not a claim of full
[gRPC-Web protocol](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md)
or production deployment readiness.

## Components

| Component                            | File                              | Responsibility                                                              |
| ------------------------------------ | --------------------------------- | --------------------------------------------------------------------------- |
| `grpcWebLink`                        | `src/web/link.ts`                 | Routes protobuf calls through streaming or optional batched transport.      |
| Fetch transport                      | `src/web/fetch_call.ts`           | Sends gRPC-Web requests and decodes unary or server-streaming responses.    |
| Content negotiation                  | `src/web/content_type.ts`         | Maps content types to raw or base64 encoding and negotiates `Accept`.       |
| Codec contract                       | `src/web/codec/codec.ts`          | Defines the shared `encode` and streaming `decode` interface.               |
| Frame codec                          | `src/web/codec/frame_codec.ts`    | Encodes and incrementally decodes binary data and trailer frames.           |
| Compression codec                    | `src/web/codec/compression.ts`    | Encodes and decodes message-local gzip streams.                             |
| Base64 codec                         | `src/web/codec/base64_codec.ts`   | Encodes and incrementally decodes base64 body chunks.                       |
| Protocol codec                       | `src/web/codec/protocol_codec.ts` | Composes frame, compression, and body codecs through `encode` and `decode`. |
| `createForwardingGrpcWebHttpHandler` | `src/web/http_handler.ts`         | Validates the Node HTTP boundary and forwards requests to grpc-js.          |
| `serveGrpcWeb`                       | `src/web/server.ts`               | Owns gRPC-Web HTTP ingress in direct-router or forwarding mode.             |

The browser link and forwarding handler keep protobuf payloads opaque. Direct
mode uses the runtime protobuf codec before invoking the router in-process.

## Public API

### Browser or Fetch client

```ts
import { createTRPCClient } from '@trpc/client';
import { grpcWebLink } from '@trpc-proto/runtime/web';
import { protoSchema } from './generated/schema.js';
import type { AppRouter } from './router.js';

const client = createTRPCClient<AppRouter>({
  links: [
    grpcWebLink<AppRouter>({
      // Required: the generated runtime schema.
      schema: protoSchema,

      // Optional string. Default: '' (same origin).
      url: 'https://api.example.com',

      // Optional: 'raw' | 'base64'. Default: 'base64'.
      encoding: 'base64',

      // Optional: true | false. Default: false.
      compress: false,

      // Optional: false | true | { maxItems?: number }. Default: false; maxItems: 100.
      batch: { maxItems: 100 },

      // Optional AuthConfig. Default: undefined.
      auth: {
        // Optional string or sync/async getter. Default: undefined.
        token: () => localStorage.getItem('accessToken') ?? undefined,
        // Optional metadata record or sync/async getter. Default: undefined.
        metadata: {},
        // Optional string. Default: 'authorization'.
        header: 'authorization',
        // Optional string. Default: 'Bearer'; use '' for a raw token.
        scheme: 'Bearer',
      },

      // Optional CallInterceptor[]. Default: [].
      interceptors: [],
    }),
  ],
});
```

Ideally, `grpcWebLink` could accept `appRouter` directly and derive its runtime
protobuf schema from the same value that supplies the tRPC types. In client
code, however, `AppRouter` should be imported with `import type`, and TypeScript
erases that import before runtime. Importing the router value would preserve
schema access but make the browser bundler traverse resolver modules, which can
pull database clients, Node built-ins, and other backend-only dependencies into
the client.

`protoSchema` is therefore generated from the persisted cache alongside the
`.proto`. It provides the cache-assigned protobuf field numbers as data while
the browser imports the router only as an erased type.

`encoding` accepts `raw` or `base64` and defaults to `base64`. `raw` sends
binary gRPC-Web frames directly. `base64` sends the same frames using the
standard text content type and base64 body representation. `compress` defaults
to `false`; when true, each request protobuf message is gzip-compressed before
framing and optional base64 encoding. `url` defaults to an empty string, which
sends requests to the current origin. The procedure's translated service and
method determine the URL pathname.

### Batched browser calls

Set `batch: true` on `grpcWebLink` to batch queries and mutations queued during
the same microtask. Each procedure input remains encoded with its own generated
request message type; those bytes are carried by the generated
`trpc.batch.v1.BatchRequest` envelope. Subscriptions continue through the
ordinary streaming transport.

```ts
import { createTRPCClient } from '@trpc/client';
import { grpcWebLink } from '@trpc-proto/runtime/web';

const client = createTRPCClient<AppRouter>({
  links: [
    grpcWebLink({
      schema: protoSchema,
      url: 'https://api.example.com',
      encoding: 'raw',
      batch: { maxItems: 100 },
    }),
  ],
});
```

Direct and forwarding modes expose the matching batch endpoint automatically:

```ts
await serveGrpcWeb({
  mode: 'direct',
  router: appRouter,
  schema: protoSchema,
});
```

The protocol is declared by `src/batch/proto/batch_router.ts` and generated by
`pnpm generate:batch` into `src/batch/proto/generated/schema.ts` and
`src/batch/proto/generated/trpc_batch_v1.proto`. The `.proto` is also exported as
`@trpc-proto/runtime/batch.proto` for external backend implementations.

Queries and mutations are kept in separate client batches. Procedures within
each batch execute concurrently, matching tRPC's HTTP batch semantics. Each item
has its own encoded success or error result, while transport failure uses the
outer gRPC status. `batch.maxItems` only controls how the client splits
requests; servers have no matching limit or batching switch.

### Managed gRPC-Web server

Direct mode dispatches to a TypeScript router without starting or dialing a
native gRPC server:

```ts
import { serveGrpcWeb } from '@trpc-proto/runtime';
import { protoSchema } from './generated/schema.js';
import { appRouter } from './router.js';

const server = await serveGrpcWeb({
  mode: 'direct',
  router: appRouter,
  schema: protoSchema,
  address: '127.0.0.1:50052',
  createContext: () => ({}),
  cors: {
    allowedOrigins: ['https://app.example.com'],
  },
});

await server.close();
```

Direct mode parses the gRPC-Web request, protobuf-decodes its message, invokes
the same transport-neutral router dispatcher used by `serveGrpc`, protobuf-
encodes each result, and writes the final in-body status trailer.

Forward mode sends the decoded gRPC-Web message bytes to a separately hosted
native gRPC service:

```ts
const server = await serveGrpcWeb({
  mode: 'forward',
  schema: protoSchema,
  backend: {
    address: '127.0.0.1:50051',
  },
  address: '127.0.0.1:50052',
});
```

Forward mode requires the generated schema. It selects
`grpc.Client.makeUnaryRequest` for unary methods and
`grpc.Client.makeServerStreamRequest` for server-streaming methods. Paths not
present in the schema return `UNIMPLEMENTED` without reaching the backend.

A grpc-js server interceptor cannot implement direct mode's wire adapter:
interceptors receive calls only after grpc-js accepts native HTTP/2 gRPC.
Shared authentication and application policy for direct and native transports
should therefore use tRPC middleware and `createContext`.

The public listener defaults to `127.0.0.1:50052`. Use the lower-level handler
below to integrate forwarding mode with an HTTP server that owns other routes.

### Existing Node HTTP server or external backend

```ts
import http from 'node:http';
import { createForwardingGrpcWebHttpHandler } from '@trpc-proto/runtime';
import { protoSchema } from './generated/schema.js';

const handleGrpcWeb = createForwardingGrpcWebHttpHandler({
  schema: protoSchema,
  address: '127.0.0.1:50051',
});

http.createServer(async (req, res) => {
  if (await handleGrpcWeb(req, res)) return;

  res.writeHead(404);
  res.end();
});
```

The handler returns `true` after it writes a response. It returns `false` for a
request it does not own, allowing the surrounding server to continue routing.
The handler accepts gRPC-Web `POST` requests through Node's `node:http`
request and response types. Call `handleGrpcWeb.close()` when the surrounding
HTTP server shuts down; `serveGrpcWeb().close()` closes its upstream client
automatically.

The native gRPC backend address defaults to `127.0.0.1:50051`. When
`credentials` is omitted, the upstream channel defaults to
`{ type: 'insecure' }`. For verified TLS or mTLS, provide:

```ts
credentials: {
  type: 'mtls',
  caCertPath: '/run/secrets/upstream-ca.pem',
  serverNameOverride: 'api.internal.example',
  clientIdentity: {
    certPath: '/run/secrets/client-cert.pem',
    keyPath: '/run/secrets/client-key.pem',
  },
}
```

`caCertPath` verifies the upstream certificate. `serverNameOverride`, when
set, becomes grpc-js's `grpc.ssl_target_name_override`. Omit `clientIdentity`
for one-way TLS. grpc-js checks the configured files once per second and uses
valid replacements for new TLS connections without recreating the handler.

## Body representations

The configuration names describe the bytes placed in the HTTP body. The
standard gRPC-Web media types retain their protocol-defined binary and text
names:

| Configuration      | Content type                      | HTTP body                                               |
| ------------------ | --------------------------------- | ------------------------------------------------------- |
| `raw`              | `application/grpc-web+proto`      | Raw length-prefixed binary frames without base64.       |
| `base64` (default) | `application/grpc-web-text+proto` | Base64 representation of length-prefixed binary frames. |

The content-type parser also accepts both media types without `+proto`, as
required by the gRPC-Web default-format rule, and ignores media parameters.

Before optional base64 encoding, each frame is length-prefixed:

```text
+---------+---------------------+-------------------+
| flags   | payload length      | payload           |
| 1 byte  | 4 bytes, big-endian | length bytes      |
+---------+---------------------+-------------------+
```

Implemented flags:

| Flag   | Meaning                       | Current behavior                      |
| ------ | ----------------------------- | ------------------------------------- |
| `0x00` | Uncompressed protobuf data    | Supported.                            |
| `0x01` | Compressed protobuf data      | Supported with `grpc-encoding: gzip`. |
| `0x80` | Uncompressed in-body trailers | Supported.                            |
| `0x81` | Compressed in-body trailers   | Rejected.                             |

The raw frame decoder accepts arbitrary transport chunk boundaries and rejects
truncated headers and payloads.

In base64 mode, each flushed frame is base64-encoded independently. Padding can
therefore occur before the end of the HTTP body:

```text
base64(data frame)==base64(next data frame)=base64(trailer frame)==
```

The base64 decoder does not call `atob` on the complete response. It
incrementally decodes complete base64 quartets, resets after padded segments,
and retains incomplete quartets across Fetch chunks.

## Message compression

Message compression happens before framing and before optional base64:

```text
protobuf -> gzip -> 0x01 frame -> optional base64 -> HTTP
```

The Fetch transport always advertises `grpc-accept-encoding: gzip`. With
`compress: true`, it gzip-compresses the request message, sets the frame's
compressed flag, and sends `grpc-encoding: gzip`. The HTTP handler decompresses
that message before forwarding its bytes through grpc-js.

For responses, the Fetch transport checks the compressed flag on every data
frame. Flagged messages are decompressed with the algorithm named by the
response's `grpc-encoding`; unflagged messages remain unchanged, so one stream
may mix compressed and uncompressed messages. Binary and text responses use
the same message-compression path because base64 is removed before frames are
decoded.

The implementation supports gzip data messages through the Web Compression
Streams API. Missing or unsupported `grpc-encoding` values and compressed
trailer frames are rejected.

## Request flow

The Fetch transport sends one framed protobuf message. In text mode the frame
shown below is base64-encoded:

```text
POST /<package>.<service>/<method>
content-type: application/grpc-web[-text]+proto
accept: application/grpc-web[-text]+proto
grpc-accept-encoding: gzip
grpc-encoding: gzip  # only with compress: true
x-grpc-web: 1
x-user-agent: grpc-web-javascript/0.1

[0x00 or 0x01][uint32 length][protobuf or gzip payload]
```

Interceptor metadata is added as HTTP request headers. The caller's
`AbortSignal` is passed to `fetch`.

The HTTP handler:

1. Handles a configured CORS preflight, if applicable.
2. Returns `false` unless the request is a `POST` with a supported gRPC-Web
   content type.
3. Applies configured origin validation.
4. Reads the complete request body into memory.
5. Base64-decodes a text body.
6. Requires exactly one data frame.
7. Gzip-decompresses a flagged request message.
8. Uses the HTTP pathname as the gRPC path, for example
   `/example.v1.UserService/GetById`.
9. In direct mode, resolves that gRPC path through `ProtoSchema` to the
   `ProtoMethod.path` tRPC key, such as `user.getById`, decodes the request
   type, and invokes that router procedure.
10. In forward mode, resolves the path to a schema-derived grpc-js method
    definition, converts permitted request headers into grpc-js metadata, and
    invokes the backend with unary or server-streaming cardinality.

## Response and streaming flow

Direct mode protobuf-encodes each router result and emits it as a `0x00`
gRPC-Web data frame. Forward mode converts each backend grpc-js `data` event
into the same frame. Both modes emit a final `0x80` in-body status trailer and
then end the HTTP response. Each frame is written raw for binary mode or
independently base64-encoded for text mode.

grpc-js removes native gRPC message compression before invoking the handler's
`data` callback, so forwarded responses use uncompressed `0x00` Web response
frames. The bundled example backends do not configure response compression.

The handler chooses the first supported media type in `Accept`; when `Accept`
does not select one, it uses the request encoding. A unary RPC naturally
produces one data frame followed by trailers. A server-streaming RPC produces
zero or more data frames followed by trailers.

The Fetch transport handles the response according to the tRPC operation:

- Query and mutation calls incrementally decode optional base64 and raw frames,
  decompress a flagged data message, check the status trailer, and return the
  first message.
- Subscription calls use the same incremental protocol decoder, yield each
  payload, and finish at the trailer frame.

Both base64 quartets and binary frames may be split across arbitrary Fetch
chunks. Each decoder retains its incomplete input for the next chunk.

## Trailers and errors

Native gRPC response trailers are encoded into the response body because the
browser Fetch API cannot expose HTTP/2 trailing headers consistently. The
trailer payload is a lower-case HTTP-style header block:

```text
grpc-status: 0\r\n
grpc-message: \r\n
```

The frame containing this block has flag `0x80`. Additional string grpc-js
status metadata is copied into the block.

The handler percent-encodes `grpc-message` and additional values when it writes
trailers. The Fetch client percent-decodes `grpc-message`; additional metadata
values remain encoded.

A final `grpc-status` is required for unary and streaming responses. When an
intermediary returns a response without it, the Fetch transport applies the
standard client-only HTTP-to-gRPC mapping: `400` to `INTERNAL`; `401` to
`UNAUTHENTICATED`; `403` to `PERMISSION_DENIED`; `404` to `UNIMPLEMENTED`;
`429`, `502`, `503`, and `504` to `UNAVAILABLE`; and every other status,
including `200`, to `UNKNOWN`.

Transport outcomes:

| Condition                      | HTTP result         | gRPC-Web result                                                          |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------ |
| Successful backend gRPC call   | `200`               | Data frames followed by `grpc-status: 0`.                                |
| Backend gRPC error             | `200`               | Final trailer contains the backend status, message, and string metadata. |
| Malformed framed request       | `200`               | Final trailer contains `grpc-status: 13` (`INTERNAL`).                   |
| Request not owned by handler   | No response written | Handler returns `false`.                                                 |
| Rejected CORS origin or header | `403`               | No backend gRPC call.                                                    |
| Rejected preflight method      | `405`               | `POST` reported as the allowed method.                                   |

For both unary and streaming responses, EOF without a trailer is rejected as a
missing final status. `grpc-status` is required inside the trailer and must be
an ASCII decimal status code from `0` through `16`; missing, malformed, and
out-of-range values produce a `GrpcWebError` with status `UNKNOWN`.
`grpc-message` is strictly percent-decoded, and malformed percent escapes
produce `UNKNOWN`.

## CORS behavior

CORS is disabled when `cors` is omitted. Enable it with an exact serialized
origin allowlist:

```ts
const handleGrpcWeb = createForwardingGrpcWebHttpHandler({
  schema: protoSchema,
  address: '127.0.0.1:50051',
  cors: {
    allowedOrigins: ['https://app.example.com'],
    additionalAllowedHeaders: ['x-trace-id'],
  },
});
```

Default allowed preflight request headers:

```text
accept
authorization
content-type
grpc-timeout
x-grpc-web
x-user-agent
```

Configured `additionalAllowedHeaders` are normalized to lower case and added
to this set.

Successful preflights include `Access-Control-Max-Age: 600` by default. Set
`cors.maxAgeSeconds` to change that browser-managed preflight cache lifetime;
set it to `0` to disable caching. The browser keeps this cache separately from
its normal HTTP response cache.

A valid preflight request must include:

- `Origin` exactly matching one configured origin.
- `Access-Control-Request-Method: POST`.
- Only default or additionally allowed request headers.

A valid preflight receives `204` with:

```text
access-control-allow-origin: <exact request origin>
access-control-allow-methods: POST
access-control-allow-headers: <configured allowed headers>
access-control-expose-headers: grpc-status, grpc-message, x-grpc-web
vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
```

An actual request with an allowed origin receives:

```text
access-control-allow-origin: <exact request origin>
access-control-expose-headers: grpc-status, grpc-message, x-grpc-web
vary: Origin
```

### Missing `Origin`

A `POST` without `Origin` is treated as a non-CORS request and may reach the
configured gRPC backend. It receives no CORS response headers. An `OPTIONS`
request without `Origin` is not treated as a preflight; the handler returns `false`.

This preserves non-browser and same-origin callers. It also means the origin
allowlist is not a universal authorization boundary. Non-browser clients can
omit or forge `Origin`, so authentication and authorization must be enforced
independently with bearer metadata, mTLS, or another credential mechanism.

## Metadata boundary

Incoming header names are normalized to lower case by Node and again before
metadata insertion. The handler does not forward HTTP transport or gRPC-Web
control headers, including:

```text
accept
accept-encoding
connection
content-length
content-type
host
keep-alive
origin
proxy-authenticate
proxy-authorization
proxy-connection
te
trailer
transfer-encoding
upgrade
user-agent
x-grpc-web
x-user-agent
```

Other non-pseudo headers are forwarded as string grpc-js metadata. This
includes `authorization`, `grpc-timeout`, and application headers allowed by
the browser's CORS preflight.

## Connection and cancellation behavior

One `grpc.Client` is created when `createForwardingGrpcWebHttpHandler` is called and is
reused for every request handled by that function. grpc-js owns the persistent
HTTP/2 channel to the configured gRPC backend and multiplexes calls on it.

When the browser-facing HTTP request is aborted or its response closes before
the backend gRPC call finishes, the handler cancels that gRPC call. Listener
cleanup after backend status prevents completed calls from being cancelled
when their successful browser-facing HTTP response closes.

## Supported capability matrix

| Capability                                                | State                        |
| --------------------------------------------------------- | ---------------------------- |
| Binary unary request and response                         | Supported                    |
| Binary server-streaming response                          | Supported                    |
| Text unary request and response                           | Supported                    |
| Text server-streaming response                            | Supported                    |
| Independently padded base64 chunks                        | Supported                    |
| Arbitrarily split response chunks                         | Supported                    |
| In-body status trailers                                   | Supported                    |
| Request metadata and bearer authorization                 | Supported for string values  |
| Exact-origin CORS preflight                               | Opt-in                       |
| Gzip-compressed request messages                          | Opt-in with `compress: true` |
| Gzip-compressed unary and streaming responses             | Supported                    |
| Final-status presence and syntax validation               | Supported                    |
| Browser connection cancellation reaches backend gRPC call | Supported                    |

Unsupported capabilities and planned protocol and operational work are tracked
in the [project backlog](../../BACKLOG.md).

## Tests

`src/web/http_handler_test.ts` covers:

- Compressed base64 unary calls through `grpcWebLink` and `serveGrpc`.
- Base64 server streaming through the Fetch transport.
- Allowed and rejected CORS preflights, including compression headers.
- Actual origin validation and response exposure headers.
- String request metadata and gRPC status metadata.
- Fetch abort and browser-response-close cancellation propagation.

`src/web/server_test.ts` covers direct and forwarding `serveGrpcWeb` modes,
unary and server-streaming calls in raw and base64 modes, gzip requests,
browser cancellation, and listener shutdown.

`src/web/fetch_call_test.ts` covers compressed raw and base64 responses, mixed
compressed and uncompressed streams, arbitrary base64 transport chunks,
request compression headers, received `grpc-message` percent-decoding, strict
status validation, required final status, and the HTTP fallback mapping.

`src/web/codec/compression_test.ts`, `src/web/content_type_test.ts`,
`src/web/codec/frame_codec_test.ts`,
`src/web/codec/protocol_codec_test.ts`, and
`src/web/codec/base64_codec_test.ts` cover gzip round trips, compressed frame
flags, content negotiation, raw frame boundaries, independently padded base64
segments, received message decoding, strict status parsing, arbitrary base64
transport boundaries, and malformed input.
