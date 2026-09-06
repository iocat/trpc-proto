import * as grpc from '@grpc/grpc-js';
import { TRPCError, type AnyRouter } from '@trpc/server';
import { bindRouter, bindStubHandlers, type StubHandlers } from './bind.js';
import { createCodec } from './codec.js';
import type { StubCall } from './link.js';
import { schemaFromRouter } from './translate.js';
import type { ProtoSchema } from '@trpc-proto/schema_ir';

/** Default insecure gRPC dial target for local development. */
const DEFAULT_ADDRESS = '127.0.0.1:50051';

export interface GrpcProtoOptions {
  router: AnyRouter;
  address?: string;
}

function lookupRpc(schema: ProtoSchema, path: string) {
  for (const service of schema.services) {
    for (const method of service.methods) {
      if (method.path === path) return { service, method };
    }
  }
  return undefined;
}

export function createGrpcStubCall(opts: GrpcProtoOptions): StubCall {
  const schema = schemaFromRouter(opts.router);
  const { address = DEFAULT_ADDRESS } = opts;
  const codec = createCodec(schema);
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
      return Promise.reject(new Error('no gRPC mapping for call'));
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
      type: 'query',
      input: request.input,
    }),
  );
}

/** Forward already-encoded protobuf bytes over gRPC. */
export function createProtobufProxy(address = DEFAULT_ADDRESS) {
  const client = new grpc.Client(address, grpc.credentials.createInsecure());
  return {
    unary(
      grpcPathName: string,
      body: Uint8Array,
      headers?: Record<string, string>,
    ) {
      const metadata = new grpc.Metadata();
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          if (value) metadata.set(key, value);
        }
      }
      const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
      client.makeUnaryRequest(
        grpcPathName,
        (value: Buffer) => value,
        (value: Buffer) => value,
        Buffer.from(body),
        metadata,
        (err, res) => {
          if (err) reject(err);
          else resolve(new Uint8Array(res ?? Buffer.alloc(0)));
        },
      );
      return promise;
    },
  };
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

function grpcStatus(err: TRPCError) {
  switch (err.code) {
    case 'NOT_FOUND':
      return grpc.status.NOT_FOUND;
    case 'BAD_REQUEST':
      return grpc.status.INVALID_ARGUMENT;
    case 'UNAUTHORIZED':
      return grpc.status.UNAUTHENTICATED;
    case 'FORBIDDEN':
      return grpc.status.PERMISSION_DENIED;
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
  const codec = createCodec(schema);
  const stubs = bindRouter(router, { createContext: opts.createContext });
  const server = new grpc.Server();

  for (const service of schema.services) {
    const definition: Record<string, grpc.MethodDefinition<unknown, unknown>> =
      {};
    const implementation: grpc.UntypedServiceImplementation = {};
    const handlers = stubs[service.name];
    for (const method of service.methods) {
      definition[method.name] = {
        path: `/${schema.package}.${service.name}/${method.name}`,
        requestStream: false,
        responseStream: false,
        requestSerialize: (value) =>
          Buffer.from(codec.encode(method.requestType, value)),
        requestDeserialize: (bytes) =>
          codec.decode(method.requestType, new Uint8Array(bytes)),
        responseSerialize: (value) =>
          Buffer.from(codec.encode(method.responseType, value)),
        responseDeserialize: (bytes) =>
          codec.decode(method.responseType, new Uint8Array(bytes)),
      };
      implementation[method.name] = (
        call: grpc.ServerUnaryCall<unknown, unknown>,
        callback: grpc.sendUnaryData<unknown>,
      ) => {
        const handle = handlers?.[method.name];
        if (!handle) {
          callback(
            toServiceError(
              new TRPCError({
                code: 'NOT_FOUND',
                message: `No handler for ${service.name}.${method.name}`,
              }),
            ),
          );
          return;
        }
        handle(call.request).then(
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
