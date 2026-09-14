import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createJiti } from 'jiti';
import type { ProtoSchema } from '@trpc-proto/schema_ir';
import { fileURLToPath } from 'node:url';
import { generate } from './generate.js';

describe('generate', () => {
  async function rejectGenerate(fixture: string, pattern: RegExp) {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'trpc-proto-'));
    await assert.rejects(
      () =>
        generate({
          routerFile: fileURLToPath(
            new URL(`./fixtures/${fixture}`, import.meta.url),
          ),
          outDir,
        }),
      pattern,
    );
  }

  it('throws when proto.package is missing', async () => {
    await rejectGenerate(
      'router_missing_default_proto.ts',
      /proto\.package is required/,
    );
  });

  it('throws when a procedure is missing .output()', async () => {
    await rejectGenerate(
      'router_missing_output.ts',
      /procedure ping missing required output/,
    );
  });

  it('throws when a procedure overrides proto meta', async () => {
    await rejectGenerate(
      'router_proto_override.ts',
      /procedure ping overrides proto meta/,
    );
  });

  it('persists and reloads field assignments through schema.ts', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'trpc-proto-'));
    const routerFile = fileURLToPath(
      new URL('./fixtures/router_valid.ts', import.meta.url),
    );
    await generate({
      routerFile,
      outDir,
      generateCache: {
        propertyGenCache: {
          AppPingResponse: {
            propertyGenCache: {
              ok: {
                tag: 7,
                type: 'bool',
                propertyGenCache: {},
                usedIds: {},
              },
            },
            usedIds: { 7: 'ok' },
          },
        },
      },
    });
    const result = await generate({ routerFile, outDir });
    const schemaPath = path.join(outDir, 'schema.ts');
    const generated = (await createJiti(import.meta.url, {
      interopDefault: true,
      moduleCache: false,
    }).import(schemaPath)) as { protoSchema: ProtoSchema };
    const expected = JSON.parse(
      JSON.stringify(result.schema),
    ) as typeof result.schema;
    assert.deepEqual(generated.protoSchema, expected);
    assert.equal(generated.protoSchema.messages[0]?.fields[0]?.number, 7);
    assert.deepEqual(result.files, [
      path.join(outDir, 'demo_v1.proto'),
      schemaPath,
    ]);
    assert.equal(existsSync(path.join(outDir, 'schema.json')), false);
  });

  it('prefers schemaPath and keeps the deprecated cache field compatible', async () => {
    const routerFile = fileURLToPath(
      new URL('./fixtures/router_valid.ts', import.meta.url),
    );
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'trpc-proto-'));
    const schemaPath = path.join(outDir, 'schema', 'contract.ts');
    const ignoredCachePath = path.join(outDir, 'legacy', 'schema.ts');
    const result = await generate({
      routerFile,
      outDir,
      proto: {
        schemaPath,
        cache: ignoredCachePath,
      },
    });

    assert.equal(result.files[1], schemaPath);
    assert.equal(existsSync(schemaPath), true);
    assert.equal(existsSync(ignoredCachePath), false);

    const legacyOutDir = await mkdtemp(
      path.join(os.tmpdir(), 'trpc-proto-legacy-'),
    );
    const legacySchemaPath = path.join(legacyOutDir, 'legacy', 'schema.ts');
    const legacyResult = await generate({
      routerFile,
      outDir: legacyOutDir,
      proto: { cache: legacySchemaPath },
    });

    assert.equal(legacyResult.files[1], legacySchemaPath);
    assert.equal(existsSync(legacySchemaPath), true);
  });
});
