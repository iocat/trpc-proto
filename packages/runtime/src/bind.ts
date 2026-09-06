import type { AnyRouter } from '@trpc/server';
import { createInvoker } from './invoke.js';
import type { Invoker } from './invoke.js';
import { schemaFromRouter } from './translate.js';
import type { ProtoSchema } from '@trpc-proto/schema_ir';

/** `{ UserService: { GetById: (input) => ... } }` — spread onto generated server stubs. */
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
 * Proto-shaped handlers that call a tRPC router.
 * Use this when the backend is TypeScript tRPC.
 */
export function bindRouter(
  router: AnyRouter,
  opts?: { createContext?: () => unknown | Promise<unknown> },
): StubHandlers {
  return bindStubHandlers(schemaFromRouter(router), createInvoker(router, opts));
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
