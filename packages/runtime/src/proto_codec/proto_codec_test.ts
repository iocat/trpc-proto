import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProtoCodec } from './proto_codec.js';
import { translate, type ProtoSchema } from '@trpc-proto/schema_ir';
import { z } from 'zod';

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

describe('ProtoCodec', () => {
  const codec = new ProtoCodec(schema);

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

  it('encodes google.protobuf.Duration', () => {
    const encoded = codec.encode('google.protobuf.Duration', {
      seconds: 3,
      nanos: 0,
    });
    const decoded = codec.decode('google.protobuf.Duration', encoded) as {
      seconds: unknown;
      nanos: unknown;
    };
    assert.equal(Number(decoded.seconds), 3);
    assert.equal(Number(decoded.nanos), 0);
  });

  it('decodes omitted protobuf collections as empty collections', () => {
    const decoded = codec.decode(
      'User',
      codec.encode('User', {}),
    ) as Record<string, unknown>;
    assert.deepEqual(decoded.tags, []);
    assert.deepEqual(decoded.labels, {});
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
    const decoded = codec.decode(
      'User',
      codec.encode('User', user),
    ) as typeof user;
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
      services: [],
    };
    const codecNested = new ProtoCodec(nested);
    const payload = { address: { city: 'London' } };
    assert.deepEqual(
      codecNested.decode(
        'UserUpdateRequest',
        codecNested.encode('UserUpdateRequest', payload),
      ),
      payload,
    );
  });

  it('roundtrips discriminatedUnion as oneof', () => {
    const schema = translate([
      {
        path: 'track',
        type: 'query',
        input: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('click'), x: z.number() }),
          z.object({ kind: z.literal('key'), key: z.string() }),
        ]),
        output: z.object({ ok: z.boolean() }),
      },
    ]);
    const codec = new ProtoCodec(schema);
    const click = { kind: 'click', x: 1.5 };
    const encoded = codec.encode('AppTrackRequest', click);
    assert.deepEqual(codec.decode('AppTrackRequest', encoded), click);
    const key = { kind: 'key', key: 'Enter' };
    assert.deepEqual(
      codec.decode('AppTrackRequest', codec.encode('AppTrackRequest', key)),
      key,
    );
  });

  it('resolves derived RPC names through the protobuf root', () => {
    const rpcSchema = translate([
      {
        path: 'health',
        type: 'query',
        input: z.string(),
        output: z.string(),
      },
      {
        path: 'user.getById',
        type: 'query',
        input: z.string(),
        output: z.string(),
      },
    ]);
    const rpcCodec = new ProtoCodec(rpcSchema);

    const rootRpc = rpcCodec.lookupRpc('health');
    assert.equal(rootRpc?.service, 'AppService');
    assert.equal(rootRpc?.method.name, 'Health');

    const nestedRpc = rpcCodec.lookupRpc('user.getById');
    assert.equal(nestedRpc?.service, 'UserService');
    assert.equal(nestedRpc?.method.name, 'GetById');
    assert.equal(
      nestedRpc?.method,
      rpcCodec.lookupMethod('UserService', 'GetById'),
    );
    assert.equal(rpcCodec.lookupRpc('user.missing'), undefined);
  });
});
