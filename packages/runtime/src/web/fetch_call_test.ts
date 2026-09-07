import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { concat } from '@trpc-proto/utility';
import {
  GRPC_WEB_CONTENT_TYPE,
  GRPC_WEB_TEXT_CONTENT_TYPE,
  type GrpcWebEncoding,
} from './content_type.js';
import { GzipCompressionCodec } from './codec/compression.js';
import {
  GrpcWebFrameCodec,
  type GrpcWebFrame,
} from './codec/frame_codec.js';
import { GrpcWebError } from './codec/protocol_codec.js';
import { GrpcWebBase64Codec } from './codec/base64_codec.js'
import { createGrpcWebFetchCall } from './fetch_call.js';
const gzipCodec = new GzipCompressionCodec();
const frameCodec = new GrpcWebFrameCodec();
const base64Codec = new GrpcWebBase64Codec();


function encodeResponse(
  encoding: GrpcWebEncoding,
  frames: readonly Uint8Array[],
): Uint8Array | string {
  return encoding === 'base64'
    ? frames.map((frame) => base64Codec.encode(frame)).join('')
    : concat([...frames]);
}

function encodeMessageFrame(
  payload: Uint8Array,
  compressed = false,
): Uint8Array {
  return frameCodec.encode({ kind: 'message', compressed, payload });
}
function encodeTrailers(status: number, message = ''): Uint8Array {
  return frameCodec.encode({
    kind: 'trailers',
    trailers: {
      'grpc-status': String(status),
      'grpc-message': message,
    },
  });
}

async function decodeFrames(
  body: BodyInit | null | undefined,
  encoding: GrpcWebEncoding,
): Promise<GrpcWebFrame[]> {
  assert(body instanceof Uint8Array);
  const encoded =
    encoding === 'base64'
      ? base64Codec.decode(new TextDecoder().decode(body))
      : body;
  const frames: GrpcWebFrame[] = [];
  for await (const frame of frameCodec.decode(encoded)) frames.push(frame);
  return frames;
}

async function decodeGzip(payload: Uint8Array): Promise<Uint8Array> {
  let decoded: Uint8Array | undefined;
  for await (const value of gzipCodec.decode(payload)) decoded = value;
  assert(decoded);
  return decoded;
}


