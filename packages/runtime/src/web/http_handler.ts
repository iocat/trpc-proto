import { assumeExhaustive } from '@trpc-proto/utility';
import * as grpc from '@grpc/grpc-js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Codec } from './codec/codec.js';
import {
  GrpcWebProtocolCodec,
  type GrpcWebProtocolCodecOptions,
  type GrpcWebProtocolValue,
} from './codec/protocol_codec.js';
import {
  grpcWebContentType,
  grpcWebEncoding,
  negotiateGrpcWebResponseEncoding,
  type GrpcWebEncoding,
} from './content_type.js';

const DEFAULT_ADDRESS = '127.0.0.1:50051';
const DEFAULT_CORS_REQUEST_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'grpc-accept-encoding',
  'grpc-encoding',
  'grpc-timeout',
  'x-grpc-web',
  'x-user-agent',
] as const;

const CORS_EXPOSE_HEADERS =
  'grpc-status, grpc-message, grpc-accept-encoding, grpc-encoding, x-grpc-web';

/** CORS policy applied to browser requests handled by the gRPC-Web HTTP handler. */
export interface GrpcWebCorsOptions {
  /** Exact serialized origins allowed to call the handler. */
  readonly allowedOrigins: readonly string[];
  /** Request headers allowed in addition to the gRPC-Web defaults. */
  readonly additionalAllowedHeaders?: readonly string[];
}

/** Configuration for the browser-to-gRPC HTTP handler. */
export interface GrpcWebHttpHandlerOptions {
  /** Native gRPC backend address. Defaults to `127.0.0.1:50051`. */
  address?: string;
  /** Channel credentials for the native gRPC backend. Defaults to insecure. */
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
  'grpc-accept-encoding': true,
  'grpc-encoding': true,
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
  'x-user-agent': true,
};

function requestHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function requestEncoding(req: IncomingMessage): GrpcWebEncoding | undefined {
  return grpcWebEncoding(requestHeader(req, 'content-type'));
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

function grpcWebHeaders(
  encoding: GrpcWebEncoding,
  origin?: string,
): Record<string, string> {
  return {
    'content-type': grpcWebContentType(encoding),
    'grpc-accept-encoding': 'gzip',
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
  const vary =
    'Origin, Access-Control-Request-Method, Access-Control-Request-Headers';
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


/**
 * Creates one Node HTTP request handler for gRPC-Web unary and server streams.
 * The default backend channel is insecure and CORS is disabled unless configured.
 * The handler returns true when it writes a response.
 */
export function createGrpcWebHttpHandler(
  options: GrpcWebHttpHandlerOptions = {},
) {
  const {
    address = DEFAULT_ADDRESS,
    credentials = grpc.credentials.createInsecure(),
    cors,
  } = options;
  const codec: Codec<
    GrpcWebProtocolValue,
    Uint8Array,
    GrpcWebProtocolCodecOptions
  > = new GrpcWebProtocolCodec();
  const corsPolicy = cors ? createCorsPolicy(cors) : undefined;
  const client = new grpc.Client(address, credentials);

  function forwardGrpcCall(
    grpcPath: string,
    message: Uint8Array,
    metadata: grpc.Metadata,
    req: IncomingMessage,
    res: ServerResponse,
    encoding: GrpcWebEncoding,
    origin?: string,
  ): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    const call = client.makeServerStreamRequest(
      grpcPath,
      (value: Buffer) => value,
      (value: Buffer) => value,
      Buffer.from(message),
      metadata,
    );
    let backendCallEnded = false;
    const cancelBackendCall = () => {
      if (!backendCallEnded) call.cancel();
    };
    const detachBrowserConnectionListeners = () => {
      req.off('aborted', cancelBackendCall);
      res.off('close', cancelBackendCall);
    };
    req.once('aborted', cancelBackendCall);
    res.once('close', cancelBackendCall);
    let writes = Promise.resolve();
    res.writeHead(200, grpcWebHeaders(encoding, origin));
    call.on('data', (msg: Buffer) => {
      writes = writes.then(async () => {
        if (res.writableEnded) return;
        const body = await codec.encode(
          { kind: 'message', payload: new Uint8Array(msg) },
          { encoding },
        );
        res.write(body);
      });
    });
    call.on('status', (st: grpc.StatusObject) => {
      backendCallEnded = true;
      detachBrowserConnectionListeners();
      void writes
        .then(async () => {
          if (!res.writableEnded && !res.destroyed) {
            const body = await codec.encode(
              {
                kind: 'trailers',
                status: st.code,
                message: st.details,
                metadata: trailerRecord(st.metadata),
              },
              { encoding },
            );
            res.end(body);
          }
          resolve();
        })
        .catch((error: unknown) => {
          if (!res.destroyed) {
            res.destroy(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
          resolve();
        });
    });
    call.on('error', () => {
      // `status` always follows; do not write here (avoids write-after-end).
    });
    return promise;
  }

  return async function handleGrpcWebHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    if (handleCorsPreflight(req, res, corsPolicy)) return true;
    const encoding = requestEncoding(req);
    if (req.method !== 'POST' || !encoding) return false;
    const origin = requestHeader(req, 'origin');
    if (origin && corsPolicy && !corsPolicy.allowedOrigins.has(origin)) {
      res.writeHead(403, { vary: 'Origin', 'content-length': '0' });
      res.end();
      return true;
    }
    const responseOrigin =
      origin && corsPolicy?.allowedOrigins.has(origin) ? origin : undefined;
    const responseEncoding = negotiateGrpcWebResponseEncoding(
      requestHeader(req, 'accept'),
      encoding,
    );
    const url = new URL(req.url ?? '/', 'http://grpc-web.invalid');
    const metadata = metadataFromRequest(req);
    const encodedBody = await readBody(req);

    try {
      const messages: Uint8Array[] = [];
      for await (const value of codec.decode(encodedBody, {
        encoding,
        compression: requestHeader(req, 'grpc-encoding'),
      })) {
        switch (value.kind) {
          case 'message':
            messages.push(value.payload);
            break;
          case 'trailers':
            break;
          default:
            assumeExhaustive(value);
        }
      }
      const message = messages.length === 1 ? messages[0] : undefined;
      if (!message) throw new Error('unary gRPC-Web expects one data frame');
      await forwardGrpcCall(
        url.pathname,
        message,
        metadata,
        req,
        res,
        responseEncoding,
        responseOrigin,
      );
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      const body = await codec.encode(
        {
          kind: 'trailers',
          status: grpc.status.INTERNAL,
          message: text,
        },
        { encoding: responseEncoding },
      );
      res.writeHead(200, {
        ...grpcWebHeaders(responseEncoding, responseOrigin),
        'content-length': String(body.byteLength),
      });
      res.end(body);
    }
    return true;
  };
}
