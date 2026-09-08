import { serveGrpcWeb } from '@trpc-proto/runtime';
import { appRouter, schema } from './fixture.js';

const server = await serveGrpcWeb({
  mode: 'direct',
  router: appRouter,
  schema,
  address: '127.0.0.1:0',
});

let closing = false;
const close = async (): Promise<void> => {
  if (closing) return;
  closing = true;
  await server.close();
  process.exit(0);
};

process.on('message', (message: unknown) => {
  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'shutdown'
  ) {
    void close();
  }
});
process.once('SIGTERM', () => void close());
process.send?.({ type: 'ready', endpoint: `http://${server.address}` });
