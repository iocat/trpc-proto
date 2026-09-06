import { createCodec } from './codec.js';
import type { Invoker } from './invoke.js';
import type { ProtoSchema } from '@trpc-proto/schema_ir';

/** `{ User: { GetById: (input) => ... } }` — spread onto generated server stubs. */
export type StubHandlers = Record<
  string,
  Record<string, (input: unknown) => Promise<unknown>>
>;

export function bindStubHandlers(
  schema: ProtoSchema,
  invoke: Invoker,
): StubHandlers {
  const services: StubHandlers = {};
  for (const service of schema.services) {
    const methods: Record<string, (input: unknown) => Promise<unknown>> = {};
    for (const method of service.methods) {
      methods[method.name] = (input) => invoke({ path: method.path, input });
    }
    services[service.name] = methods;
  }
  return services;
}

/**
 * Proto-shaped handlers that return protobuf defaults (empty messages).
 * A non-tRPC backend can replace any method; unimplemented RPCs stay valid proto.
 */
export function createNoopStub(schema: ProtoSchema): StubHandlers {
  const codec = createCodec(schema);
  const services: StubHandlers = {};
  for (const service of schema.services) {
    const methods: Record<string, (input: unknown) => Promise<unknown>> = {};
    for (const method of service.methods) {
      methods[method.name] = async () =>
        codec.decode(method.responseType, new Uint8Array());
    }
    services[service.name] = methods;
  }
  return services;
}

/**
 * Empty procedure body. tRPC requires a resolver; `.input()` / `.output()`
 * are the contract. A non-TS service that implements the generated proto
 * is the real backend.
 *
 * Return type `never` is assignable to any output, so this type-checks.
 * At runtime the function returns `undefined` and does no work.
 */
export function noopForNonTsBackend(_opts?: unknown): never {
  return undefined as never;
}
