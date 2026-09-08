import * as grpc from '@grpc/grpc-js';
import { TRPCError, type AnyRouter } from '@trpc/server';
import {
  createRouterInvoker,
  toAsyncIterable,
  type RouterInvoker,
} from '../router_invoker.js';
import { ProtoCodec } from '../proto_codec/proto_codec.js';
import type { ProtoSchema } from '@trpc-proto/schema_ir';
import { grpcStatus } from './status.js';


/** Default insecure gRPC dial target for local development. */
const DEFAULT_ADDRESS = '127.0.0.1:50051';


/** `{ UserService: { GetById: (input) => ... } }` — spread onto generated server stubs. */
export type StubHandlers = Record<
  string,
  Record<string, (input: unknown) => Promise<unknown>>
>;


function bindStubHandlers(schema: ProtoSchema, invoke: RouterInvoker): StubHandlers {
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
    createRouterInvoker(router, { createContext: opts.createContext }),
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
  const invoke = createRouterInvoker(router, {
    createContext: opts.createContext,
  });
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
