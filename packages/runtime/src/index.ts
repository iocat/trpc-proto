export {
  bindRouter,
  noopForNonTsBackend,
} from './bind.js';
export type { StubHandlers } from './bind.js';
export { createCodec, createProtoTransformer } from './codec.js';
export type { Codec } from './codec.js';
export {
  createProtobufProxy,
  createProtoStub,
  serveGrpc,
} from './grpc.js';
export type {
  GrpcProtoOptions,
  GrpcServerHandle,
  ServeGrpcOptions,
} from './grpc.js';
export { authInterceptor, grpcLink } from './link.js';
export type {
  AuthConfig,
  CallContext,
  CallInterceptor,
  GrpcLinkOptions,
  StubCall,
  StubRequest,
} from './link.js';
export {
  listProcedures,
  prevalidateRouter,
  protoMetaFromRouter,
  schemaFromRouter,
  translate,
} from './translate.js';
export type {
  ProcedureType,
  RuntimeProcedure,
  TranslateOptions,
} from './translate.js';
export type {
  ProtoFileHeader,
  ProtoFileOptions,
  ProtoMeta,
  ProtoSchema,
  ProtoSyntax,
} from '@trpc-proto/schema_ir';
