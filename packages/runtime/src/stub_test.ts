import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createNoopStub } from './bind.js';
import type { ProtoSchema } from '@trpc-proto/schema_ir';

const schema: ProtoSchema = {
  syntax: 'proto3',
  package: 'demo.v1',
  enums: [],
  messages: [
    {
      name: 'HelloRequest',
      fields: [
        {
          name: 'name',
          number: 1,
          type: { kind: 'scalar', type: 'string' },
          repeated: false,
          optional: true,
        },
      ],
    },
    {
      name: 'HelloResponse',
      fields: [
        {
          name: 'message',
          number: 1,
          type: { kind: 'scalar', type: 'string' },
          repeated: false,
          optional: true,
        },
      ],
    },
  ],
  services: [
    {
      name: 'Greeter',
      methods: [
        {
          name: 'Hello',
          path: 'greet.hello',
          type: 'query',
          requestType: 'HelloRequest',
          responseType: 'HelloResponse',
        },
      ],
    },
  ],
};

describe('createNoopStub', () => {
  it('returns protobuf defaults without tRPC', async () => {
    const stub = createNoopStub(schema);
    const out = await stub.Greeter.Hello({ name: 'Ada' });
    assert.deepEqual(out, {});
  });
});
