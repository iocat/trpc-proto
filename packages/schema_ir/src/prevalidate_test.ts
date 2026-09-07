import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPrevalidate, formatIssues, prevalidate } from "./prevalidate.js";
import type { ProtoFileHeader } from "./types.js";

const proto: ProtoFileHeader = {
  package: "demo.v1",
};

describe("prevalidate", () => {
  it("requires proto.package", () => {
    const issues = prevalidate({
      procedures: [{ path: "hello", hasOutput: true }],
    });
    assert.equal(issues[0]?.message, "proto.package is required");
    assert.match(
      formatIssues(issues),
      /defaultMeta: \{ proto: \{ package: 'your\.package\.v1' \} \}/,
    );
    assert.throws(
      () => assertPrevalidate(issues),
      /proto\.package is required/,
    );
  });

  it("accepts package-only proto meta (syntax proto3, cache optional)", () => {
    assert.deepEqual(
      prevalidate({
        defaultProto: proto,
        procedures: [{ path: "hello", hasOutput: true, proto }],
      }),
      [],
    );
  });

  it("collects missing package and missing outputs together", () => {
    const issues = prevalidate({
      procedures: [
        { path: "hello", hasOutput: false },
        { path: "ping", hasOutput: false },
      ],
    });
    assert.deepEqual(
      issues.map((issue) => issue.message),
      [
        "proto.package is required",
        "procedure hello missing required output",
        "procedure ping missing required output",
      ],
    );
    const report = formatIssues(issues, "src/router.ts");
    assert.match(report, /^src\/router\.ts$/m);
    assert.match(report, /error: procedure hello missing required output/);
    assert.match(report, /hello: t\.procedure/);
    assert.throws(
      () => assertPrevalidate(issues, "src/router.ts"),
      /procedure ping missing required output/,
    );
  });

  it("throws when a procedure overrides proto meta", () => {
    const issues = prevalidate({
      defaultProto: proto,
      procedures: [
        {
          path: "hello",
          hasOutput: true,
          proto: { package: "other.v1" },
        },
      ],
    });
    assert.equal(issues[0]?.message, "procedure hello overrides proto meta");
    assert.throws(
      () => assertPrevalidate(issues),
      /procedure hello overrides proto meta/,
    );
  });
});
