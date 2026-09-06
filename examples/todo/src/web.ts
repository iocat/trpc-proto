import { createProtobufProxy, protoMetaFromRouter } from '@trpc-proto/runtime';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { appRouter } from './router.js';

/**
 * Bearer token required by the Go todo gRPC server.
 * Must match `authToken` in `examples/todo/backend/main.go`.
 */
const AUTH_TOKEN = 'td_c4a8e1b6f0d39725a8e4b1c7d6f2a905';

/** Placeholder in the SPA shell replaced with {@link AUTH_TOKEN} at serve time. */
const AUTH_TOKEN_PLACEHOLDER = '__AUTH_TOKEN__';

/** Loopback host for the dashboard proxy. */
const LOOPBACK_HOST = '127.0.0.1';

/** Default HTTP port for the todo dashboard. */
const DEFAULT_WEB_PORT = 3001;

/** gRPC dial target for the todo Go server. */
const GRPC_ADDRESS = '127.0.0.1:50052';

/** HTTP Content-Type for raw protobuf RPC bodies. */
const PROTOBUF_CONTENT_TYPE = 'application/x-protobuf';

/** HTML dashboard Content-Type. */
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

/** Served protobuf.js vendor script Content-Type. */
const JAVASCRIPT_CONTENT_TYPE = 'text/javascript';

/** Served `.proto` file Content-Type. */
const PROTO_FILE_CONTENT_TYPE = 'text/plain; charset=utf-8';

/** gRPC `UNAUTHENTICATED` status; mapped to HTTP 401. */
const GRPC_STATUS_UNAUTHENTICATED = 16;

/** HTTP header / gRPC metadata key for bearer credentials. */
const AUTH_METADATA_KEY = 'authorization';

const PORT = Number(process.env.WEB_PORT ?? DEFAULT_WEB_PORT);
const spaDir = path.join(import.meta.dirname, 'spa');
const html = readFileSync(path.join(spaDir, 'index.html'), 'utf8').replaceAll(
  AUTH_TOKEN_PLACEHOLDER,
  AUTH_TOKEN,
);
const pkg = protoMetaFromRouter(appRouter).proto?.package;
const proxy = createProtobufProxy(GRPC_ADDRESS);
const require = createRequire(import.meta.url);
const protobufRoot = path.dirname(require.resolve('protobufjs/package.json'));
const generatedDir = path.join(import.meta.dirname, '..', 'generated');

const GOOGLE_PROTOS: Record<string, string> = {
  'google/protobuf/empty.proto': `syntax = "proto3";
package google.protobuf;
message Empty {}
`,
  'google/protobuf/timestamp.proto': `syntax = "proto3";
package google.protobuf;
message Timestamp {
  int64 seconds = 1;
  int32 nanos = 2;
}
`,
};

function sendBytes(
  res: http.ServerResponse,
  status: number,
  body: Uint8Array,
  type: string,
) {
  res.writeHead(status, {
    'content-type': type,
    'content-length': String(body.byteLength),
  });
  res.end(Buffer.from(body));
}

function sendText(
  res: http.ServerResponse,
  status: number,
  body: string,
  type: string,
) {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

async function readBody(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${LOOPBACK_HOST}`);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      sendText(res, 200, html, HTML_CONTENT_TYPE);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/styles.css') {
      sendText(
        res,
        200,
        readFileSync(path.join(spaDir, 'styles.css'), 'utf8'),
        'text/css; charset=utf-8',
      );
      return;
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      sendText(
        res,
        200,
        readFileSync(path.join(spaDir, 'app.js'), 'utf8'),
        JAVASCRIPT_CONTENT_TYPE,
      );
      return;
    }
    if (req.method === 'GET' && url.pathname === '/vendor/protobuf.min.js') {
      sendText(
        res,
        200,
        readFileSync(path.join(protobufRoot, 'dist', 'protobuf.min.js'), 'utf8'),
        JAVASCRIPT_CONTENT_TYPE,
      );
      return;
    }
    if (req.method === 'GET' && url.pathname === '/proto/todo_v1.proto') {
      sendText(
        res,
        200,
        readFileSync(path.join(generatedDir, 'todo_v1.proto'), 'utf8'),
        PROTO_FILE_CONTENT_TYPE,
      );
      return;
    }
    const google = /^\/proto\/(google\/protobuf\/[a-z0-9_.]+\.proto)$/.exec(
      url.pathname,
    );
    if (req.method === 'GET' && google?.[1]) {
      const key = google[1];
      const disk = path.join(protobufRoot, key);
      const body = existsSync(disk) ? readFileSync(disk, 'utf8') : GOOGLE_PROTOS[key];
      if (!body) {
        res.writeHead(404);
        res.end();
        return;
      }
      sendText(res, 200, body, PROTO_FILE_CONTENT_TYPE);
      return;
    }
    const rpc = /^\/rpc\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'POST' && rpc?.[1] && rpc[2]) {
      const grpcPath = `/${pkg}.${rpc[1]}/${rpc[2]}`;
      const auth = req.headers[AUTH_METADATA_KEY];
      const out = await proxy.unary(
        grpcPath,
        await readBody(req),
        typeof auth === 'string' ? { [AUTH_METADATA_KEY]: auth } : undefined,
      );
      sendBytes(res, 200, out, PROTOBUF_CONTENT_TYPE);
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === 'object' && 'code' in err
        ? Number((err as { code: unknown }).code)
        : undefined;
    sendText(
      res,
      code === GRPC_STATUS_UNAUTHENTICATED ? 401 : 500,
      message,
      PROTO_FILE_CONTENT_TYPE,
    );
  }
});

server.listen(PORT, LOOPBACK_HOST, () => {
  process.stdout.write(`web listening on http://${LOOPBACK_HOST}:${PORT}\n`);
});
