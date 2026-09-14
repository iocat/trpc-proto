/**
 * Intermediate representation emitted by `@trpc-proto/plugin` as the cache
 * schema and generated runtime schema, then consumed by `@trpc-proto/runtime`.
 */

export type ProtoScalar =
  | 'double'
  | 'float'
  | 'int32'
  | 'int64'
  | 'uint32'
  | 'uint64'
  | 'sint32'
  | 'sint64'
  | 'fixed32'
  | 'fixed64'
  | 'sfixed32'
  | 'sfixed64'
  | 'bool'
  | 'string'
  | 'bytes';

export type ProtoType =
  | { kind: 'scalar'; type: ProtoScalar }
  | { kind: 'enum'; name: string }
  | { kind: 'message'; name: string }
  | { kind: 'map'; key: ProtoScalar; value: ProtoType };

/** Field definition in the protobuf schema intermediate representation. */
export interface ProtoField {
  name: string;
  number: number;
  type: ProtoType;
  repeated: boolean;
  optional: boolean;
  /** The comment on the field. */
  comment: string;
  /** Proto `oneof` this field belongs to. */
  oneof?: string;
  /** Discriminator literal that selects this oneof arm. */
  discriminatorValue?: string;
}

/** Message definition in the protobuf schema intermediate representation. */
export interface ProtoMessage {
  name: string;
  fields: ProtoField[];
  subMessages?: ProtoMessage[];
  /** The comment on the proto. */
  comment: string;
  /** JS/Zod key reconstructed from a discriminated-union oneof. */
  discriminator?: string;
}

/** Enum definition in the protobuf schema intermediate representation. */
export interface ProtoEnum {
  name: string;
  values: { name: string; number: number }[];
  /** The comment on the enum. */
  comment: string;
}

export type ProcedureType = 'query' | 'mutation' | 'subscription';

/** RPC method translated from a tRPC procedure. */
export interface ProtoMethod {
  /** gRPC method name, e.g. `GetById`. */
  name: string;
  /** tRPC procedure path, e.g. `user.getById`. */
  path: string;
  type: ProcedureType;
  requestType: string;
  responseType: string;
  /** Supports server-side streaming. */
  isResponseStreaming: boolean;
}

/** gRPC service containing translated tRPC procedures. */
export interface ProtoService {
  name: string;
  methods: ProtoMethod[];
}

/** Per-property generation cache: stable tag + original proto type. */
export interface PropertyGenCache {
  /** Assigned proto field number for this property. */
  tag?: number;
  /** Original proto type (e.g. string, int32, User). */
  type?: string;
  /** Nested message fields. */
  propertyGenCache: Record<string, PropertyGenCache>;
  /** Field number → property name, so numbers are not reused. */
  usedIds: Record<number, string>;
}

/** Stable field-allocation cache retained between schema generations. */
export interface SchemaGenerateCache {
  propertyGenCache: Record<string, PropertyGenCache>;
}

/** Only proto3 is supported. */
export type ProtoSyntax = 'proto3';

/** File-level `option` names as they appear in .proto. */
export interface ProtoFileOptions {
  java_package?: string;
  java_outer_classname?: string;
  java_multiple_files?: boolean;
  go_package?: string;
  csharp_namespace?: string;
  objc_class_prefix?: string;
  php_namespace?: string;
  php_metadata_namespace?: string;
  ruby_package?: string;
  swift_prefix?: string;
  cc_enable_arenas?: boolean;
  optimize_for?: 'SPEED' | 'CODE_SIZE' | 'LITE_RUNTIME';
  [option: string]: string | boolean | number | undefined;
}

/** Package, syntax, generated schema path, and file options read from router metadata. */
export interface ProtoFileHeader {
  package?: string;
  /** Defaults to proto3 when omitted. */
  syntax?: ProtoSyntax;
  /** Path to the generated runtime schema and field-assignment cache module. */
  schemaPath?: string;
  /** @deprecated Use `schemaPath`. */
  cache?: string;
  options?: ProtoFileOptions;
}

/**
 * tRPC meta fragment. `proto.package` is required. Omitted `syntax` is proto3.
 * `schemaPath` is optional. Merge with other global meta:
 * `initTRPC.meta<ProtoMeta & OtherMeta>().create({ defaultMeta: { proto: {...}, ... } })`
 */
export interface ProtoMeta {
  proto?: ProtoFileHeader;
}

/**
 * Zod `.meta()` keys this translator reads.
 */
export interface ProtoObjectMeta {
  protoMessageName?: string;
  protoEnumName?: string;
  protoUseKnownType?: string;
}

/** Complete protobuf schema intermediate representation. */
export interface ProtoSchema {
  syntax: ProtoSyntax;
  package: string;
  options?: ProtoFileOptions;
  services: ProtoService[];
  messages: ProtoMessage[];
  enums: ProtoEnum[];
  generateCache?: SchemaGenerateCache;
}
