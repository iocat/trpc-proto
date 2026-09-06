import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCodec } from './codec.js';
import type { ProtoSchema } from '@trpc-proto/schema_ir';

const schema: ProtoSchema = {
  syntax: 'proto3',
  package: 'trpc',
  enums: [
    {
      name: 'Role',
      values: [
        { name: 'admin', number: 0 },
        { name: 'member', number: 1 },
      ],
    },
  ],
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
      name: 'EchoRequest',
      fields: [
        {
          name: 'value',
          number: 1,
          type: { kind: 'scalar', type: 'string' },
          repeated: false,
          optional: true,
        },
      ],
    },
    {
      name: 'User',
      fields: [
        {
          name: 'id',
          number: 1,
          type: { kind: 'scalar', type: 'string' },
          repeated: false,
          optional: true,
        },
        {
          name: 'role',
          number: 2,
          type: { kind: 'enum', name: 'Role' },
          repeated: false,
          optional: true,
        },
        {
          name: 'tags',
          number: 3,
          type: { kind: 'scalar', type: 'string' },
          repeated: true,
          optional: true,
        },
        {
          name: 'created_at',
          number: 4,
          type: { kind: 'message', name: 'google.protobuf.Timestamp' },
          repeated: false,
          optional: true,
        },
        {
          name: 'balance',
          number: 5,
          type: { kind: 'scalar', type: 'int64' },
          repeated: false,
          optional: true,
        },
        {
          name: 'labels',
          number: 6,
          type: {
            kind: 'map',
            key: 'string',
            value: { kind: 'scalar', type: 'int32' },
          },
          repeated: false,
          optional: false,
        },
      ],
    },
  ],
  services: [],
};

describe('createCodec', () => {
  const codec = createCodec(schema);

  it('roundtrips an object message', () => {
    const encoded = codec.encode('HelloRequest', { name: 'Ada' });
    assert.deepEqual(codec.decode('HelloRequest', encoded), { name: 'Ada' });
  });

  it('wraps and unwraps a scalar value message', () => {
    const encoded = codec.encode('EchoRequest', 'analytical engine');
    assert.equal(codec.decode('EchoRequest', encoded), 'analytical engine');
  });

  it('encodes empty as zero bytes', () => {
    const encoded = codec.encode('google.protobuf.Empty', undefined);
    assert.equal(encoded.byteLength, 0);
    assert.deepEqual(codec.decode('google.protobuf.Empty', encoded), {});
  });

  it('roundtrips enum, repeated, timestamp, int64, map, camelCase', () => {
    const createdAt = new Date('1815-12-10T00:00:00.000Z');
    const user = {
      id: 'user_ada',
      role: 'admin',
      tags: ['founder', 'math'],
      createdAt,
      balance: 1000n,
      labels: { core: 3 },
    };
    const decoded = codec.decode('User', codec.encode('User', user)) as typeof user;
    assert.equal(decoded.id, 'user_ada');
    assert.equal(decoded.role, 'admin');
    assert.deepEqual(decoded.tags, ['founder', 'math']);
    assert.equal(decoded.createdAt.toISOString(), createdAt.toISOString());
    assert.equal(decoded.balance, 1000n);
    assert.deepEqual(decoded.labels, { core: 3 });
  });

  it('roundtrips an inline nested message', () => {
    const nested: ProtoSchema = {
      syntax: 'proto3',
      package: 'trpc',
      enums: [],
      messages: [
        {
          name: 'UserUpdateRequest',
          fields: [
            {
              name: 'address',
              number: 1,
              type: { kind: 'message', name: 'Address' },
              repeated: false,
              optional: true,
            },
          ],
          subMessages: [
            {
              name: 'Address',
              fields: [
                {
                  name: 'city',
                  number: 1,
                  type: { kind: 'scalar', type: 'string' },
                  repeated: false,
                  optional: true,
                },
              ],
            },
          ],
        },
      ],
    };
    const codecNested = createCodec(nested);
    const payload = { address: { city: 'London' } };
    assert.deepEqual(
      codecNested.decode(
        'UserUpdateRequest',
        codecNested.encode('UserUpdateRequest', payload),
      ),
      payload,
    );
  });
});
