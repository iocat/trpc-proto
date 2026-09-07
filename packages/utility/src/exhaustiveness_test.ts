import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assumeExhaustive,
  assumeExhaustiveAllowing,
} from './exhaustiveness.js';

interface ThrowCase {
  name: string;
  value: unknown;
  error: RegExp;
}

const throwCases: ThrowCase[] = [
  { name: 'string', value: 'object', error: /unexpected value: object/ },
  { name: 'number', value: 0, error: /unexpected value: 0/ },
  { name: 'undefined', value: undefined, error: /unexpected value: undefined/ },
  { name: 'null', value: null, error: /unexpected value: null/ },
];

interface AllowCase {
  name: string;
  value: unknown;
}

const allowCases: AllowCase[] = [
  { name: 'string leftover', value: 'union' },
  { name: 'null leftover', value: null },
  { name: 'undefined leftover', value: undefined },
];

describe('assumeExhaustive', () => {
  for (const row of throwCases) {
    it(row.name, () => {
      assert.throws(
        () => assumeExhaustive(row.value as never),
        row.error,
      );
    });
  }
});

describe('assumeExhaustiveAllowing', () => {
  for (const row of allowCases) {
    it(row.name, () => {
      assert.equal(
        assumeExhaustiveAllowing<typeof row.value, typeof row.value>(row.value),
        undefined,
      );
    });
  }
});
