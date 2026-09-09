import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z, type ZodType } from 'zod';
import { fromString, toString } from '../ir/text.js';
import {
  translate,
  type RuntimeProcedure,
  type TranslateOptions,
} from './trpc_schema.js';
import { zAsyncIterable } from '../zod/async_iterable.js';
import type {
  ProcedureType,
  PropertyGenCache,
  SchemaGenerateCache,
} from '../ir/types.js';

function proc(
  path: string,
  opts: {
    type?: ProcedureType;
    input?: ZodType;
    output?: ZodType;
  } = {},
): RuntimeProcedure {
  return {
    path,
    type: opts.type ?? 'query',
    input: opts.input,
    output: opts.output,
  };
}

function fieldCache(tag: number, type: string): PropertyGenCache {
  return { tag, type, propertyGenCache: {}, usedIds: {} };
}

function msgCache(
  fields: Record<string, { tag: number; type: string }>,
): PropertyGenCache {
  const usedIds: Record<number, string> = {};
  const propertyGenCache: Record<string, PropertyGenCache> = {};
  for (const [name, item] of Object.entries(fields)) {
    usedIds[item.tag] = name;
    propertyGenCache[name] = fieldCache(item.tag, item.type);
  }
  return { propertyGenCache, usedIds };
}

function genCache(
  messages: Record<string, PropertyGenCache> = {},
): SchemaGenerateCache {
  return { propertyGenCache: messages };
}

function proto(text: string): string {
  return toString(fromString(text));
}

const User = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .meta({ protoMessageName: 'User' });

const Address = z
  .object({ city: z.string() })
  .meta({ protoMessageName: 'Address' });

interface TranslateCase {
  name: string;
  procedures: RuntimeProcedure[];
  options?: TranslateOptions;
  expected: string;
}

