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

/**
 * Stateful, synchronous parser behind a streaming {@link Codec}.
 *
 * One instance belongs to exactly one input stream. `push` consumes the next
 * transport chunk and returns every complete value now available while
 * retaining incomplete input internally. `finish` must be called once after
 * the final chunk; it returns any remaining complete values and rejects
 * truncated or otherwise incomplete input.
 *
 * Keeping this contract synchronous separates byte parsing from the
 * asynchronous traversal performed by `Codec.decode`.
 *
 * @internal
 */
export interface IncrementalDecoder<Chunk, Value> {
  /** Consume one chunk and return zero or more newly completed values. */
  push(chunk: Chunk): readonly Value[];

  /** Finalize the stream and validate all buffered input was consumed. */
  finish(): readonly Value[];
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

