import { Status as grpcStatus } from '@grpc/grpc-js/build/src/constants.js';
import { assumeExhaustive } from '@trpc-proto/utility';
import type { StubCall } from '../grpc/proto_link.js';
import { GRPC_GZIP_ENCODING } from './codec/compression.js';
import { GrpcWebError, GrpcWebProtocolCodec } from './codec/protocol_codec.js';
import {
  grpcWebContentType,
  grpcWebEncoding,
  type GrpcWebEncoding,
} from './content_type.js';

/** Configuration for the browser or Node Fetch gRPC-Web transport. */
export interface GrpcWebFetchCallOptions {
  baseUrl?: string;
  /** HTTP body representation. Defaults to base64 gRPC-Web. */
  encoding?: GrpcWebEncoding;
  /** Compresses the request message with gzip. Defaults to false. */
  compress?: boolean;
}
const HTTP_STATUS_TO_GRPC_STATUS: Record<number, grpcStatus> = {
  400: grpcStatus.INTERNAL,
  401: grpcStatus.UNAUTHENTICATED,
  403: grpcStatus.PERMISSION_DENIED,
  404: grpcStatus.UNIMPLEMENTED,
  429: grpcStatus.UNAVAILABLE,
  502: grpcStatus.UNAVAILABLE,
  503: grpcStatus.UNAVAILABLE,
  504: grpcStatus.UNAVAILABLE,
};

/** Given the assumption is 200 with grpc-status trailers in the response, anything else is considered an error. */
function missingGrpcStatus(res: Response): GrpcWebError {
  return new GrpcWebError(
    HTTP_STATUS_TO_GRPC_STATUS[res.status] ?? grpcStatus.UNKNOWN,
    `missing grpc-status (HTTP ${res.status}) from gRPC-Web response: ${res.statusText}`,
  );
}

function responseEncoding(
  res: Response,
  fallback: GrpcWebEncoding,
): GrpcWebEncoding {
  return grpcWebEncoding(res.headers.get('content-type')) ?? fallback;
}

async function* readResponseBody(res: Response): AsyncIterable<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) throw new GrpcWebError(13, 'empty gRPC-Web body');
  while (true) {
    const { done, value } = await reader.read();
    if (value && value.byteLength > 0) yield value;
    if (done) return;
  }
}

async function* readGrpcWebStream(
  res: Response,
  encoding: GrpcWebEncoding,
  codec: GrpcWebProtocolCodec,
): AsyncIterable<Uint8Array> {
  for await (const value of codec.decode(readResponseBody(res), {
    encoding,
    compression: res.headers.get('grpc-encoding'),
  })) {
    switch (value.kind) {
      case 'message':
        yield value.payload;
        break;
      case 'trailers':
        if (value.status !== grpcStatus.OK) {
          throw new GrpcWebError(
            value.status,
            value.message || `grpc-status ${value.status}`,
          );
        }
        return;
      default:
        return assumeExhaustive(value);
    }
  }
  throw missingGrpcStatus(res);
}

/** Creates a Fetch transport for binary or base64 gRPC-Web calls. */
export function createGrpcWebFetchCall(
  options: GrpcWebFetchCallOptions = {},
): StubCall<Uint8Array | AsyncIterable<Uint8Array>> {
  const { baseUrl = '', encoding = 'base64', compress = false } = options;
  const codec = new GrpcWebProtocolCodec();
  return async (request) => {
    const path = request.grpcPath;
    if (!path) throw new Error('grpcPath required');
    const contentType = grpcWebContentType(encoding);
    const requestCompression = compress ? GRPC_GZIP_ENCODING : undefined;
    const body = await codec.encode(
      {
        kind: 'message',
        payload: request.bytes ?? new Uint8Array(),
      },
      { encoding, compression: requestCompression },
    );
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...(request.metadata ?? {}),
        accept: contentType,
        'content-type': contentType,
        'grpc-accept-encoding': GRPC_GZIP_ENCODING,
        ...(requestCompression ? { 'grpc-encoding': requestCompression } : {}),
        'x-grpc-web': '1',
        'x-user-agent': 'grpc-web-javascript/0.1',
      },
      body,
      signal: request.signal,
    });
    if (res.status !== 200) throw missingGrpcStatus(res);
    const encodingFromResponse = responseEncoding(res, encoding);
    switch (request.type) {
      case 'subscription':
        return readGrpcWebStream(res, encodingFromResponse, codec);
      case 'query':
      case 'mutation':
        break;
      default:
        return assumeExhaustive(request.type);
    }

    // Unary gRPC-Web response → single message or error.
    let message: Uint8Array | undefined;
    let status: number | undefined;
    let statusMessage = '';
    for await (const value of codec.decode(readResponseBody(res), {
      encoding: encodingFromResponse,
      compression: res.headers.get('grpc-encoding'),
    })) {
      switch (value.kind) {
        case 'message':
          message ??= value.payload;
          break;
        case 'trailers':
          status = value.status;
          statusMessage = value.message || `grpc-status ${status}`;
          break;
        default:
          assumeExhaustive(value);
      }
    }
    if (status === undefined) throw missingGrpcStatus(res);
    if (status !== grpcStatus.OK) {
      throw new GrpcWebError(status, statusMessage);
    }
    if (message === undefined) {
      throw new GrpcWebError(grpcStatus.INTERNAL, 'empty gRPC-Web response');
    }
    return message;
  };
}
