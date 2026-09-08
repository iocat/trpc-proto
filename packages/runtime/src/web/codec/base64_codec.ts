import {
  codecChunks,
  type Codec,
  type CodecInput,
  type IncrementalCodec,
} from './codec.js';

const BINARY_STRING_CHUNK_SIZE = 0x4000;
const NO_BINARY_CHUNKS: readonly Uint8Array[] = [];


function decodeBase64Segment(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

class TextDecoder implements IncrementalCodec<string, Uint8Array> {
  #pending = '';

  push(chunk: string): readonly Uint8Array[] {
    this.#pending += chunk.replace(/\s/g, '');
    return this.#decodeCompleteSegments();
  }

  finish(): readonly Uint8Array[] {
    const decoded = this.#decodeCompleteSegments();
    if (this.#pending.length > 0) {
      throw new Error('truncated gRPC-Web text body');
    }
    return decoded.length > 0 ? decoded : NO_BINARY_CHUNKS;
  }

  #decodeCompleteSegments(): Uint8Array[] {
    const decoded: Uint8Array[] = [];
    while (this.#pending.length >= 4) {
      const paddingIndex = this.#pending.indexOf('=');
      const encodedLength =
        paddingIndex < 0
          ? this.#pending.length - (this.#pending.length % 4)
          : Math.ceil((paddingIndex + 1) / 4) * 4;
      if (encodedLength === 0 || this.#pending.length < encodedLength) break;
      decoded.push(decodeBase64Segment(this.#pending.slice(0, encodedLength)));
      this.#pending = this.#pending.slice(encodedLength);
    }
    return decoded;
  }
}

/** Base64 gRPC-Web body codec. */
export class GrpcWebBase64Codec implements Codec<Uint8Array, string> {
  encode(body: Uint8Array): string {
    const chunks: string[] = [];
    for (
      let offset = 0;
      offset < body.length;
      offset += BINARY_STRING_CHUNK_SIZE
    ) {
      chunks.push(
        String.fromCharCode(
          ...body.subarray(offset, offset + BINARY_STRING_CHUNK_SIZE),
        ),
      );
    }
    return btoa(chunks.join(''));
  }

  async *decode(
    encoded: CodecInput<string>,
  ): AsyncIterable<Uint8Array> {
    const decoder = new TextDecoder();
    for await (const chunk of codecChunks(encoded)) {
      yield* decoder.push(chunk);
    }
    yield* decoder.finish();
  }
}

