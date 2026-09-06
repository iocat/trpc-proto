import { createProtoStub } from '@trpc-proto/runtime';
import { appRouter } from './router.js';

const stub = createProtoStub({ router: appRouter });
const app = stub.App!;
const users = stub.UserService!;
const org = stub.OrgWorkspace!;

const health = await app.Health!({});
const hello = await app.Hello!({ name: 'Ada' });
const echo = await app.Echo!({ value: 'analytical engine' });
const listed = await users.List!({ q: 'Ada', role: 'admin' });
const stats = await org.Stats!({});

process.stdout.write(
  `${JSON.stringify(
    { health, hello, echo, listed, stats },
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  )}\n`,
);
