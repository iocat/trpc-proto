import type { AnyProcedure, AnyRouter } from '@trpc/server';
import type { ZodType } from 'zod';
import {
  assumeExhaustive,
  assumeExhaustiveAllowing,
  toPascalCase,
  toSnakeCase,
} from '@trpc-proto/utility';

import { createFieldAllocator } from './field_allocator.js';
import { assertPrevalidate, prevalidate } from '../validate/prevalidate.js';
import {
  isWellKnownType,
  protoServiceName,
  wellKnownKind,
} from '../ir/wellknown.js';
import { asRuntime, type ZodRuntime } from './zod_node.js';
import { asyncIterableYieldSchema } from '../zod/async_iterable.js';

import type {
  ProcedureType,
  PropertyGenCache,
  ProtoEnum,
  ProtoField,
  ProtoFileHeader,
  ProtoMessage,
  ProtoMeta,
  ProtoMethod,
  ProtoObjectMeta,
  ProtoScalar,
  ProtoSchema,
  ProtoService,
  ProtoType,
  SchemaGenerateCache,
} from '../ir/types.js';

/** Overrides applied while translating tRPC procedures into protobuf schema. */
export interface TranslateOptions {
  proto?: ProtoMeta['proto'];
  packageName?: string;
  generateCache?: SchemaGenerateCache;
}

/** Runtime tRPC procedure and its input and output Zod schemas. */
export interface RuntimeProcedure {
  path: string;
  type: ProcedureType;
  /** Zod 4 schema from `.input()`, if the procedure set one. */
  input?: ZodType;
  /** Zod 4 schema from `.output()`, if the procedure set one. */
  output?: ZodType;
}

class TrpcSchemaTranslator {
  #messages: ProtoMessage[] = [];
  #enums: ProtoEnum[] = [];
  #cache: SchemaGenerateCache;
  #seenMessages = new WeakMap<ZodType, string>();
  #seenEnums = new WeakMap<ZodType, string>();

  constructor(cache: SchemaGenerateCache) {
    this.#cache = cache;
  }

