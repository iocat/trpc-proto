import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { generate } from "./generate.js";

describe("generate", () => {
  async function rejectGenerate(fixture: string, pattern: RegExp) {
    const outDir = await mkdtemp(path.join(os.tmpdir(), "trpc-proto-"));
    await assert.rejects(
      () =>
        generate({
          routerFile: fileURLToPath(
            new URL(`./fixtures/${fixture}`, import.meta.url),
          ),
          outDir,
        }),
      pattern,
    );
  }

  it("throws when proto.package is missing", async () => {
    await rejectGenerate(
      "router_missing_default_proto.ts",
      /proto\.package is required/,
    );
  });

  it("throws when a procedure is missing .output()", async () => {
    await rejectGenerate(
      "router_missing_output.ts",
      /procedure ping missing required output/,
    );
  });

  it("throws when a procedure overrides proto meta", async () => {
    await rejectGenerate(
      "router_proto_override.ts",
      /procedure ping overrides proto meta/,
    );
  });
});
