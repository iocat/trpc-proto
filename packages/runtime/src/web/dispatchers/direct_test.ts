import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as grpc from '@grpc/grpc-js';
import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  schemaFromRouter,
  zAsyncIterable,
  type ProtoMeta,
} from '@trpc-proto/schema_ir';
import { ProtoCodec } from '../../proto_codec/proto_codec.js';
import { createDirectDispatcher } from './direct.js';

const t = initTRPC.meta<ProtoMeta>().create({
  defaultMeta: { proto: { package: 'direct.v1' } },
});
const appRouter = t.router({
  echo: t.procedure
    .input(z.object({ text: z.string() }))
    .output(z.object({ message: z.string(), length: z.int() }))
    .query(({ input }) => ({
      message: `echo ${input.text}`,
      length: input.text.length,
    })),
  count: t.procedure
    .input(z.object({ end: z.int() }))
    .output(
      zAsyncIterable({
        yield: z.object({ sequence: z.int(), squared: z.int() }),
      }),
    )
    .subscription(async function* ({ input }) {
      for (let value = 1; value <= input.end; value += 1) {
        yield { sequence: value, squared: value * value };
      }
    }),
  missing: t.procedure
    .input(z.object({}))
    .output(z.object({}))
    .query(() => {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'missing' });
    }),
  explode: t.procedure
    .input(z.object({}))
    .output(z.object({}))
    .query(() => {
      throw new Error('boom');
    }),
});
const schema = schemaFromRouter(appRouter);
const codec = new ProtoCodec(schema);
const dispatch = createDirectDispatcher(appRouter, { schema });

function routeFor(procedurePath: string) {
  for (const service of schema.services) {
    for (const method of service.methods) {
      if (method.path === procedurePath) {
        return {
          grpcPath: `/${schema.package}.${service.name}/${method.name}`,
          requestType: method.requestType,
          responseType: method.responseType,
        };
      }
    }
  }
  throw new Error(`missing test route for ${procedurePath}`);
}

describe('createDirectDispatcher', () => {
  it('decodes, invokes, and encodes a unary method', async () => {
    const route = routeFor('echo');
    const messages: Uint8Array[] = [];
    const status = await dispatch(
      {
        grpcPath: route.grpcPath,
        message: codec.encode(route.requestType, { text: 'Ada' }),
        metadata: new Map(),
        signal: new AbortController().signal,
      },
      async (message) => {
        messages.push(message);
      },
    );

    assert.deepEqual(status, { code: grpc.status.OK, message: '' });
    assert.deepEqual(
      messages.map((message) => codec.decode(route.responseType, message)),
      [{ message: 'echo Ada', length: 3 }],
    );
  });

  it('emits every server-streaming result in order', async () => {
    const route = routeFor('count');
    const values: unknown[] = [];

    const status = await dispatch(
      {
        grpcPath: route.grpcPath,
        message: codec.encode(route.requestType, { end: 3 }),
        metadata: new Map(),
        signal: new AbortController().signal,
      },
      async (message) => {
        values.push(codec.decode(route.responseType, message));
      },
    );

    assert.deepEqual(status, { code: grpc.status.OK, message: '' });
    assert.deepEqual(values, [
      { sequence: 1, squared: 1 },
      { sequence: 2, squared: 4 },
      { sequence: 3, squared: 9 },
    ]);
  });

  it('stops a stream and returns CANCELLED after abort', async () => {
    const route = routeFor('count');
    const controller = new AbortController();
    const values: unknown[] = [];

    const status = await dispatch(
      {
        grpcPath: route.grpcPath,
        message: codec.encode(route.requestType, { end: 3 }),
        metadata: new Map(),
        signal: controller.signal,
      },
      async (message) => {
        values.push(codec.decode(route.responseType, message));
        controller.abort();
      },
    );

    assert.deepEqual(values, [{ sequence: 1, squared: 1 }]);
    assert.deepEqual(status, { code: grpc.status.CANCELLED, message: '' });
  });

  it('returns UNIMPLEMENTED for an unknown schema path', async () => {
    let emitted = false;

    const status = await dispatch(
      {
        grpcPath: '/direct.v1.AppService/Unknown',
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
      code: grpc.status.UNIMPLEMENTED,
      message: 'no gRPC mapping for /direct.v1.AppService/Unknown',
    });
  });

  it('maps tRPC errors and unexpected exceptions to gRPC status', async () => {
    const cases = [
      {
        procedurePath: 'missing',
        code: grpc.status.NOT_FOUND,
        message: 'missing',
      },
      {
        procedurePath: 'explode',
        code: grpc.status.INTERNAL,
        message: 'boom',
      },
    ];

    for (const row of cases) {
      const route = routeFor(row.procedurePath);
      const status = await dispatch(
        {
          grpcPath: route.grpcPath,
          message: codec.encode(route.requestType, {}),
          metadata: new Map(),
          signal: new AbortController().signal,
        },
        async () => assert.fail(`${row.procedurePath} emitted a response`),
      );
      assert.deepEqual(status, { code: row.code, message: row.message });
    }
  });
});
