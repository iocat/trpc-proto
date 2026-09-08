import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tracked } from '@trpc/server';
import { z } from 'zod';
import { asyncIterableYieldSchema, zAsyncIterable } from './async_iterable.js';

describe('zAsyncIterable', () => {
  it('validates yielded and returned values', async () => {
    const schema = zAsyncIterable({
      yield: z.coerce.number(),
      return: z.coerce.string(),
    });
    async function* source(): AsyncGenerator<unknown, unknown, unknown> {
      yield '42';
      return 7;
    }

    const iterable = await schema.parseAsync(source());
    const iterator = iterable[Symbol.asyncIterator]();
    assert.deepEqual(await iterator.next(), { value: 42, done: false });
    assert.deepEqual(await iterator.next(), { value: '7', done: true });
  });

  it('validates tracked values without changing their ids', async () => {
    const schema = zAsyncIterable({
      yield: z.object({ count: z.coerce.number() }),
      tracked: true,
    });
    async function* source() {
      yield tracked('event-1', { count: '3' });
    }

    const iterable = await schema.parseAsync(source());
    const iterator = iterable[Symbol.asyncIterator]();
    assert.deepEqual(await iterator.next(), {
      value: tracked('event-1', { count: 3 }),
      done: false,
    });
  });

  it('rejects invalid yielded values during iteration', async () => {
    const schema = zAsyncIterable({ yield: z.object({ count: z.int() }) });
    async function* source() {
      yield { count: 1.5 };
    }

    const iterable = await schema.parseAsync(source());
    const iterator = iterable[Symbol.asyncIterator]();
    await assert.rejects(iterator.next());
  });

  it('retains the yield schema for protobuf generation', () => {
    const yielded = z.object({ id: z.string() });
    const schema = zAsyncIterable({ yield: yielded });
    assert.equal(asyncIterableYieldSchema(schema), yielded);
  });
});
