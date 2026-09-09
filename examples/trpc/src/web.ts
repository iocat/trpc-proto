import { serveGrpcWeb } from '@trpc-proto/runtime';
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { protoSchema } from '../generated/schema.js';
import { appRouter } from './router.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.WEB_PORT ?? 3002);
const GRPC_WEB_PORT = Number(process.env.GRPC_WEB_PORT ?? 3102);
const spaDir = path.join(import.meta.dirname, 'spa');
const html = readFileSync(path.join(spaDir, 'index.html'), 'utf8');
const spaJs = esbuild.buildSync({
  entryPoints: [path.join(spaDir, 'app.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'silent',
}).outputFiles![0]!.text;
const grpcWebServer = await serveGrpcWeb({
  mode: 'direct',
  router: appRouter,
  schema: protoSchema,
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
      send(res, 200, html, 'text/html; charset=utf-8');
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
      send(res, 200, spaJs, 'text/javascript');
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
