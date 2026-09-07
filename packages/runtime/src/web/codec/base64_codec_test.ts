import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { concat } from '@trpc-proto/utility';
import { GrpcWebFrameCodec, type GrpcWebFrame } from './frame_codec.js';
import { GrpcWebBase64Codec } from './base64_codec.js'

const frameCodec = new GrpcWebFrameCodec();
const base64Codec = new GrpcWebBase64Codec();

async function decodeChunks(chunks: readonly string[]): Promise<Uint8Array> {
  async function* encodedChunks() {
    yield* chunks;
  }
  const decoded: Uint8Array[] = [];
  for await (const chunk of base64Codec.decode(encodedChunks())) {
    decoded.push(chunk);
  }
  return concat(decoded);
}

async function decodeFrames(chunks: readonly string[]): Promise<GrpcWebFrame[]> {
  async function* encodedChunks() {
    yield* chunks;
  }
  const frames: GrpcWebFrame[] = [];
  for await (const frame of frameCodec.decode(base64Codec.decode(encodedChunks()))) {
    frames.push(frame);
  }
  return frames;
}

describe('gRPC-Web base64 codec', () => {
  it('decodes every partition of independently padded segments', async () => {
    const expected = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const encoded =
      (await base64Codec.encode(expected.subarray(0, 1))) +
      (await base64Codec.encode(expected.subarray(1, 3))) +
      (await base64Codec.encode(expected.subarray(3)));
    assert.equal(encoded, 'AQ==AgM=BAUG');

    const partitionCount = 1 << (encoded.length - 1);
    for (let mask = 0; mask < partitionCount; mask++) {
      const chunks: string[] = [];
      let start = 0;
      for (let index = 1; index < encoded.length; index++) {
        if (mask & (1 << (index - 1))) {
          chunks.push(encoded.slice(start, index));
          start = index;
        }
      }
      chunks.push(encoded.slice(start));
      assert.deepEqual(await decodeChunks(chunks), expected);
    }
  });

  it('round-trips every short base64 remainder', async () => {
    for (let length = 0; length <= 12; length++) {
      const expected = Uint8Array.from({ length }, (_, index) => index);
      const encoded = await base64Codec.encode(expected);
      assert.deepEqual(await decodeChunks([encoded]), expected);
    }
  });

  it('round-trips input larger than the binary-string chunk size', async () => {
    const expected = Uint8Array.from(
      { length: 0x4000 * 2 + 7 },
      (_, index) => index % 251,
    );
    const encoded = await base64Codec.encode(expected);
    assert.deepEqual(await decodeChunks([encoded]), expected);
  });

  it('composes with frame decoding at every transport width', async () => {
    const messages = await Promise.all(
      [
        new Uint8Array([1, 2]),
        new Uint8Array([3, 4, 5]),
        new Uint8Array([6, 7, 8, 9]),
      ].map((payload) =>
        frameCodec.encode({ kind: 'message', compressed: false, payload }),
      ),
    );
    const trailer = await frameCodec.encode({
      kind: 'trailers',
      trailers: { 'grpc-status': '0', 'grpc-message': 'ok' },
    });
    const segments = await Promise.all(
      [...messages, trailer].map((frame) => base64Codec.encode(frame)),
    );
    const encoded = segments.join('');

    for (let width = 1; width <= encoded.length; width++) {
      const chunks: string[] = [];
      for (let offset = 0; offset < encoded.length; offset += width) {
        chunks.push(encoded.slice(offset, offset + width));
      }
      const frames = await decodeFrames(chunks);
      assert.equal(frames.length, 4, `transport width ${width}`);
    }
  });

  it('ignores whitespace across base64 boundaries', async () => {
    const expected = new Uint8Array([1, 2, 3]);
    const encoded =
      (await base64Codec.encode(expected.subarray(0, 1))) +
      (await base64Codec.encode(expected.subarray(1)));
    assert.deepEqual(
      await decodeChunks([[...encoded].join(' \r\n\t')]),
      expected,
    );
  });

  it('rejects every incomplete final quartet length', async () => {
    for (const encoded of ['A', 'AQ', 'AQI']) {
      await assert.rejects(
        async () => decodeChunks([encoded]),
        /truncated gRPC-Web text body/,
      );
    }
  });

  it('rejects malformed base64 quartets', async () => {
    for (const encoded of ['!!!!', 'AQ=A', 'A===']) {
      await assert.rejects(async () => decodeChunks([encoded]));
    }
  });
});