  #messageName(zod: ZodRuntime, fallback: string): string {
    const cached = this.#seenMessages.get(zod);
    if (cached) return cached;
    const wellKnown = protoUseKnownTypeOf(zod);
    if (wellKnown) {
      this.#seenMessages.set(zod, wellKnown);
      return wellKnown;
    }
    const named = protoMessageNameOf(zod);
    if (named && toPascalCase(named) !== named) {
      throw new Error(
        `protoMessageName must be PascalCase, expected ${toPascalCase(named)}, got ${named}`,
      );
    }
    const name = toPascalCase(named ?? fallback);
    this.#seenMessages.set(zod, name);
    return name;
  }

  #enumName(zod: ZodRuntime): string | undefined {
    const named = protoEnumNameOf(zod);
    if (named && toPascalCase(named) !== named) {
      throw new Error(
        `protoEnumName must be PascalCase, expected ${toPascalCase(named)}, got ${named}`,
      );
    }
    return named;
  }

  #convertObject(
    zod: ZodRuntime,
    messageName: string,
    hoist = true,
    cacheName = messageName,
  ): ProtoMessage {
    if (hoist) {
      const existing = this.#messages.find(
        (message) => message.name === messageName,
      );
      if (existing) return existing;
    }

    const cache = messageCache(this.#cache, cacheName);
    const assignments: Record<string, number> = {};
    for (const [name, child] of Object.entries(cache.propertyGenCache)) {
      if (child.tag !== undefined) assignments[name] = child.tag;
    }
    for (const [id, name] of Object.entries(cache.usedIds)) {
      assignments[name] ??= Number(id);
    }
    const allocator = createFieldAllocator(assignments);

    const fields: ProtoField[] = [];
    const subMessages: ProtoMessage[] = [];
    for (const [key, value] of Object.entries(objectShape(zod))) {
      const fieldName = toSnakeCase(key);
      const mapped = this.#mapField(value, messageName, fieldName, subMessages);
      const existingField = cache.propertyGenCache[fieldName];
      const number =
        existingField?.tag !== undefined
          ? existingField.tag
          : allocator.next().value;
      cache.usedIds[number] = fieldName;
      cache.propertyGenCache[fieldName] = {
        tag: number,
        type: protoTypeName(mapped.type),
        propertyGenCache: existingField?.propertyGenCache ?? {},
        usedIds: existingField?.usedIds ?? {},
      };
      fields.push({
        name: fieldName,
        number,
        type: mapped.type,
        repeated: mapped.repeated,
        optional: true,
        comment: zodComment(value),
      });
    }

    const message: ProtoMessage = {
      name: messageName,
      fields,
      subMessages,
      comment: zodComment(zod),
    };
    if (hoist) this.#messages.push(message);
    return message;
  }

  #convertDiscriminatedUnion(
    zod: ZodRuntime,
    messageName: string,
    discriminator: string,
    hoist = true,
    cacheName = messageName,
  ): ProtoMessage {
    if (hoist) {
      const existing = this.#messages.find(
        (message) => message.name === messageName,
      );
      if (existing) return existing;
    }
    const cache = messageCache(this.#cache, cacheName);
    const assignments: Record<string, number> = {};
    for (const [name, child] of Object.entries(cache.propertyGenCache)) {
      if (child.tag !== undefined) assignments[name] = child.tag;
    }
    for (const [id, name] of Object.entries(cache.usedIds)) {
      assignments[name] ??= Number(id);
    }
    const allocator = createFieldAllocator(assignments);
    const fields: ProtoField[] = [];
    const subMessages: ProtoMessage[] = [];
    const oneof = toSnakeCase(discriminator);
    const seen = new Set<string>();
    for (const option of zod.def.options ?? []) {
      const arm = unwrap(option).inner;
      if (arm.type !== 'object') {
        throw new Error(
          `discriminatedUnion "${discriminator}" arms must be objects at ${messageName}`,
        );
      }
      const tagField = objectShape(arm)[discriminator];
      const tag = tagField ? stringLiteral(unwrap(tagField).inner) : undefined;
      if (!tag) {
        throw new Error(
          `discriminatedUnion "${discriminator}" requires every arm to define "${discriminator}" as a unique string literal at ${messageName}. ` +
            `Example: z.object({ ${JSON.stringify(discriminator)}: z.literal('success'), value: z.string() })`,
        );
      }
      const nestedName = toPascalCase(tag);
      if (seen.has(nestedName)) {
        throw new Error(
          `discriminatedUnion duplicate arm "${tag}" at ${messageName}`,
        );
      }
      seen.add(nestedName);
      const variant = this.#convertObject(
        omitShapeKey(arm, discriminator),
        nestedName,
        false,
        `${cacheName}.${nestedName}`,
      );
      subMessages.push(variant);
      const fieldName = toSnakeCase(tag);
      const existingField = cache.propertyGenCache[fieldName];
      const number =
        existingField?.tag !== undefined
          ? existingField.tag
          : allocator.next().value;
      cache.usedIds[number] = fieldName;
      cache.propertyGenCache[fieldName] = {
        tag: number,
        type: nestedName,
        propertyGenCache: existingField?.propertyGenCache ?? {},
        usedIds: existingField?.usedIds ?? {},
      };
      fields.push({
        name: fieldName,
        number,
        type: { kind: 'message', name: nestedName },
        repeated: false,
        optional: false,
        comment: zodComment(option),
        oneof,
        discriminatorValue: tag,
      });
    }
    const message: ProtoMessage = {
      name: messageName,
      fields,
      subMessages,
      comment: zodComment(zod),
      discriminator,
    };
    if (hoist) this.#messages.push(message);
    return message;
  }

  #convertEnum(zod: ZodRuntime, synthesizedName: string): ProtoType {
    const cached = this.#seenEnums.get(zod);
    if (cached) return { kind: 'enum', name: cached };
    const name = this.#enumName(zod) ?? toPascalCase(synthesizedName);
    this.#seenEnums.set(zod, name);

    if (!this.#enums.some((en) => en.name === name)) {
      const entries = zod.def.entries ?? {};
      let values = Object.keys(entries).map((valueName, index) => ({
        name: valueName,
        number: index,
      }));
      if (values.length === 0 && zod.type === 'union') {
        const names = (zod.def.options ?? []).flatMap((option) => {
          const inner = unwrap(option).inner;
          return (inner.def.values ?? []).map((value) => String(value));
        });
        values = names.map((valueName, index) => ({
          name: valueName,
          number: index,
        }));
      }
      this.#enums.push({ name, values, comment: zodComment(zod) });
    }
    return { kind: 'enum', name };
  }

  #mapField(
    zod: ZodType,
    parentMessage: string,
    fieldName: string,
    nested: ProtoMessage[] = [],
  ): { type: ProtoType; repeated: boolean; message?: ProtoMessage } {
    const inner = unwrap(zod).inner;
    switch (inner.type) {
      case 'array':
      case 'set': {
        const element = asRuntime(inner.element ?? inner.def.element ?? inner);
        const mapped = this.#mapField(
          element,
          parentMessage,
          fieldName,
          nested,
        );
        return { ...mapped, repeated: true };
      }
      case 'object': {
        const known = protoUseKnownTypeOf(inner);
        if (known) {
          return {
            type: { kind: wellKnownKind(known), name: known },
            repeated: false,
          };
        }

        const named = protoMessageNameOf(inner);
        if (named) {
          const name = this.#messageName(inner, named);
          this.#convertObject(inner, name, true);
          return { type: { kind: 'message', name }, repeated: false };
        }
        const nestedName = toPascalCase(fieldName);
        const message = this.#convertObject(
          inner,
          nestedName,
          /* hoisted= */ false,
          `${parentMessage}.${nestedName}`,
        );
        nested.push(message);

        return {
          type: { kind: 'message', name: nestedName },
          repeated: false,
          message,
        };
      }
      case 'enum':
        return {
          type: this.#convertEnum(
            inner,
            `${parentMessage}${toPascalCase(fieldName)}`,
          ),
          repeated: false,
        };
      case 'record':
      case 'map': {
        const valueType = inner.def.valueType ?? inner;
        const valueInner = unwrap(valueType).inner;
        if (valueInner.type === 'any' || valueInner.type === 'unknown') {
          return {
            type: { kind: 'message', name: 'google.protobuf.Struct' },
            repeated: false,
          };
        }
        const key = mapKeyScalar(inner.def.keyType ?? inner);
        const value = this.#mapField(
          valueType,
          parentMessage,
          fieldName,
          nested,
        );
        return {
          type: { kind: 'map', key, value: value.type },
          repeated: false,
        };
      }
      case 'tuple': {
        const nestedName = toPascalCase(fieldName);
        const items = (inner.def as { items?: ZodType[] }).items ?? [];
        const fakeShape: Record<string, ZodType> = {};
        items.forEach((item, index) => {
          fakeShape[`f${index}`] = item;
        });
        const message = this.#convertObject(
          { ...inner, type: 'object', def: { ...inner.def, shape: fakeShape } },
          nestedName,
          false,
          `${parentMessage}.${nestedName}`,
        );
        nested.push(message);
        return {
          type: { kind: 'message', name: nestedName },
          repeated: false,
          message,
        };
      }
      case 'intersection': {
        const left = asRuntime(inner.def.left ?? inner);
        const right = asRuntime(inner.def.right ?? inner);
        if (left.type === 'object' && right.type === 'object') {
          const named = protoMessageNameOf(inner);

          const merged = {
            ...left,
            def: {
              ...left.def,
              shape: { ...objectShape(left), ...objectShape(right) },
            },
            shape: { ...objectShape(left), ...objectShape(right) },
          };
          if (named) {
            const name = this.#messageName(inner, named);
            this.#convertObject(merged, name, true);
            return { type: { kind: 'message', name }, repeated: false };
          }
          const nestedName = toPascalCase(fieldName);
          const message = this.#convertObject(
            merged,
            nestedName,
            false,
            `${parentMessage}.${nestedName}`,
          );
          nested.push(message);
          return {
            type: { kind: 'message', name: nestedName },
            repeated: false,
            message,
          };
        }
        assumeExhaustiveAllowing<'intersection', typeof inner.type>(inner.type);

        throw new Error(
          `Unsupported Zod type "${inner.type}" at ${parentMessage}.${fieldName}`,
        );
      }
      case 'union': {
        const discriminator = unionDiscriminator(inner);
        if (discriminator) {
          const named = protoMessageNameOf(inner);

          if (named) {
            const name = this.#messageName(inner, named);
            this.#convertDiscriminatedUnion(inner, name, discriminator, true);
            return { type: { kind: 'message', name }, repeated: false };
          }
          const nestedName = toPascalCase(fieldName);
          const message = this.#convertDiscriminatedUnion(
            inner,
            nestedName,
            discriminator,
            false,
            `${parentMessage}.${nestedName}`,
          );
          nested.push(message);
          return {
            type: { kind: 'message', name: nestedName },
            repeated: false,
            message,
          };
        }
        const options = (inner.def.options ?? []).map(
          (option) => unwrap(option).inner,
        );
        const meaningful = options.filter((option) => !isEmptyType(option));
        if (meaningful.length === 1 && meaningful[0]) {
          return this.#mapField(
            meaningful[0],
            parentMessage,
            fieldName,
            nested,
          );
        }
        if (
          meaningful.length > 0 &&
          meaningful.every((option) => option.type === 'literal')
        ) {
          return {
            type: this.#convertEnum(
              inner,
              `${parentMessage}${toPascalCase(fieldName)}`,
            ),
            repeated: false,
          };
        }
        assumeExhaustiveAllowing<'union', typeof inner.type>(inner.type);

        throw new Error(
          `Unsupported Zod type "${inner.type}" at ${parentMessage}.${fieldName}`,
        );
      }
      case 'literal':
        return { type: mapLiteral(inner), repeated: false };
      default: {
        assumeExhaustiveAllowing<typeof inner.type, typeof inner.type>(
          inner.type,
        );

        const scalar = mapScalar(inner);
        if (scalar) return { type: scalar, repeated: false };
        throw new Error(
          `Unsupported Zod type "${inner.type}" at ${parentMessage}.${fieldName}`,
        );
      }
    }
  }

  #wrapScalar(messageName: string, zod: ZodType): string {
    const existing = this.#messages.find(
      (message) => message.name === messageName,
    );
    if (existing) return messageName;
    const mapped = this.#mapField(zod, messageName, 'value');
    const cache = messageCache(this.#cache, messageName);
    const assignments: Record<string, number> = {};
    if (cache.propertyGenCache.value?.tag !== undefined) {
      assignments.value = cache.propertyGenCache.value.tag;
    }
    const allocator = createFieldAllocator(assignments);
    const existingTag = cache.propertyGenCache.value?.tag;
    const number =
      existingTag !== undefined ? existingTag : allocator.next().value;
    cache.usedIds[number] = 'value';
    cache.propertyGenCache.value = {
      tag: number,
      type: protoTypeName(mapped.type),
      propertyGenCache: {},
      usedIds: {},
    };
    this.#messages.push({
      name: messageName,
      fields: [
        {
          name: 'value',
          number,
          type: mapped.type,
          repeated: mapped.repeated,
          optional: true,
          comment: zodComment(zod),
        },
      ],
      subMessages: [],
      comment: zodComment(zod),
    });
    return messageName;
  }

  #rpcMessageType(zod: ZodType | undefined, fallbackName: string): string {
    if (!zod) return 'google.protobuf.Empty';
    const { inner } = unwrap(zod);
    if (isEmptyType(inner)) return 'google.protobuf.Empty';
    const known = protoUseKnownTypeOf(inner);
    if (known) return known;

    if (inner.type === 'object') {
      const name = this.#messageName(inner, fallbackName);
      this.#convertObject(inner, name);
      return name;
    }
    const discriminator = unionDiscriminator(inner);
    if (inner.type === 'union' && discriminator) {
      const name = this.#messageName(inner, fallbackName);
      this.#convertDiscriminatedUnion(inner, name, discriminator, true);
      return name;
    }
    assumeExhaustiveAllowing<typeof inner.type, typeof inner.type>(inner.type);

    const mapped =
      inner.type === 'literal' ? mapLiteral(inner) : mapScalar(inner);
    if (
      mapped &&
      (mapped.kind === 'message' || mapped.kind === 'enum') &&
      isWellKnownType(mapped.name)
    ) {
      return mapped.name;
    }
    this.#wrapScalar(fallbackName, zod);
    return fallbackName;
  }

  run(procedures: RuntimeProcedure[]): {
    services: Map<string, ProtoMethod[]>;
    messages: ProtoMessage[];
    enums: ProtoEnum[];
    generateCache: SchemaGenerateCache;
  } {
    const services = new Map<string, ProtoMethod[]>();
    for (const procedure of procedures) {
      const service = serviceName(procedure.path);
      const method = methodName(procedure.path);
      const requestType = this.#rpcMessageType(
        procedure.input,
        `${service}${method}Request`,
      );
      const output =
        procedure.type === 'subscription'
          ? (asyncIterableYieldSchema(procedure.output) ?? procedure.output)
          : procedure.output;
      const responseType = this.#rpcMessageType(
        output,
        `${service}${method}Response`,
      );
      const methods = services.get(service) ?? [];
      methods.push({
        name: method,
        path: procedure.path,
        type: procedure.type,
        requestType,
        responseType,
        // Server-side streaming only. No client-stream or bidi.
        isResponseStreaming: procedure.type === 'subscription',
      });
      services.set(service, methods);
    }
    return {
      services,
      messages: this.#messages,
      enums: this.#enums,
      generateCache: this.#cache,
    };
  }
}

