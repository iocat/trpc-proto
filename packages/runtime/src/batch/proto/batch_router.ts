import { initTRPC, TRPCError } from '@trpc/server';
import type { ProtoMeta } from '@trpc-proto/schema_ir';
import { z } from 'zod';

const t = initTRPC.meta<ProtoMeta>().create({
  allowOutsideOfServer: true,
  defaultMeta: {
    proto: {
      package: 'trpc.batch.v1',
      schemaPath: 'src/batch/proto/generated/schema.ts',
      syntax: 'proto3',
    },
  },
});

const BatchCall = z
  .object({
    id: z.int().positive(),
    path: z.string(),
    input: z.file(),
  })
  .meta({ protoMessageName: 'BatchCall' });

const BatchRequest = z
  .object({
    calls: z.array(BatchCall),
  })
  .meta({ protoMessageName: 'BatchRequest' });

const BatchSuccess = z.object({
  result: z.literal('success'),
  id: z.int().positive(),
  output: z.file(),
});

const BatchFailure = z.object({
  result: z.literal('error'),
  id: z.int().positive(),
  code: z.int32(),
  message: z.string(),
});

const BatchResult = z
  .discriminatedUnion('result', [BatchSuccess, BatchFailure])
  .meta({ protoMessageName: 'BatchResult' });

const BatchResponse = z
  .object({
    results: z.array(BatchResult),
  })
  .meta({ protoMessageName: 'BatchResponse' });

const notImplemented = (): never => {
  throw new TRPCError({
    code: 'NOT_IMPLEMENTED',
    message: 'The batch procedure is implemented by the transport runtime',
  });
};

/** Declarative tRPC router that defines the transport-level batch envelope. */
export const batchRouter = t.router({
  batch: t.router({
    execute: t.procedure
      .input(BatchRequest)
      .output(BatchResponse)
      .mutation(notImplemented),
  }),
});

export type BatchRouter = typeof batchRouter;
