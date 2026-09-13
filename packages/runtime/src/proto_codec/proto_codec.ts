import protobuf from 'protobufjs';
import { toCamel, toPascalCase } from '@trpc-proto/utility';

import {
  protoServiceName,
  type ProtoMessage,
  type ProtoSchema,
  type ProtoType,
} from '@trpc-proto/schema_ir';

const DEFAULT_SERVICE_NAME = 'AppService';

/** Reflected protobuf RPC used by transports. */
export interface RuntimeProtoRpc {
  readonly service: string;
  readonly method: RuntimeProtoMethod;
}

/** Reflected protobuf method metadata used by transports. */
export interface RuntimeProtoMethod {
  readonly name: string;
  readonly requestType: string;
  readonly responseType: string;
  readonly responseStream?: boolean;
}

function fieldTypeName(type: ProtoType): string {
  if (type.kind === 'scalar') return type.type;
  if (type.kind === 'map') {
    throw new Error('map types use MapField');
  }
  return type.name;
}
function definePath(root: protobuf.Root, pkg: string) {
  let ns: protobuf.Namespace = root;
  for (const part of pkg.split('.').filter(Boolean)) {
    ns = ns.define(part);
  }
  return ns;
}

function addWellKnown(root: protobuf.Root) {
  const google = root.define('google').define('protobuf');
  function add(name: string, fields: protobuf.Field[]) {
    if (google.get(name)) return;
    const type = new protobuf.Type(name);
    for (const field of fields) type.add(field);
    google.add(type);
  }
  add('Empty', []);
  add('Timestamp', [
    new protobuf.Field('seconds', 1, 'int64'),
    new protobuf.Field('nanos', 2, 'int32'),
  ]);
  add('Duration', [
    new protobuf.Field('seconds', 1, 'int64'),
    new protobuf.Field('nanos', 2, 'int32'),
  ]);
  add('FieldMask', [new protobuf.Field('paths', 1, 'string', 'repeated')]);
  const wrappers: Array<[string, string]> = [
    ['DoubleValue', 'double'],
    ['FloatValue', 'float'],
    ['Int32Value', 'int32'],
    ['Int64Value', 'int64'],
    ['UInt32Value', 'uint32'],
    ['UInt64Value', 'uint64'],
    ['BoolValue', 'bool'],
    ['StringValue', 'string'],
    ['BytesValue', 'bytes'],
  ];
  for (const [name, type] of wrappers) {
    add(name, [new protobuf.Field('value', 1, type)]);
  }
}

function addMessageType(
  ns: protobuf.Namespace,
  message: ProtoMessage,
): protobuf.Type {
  const type = new protobuf.Type(message.name);
  for (const nested of message.subMessages ?? []) {
    addMessageType(type, nested);
  }
  const oneofs = new Map<string, protobuf.OneOf>();
  for (const field of message.fields) {
    if (field.type.kind === 'map') {
      type.add(
        new protobuf.MapField(
          field.name,
          field.number,
          field.type.key,
          fieldTypeName(field.type.value),
        ),
      );
      continue;
    }
    const rule = field.repeated ? 'repeated' : 'optional';
    const pbField = new protobuf.Field(
      field.name,
      field.number,
      fieldTypeName(field.type),
      rule,
    );
    type.add(pbField);
    if (field.oneof) {
      let oneof = oneofs.get(field.oneof);
      if (!oneof) {
        oneof = new protobuf.OneOf(field.oneof);
        type.add(oneof);
        oneofs.set(field.oneof, oneof);
      }
      oneof.add(pbField);
    }
  }
  ns.add(type);
  return type;
}

function buildRoot(schema: ProtoSchema): protobuf.Root {
  const root = new protobuf.Root();
  addWellKnown(root);
  const ns = definePath(root, schema.package);
  for (const en of schema.enums) {
    const created = new protobuf.Enum(en.name);
    for (const value of en.values) created.add(value.name, value.number);
    ns.add(created);
  }
  for (const message of schema.messages) {
    addMessageType(ns, message);
  }
  for (const service of schema.services) {
    const created = new protobuf.Service(service.name);
    for (const method of service.methods) {
      const reflected = new protobuf.Method(
        method.name,
        'rpc',
        method.requestType,
        method.responseType,
        false,
        method.isResponseStreaming,
      );
      created.add(reflected);
    }
    ns.add(created);
  }
  root.resolveAll();
  return root;
}

