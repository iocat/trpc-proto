import protobuf from 'protobufjs';
import type {
  ProcedureType,
  PropertyGenCache,
  ProtoEnum,
  ProtoField,
  ProtoFileOptions,
  ProtoMessage,
  ProtoMethod,
  ProtoScalar,
  ProtoSchema,
  ProtoService,
  ProtoSyntax,
  ProtoType,
  SchemaGenerateCache,
} from './index.js';
import { isWellKnownType, wellKnownImport, wellKnownKind } from './wellknown.js';

const SCALARS = new Set<string>([
  'double',
  'float',
  'int32',
  'int64',
  'uint32',
  'uint64',
  'sint32',
  'sint64',
  'fixed32',
  'fixed64',
  'sfixed32',
  'sfixed64',
  'bool',
  'string',
  'bytes',
]);

function assumeExhaustive(value: never): never {
  throw new Error(`unexpected value: ${String(value)}`);
}

function dedent(text: string): string {
  const lines = text.replace(/^\n/, '').split('\n');
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^ */)?.[0].length ?? 0);
  const n = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((line) => line.slice(n)).join('\n');
}

function toPascalCase(name: string): string {
  return name
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toScreamingSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_/, '')
    .toUpperCase();
}

function protoEnumValue(enumName: string, valueName: string): string {
  const prefix = toScreamingSnake(enumName);
  const value = toScreamingSnake(valueName);
  return value.startsWith(`${prefix}_`) ? value : `${prefix}_${value}`;
}

function prepare(source: string): string {
  let text = dedent(source);
  if (!text.trim()) return 'syntax = "proto3";\npackage trpc;\n';
  if (!/^\s*syntax\s*=/m.test(text)) {
    text = `syntax = "proto3";\n${text}`;
  }
  if (!/^\s*package\s+\w/m.test(text)) {
    text = text.replace(/syntax\s*=\s*"proto3"\s*;/, 'syntax = "proto3";\npackage trpc;');
  }
  return text;
}

function publicTypeName(name: string): string {
  const trimmed = name.replace(/^\./, '');
  if (trimmed.startsWith('google.protobuf.')) return trimmed;
  const parts = trimmed.split('.');
  return parts[parts.length - 1] ?? trimmed;
}

function namedType(name: string, enumNames: Set<string>): ProtoType {
  const publicName = publicTypeName(name);
  if (SCALARS.has(publicName)) return { kind: 'scalar', type: publicName as ProtoScalar };
  if (isWellKnownType(publicName)) {
    return { kind: wellKnownKind(publicName), name: publicName };
  }
  if (enumNames.has(publicName) || enumNames.has(name)) {
    return { kind: 'enum', name: publicName };
  }
  return { kind: 'message', name: publicName };
}

function collectEnumNames(ns: protobuf.Namespace, into: Set<string>) {
  for (const nested of ns.nestedArray) {
    if (nested instanceof protobuf.Enum) into.add(nested.name);
    if (nested instanceof protobuf.Namespace) collectEnumNames(nested, into);
  }
}

function fromField(field: protobuf.Field, enumNames: Set<string>): ProtoField {
  if (field instanceof protobuf.MapField) {
    return {
      name: field.name,
      number: field.id,
      type: {
        kind: 'map',
        key: field.keyType as ProtoScalar,
        value: namedType(field.type, enumNames),
      },
      repeated: false,
      optional: false,
      comment: field.comment ?? '',
    };
  }
  return {
    name: field.name,
    number: field.id,
    type: namedType(field.type, enumNames),
    repeated: field.repeated,
    optional: Boolean(field.optional),
    comment: field.comment ?? '',
  };
}

function fromMessage(type: protobuf.Type, enumNames: Set<string>): ProtoMessage {
  const subMessages: ProtoMessage[] = [];
  for (const nested of type.nestedArray) {
    if (nested instanceof protobuf.Type) {
      subMessages.push(fromMessage(nested, enumNames));
    }
  }
  return {
    name: type.name,
    fields: type.fieldsArray.map((field) => fromField(field, enumNames)),
    subMessages,
    comment: type.comment ?? '',
  };
}

