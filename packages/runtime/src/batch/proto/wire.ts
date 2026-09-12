import { ProtoCodec, type RuntimeProtoRpc } from '../../proto_codec/index.js';
import { protoSchema as batchProtoSchema } from './generated/schema.js';

export const BATCH_PROCEDURE_PATH = 'batch.execute';
export const DEFAULT_MAX_BATCH_ITEMS = 100;

const batchCodec = new ProtoCodec(batchProtoSchema);
const resolvedBatchRpc = batchCodec.lookupRpc(BATCH_PROCEDURE_PATH);
if (!resolvedBatchRpc) {
  throw new Error('batch router did not generate a protobuf RPC mapping');
}
const batchRpc: RuntimeProtoRpc = resolvedBatchRpc;

/** The fixed gRPC path for the batch procedure. */
export const BATCH_GRPC_PATH = `/${batchProtoSchema.package}.${batchRpc.service}/${batchRpc.method.name}`;

/** The gRPC content type for the batch procedure. */
export interface BatchWireCall {
  id: number;
  path: string;
  input?: Uint8Array;
}

/** The gRPC content type for the batch procedure. */
export interface BatchWireRequest {
  calls: BatchWireCall[];
}

/** The gRPC content type for the batch procedure. */
export type BatchWireResult =
  | {
      result: 'success';
      id: number;
      output?: Uint8Array;
    }
  | {
      result: 'error';
      id: number;
      code: number;
      message: string;
    };

/** The gRPC content type for the batch procedure. */
export interface BatchWireResponse {
  results: BatchWireResult[];
}
export type BatchValidation = { calls: BatchWireCall[] } | { error: string };

export function decodeBatchCalls(message: Uint8Array): BatchValidation {
  let decoded: unknown;
  try {
    decoded = batchCodec.decode(batchRpc.method.requestType, message);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  if (!decoded || typeof decoded !== 'object') {
    return { error: 'batch request must be an object' };
  }
  const calls = (decoded as Partial<BatchWireRequest>).calls;
  if (!Array.isArray(calls)) {
    return { error: 'batch request calls must be an array' };
  }
  const ids = new Set<number>();
  for (const call of calls) {
    if (
      !call ||
      typeof call !== 'object' ||
      !Number.isInteger(call.id) ||
      call.id <= 0 ||
      ids.has(call.id) ||
      typeof call.path !== 'string' ||
      call.path.length === 0 ||
      (call.input !== undefined && !(call.input instanceof Uint8Array))
    ) {
      return {
        error:
          'batch calls require a unique positive id, path, and bytes input',
      };
    }
    ids.add(call.id);
  }
  return { calls };
}

export function encodeBatchResponse(response: BatchWireResponse): Uint8Array {
  return batchCodec.encode(batchRpc.method.responseType, response);
}

export function batchProtocol(): {
  codec: ProtoCodec;
  rpc: RuntimeProtoRpc;
} {
  return { codec: batchCodec, rpc: batchRpc };
}
