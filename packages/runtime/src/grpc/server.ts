import * as grpc from "@grpc/grpc-js";
import { TRPCError, type AnyRouter } from "@trpc/server";
import { createProtoCodec } from "../proto_codec/proto_codec.js";
import type { StubCall } from "./link.js";
import { schemaFromRouter, type ProtoSchema } from "@trpc-proto/schema_ir";

/** Default insecure gRPC dial target for local development. */
const DEFAULT_ADDRESS = "127.0.0.1:50051";

export interface GrpcProtoOptions {
  router: AnyRouter;
  address?: string;
}

/** `{ UserService: { GetById: (input) => ... } }` — spread onto generated server stubs. */
export type StubHandlers = Record<
  string,
  Record<string, (input: unknown) => Promise<unknown>>
>;

type Invoker = (request: {
  path: string;
  input?: unknown;
  signal?: AbortSignal;
}) => Promise<unknown>;

function bindStubHandlers(schema: ProtoSchema, invoke: Invoker): StubHandlers {
  const services: StubHandlers = {};
  for (const service of schema.services) {
    const methods: Record<string, (input: unknown) => Promise<unknown>> = {};
    for (const method of service.methods) {
      methods[method.name] = (input) => invoke({ path: method.path, input });
    }
    services[service.name] = methods;
  }
  return services;
}

type Procedure = {
  _def: {
    type: "query" | "mutation" | "subscription";
    resolver?: (opts: {
      ctx: unknown;
      input: unknown;
      path: string;
      type: "subscription";
      signal?: AbortSignal;
    }) => unknown;
    inputs?: Array<{
      parseAsync?: (value: unknown) => Promise<unknown>;
      parse?: (value: unknown) => unknown;
    }>;
  };
  (opts: {
    path: string;
    getRawInput: () => Promise<unknown>;
    ctx: unknown;
    type: "query" | "mutation" | "subscription";
    signal?: AbortSignal;
    batchIndex?: number;
  }): Promise<unknown>;
};

function createInvoker(
  router: AnyRouter,
  opts?: { createContext?: () => unknown | Promise<unknown> },
): Invoker {
  return async (request) => {
    const procedure = (
      router._def.procedures as Record<string, Procedure | undefined>
    )[request.path];
    if (!procedure) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `No procedure on path "${request.path}"`,
      });
    }
    const ctx = opts?.createContext ? await opts.createContext() : {};
    if (
      procedure._def.type === "subscription" &&
      typeof procedure._def.resolver === "function"
    ) {
      let input = request.input;
      for (const parser of procedure._def.inputs ?? []) {
        input = parser.parseAsync
          ? await parser.parseAsync(input)
          : parser.parse?.(input);
      }
      return procedure._def.resolver({
        ctx,
        input,
        path: request.path,
        type: "subscription",
        signal: request.signal,
      });
    }
    return procedure({
      path: request.path,
      getRawInput: async () => request.input,
      ctx,
      type: procedure._def.type,
      signal: request.signal,
      batchIndex: 0,
    });
  };
}

/** Proto-shaped handlers that call a tRPC router. */
export function bindRouter(
  router: AnyRouter,
  opts?: { createContext?: () => unknown | Promise<unknown> },
): StubHandlers {
  return bindStubHandlers(
    schemaFromRouter(router),
    createInvoker(router, opts),
  );
}

function lookupRpc(schema: ProtoSchema, path: string) {
  for (const service of schema.services) {
    for (const method of service.methods) {
      if (method.path === path) return { service, method };
    }
  }
  return undefined;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value != null && typeof value === "object" && Symbol.asyncIterator in value
  );
}

function isObservable(value: unknown): value is {
  subscribe: (obs: {
    next: (item: unknown) => void;
    error: (err: unknown) => void;
    complete: () => void;
  }) => { unsubscribe?: () => void };
} {
  return (
    !!value &&
    typeof value === "object" &&
    "subscribe" in value &&
    typeof (value as { subscribe?: unknown }).subscribe === "function"
  );
}