function fromEnum(en: protobuf.Enum): ProtoEnum {
  const prefix = toScreamingSnake(en.name);
  const values = Object.entries(en.values).map(([name, number]) => ({
    name: name.startsWith(`${prefix}_`) ? name.slice(prefix.length + 1) : name,
    number,
  }));
  return { name: en.name, values, comment: en.comment ?? '' };
}

function fromService(service: protobuf.Service): ProtoService {
  const methods: ProtoMethod[] = service.methodsArray.map((method) => {
    const note = /^(?:\/\/\s*)?tRPC (query|mutation|subscription) (.+)$/.exec(
      (method.comment ?? '').trim(),
    );
    return {
      name: method.name,
      path: note?.[2] ?? method.name,
      type: (note?.[1] as ProcedureType | undefined) ?? 'query',
      requestType: publicTypeName(method.requestType),
      responseType: publicTypeName(method.responseType),
    };
  });
  return { name: service.name, methods };
}

/** Parse proto3 text into schema IR via protobufjs. */
export function fromString(source: string): ProtoSchema {
  const text = prepare(source);
  const parsed = protobuf.parse(text, {
    keepCase: true,
    alternateCommentMode: true,
  });
  const packageName = parsed.package || 'trpc';
  const ns =
    (parsed.package
      ? (parsed.root.lookup(parsed.package) as protobuf.Namespace | null)
      : null) ?? parsed.root;
  const enumNames = new Set<string>();
  collectEnumNames(ns, enumNames);
  const enums: ProtoEnum[] = [];
  const messages: ProtoMessage[] = [];
  const services: ProtoService[] = [];
  for (const nested of ns.nestedArray) {
    if (nested instanceof protobuf.Enum) enums.push(fromEnum(nested));
    else if (nested instanceof protobuf.Type) {
      messages.push(fromMessage(nested, enumNames));
    } else if (nested instanceof protobuf.Service) {
      services.push(fromService(nested));
    }
  }
  return {
    syntax: 'proto3',
    package: packageName,
    options: fileOptionsFromRoot(ns),
    services,
    messages,
    enums,
    generateCache: { propertyGenCache: {} },
  };
}
function fileOptionsFromRoot(
  ns: protobuf.Namespace,
): ProtoFileOptions | undefined {
  const raw = ns.options;
  if (!raw) return undefined;
  const options: ProtoFileOptions = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    ) {
      options[key] = value;
    }
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

function emitComment(lines: string[], comment: string | undefined, indent: string) {
  if (!comment) return;
  for (const line of comment.split(/\r?\n/)) {
    lines.push(`${indent}// ${line}`);
  }
}

function renderType(type: ProtoType): string {
  switch (type.kind) {
    case 'scalar':
      return type.type;
    case 'enum':
    case 'message':
      return type.name;
    case 'map':
      return `map<${type.key}, ${renderType(type.value)}>`;
    default:
      return assumeExhaustive(type);
  }
}

