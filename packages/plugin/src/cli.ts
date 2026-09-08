#!/usr/bin/env node
import { PrevalidateError } from '@trpc-proto/schema_ir';
import { generate, type GenerateOptions } from './generate.js';

function flag(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  process.stdout.write(
    'trpc-proto generate --router src/router.ts [--export appRouter] [--out generated] [--package pkg] [--cache generated/schema.ts]\n' +
      'writes <out>/<package>.proto and <cache> (default <out>/schema.ts)\n' +
      'package/syntax/cache/options default from defaultMeta.proto\n',
  );
  process.exit(0);
}

const command = process.argv[2];
if (command && command !== 'generate' && !command.startsWith('-')) {
  process.stderr.write(`unknown command: ${command}\n`);
  process.exit(1);
}

const cache = flag('--cache');
const options: GenerateOptions = {
  outDir: flag('--out') ?? 'generated',
  routerFile: flag('--router'),
  routerExport: flag('--export'),
  packageName: flag('--package'),
  proto: cache ? { cache } : undefined,
};

try {
  const result = await generate(options);
  process.stdout.write(
    `evaluated ${result.procedures.length} procedures: ${result.procedures.map((p) => p.path).join(', ') || '(none)'}\n`,
  );
  process.stdout.write(`wrote ${result.files.join(', ')}\n`);
} catch (err) {
  if (err instanceof PrevalidateError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
}