export function listProcedures(router: AnyRouter): RuntimeProcedure[] {
  return Object.entries(router._def.procedures).flatMap(([path, value]) => {
    if (!isProcedure(value)) return [];
    return [
      {
        path,
        type: value._def.type,
        input: procedureInput(value, path),
        output: procedureOutput(value, path),
      },
    ];
  });
}

/** File header from `initTRPC.meta<ProtoMeta>().create({ defaultMeta })`. */
export function protoMetaFromRouter(router: AnyRouter): ProtoMeta {
  const config = (router._def as { _config?: { defaultMeta?: unknown } })
    ._config;
  const meta = config?.defaultMeta;
  if (!meta || typeof meta !== 'object') return {};
  return meta as ProtoMeta;
}

export function prevalidateRouter(router: AnyRouter, file?: string): void {
  assertPrevalidate(
    prevalidate({
      defaultProto: protoMetaFromRouter(router).proto,
      procedures: Object.entries(router._def.procedures).flatMap(
        ([path, value]) => {
          if (!isProcedure(value)) return [];
          const def = value._def as { output?: unknown };
          return [
            {
              path,
              hasOutput: def.output !== undefined,
              proto: procedureProto(value),
            },
          ];
        },
      ),
    }),
    file,
  );
}

export function schemaFromRouter(router: AnyRouter): ProtoSchema {
  prevalidateRouter(router);
  const header = protoMetaFromRouter(router).proto!;
  return translate(listProcedures(router), {
    proto: header,
    packageName: header.package,
  });
}

