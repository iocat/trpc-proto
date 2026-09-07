import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CodecInput } from './codec.js';
import {
  GrpcWebError,
  GrpcWebProtocolCodec,
  type GrpcWebProtocolCodecOptions,
  type GrpcWebProtocolValue,
} from './protocol_codec.js';

const protocolCodec = new GrpcWebProtocolCodec();

async function decode(
  encoded: CodecInput<Uint8Array>,
  options: GrpcWebProtocolCodecOptions,
): Promise<GrpcWebProtocolValue[]> {
  const values: GrpcWebProtocolValue[] = [];
  for await (const value of protocolCodec.decode(encoded, options)) {
    values.push(value);
  }
  return values;
}

describe('gRPC-Web protocol codec', () => {
  it('round-trips binary messages and protected trailers', async () => {
    const message = await protocolCodec.encode(
      { kind: 'message', payload: new Uint8Array([1, 2, 3]) },
      { encoding: 'raw' },
    );
    const trailers = await protocolCodec.encode(
      {
        kind: 'trailers',
        status: 5,
        message: 'missing',
        metadata: {
          'grpc-status': '0',
          'grpc-message': 'overridden',
          'x-trace': 'abc',
        },
      },
      { encoding: 'raw' },
    );

    assert.deepEqual(
      await decode(new Uint8Array([...message, ...trailers]), {
        encoding: 'raw',
      }),
      [
        { kind: 'message', payload: new Uint8Array([1, 2, 3]) },
        {
          kind: 'trailers',
          status: 5,
          message: 'missing',
          metadata: { 'x-trace': 'abc' },
        },
      ],
    );
  });

  it('streams text chunks and decompresses gzip messages', async () => {
    const payload = new TextEncoder().encode('response '.repeat(64));
    const encoded = await protocolCodec.encode(
      { kind: 'message', payload },
      { encoding: 'base64', compress: true },
    );
    async function* chunks() {
      for (let offset = 0; offset < encoded.length; offset += 3) {
        yield encoded.subarray(offset, offset + 3);
      }
    }

    assert.deepEqual(
      await decode(chunks(), { encoding: 'base64', compression: 'gzip' }),
      [{ kind: 'message', payload }],
    );
  });

  it('rejects unsupported request compression', async () => {
    await assert.rejects(
      protocolCodec.encode(
        { kind: 'message', payload: new Uint8Array([1]) },
        { encoding: 'raw', compress: true, compression: 'br' },
      ),
      (error: unknown) =>
        error instanceof GrpcWebError &&
        error.code === 12 &&
        /unsupported grpc-encoding: br/.test(error.message),
    );
  });

  it('rejects compressed messages without their encoding', async () => {
    const encoded = await protocolCodec.encode(
      { kind: 'message', payload: new Uint8Array([1]) },
      { encoding: 'raw', compress: true },
    );
    await assert.rejects(
      async () => decode(encoded, { encoding: 'raw' }),
      /unsupported grpc-encoding.*identity/,
    );
  });
});
