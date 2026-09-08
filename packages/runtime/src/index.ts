export { noopForNonTsBackend } from './noop.js';
export { grpcLink } from './grpc/link.js';
export type { AuthConfig, GrpcLinkOptions } from './grpc/link.js';
export { bindRouter, serveGrpc } from './grpc/server.js';
export type {
  BindRouterOptions,
  ServeGrpcOptions,
  StubHandlers,
} from './grpc/server.js';
export { createGrpcWebHttpHandler } from './web/http_handler.js';
export type {
  GrpcWebCorsOptions,
  GrpcWebHttpHandlerOptions,
} from './web/http_handler.js';
export { grpcWebLink } from './web/link.js';
export type { GrpcWebLinkOptions } from './web/link.js';
export type { GrpcWebEncoding } from './web/content_type.js';
export { zAsyncIterable } from '@trpc-proto/schema_ir';
export type { ProtoMeta, ProtoSchema } from '@trpc-proto/schema_ir';
