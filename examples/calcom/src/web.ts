import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_WEB_PORT = 3003;
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const JAVASCRIPT_CONTENT_TYPE = 'text/javascript';
const PROTO_FILE_CONTENT_TYPE = 'text/plain; charset=utf-8';

const PORT = Number(process.env.WEB_PORT ?? DEFAULT_WEB_PORT);
const spaDir = path.join(import.meta.dirname, 'spa');
const html = readFileSync(path.join(spaDir, 'index.html'), 'utf8');
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

function sendText(
  res: http.ServerResponse,
  status: number,
  body: string,
  type: string,
) {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
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
    if (req.method === 'GET' && url.pathname === '/proto/calcom_v1.proto') {
      sendText(
        res,
        200,
        readFileSync(path.join(generatedDir, 'calcom_v1.proto'), 'utf8'),
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
    res.writeHead(404);
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendText(res, 500, message, PROTO_FILE_CONTENT_TYPE);
  }
});

server.listen(PORT, LOOPBACK_HOST, () => {
  process.stdout.write(`web listening on http://${LOOPBACK_HOST}:${PORT}\n`);
});
