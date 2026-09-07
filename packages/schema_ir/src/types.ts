/**
 * Intermediate representation emitted by `@trpc-proto/plugin` (`schema.json`)
 * and consumed by `@trpc-proto/runtime`.
 */

export type ProtoScalar =
  | "double"
  | "float"
  | "int32"
  | "int64"
  | "uint32"
  | "uint64"
  | "sint32"
  | "sint64"
  | "fixed32"
  | "fixed64"
  | "sfixed32"
  | "sfixed64"
  | "bool"
  | "string"
  | "bytes";

export type ProtoType =
  | { kind: "scalar"; type: ProtoScalar }
  | { kind: "enum"; name: string }
  | { kind: "message"; name: string }
  | { kind: "map"; key: ProtoScalar; value: ProtoType };

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

export interface ProtoMessage {
  name: string;
  fields: ProtoField[];
  subMessages?: ProtoMessage[];
  /** The comment on the proto. */
  comment: string;
  /** JS/Zod key reconstructed from a discriminated-union oneof. */
  discriminator?: string;
}

export interface ProtoEnum {
  name: string;
  values: { name: string; number: number }[];
  /** The comment on the enum. */
  comment: string;
}

export type ProcedureType = "query" | "mutation" | "subscription";

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

export interface SchemaGenerateCache {
  propertyGenCache: Record<string, PropertyGenCache>;
}

/** Only proto3 is supported. */
export type ProtoSyntax = "proto3";

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
  optimize_for?: "SPEED" | "CODE_SIZE" | "LITE_RUNTIME";
  [option: string]: string | boolean | number | undefined;
}

export interface ProtoFileHeader {
  package?: string;
  /** Defaults to proto3 when omitted. */
  syntax?: ProtoSyntax;
  /** Path to schema/cache JSON (read on generate, written after). */
  cache?: string;
  options?: ProtoFileOptions;
}

/**
 * tRPC meta fragment. `proto.package` is required. Omitted `syntax` is proto3.
 * `cache` is optional. Merge with other global meta:
 * `initTRPC.meta<ProtoMeta & OtherMeta>().create({ defaultMeta: { proto: {...}, ... } })`
 */
export interface ProtoMeta {
  proto?: ProtoFileHeader;
}

/**
 * Zod object metadata fragment.
 */
export interface ProtoObjectMeta {
  protoMessageName?: string;
  protoUseKnownType?: string;
}

export interface ProtoSchema {
  syntax: ProtoSyntax;
  package: string;
  options?: ProtoFileOptions;
  services: ProtoService[];
  messages: ProtoMessage[];
  enums: ProtoEnum[];
  generateCache?: SchemaGenerateCache;
}
