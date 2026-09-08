import type { ProtoSchema } from '@trpc-proto/runtime';

export const protoSchema = {
  "syntax": "proto3",
  "package": "stream.v1",
  "services": [
    {
      "name": "ChatService",
      "methods": [
        {
          "name": "Respond",
          "path": "chat.respond",
          "type": "subscription",
          "requestType": "ChatRespondRequest",
          "responseType": "ChatEvent",
          "isResponseStreaming": true
        }
      ]
    }
  ],
  "messages": [
    {
      "name": "ChatRespondRequest",
      "fields": [
        {
          "name": "prompt",
          "number": 1,
          "type": {
            "kind": "scalar",
            "type": "string"
          },
          "repeated": false,
          "optional": true,
          "comment": ""
        },
        {
          "name": "tokens_per_second",
          "number": 2,
          "type": {
            "kind": "scalar",
            "type": "int32"
          },
          "repeated": false,
          "optional": true,
          "comment": ""
        },
        {
          "name": "max_tokens",
          "number": 3,
          "type": {
            "kind": "scalar",
            "type": "int32"
          },
          "repeated": false,
          "optional": true,
          "comment": ""
        }
      ],
      "subMessages": [],
      "comment": ""
    },
    {
      "name": "ChatEvent",
      "fields": [
        {
          "name": "sequence",
          "number": 1,
          "type": {
            "kind": "scalar",
            "type": "int32"
          },
          "repeated": false,
          "optional": true,
          "comment": ""
        },
        {
          "name": "kind",
          "number": 2,
          "type": {
            "kind": "scalar",
            "type": "string"
          },
          "repeated": false,
          "optional": true,
          "comment": ""
        },
        {
          "name": "content",
          "number": 3,
          "type": {
            "kind": "scalar",
            "type": "string"
          },
          "repeated": false,
          "optional": true,
          "comment": ""
        },
        {
          "name": "sent_at_unix_ms",
          "number": 4,
          "type": {
            "kind": "scalar",
            "type": "double"
          },
          "repeated": false,
          "optional": true,
          "comment": ""
        },
        {
          "name": "progress",
          "number": 5,
          "type": {
            "kind": "scalar",
            "type": "double"
          },
          "repeated": false,
          "optional": true,
          "comment": ""
        }
      ],
      "subMessages": [],
      "comment": ""
    }
  ],
  "enums": [],
  "generateCache": {
    "propertyGenCache": {
      "TelemetryWatchRequest": {
        "propertyGenCache": {
          "rate_per_second": {
            "tag": 1,
            "type": "int32",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "duration_seconds": {
            "tag": 2,
            "type": "int32",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "payload_bytes": {
            "tag": 3,
            "type": "int32",
            "propertyGenCache": {},
            "usedIds": {}
          }
        },
        "usedIds": {
          "1": "rate_per_second",
          "2": "duration_seconds",
          "3": "payload_bytes"
        }
      },
      "TelemetryEvent": {
        "propertyGenCache": {
          "sequence": {
            "tag": 1,
            "type": "int32",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "source": {
            "tag": 2,
            "type": "string",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "reading": {
            "tag": 3,
            "type": "double",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "trend": {
            "tag": 4,
            "type": "double",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "sent_at_unix_ms": {
            "tag": 5,
            "type": "double",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "payload": {
            "tag": 6,
            "type": "string",
            "propertyGenCache": {},
            "usedIds": {}
          }
        },
        "usedIds": {
          "1": "sequence",
          "2": "source",
          "3": "reading",
          "4": "trend",
          "5": "sent_at_unix_ms",
          "6": "payload"
        }
      },
      "ChatRespondRequest": {
        "propertyGenCache": {
          "prompt": {
            "tag": 1,
            "type": "string",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "tokens_per_second": {
            "tag": 2,
            "type": "int32",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "max_tokens": {
            "tag": 3,
            "type": "int32",
            "propertyGenCache": {},
            "usedIds": {}
          }
        },
        "usedIds": {
          "1": "prompt",
          "2": "tokens_per_second",
          "3": "max_tokens"
        }
      },
      "ChatEvent": {
        "propertyGenCache": {
          "sequence": {
            "tag": 1,
            "type": "int32",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "kind": {
            "tag": 2,
            "type": "string",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "content": {
            "tag": 3,
            "type": "string",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "sent_at_unix_ms": {
            "tag": 4,
            "type": "double",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "progress": {
            "tag": 5,
            "type": "double",
            "propertyGenCache": {},
            "usedIds": {}
          }
        },
        "usedIds": {
          "1": "sequence",
          "2": "kind",
          "3": "content",
          "4": "sent_at_unix_ms",
          "5": "progress"
        }
      }
    }
  }
} satisfies ProtoSchema;
