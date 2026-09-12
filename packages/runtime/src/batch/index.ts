export { batchRouter } from './proto/batch_router.js';
export type { BatchRouter } from './proto/batch_router.js';
export { protoSchema as batchProtoSchema } from './proto/generated/schema.js';
export { createDirectBatchDispatcher } from './grpcweb/direct_dispatcher.js';
export type { DirectBatchDispatcherOptions } from './grpcweb/direct_dispatcher.js';
export { grpcWebBatchLink } from './link/web_link.js';
export type { GrpcWebBatchLinkOptions } from './link/web_link.js';
export { BATCH_GRPC_PATH, BATCH_PROCEDURE_PATH } from './proto/wire.js';
