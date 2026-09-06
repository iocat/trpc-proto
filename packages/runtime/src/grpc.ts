import * as grpc from '@grpc/grpc-js';
import type { AnyRouter } from '@trpc/server';
import { bindStubHandlers, type StubHandlers } from './bind.js';
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
