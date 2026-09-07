import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTRPCClient } from "@trpc/client";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { grpcLink, type CallContext } from "./link.js";
import type { ProtoMeta } from "@trpc-proto/schema_ir";

const t = initTRPC.meta<ProtoMeta>().create({
  defaultMeta: {
    proto: {
      package: "demo.v1",
      syntax: "proto3",
    },
  },
});

const appRouter = t.router({
  hello: t.procedure
    .input(z.object({ name: z.string() }))
    .output(z.object({ message: z.string() }))
    .query(({ input }) => ({ message: `hello ${input.name}` })),
});
type AppRouter = typeof appRouter;

/** Fixture token for interceptor metadata assertions. */
const TEST_TOKEN = "secret";

/** gRPC metadata key the auth interceptor writes. */
const AUTH_METADATA_KEY = "authorization";

/** Authorization scheme prefix the auth interceptor uses. */
const AUTH_SCHEME_BEARER = "Bearer";

describe("grpcLink", () => {
  it("attaches auth metadata before the stub call", async () => {
    const seen: CallContext[] = [];
    const client = createTRPCClient<AppRouter>({
      links: [
        grpcLink({
          router: appRouter,
          auth: { token: TEST_TOKEN },
          interceptors: [
            async (ctx) => {
              seen.push(ctx);
              ctx.metadata.set("x-trace", "1");
              return { message: `hello Ada` };
            },
          ],
        }),
      ],
    });
    const out = await client.hello.query({ name: "Ada" });
    assert.deepEqual(out, { message: "hello Ada" });
    assert.equal(
      seen[0]?.metadata.get(AUTH_METADATA_KEY),
      `${AUTH_SCHEME_BEARER} ${TEST_TOKEN}`,
    );
    assert.equal(seen[0]?.metadata.get("x-trace"), "1");
  });
});
