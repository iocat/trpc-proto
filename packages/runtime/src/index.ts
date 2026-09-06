export {
  bindStubHandlers,
  createNoopStub,
  noopForNonTsBackend,
} from './bind.js';
export type { StubHandlers } from './bind.js';
export { createCodec, createProtoTransformer } from './codec.js';
export type { Codec } from './codec.js';
export {
  createGrpcStubCall,
  createProtobufProxy,
  createProtoStub,
} from './grpc.js';
export type { GrpcProtoOptions } from './grpc.js';
export { createInvoker } from './invoke.js';
export type { InvokeRequest, Invoker } from './invoke.js';
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
