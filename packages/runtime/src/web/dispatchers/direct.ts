import * as grpc from '@grpc/grpc-js';
import { TRPCError, type AnyRouter } from '@trpc/server';
import type { ProtoSchema } from '@trpc-proto/schema_ir';
import { grpcStatus } from '../../grpc/status.js';
import { ProtoCodec } from '../../proto_codec/proto_codec.js';
import { createRouterInvoker, toAsyncIterable } from '../../router_invoker.js';
import type { GrpcWebDispatcher } from './types.js';

/** Dependencies needed to execute gRPC-Web calls against a tRPC router. */
export interface DirectDispatcherOptions {
  schema: ProtoSchema;
  createContext?: () => unknown | Promise<unknown>;
}

interface GrpcWebRoute {
  procedurePath: string;
  requestType: string;
  responseType: string;
  responseStream: boolean;
}

function grpcWebRoutes(schema: ProtoSchema): ReadonlyMap<string, GrpcWebRoute> {
  const routes = new Map<string, GrpcWebRoute>();
  for (const service of schema.services) {
    for (const method of service.methods) {
      routes.set(`/${schema.package}.${service.name}/${method.name}`, {
        procedurePath: method.path,
        requestType: method.requestType,
        responseType: method.responseType,
        responseStream: method.isResponseStreaming,
      });
    }
  }
  return routes;
}

export function createDirectDispatcher(
  router: AnyRouter,
  options: DirectDispatcherOptions,
): GrpcWebDispatcher {
  const protoCodec = new ProtoCodec(options.schema);
  const routes = grpcWebRoutes(options.schema);
  const invoke = createRouterInvoker(router, {
    createContext: options.createContext,
  });

  return async ({ grpcPath, message, signal }, emit) => {
    const route = routes.get(grpcPath);
    if (!route) {
      return {
        code: grpc.status.UNIMPLEMENTED,
        message: `no gRPC mapping for ${grpcPath}`,
      };
    }
    try {
      const input = protoCodec.decode(route.requestType, message);
      const result = await invoke({
        path: route.procedurePath,
        input,
        signal,
      });
      if (route.responseStream) {
        for await (const item of toAsyncIterable(result)) {
          if (signal.aborted) break;
          await emit(protoCodec.encode(route.responseType, item));
        }
      } else {
        await emit(protoCodec.encode(route.responseType, result));
      }
      return {
        code: signal.aborted ? grpc.status.CANCELLED : grpc.status.OK,
        message: '',
      };
    } catch (error) {
      return {
        code:
          error instanceof TRPCError ? grpcStatus(error) : grpc.status.UNKNOWN,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
