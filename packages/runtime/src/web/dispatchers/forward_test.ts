import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import * as grpc from '@grpc/grpc-js';
import type { ProtoSchema } from '@trpc-proto/schema_ir';
import { createForwardingDispatcher } from './forward.js';

const schema = {
  syntax: 'proto3',
  package: 'demo.v1',
  services: [
    {
      name: 'AppService',
      methods: [
        {
          name: 'Unary',
          path: 'unary',
          type: 'query',
          requestType: 'UnaryRequest',
          responseType: 'UnaryResponse',
          isResponseStreaming: false,
        },
        {
          name: 'Stream',
          path: 'stream',
          type: 'subscription',
          requestType: 'StreamRequest',
          responseType: 'StreamResponse',
          isResponseStreaming: true,
        },
      ],
    },
  ],
  messages: [],
  enums: [],
} satisfies ProtoSchema;

type TestCall = grpc.ClientUnaryCall & grpc.ClientReadableStream<Buffer>;

function clientCall(onCancel: () => void = () => {}): TestCall {
  return Object.assign(new EventEmitter(), {
    cancel: onCancel,
    getPeer() {
      return 'test';
    },
  }) as unknown as TestCall;
}

function emitStatus(
  call: TestCall,
  code: grpc.status,
  details = '',
  metadata = new grpc.Metadata(),
): void {
  call.emit('status', { code, details, metadata } satisfies grpc.StatusObject);
}

function serviceError(
  code: grpc.status,
  details: string,
  metadata = new grpc.Metadata(),
): grpc.ServiceError {
  return Object.assign(new Error(details), { code, details, metadata });
}

