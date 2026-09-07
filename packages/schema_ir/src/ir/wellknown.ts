/** Fully-qualified well-known type → proto import path. */
export const WELL_KNOWN_IMPORTS: Record<string, string> = {
  'google.protobuf.Any': 'google/protobuf/any.proto',
  'google.protobuf.Api': 'google/protobuf/api.proto',
  'google.protobuf.Method': 'google/protobuf/api.proto',
  'google.protobuf.Mixin': 'google/protobuf/api.proto',
  'google.protobuf.Duration': 'google/protobuf/duration.proto',
  'google.protobuf.Empty': 'google/protobuf/empty.proto',
  'google.protobuf.FieldMask': 'google/protobuf/field_mask.proto',
  'google.protobuf.Struct': 'google/protobuf/struct.proto',
  'google.protobuf.Value': 'google/protobuf/struct.proto',
  'google.protobuf.ListValue': 'google/protobuf/struct.proto',
  'google.protobuf.NullValue': 'google/protobuf/struct.proto',
  'google.protobuf.Timestamp': 'google/protobuf/timestamp.proto',
  'google.protobuf.Type': 'google/protobuf/type.proto',
  'google.protobuf.Field': 'google/protobuf/type.proto',
  'google.protobuf.Field.Kind': 'google/protobuf/type.proto',
  'google.protobuf.Field.Cardinality': 'google/protobuf/type.proto',
  'google.protobuf.Enum': 'google/protobuf/type.proto',
  'google.protobuf.EnumValue': 'google/protobuf/type.proto',
  'google.protobuf.Option': 'google/protobuf/type.proto',
  'google.protobuf.Syntax': 'google/protobuf/type.proto',
  'google.protobuf.SourceContext': 'google/protobuf/source_context.proto',
  'google.protobuf.DoubleValue': 'google/protobuf/wrappers.proto',
  'google.protobuf.FloatValue': 'google/protobuf/wrappers.proto',
  'google.protobuf.Int32Value': 'google/protobuf/wrappers.proto',
  'google.protobuf.Int64Value': 'google/protobuf/wrappers.proto',
  'google.protobuf.UInt32Value': 'google/protobuf/wrappers.proto',
  'google.protobuf.UInt64Value': 'google/protobuf/wrappers.proto',
  'google.protobuf.BoolValue': 'google/protobuf/wrappers.proto',
  'google.protobuf.StringValue': 'google/protobuf/wrappers.proto',
  'google.protobuf.BytesValue': 'google/protobuf/wrappers.proto',
};

export function isWellKnownType(name: string): boolean {
  return Object.hasOwn(WELL_KNOWN_IMPORTS, name);
}

const WELL_KNOWN_ENUMS = new Set([
  'google.protobuf.NullValue',
  'google.protobuf.Syntax',
  'google.protobuf.Field.Kind',
  'google.protobuf.Field.Cardinality',
]);

export function wellKnownKind(name: string): 'enum' | 'message' {
  return WELL_KNOWN_ENUMS.has(name) ? 'enum' : 'message';
}

export function wellKnownImport(name: string): string | undefined {
  return WELL_KNOWN_IMPORTS[name];
}

/** gRPC service name: always `FooService`, never double-suffix. */
export function protoServiceName(name: string): string {
  return name.endsWith('Service') ? name : `${name}Service`;
}
