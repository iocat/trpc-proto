import { isAsyncIterable } from '@trpc-proto/utility';
import type { MaybePromise } from '../../types.js';

/** One encoded chunk or an asynchronous stream of encoded chunks. */
export type CodecInput<Encoded> = Encoded | AsyncIterable<Encoded>;

/** Minimal codec contract for complete values and streamed input. */
export interface Codec<Value, Encoded, Options = undefined> {
  /** Encodes one complete value. */
  encode(value: Value, options?: Options): MaybePromise<Encoded>;

  /** Decodes values incrementally from one chunk or a chunk stream. */
  decode(
    encoded: CodecInput<Encoded>,
    options?: Options,
  ): AsyncIterable<Value>;
}


/** Iterates uniformly over one encoded chunk or an asynchronous chunk stream. */
export async function* codecChunks<Chunk>(
  encoded: CodecInput<Chunk>,
): AsyncIterable<Chunk> {
  if (isAsyncIterable(encoded)) {
    yield* encoded;
  } else {
    yield encoded;
  }
}

