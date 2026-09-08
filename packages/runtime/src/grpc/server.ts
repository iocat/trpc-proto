import * as grpc from '@grpc/grpc-js';
import { TRPCError, type AnyRouter } from '@trpc/server';
import { isAsyncIterable } from '@trpc-proto/utility';
import {
  ProtoCodec,
  type RuntimeProtoMethod,
} from '../proto_codec/proto_codec.js';
import type { StubCall } from './link.js';
import { schemaFromRouter, type ProtoSchema } from '@trpc-proto/schema_ir';


/** Default insecure gRPC dial target for local development. */
const DEFAULT_ADDRESS = '127.0.0.1:50051';

/** Schema and address used by a native gRPC client stub. */
export interface GrpcProtoOptions {
  schema: ProtoSchema;
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
    type: 'query' | 'mutation' | 'subscription';
  };
  (opts: {
    path: string;
    getRawInput: () => Promise<unknown>;
    ctx: unknown;
    type: 'query' | 'mutation' | 'subscription';
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
        code: 'NOT_FOUND',
        message: `No procedure on path "${request.path}"`,
      });
    }
    const ctx = opts?.createContext ? await opts.createContext() : {};
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

/** Schema and context used to bind generated service handlers. */
export interface BindRouterOptions {
  schema: ProtoSchema;
  createContext?: () => unknown | Promise<unknown>;
}

/** Proto-shaped handlers that call a tRPC router. */
export function bindRouter(
  router: AnyRouter,
  opts: BindRouterOptions,
): StubHandlers {
  return bindStubHandlers(
    opts.schema,
    createInvoker(router, { createContext: opts.createContext }),
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
    typeof value === 'object' &&
    'subscribe' in value &&
    typeof (value as { subscribe?: unknown }).subscribe === 'function'
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
  const schema = opts.schema;
  const { address = DEFAULT_ADDRESS } = opts;
  const codec = new ProtoCodec(schema);
  const client = new grpc.Client(address, grpc.credentials.createInsecure());

  return (request) => {
    let serviceName: string | undefined;
    let method: RuntimeProtoMethod | undefined;
    if (request.service && request.method) {
      serviceName = request.service;
      method = codec.lookupMethod(serviceName, request.method);
    } else {
      const rpc = codec.lookupRpc(request.path);
      serviceName = rpc?.service;
      method = rpc?.method;
    }
    if (!serviceName || !method) {
      return Promise.reject(new Error('no gRPC mapping for call'));
    }
    const rpcPath =
      request.grpcPath ??
      `/${schema.package}.${serviceName}/${method.name}`;
    const payload = request.bytes
      ? Buffer.from(request.bytes)
      : Buffer.from(codec.encode(method.requestType, request.input));
    const metadata = new grpc.Metadata();
    if (request.metadata) {
      for (const [key, value] of Object.entries(request.metadata)) {
        metadata.set(key, value);
      }
    }
    if (method.responseStream) {
      const stream = client.makeServerStreamRequest(
        rpcPath,
        (value: Buffer) => value,
        (value: Buffer) => value,
        payload,
        metadata,
      );
      if (request.signal) {
        request.signal.addEventListener('abort', () => stream.cancel(), {
          once: true,
        });
      }
      return Promise.resolve(
        (async function* () {
          for await (const chunk of stream) {
            if (!(chunk instanceof Uint8Array)) {
              throw new Error('expected protobuf bytes');
            }
            yield codec.decode(method.responseType, chunk);
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
              method.responseType,
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
  return bindStubHandlers(opts.schema, (request) =>
    call({
      path: request.path,
      type: 'query',
      input: request.input,
    }),
  );
}

/** Options for serving a tRPC router over native gRPC. */
export interface ServeGrpcOptions {
  schema: ProtoSchema;
  address?: string;
  createContext?: () => unknown | Promise<unknown>;
  credentials?: grpc.ServerCredentials;
}

/** Bound native gRPC server and its lifecycle controls. */
export interface GrpcServerHandle {
  address: string;
  port: number;
  close(): Promise<void>;
}

export function grpcStatus(err: TRPCError): grpc.status {
  switch (err.code) {
    // Client Errors & Malformed Input
    case 'PARSE_ERROR':
    case 'BAD_REQUEST':
    case 'UNPROCESSABLE_CONTENT':
      return grpc.status.INVALID_ARGUMENT;

    // Authentication & Authorization
    case 'UNAUTHORIZED':
      return grpc.status.UNAUTHENTICATED;

    case 'FORBIDDEN':
    case 'PAYMENT_REQUIRED':
      return grpc.status.PERMISSION_DENIED;

    // Resource & Preconditions
    case 'NOT_FOUND':
      return grpc.status.NOT_FOUND;

    case 'CONFLICT':
      return grpc.status.ALREADY_EXISTS;

    case 'PRECONDITION_FAILED':
    case 'PRECONDITION_REQUIRED':
      return grpc.status.FAILED_PRECONDITION;

    // Request Constraints & Quotas
    case 'PAYLOAD_TOO_LARGE':
      return grpc.status.RESOURCE_EXHAUSTED;

    case 'TOO_MANY_REQUESTS':
      return grpc.status.RESOURCE_EXHAUSTED;

    // Timing & Cancellation
    case 'TIMEOUT':
    case 'GATEWAY_TIMEOUT':
      return grpc.status.DEADLINE_EXCEEDED;

    case 'CLIENT_CLOSED_REQUEST':
      return grpc.status.CANCELLED;

    // Server & Transport Errors
    case 'METHOD_NOT_SUPPORTED':
    case 'NOT_IMPLEMENTED':
      return grpc.status.UNIMPLEMENTED;

    case 'SERVICE_UNAVAILABLE':
    case 'BAD_GATEWAY':
      return grpc.status.UNAVAILABLE;

    case 'UNSUPPORTED_MEDIA_TYPE':
      return grpc.status.INVALID_ARGUMENT;

    case 'INTERNAL_SERVER_ERROR':
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
  opts: ServeGrpcOptions,
): Promise<GrpcServerHandle> {
  const address = opts.address ?? DEFAULT_ADDRESS;
  const credentials =
    opts.credentials ?? grpc.ServerCredentials.createInsecure();
  const schema = opts.schema;
  const codec = new ProtoCodec(schema);
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
          call.on('cancelled', () => ac.abort());
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
  const host = address.replace(/:\d+$/, '');
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
