import { Status as grpcStatus } from '@grpc/grpc-js/build/src/constants.js';
import { assumeExhaustive } from '@trpc-proto/utility';
import type { GrpcWebEncoding } from '../content_type.js';
import { codecChunks, type Codec, type CodecInput } from './codec.js';
import { GRPC_GZIP_ENCODING, grpcWebCompressionCodec } from './compression.js';
import { GrpcWebFrameCodec, type GrpcWebFrame } from './frame_codec.js';
import { GrpcWebBase64Codec } from './base64_codec.js';

/**
 * gRPC-Web HTTP headers used to communicate the final status of a call.
 */
export const GRPC_STATUS_HEADER = 'grpc-status';
/** gRPC-Web HTTP headers used to communicate the final status message of a call. */
export const GRPC_MESSAGE_HEADER = 'grpc-message';

/** One protobuf message independent of its gRPC-Web wire representation. */
export interface GrpcWebProtocolMessage {
  readonly kind: 'message';
  readonly payload: Uint8Array;
}

/** Final gRPC status and metadata independent of its trailer frame. */
export interface GrpcWebProtocolTrailers {
  readonly kind: 'trailers';
  readonly status: number;
  readonly message: string;
  readonly metadata?: Record<string, string>;
}

/** Semantic value encoded in a gRPC-Web HTTP body. */
export type GrpcWebProtocolValue =
  | GrpcWebProtocolMessage
  | GrpcWebProtocolTrailers;

/** Wire choices applied by the protocol codec. */
export interface GrpcWebProtocolCodecOptions {
  readonly encoding: GrpcWebEncoding;
  readonly compress?: boolean;
  readonly compression?: string | null;
}

/** Error represented by a non-zero or malformed gRPC-Web status. */
export class GrpcWebError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'GrpcWebError';
    this.code = code;
  }
}

function parseGrpcStatus(encoded: string | undefined): grpcStatus {
  if (encoded === undefined) {
    throw new GrpcWebError(grpcStatus.UNKNOWN, 'missing grpc-status trailer');
  }
  if (!/^[0-9]+$/u.test(encoded)) {
    throw new GrpcWebError(
      grpcStatus.UNKNOWN,
      `invalid grpc-status trailer: ${JSON.stringify(encoded)}`,
    );
  }
  const status = Number(encoded);
  if (
    !Number.isSafeInteger(status) ||
    status < grpcStatus.OK ||
    status > grpcStatus.UNAUTHENTICATED
  ) {
    throw new GrpcWebError(
      grpcStatus.UNKNOWN,
      `invalid grpc-status trailer: ${JSON.stringify(encoded)}`,
    );
  }
  return status;
}

function decodeGrpcMessage(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new GrpcWebError(
      grpcStatus.UNKNOWN,
      `invalid grpc-message trailer: ${JSON.stringify(encoded)}`,
    );
  }
}

function trailerFrame(value: GrpcWebProtocolTrailers): GrpcWebFrame {
  const trailers: Record<string, string> = {
    [GRPC_STATUS_HEADER]: String(value.status),
    [GRPC_MESSAGE_HEADER]: value.message,
  };
  for (const [key, metadataValue] of Object.entries(value.metadata ?? {})) {
    const name = key.toLowerCase();
    if (name === GRPC_STATUS_HEADER || name === GRPC_MESSAGE_HEADER) continue;
    trailers[name] = metadataValue;
  }
  return { kind: 'trailers', trailers };
}

async function* base64Chunks(
  encoded: CodecInput<Uint8Array>,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  for await (const chunk of codecChunks(encoded)) {
    const text = decoder.decode(chunk, { stream: true });
    if (text) yield text;
  }
  const finalText = decoder.decode();
  if (finalText) yield finalText;
}

async function decodeCompressedMessage(
  payload: Uint8Array,
  encoding: string | null | undefined,
): Promise<Uint8Array> {
  const compression = grpcWebCompressionCodec(encoding);
  if (!compression) {
    throw new Error(
      `unsupported grpc-encoding for compressed message: ${encoding ?? 'identity'}`,
    );
  }
  let decoded: Uint8Array | undefined;
  for await (const value of compression.decode(payload)) {
    if (decoded)
      throw new Error('compression codec returned multiple messages');
    decoded = value;
  }
  if (!decoded) throw new Error('compression codec returned no message');
  return decoded;
}

/** Composes frames, compression, and body encoding through Codec only. */
export class GrpcWebProtocolCodec implements Codec<
  GrpcWebProtocolValue,
  Uint8Array,
  GrpcWebProtocolCodecOptions
> {
  readonly #frameCodec = new GrpcWebFrameCodec();
  readonly #base64Codec = new GrpcWebBase64Codec();

  async encode(
    value: GrpcWebProtocolValue,
    options: GrpcWebProtocolCodecOptions = { encoding: 'base64' },
  ): Promise<Uint8Array> {
    let frame: GrpcWebFrame;
    switch (value.kind) {
      case 'message':
        if (options.compress) {
          const encoding = options.compression ?? GRPC_GZIP_ENCODING;
          const compression = grpcWebCompressionCodec(encoding);
          if (!compression) {
            throw new GrpcWebError(
              12,
              `unsupported grpc-encoding: ${encoding}`,
            );
          }
          frame = {
            kind: 'message',
            compressed: true,
            payload: await compression.encode(value.payload),
          };
        } else {
          frame = {
            kind: 'message',
            compressed: false,
            payload: value.payload,
          };
        }
        break;
      case 'trailers':
        frame = trailerFrame(value);
        break;
      default:
        return assumeExhaustive(value);
    }

    const encodedFrame = await this.#frameCodec.encode(frame);
    if (options.encoding === 'raw') return encodedFrame;
    const base64 = await this.#base64Codec.encode(encodedFrame);
    return new TextEncoder().encode(base64);
  }

  async *decode(
    encoded: CodecInput<Uint8Array>,
    options: GrpcWebProtocolCodecOptions = { encoding: 'base64' },
  ): AsyncIterable<GrpcWebProtocolValue> {
    const body =
      options.encoding === 'base64'
        ? this.#base64Codec.decode(base64Chunks(encoded))
        : codecChunks(encoded);

    for await (const frame of this.#frameCodec.decode(body)) {
      switch (frame.kind) {
        case 'message':
          if (!frame.compressed) {
            yield { kind: 'message', payload: frame.payload };
            break;
          }
          try {
            yield {
              kind: 'message',
              payload: await decodeCompressedMessage(
                frame.payload,
                options.compression,
              ),
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            throw new GrpcWebError(13, message);
          }
          break;
        case 'trailers': {
          const {
            [GRPC_STATUS_HEADER]: encodedStatus,
            [GRPC_MESSAGE_HEADER]: message = '',
            ...metadata
          } = frame.trailers;
          yield {
            kind: 'trailers',
            status: parseGrpcStatus(encodedStatus),
            message: decodeGrpcMessage(message),
            metadata,
          };
          break;
        }
        default:
          assumeExhaustive(frame);
      }
    }
  }
}
