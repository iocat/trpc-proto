export { bindRouter } from "./grpc/server.js";
export type { StubHandlers } from "./grpc/server.js";
export { noopForNonTsBackend } from "./noop.js";

export {
  createProtoCodec,
  createProtoTransformer,
} from "./proto_codec/proto_codec.js";
export type { ProtoCodec } from "./proto_codec/proto_codec.js";
export { createProtoStub, serveGrpc } from "./grpc/server.js";
export { createGrpcWebHop } from "./web/hop.js";
export { grpcWebProxyLink } from "./web/link.js";
export type { GrpcWebProxyLinkOptions } from "./web/link.js";
export { GRPC_WEB_CONTENT_TYPE, isGrpcWebContentType } from "./web/protocol.js";
export { authInterceptor, grpcLink } from "./grpc/link.js";
export type {
  AuthConfig,
  CallContext,
  CallInterceptor,
  GrpcLinkOptions,
  StubCall,
  StubRequest,
} from "./grpc/link.js";
export {
  listProcedures,
  prevalidateRouter,
  protoMetaFromRouter,
  schemaFromRouter,
  translate,
} from "@trpc-proto/schema_ir";
export type {
  ProcedureType,
  ProtoFileHeader,
  ProtoFileOptions,
  ProtoMeta,
  ProtoSchema,
  ProtoSyntax,
  RuntimeProcedure,
  TranslateOptions,
} from "@trpc-proto/schema_ir";