const cases: TranslateCase[] = [
  {
    name: 'empty procedure list',
    procedures: [],
    expected: '',
  },
  {
    name: 'root query with object input and output',
    procedures: [
      proc('hello', {
        input: z.object({ name: z.string() }),
        output: z.object({ message: z.string() }),
      }),
    ],
    expected: `
      message AppHelloRequest {
        optional string name = 1;
      }
      message AppHelloResponse {
        optional string message = 1;
      }
      service AppService {
        // tRPC query hello
        rpc Hello (AppHelloRequest) returns (AppHelloResponse);
      }
    `,
  },
  {
    name: 'nested router path becomes a service',
    procedures: [
      proc('user.getById', {
        input: z.object({ id: z.string() }),
        output: z.object({ id: z.string(), name: z.string() }),
      }),
    ],
    expected: `
      message UserGetByIdRequest {
        optional string id = 1;
      }
      message UserGetByIdResponse {
        optional string id = 1;
        optional string name = 2;
      }
      service UserService {
        // tRPC query user.getById
        rpc GetById (UserGetByIdRequest) returns (UserGetByIdResponse);
      }
    `,
  },
  {
    name: 'void input uses google.protobuf.Empty',
    procedures: [proc('health', { output: z.object({ ok: z.string() }) })],
    expected: `
      message AppHealthResponse {
        optional string ok = 1;
      }
      service AppService {
        // tRPC query health
        rpc Health (google.protobuf.Empty) returns (AppHealthResponse);
      }
    `,
  },
  {
    name: 'scalar input wraps a value field',
    procedures: [
      proc('echo', {
        input: z.string(),
        output: z.string(),
      }),
    ],
    expected: `
      message AppEchoRequest {
        optional string value = 1;
      }
      message AppEchoResponse {
        optional string value = 1;
      }
      service AppService {
        // tRPC query echo
        rpc Echo (AppEchoRequest) returns (AppEchoResponse);
      }
    `,
  },
  {
    name: 'optional object field',
    procedures: [
      proc('search', {
        input: z.object({ q: z.string().optional() }),
        output: z.object({ q: z.string() }),
      }),
    ],
    expected: `
      message AppSearchRequest {
        optional string q = 1;
      }
      message AppSearchResponse {
        optional string q = 1;
      }
      service AppService {
        // tRPC query search
        rpc Search (AppSearchRequest) returns (AppSearchResponse);
      }
    `,
  },
  {
    name: 'shared Zod identity with protoMessageName is one message',

    procedures: [
      proc('user.getById', {
        input: z.object({ id: z.string() }),
        output: User,
      }),
      proc('user.create', {
        type: 'mutation',
        input: User,
        output: User,
      }),
    ],
    expected: `
      message UserGetByIdRequest {
        optional string id = 1;
      }
      message User {
        optional string id = 1;
        optional string name = 2;
      }
      service UserService {
        // tRPC query user.getById
        rpc GetById (UserGetByIdRequest) returns (User);
        // tRPC mutation user.create
        rpc Create (User) returns (User);
      }
    `,
  },
  {
    name: 'nested object field references a message',
    procedures: [
      proc('user.update', {
        type: 'mutation',
        input: z.object({ address: Address }),
        output: Address,
      }),
    ],
    expected: `
      message Address {
        optional string city = 1;
      }
      message UserUpdateRequest {
        optional Address address = 1;
      }
      service UserService {
        // tRPC mutation user.update
        rpc Update (UserUpdateRequest) returns (Address);
      }
    `,
  },
  {
    name: 'inline nested object becomes a proto nested message',
    procedures: [
      proc('user.update', {
        type: 'mutation',
        input: z.object({
          address: z.object({ city: z.string() }),
        }),
      }),
    ],
    expected: `
      message UserUpdateRequest {
        message Address {
          optional string city = 1;
        }
        optional Address address = 1;
      }
      service UserService {
        // tRPC mutation user.update
        rpc Update (UserUpdateRequest) returns (google.protobuf.Empty);
      }
    `,
  },
  {
    name: 'propertyGenCache reuses seeded field numbers',
    procedures: [
      proc('hello', {
        input: z.object({ name: z.string() }),
        output: z.object({ message: z.string() }),
      }),
    ],
    options: {
      generateCache: genCache({
        AppHelloRequest: msgCache({ name: { tag: 7, type: 'string' } }),
        AppHelloResponse: msgCache({ message: { tag: 9, type: 'string' } }),
      }),
    },
    expected: `
      message AppHelloRequest {
        optional string name = 7;
      }
      message AppHelloResponse {
        optional string message = 9;
      }
      service AppService {
        // tRPC query hello
        rpc Hello (AppHelloRequest) returns (AppHelloResponse);
      }
    `,
  },
  {
    name: 'propertyGenCache assigns next number for a new field',
    procedures: [
      proc('hello', {
        input: z.object({ name: z.string(), title: z.string() }),
        output: z.object({ message: z.string() }),
      }),
    ],
    options: {
      generateCache: genCache({
        AppHelloRequest: msgCache({ name: { tag: 1, type: 'string' } }),
      }),
    },
    expected: `
      message AppHelloRequest {
        optional string name = 1;
        optional string title = 2;
      }
      message AppHelloResponse {
        optional string message = 1;
      }
      service AppService {
        // tRPC query hello
        rpc Hello (AppHelloRequest) returns (AppHelloResponse);
      }
    `,
  },
  {
    name: 'bool int double bigint date array enum email',
    procedures: [
      proc('mix', {
        input: z.object({
          ok: z.boolean(),
          count: z.int(),
          ratio: z.number(),
          big: z.bigint(),
          when: z.date(),
          tags: z.array(z.string()),
          kind: z.enum(['A', 'B']),
          email: z.email(),
        }),
      }),
    ],
    expected: `
      enum AppMixRequestKind {
        APP_MIX_REQUEST_KIND_A = 0;
        APP_MIX_REQUEST_KIND_B = 1;
      }
      message AppMixRequest {
        optional bool ok = 1;
        optional int32 count = 2;
        optional double ratio = 3;
        optional int64 big = 4;
        optional google.protobuf.Timestamp when = 5;
        repeated string tags = 6;
        optional AppMixRequestKind kind = 7;
        optional string email = 8;
      }
      service AppService {
        // tRPC query mix
        rpc Mix (AppMixRequest) returns (google.protobuf.Empty);
      }
    `,
  },
  {
    name: 'string bool int float literals',
    procedures: [
      proc('lit', {
        input: z.object({
          word: z.literal(['on', 'off']),
          ok: z.literal(true),
          count: z.literal([1, 2]),
          ratio: z.literal([1.5, 2.5]),
        }),
      }),
    ],
    expected: `
      message AppLitRequest {
        optional string word = 1;
        optional bool ok = 2;
        optional int32 count = 3;
        optional double ratio = 4;
      }
      service AppService {
        // tRPC query lit
        rpc Lit (AppLitRequest) returns (google.protobuf.Empty);
      }
    `,
  },
  {
    name: 'int32 uint32 float32 formats',
    procedures: [
      proc('nums', {
        input: z.object({
          i32: z.int32(),
          u32: z.uint32(),
          f32: z.float32(),
        }),
      }),
    ],
    expected: `
      message AppNumsRequest {
        optional int32 i32 = 1;
        optional int32 u32 = 2;
        optional double f32 = 3;
      }
      service AppService {
        // tRPC query nums
        rpc Nums (AppNumsRequest) returns (google.protobuf.Empty);
      }
    `,
  },
  {
    name: 'record becomes a proto map',
    procedures: [
      proc('stats', {
        input: z.object({
          labels: z.record(z.string(), z.int()),
        }),
      }),
    ],
    expected: `
      message AppStatsRequest {
        map<string, int32> labels = 1;
      }
      service AppService {
        // tRPC query stats
        rpc Stats (AppStatsRequest) returns (google.protobuf.Empty);
      }
    `,
  },
  {
    name: 'nullable string unwraps to string',
    procedures: [
      proc('note', {
        input: z.object({ text: z.string().nullable() }),
      }),
    ],
    expected: `
      message AppNoteRequest {
        optional string text = 1;
      }
      service AppService {
        // tRPC query note
        rpc Note (AppNoteRequest) returns (google.protobuf.Empty);
      }
    `,
  },
  {
    name: 'union of string literals becomes an enum',
    procedures: [
      proc('mode', {
        input: z.object({
          mode: z.union([z.literal('on'), z.literal('off')]),
        }),
      }),
    ],
    expected: `
      enum AppModeRequestMode {
        APP_MODE_REQUEST_MODE_ON = 0;
        APP_MODE_REQUEST_MODE_OFF = 1;
      }
      message AppModeRequest {
        optional AppModeRequestMode mode = 1;
      }
      service AppService {
        // tRPC query mode
        rpc Mode (AppModeRequest) returns (google.protobuf.Empty);
      }
    `,
  },
  {
    name: 'repeated inline object is a nested message',
    procedures: [
      proc('pack', {
        input: z.object({
          items: z.array(z.object({ id: z.string() })),
        }),
      }),
    ],
    expected: `
      message AppPackRequest {
        message Items {
          optional string id = 1;
        }
        repeated Items items = 1;
      }
      service AppService {
        // tRPC query pack
        rpc Pack (AppPackRequest) returns (google.protobuf.Empty);
      }
    `,
  },
  {
    name: 'file header from proto meta',
    procedures: [proc('health', { output: z.object({ ok: z.boolean() }) })],
    options: {
      proto: {
        package: 'example.v1',
        syntax: 'proto3',
        options: {
          go_package: 'example/backend/gen/examplev1',
          java_multiple_files: true,
        },
      },
    },
    expected: `
      package example.v1;
      option go_package = "example/backend/gen/examplev1";
      option java_multiple_files = true;
      message AppHealthResponse {
        optional bool ok = 1;
      }
      service AppService {
        // tRPC query health
        rpc Health (google.protobuf.Empty) returns (AppHealthResponse);
      }
    `,
  },
  {
    name: 'discriminatedUnion becomes a proto oneof',
    procedures: [
      proc('track', {
        input: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('click'), x: z.number() }),
          z.object({ kind: z.literal('key'), key: z.string() }),
        ]),
        output: z.object({ ok: z.boolean() }),
      }),
    ],
    expected: `
      message AppTrackRequest {
        message Click {
          optional double x = 1;
        }
        message Key {
          optional string key = 1;
        }
        oneof kind {
          Click click = 1;
          Key key = 2;
        }
      }
      message AppTrackResponse {
        optional bool ok = 1;
      }
      service AppService {
        // tRPC query track
        rpc Track (AppTrackRequest) returns (AppTrackResponse);
      }
    `,
  },
  {
    name: 'subscription is a server-streaming rpc',
    procedures: [
      proc('note.onChange', {
        type: 'subscription',
        output: zAsyncIterable({
          yield: z.object({ id: z.string(), body: z.string() }),
        }),
      }),
    ],
    expected: `
      message NoteOnChangeResponse {
        optional string id = 1;
        optional string body = 2;
      }
      service NoteService {
        // tRPC subscription note.onChange
        rpc OnChange (google.protobuf.Empty) returns (stream NoteOnChangeResponse);
      }
    `,
  },
];

