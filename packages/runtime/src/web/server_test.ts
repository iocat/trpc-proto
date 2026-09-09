import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import * as grpc from '@grpc/grpc-js';
import { createTRPCClient } from '@trpc/client';
import { initTRPC } from '@trpc/server';
import {
  schemaFromRouter,
  zAsyncIterable,
  type ProtoMeta,
  type ProtoSchema,
} from '@trpc-proto/schema_ir';
import { z } from 'zod';
import { serveGrpc } from '../grpc/server.js';
import { createGrpcWebFetchCall } from './fetch_call.js';
import { GrpcWebError } from './codec/protocol_codec.js';
import { grpcWebLink } from './link.js';
import type { MtlsConfig } from './http_handler.js';
import { serveGrpcWeb } from './server.js';

const t = initTRPC.meta<ProtoMeta>().create({
  defaultMeta: { proto: { package: 'direct.v1' } },
});

const testCertificatePath = (name: string): string =>
  fileURLToPath(new URL(`./testdata/${name}`, import.meta.url));
const caCertPath = testCertificatePath('ca-cert.pem');
const clientIdentity = {
  certPath: testCertificatePath('client-cert.pem'),
  keyPath: testCertificatePath('client-key.pem'),
};
const tlsCases = [
  {
    name: 'one-way TLS',
    checkClientCertificate: false,
  },
  {
    name: 'mutual TLS',
    checkClientCertificate: true,
    clientIdentity,
  },
] satisfies readonly {
  name: string;
  checkClientCertificate: boolean;
  clientIdentity?: MtlsConfig['clientIdentity'];
}[];

const identitySchema = {
  syntax: 'proto3',
  package: 'rotation.v1',
  services: [
    {
      name: 'IdentityService',
      methods: [
        {
          name: 'WhoAmI',
          path: 'whoAmI',
          type: 'query',
          requestType: 'WhoAmIRequest',
          responseType: 'WhoAmIResponse',
          isResponseStreaming: false,
        },
      ],
    },
  ],
  messages: [],
  enums: [],
} satisfies ProtoSchema;

async function startIdentityBackend(port: number) {
  const server = new grpc.Server();
  server.addService(
    {
      WhoAmI: {
        path: '/rotation.v1.IdentityService/WhoAmI',
        requestStream: false,
        responseStream: false,
        requestSerialize: (value: Buffer) => value,
        requestDeserialize: (value: Buffer) => value,
        responseSerialize: (value: Buffer) => value,
        responseDeserialize: (value: Buffer) => value,
      },
    },
    {
      WhoAmI(
        call: grpc.ServerUnaryCall<Buffer, Buffer>,
        callback: grpc.sendUnaryData<Buffer>,
      ) {
        const commonName =
          call.getAuthContext().sslPeerCertificate?.subject.CN ?? '';
        callback(null, Buffer.from(commonName));
      },
    },
  );
  const boundPort = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      `127.0.0.1:${port}`,
      grpc.ServerCredentials.createSsl(
        readFileSync(caCertPath),
        [
          {
            cert_chain: readFileSync(testCertificatePath('server-cert.pem')),
            private_key: readFileSync(testCertificatePath('server-key.pem')),
          },
        ],
        true,
      ),
      (error, bound) => (error ? reject(error) : resolve(bound)),
    );
  });
  return { server, port: boundPort };
}

async function closeGrpcServer(server: grpc.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.tryShutdown((error) => (error ? reject(error) : resolve()));
  });
}

