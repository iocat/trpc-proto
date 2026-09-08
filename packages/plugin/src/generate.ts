import fs from 'node:fs';
import path from 'node:path';
import {
  listProcedures,
  prevalidateRouter,
  protoMetaFromRouter,
  toString,
  translate,
  type ProtoMeta,
  type ProtoSchema,
  type RuntimeProcedure,
  type SchemaGenerateCache,
} from '@trpc-proto/schema_ir';
import { createJiti } from 'jiti';
import { loadAppRouter, type LoadOptions } from './load.js';

export { translate } from '@trpc-proto/schema_ir';

/** Options for loading a router and generating its protobuf artifacts. */
export interface GenerateOptions extends LoadOptions, ProtoMeta {
  outDir?: string;
  /** CLI override for `defaultMeta.package`. */
  packageName?: string;
  generateCache?: SchemaGenerateCache;
}

/** Schema and files produced by a protobuf generation run. */
export interface GenerateResult {
  procedures: RuntimeProcedure[];
  schema: ProtoSchema;
  proto: string;
  files: string[];
}
const DEFAULT_PACKAGE = 'trpc';

export async function generate(
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const router = await loadAppRouter(options);
  prevalidateRouter(router, options.routerFile);
  const procedures = listProcedures(router);
  const fromRouter = protoMetaFromRouter(router).proto;
  const fromOpts = options.proto ?? {};
  const outDir = options.outDir ?? 'generated';
  const packageName =
    options.packageName ??
    fromOpts.package ??
    fromRouter?.package ??
    DEFAULT_PACKAGE;
  const schemaPath = path.resolve(
    fromOpts.cache ?? fromRouter?.cache ?? path.join(outDir, 'schema.ts'),
  );
  const schema = translate(procedures, {
    ...options,
    generateCache:
      options.generateCache ?? (await loadGenerateCache(schemaPath)),
    proto: {
      syntax: fromOpts.syntax ?? fromRouter?.syntax ?? 'proto3',
      package: packageName,
      cache: schemaPath,
      options: fromOpts.options ?? fromRouter?.options,
    },
  });
  const proto = toString(schema);
  return {
    procedures,
    schema,
    proto,
    files: writeOutputs(schema, proto, outDir, schemaPath),
  };
}

async function loadGenerateCache(
  schemaPath: string,
): Promise<SchemaGenerateCache | undefined> {
  if (!fs.existsSync(schemaPath)) return undefined;
  const generated = (await createJiti(schemaPath, {
    interopDefault: true,
    moduleCache: false,
  }).import(schemaPath)) as { protoSchema?: ProtoSchema };
  return generated.protoSchema?.generateCache;
}

function runtimeSchemaModule(schema: ProtoSchema): string {
  return [
    "import type { ProtoSchema } from '@trpc-proto/runtime';",
    '',
    `export const protoSchema = ${JSON.stringify(schema, null, 2)} satisfies ProtoSchema;`,
    '',
  ].join('\n');
}

function writeAtomic(filePath: string, content: string): void {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, content);
  fs.renameSync(temporaryPath, filePath);
}

function writeOutputs(
  schema: ProtoSchema,
  proto: string,
  outDir = 'generated',
  schemaPath = path.join(outDir, 'schema.ts'),
) {
  fs.mkdirSync(outDir, { recursive: true });
  const protoPath = path.join(
    outDir,
    `${schema.package.replaceAll('.', '_')}.proto`,
  );
  fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
  fs.writeFileSync(protoPath, proto);
  writeAtomic(schemaPath, runtimeSchemaModule(schema));
  return [protoPath, schemaPath];
}
