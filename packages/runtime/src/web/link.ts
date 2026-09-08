import type { TRPCLink } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { createGrpcWebFetchCall } from './fetch_call.js';
import { createProtoLink, type ProtoLinkOptions } from '../grpc/proto_link.js';
import type { GrpcWebEncoding } from './content_type.js';

/** Options for a tRPC link that sends protobuf over gRPC-Web. */
export interface GrpcWebLinkOptions extends ProtoLinkOptions {
  /** Origin for gRPC-Web POSTs. Default `''` (same origin). */
  url?: string;
  /** HTTP body representation. Defaults to base64 gRPC-Web. */
  encoding?: GrpcWebEncoding;
  /** Gzip-compresses each request message before framing. Defaults to false. */
  compress?: boolean;
}

/** tRPC link for unary and server-streaming protobuf calls over gRPC-Web. */
export function grpcWebLink<TRouter extends AnyRouter>(
  opts: GrpcWebLinkOptions,
): TRPCLink<TRouter> {
  return createProtoLink<TRouter>(
    opts,
    createGrpcWebFetchCall({
      baseUrl: opts.url ?? '',
      encoding: opts.encoding ?? 'base64',
      compress: opts.compress ?? false,
    }),
  );
}
