import { fork, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createConnection, createServer as createNetServer } from 'node:net';
import { cpus, platform, release, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createTRPCClient } from '@trpc/client';
import {
  grpcLink,
  grpcWebLink,
  type GrpcWebEncoding,
} from '@trpc-proto/runtime';
import { schema, type AppRouter } from './fixture.js';

interface Options {
  concurrency: number;
  durationMs: number;
  json: boolean;
  envoy: boolean;
  envoyBin: string;
  payloadBytes: number;
  projectCpuProfile?: string;
  reportPath: string;
  rounds: number;
  streamMessages: number;
  warmupMs: number;
  workload: 'all' | 'stream' | 'unary';
}

type Implementation = 'direct' | 'envoy' | 'forward' | 'native';

interface Scenario {
  name: string;
  encoding: 'base64' | 'native' | 'raw';
  implementation: Implementation;
  requestCompression: 'gzip' | 'none';
  workload: 'stream' | 'unary';
  operation: () => Promise<number>;
}

interface WindowResult {
  elapsedMs: number;
  errors: number;
  latenciesMs: number[];
  messages: number;
  operations: number;
}

interface RelativeThroughput {
  throughputRatio: number;
  throughputDeltaPercent: number;
}

interface BenchmarkResult {
  workload: 'stream' | 'unary';
  transport: string;
  encoding: 'base64' | 'native' | 'raw';
  implementation: Implementation;
  requestCompression: 'gzip' | 'none';
  rounds: number;
  operations: number;
  messages: number;
  errors: number;
  elapsedSeconds: number;
  operationsPerSecond: number;
  messagesPerSecond: number;
  latencyMs: {
    average: number;
    p50: number;
    p95: number;
    p99: number;
  };
  versusNative: RelativeThroughput;
  versusForwardingProxy: RelativeThroughput | null;
  versusUncompressed: RelativeThroughput | null;
}

type MeasuredResult = Omit<
  BenchmarkResult,
  'versusNative' | 'versusForwardingProxy' | 'versusUncompressed'
>;

const DEFAULT_REPORT_PATH = fileURLToPath(
  new URL('../results/latest.md', import.meta.url),
);

const positiveInteger = (name: string, raw: string | undefined): number => {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
};

const positiveSeconds = (name: string, raw: string | undefined): number => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value * 1_000;
};

function parseOptions(argv: readonly string[]): Options {
  const options: Options = {
    concurrency: 32,
    durationMs: 3_000,
    envoy: false,
    envoyBin: process.env.ENVOY_BIN ?? 'envoy',
    json: false,
    payloadBytes: 256,
    projectCpuProfile: undefined,
    rounds: 3,
    streamMessages: 16,
    reportPath: DEFAULT_REPORT_PATH,
    warmupMs: 1_000,
    workload: 'all',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--') continue;
    if (flag === '--envoy') {
      options.envoy = true;
      continue;
    }
    if (flag === '--json') {
      options.json = true;
      continue;
    }
    const raw = argv[index + 1];
    switch (flag) {
      case '--concurrency':
        options.concurrency = positiveInteger(flag, raw);
        break;
      case '--duration':
        options.durationMs = positiveSeconds(flag, raw);
        break;
      case '--envoy-bin':
        if (!raw) throw new Error('--envoy-bin requires a file path');
        options.envoyBin = raw;
        break;
      case '--payload-bytes':
        options.payloadBytes = positiveInteger(flag, raw);
        break;
      case '--project-cpu-profile':
        if (!raw) throw new Error('--project-cpu-profile requires a file path');
        options.projectCpuProfile = resolve(raw);
        break;
      case '--rounds':
        options.rounds = positiveInteger(flag, raw);
        break;
      case '--stream-messages':
        options.streamMessages = positiveInteger(flag, raw);
        break;
      case '--report':
        if (!raw) throw new Error('--report requires a file path');
        options.reportPath = resolve(raw);
        break;
      case '--warmup':
        options.warmupMs = positiveSeconds(flag, raw);
        break;
      case '--workload':
        if (raw !== 'all' && raw !== 'stream' && raw !== 'unary') {
          throw new Error('--workload must be all, unary, or stream');
        }
        options.workload = raw;
        break;
      default:
        throw new Error(`unknown option: ${String(flag)}`);
    }
    index += 1;
  }

  return options;
}

