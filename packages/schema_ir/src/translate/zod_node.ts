import type { ZodType } from 'zod';
import { assumeExhaustiveAllowing } from '@trpc-proto/utility';
import { isWellKnownType } from '../ir/wellknown.js';
import type { ProtoObjectMeta, ProtoScalar, ProtoType } from '../ir/types.js';


export type ZodRuntime = ZodType & {
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
    discriminator?: string;
    in?: ZodType;
    out?: ZodType;
    items?: ZodType[];
  };
  unwrap?: () => ZodType;
  shape?: Record<string, ZodType>;
  element?: ZodType;
  isInt?: boolean;
  format?:
    | 'safeint'
    | 'int32'
    | 'int64'
    | 'uint32'
    | 'uint64'
    | 'float32'
    | 'float64'
    | null;
  meta?: () => (ProtoObjectMeta & { description?: string }) | undefined;
  description?: string;
};

export function asRuntime(zod: ZodType): ZodRuntime {
  return zod as ZodRuntime;
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

/** Unwrapped Zod node: wrappers stripped, proto meta and scalar mapping. */
export class ZodNode {
  private constructor(
    readonly source: ZodType,
    readonly inner: ZodRuntime,
    readonly optional: boolean,
  ) {}

  static from(zod: ZodType): ZodNode {
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
          break;
      }
      break;
    }
    return new ZodNode(zod, inner, optional);
  }

  get type(): string {
    return this.inner.type;
  }

  protoMeta(): ProtoObjectMeta {
    const meta = this.inner.meta?.();
    return isProtoObjectMeta(meta) ? meta : {};
  }

  protoMessageName(): string | undefined {
    return this.protoMeta().protoMessageName;
  }

  protoEnumName(): string | undefined {
    return this.protoMeta().protoEnumName;
  }

  protoUseKnownType(): string | undefined {
    const value = this.protoMeta().protoUseKnownType;
    if (value == null) return undefined;
    if (!isWellKnownType(value)) {
      throw new Error(
        `protoUseKnownType must be a google.protobuf well-known type, got ${String(value)}`,
      );
    }
    return value;
  }

  comment(): string {
    let current: ZodType | undefined = this.source;
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

  isEmpty(): boolean {
    return (
      this.type === 'void' ||
      this.type === 'undefined' ||
      this.type === 'never' ||
      this.type === 'null'
    );
  }

  shape(): Record<string, ZodType> {
    const zod = this.inner;
    if (zod.shape && typeof zod.shape === 'object') return zod.shape;
    const shape = zod.def.shape;
    if (typeof shape === 'function') return shape();
    return shape ?? {};
  }

  discriminator(): string | undefined {
    return typeof this.inner.def.discriminator === 'string'
      ? this.inner.def.discriminator
      : undefined;
  }

  stringLiteral(): string | undefined {
    if (this.type !== 'literal') return undefined;
    const values = this.inner.def.values ?? [];
    if (values.length === 1 && typeof values[0] === 'string') return values[0];
    return undefined;
  }

  omitKey(key: string): ZodRuntime {
    const shape = { ...this.shape() };
    delete shape[key];
    return {
      ...this.inner,
      type: 'object',
      def: { ...this.inner.def, type: 'object', shape },
      shape,
    };
  }

  mapScalar(): ProtoType | undefined {
    const zod = this.inner;
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
        return undefined;
    }
  }

  mapLiteral(): ProtoType {
    const values = this.inner.def.values ?? [];
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

  mapKeyScalar(): ProtoScalar {
    const mapped = this.mapScalar();
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
}
