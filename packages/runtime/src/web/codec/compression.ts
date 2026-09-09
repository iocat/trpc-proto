import { codecChunks, type Codec, type CodecInput } from './codec.js';

/** Standard gzip grpc-encoding token. */
export const GRPC_GZIP_ENCODING = 'gzip';

/** Message compressor selected by a grpc-encoding token. */
export interface GrpcWebCompressionCodec extends Codec<Uint8Array, Uint8Array> {
  readonly name: string;
}

async function transform(
  message: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const output = new Response(stream.readable).arrayBuffer();
  const writing = writer.write(message).then(() => writer.close());
  const [buffer] = await Promise.all([output, writing]);
  return new Uint8Array(buffer);
}

export class GzipCompressionCodec implements GrpcWebCompressionCodec {
  readonly name = GRPC_GZIP_ENCODING;

  encode(message: Uint8Array): Promise<Uint8Array> {
    return transform(message, new CompressionStream(GRPC_GZIP_ENCODING));
  }

  async *decode(encoded: CodecInput<Uint8Array>): AsyncIterable<Uint8Array> {
    for await (const message of codecChunks(encoded)) {
      yield await transform(
        message,
        new DecompressionStream(GRPC_GZIP_ENCODING),
      );
    }
  }
}

const COMPRESSION_CODEC_FACTORIES: Record<
  string,
  () => GrpcWebCompressionCodec
> = {
  [GRPC_GZIP_ENCODING]: () => new GzipCompressionCodec(),
};

/** Finds a supported codec for a grpc-encoding header value. */
export function grpcWebCompressionCodec(
  encoding: string | null | undefined,
): GrpcWebCompressionCodec | undefined {
  const name = encoding?.trim().toLowerCase();
  if (!name || name === 'identity') return undefined;
  return COMPRESSION_CODEC_FACTORIES[name]?.();
}
