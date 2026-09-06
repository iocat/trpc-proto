import type { StubCall } from '../grpc/proto_link.js';

/**
 * Unary protobuf gRPC-Web content type.
 * @see https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md
 */
export const GRPC_WEB_CONTENT_TYPE = 'application/grpc-web+proto';

/** Hop/client flag: this gRPC-Web call is server-streaming. */
export const GRPC_WEB_STREAM_HEADER = 'x-grpc-web-stream';

const TRAILER_FLAG = 0x80;
const COMPRESSED_FLAG = 0x01;

export interface GrpcWebDecode {
  messages: Uint8Array[];
  trailers: Record<string, string>;
}

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

export function encodeGrpcMessage(value: string) {
  return [...new TextEncoder().encode(value)]
    .map((byteValue) =>
      byteValue === 0x25 || byteValue < 0x20 || byteValue > 0x7e
        ? `%${byteValue.toString(16).toUpperCase().padStart(2, '0')}`
        : String.fromCharCode(byteValue),
    )
    .join('');
}

export function encodeGrpcWebFrame(payload: Uint8Array, flags = 0) {
  const out = new Uint8Array(5 + payload.length);
  out[0] = flags;
  writeLength(out, payload.length);
  out.set(payload, 5);
  return out;
}

export function encodeGrpcWebMessage(message: Uint8Array) {
  return encodeGrpcWebFrame(message, 0);
}

export function encodeGrpcWebTrailers(
  status: number,
  message = '',
  extra: Record<string, string> = {},
) {
  const lines = [
    `grpc-status: ${status}`,
    `grpc-message: ${encodeGrpcMessage(message)}`,
  ];
  for (const [key, value] of Object.entries(extra)) {
    const name = key.toLowerCase();
    if (name === 'grpc-status' || name === 'grpc-message') continue;
    lines.push(`${name}: ${encodeGrpcMessage(value)}`);
  }
  return encodeGrpcWebFrame(
    new TextEncoder().encode(`${lines.join('\r\n')}\r\n`),
    TRAILER_FLAG,
  );
}


export function decodeGrpcWeb(body: Uint8Array): GrpcWebDecode {
  const messages: Uint8Array[] = [];
  const trailers: Record<string, string> = {};
  let offset = 0;
  while (offset < body.length) {
    if (offset + 5 > body.length) {
      throw new Error('truncated gRPC-Web frame header');
    }
    const flags = byte(body, offset);
    const length = readLength(body, offset + 1);
    offset += 5;
    if (offset + length > body.length) {
      throw new Error('truncated gRPC-Web frame');
    }
    const payload = body.subarray(offset, offset + length);
    offset += length;
    if (flags & COMPRESSED_FLAG) {
      throw new Error('compressed gRPC-Web frames are not supported');
    }
    if (flags & TRAILER_FLAG) {
      const text = new TextDecoder().decode(payload);
      for (const line of text.split('\r\n')) {
        if (!line) continue;
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        trailers[line.slice(0, colon).trim().toLowerCase()] = line
          .slice(colon + 1)
          .trim();
      }
    } else {
      messages.push(payload);
    }
  }
  return { messages, trailers };
}

function concat(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function isGrpcWebContentType(value: string | undefined) {
  return Boolean(value?.toLowerCase().includes('application/grpc-web'));
}

export class GrpcWebError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'GrpcWebError';
    this.code = code;
  }
}

async function* readGrpcWebStream(res: Response): AsyncIterable<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) throw new GrpcWebError(13, 'empty gRPC-Web body');
  let buf = new Uint8Array();
  while (true) {
    const { done, value } = await reader.read();
    if (value && value.byteLength > 0) buf = concat([buf, value]);
    while (buf.length >= 5) {
      const length = readLength(buf, 1);
      if (buf.length < 5 + length) break;
      const flags = byte(buf, 0);
      const payload = buf.subarray(5, 5 + length);
      buf = buf.subarray(5 + length);
      if (flags & COMPRESSED_FLAG) {
        throw new Error('compressed gRPC-Web frames are not supported');
      }
      if (flags & TRAILER_FLAG) {
        const decoded = decodeGrpcWeb(
          concat([encodeGrpcWebFrame(payload, TRAILER_FLAG)]),
        );
        const status = Number(decoded.trailers['grpc-status'] ?? 0);
        if (status !== 0) {
          throw new GrpcWebError(
            status,
            decoded.trailers['grpc-message'] || `grpc-status ${status}`,
          );
        }
        return;
      }
      yield payload;
    }
    if (done) break;
  }
}

/** Browser/Node fetch transport. Unary or server-streaming gRPC-Web. */
export function createGrpcWebFetchCall(baseUrl = ''): StubCall {
  return async (request) => {
    const path = request.grpcPath;
    if (!path) throw new Error('grpcPath required');
    const payload = request.bytes ?? new Uint8Array();
    const headers: Record<string, string> = {
      'content-type': GRPC_WEB_CONTENT_TYPE,
      'x-grpc-web': '1',
      'x-user-agent': 'grpc-web-javascript/0.1',
      ...(request.metadata ?? {}),
    };
    if (request.type === 'subscription') {
      headers[GRPC_WEB_STREAM_HEADER] = '1';
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: encodeGrpcWebMessage(payload),
      signal: request.signal,
    });
    if (request.type === 'subscription') {
      return readGrpcWebStream(res);
    }
    const decoded = decodeGrpcWeb(new Uint8Array(await res.arrayBuffer()));
    const status = Number(decoded.trailers['grpc-status'] ?? (res.ok ? 0 : 2));
    if (status !== 0) {
      throw new GrpcWebError(
        status,
        decoded.trailers['grpc-message'] || `grpc-status ${status}`,
      );
    }
    const message = decoded.messages[0];
    if (!message) throw new GrpcWebError(13, 'empty gRPC-Web response');
    return message;
  };
}

export function grpcWebErrorFrame(
  status: number,
  message: string,
  extra: Record<string, string> = {},
) {
  return concat([encodeGrpcWebTrailers(status, message, extra)]);
}


export function grpcWebOkFrame(message: Uint8Array) {
  return concat([encodeGrpcWebMessage(message), encodeGrpcWebTrailers(0)]);
}
