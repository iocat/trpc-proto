import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const children: ChildProcess[] = [];

/** Loopback host printed after the stack is up. */
const LOOPBACK_HOST = '127.0.0.1';

/** Dashboard port served by `src/web.ts`. */
const WEB_PORT = 3000;
function run(command: string, args: string[], cwd = root) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });
}

function start(command: string, args: string[], ready: RegExp, cwd = root) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const onData = (buf: Buffer) => {
    const text = buf.toString();
    process.stdout.write(text);
    if (ready.test(text)) resolve();
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', (buf: Buffer) => process.stderr.write(buf));
  child.on('exit', (code) => {
    if (code && code !== 0) reject(new Error(`${args.join(' ')} exited ${code}`));
  });
  return promise;
}

function shutdown() {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await run('pnpm', ['run', 'generate']);
await run('bash', ['generate.sh'], path.join(root, 'backend'));
await start('go', ['run', '.'], /gRPC listening/, path.join(root, 'backend'));
await start('pnpm', ['exec', 'tsx', 'src/web.ts'], /web listening/);
process.stdout.write(`\nopen http://${LOOPBACK_HOST}:${WEB_PORT}\n`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('ctrl-c to stop\n', () => undefined);