function lookupType(root: protobuf.Root, schema: ProtoSchema, name: string) {
  if (name.startsWith('google.protobuf.')) return root.lookupType(name);
  return root.lookupType(`${schema.package}.${name}`) ?? root.lookupType(name);
}

function lookupRootMethod(
  root: protobuf.Root,
  schema: ProtoSchema,
  serviceName: string,
  methodName: string,
): protobuf.Method | undefined {
  const service = root.lookup(
    `${schema.package}.${serviceName}`,
    protobuf.Service,
  ) as protobuf.Service | null;
  return service?.methods[methodName];
}

function lookupRootRpc(
  root: protobuf.Root,
  schema: ProtoSchema,
  path: string,
): RuntimeProtoRpc | undefined {
  const parts = path.split('.');
  const methodName = toPascalCase(parts.pop() ?? path);
  const service =
    parts.length === 0
      ? DEFAULT_SERVICE_NAME
      : protoServiceName(parts.map(toPascalCase).join(''));
  const method = lookupRootMethod(root, schema, service, methodName);
  return method ? { service, method } : undefined;
}

function isWrapper(message: ProtoMessage) {
  return message.fields.length === 1 && message.fields[0]?.name === 'value';
}

function findMessage(
  messages: ProtoMessage[] | undefined,
  name: string,
): ProtoMessage | undefined {
  if (!messages) return undefined;
  for (const message of messages) {
    if (message.name === name) return message;
    const nested = findMessage(message.subMessages, name);
    if (nested) return nested;
  }
  return undefined;
}

function resolveMessage(
  schema: ProtoSchema,
  name: string,
  scope?: ProtoMessage,
): ProtoMessage | undefined {
  if (scope) {
    if (scope.name === name) return scope;
    const nested = findMessage(scope.subMessages, name);
    if (nested) return nested;
  }
  return findMessage(schema.messages, name);
}

function dateToTimestamp(value: Date) {
  const ms = value.getTime();
  return {
    seconds: Math.floor(ms / 1000),
    nanos: (ms % 1000) * 1e6,
  };
}

function timestampToDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (!value || typeof value !== 'object') return new Date(NaN);
  const rec = value as { seconds?: string | number; nanos?: number };
  return new Date(
    Number(rec.seconds ?? 0) * 1000 + Number(rec.nanos ?? 0) / 1e6,
  );
}

function toProtoValue(
  schema: ProtoSchema,
  type: ProtoType,
  value: unknown,
  scope?: ProtoMessage,
): unknown {
  if (value == null) return value;
  if (
    type.kind === 'scalar' &&
    (type.type === 'int64' || type.type === 'uint64' || type.type === 'sint64')
  ) {
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if (type.kind === 'message' && type.name === 'google.protobuf.Timestamp') {
    return value instanceof Date ? dateToTimestamp(value) : value;
  }
  if (type.kind === 'message') {
    return toProtoObject(schema, type.name, value, scope);
  }
  if (type.kind === 'map' && value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = toProtoValue(schema, type.value, item, scope);
    }
    return out;
  }
  return value;
}

function fromProtoValue(
  schema: ProtoSchema,
  type: ProtoType,
  value: unknown,
  scope?: ProtoMessage,
): unknown {
  if (value == null) return value;
  if (
    type.kind === 'scalar' &&
    (type.type === 'int64' || type.type === 'sint64')
  ) {
    return typeof value === 'bigint' ? value : BigInt(String(value));
  }
  if (type.kind === 'message' && type.name === 'google.protobuf.Timestamp') {
    return timestampToDate(value);
  }
  if (type.kind === 'message') {
    return fromProtoObject(schema, type.name, value, scope);
  }
  if (type.kind === 'map' && value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = fromProtoValue(schema, type.value, item, scope);
    }
    return out;
  }
  return value;
}

