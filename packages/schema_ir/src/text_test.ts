import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  ProcedureType,
  ProtoEnum,
  ProtoField,
  ProtoFileOptions,
  ProtoMessage,
  ProtoMethod,
  ProtoSchema,
  ProtoService,
  ProtoType,
} from './types.js';
import { fromString, toString } from './text.js';

function field(
  name: string,
  number: number,
  type: ProtoType,
  opts: { repeated?: boolean; optional?: boolean; comment?: string } = {},
): ProtoField {
  return {
    name,
    number,
    type,
    repeated: opts.repeated ?? false,
    optional: opts.optional ?? true,
    comment: opts.comment ?? '',
  };
}

function stringField(
  name: string,
  number: number,
  opts?: { repeated?: boolean; optional?: boolean; comment?: string },
): ProtoField {
  return field(name, number, { kind: 'scalar', type: 'string' }, opts);
}

function message(
  name: string,
  fields: ProtoField[],
  subMessages: ProtoMessage[] = [],
  comment = '',
): ProtoMessage {
  return { name, fields, subMessages, comment };
}

function en(
  name: string,
  values: { name: string; number: number }[],
  comment = '',
): ProtoEnum {
  return { name, values, comment };
}

function method(
  name: string,
  path: string,
  requestType: string,
  responseType: string,
  type: ProcedureType = 'query',
): ProtoMethod {
  return {
    name,
    path,
    type,
    requestType,
    responseType,
    isResponseStreaming: type === 'subscription',
  };
}

function service(name: string, methods: ProtoMethod[]): ProtoService {
  return { name, methods };
}

function schema(opts: Partial<ProtoSchema> = {}): ProtoSchema {
  return {
    syntax: 'proto3',
    package: 'trpc',
    services: [],
    messages: [],
    enums: [],
    ...opts,
  };
}
function view(value: ProtoSchema): Omit<ProtoSchema, 'generateCache'> {
  const { generateCache: _, options, ...rest } = value;
  return options === undefined ? rest : { ...rest, options };
}
interface TextCase {
  name: string;
  schema: ProtoSchema;
  proto: string;
}

