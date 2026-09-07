import type { TRPCLink } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { createGrpcWebFetchCall } from './protocol.js';
import { createProtoLink, type ProtoLinkOptions } from '../grpc/proto_link.js';

/** Options for a tRPC link that sends protobuf over gRPC-Web. */
export interface GrpcWebLinkOptions<
  TRouter extends AnyRouter = AnyRouter,
> extends ProtoLinkOptions<TRouter> {
  /** Origin for gRPC-Web POSTs. Default `''` (same origin). */
  url?: string;
}

/** tRPC link for unary and server-streaming protobuf calls over gRPC-Web. */
export function grpcWebLink<TRouter extends AnyRouter>(
  opts: GrpcWebLinkOptions<TRouter>,
): TRPCLink<TRouter> {
  return createProtoLink(opts, createGrpcWebFetchCall(opts.url ?? ''));
}