function toProtoObject(
  schema: ProtoSchema,
  name: string,
  value: unknown,
  scope?: ProtoMessage,
): unknown {
  if (name === 'google.protobuf.Empty') return {};
  if (name === 'google.protobuf.Timestamp') {
    return value instanceof Date ? dateToTimestamp(value) : value;
  }
  const message = resolveMessage(schema, name, scope);
  if (!message) return value;
  let payload = value;
  if (
    isWrapper(message) &&
    (payload == null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      payload instanceof Date)
  ) {
    payload = { value: payload };
  }
  if (!payload || typeof payload !== 'object') return payload;
  const src = payload as Record<string, unknown>;
  if (message.discriminator) {
    const tag = src[message.discriminator];
    const arm = message.fields.find(
      (field) =>
        field.discriminatorValue === tag ||
        field.name === tag ||
        toCamel(field.name) === tag,
    );
    if (!arm || arm.type.kind !== 'message') return {};
    const rest: Record<string, unknown> = { ...src };
    delete rest[message.discriminator];
    return {
      [arm.name]: toProtoObject(schema, arm.type.name, rest, message),
    };
  }
  const out: Record<string, unknown> = {};
  for (const field of message.fields) {
    const raw = src[field.name] ?? src[toCamel(field.name)];
    if (raw === undefined) continue;
    if (field.repeated && Array.isArray(raw)) {
      out[field.name] = raw.map((item) =>
        toProtoValue(schema, field.type, item, message),
      );
    } else {
      out[field.name] = toProtoValue(schema, field.type, raw, message);
    }
  }
  return out;
}

function fromProtoObject(
  schema: ProtoSchema,
  name: string,
  value: unknown,
  scope?: ProtoMessage,
): unknown {
  if (name === 'google.protobuf.Empty') return {};
  if (name === 'google.protobuf.Timestamp') return timestampToDate(value);
  const message = resolveMessage(schema, name, scope);
  if (!message || !value || typeof value !== 'object') return value;
  const src = value as Record<string, unknown>;
  if (message.discriminator) {
    for (const field of message.fields) {
      const raw = src[field.name] ?? src[toCamel(field.name)];
      if (raw === undefined || raw === null) continue;
      const decoded = fromProtoValue(schema, field.type, raw, message);
      const rest =
        decoded && typeof decoded === 'object' && !Array.isArray(decoded)
          ? (decoded as Record<string, unknown>)
          : {};
      return {
        [message.discriminator]: field.discriminatorValue ?? field.name,
        ...rest,
      };
    }
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const field of message.fields) {
    const raw = src[field.name] ?? src[toCamel(field.name)];
    if (raw === undefined) continue;
    const key = toCamel(field.name);
    if (field.repeated && Array.isArray(raw)) {
      out[key] = raw.map((item) =>
        fromProtoValue(schema, field.type, item, message),
      );
    } else {
      out[key] = fromProtoValue(schema, field.type, raw, message);
    }
  }
  if (isWrapper(message)) return out.value;
  return out;
}

/** Runtime protobuf encoder, decoder, and RPC registry. */
export class ProtoCodec {
  readonly #root: protobuf.Root;

  constructor(readonly schema: ProtoSchema) {
    this.#root = buildRoot(schema);
  }

  lookupRpc(path: string): RuntimeProtoRpc | undefined {
    return lookupRootRpc(this.#root, this.schema, path);
  }

  lookupMethod(
    serviceName: string,
    methodName: string,
  ): RuntimeProtoMethod | undefined {
    return lookupRootMethod(this.#root, this.schema, serviceName, methodName);
  }

  encode(messageName: string, value: unknown): Uint8Array {
    const type = lookupType(this.#root, this.schema, messageName);
    const prepared = toProtoObject(this.schema, messageName, value);
    return type.encode(type.fromObject(prepared ?? {})).finish();
  }

  decode(messageName: string, bytes: Uint8Array): unknown {
    const type = lookupType(this.#root, this.schema, messageName);
    const raw = type.toObject(type.decode(bytes), {
      defaults: false,
      arrays: true,
      objects: true,
      enums: String,
      longs: String,
      bytes: Uint8Array,
    });
    return fromProtoObject(this.schema, messageName, raw);
  }
}
