import { serveGrpcWeb } from '@trpc-proto/runtime';
import { protoSchema } from '../generated/schema.js';
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

/** Must match `authToken` in `examples/users/backend/main.go`. */
const AUTH_TOKEN = 'ae_9f2e4c8b7a1d6e0f3c5b8a2d7e4f1c90';
const HOST = '127.0.0.1';
const PORT = Number(process.env.WEB_PORT ?? 3000);
const GRPC_ADDRESS = '127.0.0.1:50051';
const GRPC_WEB_PORT = Number(process.env.GRPC_WEB_PORT ?? 3100);
const spaDir = path.join(import.meta.dirname, 'spa');

function spaHtml() {
  return readFileSync(path.join(spaDir, 'index.html'), 'utf8').replaceAll(
    '__AUTH_TOKEN__',
    AUTH_TOKEN,
  );
}

function spaJs() {
  return esbuild.buildSync({
    entryPoints: [path.join(spaDir, 'app.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
  }).outputFiles![0]!.text;
}
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
  res: http.ServerResponse,
  status: number,
  body: string,
  type: string,
) {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    if (
      req.method === 'GET' &&
      (url.pathname === '/' || url.pathname === '/index.html')
    ) {
      send(res, 200, spaHtml(), 'text/html; charset=utf-8');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/styles.css') {
      send(
        res,
        200,
        readFileSync(path.join(spaDir, 'styles.css'), 'utf8'),
        'text/css; charset=utf-8',
      );
      return;
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      send(res, 200, spaJs(), 'text/javascript');
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (err) {
    send(
      res,
      500,
      err instanceof Error ? err.message : String(err),
      'text/plain; charset=utf-8',
    );
  }
});

process.stdout.write(`gRPC-Web listening on http://${grpcWebServer.address}\n`);
server.listen(PORT, HOST, () => {
  process.stdout.write(`web listening on http://${HOST}:${PORT}\n`);
});
