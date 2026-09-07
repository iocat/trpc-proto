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
import { loadAppRouter, type LoadOptions } from './load.js';

export { translate } from '@trpc-proto/schema_ir';

/** Options for loading a router and generating its protobuf artifacts. */
export interface GenerateOptions extends LoadOptions, ProtoMeta {
  outDir?: string;
  /** CLI override for `defaultMeta.package`. */
  packageName?: string;
  rootService?: string;
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
  const cachePath = path.resolve(
    fromOpts.cache ?? fromRouter?.cache ?? path.join(outDir, 'schema.json'),
  );
  const schema = translate(procedures, {
    ...options,
    generateCache: options.generateCache ?? loadGenerateCache(cachePath),
    proto: {
      syntax: fromOpts.syntax ?? fromRouter?.syntax ?? 'proto3',
      package: packageName,
      cache: cachePath,
      options: fromOpts.options ?? fromRouter?.options,
    },
  });
  const proto = toString(schema);
  return {
    procedures,
    schema,
    proto,
    files: writeOutputs(schema, proto, outDir, cachePath),
  };
}

function loadGenerateCache(cachePath: string): SchemaGenerateCache | undefined {
  if (!fs.existsSync(cachePath)) return undefined;
  const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as {
    generateCache?: SchemaGenerateCache;
    propertyGenCache?: SchemaGenerateCache['propertyGenCache'];
  };
  if (raw.generateCache) return raw.generateCache;
  if (raw.propertyGenCache) return { propertyGenCache: raw.propertyGenCache };
  return undefined;
}

function writeOutputs(
  schema: ProtoSchema,
  proto: string,
  outDir = 'generated',
  cachePath?: string,
) {
  fs.mkdirSync(outDir, { recursive: true });
  const protoPath = path.join(
    outDir,
    `${schema.package.replaceAll('.', '_')}.proto`,
  );
  const schemaPath = cachePath ?? path.join(outDir, 'schema.json');
  fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
  fs.writeFileSync(protoPath, proto);
  fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
  return [protoPath, schemaPath];
}
