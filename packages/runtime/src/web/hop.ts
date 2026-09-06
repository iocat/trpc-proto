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

/**
 * Browser gRPC-Web unary → native gRPC unary.
 * `handle(req, res)` is the HTTP hookup: returns true when the request was a
 * gRPC-Web POST and the response has been written.
 */
export function createGrpcWebHop(address = DEFAULT_ADDRESS) {
  const client = new grpc.Client(address, grpc.credentials.createInsecure());

  function unary(
    grpcPath: string,
    body: Uint8Array,
    headers?: Record<string, string>,
  ): Promise<Uint8Array> {
    let message: Uint8Array;
    try {
      const decoded = decodeGrpcWeb(body);
      if (decoded.messages.length !== 1 || !decoded.messages[0]) {
        return Promise.resolve(
          grpcWebErrorFrame(
            grpc.status.INTERNAL,
            'unary gRPC-Web expects one data frame',
          ),
        );
      }
      message = decoded.messages[0];
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      return Promise.resolve(grpcWebErrorFrame(grpc.status.INTERNAL, text));
    }

    const metadata = new grpc.Metadata();
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        if (value) metadata.set(key, value);
      }
    }

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
          resolve(grpcWebErrorFrame(status, err.details || err.message));
          return;
        }
        resolve(grpcWebOkFrame(new Uint8Array(res ?? Buffer.alloc(0))));
      },
    );
    return promise;
  }

  return {
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      if (req.method !== 'POST' || !isGrpcWebContentType(contentType(req))) {
        return false;
      }
      const url = new URL(req.url ?? '/', 'http://grpc-web.invalid');
      const auth = req.headers.authorization;
      const headers =
        typeof auth === 'string' ? { authorization: auth } : undefined;
      const body = await readBody(req);
      if (req.headers[GRPC_WEB_STREAM_HEADER] === '1') {
        await stream(url.pathname, body, headers, res);
        return true;
      }
      const out = await unary(url.pathname, body, headers);
      const payload = Buffer.from(out);
      res.writeHead(200, {
        'content-type': GRPC_WEB_CONTENT_TYPE,
        'content-length': String(payload.length),
      });
      res.end(payload);
      return true;
    },
  };

  function stream(
    grpcPath: string,
    body: Uint8Array,
    headers: Record<string, string> | undefined,
    res: ServerResponse,
  ): Promise<void> {
    let message: Uint8Array;
    try {
      const decoded = decodeGrpcWeb(body);
      if (decoded.messages.length !== 1 || !decoded.messages[0]) {
        res.writeHead(200, { 'content-type': GRPC_WEB_CONTENT_TYPE });
        res.end(
          Buffer.from(
            grpcWebErrorFrame(
              grpc.status.INTERNAL,
              'unary gRPC-Web expects one data frame',
            ),
          ),
        );
        return Promise.resolve();
      }
      message = decoded.messages[0];
    } catch (err) {
      res.writeHead(200, { 'content-type': GRPC_WEB_CONTENT_TYPE });
      res.end(
        Buffer.from(
          grpcWebErrorFrame(
            grpc.status.INTERNAL,
            err instanceof Error ? err.message : String(err),
          ),
        ),
      );
      return Promise.resolve();
    }
    const metadata = new grpc.Metadata();
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        if (value) metadata.set(key, value);
      }
    }
    return new Promise((resolve) => {
      const call = client.makeServerStreamRequest(
        grpcPath,
        (value: Buffer) => value,
        (value: Buffer) => value,
        Buffer.from(message),
        metadata,
      );
      res.writeHead(200, { 'content-type': GRPC_WEB_CONTENT_TYPE });
      call.on('data', (msg: Buffer) => {
        res.write(Buffer.from(encodeGrpcWebMessage(new Uint8Array(msg))));
      });
      call.on('end', () => {
        res.end(Buffer.from(encodeGrpcWebTrailers(0)));
        resolve();
      });
      call.on('error', (err: grpc.ServiceError) => {
        const status =
          typeof err.code === 'number' ? err.code : grpc.status.UNKNOWN;
        res.end(
          Buffer.from(grpcWebErrorFrame(status, err.details || err.message)),
        );
        resolve();
      });
    });
  }
}