const cases: TextCase[] = [
  {
    name: 'empty schema',
    schema: schema(),
    proto: 'syntax = "proto3";\n\npackage trpc;\n',
  },
  {
    name: 'package',
    schema: schema({ package: 'example.v1' }),
    proto: 'syntax = "proto3";\n\npackage example.v1;\n',
  },
  {
    name: 'file language options',
    schema: schema({
      package: 'example.v1',
      options: {
        go_package: 'example/backend/gen/examplev1',
        java_multiple_files: true,
        optimize_for: 'SPEED',
      } satisfies ProtoFileOptions,
    }),
    proto: `syntax = "proto3";

package example.v1;

option go_package = "example/backend/gen/examplev1";
option java_multiple_files = true;
option optimize_for = SPEED;
`,
  },
  {
    name: 'reserved dropped cache field numbers',
    schema: schema({
      messages: [message('User', [stringField('id', 1)])],
      generateCache: {
        propertyGenCache: {
          User: {
            propertyGenCache: {
              id: {
                tag: 1,
                type: 'string',
                propertyGenCache: {},
                usedIds: {},
              },
              email: {
                tag: 2,
                type: 'string',
                propertyGenCache: {},
                usedIds: {},
              },
              age: {
                tag: 4,
                type: 'int32',
                propertyGenCache: {},
                usedIds: {},
              },
            },
            usedIds: { 1: 'id', 2: 'email', 4: 'age' },
          },
        },
      },
    }),
    proto: `syntax = "proto3";

package trpc;

message User {
  optional string id = 1;
  reserved 2, 4;
}
`,
  },
  {
    name: 'message fields comments nested map repeated',
    schema: schema({
      messages: [
        message(
          'User',
          [
            stringField('id', 1, { comment: 'unique id' }),
            stringField('tags', 2, { repeated: true }),
            field(
              'labels',
              3,
              {
                kind: 'map',
                key: 'string',
                value: { kind: 'scalar', type: 'int32' },
              },
              { optional: false },
            ),
            field('address', 4, { kind: 'message', name: 'Address' }),
          ],
          [message('Address', [stringField('city', 1)])],
          'A user',
        ),
      ],
    }),
    proto: `syntax = "proto3";

package trpc;

// A user
message User {
  message Address {
    optional string city = 1;
  }

  // unique id
  optional string id = 1;
  repeated string tags = 2;
  map<string, int32> labels = 3;
  optional Address address = 4;
}
`,
  },
  {
    name: 'enum values and comment',
    schema: schema({
      enums: [
        en(
          'UserRole',
          [
            { name: 'ADMIN', number: 0 },
            { name: 'MEMBER', number: 1 },
          ],
          'account role',
        ),
      ],
    }),
    proto: `syntax = "proto3";

package trpc;

// account role
enum UserRole {
  USER_ROLE_ADMIN = 0;
  USER_ROLE_MEMBER = 1;
}
`,
  },
  {
    name: 'service tRPC comments',
    schema: schema({
      messages: [message('HelloRequest', [stringField('name', 1)])],
      services: [
        service('AppService', [
          method('Hello', 'hello', 'HelloRequest', 'HelloRequest'),
        ]),
      ],
    }),
    proto: `syntax = "proto3";

package trpc;

message HelloRequest {
  optional string name = 1;
}

service AppService {
  // tRPC query hello
  rpc Hello (HelloRequest) returns (HelloRequest);
}
`,
  },
  {
    name: 'subscription server-streaming rpc',
    schema: schema({
      messages: [
        message('Note', [stringField('id', 1), stringField('body', 2)]),
      ],
      services: [
        service('NoteService', [
          method(
            'OnChange',
            'note.onChange',
            'google.protobuf.Empty',
            'Note',
            'subscription',
          ),
        ]),
      ],
    }),
    proto: `syntax = "proto3";

package trpc;

import "google/protobuf/empty.proto";

message Note {
  optional string id = 1;
  optional string body = 2;
}

service NoteService {
  // tRPC subscription note.onChange
  rpc OnChange (google.protobuf.Empty) returns (stream Note);
}
`,
  },
  {
    name: 'google.protobuf.Empty import',
    schema: schema({
      services: [
        service('AppService', [
          method(
            'Ping',
            'ping',
            'google.protobuf.Empty',
            'google.protobuf.Empty',
          ),
        ]),
      ],
    }),
    proto: `syntax = "proto3";

package trpc;

import "google/protobuf/empty.proto";

service AppService {
  // tRPC query ping
  rpc Ping (google.protobuf.Empty) returns (google.protobuf.Empty);
}
`,
  },
  {
    name: 'google.protobuf.Timestamp import',
    schema: schema({
      messages: [
        message('Event', [
          field('when', 1, {
            kind: 'message',
            name: 'google.protobuf.Timestamp',
          }),
        ]),
      ],
    }),
    proto: `syntax = "proto3";

package trpc;

import "google/protobuf/timestamp.proto";

message Event {
  optional google.protobuf.Timestamp when = 1;
}
`,
  },
  {
    name: 'google.protobuf.Value and Struct imports',
    schema: schema({
      messages: [
        message('Payload', [
          field('extra', 1, {
            kind: 'message',
            name: 'google.protobuf.Value',
          }),
          field('attrs', 2, {
            kind: 'message',
            name: 'google.protobuf.Struct',
          }),
        ]),
      ],
    }),
    proto: `syntax = "proto3";

package trpc;

import "google/protobuf/struct.proto";

message Payload {
  optional google.protobuf.Value extra = 1;
  optional google.protobuf.Struct attrs = 2;
}
`,
  },
  {
    name: 'google.protobuf.Duration and Any imports',
    schema: schema({
      messages: [
        message('Job', [
          field('wait', 1, {
            kind: 'message',
            name: 'google.protobuf.Duration',
          }),
          field('packed', 2, {
            kind: 'message',
            name: 'google.protobuf.Any',
          }),
        ]),
      ],
    }),
    proto: `syntax = "proto3";

package trpc;

import "google/protobuf/any.proto";
import "google/protobuf/duration.proto";

message Job {
  optional google.protobuf.Duration wait = 1;
  optional google.protobuf.Any packed = 2;
}
`,
  },
  {
    name: 'google.protobuf.FieldMask and wrappers',
    schema: schema({
      messages: [
        message('Patch', [
          field('mask', 1, {
            kind: 'message',
            name: 'google.protobuf.FieldMask',
          }),
          field('name', 2, {
            kind: 'message',
            name: 'google.protobuf.StringValue',
          }),
        ]),
      ],
    }),
    proto: `syntax = "proto3";

package trpc;

import "google/protobuf/field_mask.proto";
import "google/protobuf/wrappers.proto";

message Patch {
  optional google.protobuf.FieldMask mask = 1;
  optional google.protobuf.StringValue name = 2;
}
`,
  },
  {
    name: 'mutation rpc path',
    schema: schema({
      services: [
        service('UserService', [
          method(
            'Create',
            'user.create',
            'google.protobuf.Empty',
            'google.protobuf.Empty',
            'mutation',
          ),
        ]),
      ],
    }),
    proto: `syntax = "proto3";

package trpc;

import "google/protobuf/empty.proto";

service UserService {
  // tRPC mutation user.create
  rpc Create (google.protobuf.Empty) returns (google.protobuf.Empty);
}
`,
  },
];

describe('toString', () => {
  for (const row of cases) {
    it(row.name, () => {
      assert.equal(toString(row.schema), row.proto);
    });
  }
});

describe('fromString', () => {
  for (const row of cases) {
    it(row.name, () => {
      assert.deepEqual(view(fromString(row.proto)), view(row.schema));
    });
  }
});
