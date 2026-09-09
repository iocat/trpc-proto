import { serveGrpcWeb } from '@trpc-proto/runtime';
import { protoSchema } from '../generated/schema.js';
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const HOST = '127.0.0.1';
const PORT = Number(process.env.WEB_PORT ?? 3003);
const GRPC_ADDRESS = process.env.GRPC_ADDRESS ?? '127.0.0.1:50054';
const GRPC_WEB_PORT = Number(process.env.GRPC_WEB_PORT ?? 3103);
const spaDir = path.join(import.meta.dirname, 'spa');
const html = readFileSync(path.join(spaDir, 'index.html'), 'utf8');
const spaJs = esbuild.buildSync({
  entryPoints: [path.join(spaDir, 'app.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  logLevel: 'silent',
}).outputFiles![0]!.text;

const grpcWebServer = await serveGrpcWeb({
  mode: 'forward',
  schema: protoSchema,
  backend: { address: GRPC_ADDRESS },
  address: `${HOST}:${GRPC_WEB_PORT}`,
  cors: {
    allowedOrigins: [`http://${HOST}:${PORT}`, `http://localhost:${PORT}`],
  },
});

function send(
  response: http.ServerResponse,
  status: number,
  body: string,
  contentType: string,
): void {
  response.writeHead(status, { 'content-type': contentType });
  response.end(body);
}

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${HOST}`);
    if (
      request.method === 'GET' &&
      (url.pathname === '/' || url.pathname === '/index.html')
    ) {
      send(response, 200, html, 'text/html; charset=utf-8');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/styles.css') {
      send(
        response,
        200,
        readFileSync(path.join(spaDir, 'styles.css'), 'utf8'),
        'text/css; charset=utf-8',
      );
      return;
    }
    if (request.method === 'GET' && url.pathname === '/app.js') {
      send(response, 200, spaJs, 'text/javascript; charset=utf-8');
      return;
    }
    response.writeHead(404);
    response.end();
  } catch (error) {
    send(
      response,
      500,
      error instanceof Error ? error.message : String(error),
      'text/plain; charset=utf-8',
    );
  }
});

process.stdout.write(
  `gRPC-Web forwarding http://${HOST}:${GRPC_WEB_PORT} to ${GRPC_ADDRESS}\n`,
);
server.listen(PORT, HOST, () => {
  process.stdout.write(`React SPA listening on http://${HOST}:${PORT}\n`);
});
