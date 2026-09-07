import { TRPCClientError, type TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { createProtoCodec } from "../proto_codec/proto_codec.js";
import { schemaFromRouter, type ProtoSchema } from "@trpc-proto/schema_ir";

/** gRPC metadata / HTTP header key for bearer credentials. */
const AUTH_METADATA_KEY = "authorization";

/** Default authorization scheme. Empty `AuthConfig.scheme` sends a raw token. */
const AUTH_SCHEME_BEARER = "Bearer";

function lookupRpc(schema: ProtoSchema, path: string) {
  for (const service of schema.services) {
    for (const method of service.methods) {
      if (method.path === path) return { service, method };
    }
  }
  return undefined;
}

export interface StubRequest {
  path: string;
  type: "query" | "mutation" | "subscription";
  /** JS value (pre-codec). */
  input: unknown;
  /** Runtime-encoded protobuf payload. Prefer this on the wire. */
  bytes?: Uint8Array;
  service?: string;
  method?: string;
  grpcPath?: string;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
}

/** Transport. Return decoded JS or raw response bytes (link will decode). */
export type StubCall = (request: StubRequest) => Promise<unknown>;

export interface CallContext {
  path: string;
  type: "query" | "mutation" | "subscription";
  service: string;
  method: string;
  grpcPath: string;
  input: unknown;
  metadata: Map<string, string>;
  signal?: AbortSignal;
}

export type CallInterceptor = (
  ctx: CallContext,
  next: (ctx: CallContext) => Promise<unknown>,
) => Promise<unknown>;

export type MaybePromise<T> = T | Promise<T>;

export interface AuthConfig {
  /** Bearer token, or getter. Empty/undefined skips the header. */
  token?: string | (() => MaybePromise<string | undefined>);
  /** Extra gRPC metadata (static or getter). */
  metadata?:
    Record<string, string> | (() => MaybePromise<Record<string, string>>);
  /** Metadata key. Default `authorization`. */
  header?: string;
  /** Token scheme. Default `Bearer`. Set `''` for a raw value. */
  scheme?: string;
}

export interface ProtoLinkOptions<TRouter extends AnyRouter = AnyRouter> {
  router: TRouter;
  interceptors?: CallInterceptor[];
  auth?: AuthConfig;
}

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value != null && typeof value === "object" && Symbol.asyncIterator in value
  );
}

function compose(
  interceptors: CallInterceptor[],
  terminal: (ctx: CallContext) => Promise<unknown>,
): (ctx: CallContext) => Promise<unknown> {
  let next = terminal;
  for (let i = interceptors.length - 1; i >= 0; i--) {
    const wrap = interceptors[i]!;
    const inner = next;
    next = (ctx) => wrap(ctx, inner);
  }
  return next;
}

export function authInterceptor(auth: AuthConfig): CallInterceptor {
  const header = auth.header ?? AUTH_METADATA_KEY;
  const scheme = auth.scheme === undefined ? AUTH_SCHEME_BEARER : auth.scheme;
  return async (ctx, next) => {
    const token =
      typeof auth.token === "function" ? await auth.token() : auth.token;
    if (token) {
      ctx.metadata.set(header, scheme ? `${scheme} ${token}` : token);
    }
    const extra =
      typeof auth.metadata === "function"
        ? await auth.metadata()
        : auth.metadata;
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        ctx.metadata.set(key, value);
      }
    }
    return next(ctx);
  };
}

/** Router walk + codec. `call` is native gRPC or gRPC-Web. */
export function createProtoLink<TRouter extends AnyRouter>(
  opts: ProtoLinkOptions<TRouter>,
  call: StubCall,
): TRPCLink<TRouter> {
  const schema = schemaFromRouter(opts.router);
  const codec = createProtoCodec(schema);
  const interceptors = [
    ...(opts.auth ? [authInterceptor(opts.auth)] : []),
    ...(opts.interceptors ?? []),
  ];

  return () =>
    ({ op }) =>
      observable((observer) => {
        const rpc = lookupRpc(schema, op.path);
        if (!rpc) {
          observer.error(
            TRPCClientError.from(new Error(`no gRPC mapping for ${op.path}`)),
          );
          return;
        }
        const { service, method } = rpc;
        const ac = new AbortController();
        if (op.signal) {
          op.signal.addEventListener("abort", () => ac.abort(), { once: true });
        }
        const ctx: CallContext = {
          path: op.path,
          type: op.type,
          service: service.name,
          method: method.name,
          grpcPath: `/${schema.package}.${service.name}/${method.name}`,
          input: op.input,
          metadata: new Map(),
          signal: ac.signal,
        };

        async function invoke(current: CallContext) {
          const bytes = codec.encode(method.requestType, current.input);
          const data = await call({
            path: current.path,
            type: current.type,
            input: current.input,
            bytes,
            service: current.service,
            method: current.method,
            grpcPath: current.grpcPath,
            metadata: Object.fromEntries(current.metadata),
            signal: current.signal,
          });
          if (isAsyncIterable(data)) return data;
          if (isBytes(data)) {
            return codec.decode(method.responseType, data);
          }
          return data;
        }

        const execute = compose(interceptors, invoke);
        void execute(ctx).then(
          async (data) => {
            if (isAsyncIterable(data)) {
              for await (const item of data) {
                if (ac.signal.aborted) break;
                const decoded = isBytes(item)
                  ? codec.decode(method.responseType, item)
                  : item;
                observer.next({ result: { type: "data", data: decoded } });
              }
              observer.complete();
              return;
            }
            observer.next({ result: { type: "data", data } });
            observer.complete();
          },
          (cause) => {
            observer.error(TRPCClientError.from(cause));
          },
        );

        return () => ac.abort();
      });
}