describe('serveGrpcWeb', () => {
  it('dispatches unary and streaming procedures directly', async () => {
    const appRouter = t.router({
      echo: t.procedure
        .input(z.object({ value: z.string(), suffix: z.string() }))
        .output(z.object({ message: z.string(), length: z.int() }))
        .query(({ input }) => ({
          message: `${input.value}${input.suffix}`,
          length: input.value.length + input.suffix.length,
        })),
      count: t.procedure
        .input(z.object({ end: z.int() }))
        .output(
          zAsyncIterable({
            yield: z.object({ value: z.int(), squared: z.int() }),
          }),
        )
        .subscription(async function* ({ input }) {
          for (let value = 1; value <= input.end; value += 1) {
            yield { value, squared: value * value };
          }
        }),
    });
    type AppRouter = typeof appRouter;
    const schema = schemaFromRouter(appRouter);
    const server = await serveGrpcWeb({
      mode: 'direct',
      router: appRouter,
      schema,
      address: '127.0.0.1:0',
    });

    try {
      for (const encoding of ['raw', 'base64'] as const) {
        for (const compress of [false, true]) {
          const client = createTRPCClient<AppRouter>({
            links: [
              grpcWebLink<AppRouter>({
                schema,
                url: `http://${server.address}`,
                encoding,
                compress,
              }),
            ],
          });
          assert.deepEqual(
            await client.echo.query({ value: 'hello', suffix: '!' }),
            { message: 'hello!', length: 6 },
          );
        }
      }

      const client = createTRPCClient<AppRouter>({
        links: [
          grpcWebLink<AppRouter>({
            schema,
            url: `http://${server.address}`,
            encoding: 'base64',
          }),
        ],
      });
      const values: number[] = [];
      const completed = Promise.withResolvers<void>();
      client.count.subscribe(
        { end: 3 },
        {
          onData(value) {
            values.push(value.value);
          },
          onError: completed.reject,
          onComplete: completed.resolve,
        },
      );
      await completed.promise;
      assert.deepEqual(values, [1, 2, 3]);
    } finally {
      await server.close();
    }

    await assert.rejects(fetch(`http://${server.address}`));
  });

  it('forwards to a separately hosted native gRPC server', async () => {
    const appRouter = t.router({
      hello: t.procedure
        .input(z.object({ name: z.string() }))
        .output(z.object({ message: z.string() }))
        .query(({ input }) => ({ message: `hello ${input.name}` })),
    });
    type AppRouter = typeof appRouter;
    const schema = schemaFromRouter(appRouter);
    const backend = await serveGrpc(appRouter, {
      schema,
      address: '127.0.0.1:0',
    });
    const server = await serveGrpcWeb({
      mode: 'forward',
      schema,
      backend: { address: backend.address },
      address: '127.0.0.1:0',
    });

    try {
      const client = createTRPCClient<AppRouter>({
        links: [
          grpcWebLink<AppRouter>({
            schema,
            url: `http://${server.address}`,
            encoding: 'raw',
          }),
        ],
      });
      assert.deepEqual(await client.hello.query({ name: 'Ada' }), {
        message: 'hello Ada',
      });
    } finally {
      await server.close();
      await backend.close();
    }
  });

  for (const tlsCase of tlsCases) {
    it(`forwards over ${tlsCase.name}`, async () => {
      const appRouter = t.router({
        hello: t.procedure
          .input(z.object({ name: z.string() }))
          .output(z.object({ message: z.string() }))
          .query(({ input }) => ({ message: `secure hello ${input.name}` })),
      });
      type AppRouter = typeof appRouter;
      const schema = schemaFromRouter(appRouter);
      const backend = await serveGrpc(appRouter, {
        schema,
        address: '127.0.0.1:0',
        credentials: grpc.ServerCredentials.createSsl(
          readFileSync(caCertPath),
          [
            {
              cert_chain: readFileSync(testCertificatePath('server-cert.pem')),
              private_key: readFileSync(testCertificatePath('server-key.pem')),
            },
          ],
          tlsCase.checkClientCertificate,
        ),
      });
      let server: Awaited<ReturnType<typeof serveGrpcWeb>> | undefined;

      try {
        const credentials: MtlsConfig = {
          type: 'mtls',
          caCertPath,
          serverNameOverride: 'grpc.test',
          ...(tlsCase.clientIdentity
            ? { clientIdentity: tlsCase.clientIdentity }
            : {}),
        };
        server = await serveGrpcWeb({
          mode: 'forward',
          schema,
          backend: { address: backend.address, credentials },
          address: '127.0.0.1:0',
        });
        const client = createTRPCClient<AppRouter>({
          links: [
            grpcWebLink<AppRouter>({
              schema,
              url: `http://${server.address}`,
              encoding: 'raw',
            }),
          ],
        });

        assert.deepEqual(await client.hello.query({ name: 'Ada' }), {
          message: 'secure hello Ada',
        });
      } finally {
        await server?.close();
        await backend.close();
      }
    });
  }

  it('reloads rotated client certificate files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'trpc-proto-mtls-'));
    const watchedCaPath = join(directory, 'ca-cert.pem');
    const watchedCertPath = join(directory, 'client-cert.pem');
    const watchedKeyPath = join(directory, 'client-key.pem');
    await Promise.all([
      copyFile(caCertPath, watchedCaPath),
      copyFile(clientIdentity.certPath, watchedCertPath),
      copyFile(clientIdentity.keyPath, watchedKeyPath),
    ]);
    let backend: Awaited<ReturnType<typeof startIdentityBackend>> | undefined;
    let server: Awaited<ReturnType<typeof serveGrpcWeb>> | undefined;

    try {
      backend = await startIdentityBackend(0);
      const backendPort = backend.port;
      server = await serveGrpcWeb({
        mode: 'forward',
        schema: identitySchema,
        backend: {
          address: `127.0.0.1:${backendPort}`,
          credentials: {
            type: 'mtls',
            caCertPath: watchedCaPath,
            serverNameOverride: 'grpc.test',
            clientIdentity: {
              certPath: watchedCertPath,
              keyPath: watchedKeyPath,
            },
          },
        },
        address: '127.0.0.1:0',
      });
      const call = createGrpcWebFetchCall({
        baseUrl: `http://${server.address}`,
        encoding: 'raw',
      });
      const whoAmI = async () =>
        Buffer.from(
          (await call({
            path: 'whoAmI',
            type: 'query',
            bytes: new Uint8Array(),
            grpcPath: '/rotation.v1.IdentityService/WhoAmI',
          })) as Uint8Array,
        ).toString();

      assert.equal(await whoAmI(), 'trpc-proto-test-client-a');
      await closeGrpcServer(backend.server);
      backend = undefined;
      await Promise.all([
        copyFile(
          testCertificatePath('client-rotated-cert.pem'),
          watchedCertPath,
        ),
        copyFile(testCertificatePath('client-rotated-key.pem'), watchedKeyPath),
      ]);
      await delay(1_200);
      backend = await startIdentityBackend(backendPort);

      assert.equal(await whoAmI(), 'trpc-proto-test-client-b');
    } finally {
      await server?.close();
      if (backend) await closeGrpcServer(backend.server);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns UNIMPLEMENTED for an unknown direct gRPC path', async () => {
    const appRouter = t.router({
      ping: t.procedure
        .output(z.object({ ok: z.boolean() }))
        .query(() => ({ ok: true })),
    });
    const server = await serveGrpcWeb({
      mode: 'direct',
      router: appRouter,
      schema: schemaFromRouter(appRouter),
      address: '127.0.0.1:0',
    });

    try {
      const call = createGrpcWebFetchCall({
        baseUrl: `http://${server.address}`,
        encoding: 'raw',
      });
      await assert.rejects(
        call({
          path: 'missing',
          type: 'query',
          input: undefined,
          bytes: new Uint8Array(),
          grpcPath: '/direct.v1.AppService/Missing',
        }),
        (error: unknown) =>
          error instanceof GrpcWebError &&
          error.code === 12 &&
          error.message === 'no gRPC mapping for /direct.v1.AppService/Missing',
      );
    } finally {
      await server.close();
    }
  });

  it('propagates browser cancellation to the router procedure', async () => {
    const cancelled = Promise.withResolvers<void>();
    const appRouter = t.router({
      watch: t.procedure
        .input(z.object({}))
        .output(zAsyncIterable({ yield: z.object({ value: z.int() }) }))
        .subscription(async function* ({ signal }) {
          yield { value: 1 };
          await new Promise<void>((resolve) => {
            signal?.addEventListener(
              'abort',
              () => {
                cancelled.resolve();
                resolve();
              },
              { once: true },
            );
          });
        }),
    });
    const schema = schemaFromRouter(appRouter);
    const server = await serveGrpcWeb({
      mode: 'direct',
      router: appRouter,
      schema,
      address: '127.0.0.1:0',
    });

    try {
      const controller = new AbortController();
      const call = createGrpcWebFetchCall({
        baseUrl: `http://${server.address}`,
        encoding: 'raw',
      });
      const response = await call({
        path: 'watch',
        type: 'subscription',
        input: {},
        bytes: new Uint8Array(),
        grpcPath: '/direct.v1.AppService/Watch',
        signal: controller.signal,
      });
      if (
        response === null ||
        typeof response !== 'object' ||
        !(Symbol.asyncIterator in response)
      ) {
        assert.fail('expected streaming response');
      }
      const iterator = response[Symbol.asyncIterator]();
      assert.deepEqual(await iterator.next(), {
        done: false,
        value: new Uint8Array([8, 1]),
      });
      controller.abort();
      await Promise.race([
        cancelled.promise,
        delay(1_000).then(() =>
          assert.fail('router procedure was not cancelled'),
        ),
      ]);
    } finally {
      await server.close();
    }
  });
});
