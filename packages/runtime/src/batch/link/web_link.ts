import { TRPCClientError, type TRPCLink } from '@trpc/client';
import type { AnyRouter, ProcedureType } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import {
  authInterceptor,
  type CallContext,
  type CallInterceptor,
  type ProtoLinkOptions,
  type StubCall,
} from '../../grpc/proto_link.js';
import { ProtoCodec, type RuntimeProtoRpc } from '../../proto_codec/index.js';
import type { GrpcWebEncoding } from '../../web/content_type.js';
import { GrpcWebError } from '../../web/codec/protocol_codec.js';
import { createGrpcWebFetchCall } from '../../web/fetch_call.js';
import {
  BATCH_GRPC_PATH,
  BATCH_PROCEDURE_PATH,
  DEFAULT_MAX_BATCH_ITEMS,
  batchProtocol,
  type BatchWireRequest,
  type BatchWireResponse,
} from '../proto/wire.js';

/** Configuration for batching tRPC operations over gRPC-Web. */
export interface GrpcWebBatchLinkOptions extends ProtoLinkOptions {
  /** Origin for gRPC-Web POSTs. Default `''` (same origin). */
  url?: string;
  /** HTTP body representation. Defaults to base64 gRPC-Web. */
  encoding?: GrpcWebEncoding;
  /** Gzip-compresses the batch request message. Defaults to false. */
  compress?: boolean;
  /** Maximum operations per gRPC request. Defaults to 100. */
  maxItems?: number;
}

interface LinkOperation {
  path: string;
  type: ProcedureType;
  input: unknown;
  signal?: AbortSignal | null;
}

interface QueuedOperation {
  op: LinkOperation;
  cancelled: boolean;
  abortBatch?: () => void;
  deliver(value: unknown): void;
  fail(cause: unknown): void;
}

function compose(
  interceptors: CallInterceptor[],
  terminal: (ctx: CallContext) => Promise<unknown>,
): (ctx: CallContext) => Promise<unknown> {
  let next = terminal;
  for (let index = interceptors.length - 1; index >= 0; index--) {
    const interceptor = interceptors[index]!;
    const inner = next;
    next = (ctx) => interceptor(ctx, inner);
  }
  return next;
}

class GrpcWebBatchLink<TRouter extends AnyRouter> {
  readonly #appCodec: ProtoCodec;
  readonly #batchCodec: ProtoCodec;
  readonly #batchRpc: RuntimeProtoRpc;
  readonly #call: StubCall<Uint8Array | AsyncIterable<Uint8Array>>;
  readonly #interceptors: CallInterceptor[];
  readonly #maxItems: number;

