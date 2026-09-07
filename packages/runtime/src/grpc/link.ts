import type { TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { createGrpcStubCall } from "./server.js";
import { createProtoLink, type ProtoLinkOptions } from "./proto_link.js";

export { authInterceptor, createProtoLink } from "./proto_link.js";
export type {
  AuthConfig,
  CallContext,
  CallInterceptor,
  MaybePromise,
  ProtoLinkOptions,
  StubCall,
  StubRequest,
} from "./proto_link.js";

export interface GrpcLinkOptions<
  TRouter extends AnyRouter = AnyRouter,
> extends ProtoLinkOptions<TRouter> {
  address?: string;
}

export function grpcLink<TRouter extends AnyRouter>(
  opts: GrpcLinkOptions<TRouter>,
): TRPCLink<TRouter> {
  return createProtoLink(
    opts,
    createGrpcStubCall({
      router: opts.router,
      address: opts.address,
    }),
  );
}
