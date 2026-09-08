import { serveGrpc } from '@trpc-proto/runtime';
import { protoSchema } from '../generated/schema.js';
import { GRPC_ADDRESS } from './address.js';
import { appRouter } from './router.js';

const { address } = await serveGrpc(appRouter, {
  schema: protoSchema,
  address: GRPC_ADDRESS,
});
process.stdout.write(`gRPC listening on ${address}\n`);
