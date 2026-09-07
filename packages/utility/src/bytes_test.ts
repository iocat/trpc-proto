import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { concat, isBytes } from './bytes.js';

interface GuardCase {
  name: string;
  value: unknown;
  expected: boolean;
}

const bytesCases: GuardCase[] = [
  { name: 'Uint8Array', value: new Uint8Array([1]), expected: true },
  { name: 'empty Uint8Array', value: new Uint8Array(), expected: true },
  { name: 'Buffer', value: Buffer.from([1, 2]), expected: true },
  { name: 'ArrayBuffer', value: new ArrayBuffer(2), expected: false },
  { name: 'number array', value: [1, 2], expected: false },
  { name: 'null', value: null, expected: false },
  { name: 'undefined', value: undefined, expected: false },
  { name: 'string', value: 'ab', expected: false },
];

interface ConcatCase {
  name: string;
  chunks: number[][];
  expected: number[];
}

const concatCases: ConcatCase[] = [
  { name: 'no chunks', chunks: [], expected: [] },
  { name: 'one empty chunk', chunks: [[]], expected: [] },
  { name: 'one chunk', chunks: [[1, 2, 3]], expected: [1, 2, 3] },
  { name: 'two chunks', chunks: [[1], [2, 3]], expected: [1, 2, 3] },
  { name: 'empty between', chunks: [[1], [], [2]], expected: [1, 2] },
];

describe('isBytes', () => {
  for (const row of bytesCases) {
    it(row.name, () => {
      assert.equal(isBytes(row.value), row.expected);
    });
  }
});

describe('concat', () => {
  for (const row of concatCases) {
    it(row.name, () => {
      const chunks = row.chunks.map((bytes) => Uint8Array.from(bytes));
      assert.deepEqual([...concat(chunks)], row.expected);
    });
  }
});
