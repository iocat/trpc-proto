import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  toCamel,
  toPascalCase,
  toScreamingSnake,
  toSnakeCase,
} from './case.js';

interface Case {
  name: string;
  input: string;
  expected: string;
}

const pascalCases: Case[] = [
  { name: 'empty', input: '', expected: '' },
  { name: 'already PascalCase', input: 'UserRole', expected: 'UserRole' },
  { name: 'dot path', input: 'user.getById', expected: 'UserGetById' },
  { name: 'snake', input: 'user_role', expected: 'UserRole' },
  { name: 'kebab', input: 'user-role', expected: 'UserRole' },
  {
    name: 'mixed separators',
    input: 'org.workspace_stats',
    expected: 'OrgWorkspaceStats',
  },
  { name: 'leading separator dropped', input: '_id', expected: 'Id' },
];

const snakeCases: Case[] = [
  { name: 'empty', input: '', expected: '' },
  { name: 'lowercase', input: 'id', expected: 'id' },
  { name: 'PascalCase', input: 'UserRole', expected: '_user_role' },
  { name: 'camelCase', input: 'userRole', expected: 'user_role' },
  { name: 'already snake', input: 'user_role', expected: 'user_role' },
];

const screamingCases: Case[] = [
  { name: 'empty', input: '', expected: '' },
  { name: 'PascalCase', input: 'UserRole', expected: 'USER_ROLE' },
  { name: 'kebab', input: 'user-role', expected: 'USER_ROLE' },
  { name: 'dot', input: 'issue.status', expected: 'ISSUE_STATUS' },
  { name: 'leading underscore stripped', input: '_foo', expected: 'FOO' },
  {
    name: 'repeated separators collapsed',
    input: 'a--b__c',
    expected: 'A_B_C',
  },
];

const camelCases: Case[] = [
  { name: 'empty', input: '', expected: '' },
  { name: 'no underscore', input: 'teamId', expected: 'teamId' },
  { name: 'one underscore', input: 'team_id', expected: 'teamId' },
  { name: 'two underscores', input: 'created_at_ms', expected: 'createdAtMs' },
  { name: 'leading underscore', input: '_id', expected: 'Id' },
];

describe('toPascalCase', () => {
  for (const row of pascalCases) {
    it(row.name, () => {
      assert.equal(toPascalCase(row.input), row.expected);
    });
  }
});

describe('toSnakeCase', () => {
  for (const row of snakeCases) {
    it(row.name, () => {
      assert.equal(toSnakeCase(row.input), row.expected);
    });
  }
});

describe('toScreamingSnake', () => {
  for (const row of screamingCases) {
    it(row.name, () => {
      assert.equal(toScreamingSnake(row.input), row.expected);
    });
  }
});

describe('toCamel', () => {
  for (const row of camelCases) {
    it(row.name, () => {
      assert.equal(toCamel(row.input), row.expected);
    });
  }
});
