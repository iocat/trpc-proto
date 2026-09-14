import type { TRPCLink } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';
import { createGrpcWebFetchCall } from './fetch_call.js';
import { createProtoLink, type ProtoLinkOptions } from '../grpc/proto_link.js';
import type { GrpcWebEncoding } from './content_type.js';
import { GrpcWebBatchLink } from '../batch/link/web_link.js';

/** Client-side batching configuration for unary gRPC-Web operations. */
export interface GrpcWebLinkBatchOptions {
  /** Maximum operations per gRPC request. Defaults to 100. */
  maxItems?: number;
}

/** Options for a tRPC link that sends protobuf over gRPC-Web. */
export interface GrpcWebLinkOptions extends ProtoLinkOptions {
  /** Origin for gRPC-Web POSTs. Default `''` (same origin). */
  url?: string;
  /** HTTP body representation. Defaults to base64 gRPC-Web. */
  encoding?: GrpcWebEncoding;
  /** Gzip-compresses each request message before framing. Defaults to false. */
  compress?: boolean;
  /**
   * Batches queries and mutations while leaving subscriptions on the streaming
   * transport. Defaults to false.
   */
  batch?: boolean | GrpcWebLinkBatchOptions;
}

/** tRPC link for unary and server-streaming protobuf calls over gRPC-Web. */
export function grpcWebLink<TRouter extends AnyRouter>(
  opts: GrpcWebLinkOptions,
): TRPCLink<TRouter> {
  const { batch, ...linkOptions } = opts;
  const directLink = createProtoLink<TRouter>(
    linkOptions,
    createGrpcWebFetchCall({
      baseUrl: opts.url ?? '',
      encoding: opts.encoding ?? 'base64',
      compress: opts.compress ?? false,
    }),
  );
  if (!batch) return directLink;

  const batchLink = new GrpcWebBatchLink<TRouter>({
    ...linkOptions,
    maxItems: typeof batch === 'object' ? batch.maxItems : undefined,
  }).link();
  return (runtime) => {
    const direct = directLink(runtime);
    const batched = batchLink(runtime);
    return (props) =>
      props.op.type === 'subscription' ? direct(props) : batched(props);
  };
}
