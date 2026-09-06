import * as grpc from '@grpc/grpc-js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  decodeGrpcWeb,
  encodeGrpcWebMessage,
  encodeGrpcWebTrailers,
  GRPC_WEB_CONTENT_TYPE,
  GRPC_WEB_STREAM_HEADER,
  grpcWebErrorFrame,
  grpcWebOkFrame,
  isGrpcWebContentType,
} from './protocol.js';

const DEFAULT_ADDRESS = '127.0.0.1:50051';

/** Do not set these request headers as gRPC metadata. */
const SKIP_METADATA_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'connection',
  'content-length',
  'content-type',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'x-grpc-web',
  'x-grpc-web-stream',
  'x-user-agent',
]);

function contentType(req: IncomingMessage): string | undefined {
  const value = req.headers['content-type'];
  return typeof value === 'string' ? value : undefined;
}

async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function metadataFromRequest(req: IncomingMessage): grpc.Metadata {
  const metadata = new grpc.Metadata();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    const name = key.toLowerCase();
    if (SKIP_METADATA_HEADERS.has(name) || name.startsWith(':')) continue;
    const text = Array.isArray(value) ? value.join(',') : value;

    if (text) metadata.set(name, text);
  }
  return metadata;
}

function trailerRecord(md?: grpc.Metadata): Record<string, string> {
  if (!md) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(md.getMap())) {
    if (value == null || Buffer.isBuffer(value)) continue;
    out[key] = String(value);
  }
  return out;
}

function grpcWebHeaders(): Record<string, string> {
  return { 'content-type': GRPC_WEB_CONTENT_TYPE };
}

function decodeUnaryFrame(body: Uint8Array): Uint8Array {
  const decoded = decodeGrpcWeb(body);
  if (decoded.messages.length !== 1 || !decoded.messages[0]) {
    throw new Error('unary gRPC-Web expects one data frame');
  }
  return decoded.messages[0];
}
/**
 * Browser gRPC-Web unary/stream → native gRPC.
 * Default channel is insecure (loopback examples). Pass `credentials` for TLS.
 * `handle(req, res)` returns true when the request was a gRPC-Web POST
 * and the response has been written.
 */
export function createGrpcWebHop(
  address = DEFAULT_ADDRESS,
  credentials: grpc.ChannelCredentials = grpc.credentials.createInsecure(),
) {
  const client = new grpc.Client(address, credentials);

  function unary(
    grpcPath: string,
    message: Uint8Array,
    metadata: grpc.Metadata,
  ): Promise<Uint8Array> {
    const { promise, resolve } = Promise.withResolvers<Uint8Array>();
    client.makeUnaryRequest(
      grpcPath,
      (value: Buffer) => value,
      (value: Buffer) => value,
      Buffer.from(message),
      metadata,
      (err, res) => {
        if (err) {
          const status =
            typeof err.code === 'number' ? err.code : grpc.status.UNKNOWN;
          resolve(
            grpcWebErrorFrame(
              status,
              err.details || err.message,
              trailerRecord(err.metadata),
            ),
          );
          return;
        }
        resolve(grpcWebOkFrame(new Uint8Array(res ?? Buffer.alloc(0))));
      },
    );
    return promise;
  }

  function stream(
    grpcPath: string,
    message: Uint8Array,
    metadata: grpc.Metadata,
    res: ServerResponse,
  ): Promise<void> {
    return new Promise((resolve) => {
      const call = client.makeServerStreamRequest(
        grpcPath,
        (value: Buffer) => value,
        (value: Buffer) => value,
        Buffer.from(message),
        metadata,
      );
      res.writeHead(200, grpcWebHeaders());
      call.on('data', (msg: Buffer) => {
        if (!res.writableEnded) {
          res.write(Buffer.from(encodeGrpcWebMessage(new Uint8Array(msg))));
        }
      });
      call.on('status', (st: grpc.StatusObject) => {
        if (res.writableEnded) {
          resolve();
          return;
        }
        res.end(
          Buffer.from(
            encodeGrpcWebTrailers(
              st.code,
              st.details,
              trailerRecord(st.metadata),
            ),
          ),
        );
        resolve();
      });
      call.on('error', () => {
        // `status` always follows; do not write here (avoids write-after-end).
      });
    });
  }

  return {
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      if (req.method !== 'POST' || !isGrpcWebContentType(contentType(req))) {
        return false;
      }
      const url = new URL(req.url ?? '/', 'http://grpc-web.invalid');
      const metadata = metadataFromRequest(req);
      const body = await readBody(req);
      let message: Uint8Array;
      try {
        message = decodeUnaryFrame(body);
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        const payload = Buffer.from(
          grpcWebErrorFrame(grpc.status.INTERNAL, text),
        );
        res.writeHead(200, {
          ...grpcWebHeaders(),
          'content-length': String(payload.length),
        });
        res.end(payload);
        return true;
      }
      if (req.headers[GRPC_WEB_STREAM_HEADER] === '1') {
        await stream(url.pathname, message, metadata, res);
        return true;
      }
      const out = await unary(url.pathname, message, metadata);
      const payload = Buffer.from(out);
      res.writeHead(200, {
        ...grpcWebHeaders(),
        'content-length': String(payload.length),
      });
      res.end(payload);
      return true;
    },
  };
}
