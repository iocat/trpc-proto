import { writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector';
import { serveGrpcWeb } from '@trpc-proto/runtime';

const backendAddress = process.env.GRPC_BACKEND_ADDRESS;
if (!backendAddress) throw new Error('GRPC_BACKEND_ADDRESS is required');
const cpuProfilePath = process.env.PROJECT_PROXY_CPU_PROFILE_PATH;
const profiler = cpuProfilePath ? new Session() : undefined;

function postInspector<T>(session: Session, method: string): Promise<T> {
  const pending = Promise.withResolvers<T>();
  session.post(method, (error, result) => {
    if (error) pending.reject(error);
    else pending.resolve(result as T);
  });
  return pending.promise;
}

if (profiler) {
  profiler.connect();
  await postInspector(profiler, 'Profiler.enable');
  await postInspector(profiler, 'Profiler.start');
}

const server = await serveGrpcWeb({
  mode: 'forward',
  backend: { address: backendAddress },
  address: '127.0.0.1:0',
});

let closing = false;
const close = async (): Promise<void> => {
  if (closing) return;
  closing = true;
  await server.close();
  if (profiler && cpuProfilePath) {
    const result = await postInspector<{ profile: unknown }>(
      profiler,
      'Profiler.stop',
    );
    await writeFile(cpuProfilePath, JSON.stringify(result.profile), 'utf8');
    profiler.disconnect();
  }
  process.exit(0);
};

const requestClose = (): void => {
  void close().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
};

process.on('message', (message: unknown) => {
  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'shutdown'
  ) {
    requestClose();
  }
});
process.once('SIGTERM', requestClose);
process.send?.({ type: 'ready', endpoint: `http://${server.address}` });
