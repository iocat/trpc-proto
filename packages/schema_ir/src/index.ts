export type {
  ProcedureType,
  PropertyGenCache,
  ProtoEnum,
  ProtoField,
  ProtoFileHeader,
  ProtoFileOptions,
  ProtoMessage,
  ProtoMeta,
  ProtoMethod,
  ProtoObjectMeta,
  ProtoScalar,
  ProtoSchema,
  ProtoService,
  ProtoSyntax,
  ProtoType,
  SchemaGenerateCache,
} from './ir/types.js';
export { fromString, toString } from './ir/text.js';
export {
  assertPrevalidate,
  formatIssues,
  prevalidate,
  PrevalidateError,
} from './validate/prevalidate.js';
export type {
  ProtoIssue,
  ProtoIssueCode,
  ProtoIssueLevel,
  ProtoPrevalidateInput,
  ProtoProcedureCheck,
} from './validate/prevalidate.js';
export {
  WELL_KNOWN_IMPORTS,
  isWellKnownType,
  protoServiceName,
  wellKnownImport,
  wellKnownKind,
} from './ir/wellknown.js';
export { createFieldAllocator } from './translate/field_allocator.js';
export {
  listProcedures,
  prevalidateRouter,
  protoMetaFromRouter,
  schemaFromRouter,
  translate,
} from './translate/trpc_schema.js';
export type {
  RuntimeProcedure,
  TranslateOptions,
} from './translate/trpc_schema.js';
