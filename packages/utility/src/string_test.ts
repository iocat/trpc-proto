import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dedent } from './string.js';

interface Case {
  name: string;
  input: string;
  expected: string;
}

const cases: Case[] = [
  { name: 'empty', input: '', expected: '' },
  { name: 'single newline', input: '\n', expected: '' },
  { name: 'no indent', input: 'a\nb', expected: 'a\nb' },
  {
    name: 'strips leading newline and shared indent',
    input: '\n  a\n    b\n',
    expected: 'a\n  b\n',
  },
  {
    name: 'ignores blank lines for indent',
    input: '  a\n\n    b',
    expected: 'a\n\n  b',
  },
  {
    name: 'all-whitespace lines stay',
    input: '  a\n  \n  b',
    expected: 'a\n\nb',
  },
];

describe('dedent', () => {
  for (const row of cases) {
    it(row.name, () => {
      assert.equal(dedent(row.input), row.expected);
    });
  }
});
