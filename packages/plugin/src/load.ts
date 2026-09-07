import path from 'node:path';
import type { AnyRouter } from '@trpc/server';
import { createJiti } from 'jiti';

export { listProcedures, protoMetaFromRouter } from '@trpc-proto/schema_ir';
export type { ProcedureType, RuntimeProcedure } from '@trpc-proto/schema_ir';

export interface LoadOptions {
  routerFile?: string;
  routerExport?: string;
}

export async function loadAppRouter(options: LoadOptions): Promise<AnyRouter> {
  const file = options.routerFile;
  if (!file) {
    throw new Error('routerFile is required to evaluate appRouter');
  }
  const abs = path.resolve(file);
  const jiti = createJiti(abs, { interopDefault: true });
  const mod = (await jiti.import(abs)) as Record<string, unknown>;
  const name = options.routerExport ?? 'appRouter';
  const router = mod[name] ?? (name === 'appRouter' ? mod.default : undefined);
  if (!isRouter(router)) {
    throw new Error(
      `export "${name}" from ${abs} is not a tRPC router (need the runtime value, not a type)`,
    );
  }
  return router;
}

function isRouter(value: unknown): value is AnyRouter {
  if (!value || typeof value !== 'object') return false;
  if (!('_def' in value)) return false;
  const def = value._def;
  return (
    !!def && typeof def === 'object' && 'router' in def && def.router === true
  );
}
