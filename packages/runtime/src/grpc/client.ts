import * as grpc from '@grpc/grpc-js';
import type { ProtoSchema } from '@trpc-proto/schema_ir';
import {
  ProtoCodec,
  type RuntimeProtoMethod,
} from '../proto_codec/proto_codec.js';
import type { StubCall } from './proto_link.js';

const DEFAULT_ADDRESS = '127.0.0.1:50051';

/** Schema and address used by a native gRPC client call. */
export interface GrpcProtoOptions {
  schema: ProtoSchema;
  address?: string;
}

/** Creates the byte-oriented native gRPC transport used by `grpcLink`. */
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
    const pending = Promise.withResolvers<unknown>();
    client.makeUnaryRequest(
      rpcPath,
      (value: Buffer) => value,
      (value: Buffer) => value,
      payload,
      metadata,
      (error, response) => {
        if (error) pending.reject(error);
        else {
          pending.resolve(
            codec.decode(
              method.responseType,
              new Uint8Array(response ?? Buffer.alloc(0)),
            ),
          );
        }
      },
    );
    return pending.promise;
  };
}