/**
 * Walk runtime Zod parsers on `procedure.input` / `output` into ProtoSchema.
 */
export function translate(
  procedures: RuntimeProcedure[],
  options: TranslateOptions = {},
): ProtoSchema {
  const translator = new TrpcSchemaTranslator(
    structuredClone(options.generateCache ?? { propertyGenCache: {} }),
  );

  const { services, messages, enums, generateCache } =
    translator.run(procedures);

  const protoServices: ProtoService[] = [...services.entries()].map(
    ([name, methods]) => ({
      name: protoServiceName(name),
      methods,
    }),
  );

  return {
    syntax: options.proto?.syntax ?? 'proto3',
    package: options.proto?.package ?? options.packageName ?? 'trpc',
    options: options.proto?.options,
    services: protoServices,
    messages,
    enums,
    generateCache,
  };
}

function procedureInput(procedure: AnyProcedure, path: string) {
  const parsers = procedure._def.inputs;
  if (parsers.length === 0) return undefined;
  if (parsers.length > 1) {
    throw new Error(
      `${path} has ${parsers.length} chained .input() parsers; merge them into one Zod schema`,
    );
  }
  return requireZod(parsers[0], `${path} input`);
}

function procedureOutput(procedure: AnyProcedure, path: string) {
  const def = procedure._def;
  if (!('output' in def) || def.output === undefined) return undefined;
  return requireZod(def.output, `${path} output`);
}

