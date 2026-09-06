import type { AnyProcedure, AnyRouter, ProcedureType } from '@trpc/server';
import type { ZodType } from 'zod';
import {
  assertPrevalidate,
  isWellKnownType,
  prevalidate,
  protoServiceName,
  wellKnownKind,
  type PropertyGenCache,
  type ProtoEnum,
  type ProtoField,
  type ProtoFileHeader,
  type ProtoMessage,
  type ProtoMeta,
  type ProtoMethod,
  type ProtoScalar,
  type ProtoSchema,
  type ProtoService,
  type ProtoType,
  type SchemaGenerateCache,
} from '@trpc-proto/schema_ir';

export type { ProcedureType };

export interface TranslateOptions {
  proto?: ProtoMeta['proto'];
  packageName?: string;
  rootService?: string;
  generateCache?: SchemaGenerateCache;
}

const MAX_TAG = 536_870_911;
const RESERVED_TAG_RANGE = [19_000, 19_999] as const;

function isReserved(tag: number) {
  return tag >= RESERVED_TAG_RANGE[0] && tag <= RESERVED_TAG_RANGE[1];
}

function advance(nextTag: number, usedTags: Set<number>) {
  while (nextTag <= MAX_TAG && (usedTags.has(nextTag) || isReserved(nextTag))) {
    nextTag = isReserved(nextTag) ? RESERVED_TAG_RANGE[1] + 1 : nextTag + 1;
  }
  return nextTag;
}

function assertValidTag(tag: number, usedTags: Set<number>) {
  if (tag < 1 || tag > MAX_TAG) {
    throw new Error(`Protobuf tag ${tag} out of range (1..536870911).`);
  }
  if (isReserved(tag)) {
    throw new Error(
      `Protobuf tag ${tag} is in reserved range (19000..19999).`,
    );
  }
  if (usedTags.has(tag)) {
    throw new Error(`Duplicate protobuf tag ${tag} assigned.`);
  }
}

function* allocate(
  assignments: Record<string, number>,
): Generator<number, never, number> {
  const usedTags = new Set<number>(Object.values(assignments));
  let nextTag = advance(1, usedTags);
  // First next() is ignored by the language; createFieldAllocator consumes it.
  let sent: number | undefined = yield 0;

  while (nextTag <= MAX_TAG) {
    const tag: number = sent ?? nextTag;
    assertValidTag(tag, usedTags);
    usedTags.add(tag);
    if (tag >= nextTag) nextTag = tag + 1;
    nextTag = advance(nextTag, usedTags);
    sent = yield tag;
  }

  throw new Error('Exhausted maximum Protobuf field numbers.');
}

/**
 * Yields the assigned tag. `next()` auto-assigns; `next(tag)` claims `tag`.
 */
export function createFieldAllocator(
  assignments: Record<string, number> = {},
): Generator<number, never, number> {
  const gen = allocate(assignments);
  gen.next();
  return gen;
}


export interface RuntimeProcedure {
  path: string;
  type: ProcedureType;
  /** Zod 4 schema from `.input()`, if the procedure set one. */
  input?: ZodType;
  /** Zod 4 schema from `.output()`, if the procedure set one. */
  output?: ZodType;
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
    throw new Error(
      `${label} is not a Zod 4 schema (only Zod is supported)`,
    );
  }
  return value;
}

function isZodType(value: unknown): value is ZodType {
  return (
    !!value &&
    typeof value === 'object' &&
    '_zod' in value &&
    'def' in value
  );
}

function isRouter(value: unknown): value is AnyRouter {
  if (!value || typeof value !== 'object') return false;
  if (!('_def' in value)) return false;
  const def = value._def;
  return (
    !!def &&
    typeof def === 'object' &&
    'router' in def &&
    def.router === true
  );
}