describe('translate', () => {
  for (const row of cases) {
    it(row.name, () => {
      const got = translate(row.procedures, row.options);
      assert.equal(toString(got), proto(row.expected));
    });
  }

  it('reserves dropped cache field numbers', () => {
    const got = translate(
      [
        proc('hello', {
          input: z.object({ name: z.string() }),
          output: z.object({ message: z.string() }),
        }),
      ],
      {
        generateCache: genCache({
          AppHelloRequest: msgCache({
            name: { tag: 1, type: 'string' },
            extra: { tag: 2, type: 'string' },
            old: { tag: 4, type: 'string' },
          }),
        }),
      },
    );
    assert.match(toString(got), /reserved 2, 4;/);
  });

  it('throws when literal values mix types', () => {
    assert.throws(
      () =>
        translate([
          proc('mix', {
            input: z.object({
              flag: z.literal(['yes', 1]),
            }),
          }),
        ]),
      /literal values have mixed types/,
    );
  });

  it('throws on object union without discriminator', () => {
    assert.throws(
      () =>
        translate([
          proc('mix', {
            input: z.union([
              z.object({ a: z.string() }),
              z.object({ b: z.number() }),
            ]),
          }),
        ]),
      /Unsupported Zod type "union"/,
    );
  });

  it('throws when literal numbers mix integers and floats', () => {
    assert.throws(
      () =>
        translate([
          proc('mix', {
            input: z.object({
              n: z.literal([1, 1.5]),
            }),
          }),
        ]),
      /literal values mix integers and floats/,
    );
  });

  it('throws when protoMessageName is not PascalCase', () => {
    assert.throws(
      () =>
        translate([
          proc('bad', {
            input: z
              .object({ x: z.string() })
              .meta({ protoMessageName: 'notPascal' }),
          }),
        ]),
      /protoMessageName must be PascalCase/,
    );
  });

  it('throws when protoEnumName is not PascalCase', () => {
    assert.throws(
      () =>
        translate([
          proc('bad', {
            input: z.object({
              role: z.enum(['a']).meta({ protoEnumName: 'notPascal' }),
            }),
          }),
        ]),
      /protoEnumName must be PascalCase/,
    );
  });

  it('encodes protoUseKnownType as a well-known message', () => {
    const Duration = z
      .object({
        seconds: z.bigint(),
        nanos: z.int(),
      })
      .meta({ protoUseKnownType: 'google.protobuf.Duration' });
    const got = translate([
      proc('wait', {
        input: z.object({ delay: Duration }),
        output: z.object({ ok: z.boolean() }),
      }),
    ]);
    assert.match(
      toString(got),
      /optional google\.protobuf\.Duration delay = 1;/,
    );
    assert.match(toString(got), /import "google\/protobuf\/duration.proto"/);
    assert.doesNotMatch(toString(got), /message Duration/);
  });

  it('throws when protoUseKnownType is not well-known', () => {
    assert.throws(
      () =>
        translate([
          proc('bad', {
            input: z
              .object({ x: z.string() })
              .meta({ protoUseKnownType: 'not.a.wkt' }),
          }),
        ]),
      /protoUseKnownType must be a google\.protobuf well-known type/,
    );
  });

  it('forwards zod describe onto proto comments', () => {
    const Role = z
      .enum(['admin', 'member'])
      .describe('account role')
      .meta({ protoEnumName: 'UserRole' });

    const Person = z
      .object({
        id: z.string().describe('unique id'),
        role: Role,
      })
      .describe('A registered user')
      .meta({ protoMessageName: 'User' });

    const got = translate([
      proc('user.getById', {
        input: z.object({ id: z.string().describe('lookup key') }),
        output: Person,
      }),
    ]);
    assert.equal(
      toString(got),
      proto(`
        // account role
        enum UserRole {
          USER_ROLE_ADMIN = 0;
          USER_ROLE_MEMBER = 1;
        }
        message UserGetByIdRequest {
          // lookup key
          optional string id = 1;
        }
        // A registered user
        message User {
          // unique id
          optional string id = 1;
          // account role
          optional UserRole role = 2;
        }
        service UserService {
          // tRPC query user.getById
          rpc GetById (UserGetByIdRequest) returns (User);
        }
      `),
    );
  });
});
