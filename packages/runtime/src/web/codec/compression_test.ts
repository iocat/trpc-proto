import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GRPC_GZIP_ENCODING,
  GRPC_IDENTITY_ENCODING,
  GzipCompressionCodec,
  grpcWebCompressionCodec,
  parseGrpcWebCompressionEncoding,
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

  it('parses supported header values and rejects unknown algorithms', () => {
    assert.equal(
      parseGrpcWebCompressionEncoding(undefined),
      GRPC_IDENTITY_ENCODING,
    );
    assert.equal(parseGrpcWebCompressionEncoding(' GZIP '), GRPC_GZIP_ENCODING);
    assert.throws(
      () => parseGrpcWebCompressionEncoding('br'),
      /unsupported grpc-encoding: br/,
    );
    assert(
      grpcWebCompressionCodec(GRPC_GZIP_ENCODING) instanceof
        GzipCompressionCodec,
    );
    assert.equal(grpcWebCompressionCodec(GRPC_IDENTITY_ENCODING), undefined);
  });

  it('rejects corrupted gzip payloads', async () => {
    await assert.rejects(async () =>
      decode(new Uint8Array([0x1f, 0x8b, 0x00])),
    );
  });
});
