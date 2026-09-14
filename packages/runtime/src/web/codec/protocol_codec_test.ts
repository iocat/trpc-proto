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

function rawTrailers(trailers: Record<string, string>): Uint8Array {
  const payload = new TextEncoder().encode(
    `${Object.entries(trailers)
      .map(([name, value]) => `${name}: ${value}`)
      .join('\r\n')}\r\n`,
  );
  const frame = new Uint8Array(5 + payload.byteLength);
  frame[0] = 0x80;
  new DataView(frame.buffer).setUint32(1, payload.byteLength);
  frame.set(payload, 5);
  return frame;
}

describe('gRPC-Web protocol codec', () => {
  it('round-trips raw messages and protected trailers', async () => {
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

  it('percent-decodes received grpc-message values', async () => {
    const message = 'permission denied: snow ☃%';
    const encoded = await protocolCodec.encode(
      { kind: 'trailers', status: 7, message },
      { encoding: 'raw' },
    );

    assert.deepEqual(await decode(encoded, { encoding: 'raw' }), [
      { kind: 'trailers', status: 7, message, metadata: {} },
    ]);
  });

  it('rejects missing, malformed, and out-of-range grpc-status values', async () => {
    for (const encodedStatus of [
      undefined,
      '',
      '+0',
      '-1',
      '0x0',
      '1.5',
      '17',
      '9007199254740992',
    ]) {
      const trailers: Record<string, string> = { 'grpc-message': '' };
      if (encodedStatus !== undefined) {
        trailers['grpc-status'] = encodedStatus;
      }
      await assert.rejects(
        async () => decode(rawTrailers(trailers), { encoding: 'raw' }),
        (error: unknown) =>
          error instanceof GrpcWebError &&
          error.code === 2 &&
          /grpc-status trailer/.test(error.message),
        JSON.stringify(encodedStatus),
      );
    }
  });

  it('rejects malformed grpc-message percent encoding', async () => {
    await assert.rejects(
      async () =>
        decode(
          rawTrailers({
            'grpc-status': '7',
            'grpc-message': 'bad%GGencoding',
          }),
          { encoding: 'raw' },
        ),
      (error: unknown) =>
        error instanceof GrpcWebError &&
        error.code === 2 &&
        /invalid grpc-message trailer/.test(error.message),
    );
  });

  it('streams base64 chunks and decompresses gzip messages', async () => {
    const payload = new TextEncoder().encode('response '.repeat(64));
    const encoded = await protocolCodec.encode(
      { kind: 'message', payload },
      { encoding: 'base64', compression: 'gzip' },
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

  it('rejects compressed messages without their encoding', async () => {
    const encoded = await protocolCodec.encode(
      { kind: 'message', payload: new Uint8Array([1]) },
      { encoding: 'raw', compression: 'gzip' },
    );
    await assert.rejects(
      async () => decode(encoded, { encoding: 'raw' }),
      /unsupported grpc-encoding.*identity/,
    );
  });
});
