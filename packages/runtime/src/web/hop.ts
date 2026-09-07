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
const DEFAULT_CORS_REQUEST_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'grpc-timeout',
  'x-grpc-web',
  'x-grpc-web-stream',
  'x-user-agent',
] as const;

const CORS_EXPOSE_HEADERS = 'grpc-status, grpc-message, x-grpc-web';

/** CORS policy applied to browser requests handled by a gRPC-Web hop. */
export interface GrpcWebCorsOptions {
  /** Exact serialized origins allowed to call the hop. */
  readonly allowedOrigins: readonly string[];
  /** Request headers allowed in addition to the gRPC-Web defaults. */
  readonly additionalAllowedHeaders?: readonly string[];
}

/** Configuration for the browser-to-gRPC proxy hop. */
export interface GrpcWebHopOptions {
  /** Native gRPC upstream address. Defaults to `127.0.0.1:50051`. */
  address?: string;
  /** Channel credentials for the native gRPC upstream. Defaults to insecure. */
  credentials?: grpc.ChannelCredentials;
  /** Optional cross-origin request policy. CORS is disabled when omitted. */
  cors?: GrpcWebCorsOptions;
}

interface CorsPolicy {
  allowedOrigins: ReadonlySet<string>;
  allowedHeaders: ReadonlySet<string>;
}


/** Do not set these request headers as gRPC metadata. */
const SKIP_METADATA_HEADERS: Record<string, true> = {
  accept: true,
  'accept-encoding': true,
  connection: true,
  'content-length': true,
  'content-type': true,
  host: true,
  'keep-alive': true,
  origin: true,
  'proxy-authenticate': true,
  'proxy-authorization': true,
  'proxy-connection': true,
  te: true,
  trailer: true,
  'transfer-encoding': true,
  upgrade: true,
  'user-agent': true,
  'x-grpc-web': true,
  'x-grpc-web-stream': true,
  'x-user-agent': true,
};

function requestHeader(
  req: IncomingMessage,
  name: string,
): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function contentType(req: IncomingMessage): string | undefined {
  return requestHeader(req, 'content-type');
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
    if (SKIP_METADATA_HEADERS[name] || name.startsWith(':')) continue;
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

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-expose-headers': CORS_EXPOSE_HEADERS,
    vary: 'Origin',
  };
}

function grpcWebHeaders(origin?: string): Record<string, string> {
  return {
    'content-type': GRPC_WEB_CONTENT_TYPE,
    ...(origin ? corsHeaders(origin) : {}),
  };
}

function createCorsPolicy(cors: GrpcWebCorsOptions): CorsPolicy {
  return {
    allowedOrigins: new Set(cors.allowedOrigins),
    allowedHeaders: new Set(
      [
        ...DEFAULT_CORS_REQUEST_HEADERS,
        ...(cors.additionalAllowedHeaders ?? []),
      ].map((name) => name.toLowerCase()),
    ),
  };
}

function requestedCorsHeaders(req: IncomingMessage): string[] {
  return (requestHeader(req, 'access-control-request-headers') ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

function handleCorsPreflight(
  req: IncomingMessage,
  res: ServerResponse,
  cors: CorsPolicy | undefined,
): boolean {
  if (req.method !== 'OPTIONS' || !cors) return false;
  const origin = requestHeader(req, 'origin');
  if (!origin) return false;
  const vary = 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers';
  if (!cors.allowedOrigins.has(origin)) {
    res.writeHead(403, { vary, 'content-length': '0' });
    res.end();
    return true;
  }

  const method = requestHeader(req, 'access-control-request-method');
  if (method?.toUpperCase() !== 'POST') {
    res.writeHead(405, {
      ...corsHeaders(origin),
      vary,
      allow: 'POST',
      'access-control-allow-methods': 'POST',
      'content-length': '0',
    });
    res.end();
    return true;
  }

  const requestedHeaders = requestedCorsHeaders(req);
  if (requestedHeaders.some((name) => !cors.allowedHeaders.has(name))) {
    res.writeHead(403, {
      ...corsHeaders(origin),
      vary,
      'content-length': '0',
    });
    res.end();
    return true;
  }

  res.writeHead(204, {
    ...corsHeaders(origin),
    vary,
    'access-control-allow-methods': 'POST',
    'access-control-allow-headers': [...cors.allowedHeaders].join(', '),
    'content-length': '0',
  });
  res.end();
  return true;
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
 * The default channel is insecure and CORS is disabled unless configured.
 * `handle(req, res)` returns true when the response has been written.
 */
export function createGrpcWebHop(options: GrpcWebHopOptions = {}) {
  const {
    address = DEFAULT_ADDRESS,
    credentials = grpc.credentials.createInsecure(),
    cors,
  } = options;
  const corsPolicy = cors ? createCorsPolicy(cors) : undefined;
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
    origin?: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      const call = client.makeServerStreamRequest(
        grpcPath,
        (value: Buffer) => value,
        (value: Buffer) => value,
        Buffer.from(message),
        metadata,
      );
      res.writeHead(200, grpcWebHeaders(origin));
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
      if (handleCorsPreflight(req, res, corsPolicy)) return true;
      if (req.method !== 'POST' || !isGrpcWebContentType(contentType(req))) {
        return false;
      }
      const origin = requestHeader(req, 'origin');
      if (origin && corsPolicy && !corsPolicy.allowedOrigins.has(origin)) {
        res.writeHead(403, { vary: 'Origin', 'content-length': '0' });
        res.end();
        return true;
      }
      const responseOrigin =
        origin && corsPolicy?.allowedOrigins.has(origin) ? origin : undefined;
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
          ...grpcWebHeaders(responseOrigin),
          'content-length': String(payload.length),
        });
        res.end(payload);
        return true;
      }
      if (req.headers[GRPC_WEB_STREAM_HEADER] === '1') {
        await stream(url.pathname, message, metadata, res, responseOrigin);
        return true;
      }
      const out = await unary(url.pathname, message, metadata);
      const payload = Buffer.from(out);
      res.writeHead(200, {
        ...grpcWebHeaders(responseOrigin),
        'content-length': String(payload.length),
      });
      res.end(payload);
      return true;
    },
  };
}
