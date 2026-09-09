import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GrpcWebFrameCodec, type GrpcWebFrame } from './frame_codec.js';

const frameCodec = new GrpcWebFrameCodec();

async function decode(encoded: Uint8Array): Promise<GrpcWebFrame[]> {
  const frames: GrpcWebFrame[] = [];
  for await (const frame of frameCodec.decode(encoded)) frames.push(frame);
  return frames;
}

describe('gRPC-Web frame codec', () => {
  it('round-trips data and trailer frames', async () => {
    const message = await frameCodec.encode({
      kind: 'message',
      compressed: false,
      payload: new Uint8Array([1, 2, 3]),
    });
    const trailers = await frameCodec.encode({
      kind: 'trailers',
      trailers: { 'grpc-status': '0', 'grpc-message': 'ok' },
    });

    assert.deepEqual(await decode(new Uint8Array([...message, ...trailers])), [
      {
        kind: 'message',
        compressed: false,
        payload: new Uint8Array([1, 2, 3]),
      },
      {
        kind: 'trailers',
        trailers: { 'grpc-status': '0', 'grpc-message': 'ok' },
      },
    ]);
  });

  it('preserves extra trailer metadata', async () => {
    const encoded = await frameCodec.encode({
      kind: 'trailers',
      trailers: {
        'grpc-status': '5',
        'grpc-message': 'missing',
        'x-trace': 'abc',
      },
    });
    assert.deepEqual(await decode(encoded), [
      {
        kind: 'trailers',
        trailers: {
          'grpc-status': '5',
          'grpc-message': 'missing',
          'x-trace': 'abc',
        },
      },
    ]);
  });

  it('extracts frames split across binary chunks', async () => {
    const first = await frameCodec.encode({
      kind: 'message',
      compressed: false,
      payload: new Uint8Array([1, 2]),
    });
    const second = await frameCodec.encode({
      kind: 'trailers',
      trailers: { 'grpc-status': '0' },
    });
    const body = new Uint8Array([...first, ...second]);
    async function* chunks() {
      yield body.subarray(0, 3);
      yield body.subarray(3, 11);
      yield body.subarray(11);
    }

    const frames: GrpcWebFrame[] = [];
    for await (const frame of frameCodec.decode(chunks())) frames.push(frame);
    assert.equal(frames.length, 2);
    assert.deepEqual(frames[0], {
      kind: 'message',
      compressed: false,
      payload: new Uint8Array([1, 2]),
    });
  });

  it('round-trips the compressed message flag', async () => {
    const encoded = await frameCodec.encode({
      kind: 'message',
      compressed: true,
      payload: new Uint8Array([1, 2]),
    });
    assert.equal(encoded[0], 0x01);
    assert.deepEqual(await decode(encoded), [
      {
        kind: 'message',
        compressed: true,
        payload: new Uint8Array([1, 2]),
      },
    ]);
  });

  it('rejects truncated frame headers and payloads', async () => {
    for (const row of [
      {
        name: 'header',
        body: new Uint8Array([0, 0, 0, 0]),
        message: /truncated gRPC-Web frame header/,
      },
      {
        name: 'payload',
        body: new Uint8Array([0, 0, 0, 0, 2, 1]),
        message: /truncated gRPC-Web frame$/,
      },
    ]) {
      await assert.rejects(async () => decode(row.body), row.message, row.name);
    }
  });

  it('percent-encodes trailer values', async () => {
    const encoded = await frameCodec.encode({
      kind: 'trailers',
      trailers: {
        'grpc-status': '5',
        'grpc-message': 'snow ☃%',
        'x-detail': 'line\nbreak',
      },
    });
    const [frame] = await decode(encoded);
    assert(frame?.kind === 'trailers');
    assert.equal(frame.trailers['grpc-message'], 'snow %E2%98%83%25');
    assert.equal(frame.trailers['x-detail'], 'line%0Abreak');
  });

  it('rejects compressed trailer frames', async () => {
    const trailers = await frameCodec.encode({
      kind: 'trailers',
      trailers: { 'grpc-status': '0' },
    });
    trailers[0] = 0x81;
    await assert.rejects(
      async () => decode(trailers),
      /compressed gRPC-Web trailers are not supported/,
    );
  });
});