type Client = ReturnType<typeof createTRPCClient<AppRouter>>;

interface ManagedService {
  endpoint: string;
  version?: string;
  stop(): Promise<void>;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = Promise.withResolvers<void>();
  child.once('exit', () => exited.resolve());
  if (child.connected) child.send({ type: 'shutdown' });
  else child.kill('SIGTERM');
  await exited.promise;
}

async function startNodeService(
  moduleName: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ManagedService> {
  const child = fork(fileURLToPath(new URL(moduleName, import.meta.url)), [], {
    env: environment,
    execArgv: ['--import', import.meta.resolve('tsx')],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const ready = Promise.withResolvers<string>();
  const onError = (error: Error): void => ready.reject(error);
  const onExit = (code: number | null, signal: NodeJS.Signals | null): void =>
    ready.reject(
      new Error(
        `${moduleName} exited before readiness (code ${String(code)}, signal ${String(signal)})`,
      ),
    );
  const onMessage = (message: unknown): void => {
    if (
      message &&
      typeof message === 'object' &&
      'type' in message &&
      message.type === 'ready' &&
      'endpoint' in message &&
      typeof message.endpoint === 'string'
    ) {
      ready.resolve(message.endpoint);
    }
  };
  child.once('error', onError);
  child.once('exit', onExit);
  child.on('message', onMessage);
  const endpoint = await ready.promise;
  child.removeListener('error', onError);
  child.removeListener('exit', onExit);
  child.removeListener('message', onMessage);
  return {
    endpoint,
    stop: () => stopChild(child),
  };
}

async function reserveTcpPort(): Promise<number> {
  const server = createNetServer();
  const listening = Promise.withResolvers<void>();
  server.once('error', listening.reject);
  server.listen(0, '127.0.0.1', listening.resolve);
  await listening.promise;
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to reserve a TCP port');
  }
  const closed = Promise.withResolvers<void>();
  server.close((error) => {
    if (error) closed.reject(error);
    else closed.resolve();
  });
  await closed.promise;
  return address.port;
}

function envoyConfig(listenerPort: number, backendPort: number): string {
  return JSON.stringify({
    static_resources: {
      listeners: [
        {
          name: 'grpc_web',
          address: {
            socket_address: {
              address: '127.0.0.1',
              port_value: listenerPort,
            },
          },
          filter_chains: [
            {
              filters: [
                {
                  name: 'envoy.filters.network.http_connection_manager',
                  typed_config: {
                    '@type':
                      'type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager',
                    stat_prefix: 'grpc_web',
                    codec_type: 'HTTP1',
                    stream_idle_timeout: '0s',
                    route_config: {
                      name: 'backend',
                      virtual_hosts: [
                        {
                          name: 'backend',
                          domains: ['*'],
                          routes: [
                            {
                              match: { prefix: '/' },
                              route: { cluster: 'backend', timeout: '0s' },
                            },
                          ],
                        },
                      ],
                    },
                    http_filters: [
                      {
                        name: 'envoy.filters.http.grpc_web',
                        typed_config: {
                          '@type':
                            'type.googleapis.com/envoy.extensions.filters.http.grpc_web.v3.GrpcWeb',
                        },
                      },
                      {
                        name: 'envoy.filters.http.router',
                        typed_config: {
                          '@type':
                            'type.googleapis.com/envoy.extensions.filters.http.router.v3.Router',
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
      clusters: [
        {
          name: 'backend',
          type: 'STATIC',
          connect_timeout: '1s',
          load_assignment: {
            cluster_name: 'backend',
            endpoints: [
              {
                lb_endpoints: [
                  {
                    endpoint: {
                      address: {
                        socket_address: {
                          address: '127.0.0.1',
                          port_value: backendPort,
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
          typed_extension_protocol_options: {
            'envoy.extensions.upstreams.http.v3.HttpProtocolOptions': {
              '@type':
                'type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions',
              explicit_http_config: { http2_protocol_options: {} },
            },
          },
        },
      ],
    },
  });
}

async function canConnect(port: number): Promise<boolean> {
  const connected = Promise.withResolvers<boolean>();
  const socket = createConnection({ host: '127.0.0.1', port });
  socket.setTimeout(250);
  socket.once('connect', () => {
    socket.destroy();
    connected.resolve(true);
  });
  socket.once('error', () => connected.resolve(false));
  socket.once('timeout', () => {
    socket.destroy();
    connected.resolve(false);
  });
  return connected.promise;
}

async function waitForPort(
  port: number,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Envoy exited before its listener became ready');
    }
    if (await canConnect(port)) return;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Envoy did not listen on port ${port} within ${timeoutMs}ms`);
}

async function startEnvoy(
  envoyBin: string,
  backendAddress: string,
): Promise<ManagedService> {
  const versionResult = spawnSync(envoyBin, ['--version'], {
    encoding: 'utf8',
  });
  if (versionResult.error) {
    throw new Error(
      `cannot run Envoy at ${JSON.stringify(envoyBin)}; install it or pass --envoy-bin`,
      { cause: versionResult.error },
    );
  }
  if (versionResult.status !== 0) {
    throw new Error(`Envoy --version failed: ${versionResult.stderr.trim()}`);
  }
  const backendPort = positiveInteger(
    'backend port',
    backendAddress.split(':').at(-1),
  );
  const listenerPort = await reserveTcpPort();
  const configDirectory = await mkdtemp(join(tmpdir(), 'trpc-proto-envoy-'));
  const configPath = join(configDirectory, 'envoy.json');
  await writeFile(configPath, envoyConfig(listenerPort, backendPort), 'utf8');
  const child = spawn(
    envoyBin,
    [
      '-c',
      configPath,
      '--log-level',
      'error',
      '--concurrency',
      '1',
      '--disable-hot-restart',
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  try {
    await waitForPort(listenerPort, child, 10_000);
  } catch (error) {
    child.kill('SIGTERM');
    await rm(configDirectory, { recursive: true, force: true });
    throw error;
  }
  return {
    endpoint: `http://127.0.0.1:${listenerPort}`,
    version: versionResult.stdout.trim(),
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = Promise.withResolvers<void>();
        child.once('exit', () => exited.resolve());
        child.kill('SIGTERM');
        await exited.promise;
      }
      await rm(configDirectory, { recursive: true, force: true });
    },
  };
}

function makeNativeClient(address: string): Client {
  return createTRPCClient<AppRouter>({
    links: [grpcLink<AppRouter>({ schema, address })],
  });
}

function makeWebClient(
  url: string,
  encoding: GrpcWebEncoding,
  compress: boolean,
): Client {
  return createTRPCClient<AppRouter>({
    links: [grpcWebLink<AppRouter>({ schema, url, encoding, compress })],
  });
}

function unaryOperation(
  client: Client,
  payload: string,
): () => Promise<number> {
  return async () => {
    const result = await client.echo.query({ sequence: 1, payload });
    if (result.sequence !== 1 || result.payload.length !== payload.length) {
      throw new Error('unary response failed validation');
    }
    return 1;
  };
}

function streamOperation(
  client: Client,
  payload: string,
  expectedMessages: number,
): () => Promise<number> {
  return async () => {
    const completed = Promise.withResolvers<number>();
    let received = 0;
    let subscription: { unsubscribe(): void } | undefined;
    subscription = client.stream.subscribe(
      { messages: expectedMessages, payload },
      {
        onData(value) {
          if (
            value.sequence !== received ||
            value.payload.length !== payload.length
          ) {
            completed.reject(new Error('stream response failed validation'));
            return;
          }
          received += 1;
        },
        onError: completed.reject,
        onComplete() {
          if (received !== expectedMessages) {
            completed.reject(
              new Error(
                `stream ended after ${received}/${expectedMessages} messages`,
              ),
            );
            return;
          }
          completed.resolve(received);
        },
      },
    );
    try {
      return await completed.promise;
    } finally {
      subscription?.unsubscribe();
    }
  };
}

async function runWindow(
  operation: () => Promise<number>,
  concurrency: number,
  durationMs: number,
  collectLatencies: boolean,
): Promise<WindowResult> {
  const startedAt = performance.now();
  const deadline = startedAt + durationMs;
  let errors = 0;
  let messages = 0;
  let operations = 0;
  const latenciesMs: number[] = [];

  const worker = async (): Promise<void> => {
    while (performance.now() < deadline) {
      const operationStartedAt = performance.now();
      try {
        const completedMessages = await operation();
        messages += completedMessages;
        operations += 1;
        if (collectLatencies) {
          latenciesMs.push(performance.now() - operationStartedAt);
        }
      } catch {
        errors += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return {
    elapsedMs: performance.now() - startedAt,
    errors,
    latenciesMs,
    messages,
    operations,
  };
}

function percentile(sorted: readonly number[], proportion: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil(sorted.length * proportion) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

function aggregate(
  scenario: Scenario,
  windows: readonly WindowResult[],
): MeasuredResult {
  const latenciesMs = windows.flatMap((window) => window.latenciesMs);
  latenciesMs.sort((left, right) => left - right);
  const elapsedMs = windows.reduce((sum, window) => sum + window.elapsedMs, 0);
  const errors = windows.reduce((sum, window) => sum + window.errors, 0);
  const messages = windows.reduce((sum, window) => sum + window.messages, 0);
  const operations = windows.reduce(
    (sum, window) => sum + window.operations,
    0,
  );
  const latencySum = latenciesMs.reduce((sum, value) => sum + value, 0);
  const elapsedSeconds = elapsedMs / 1_000;

  return {
    workload: scenario.workload,
    transport: scenario.name,
    encoding: scenario.encoding,
    implementation: scenario.implementation,
    requestCompression: scenario.requestCompression,
    rounds: windows.length,
    operations,
    messages,
    errors,
    elapsedSeconds,
    operationsPerSecond: operations / elapsedSeconds,
    messagesPerSecond: messages / elapsedSeconds,
    latencyMs: {
      average: latencySum / Math.max(1, latenciesMs.length),
      p50: percentile(latenciesMs, 0.5),
      p95: percentile(latenciesMs, 0.95),
      p99: percentile(latenciesMs, 0.99),
    },
  };
}

function relativeThroughput(
  result: MeasuredResult,
  baseline: MeasuredResult,
): RelativeThroughput {
  const throughputRatio =
    result.operationsPerSecond / baseline.operationsPerSecond;
  return {
    throughputRatio,
    throughputDeltaPercent: (throughputRatio - 1) * 100,
  };
}

function addComparisons(results: readonly MeasuredResult[]): BenchmarkResult[] {
  return results.map((result) => {
    const native = results.find(
      (candidate) =>
        candidate.workload === result.workload &&
        candidate.encoding === 'native',
    );
    if (!native) throw new Error(`missing native ${result.workload} baseline`);
    const uncompressed =
      result.requestCompression === 'gzip'
        ? results.find(
            (candidate) =>
              candidate.workload === result.workload &&
              candidate.implementation === result.implementation &&
              candidate.encoding === result.encoding &&
              candidate.requestCompression === 'none',
          )
        : undefined;
    if (result.requestCompression === 'gzip' && !uncompressed) {
      throw new Error(
        `missing uncompressed ${result.workload} / ${result.encoding} baseline`,
      );
    }
    const comparesWithForwarding =
      result.implementation === 'direct' || result.implementation === 'envoy';
    const forwardingProxy = comparesWithForwarding
      ? results.find(
          (candidate) =>
            candidate.workload === result.workload &&
            candidate.implementation === 'forward' &&
            candidate.encoding === result.encoding &&
            candidate.requestCompression === result.requestCompression,
        )
      : undefined;
    if (comparesWithForwarding && !forwardingProxy) {
      throw new Error(
        `missing forwarding proxy ${result.workload} / ${result.encoding} / ${result.requestCompression} baseline`,
      );
    }
    return {
      ...result,
      versusNative: relativeThroughput(result, native),
      versusForwardingProxy: forwardingProxy
        ? relativeThroughput(result, forwardingProxy)
        : null,
      versusUncompressed: uncompressed
        ? relativeThroughput(result, uncompressed)
        : null,
    };
  });
}

function scenarioKey(scenario: Scenario): string {
  return [
    scenario.workload,
    scenario.implementation,
    scenario.encoding,
    scenario.requestCompression,
  ].join(':');
}

async function runScenarios(
  scenarios: readonly Scenario[],
  options: Options,
): Promise<BenchmarkResult[]> {
  const windows = new Map<string, WindowResult[]>();
  for (const scenario of scenarios) {
    process.stderr.write(
      `warming ${scenario.workload} / ${scenario.implementation} / ${scenario.name}\n`,
    );
    const warmup = await runWindow(
      scenario.operation,
      options.concurrency,
      options.warmupMs,
      false,
    );
    if (warmup.errors > 0) {
      throw new Error(
        `${scenario.workload} / ${scenario.implementation} / ${scenario.name} warmup had ${warmup.errors} errors`,
      );
    }
    windows.set(scenarioKey(scenario), []);
  }

  for (let round = 0; round < options.rounds; round += 1) {
    const offset = round % scenarios.length;
    const ordered = [...scenarios.slice(offset), ...scenarios.slice(0, offset)];
    for (const scenario of ordered) {
      process.stderr.write(
        `round ${round + 1}/${options.rounds}: ${scenario.workload} / ${scenario.implementation} / ${scenario.name}\n`,
      );
      const result = await runWindow(
        scenario.operation,
        options.concurrency,
        options.durationMs,
        true,
      );
      windows.get(scenarioKey(scenario))?.push(result);
    }
  }

  return addComparisons(
    scenarios.map((scenario) =>
      aggregate(scenario, windows.get(scenarioKey(scenario)) ?? []),
    ),
  );
}

function printHuman(
  metadata: Record<string, unknown>,
  results: readonly BenchmarkResult[],
): void {
  console.log(JSON.stringify(metadata, null, 2));
  console.table(
    results.map((result) => ({
      workload: result.workload,
      path: result.implementation,
      transport: result.transport,
      compression: result.requestCompression,
      'ops/s': result.operationsPerSecond.toFixed(1),
      'messages/s': result.messagesPerSecond.toFixed(1),
      'avg ms': result.latencyMs.average.toFixed(2),
      'p95 ms': result.latencyMs.p95.toFixed(2),
      'p99 ms': result.latencyMs.p99.toFixed(2),
      'vs native': `${(result.versusNative.throughputRatio * 100).toFixed(1)}%`,
      'vs forward': result.versusForwardingProxy
        ? signedPercent(result.versusForwardingProxy.throughputDeltaPercent)
        : '—',
      'vs uncompressed': result.versusUncompressed
        ? `${result.versusUncompressed.throughputDeltaPercent >= 0 ? '+' : ''}${result.versusUncompressed.throughputDeltaPercent.toFixed(1)}%`
        : '—',
      errors: result.errors,
    })),
  );
}
function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function renderMarkdownReport(
  metadata: Record<string, unknown>,
  results: readonly BenchmarkResult[],
): string {
  const lines = [
    '# gRPC-Web benchmark report',
    '',
    `Generated: ${String(metadata.generatedAt)}`,
    '',
    '## Configuration',
    '',
    `- Runtime: ${String(metadata.node)}`,
    `- Platform: ${String(metadata.platform)}`,
    `- CPU: ${String(metadata.cpu)} (${String(metadata.logicalCpus)} logical CPUs)`,
    `- Concurrency: ${String(metadata.concurrency)}`,
    `- Measurement: ${String(metadata.rounds)} round${Number(metadata.rounds) === 1 ? '' : 's'} × ${String(metadata.durationSeconds)} seconds`,
    `- Warmup: ${String(metadata.warmupSeconds)} seconds per scenario`,
    `- Payload: ${String(metadata.payloadBytes)} bytes`,
    `- Stream length: ${String(metadata.streamMessages)} messages`,
    `- Envoy: ${String(metadata.envoyVersion)}`,
    `- Topology: ${String(metadata.topology)}`,
    '',
    'Gzip applies to the gRPC-Web request message. Stream responses are not compressed by this dimension.',
    '',
    '## Results',
    '',
    '| Workload | Path | Transport | Request compression | Operations/s | Messages/s | Average | p50 | p95 | p99 | vs native | vs forward | Compression delta | Errors |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const result of results) {
    lines.push(
      `| ${result.workload} | ${result.implementation} | ${result.transport} | ${result.requestCompression} | ${result.operationsPerSecond.toFixed(1)} | ${result.messagesPerSecond.toFixed(1)} | ${result.latencyMs.average.toFixed(2)} ms | ${result.latencyMs.p50.toFixed(2)} ms | ${result.latencyMs.p95.toFixed(2)} ms | ${result.latencyMs.p99.toFixed(2)} ms | ${(result.versusNative.throughputRatio * 100).toFixed(1)}% | ${result.versusForwardingProxy ? signedPercent(result.versusForwardingProxy.throughputDeltaPercent) : '—'} | ${result.versusUncompressed ? signedPercent(result.versusUncompressed.throughputDeltaPercent) : '—'} | ${result.errors} |`,
    );
  }
  lines.push(
    '',
    '“Compression delta” compares a gzip-request scenario with the uncompressed scenario using the same workload, path implementation, and gRPC-Web encoding.',
    '“vs forward” compares direct dispatch or Envoy with the project forwarding proxy using the same workload, encoding, and request compression.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

async function writeMarkdownReport(
  path: string,
  metadata: Record<string, unknown>,
  results: readonly BenchmarkResult[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderMarkdownReport(metadata, results), 'utf8');
  process.stderr.write(`wrote report ${relative(process.cwd(), path)}\n`);
}
interface ClientTarget {
  client: Client;
  encoding: 'base64' | 'native' | 'raw';
  implementation: Implementation;
  name: string;
  requestCompression: 'gzip' | 'none';
}

function proxyClientTargets(
  implementation: 'direct' | 'envoy' | 'forward',
  url: string,
): ClientTarget[] {
  return [
    {
      client: makeWebClient(url, 'raw', false),
      encoding: 'raw',
      implementation,
      name: 'gRPC-Web raw',
      requestCompression: 'none',
    },
    {
      client: makeWebClient(url, 'raw', true),
      encoding: 'raw',
      implementation,
      name: 'gRPC-Web raw',
      requestCompression: 'gzip',
    },
    {
      client: makeWebClient(url, 'base64', false),
      encoding: 'base64',
      implementation,
      name: 'gRPC-Web base64',
      requestCompression: 'none',
    },
    {
      client: makeWebClient(url, 'base64', true),
      encoding: 'base64',
      implementation,
      name: 'gRPC-Web base64',
      requestCompression: 'gzip',
    },
  ];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const payload = 'x'.repeat(options.payloadBytes);
  let backend: ManagedService | undefined;
  let directServer: ManagedService | undefined;
  let forwardingProxy: ManagedService | undefined;
  let envoy: ManagedService | undefined;

  try {
    backend = await startNodeService('./backend_process.ts');
    directServer = await startNodeService('./direct_server_process.ts');
    const profilePath = options.projectCpuProfile;
    if (profilePath) await mkdir(dirname(profilePath), { recursive: true });
    forwardingProxy = await startNodeService('./project_proxy_process.ts', {
      ...process.env,
      GRPC_BACKEND_ADDRESS: backend.endpoint,
      ...(profilePath ? { PROJECT_PROXY_CPU_PROFILE_PATH: profilePath } : {}),
    });
    if (options.envoy) {
      envoy = await startEnvoy(options.envoyBin, backend.endpoint);
    }

    const directTargets = proxyClientTargets('direct', directServer.endpoint);
    const forwardingTargets = proxyClientTargets(
      'forward',
      forwardingProxy.endpoint,
    );
    const envoyTargets = envoy
      ? proxyClientTargets('envoy', envoy.endpoint)
      : [];
    const targets: ClientTarget[] = [
      {
        client: makeNativeClient(backend.endpoint),
        encoding: 'native',
        implementation: 'native',
        name: 'gRPC',
        requestCompression: 'none',
      },
    ];
    for (let index = 0; index < directTargets.length; index += 1) {
      const directTarget = directTargets[index];
      if (directTarget) targets.push(directTarget);
      const forwardingTarget = forwardingTargets[index];
      if (forwardingTarget) targets.push(forwardingTarget);
      const envoyTarget = envoyTargets[index];
      if (envoyTarget) targets.push(envoyTarget);
    }

    const scenarios: Scenario[] = [];
    for (const target of targets) {
      if (options.workload !== 'stream') {
        scenarios.push({
          name: target.name,
          encoding: target.encoding,
          implementation: target.implementation,
          requestCompression: target.requestCompression,
          workload: 'unary',
          operation: unaryOperation(target.client, payload),
        });
      }
      if (options.workload !== 'unary') {
        scenarios.push({
          name: target.name,
          encoding: target.encoding,
          implementation: target.implementation,
          requestCompression: target.requestCompression,
          workload: 'stream',
          operation: streamOperation(
            target.client,
            payload,
            options.streamMessages,
          ),
        });
      }
    }

    const metadata = {
      generatedAt: new Date().toISOString(),
      node: process.version,
      platform: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpus: cpus().length,
      concurrency: options.concurrency,
      durationSeconds: options.durationMs / 1_000,
      warmupSeconds: options.warmupMs / 1_000,
      rounds: options.rounds,
      payloadBytes: options.payloadBytes,
      streamMessages: options.streamMessages,
      envoyVersion: envoy?.version ?? 'not included',
      topology: options.envoy
        ? 'separate load-generator, direct-dispatch server, native backend, forwarding proxy, and Envoy processes; HTTP/1.1 gRPC-Web ingress; direct dispatch has no native gRPC loopback'
        : 'separate load-generator, direct-dispatch server, native backend, and forwarding proxy processes; HTTP/1.1 gRPC-Web ingress; direct dispatch has no native gRPC loopback',
    };
    const results = await runScenarios(scenarios, options);
    if (options.json) {
      console.log(JSON.stringify({ metadata, results }, null, 2));
    } else {
      printHuman(metadata, results);
    }
    await writeMarkdownReport(options.reportPath, metadata, results);
    const errors = results.reduce((sum, result) => sum + result.errors, 0);
    if (errors > 0) {
      throw new Error(`benchmark completed with ${errors} request errors`);
    }
  } finally {
    if (envoy) await envoy.stop();
    if (forwardingProxy) await forwardingProxy.stop();
    if (directServer) await directServer.stop();
    if (backend) await backend.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
