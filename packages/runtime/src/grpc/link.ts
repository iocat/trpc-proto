import type { TRPCLink } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { createGrpcStubCall } from './server.js';
import { createProtoLink, type ProtoLinkOptions } from './proto_link.js';

export { authInterceptor, createProtoLink } from './proto_link.js';
export type {
  AuthConfig,
  CallContext,
  CallInterceptor,
  MaybePromise,
  ProtoLinkOptions,
  StubCall,
  StubRequest,
} from './proto_link.js';

/** Options for a tRPC link backed by a native gRPC client. */
export interface GrpcLinkOptions extends ProtoLinkOptions {
  address?: string;
}

export function grpcLink<TRouter extends AnyRouter>(
  opts: GrpcLinkOptions,
): TRPCLink<TRouter> {
  return createProtoLink<TRouter>(
    opts,
    createGrpcStubCall({
      schema: opts.schema,
      address: opts.address,
    }),
  );
}
