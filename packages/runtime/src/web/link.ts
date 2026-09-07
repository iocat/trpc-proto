import type { TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { createGrpcWebFetchCall } from "./protocol.js";
import { createProtoLink, type ProtoLinkOptions } from "../grpc/proto_link.js";

export interface GrpcWebProxyLinkOptions<
  TRouter extends AnyRouter = AnyRouter,
> extends ProtoLinkOptions<TRouter> {
  /** Origin for gRPC-Web POSTs. Default `''` (same origin). */
  url?: string;
}

/** tRPC link: appRouter codec → unary gRPC-Web fetch. Same shape as `grpcLink`. */
export function grpcWebProxyLink<TRouter extends AnyRouter>(
  opts: GrpcWebProxyLinkOptions<TRouter>,
): TRPCLink<TRouter> {
  return createProtoLink(opts, createGrpcWebFetchCall(opts.url ?? ""));
}