function isProcedure(value: unknown): value is AnyProcedure {
  if (value === null || (typeof value !== 'function' && typeof value !== 'object')) {
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

/** File header from `initTRPC.meta<ProtoMeta>().create({ defaultMeta })`. */
export function protoMetaFromRouter(router: AnyRouter): ProtoMeta {
  const config = (
    router._def as { _config?: { defaultMeta?: unknown } }
  )._config;
  const meta = config?.defaultMeta;
  if (!meta || typeof meta !== 'object') return {};
  return meta as ProtoMeta;
}

function procedureProto(procedure: AnyProcedure): ProtoFileHeader | undefined {
  const meta = (procedure._def as { meta?: ProtoMeta }).meta;
  return meta?.proto;
}

export function prevalidateRouter(
  router: AnyRouter,
  phase: 'generate' | 'runtime',
  file?: string,
): void {
  assertPrevalidate(
    prevalidate({
      phase,
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
  prevalidateRouter(router, 'runtime');
  const header = protoMetaFromRouter(router).proto!;
  return translate(listProcedures(router), {
    proto: header,
    packageName: header.package,
  });
}

function assumeExhaustive(value: never): never {
  throw new Error(`unexpected value: ${String(value)}`);
}

/** `default:` is exhaustive except for `Allowed` cases left unhandled. */
function assumeExhaustiveAllowing<Allowed>(_value: Allowed): void {}



type ZodRuntime = ZodType & {
  type: string;
  def: {
    type: string;
    innerType?: ZodType;
    element?: ZodType;
    shape?: Record<string, ZodType> | (() => Record<string, ZodType>);
    entries?: Record<string, string>;
    values?: unknown[];
    options?: ZodType[];
    keyType?: ZodType;
    valueType?: ZodType;
    getter?: () => ZodType;
    left?: ZodType;
    right?: ZodType;
    in?: ZodType;
    out?: ZodType;
  };
  unwrap?: () => ZodType;
  shape?: Record<string, ZodType>;
  element?: ZodType;
  isInt?: boolean;
  format?: string | null;
  meta?: () => { id?: string; description?: string } | undefined;
  description?: string;
};

function asRuntime(zod: ZodType): ZodRuntime {
  return zod as ZodRuntime;
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
    case "scalar":
      return type.type;
    case "enum":
    case "message":
      return type.name;
    case "map":
      return `map<${type.key}, ${protoTypeName(type.value)}>`;
    default:
      return assumeExhaustive(type);
  }
}

function objectShape(zod: ZodRuntime): Record<string, ZodType> {
  if (zod.shape && typeof zod.shape === "object") return zod.shape;
  const shape = zod.def.shape;
  if (typeof shape === "function") return shape();
  return shape ?? {};
}

function unwrap(zod: ZodType): { inner: ZodRuntime; optional: boolean } {
  let inner = asRuntime(zod);
  let optional = false;
  const seen = new Set<ZodType>();
  while (!seen.has(inner)) {
    seen.add(inner);
    switch (inner.type) {
      case "optional":
      case "nullable":
        optional = true;
        inner = asRuntime(inner.def.innerType ?? inner.unwrap?.() ?? inner);
        continue;
      case "default":
      case "prefault":
      case "catch":
      case "nonoptional":
      case "readonly":
        inner = asRuntime(inner.def.innerType ?? inner.unwrap?.() ?? inner);
        continue;
      case "pipe":
        inner = asRuntime(inner.def.out ?? inner.def.in ?? inner);
        continue;
      case "lazy":
      case "promise":
        inner = asRuntime(
          inner.unwrap?.() ??
            inner.def.getter?.() ??
            inner.def.innerType ??
            inner,
        );
        continue;
      default:
        assumeExhaustiveAllowing<string>(inner.type);
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
    const text = runtime.description ?? runtime.meta?.()?.description ?? "";
    if (text) return text;
    current =
      runtime.def.innerType ??
      runtime.unwrap?.() ??
      runtime.def.out ??
      runtime.def.in;
  }
  return "";
}

function isEmptyType(zod: ZodRuntime): boolean {
  return (
    zod.type === "void" ||
    zod.type === "undefined" ||
    zod.type === "never" ||
    zod.type === "null"
  );
}

function mapScalar(zod: ZodRuntime): ProtoType | undefined {
  switch (zod.type) {
    case "string":
    case "template_literal":
      return { kind: "scalar", type: "string" };
    case "any":
    case "unknown":
      return { kind: "message", name: "google.protobuf.Value" };
    case "boolean":
      return { kind: "scalar", type: "bool" };
    case "bigint":
      return { kind: "scalar", type: "int64" };
    case "number":
    case "int":
      switch (zod.format) {
        case "safeint":
        case "int32":
          return { kind: "scalar", type: "int32" };
        case "int64":
        case "uint64":
          return { kind: "scalar", type: "int64" };
        default:
          assumeExhaustiveAllowing<"uint32" | "float32" | "float64" | null>(
            zod.format as "uint32" | "float32" | "float64" | null,
          );
          return zod.isInt
            ? { kind: "scalar", type: "int32" }
            : { kind: "scalar", type: "double" };
      }
    case "nan":
      return { kind: "scalar", type: "double" };
    case "date":
      return { kind: "message", name: "google.protobuf.Timestamp" };
    case "file":
      return { kind: "scalar", type: "bytes" };
    default:
      assumeExhaustiveAllowing<string>(zod.type);
      return undefined;
  }
}

function mapLiteral(zod: ZodRuntime): ProtoType {
  const values = zod.def.values ?? [];
  const kinds = new Set(values.map((item) => typeof item));
  if (kinds.size > 1) {
    throw new Error(
      `literal values have mixed types: ${[...kinds].join(", ")}`,
    );
  }
  const value: unknown = values[0];
  const kind = typeof value;
  switch (kind) {
    case "string":
      return { kind: "scalar", type: "string" };
    case "boolean":
      return { kind: "scalar", type: "bool" };
    case "bigint":
      return { kind: "scalar", type: "int64" };
    case "number": {
      const ints = values.every(
        (item) => typeof item === "number" && Number.isInteger(item),
      );
      const floats = values.every(
        (item) => typeof item === "number" && !Number.isInteger(item),
      );
      if (!ints && !floats) {
        throw new Error("literal values mix integers and floats");
      }
      return ints
        ? { kind: "scalar", type: "int32" }
        : { kind: "scalar", type: "double" };
    }
    default:
      assumeExhaustiveAllowing<"undefined" | "object" | "function" | "symbol">(
        kind,
      );
      return { kind: "scalar", type: "string" };
  }
}

function mapKeyScalar(zod: ZodType): ProtoScalar {
  const mapped = mapScalar(unwrap(zod).inner);
  if (!mapped || mapped.kind !== "scalar") {
    throw new Error("map/record key must be a proto scalar");
  }
  if (
    mapped.type !== "string" &&
    mapped.type !== "int32" &&
    mapped.type !== "int64" &&
    mapped.type !== "bool"
  ) {
    return "string";
  }
  return mapped.type;
}

class Translator {
  readonly messages: ProtoMessage[] = [];
  readonly enums: ProtoEnum[] = [];
  readonly cache: SchemaGenerateCache;
  private readonly seen = new WeakMap<ZodType, string>();

  constructor(cache: SchemaGenerateCache) {
    this.cache = cache;
  }

  messageName(zod: ZodRuntime, fallback: string): string {
    const cached = this.seen.get(zod);
    if (cached) return cached;
    const id = zod.meta?.()?.id;
    if (id && isWellKnownType(id)) {
      this.seen.set(zod, id);
      return id;
    }
    if (id && toPascalCase(id) !== id) {
      throw new Error(
        `id must be PascalCase, expected ${toPascalCase(id)}, got ${id}`,
      );
    }
    const name = toPascalCase(id ?? fallback);
    this.seen.set(zod, name);
    return name;
  }

  convertObject(
    zod: ZodRuntime,
    messageName: string,
    hoist = true,
    cacheName = messageName,
  ): ProtoMessage {
    if (hoist) {
      const existing = this.messages.find(
        (message) => message.name === messageName,
      );
      if (existing) return existing;
    }

    const cache = messageCache(this.cache, cacheName);
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
      const mapped = this.mapField(value, messageName, fieldName, subMessages);
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
    if (hoist) this.messages.push(message);
    return message;
  }

  convertEnum(zod: ZodRuntime, enumName: string): ProtoType {
    const name = this.messageName(zod, enumName);
    if (isWellKnownType(name)) {
      return { kind: wellKnownKind(name), name };
    }
    if (!this.enums.some((en) => en.name === name)) {
      const entries = zod.def.entries ?? {};
      let values = Object.keys(entries).map((valueName, index) => ({
        name: valueName,
        number: index,
      }));
      if (values.length === 0 && zod.type === "union") {
        const names = (zod.def.options ?? []).flatMap((option) => {
          const inner = unwrap(option).inner;
          return (inner.def.values ?? []).map((value) => String(value));
        });
        values = names.map((valueName, index) => ({
          name: valueName,
          number: index,
        }));
      }
      this.enums.push({ name, values, comment: zodComment(zod) });
    }
    return { kind: "enum", name };
  }

  mapField(
    zod: ZodType,
    parentMessage: string,
    fieldName: string,
    nested: ProtoMessage[] = [],
  ): { type: ProtoType; repeated: boolean; message?: ProtoMessage } {
    const inner = unwrap(zod).inner;
    switch (inner.type) {
      case "array":
      case "set": {
        const element = asRuntime(inner.element ?? inner.def.element ?? inner);
        const mapped = this.mapField(element, parentMessage, fieldName, nested);
        return { ...mapped, repeated: true };
      }
      case "object": {
        const named = inner.meta?.()?.id;
        if (named && isWellKnownType(named)) {
          return {
            type: { kind: wellKnownKind(named), name: named },
            repeated: false,
          };
        }
        if (named) {
          const name = this.messageName(inner, named);
          this.convertObject(inner, name, true);
          return { type: { kind: "message", name }, repeated: false };
        }
        const nestedName = toPascalCase(fieldName);
        const message = this.convertObject(
          inner,
          nestedName,
          /* hoisted= */ false,
          `${parentMessage}.${nestedName}`,
        );
        nested.push(message);
        return {
          type: { kind: "message", name: nestedName },
          repeated: false,
          message,
        };
      }
      case "enum":
        return {
          type: this.convertEnum(
            inner,
            `${parentMessage}${toPascalCase(fieldName)}`,
          ),
          repeated: false,
        };
      case "record":
      case "map": {
        const valueType = inner.def.valueType ?? inner;
        const valueInner = unwrap(valueType).inner;
        if (valueInner.type === "any" || valueInner.type === "unknown") {
          return {
            type: { kind: "message", name: "google.protobuf.Struct" },
            repeated: false,
          };
        }
        const key = mapKeyScalar(inner.def.keyType ?? inner);
        const value = this.mapField(
          valueType,
          parentMessage,
          fieldName,
          nested,
        );
        return {
          type: { kind: "map", key, value: value.type },
          repeated: false,
        };
      }
      case "tuple": {
        const nestedName = toPascalCase(fieldName);
        const items = (inner.def as { items?: ZodType[] }).items ?? [];
        const fakeShape: Record<string, ZodType> = {};
        items.forEach((item, index) => {
          fakeShape[`f${index}`] = item;
        });
        const message = this.convertObject(
          { ...inner, type: "object", def: { ...inner.def, shape: fakeShape } },
          nestedName,
          false,
          `${parentMessage}.${nestedName}`,
        );
        nested.push(message);
        return {
          type: { kind: "message", name: nestedName },
          repeated: false,
          message,
        };
      }
      case "intersection": {
        const left = asRuntime(inner.def.left ?? inner);
        const right = asRuntime(inner.def.right ?? inner);
        if (left.type === "object" && right.type === "object") {
          const named = inner.meta?.()?.id;
          const merged = {
            ...left,
            def: {
              ...left.def,
              shape: { ...objectShape(left), ...objectShape(right) },
            },
            shape: { ...objectShape(left), ...objectShape(right) },
          };
          if (named) {
            const name = this.messageName(inner, named);
            this.convertObject(merged, name, true);
            return { type: { kind: "message", name }, repeated: false };
          }
          const nestedName = toPascalCase(fieldName);
          const message = this.convertObject(
            merged,
            nestedName,
            false,
            `${parentMessage}.${nestedName}`,
          );
          nested.push(message);
          return {
            type: { kind: "message", name: nestedName },
            repeated: false,
            message,
          };
        }
        assumeExhaustiveAllowing<"intersection">(inner.type);
        throw new Error(
          `Unsupported Zod type "${inner.type}" at ${parentMessage}.${fieldName}`,
        );
      }
      case "union": {
        const options = (inner.def.options ?? []).map(
          (option) => unwrap(option).inner,
        );
        const meaningful = options.filter((option) => !isEmptyType(option));
        if (meaningful.length === 1 && meaningful[0]) {
          return this.mapField(meaningful[0], parentMessage, fieldName, nested);
        }
        if (
          meaningful.length > 0 &&
          meaningful.every((option) => option.type === "literal")
        ) {
          return {
            type: this.convertEnum(
              inner,
              `${parentMessage}${toPascalCase(fieldName)}`,
            ),
            repeated: false,
          };
        }
        assumeExhaustiveAllowing<"union">(inner.type);
        throw new Error(
          `Unsupported Zod type "${inner.type}" at ${parentMessage}.${fieldName}`,
        );
      }
      case "literal":
        return { type: mapLiteral(inner), repeated: false };
      default: {
        assumeExhaustiveAllowing<string>(inner.type);
        const scalar = mapScalar(inner);
        if (scalar) return { type: scalar, repeated: false };
        throw new Error(
          `Unsupported Zod type "${inner.type}" at ${parentMessage}.${fieldName}`,
        );
      }
    }
  }

  wrapScalar(messageName: string, zod: ZodType): string {
    const existing = this.messages.find(
      (message) => message.name === messageName,
    );
    if (existing) return messageName;
    const mapped = this.mapField(zod, messageName, "value");
    const cache = messageCache(this.cache, messageName);
    const assignments: Record<string, number> = {};
    if (cache.propertyGenCache.value?.tag !== undefined) {
      assignments.value = cache.propertyGenCache.value.tag;
    }
    const allocator = createFieldAllocator(assignments);
    const existingTag = cache.propertyGenCache.value?.tag;
    const number =
      existingTag !== undefined ? existingTag : allocator.next().value;
    cache.usedIds[number] = "value";
    cache.propertyGenCache.value = {
      tag: number,
      type: protoTypeName(mapped.type),
      propertyGenCache: {},
      usedIds: {},
    };
    this.messages.push({
      name: messageName,
      fields: [
        {
          name: "value",
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

  ioType(zod: ZodType | undefined, fallbackName: string): string {
    if (!zod) return "google.protobuf.Empty";
    const { inner } = unwrap(zod);
    if (isEmptyType(inner)) return "google.protobuf.Empty";
    const id = inner.meta?.()?.id;
    if (id && isWellKnownType(id)) return id;
    switch (inner.type) {
      case "object": {
        const name = this.messageName(inner, fallbackName);
        this.convertObject(inner, name);
        return name;
      }
      default: {
        assumeExhaustiveAllowing<string>(inner.type);
        const mapped =
          inner.type === "literal" ? mapLiteral(inner) : mapScalar(inner);
        if (
          mapped &&
          (mapped.kind === "message" || mapped.kind === "enum") &&
          isWellKnownType(mapped.name)
        ) {
          return mapped.name;
        }
        this.wrapScalar(fallbackName, zod);
        return fallbackName;
      }
    }
  }
}

function serviceName(path: string, rootService: string): string {
  const parts = path.split(".");
  if (parts.length === 1) return rootService;
  return parts
    .slice(0, -1)
    .map((part) => toPascalCase(part))
    .join("");
}

function methodName(path: string): string {
  const last = path.split(".").at(-1) ?? path;
  return toPascalCase(last);
}

function toPascalCase(name: string): string {
  return name
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
function toSnakeCase(name: string): string {
  return name.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function toScreamingSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_/, "")
    .toUpperCase();
}

function protoEnumValue(enumName: string, valueName: string): string {
  const prefix = toScreamingSnake(enumName);
  const value = toScreamingSnake(valueName);
  return value.startsWith(`${prefix}_`) ? value : `${prefix}_${value}`;
}

/**
 * Walk runtime Zod parsers on `procedure.input` / `output` into ProtoSchema.
 */
export function translate(
  procedures: RuntimeProcedure[],
  options: TranslateOptions = {},
): ProtoSchema {
  const rootService = options.rootService ?? "App";
  const translator = new Translator(
    structuredClone(options.generateCache ?? { propertyGenCache: {} }),
  );
  const services = new Map<string, ProtoMethod[]>();

  for (const procedure of procedures) {
    const service = serviceName(procedure.path, rootService);
    const method = methodName(procedure.path);
    const requestType = translator.ioType(
      procedure.input,
      `${service}${method}Request`,
    );
    const responseType = translator.ioType(
      procedure.output,
      `${service}${method}Response`,
    );
    const methods = services.get(service) ?? [];
    methods.push({
      name: method,
      path: procedure.path,
      type: procedure.type,
      requestType,
      responseType,
    });
    services.set(service, methods);
  }

  const protoServices: ProtoService[] = [...services.entries()].map(
    ([name, methods]) => ({
      name: protoServiceName(name),
      methods,
    }),
  );

  return {
    syntax: options.proto?.syntax ?? "proto3",
    package: options.proto?.package ?? options.packageName ?? "trpc",
    options: options.proto?.options,
    services: protoServices,
    messages: translator.messages,
    enums: translator.enums,
    generateCache: translator.cache,
  };
}