function requireZod(value: unknown, label: string): ZodType {
  if (!isZodType(value)) {
    throw new Error(`${label} is not a Zod 4 schema (only Zod is supported)`);
  }
  return value;
}

function isZodType(value: unknown): value is ZodType {
  return (
    !!value && typeof value === 'object' && '_zod' in value && 'def' in value
  );
}

function isRouter(value: unknown): value is AnyRouter {
  if (!value || typeof value !== 'object') return false;
  if (!('_def' in value)) return false;
  const def = value._def;
  return (
    !!def && typeof def === 'object' && 'router' in def && def.router === true
  );
}

function isProcedure(value: unknown): value is AnyProcedure {
  if (
    value === null ||
    (typeof value !== 'function' && typeof value !== 'object')
  ) {
    return false;
  }
  if (!('_def' in value)) return false;
  const def = value._def;
  return (
    !!def &&
    typeof def === 'object' &&
    'procedure' in def &&
    def.procedure === true
  );
}

function procedureProto(procedure: AnyProcedure): ProtoFileHeader | undefined {
  const meta = (procedure._def as { meta?: ProtoMeta }).meta;
  return meta?.proto;
}

function emptyPropCache(): PropertyGenCache {
  return { propertyGenCache: {}, usedIds: {} };
}

function messageCache(
  root: SchemaGenerateCache,
  messageName: string,
): PropertyGenCache {
  const existing = root.propertyGenCache[messageName];
  if (existing) return existing;
  const created = emptyPropCache();
  root.propertyGenCache[messageName] = created;
  return created;
}

