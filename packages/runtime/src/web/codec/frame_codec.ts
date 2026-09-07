import { concat } from '@trpc-proto/utility';
import { codecChunks, type Codec, type CodecInput } from './codec.js';

const TRAILER_FLAG = 0x80;
const COMPRESSED_FLAG = 0x01;
const NO_FRAMES: readonly GrpcWebFrame[] = [];


/** One protobuf data frame. */
export interface GrpcWebMessageFrame {
  kind: 'message';
  compressed: boolean;
  payload: Uint8Array;
}

/** One uncompressed in-body trailer frame. */
export interface GrpcWebTrailerFrame {
  kind: 'trailers';
  trailers: Record<string, string>;
}

/** Complete frame emitted by the incremental binary decoder. */
export type GrpcWebFrame = GrpcWebMessageFrame | GrpcWebTrailerFrame;


function writeLength(out: Uint8Array, length: number) {
  out[1] = (length >>> 24) & 0xff;
  out[2] = (length >>> 16) & 0xff;
  out[3] = (length >>> 8) & 0xff;
  out[4] = length & 0xff;
}

function byte(buf: Uint8Array, offset: number) {
  const value = buf[offset];
  if (value === undefined) throw new Error('truncated gRPC-Web frame');
  return value;
}

function readLength(buf: Uint8Array, offset: number) {
  return (
    ((byte(buf, offset) << 24) |
      (byte(buf, offset + 1) << 16) |
      (byte(buf, offset + 2) << 8) |
      byte(buf, offset + 3)) >>>
    0
  );
}

function encodeRawFrame(payload: Uint8Array, flags: number) {
  const out = new Uint8Array(5 + payload.length);
  out[0] = flags;
  writeLength(out, payload.length);
  out.set(payload, 5);
  return out;
}

function decodeTrailers(payload: Uint8Array): Record<string, string> {
  const trailers: Record<string, string> = {};
  const text = new TextDecoder().decode(payload);
  for (const line of text.split('\r\n')) {
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    trailers[line.slice(0, colon).trim().toLowerCase()] = line
      .slice(colon + 1)
      .trim();
  }
  return trailers;
}

function encodeGrpcMessage(value: string) {
  return [...new TextEncoder().encode(value)]
    .map((byteValue) =>
      byteValue === 0x25 || byteValue < 0x20 || byteValue > 0x7e
        ? `%${byteValue.toString(16).toUpperCase().padStart(2, '0')}`
        : String.fromCharCode(byteValue),
    )
    .join('');
}


class FrameDecoder {
  #buffer = new Uint8Array();

  push(chunk: Uint8Array): readonly GrpcWebFrame[] {
    if (chunk.byteLength > 0) this.#buffer = concat([this.#buffer, chunk]);
    const frames: GrpcWebFrame[] = [];
    while (this.#buffer.length >= 5) {
      const flags = byte(this.#buffer, 0);
      const length = readLength(this.#buffer, 1);
      if (this.#buffer.length < 5 + length) break;
      const payload = this.#buffer.subarray(5, 5 + length);
      this.#buffer = this.#buffer.subarray(5 + length);
      const trailer = Boolean(flags & TRAILER_FLAG);
      const compressed = Boolean(flags & COMPRESSED_FLAG);
      if (trailer && compressed) {
        throw new Error('compressed gRPC-Web trailers are not supported');
      }
      frames.push(
        trailer
          ? { kind: 'trailers', trailers: decodeTrailers(payload) }
          : { kind: 'message', compressed, payload },
      );
    }
    return frames;
  }

  finish(): readonly GrpcWebFrame[] {
    if (this.#buffer.length > 0) {
      throw new Error(
        this.#buffer.length < 5
          ? 'truncated gRPC-Web frame header'
          : 'truncated gRPC-Web frame',
      );
    }
    return NO_FRAMES;
  }
}

/** Binary gRPC-Web frame codec. */
export class GrpcWebFrameCodec
  implements Codec<GrpcWebFrame, Uint8Array>
{
  encode(frame: GrpcWebFrame): Uint8Array {
    if (frame.kind === 'message') {
      return encodeRawFrame(
        frame.payload,
        frame.compressed ? COMPRESSED_FLAG : 0,
      );
    }
    const lines = Object.entries(frame.trailers).map(
      ([name, value]) =>
        `${name.toLowerCase()}: ${encodeGrpcMessage(value)}`,
    );
    return encodeRawFrame(
      new TextEncoder().encode(`${lines.join('\r\n')}\r\n`),
      TRAILER_FLAG,
    );
  }

  async *decode(
    encoded: CodecInput<Uint8Array>,
  ): AsyncIterable<GrpcWebFrame> {
    const decoder = new FrameDecoder();
    for await (const chunk of codecChunks(encoded)) {
      yield* decoder.push(chunk);
    }
    yield* decoder.finish();
  }

}