async function withFetch<T>(
  implementation: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

describe('createGrpcWebFetchCall compression', () => {
  it('gzip-compresses a text request before framing', async () => {
    const expectedRequest = new TextEncoder().encode('protobuf '.repeat(64));
    let requestHeaders = new Headers();
    let requestFrames: GrpcWebFrame[] | undefined;
    const responseBody = encodeResponse('base64', [
      encodeMessageFrame(new Uint8Array([9])),
      encodeTrailers(0),
    ]);

    const response = await withFetch(
      async (_input, init) => {
        requestHeaders = new Headers(init?.headers);
        assert(init?.body instanceof Uint8Array);
        requestFrames = await decodeFrames(init.body, 'base64');
        return new Response(responseBody, {
          headers: { 'content-type': GRPC_WEB_TEXT_CONTENT_TYPE },
        });
      },
      async () => {
        const call = createGrpcWebFetchCall({
          encoding: 'base64',
          compress: true,
        });
        return call({
          path: 'query',
          type: 'query',
          input: undefined,
          bytes: expectedRequest,
          grpcPath: '/demo.v1.AppService/Query',
        });
      },
    );

    assert.deepEqual(response, new Uint8Array([9]));
    assert.equal(requestHeaders.get('grpc-encoding'), 'gzip');
    assert.equal(requestHeaders.get('grpc-accept-encoding'), 'gzip');
    const message = requestFrames?.find((frame) => frame.kind === 'message');
    assert.equal(message?.compressed, true);
    assert.deepEqual(
      await decodeGzip(message!.payload),
      expectedRequest,
    );
  });

  it('decodes compressed unary responses in binary and text modes', async () => {
    const expected = new TextEncoder().encode('response '.repeat(64));
    const compressed = await gzipCodec.encode(expected);

    for (const encoding of ['raw', 'base64'] as const) {
      const body = encodeResponse(encoding, [
        encodeMessageFrame(compressed, true),
        encodeTrailers(0),
      ]);
      const contentType =
        encoding === 'base64'
          ? GRPC_WEB_TEXT_CONTENT_TYPE
          : GRPC_WEB_CONTENT_TYPE;
      const response = await withFetch(
        async () =>
          new Response(body, {
            headers: {
              'content-type': contentType,
              'grpc-encoding': 'gzip',
            },
          }),
        async () => {
          const call = createGrpcWebFetchCall({ encoding });
          return call({
            path: 'query',
            type: 'query',
            input: undefined,
            bytes: new Uint8Array(),
            grpcPath: '/demo.v1.AppService/Query',
          });
        },
      );
      assert.deepEqual(response, expected, encoding);
    }
  });

  it('decodes compressed text response streams across transport chunks', async () => {
    const expected = [
      new TextEncoder().encode('first '.repeat(32)),
      new TextEncoder().encode('second '.repeat(32)),
    ];
    const frames = [
      encodeMessageFrame(
        await gzipCodec.encode(expected[0]!),
        true,
      ),
      encodeMessageFrame(expected[1]!),
      encodeTrailers(0),
    ];
    const encoded = encodeResponse('base64', frames) as string;
    const widths = [1, 2, 5, 3, 8, 13];
    const chunks: Uint8Array[] = [];
    let offset = 0;
    let widthIndex = 0;
    while (offset < encoded.length) {
      const width = widths[widthIndex++ % widths.length]!;
      chunks.push(
        new TextEncoder().encode(encoded.slice(offset, offset + width)),
      );
      offset += width;
    }

    const response = await withFetch(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk);
              controller.close();
            },
          }),
          {
            headers: {
              'content-type': GRPC_WEB_TEXT_CONTENT_TYPE,
              'grpc-encoding': 'gzip',
            },
          },
        ),
      async () => {
        const call = createGrpcWebFetchCall({ encoding: 'base64' });
        return call({
          path: 'watch',
          type: 'subscription',
          input: undefined,
          bytes: new Uint8Array(),
          grpcPath: '/demo.v1.AppService/Watch',
        });
      },
    );

    const messages: Uint8Array[] = [];
    for await (const message of response as AsyncIterable<Uint8Array>) {
      messages.push(message);
    }
    assert.deepEqual(messages, expected);
  });

  it('rejects a compressed response without grpc-encoding', async () => {
    const compressed = await gzipCodec.encode(new Uint8Array([1]));
    await withFetch(
      async () =>
        new Response(
          encodeResponse('raw', [
            encodeMessageFrame(compressed, true),
            encodeTrailers(0),
          ]),
          { headers: { 'content-type': GRPC_WEB_CONTENT_TYPE } },
        ),
      async () => {
        const call = createGrpcWebFetchCall();
        await assert.rejects(
          call({
            path: 'query',
            type: 'query',
            input: undefined,
            bytes: new Uint8Array(),
            grpcPath: '/demo.v1.AppService/Query',
          }),
          /unsupported grpc-encoding.*identity/,
        );
      },
    );
  });

  it('rejects unary and streaming grpc-status failures', async () => {
    const unaryBody = encodeResponse('raw', [
      encodeTrailers(7, 'denied'),
    ]);
    await withFetch(
      async () =>
        new Response(unaryBody, {
          headers: { 'content-type': GRPC_WEB_CONTENT_TYPE },
        }),
      async () => {
        const call = createGrpcWebFetchCall();
        await assert.rejects(
          call({
            path: 'query',
            type: 'query',
            input: undefined,
            bytes: new Uint8Array(),
            grpcPath: '/demo.v1.AppService/Query',
          }),
          (error: unknown) =>
            error instanceof GrpcWebError &&
            error.code === 7 &&
            error.message === 'denied',
        );
      },
    );

    const streamBody = encodeResponse('raw', [
      encodeMessageFrame(new Uint8Array([1])),
      encodeTrailers(14, 'unavailable'),
    ]);
    await withFetch(
      async () =>
        new Response(streamBody, {
          headers: { 'content-type': GRPC_WEB_CONTENT_TYPE },
        }),
      async () => {
        const call = createGrpcWebFetchCall();
        const response = await call({
          path: 'watch',
          type: 'subscription',
          input: undefined,
          bytes: new Uint8Array(),
          grpcPath: '/demo.v1.AppService/Watch',
        });
        const iterator = (
          response as AsyncIterable<Uint8Array>
        )[Symbol.asyncIterator]();
        assert.deepEqual(await iterator.next(), {
          done: false,
          value: new Uint8Array([1]),
        });
        await assert.rejects(
          iterator.next(),
          (error: unknown) =>
            error instanceof GrpcWebError &&
            error.code === 14 &&
            error.message === 'unavailable',
        );
      },
    );
  });

  it('streams binary response frames', async () => {
    const body = encodeResponse('raw', [
      encodeMessageFrame(new Uint8Array([1])),
      encodeMessageFrame(new Uint8Array([2, 3])),
      encodeTrailers(0),
    ]);
    await withFetch(
      async () =>
        new Response(body, {
          headers: { 'content-type': GRPC_WEB_CONTENT_TYPE },
        }),
      async () => {
        const call = createGrpcWebFetchCall({ encoding: 'raw' });
        const response = await call({
          path: 'watch',
          type: 'subscription',
          input: undefined,
          bytes: new Uint8Array(),
          grpcPath: '/demo.v1.AppService/Watch',
        });
        const messages: Uint8Array[] = [];
        for await (const message of response as AsyncIterable<Uint8Array>) {
          messages.push(message);
        }
        assert.deepEqual(messages, [
          new Uint8Array([1]),
          new Uint8Array([2, 3]),
        ]);
      },
    );
  });

  it('rejects missing bodies, paths, and malformed compressed payloads', async () => {
    const call = createGrpcWebFetchCall();
    await assert.rejects(
      call({
        path: 'query',
        type: 'query',
        input: undefined,
        bytes: new Uint8Array(),
      }),
      /grpcPath required/,
    );

    await withFetch(
      async (_input, init) => {
        assert.equal(
          new Headers(init?.headers).get('content-type'),
          GRPC_WEB_TEXT_CONTENT_TYPE,
        );
        assert(init?.body instanceof Uint8Array);
        return new Response(null, {
          headers: { 'content-type': GRPC_WEB_CONTENT_TYPE },
        });
      },
      async () => {
        const response = await call({
          path: 'watch',
          type: 'subscription',
          input: undefined,
          bytes: new Uint8Array(),
          grpcPath: '/demo.v1.AppService/Watch',
        });
        await assert.rejects(
          (
            response as AsyncIterable<Uint8Array>
          )[Symbol.asyncIterator]().next(),
          /empty gRPC-Web body/,
        );
      },
    );

    await withFetch(
      async () =>
        new Response(
          encodeResponse('raw', [
            encodeMessageFrame(new Uint8Array([0x1f, 0x8b, 0x00]), true),
            encodeTrailers(0),
          ]),
          {
            headers: {
              'content-type': GRPC_WEB_CONTENT_TYPE,
              'grpc-encoding': 'gzip',
            },
          },
        ),
      async () => {
        await assert.rejects(
          call({
            path: 'query',
            type: 'query',
            input: undefined,
            bytes: new Uint8Array(),
            grpcPath: '/demo.v1.AppService/Query',
          }),
          (error: unknown) =>
            error instanceof GrpcWebError && error.code === 13,
        );
      },
    );
  });

  it('uses HTTP failure as status when trailers omit grpc-status', async () => {
    await withFetch(
      async () =>
        new Response(encodeMessageFrame(new Uint8Array([1])), {
          status: 503,
          headers: { 'content-type': GRPC_WEB_CONTENT_TYPE },
        }),
      async () => {
        const call = createGrpcWebFetchCall();
        await assert.rejects(
          call({
            path: 'query',
            type: 'query',
            input: undefined,
            bytes: new Uint8Array(),
            grpcPath: '/demo.v1.AppService/Query',
          }),
          (error: unknown) =>
            error instanceof GrpcWebError && error.code === 2,
        );
      },
    );
  });

});
