import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GzipCompressionCodec,
  grpcWebCompressionCodec,
} from './compression.js';

const gzipCodec = new GzipCompressionCodec();

async function decode(encoded: Uint8Array): Promise<Uint8Array[]> {
  const values: Uint8Array[] = [];
  for await (const value of gzipCodec.decode(encoded)) values.push(value);
  return values;
}

describe('gRPC-Web message compression', () => {
  it('round-trips one gzip context per message', async () => {
    const expected = new TextEncoder().encode('protobuf '.repeat(256));
    const compressed = await gzipCodec.encode(expected);
    assert.ok(compressed.byteLength < expected.byteLength);
    assert.deepEqual(await decode(compressed), [expected]);
  });

  it('recognizes gzip and identity header values', () => {
    assert(grpcWebCompressionCodec('gzip') instanceof GzipCompressionCodec);
    assert(grpcWebCompressionCodec(' GZIP ') instanceof GzipCompressionCodec);
    assert.equal(grpcWebCompressionCodec('identity'), undefined);
    assert.equal(grpcWebCompressionCodec(undefined), undefined);
  });

  it('rejects corrupted gzip payloads', async () => {
    await assert.rejects(
      async () => decode(new Uint8Array([0x1f, 0x8b, 0x00])),
    );
  });
});