describe('createForwardingDispatcher', () => {
  it('uses a grpc-js unary call for a unary schema method', async () => {
    const call = clientCall();
    let selectedMethod = '';
    let sentMessage: Buffer | undefined;
    let sentAuthorization: string | Buffer | undefined;
    const client = {
      makeUnaryRequest(...args: unknown[]) {
        selectedMethod = 'unary';
        sentMessage = args[3] as Buffer;
        sentAuthorization = (args[4] as grpc.Metadata).get('authorization')[0];
        const callback = args.at(-1) as grpc.requestCallback<Buffer>;
        queueMicrotask(() => {
          callback(null, Buffer.from([2]));
          emitStatus(call, grpc.status.OK);
        });
        return call;
      },
      makeServerStreamRequest() {
        assert.fail('selected server-streaming call for unary method');
      },
    } as unknown as grpc.Client;
    const dispatch = createForwardingDispatcher(client, schema);
    const messages: Uint8Array[] = [];

    const status = await dispatch(
      {
        grpcPath: '/demo.v1.AppService/Unary',
        message: new Uint8Array([1]),
        metadata: new Map([['authorization', 'Bearer token']]),
        signal: new AbortController().signal,
      },
      async (message) => {
        messages.push(message);
      },
    );

    assert.equal(selectedMethod, 'unary');
    assert.deepEqual(sentMessage, Buffer.from([1]));
    assert.equal(sentAuthorization, 'Bearer token');
    assert.deepEqual(messages, [new Uint8Array([2])]);
    assert.deepEqual(status, {
      code: grpc.status.OK,
      message: '',
      metadata: {},
    });
  });

  it('uses a grpc-js server stream and serializes response writes', async () => {
    const call = clientCall();
    const trailers = new grpc.Metadata();
    trailers.set('x-request-id', 'request-1');
    const client = {
      makeUnaryRequest() {
        assert.fail('selected unary call for server-streaming method');
      },
      makeServerStreamRequest() {
        queueMicrotask(() => {
          call.emit('data', Buffer.from([1]));
          call.emit('data', Buffer.from([2]));
          emitStatus(call, grpc.status.OK, '', trailers);
        });
        return call;
      },
    } as unknown as grpc.Client;
    const dispatch = createForwardingDispatcher(client, schema);
    const messages: Uint8Array[] = [];
    let activeWrites = 0;
    let maxActiveWrites = 0;

    const status = await dispatch(
      {
        grpcPath: '/demo.v1.AppService/Stream',
        message: new Uint8Array([0]),
        metadata: new Map(),
        signal: new AbortController().signal,
      },
      async (message) => {
        activeWrites += 1;
        maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
        await Promise.resolve();
        messages.push(message);
        activeWrites -= 1;
      },
    );

    assert.equal(maxActiveWrites, 1);
    assert.deepEqual(messages, [new Uint8Array([1]), new Uint8Array([2])]);
    assert.deepEqual(status, {
      code: grpc.status.OK,
      message: '',
      metadata: { 'x-request-id': 'request-1' },
    });
  });

  it('uses the unary callback error instead of a conflicting status event', async () => {
    const call = clientCall();
    const trailers = new grpc.Metadata();
    trailers.set('x-error-id', 'error-1');
    const client = {
      makeUnaryRequest(...args: unknown[]) {
        const callback = args.at(-1) as grpc.requestCallback<Buffer>;
        queueMicrotask(() => {
          callback(serviceError(grpc.status.NOT_FOUND, 'missing', trailers));
          emitStatus(call, grpc.status.OK);
        });
        return call;
      },
    } as unknown as grpc.Client;
    const dispatch = createForwardingDispatcher(client, schema);
    let emitted = false;

    const status = await dispatch(
      {
        grpcPath: '/demo.v1.AppService/Unary',
        message: new Uint8Array(),
        metadata: new Map(),
        signal: new AbortController().signal,
      },
      async () => {
        emitted = true;
      },
    );

    assert.equal(emitted, false);
    assert.deepEqual(status, {
      code: grpc.status.NOT_FOUND,
      message: 'missing',
      metadata: { 'x-error-id': 'error-1' },
    });
  });

  it('rejects an unknown schema path without creating an upstream call', async () => {
    let upstreamCalls = 0;
    const client = {
      makeUnaryRequest() {
        upstreamCalls += 1;
      },
      makeServerStreamRequest() {
        upstreamCalls += 1;
      },
    } as unknown as grpc.Client;
    const dispatch = createForwardingDispatcher(client, schema);

    const status = await dispatch(
      {
        grpcPath: '/demo.v1.AppService/Missing',
        message: new Uint8Array(),
        metadata: new Map(),
        signal: new AbortController().signal,
      },
      async () => assert.fail('unknown route emitted a response'),
    );

    assert.equal(upstreamCalls, 0);
    assert.deepEqual(status, {
      code: grpc.status.UNIMPLEMENTED,
      message: 'no gRPC mapping for /demo.v1.AppService/Missing',
    });
  });

  it('cancels an active upstream call when the request signal aborts', async () => {
    let cancellations = 0;
    const call = clientCall(() => {
      cancellations += 1;
    });
    let callback: grpc.requestCallback<Buffer> | undefined;
    const client = {
      makeUnaryRequest(...args: unknown[]) {
        callback = args.at(-1) as grpc.requestCallback<Buffer>;
        return call;
      },
    } as unknown as grpc.Client;
    const dispatch = createForwardingDispatcher(client, schema);
    const controller = new AbortController();
    const pending = dispatch(
      {
        grpcPath: '/demo.v1.AppService/Unary',
        message: new Uint8Array(),
        metadata: new Map(),
        signal: controller.signal,
      },
      async () => assert.fail('cancelled call emitted a response'),
    );

    controller.abort();
    assert.equal(cancellations, 1);
    const error = serviceError(grpc.status.CANCELLED, 'Cancelled on client');
    callback?.(error);
    emitStatus(call, grpc.status.CANCELLED, 'Cancelled on client');

    assert.deepEqual(await pending, {
      code: grpc.status.CANCELLED,
      message: 'Cancelled on client',
      metadata: {},
    });
  });
});
