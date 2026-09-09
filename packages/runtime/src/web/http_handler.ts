import type { AnyRouter } from '@trpc/server';
import { assumeExhaustive } from '@trpc-proto/utility';
import * as grpc from '@grpc/grpc-js';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProtoSchema } from '@trpc-proto/schema_ir';
import { GrpcWebProtocolCodec } from './codec/protocol_codec.js';
import {
  grpcWebContentType,
  grpcWebEncoding,
  negotiateGrpcWebResponseEncoding,
  type GrpcWebEncoding,
} from './content_type.js';
import { createDirectDispatcher } from './dispatchers/direct.js';
import { createForwardingDispatcher } from './dispatchers/forward.js';
import type {
  GrpcWebDispatcher,
  GrpcWebDispatchStatus,
} from './dispatchers/types.js';

const DEFAULT_ADDRESS = '127.0.0.1:50051';
const DEFAULT_CORS_MAX_AGE_SECONDS = 600;
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
  /** Browser preflight cache lifetime in seconds. Defaults to 600. */
  readonly maxAgeSeconds?: number;
}

/** TLS configuration for the native upstream gRPC channel. */
export interface MtlsConfig {
  type: 'mtls';
  /** CA bundle used to verify the upstream gRPC server's certificate. */
  caCertPath: string;
  /**
   * Expected SAN or hostname on the upstream server certificate. Maps to
   * `grpc.ssl_target_name_override` in grpc-js.
   */
  serverNameOverride?: string;
  /**
   * Client identity presented during TLS. When omitted, the channel uses
   * one-way TLS.
   */
  clientIdentity?: {
    certPath: string;
    keyPath: string;
  };
}

/** Explicit transport security for the native upstream gRPC channel. */
export type GrpcWebUpstreamCredentials = { type: 'insecure' } | MtlsConfig;

/** Forwarding handler with an owned upstream client lifecycle. */
export interface ForwardingGrpcWebHttpHandler {
  (request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  close(): void;
}

/** Configuration for forwarding browser gRPC-Web calls to a gRPC backend. */
export interface ForwardingGrpcWebHttpHandlerOptions {
  /** Schema used to select unary or server-streaming grpc-js calls. */
  schema: ProtoSchema;
  /** Native gRPC backend address. Defaults to `127.0.0.1:50051`. */
  address?: string;
  /** Transport security for the upstream channel. Defaults to insecure. */
  credentials?: GrpcWebUpstreamCredentials;
  /** Optional cross-origin request policy. CORS is disabled when omitted. */
  cors?: GrpcWebCorsOptions;
}

interface CorsPolicy {
  allowedOrigins: ReadonlySet<string>;
  allowedHeaders: ReadonlySet<string>;
  maxAgeSeconds: number;
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

function metadataFromRequest(
  request: IncomingMessage,
): ReadonlyMap<string, string> {
  const metadata = new Map<string, string>();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value == null) continue;
    const name = key.toLowerCase();
    if (SKIP_METADATA_HEADERS[name] || name.startsWith(':')) continue;
    const text = Array.isArray(value) ? value.join(',') : value;
    if (text) metadata.set(name, text);
  }
  return metadata;
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
  const maxAgeSeconds = cors.maxAgeSeconds ?? DEFAULT_CORS_MAX_AGE_SECONDS;
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
    throw new RangeError('cors.maxAgeSeconds must be a non-negative integer');
  }
  return {
    allowedOrigins: new Set(cors.allowedOrigins),
    allowedHeaders: new Set(
      [
        ...DEFAULT_CORS_REQUEST_HEADERS,
        ...(cors.additionalAllowedHeaders ?? []),
      ].map((name) => name.toLowerCase()),
    ),
    maxAgeSeconds,
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
    'access-control-max-age': String(cors.maxAgeSeconds),
    'content-length': '0',
  });
  res.end();
  return true;
}

async function writeGrpcWebBody(
  response: ServerResponse,
  body: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  if (!response.write(body)) await once(response, 'drain', { signal });
}

