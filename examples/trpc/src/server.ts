import { serveGrpc } from "@trpc-proto/runtime";
import { GRPC_ADDRESS } from "./address.js";
import { appRouter } from "./router.js";

const { address } = await serveGrpc(appRouter, { address: GRPC_ADDRESS });
process.stdout.write(`gRPC listening on ${address}\n`);
