import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFieldAllocator } from "./field_allocator.js";

type Op = "auto" | number;

function assignTags(ops: Op[], seed: Record<string, number> = {}): number[] {
  const gen = createFieldAllocator(seed);
  return ops.map((op) =>
    op === "auto" ? gen.next().value : gen.next(op).value,
  );
}

interface AutoCase {
  name: string;
  seed?: Record<string, number>;
  ops: Op[];
  expected: number[];
}

interface ThrowCase {
  name: string;
  seed?: Record<string, number>;
  ops: Op[];
  error: RegExp;
}

const autoCases: AutoCase[] = [
  {
    name: "auto sequence starts at 1",
    ops: ["auto", "auto", "auto"],
    expected: [1, 2, 3],
  },
  {
    name: "seeded tags are skipped on auto-increment",
    seed: { a: 2 },
    ops: ["auto", "auto", "auto"],
    expected: [1, 3, 4],
  },
  {
    name: "seed occupying 1 is skipped on auto",
    seed: { a: 1 },
    ops: ["auto", "auto"],
    expected: [2, 3],
  },
  {
    name: "explicit tag then auto continues after it",
    ops: [5, "auto", "auto"],
    expected: [5, 6, 7],
  },
  {
    name: "auto then explicit ahead of cursor",
    ops: ["auto", 10, "auto"],
    expected: [1, 10, 11],
  },
  {
    name: "explicit below cursor fills a hole",
    ops: ["auto", 5, 2],
    expected: [1, 5, 2],
  },
  {
    name: "explicit 18999 then auto skips reserved range",
    ops: [18999, "auto"],
    expected: [18999, 20000],
  },
  {
    name: "explicit 20000 then auto is 20001",
    ops: [20000, "auto"],
    expected: [20000, 20001],
  },
];

const throwCases: ThrowCase[] = [
  {
    name: "duplicate explicit tag",
    ops: ["auto", 1],
    error: /Duplicate protobuf tag 1/,
  },
  {
    name: "duplicate of seeded tag",
    seed: { a: 4 },
    ops: [4],
    error: /Duplicate protobuf tag 4/,
  },
  {
    name: "reserved range 19000",
    ops: [19000],
    error: /reserved range/,
  },
  {
    name: "reserved range 19999",
    ops: [19999],
    error: /reserved range/,
  },
  {
    name: "tag 0 out of range",
    ops: [0],
    error: /out of range/,
  },
  {
    name: "tag above max out of range",
    ops: [536_870_912],
    error: /out of range/,
  },
];

describe("createFieldAllocator", () => {
  for (const row of autoCases) {
    it(row.name, () => {
      assert.deepEqual(assignTags(row.ops, row.seed), row.expected);
    });
  }

  for (const row of throwCases) {
    it(row.name, () => {
      assert.throws(() => assignTags(row.ops, row.seed), row.error);
    });
  }
});