function formatReservedNumbers(tags: number[]): string {
  const sorted = [...new Set(tags)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  if (start === undefined) return '';
  let prev = start;
  for (let index = 1; index <= sorted.length; index += 1) {
    const next = sorted[index];
    if (next === prev + 1) {
      prev = next;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start} to ${prev}`);
    if (next !== undefined) {
      start = prev = next;
    }
  }
  return parts.join(', ');
}

function reservedNumbers(
  message: ProtoMessage,
  cache: PropertyGenCache | undefined,
): number[] {
  if (!cache) return [];
  const live = new Set(message.fields.map((field) => field.number));
  const tags = new Set<number>();
  for (const id of Object.keys(cache.usedIds)) {
    const tag = Number(id);
    if (!live.has(tag)) tags.add(tag);
  }
  for (const [name, child] of Object.entries(cache.propertyGenCache)) {
    if (child.tag === undefined) continue;
    if (message.fields.some((field) => field.name === name)) continue;
    if (!live.has(child.tag)) tags.add(child.tag);
  }
  return [...tags];
}

function emitMessage(
  lines: string[],
  message: ProtoMessage,
  indent: string,
  cache?: SchemaGenerateCache,
  cacheKey = message.name,
) {
  emitComment(lines, message.comment, indent);
  lines.push(`${indent}message ${message.name} {`);
  for (const nested of message.subMessages ?? []) {
    emitMessage(
      lines,
      nested,
      `${indent}  `,
      cache,
      `${cacheKey}.${nested.name}`,
    );
  }
  for (const field of message.fields) {
    emitComment(lines, field.comment, `${indent}  `);
    let prefix = '';
    switch (field.type.kind) {
      case 'map':
        prefix = '';
        break;
      case 'scalar':
      case 'enum':
      case 'message':
        prefix = field.repeated
          ? 'repeated '
          : field.optional
            ? 'optional '
            : '';
        break;
      default:
        assumeExhaustive(field.type);
    }
    lines.push(
      `${indent}  ${prefix}${renderType(field.type)} ${field.name} = ${field.number};`,
    );
  }
  const reserved = formatReservedNumbers(
    reservedNumbers(message, cache?.propertyGenCache[cacheKey]),
  );
  if (reserved) {
    lines.push(`${indent}  reserved ${reserved};`);
  }
  lines.push(`${indent}}`, '');
}

function typeNamesOf(type: ProtoType): string[] {
  if (type.kind === 'message' || type.kind === 'enum') return [type.name];
  if (type.kind === 'map') return typeNamesOf(type.value);
  return [];
}

function collectTypeNames(
  messages: ProtoMessage[],
  extra: string[] = [],
): string[] {
  const names: string[] = [...extra];
  for (const message of messages) {
    for (const field of message.fields) names.push(...typeNamesOf(field.type));
    if (message.subMessages) {
      names.push(...collectTypeNames(message.subMessages));
    }
  }
  return names;
}
function formatOptionValue(
  key: string,
  value: string | boolean | number,
): string {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  if (key === 'optimize_for') return value;
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** Serialize schema IR to proto3 text. */
export function toString(schema: ProtoSchema): string {
  const lines: string[] = [
    `syntax = "${schema.syntax}";`,
    '',
    `package ${schema.package};`,
    '',
  ];

  const methods = schema.services.flatMap((service) => service.methods);
  const names = collectTypeNames(schema.messages, [
    ...methods.map((method) => method.requestType),
    ...methods.map((method) => method.responseType),
    ...schema.enums.map((item) => item.name),
  ]);
  const imports = [
    ...new Set(
      names
        .map((name) => wellKnownImport(name))
        .filter((path): path is string => Boolean(path)),
    ),
  ].sort();
  for (const path of imports) lines.push(`import "${path}";`);
  if (imports.length > 0) lines.push('');

  const fileOptions = schema.options ?? {};
  const optionKeys = Object.keys(fileOptions).filter(
    (key) => fileOptions[key] !== undefined,
  );
  for (const key of optionKeys) {
    const value = fileOptions[key];
    if (value === undefined) continue;
    lines.push(`option ${key} = ${formatOptionValue(key, value)};`);
  }
  if (optionKeys.length > 0) lines.push('');

  for (const en of schema.enums) {
    const enumName = toPascalCase(en.name);
    emitComment(lines, en.comment, '');
    lines.push(`enum ${enumName} {`);
    for (const value of en.values) {
      lines.push(
        `  ${protoEnumValue(enumName, value.name)} = ${value.number};`,
      );
    }
    lines.push('}', '');
  }

  for (const message of schema.messages) {
    emitMessage(lines, message, '', schema.generateCache);
  }

  for (const service of schema.services) {
    lines.push(`service ${service.name} {`);
    for (const method of service.methods) {
      lines.push(
        `  // tRPC ${method.type} ${method.path}`,
        `  rpc ${method.name} (${method.requestType}) returns (${method.responseType});`,
      );
    }
    lines.push('}', '');
  }

  return lines.join('\n');
}
