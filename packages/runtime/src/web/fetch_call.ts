import type { StubCall } from '../grpc/proto_link.js';
import { GRPC_GZIP_ENCODING } from './codec/compression.js';
import {
  GrpcWebError,
  GrpcWebProtocolCodec,
} from './codec/protocol_codec.js';
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
    if (value.kind === 'message') {
      yield value.payload;
      continue;
    }
    if (value.status !== 0) {
      throw new GrpcWebError(
        value.status,
        value.message || `grpc-status ${value.status}`,
      );
    }
    return;
  }
}

/** Creates a Fetch transport for binary or base64 gRPC-Web calls. */
export function createGrpcWebFetchCall(
  options: GrpcWebFetchCallOptions = {},
): StubCall {
  const { baseUrl = '', encoding = 'base64', compress = false } = options;
  const codec = new GrpcWebProtocolCodec();
  return async (request) => {
    const path = request.grpcPath;
    if (!path) throw new Error('grpcPath required');
    const contentType = grpcWebContentType(encoding);
    const compression = compress ? GRPC_GZIP_ENCODING : undefined;
    const body = await codec.encode(
      {
        kind: 'message',
        payload: request.bytes ?? new Uint8Array(),
      },
      { encoding, compress, compression },
    );
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...(request.metadata ?? {}),
        accept: contentType,
        'content-type': contentType,
        'grpc-accept-encoding': GRPC_GZIP_ENCODING,
        ...(compression ? { 'grpc-encoding': compression } : {}),
        'x-grpc-web': '1',
        'x-user-agent': 'grpc-web-javascript/0.1',
      },
      body,
      signal: request.signal,
    });
    const encodingFromResponse = responseEncoding(res, encoding);
    if (request.type === 'subscription') {
      return readGrpcWebStream(res, encodingFromResponse, codec);
    }

    let message: Uint8Array | undefined;
    let status = res.ok ? 0 : 2;
    let statusMessage = `grpc-status ${status}`;
    for await (const value of codec.decode(readResponseBody(res), {
      encoding: encodingFromResponse,
      compression: res.headers.get('grpc-encoding'),
    })) {
      if (value.kind === 'message') {
        message ??= value.payload;
      } else {
        status = value.status;
        statusMessage = value.message || `grpc-status ${status}`;
      }
    }
    if (status !== 0) throw new GrpcWebError(status, statusMessage);
    if (!message) throw new GrpcWebError(13, 'empty gRPC-Web response');
    return message;
  };
}
