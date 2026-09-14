import { codecChunks, type Codec, type CodecInput } from './codec.js';

/** Standard identity grpc-encoding token. */
export const GRPC_IDENTITY_ENCODING = 'identity';
/** Standard gzip grpc-encoding token. */
export const GRPC_GZIP_ENCODING = 'gzip';

/** Message compression values supported by this gRPC-Web implementation. */
export type GrpcWebCompressionEncoding =
  typeof GRPC_IDENTITY_ENCODING | typeof GRPC_GZIP_ENCODING;

/** Message compressor selected by a grpc-encoding token. */
export interface GrpcWebCompressionCodec extends Codec<Uint8Array, Uint8Array> {
  readonly name: GrpcWebCompressionEncoding;
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
  Exclude<GrpcWebCompressionEncoding, typeof GRPC_IDENTITY_ENCODING>,
  () => GrpcWebCompressionCodec
> = {
  [GRPC_GZIP_ENCODING]: () => new GzipCompressionCodec(),
};

/** Parses an untrusted grpc-encoding header into a supported value. */
export function parseGrpcWebCompressionEncoding(
  encoding: string | null | undefined,
): GrpcWebCompressionEncoding {
  const normalized = encoding?.trim().toLowerCase() || GRPC_IDENTITY_ENCODING;
  if (
    normalized === GRPC_IDENTITY_ENCODING ||
    normalized === GRPC_GZIP_ENCODING
  ) {
    return normalized;
  }
  throw new Error(`unsupported grpc-encoding: ${normalized}`);
}

/** Finds the codec for a supported grpc-encoding value. */
export function grpcWebCompressionCodec(
  encoding: GrpcWebCompressionEncoding = GRPC_IDENTITY_ENCODING,
): GrpcWebCompressionCodec | undefined {
  if (encoding === GRPC_IDENTITY_ENCODING) return undefined;
  return COMPRESSION_CODEC_FACTORIES[encoding]();
}
