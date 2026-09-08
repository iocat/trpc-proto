import * as grpc from '@grpc/grpc-js';
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

export function createForwardingDispatcher(
  client: grpc.Client,
): GrpcWebDispatcher {
  return ({ grpcPath, message, metadata, signal }, emit) => {
    const completed = Promise.withResolvers<
      Awaited<ReturnType<GrpcWebDispatcher>>
    >();
    const grpcMetadata = new grpc.Metadata();
    for (const [key, value] of metadata) {
      grpcMetadata.set(key, value);
    }
    const call = client.makeServerStreamRequest(
      grpcPath,
      (value: Buffer) => value,
      (value: Buffer) => value,
      Buffer.from(message),
      grpcMetadata,
    );
    let callEnded = false;
    const cancelCall = () => {
      if (!callEnded) call.cancel();
    };
    if (signal.aborted) cancelCall();
    else signal.addEventListener('abort', cancelCall, { once: true });

    let writes = Promise.resolve();
    call.on('data', (response: Buffer) => {
      writes = writes.then(() => emit(new Uint8Array(response)));
    });
    call.on('status', (status: grpc.StatusObject) => {
      callEnded = true;
      signal.removeEventListener('abort', cancelCall);
      void writes.then(
        () =>
          completed.resolve({
            code: status.code,
            message: status.details,
            metadata: trailerRecord(status.metadata),
          }),
        completed.reject,
      );
    });
    call.on('error', () => {
      // `status` always follows and carries the canonical result.
    });
    return completed.promise;
  };
}
