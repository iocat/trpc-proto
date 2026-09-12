import * as grpc from '@grpc/grpc-js';
import type { ProtoSchema } from '@trpc-proto/schema_ir';
import type {
  GrpcWebDispatcher,
  GrpcWebDispatchOptions,
  GrpcWebDispatchRequest,
} from '../../web/dispatchers/types.js';
import {
  BATCH_GRPC_PATH,
  decodeBatchCalls,
  encodeBatchResponse,
  type BatchWireCall,
  type BatchWireResponse,
  type BatchWireResult,
} from '../proto/wire.js';
interface ForwardedBatchRoute {
  grpcPath: string;
  responseStream: boolean;
}

function batchRoutes(
  schema: ProtoSchema,
): ReadonlyMap<string, ForwardedBatchRoute> {
  const routes = new Map<string, ForwardedBatchRoute>();
  for (const service of schema.services) {
    for (const method of service.methods) {
      routes.set(method.path, {
        grpcPath: `/${schema.package}.${service.name}/${method.name}`,
        responseStream: method.isResponseStreaming,
      });
    }
  }
  return routes;
}

function itemError(
  call: BatchWireCall,
  code: number,
  message: string,
): BatchWireResult {
  return { result: 'error', id: call.id, code, message };
}

/** Expands a batch envelope into ordinary native gRPC backend calls. */
export function createForwardingBatchDispatcher(
  dispatch: GrpcWebDispatcher,
  schema: ProtoSchema,
): GrpcWebDispatcher {
  const routes = batchRoutes(schema);

  async function executeCall(
    call: BatchWireCall,
    request: GrpcWebDispatchRequest,
    dispatchOptions?: GrpcWebDispatchOptions,
  ): Promise<BatchWireResult> {
    const route = routes.get(call.path);
    if (!route) {
      return itemError(
        call,
        grpc.status.UNIMPLEMENTED,
        `no gRPC mapping for ${call.path}`,
      );
    }
    if (route.responseStream) {
      return itemError(
        call,
        grpc.status.UNIMPLEMENTED,
        `subscriptions cannot be included in a batch: ${call.path}`,
      );
    }

    const outputs: Uint8Array[] = [];
    const status = await dispatch(
      {
        ...request,
        grpcPath: route.grpcPath,
        message: call.input ?? new Uint8Array(),
      },
      async (message) => {
        outputs.push(message);
      },
      dispatchOptions,
    );
    if (status.code !== grpc.status.OK) {
      return itemError(call, status.code, status.message);
    }
    if (outputs.length !== 1) {
      return itemError(
        call,
        grpc.status.INTERNAL,
        `backend returned ${outputs.length} messages for unary call ${call.path}`,
      );
    }
    return { result: 'success', id: call.id, output: outputs[0] };
  }

  return async (request, emit, dispatchOptions) => {
    if (request.grpcPath !== BATCH_GRPC_PATH) {
      return dispatch(request, emit, dispatchOptions);
    }
    const validation = decodeBatchCalls(request.message);
    if ('error' in validation) {
      return { code: grpc.status.INVALID_ARGUMENT, message: validation.error };
    }

    const results = await Promise.all(
      validation.calls.map((call) =>
        executeCall(call, request, dispatchOptions),
      ),
    );
    if (request.signal.aborted) {
      return { code: grpc.status.CANCELLED, message: 'batch cancelled' };
    }

    const response: BatchWireResponse = { results };
    await emit(encodeBatchResponse(response));
    return { code: grpc.status.OK, message: '' };
  };
}
