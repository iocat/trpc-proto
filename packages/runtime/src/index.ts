export { noopForNonTsBackend } from './noop.js';
export { grpcLink } from './grpc/link.js';
export type { AuthConfig, GrpcLinkOptions } from './grpc/link.js';
export { bindRouter, serveGrpc } from './grpc/server.js';
export type { ServeGrpcOptions, StubHandlers } from './grpc/server.js';
export { createGrpcWebHttpHandler } from './web/http_handler.js';
export type {
  GrpcWebCorsOptions,
  GrpcWebHttpHandlerOptions,
} from './web/http_handler.js';
export { grpcWebProxyLink } from './web/link.js';
export type { GrpcWebProxyLinkOptions } from './web/link.js';
export type { ProtoMeta } from '@trpc-proto/schema_ir';
