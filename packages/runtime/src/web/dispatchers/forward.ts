import * as grpc from '@grpc/grpc-js';
import type { ProtoSchema } from '@trpc-proto/schema_ir';
import { createForwardingBatchDispatcher } from '../../batch/grpcweb/forwarding_dispatcher.js';
import type { GrpcWebDispatcher } from './types.js';

function trailerRecord(metadata?: grpc.Metadata): Record<string, string> {
  if (!metadata) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata.getMap())) {
    if (value == null || Buffer.isBuffer(value)) continue;
    result[key] = String(value);
  }
  return result;
}

const identity = (value: Buffer): Buffer => value;

function forwardingRoutes(
  schema: ProtoSchema,
): ReadonlyMap<string, grpc.MethodDefinition<Buffer, Buffer>> {
  const routes = new Map<string, grpc.MethodDefinition<Buffer, Buffer>>();
  for (const service of schema.services) {
    for (const method of service.methods) {
      const path = `/${schema.package}.${service.name}/${method.name}`;
      routes.set(path, {
        path,
        requestStream: false,
        responseStream: method.isResponseStreaming,
        requestSerialize: identity,
        requestDeserialize: identity,
        responseSerialize: identity,
        responseDeserialize: identity,
      });
    }
  }
  return routes;
}

function completionForCall({
  call,
  signal,
  writes,
  unaryError,
}: {
  call: grpc.ClientUnaryCall | grpc.ClientReadableStream<Buffer>;
  signal: AbortSignal;
  writes: () => Promise<void>;
  unaryError?: () => grpc.ServiceError | null;
}): Promise<Awaited<ReturnType<GrpcWebDispatcher>>> {
  const completed =
    Promise.withResolvers<Awaited<ReturnType<GrpcWebDispatcher>>>();
  let callEnded = false;
  const cancelCall = () => {
    if (!callEnded) call.cancel();
  };
  if (signal.aborted) cancelCall();
  else signal.addEventListener('abort', cancelCall, { once: true });

  call.on('status', (status: grpc.StatusObject) => {
    callEnded = true;
    signal.removeEventListener('abort', cancelCall);
    const result = unaryError?.() ?? status;
    void writes().then(
      () =>
        completed.resolve({
          code: result.code,
          message: result.details,
          metadata: trailerRecord(result.metadata),
        }),
      completed.reject,
    );
  });
  return completed.promise;
}

export function createForwardingDispatcher(
  client: grpc.Client,
  schema: ProtoSchema,
): GrpcWebDispatcher {
  const routes = forwardingRoutes(schema);
  const dispatch: GrpcWebDispatcher = (
    { grpcPath, message, metadata, signal },
    emit,
  ) => {
    const route = routes.get(grpcPath);
    if (!route) {
      return Promise.resolve({
        code: grpc.status.UNIMPLEMENTED,
        message: `no gRPC mapping for ${grpcPath}`,
      });
    }

    const grpcMetadata = new grpc.Metadata();
    for (const [key, value] of metadata) {
      grpcMetadata.set(key, value);
    }

    // Unary calls.
    if (!route.responseStream) {
      let writes = Promise.resolve();
      let callbackError: grpc.ServiceError | null = null;
      const call = client.makeUnaryRequest(
        route.path,
        route.requestSerialize,
        route.responseDeserialize,
        Buffer.from(message),
        grpcMetadata,
        (error, response) => {
          callbackError = error;
          if (!error && response !== undefined) {
            writes = writes.then(() => emit(new Uint8Array(response)));
          }
        },
      );
      return completionForCall({
        call,
        signal,
        writes: () => writes,
        unaryError: () => callbackError,
      });
    }

    const call = client.makeServerStreamRequest(
      route.path,
      route.requestSerialize,
      route.responseDeserialize,
      Buffer.from(message),
      grpcMetadata,
    );
    let writes = Promise.resolve();
    call.on('data', (response: Buffer) => {
      writes = writes.then(() => emit(new Uint8Array(response)));
    });
    call.on('error', () => {
      // `status` always follows and carries the canonical result.
    });
    return completionForCall({ call, signal, writes: () => writes });
  };
  return createForwardingBatchDispatcher(dispatch, schema);
}
