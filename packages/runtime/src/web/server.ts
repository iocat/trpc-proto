import * as http from 'node:http';
import type { AnyRouter } from '@trpc/server';
import type { ProtoSchema } from '@trpc-proto/schema_ir';
import {
  createGrpcWebHttpHandler,
  createGrpcWebRouterHttpHandler,
  type GrpcWebCorsOptions,
  type GrpcWebHttpHandlerOptions,
} from './http_handler.js';

const DEFAULT_ADDRESS = '127.0.0.1:50052';

interface ServeGrpcWebBaseOptions {
  /** HTTP/1.1 listen address. Defaults to `127.0.0.1:50052`. */
  address?: string;
  cors?: GrpcWebCorsOptions;
}

/** Direct in-process tRPC router dispatch. */
export interface ServeGrpcWebDirectOptions
  extends ServeGrpcWebBaseOptions {
  mode: 'direct';
  router: AnyRouter;
  schema: ProtoSchema;
  createContext?: () => unknown | Promise<unknown>;
}

/** Forwarding to a separately hosted native gRPC server. */
export interface ServeGrpcWebForwardOptions
  extends ServeGrpcWebBaseOptions {
  mode: 'forward';
  backend: Omit<GrpcWebHttpHandlerOptions, 'cors'>;
}

/** Direct router dispatch or forwarding gRPC-Web server configuration. */
export type ServeGrpcWebOptions =
  | ServeGrpcWebDirectOptions
  | ServeGrpcWebForwardOptions;

/** Bound gRPC-Web server and its lifecycle controls. */
export interface GrpcWebServerHandle {
  address: string;
  port: number;
  close(): Promise<void>;
}

function listenTarget(address: string): { host: string; port: number } {
  const parsed = new URL(`http://${address}`);
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`invalid gRPC-Web listen address: ${address}`);
  }
  return {
    host: parsed.hostname.replace(/^\[|\]$/gu, ''),
    port,
  };
}

function formatAddress(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

/** Serves direct or forwarded gRPC-Web over HTTP/1.1. */
export async function serveGrpcWeb(
  options: ServeGrpcWebOptions,
): Promise<GrpcWebServerHandle> {
  const target = listenTarget(options.address ?? DEFAULT_ADDRESS);
  const handleGrpcWeb =
    options.mode === 'direct'
      ? createGrpcWebRouterHttpHandler(options.router, {
          schema: options.schema,
          createContext: options.createContext,
          cors: options.cors,
        })
      : createGrpcWebHttpHandler({
          ...options.backend,
          cors: options.cors,
        });
  const server = http.createServer((request, response) => {
    void handleGrpcWeb(request, response).then(
      (handled) => {
        if (!handled && !response.writableEnded) {
          response.writeHead(404).end();
        }
      },
      (error: unknown) =>
        response.destroy(
          error instanceof Error ? error : new Error(String(error)),
        ),
    );
  });
  const listening = Promise.withResolvers<void>();
  server.once('error', listening.reject);
  server.listen(target.port, target.host, listening.resolve);
  await listening.promise;
  server.removeListener('error', listening.reject);
  const bound = server.address();
  if (bound === null || typeof bound === 'string') {
    server.close();
    throw new Error('gRPC-Web server did not bind a TCP port');
  }

  return {
    address: formatAddress(target.host, bound.port),
    port: bound.port,
    close() {
      const closed = Promise.withResolvers<void>();
      server.close((error) => {
        if (error) closed.reject(error);
        else closed.resolve();
      });
      return closed.promise;
    },
  };
}
