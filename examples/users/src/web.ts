import { createGrpcWebHop } from "@trpc-proto/runtime";
import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

/** Must match `authToken` in `examples/users/backend/main.go`. */
const AUTH_TOKEN = "ae_9f2e4c8b7a1d6e0f3c5b8a2d7e4f1c90";
const HOST = "127.0.0.1";
const PORT = Number(process.env.WEB_PORT ?? 3000);
const spaDir = path.join(import.meta.dirname, "spa");

function spaHtml() {
  return readFileSync(path.join(spaDir, "index.html"), "utf8").replaceAll(
    "__AUTH_TOKEN__",
    AUTH_TOKEN,
  );
}

function spaJs() {
  return esbuild.buildSync({
    entryPoints: [path.join(spaDir, "app.js")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  }).outputFiles![0]!.text;
}
const hop = createGrpcWebHop();

function send(
  res: http.ServerResponse,
  status: number,
  body: string,
  type: string,
) {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    if (await hop.handle(req, res)) return;
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    if (
      req.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/index.html")
    ) {
      send(res, 200, spaHtml(), "text/html; charset=utf-8");
      return;
    }
    if (req.method === "GET" && url.pathname === "/styles.css") {
      send(
        res,
        200,
        readFileSync(path.join(spaDir, "styles.css"), "utf8"),
        "text/css; charset=utf-8",
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/app.js") {
      send(res, 200, spaJs(), "text/javascript");
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (err) {
    send(
      res,
      500,
      err instanceof Error ? err.message : String(err),
      "text/plain; charset=utf-8",
    );
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`web listening on http://${HOST}:${PORT}\n`);
});
