import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAsyncIterable } from './iterable.js';

async function* gen() {
  yield 1;
}

interface GuardCase {
  name: string;
  value: unknown;
  expected: boolean;
}

const cases: GuardCase[] = [
  { name: 'async generator', value: gen(), expected: true },
  {
    name: 'async iterator object',
    value: {
      [Symbol.asyncIterator]() {
        return {
          next: async () => ({ done: true as const, value: undefined }),
        };
      },
    },
    expected: true,
  },
  { name: 'array', value: [1], expected: false },
  { name: 'plain object', value: {}, expected: false },
  { name: 'null', value: null, expected: false },
  { name: 'undefined', value: undefined, expected: false },
  { name: 'string', value: 'ab', expected: false },
];

describe('isAsyncIterable', () => {
  for (const row of cases) {
    it(row.name, () => {
      assert.equal(isAsyncIterable(row.value), row.expected);
    });
  }
});