function createGrpcWebRequestHandler(
  corsPolicy: CorsPolicy | undefined,
  dispatch: GrpcWebDispatcher,
) {
  const codec = new GrpcWebProtocolCodec();
  return async function handleGrpcWebHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> {
    if (handleCorsPreflight(request, response, corsPolicy)) return true;
    const requestBodyEncoding = requestEncoding(request);
    if (request.method !== 'POST' || !requestBodyEncoding) return false;
    const origin = requestHeader(request, 'origin');
    if (origin && corsPolicy && !corsPolicy.allowedOrigins.has(origin)) {
      response.writeHead(403, { vary: 'Origin', 'content-length': '0' });
      response.end();
      return true;
    }
    const responseOrigin =
      origin && corsPolicy?.allowedOrigins.has(origin) ? origin : undefined;
    const responseBodyEncoding = negotiateGrpcWebResponseEncoding(
      requestHeader(request, 'accept'),
      requestBodyEncoding,
    );

    try {
      const messages: Uint8Array[] = [];
      const encodedBody = await readBody(request);
      for await (const value of codec.decode(encodedBody, {
        encoding: requestBodyEncoding,
        compression: requestHeader(request, 'grpc-encoding'),
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

      const abortController = new AbortController();
      let callEnded = false;
      const cancelCall = () => {
        if (!callEnded) abortController.abort();
      };
      const detachBrowserConnectionListeners = () => {
        request.off('aborted', cancelCall);
        response.off('close', cancelCall);
      };
      request.once('aborted', cancelCall);
      response.once('close', cancelCall);
      response.writeHead(
        200,
        grpcWebHeaders(responseBodyEncoding, responseOrigin),
      );

      let status: GrpcWebDispatchStatus;
      try {
        const url = new URL(request.url ?? '/', 'http://grpc-web.invalid');
        status = await dispatch(
          {
            grpcPath: url.pathname,
            message,
            metadata: metadataFromRequest(request),
            signal: abortController.signal,
          },
          async (payload) => {
            if (
              abortController.signal.aborted ||
              response.writableEnded ||
              response.destroyed
            ) {
              return;
            }
            const body = await codec.encode(
              { kind: 'message', payload },
              { encoding: responseBodyEncoding },
            );
            await writeGrpcWebBody(response, body, abortController.signal);
          },
        );
      } finally {
        callEnded = true;
        detachBrowserConnectionListeners();
      }

      if (
        !abortController.signal.aborted &&
        !response.writableEnded &&
        !response.destroyed
      ) {
        const trailer = await codec.encode(
          {
            kind: 'trailers',
            status: status.code,
            message: status.message,
            metadata: status.metadata,
          },
          { encoding: responseBodyEncoding },
        );
        response.end(trailer);
      }
    } catch (error) {
      if (!response.writableEnded && !response.destroyed) {
        const message = error instanceof Error ? error.message : String(error);
        const trailer = await codec.encode(
          {
            kind: 'trailers',
            status: grpc.status.INTERNAL,
            message,
          },
          { encoding: responseBodyEncoding },
        );
        if (!response.headersSent) {
          response.writeHead(200, {
            ...grpcWebHeaders(responseBodyEncoding, responseOrigin),
            'content-length': String(trailer.byteLength),
          });
        }
        response.end(trailer);
      }
    }
    return true;
  };
}

function createForwardingClient(
  address: string,
  credentials: GrpcWebUpstreamCredentials,
): grpc.Client {
  if (credentials.type === 'insecure') {
    return new grpc.Client(address, grpc.credentials.createInsecure(), {});
  }
  const mtls = credentials;
  const identity = mtls.clientIdentity;
  const certificateProvider =
    new grpc.experimental.FileWatcherCertificateProvider({
      caCertificateFile: mtls.caCertPath,
      certificateFile: identity?.certPath,
      privateKeyFile: identity?.keyPath,
      refreshIntervalMs: 1_000,
    });
  const channelCredentials =
    grpc.experimental.createCertificateProviderChannelCredentials(
      certificateProvider,
      identity ? certificateProvider : null,
    );
  const channelOptions: grpc.ChannelOptions = mtls.serverNameOverride
    ? {
        'grpc.ssl_target_name_override': mtls.serverNameOverride,
        'grpc.default_authority': mtls.serverNameOverride,
      }
    : {};
  return new grpc.Client(address, channelCredentials, channelOptions);
}

/**
 * Creates one Node HTTP request handler that forwards gRPC-Web calls to a
 * native gRPC backend. CORS is disabled unless configured.
 */
export function createForwardingGrpcWebHttpHandler(
  options: ForwardingGrpcWebHttpHandlerOptions,
): ForwardingGrpcWebHttpHandler {
  const {
    schema,
    address = DEFAULT_ADDRESS,
    credentials = { type: 'insecure' },
    cors,
  } = options;
  const client = createForwardingClient(address, credentials);
  const handler = createGrpcWebRequestHandler(
    cors ? createCorsPolicy(cors) : undefined,
    createForwardingDispatcher(client, schema),
  );
  return Object.assign(handler, {
    close: () => client.close(),
  });
}

/** Configuration for dispatching gRPC-Web calls directly to a tRPC router. */
export interface DirectGrpcWebHttpHandlerOptions {
  schema: ProtoSchema;
  createContext?: () => unknown | Promise<unknown>;
  cors?: GrpcWebCorsOptions;
}

/** Creates a gRPC-Web handler that dispatches directly to a tRPC router. */
export function createDirectGrpcWebHttpHandler(
  router: AnyRouter,
  options: DirectGrpcWebHttpHandlerOptions,
) {
  return createGrpcWebRequestHandler(
    options.cors ? createCorsPolicy(options.cors) : undefined,
    createDirectDispatcher(router, options),
  );
}