async function* toAsyncIterable(result: unknown): AsyncIterable<unknown> {
  const value = await result;
  if (isAsyncIterable(value)) {
    yield* value;
    return;
  }
  if (isObservable(value)) {
    const pending: unknown[] = [];
    let done = false;
    let failure: unknown;
    let notify: (() => void) | undefined;
    const sub = value.subscribe({
      next: (item) => {
        pending.push(item);
        notify?.();
      },
      error: (err) => {
        failure = err;
        done = true;
        notify?.();
      },
      complete: () => {
        done = true;
        notify?.();
      },
    });
    try {
      while (!done || pending.length > 0) {
        if (pending.length > 0) {
          yield pending.shift();
          continue;
        }
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
      if (failure) throw failure;
    } finally {
      sub.unsubscribe?.();
    }
    return;
  }
  yield value;
}

export function createGrpcStubCall(opts: GrpcProtoOptions): StubCall {
  const schema = schemaFromRouter(opts.router);
  const { address = DEFAULT_ADDRESS } = opts;
  const codec = createProtoCodec(schema);
  const client = new grpc.Client(address, grpc.credentials.createInsecure());

  return (request) => {
    const rpc =
      request.service && request.method
        ? (() => {
            const service = schema.services.find(
              (item) => item.name === request.service,
            );
            const method = service?.methods.find(
              (item) => item.name === request.method,
            );
            return service && method ? { service, method } : undefined;
          })()
        : lookupRpc(schema, request.path);
    if (!rpc) {
      return Promise.reject(new Error("no gRPC mapping for call"));
    }
    const rpcPath =
      request.grpcPath ??
      `/${schema.package}.${rpc.service.name}/${rpc.method.name}`;
    const payload = request.bytes
      ? Buffer.from(request.bytes)
      : Buffer.from(codec.encode(rpc.method.requestType, request.input));
    const metadata = new grpc.Metadata();
    if (request.metadata) {
      for (const [key, value] of Object.entries(request.metadata)) {
        metadata.set(key, value);
      }
    }
    if (rpc.method.isResponseStreaming) {
      const stream = client.makeServerStreamRequest(
        rpcPath,
        (value: Buffer) => value,
        (value: Buffer) => value,
        payload,
        metadata,
      );
      if (request.signal) {
        request.signal.addEventListener("abort", () => stream.cancel(), {
          once: true,
        });
      }
      return Promise.resolve(
        (async function* () {
          for await (const chunk of stream) {
            if (!(chunk instanceof Uint8Array)) {
              throw new Error("expected protobuf bytes");
            }
            yield codec.decode(rpc.method.responseType, chunk);
          }
        })(),
      );
    }
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    client.makeUnaryRequest(
      rpcPath,
      (value: Buffer) => value,
      (value: Buffer) => value,
      payload,
      metadata,
      (err, res) => {
        if (err) reject(err);
        else {
          resolve(
            codec.decode(
              rpc.method.responseType,
              new Uint8Array(res ?? Buffer.alloc(0)),
            ),
          );
        }
      },
    );
    return promise;
  };
}

/** Client stub for any backend that implements the generated proto. */
export function createProtoStub(opts: GrpcProtoOptions): StubHandlers {
  const call = createGrpcStubCall(opts);
  return bindStubHandlers(schemaFromRouter(opts.router), (request) =>
    call({
      path: request.path,
      type: "query",
      input: request.input,
    }),
  );
}

export interface ServeGrpcOptions {
  address?: string;
  createContext?: () => unknown | Promise<unknown>;
  credentials?: grpc.ServerCredentials;
}

export interface GrpcServerHandle {
  address: string;
  port: number;
  close(): Promise<void>;
}

export function grpcStatus(err: TRPCError): grpc.status {
  switch (err.code) {
    // Client Errors & Malformed Input
    case "PARSE_ERROR":
    case "BAD_REQUEST":
    case "UNPROCESSABLE_CONTENT":
      return grpc.status.INVALID_ARGUMENT;

    // Authentication & Authorization
    case "UNAUTHORIZED":
      return grpc.status.UNAUTHENTICATED;

    case "FORBIDDEN":
    case "PAYMENT_REQUIRED":
      return grpc.status.PERMISSION_DENIED;

    // Resource & Preconditions
    case "NOT_FOUND":
      return grpc.status.NOT_FOUND;

    case "CONFLICT":
      return grpc.status.ALREADY_EXISTS;

    case "PRECONDITION_FAILED":
    case "PRECONDITION_REQUIRED":
      return grpc.status.FAILED_PRECONDITION;

    // Request Constraints & Quotas
    case "PAYLOAD_TOO_LARGE":
      return grpc.status.RESOURCE_EXHAUSTED;

    case "TOO_MANY_REQUESTS":
      return grpc.status.RESOURCE_EXHAUSTED;

    // Timing & Cancellation
    case "TIMEOUT":
    case "GATEWAY_TIMEOUT":
      return grpc.status.DEADLINE_EXCEEDED;

    case "CLIENT_CLOSED_REQUEST":
      return grpc.status.CANCELLED;

    // Server & Transport Errors
    case "METHOD_NOT_SUPPORTED":
    case "NOT_IMPLEMENTED":
      return grpc.status.UNIMPLEMENTED;

    case "SERVICE_UNAVAILABLE":
    case "BAD_GATEWAY":
      return grpc.status.UNAVAILABLE;

    case "UNSUPPORTED_MEDIA_TYPE":
      return grpc.status.INVALID_ARGUMENT;

    case "INTERNAL_SERVER_ERROR":
      return grpc.status.INTERNAL;

    default:
      return grpc.status.UNKNOWN;
  }
}

function toServiceError(err: unknown): grpc.ServiceError {
  if (err instanceof TRPCError) {
    return Object.assign(new Error(err.message), {
      code: grpcStatus(err),
      details: err.message,
      metadata: new grpc.Metadata(),
    }) as grpc.ServiceError;
  }
  const message = err instanceof Error ? err.message : String(err);
  return Object.assign(new Error(message), {
    code: grpc.status.UNKNOWN,
    details: message,
    metadata: new grpc.Metadata(),
  }) as grpc.ServiceError;
}

/** Serve a tRPC router over gRPC with protobuf encoding. */
export async function serveGrpc(
  router: AnyRouter,
  opts: ServeGrpcOptions = {},
): Promise<GrpcServerHandle> {
  const address = opts.address ?? DEFAULT_ADDRESS;
  const credentials =
    opts.credentials ?? grpc.ServerCredentials.createInsecure();
  const schema = schemaFromRouter(router);
  const codec = createProtoCodec(schema);
  const invoke = createInvoker(router, { createContext: opts.createContext });
  const server = new grpc.Server();

  for (const service of schema.services) {
    const definition: Record<
      string,
      grpc.MethodDefinition<unknown, unknown>
    > = {};
    const implementation: grpc.UntypedServiceImplementation = {};
    for (const method of service.methods) {
      definition[method.name] = {
        path: `/${schema.package}.${service.name}/${method.name}`,
        requestStream: false,
        responseStream: method.isResponseStreaming,
        requestSerialize: (value) =>
          Buffer.from(codec.encode(method.requestType, value)),
        requestDeserialize: (bytes) =>
          codec.decode(method.requestType, new Uint8Array(bytes)),
        responseSerialize: (value) =>
          Buffer.from(codec.encode(method.responseType, value)),
        responseDeserialize: (bytes) =>
          codec.decode(method.responseType, new Uint8Array(bytes)),
      };
      if (method.isResponseStreaming) {
        implementation[method.name] = (
          call: grpc.ServerWritableStream<unknown, unknown>,
        ) => {
          const ac = new AbortController();
          call.on("cancelled", () => ac.abort());
          void (async () => {
            try {
              const result = await invoke({
                path: method.path,
                input: call.request,
                signal: ac.signal,
              });
              for await (const item of toAsyncIterable(result)) {
                if (ac.signal.aborted) break;
                call.write(item);
              }
              call.end();
            } catch (err) {
              if (!ac.signal.aborted) {
                call.destroy(toServiceError(err));
              }
            }
          })();
        };
        continue;
      }
      implementation[method.name] = (
        call: grpc.ServerUnaryCall<unknown, unknown>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        void invoke({ path: method.path, input: call.request }).then(
          (res) => callback(null, res),
          (err) => callback(toServiceError(err)),
        );
      };
    }
    server.addService(definition as grpc.ServiceDefinition, implementation);
  }

  const { promise, resolve, reject } = Promise.withResolvers<number>();
  server.bindAsync(address, credentials, (err, port) => {
    if (err) reject(err);
    else resolve(port);
  });
  const port = await promise;
  const host = address.replace(/:\d+$/, "");
  return {
    address: `${host}:${port}`,
    port,
    close() {
      const shutdown = Promise.withResolvers<void>();
      server.tryShutdown(() => shutdown.resolve());
      return shutdown.promise;
    },
  };
}
