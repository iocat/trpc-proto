export { generate, translate } from './generate.js';
export { fromString, toString } from '@trpc-proto/schema_ir';
export type { GenerateOptions, GenerateResult } from './generate.js';
export type {
  ProtoFileHeader,
  ProtoFileOptions,
  ProtoMeta,
  ProtoSchema,
  ProtoSyntax,
} from '@trpc-proto/schema_ir';
export { listProcedures, loadAppRouter, protoMetaFromRouter } from './load.js';
export type { LoadOptions, RuntimeProcedure } from './load.js';