function protoTypeName(type: ProtoType): string {
  switch (type.kind) {
    case 'scalar':
      return type.type;
    case 'enum':
    case 'message':
      return type.name;
    case 'map':
      return `map<${type.key}, ${protoTypeName(type.value)}>`;
    default:
      return assumeExhaustive(type);
  }
}

function objectShape(zod: ZodRuntime): Record<string, ZodType> {
  if (zod.shape && typeof zod.shape === 'object') return zod.shape;
  const shape = zod.def.shape;
  if (typeof shape === 'function') return shape();
  return shape ?? {};
}

function unionDiscriminator(zod: ZodRuntime): string | undefined {
  return typeof zod.def.discriminator === 'string'
    ? zod.def.discriminator
    : undefined;
}

function stringLiteral(zod: ZodRuntime): string | undefined {
  if (zod.type !== 'literal') return undefined;
  const values = zod.def.values ?? [];
  if (values.length === 1 && typeof values[0] === 'string') return values[0];
  return undefined;
}

function omitShapeKey(zod: ZodRuntime, key: string): ZodRuntime {
  const shape = { ...objectShape(zod) };
  delete shape[key];
  return {
    ...zod,
    type: 'object',
    def: { ...zod.def, type: 'object', shape },
    shape,
  };
}

function isProtoObjectMeta(value: unknown): value is ProtoObjectMeta {
  if (!value || typeof value !== 'object') return false;
  const meta = value as ProtoObjectMeta;
  return !!(
    meta.protoMessageName ||
    meta.protoEnumName ||
    meta.protoUseKnownType
  );
}

function extractProtoObjectMeta(zod: ZodRuntime): ProtoObjectMeta {
  const meta = zod.meta?.();
  return isProtoObjectMeta(meta) ? meta : {};
}

function protoUseKnownTypeOf(zod: ZodRuntime): string | undefined {
  const value = extractProtoObjectMeta(zod).protoUseKnownType;
  if (value == null) return undefined;
  if (!isWellKnownType(value)) {
    throw new Error(
      `protoUseKnownType must be a google.protobuf well-known type, got ${String(value)}`,
    );
  }
  return value;
}

function protoMessageNameOf(zod: ZodRuntime): string | undefined {
  return extractProtoObjectMeta(zod).protoMessageName;
}

function protoEnumNameOf(zod: ZodRuntime): string | undefined {
  return extractProtoObjectMeta(zod).protoEnumName;
}

function unwrap(zod: ZodType): { inner: ZodRuntime; optional: boolean } {
  let inner = asRuntime(zod);
  let optional = false;
  const seen = new Set<ZodType>();
  while (!seen.has(inner)) {
    seen.add(inner);
    switch (inner.type) {
      case 'optional':
      case 'nullable':
        optional = true;
        inner = asRuntime(inner.def.innerType ?? inner.unwrap?.() ?? inner);
        continue;
      case 'default':
      case 'prefault':
      case 'catch':
      case 'nonoptional':
      case 'readonly':
        inner = asRuntime(inner.def.innerType ?? inner.unwrap?.() ?? inner);
        continue;
      case 'pipe':
        inner = asRuntime(inner.def.out ?? inner.def.in ?? inner);
        continue;
      case 'lazy':
      case 'promise':
        inner = asRuntime(
          inner.unwrap?.() ??
            inner.def.getter?.() ??
            inner.def.innerType ??
            inner,
        );
        continue;
      default:
        assumeExhaustiveAllowing<typeof inner.type, typeof inner.type>(
          inner.type,
        );

        break;
    }
    break;
  }
  return { inner, optional };
}