  constructor(options: GrpcWebBatchLinkOptions) {
    this.#appCodec = new ProtoCodec(options.schema);
    const protocol = batchProtocol();
    this.#batchCodec = protocol.codec;
    this.#batchRpc = protocol.rpc;
    this.#call = createGrpcWebFetchCall({
      baseUrl: options.url,
      encoding: options.encoding,
      compress: options.compress,
    });
    this.#maxItems = options.maxItems ?? DEFAULT_MAX_BATCH_ITEMS;
    if (!Number.isInteger(this.#maxItems) || this.#maxItems < 1) {
      throw new Error('maxItems must be a positive integer');
    }
    this.#interceptors = [
      ...(options.auth ? [authInterceptor(options.auth)] : []),
      ...(options.interceptors ?? []),
    ];
  }

  link(): TRPCLink<TRouter> {
    return () => {
      const enqueue = {
        query: this.#createQueue('query'),
        mutation: this.#createQueue('mutation'),
      };

      return ({ op }) =>
        observable((observer) => {
          if (op.type === 'subscription') {
            observer.error(
              TRPCClientError.from(
                new Error(
                  'Subscriptions are unsupported by grpcWebBatchLink; use grpcWebLink',
                ),
              ),
            );
            return;
          }

          let completed = false;
          const abort = () => {
            item.cancelled = true;
            item.abortBatch?.();
          };
          const item: QueuedOperation = {
            op,
            cancelled: op.signal?.aborted ?? false,
            deliver(value) {
              if (completed || item.cancelled) return;
              completed = true;
              op.signal?.removeEventListener('abort', abort);
              observer.next({ result: { type: 'data', data: value } });
              observer.complete();
            },
            fail(cause) {
              if (completed || item.cancelled) return;
              completed = true;
              op.signal?.removeEventListener('abort', abort);
              observer.error(
                TRPCClientError.from(
                  cause instanceof Error ? cause : new Error(String(cause)),
                ),
              );
            },
          };
          op.signal?.addEventListener('abort', abort, { once: true });
          enqueue[op.type](item);

          return abort;
        });
    };
  }

  #createQueue(type: 'query' | 'mutation'): (item: QueuedOperation) => void {
    let pending: QueuedOperation[] = [];
    let scheduled = false;

    const flush = () => {
      scheduled = false;
      const queued = pending;
      pending = [];
      const groups: QueuedOperation[][] = [];
      for (let index = 0; index < queued.length; index += this.#maxItems) {
        groups.push(queued.slice(index, index + this.#maxItems));
      }
      void (async () => {
        for (const group of groups) await this.#execute(type, group);
      })();
    };

    return (item) => {
      pending.push(item);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    };
  }

  async #execute(
    type: 'query' | 'mutation',
    items: QueuedOperation[],
  ): Promise<void> {
    const active = items.filter(
      (item) => !item.cancelled && !item.op.signal?.aborted,
    );
    if (active.length === 0) return;

    const byId = new Map<number, QueuedOperation>();
    const responseTypes = new Map<number, string>();
    const request: BatchWireRequest = { calls: [] };
    for (const item of active) {
      const rpc = this.#appCodec.lookupRpc(item.op.path);
      if (!rpc || rpc.method.responseStream) {
        item.fail(
          new Error(
            rpc
              ? `subscriptions cannot be included in a batch: ${item.op.path}`
              : `no gRPC mapping for ${item.op.path}`,
          ),
        );
        continue;
      }
      const id = request.calls.length + 1;
      try {
        request.calls.push({
          id,
          path: item.op.path,
          input: this.#appCodec.encode(rpc.method.requestType, item.op.input),
        });
        byId.set(id, item);
        responseTypes.set(id, rpc.method.responseType);
      } catch (error) {
        item.fail(error);
      }
    }
    if (request.calls.length === 0) return;

    const controller = new AbortController();
    const abortWhenUnused = () => {
      if ([...byId.values()].every((item) => item.cancelled)) {
        controller.abort();
      }
    };
    for (const item of byId.values()) item.abortBatch = abortWhenUnused;

    const context: CallContext = {
      path: BATCH_PROCEDURE_PATH,
      type,
      service: this.#batchRpc.service,
      method: this.#batchRpc.method.name,
      grpcPath: BATCH_GRPC_PATH,
      input: request,
      metadata: new Map(),
      signal: controller.signal,
    };
    const invoke = compose(this.#interceptors, async (current) =>
      this.#call({
        path: current.path,
        type,
        input: current.input,
        bytes: this.#batchCodec.encode(
          this.#batchRpc.method.requestType,
          current.input,
        ),
        service: current.service,
        method: current.method,
        grpcPath: current.grpcPath,
        metadata: Object.fromEntries(current.metadata),
        signal: current.signal,
      }),
    );

    try {
      const encoded = await invoke(context);
      if (!(encoded instanceof Uint8Array)) {
        throw new Error('batch RPC returned a streaming response');
      }
      const decoded = this.#batchCodec.decode(
        this.#batchRpc.method.responseType,
        encoded,
      ) as Partial<BatchWireResponse>;
      const results = new Map(
        (decoded.results ?? []).map((result) => [result.id, result]),
      );
      if (results.size !== (decoded.results ?? []).length) {
        throw new Error('batch RPC returned duplicate result ids');
      }

      for (const [id, item] of byId) {
        if (item.cancelled) continue;
        const result = results.get(id);
        if (!result) {
          item.fail(new Error(`batch RPC omitted result ${id}`));
          continue;
        }
        if (result.result === 'error') {
          item.fail(new GrpcWebError(result.code, result.message));
          continue;
        }
        try {
          item.deliver(
            this.#appCodec.decode(
              responseTypes.get(id)!,
              result.output ?? new Uint8Array(),
            ),
          );
        } catch (error) {
          item.fail(error);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        for (const item of byId.values()) {
          if (!item.cancelled) item.fail(error);
        }
      }
    } finally {
      for (const item of byId.values()) item.abortBatch = undefined;
    }
  }
}

/** Batches query and mutation operations into the built-in unary batch RPC. */
export function grpcWebBatchLink<TRouter extends AnyRouter>(
  options: GrpcWebBatchLinkOptions,
): TRPCLink<TRouter> {
  return new GrpcWebBatchLink<TRouter>(options).link();
}