function zodComment(zod: ZodType): string {
  let current: ZodType | undefined = zod;
  const seen = new Set<ZodType>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const runtime = asRuntime(current);
    const text = runtime.description ?? runtime.meta?.()?.description ?? '';
    if (text) return text;
    current =
      runtime.def.innerType ??
      runtime.unwrap?.() ??
      runtime.def.out ??
      runtime.def.in;
  }
  return '';
}

function isEmptyType(zod: ZodRuntime): boolean {
  return (
    zod.type === 'void' ||
    zod.type === 'undefined' ||
    zod.type === 'never' ||
    zod.type === 'null'
  );
}

function mapScalar(zod: ZodRuntime): ProtoType | undefined {
  switch (zod.type) {
    case 'string':
    case 'template_literal':
      return { kind: 'scalar', type: 'string' };
    case 'any':
    case 'unknown':
      return { kind: 'message', name: 'google.protobuf.Value' };
    case 'boolean':
      return { kind: 'scalar', type: 'bool' };
    case 'bigint':
      return { kind: 'scalar', type: 'int64' };
    case 'number':
    case 'int':
      switch (zod.format) {
        case 'safeint':
        case 'int32':
          return { kind: 'scalar', type: 'int32' };
        case 'int64':
        case 'uint64':
          return { kind: 'scalar', type: 'int64' };
        default:
          assumeExhaustiveAllowing<
            'uint32' | 'float32' | 'float64' | null | undefined,
            typeof zod.format
          >(zod.format);

          return zod.isInt
            ? { kind: 'scalar', type: 'int32' }
            : { kind: 'scalar', type: 'double' };
      }
    case 'nan':
      return { kind: 'scalar', type: 'double' };
    case 'date':
      return { kind: 'message', name: 'google.protobuf.Timestamp' };
    case 'file':
      return { kind: 'scalar', type: 'bytes' };
    default:
      assumeExhaustiveAllowing<typeof zod.type, typeof zod.type>(zod.type);

      return undefined;
  }
}

function mapLiteral(zod: ZodRuntime): ProtoType {
  const values = zod.def.values ?? [];
  const kinds = new Set(values.map((item) => typeof item));
  if (kinds.size > 1) {
    throw new Error(
      `literal values have mixed types: ${[...kinds].join(', ')}`,
    );
  }
  const value: unknown = values[0];
  const kind = typeof value;
  switch (kind) {
    case 'string':
      return { kind: 'scalar', type: 'string' };
    case 'boolean':
      return { kind: 'scalar', type: 'bool' };
    case 'bigint':
      return { kind: 'scalar', type: 'int64' };
    case 'number': {
      const ints = values.every(
        (item) => typeof item === 'number' && Number.isInteger(item),
      );
      const floats = values.every(
        (item) => typeof item === 'number' && !Number.isInteger(item),
      );
      if (!ints && !floats) {
        throw new Error('literal values mix integers and floats');
      }
      return ints
        ? { kind: 'scalar', type: 'int32' }
        : { kind: 'scalar', type: 'double' };
    }
    default:
      assumeExhaustiveAllowing<
        'undefined' | 'object' | 'function' | 'symbol',
        typeof kind
      >(kind);

      return { kind: 'scalar', type: 'string' };
  }
}

function mapKeyScalar(zod: ZodType): ProtoScalar {
  const mapped = mapScalar(unwrap(zod).inner);
  if (!mapped || mapped.kind !== 'scalar') {
    throw new Error('map/record key must be a proto scalar');
  }
  if (
    mapped.type !== 'string' &&
    mapped.type !== 'int32' &&
    mapped.type !== 'int64' &&
    mapped.type !== 'bool'
  ) {
    return 'string';
  }
  return mapped.type;
}

function serviceName(path: string): string {
  const parts = path.split('.');
  if (parts.length === 1) return 'App';
  return parts
    .slice(0, -1)
    .map((part) => toPascalCase(part))
    .join('');
}

function methodName(path: string): string {
  const last = path.split('.').at(-1) ?? path;
  return toPascalCase(last);
}
