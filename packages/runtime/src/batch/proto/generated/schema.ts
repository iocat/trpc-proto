import type { ProtoSchema } from '@trpc-proto/runtime';

export const protoSchema = {
  "syntax": "proto3",
  "package": "trpc.batch.v1",
  "services": [
    {
      "name": "BatchService",
      "methods": [
        {
          "name": "Execute",
          "path": "batch.execute",
          "type": "mutation",
          "requestType": "BatchRequest",
          "responseType": "BatchResponse",
          "isResponseStreaming": false
        }
      ]
    }
  ],
  "messages": [
    {
      "name": "BatchCall",
      "fields": [
        {
          "name": "id",
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
          "name": "path",
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
          "name": "input",
          "number": 3,
          "type": {
            "kind": "scalar",
            "type": "bytes"
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
      "name": "BatchRequest",
      "fields": [
        {
          "name": "calls",
          "number": 1,
          "type": {
            "kind": "message",
            "name": "BatchCall"
          },
          "repeated": true,
          "optional": true,
          "comment": ""
        }
      ],
      "subMessages": [],
      "comment": ""
    },
    {
      "name": "BatchResult",
      "fields": [
        {
          "name": "success",
          "number": 1,
          "type": {
            "kind": "message",
            "name": "Success"
          },
          "repeated": false,
          "optional": false,
          "comment": "",
          "oneof": "result",
          "discriminatorValue": "success"
        },
        {
          "name": "error",
          "number": 2,
          "type": {
            "kind": "message",
            "name": "Error"
          },
          "repeated": false,
          "optional": false,
          "comment": "",
          "oneof": "result",
          "discriminatorValue": "error"
        }
      ],
      "subMessages": [
        {
          "name": "Success",
          "fields": [
            {
              "name": "id",
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
              "name": "output",
              "number": 2,
              "type": {
                "kind": "scalar",
                "type": "bytes"
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
          "name": "Error",
          "fields": [
            {
              "name": "id",
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
              "name": "code",
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
              "name": "message",
              "number": 3,
              "type": {
                "kind": "scalar",
                "type": "string"
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
      "comment": "",
      "discriminator": "result"
    },
    {
      "name": "BatchResponse",
      "fields": [
        {
          "name": "results",
          "number": 1,
          "type": {
            "kind": "message",
            "name": "BatchResult"
          },
          "repeated": true,
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
      "BatchRequest": {
        "propertyGenCache": {
          "calls": {
            "tag": 1,
            "type": "BatchCall",
            "propertyGenCache": {},
            "usedIds": {}
          }
        },
        "usedIds": {
          "1": "calls"
        }
      },
      "BatchCall": {
        "propertyGenCache": {
          "id": {
            "tag": 1,
            "type": "int32",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "path": {
            "tag": 2,
            "type": "string",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "input": {
            "tag": 3,
            "type": "bytes",
            "propertyGenCache": {},
            "usedIds": {}
          }
        },
        "usedIds": {
          "1": "id",
          "2": "path",
          "3": "input"
        }
      },
      "BatchResponse": {
        "propertyGenCache": {
          "results": {
            "tag": 1,
            "type": "BatchResult",
            "propertyGenCache": {},
            "usedIds": {}
          }
        },
        "usedIds": {
          "1": "results"
        }
      },
      "BatchResult": {
        "propertyGenCache": {
          "success": {
            "tag": 1,
            "type": "Success",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "error": {
            "tag": 2,
            "type": "Error",
            "propertyGenCache": {},
            "usedIds": {}
          }
        },
        "usedIds": {
          "1": "success",
          "2": "error"
        }
      },
      "BatchResult.Success": {
        "propertyGenCache": {
          "id": {
            "tag": 1,
            "type": "int32",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "output": {
            "tag": 2,
            "type": "bytes",
            "propertyGenCache": {},
            "usedIds": {}
          }
        },
        "usedIds": {
          "1": "id",
          "2": "output"
        }
      },
      "BatchResult.Error": {
        "propertyGenCache": {
          "id": {
            "tag": 1,
            "type": "int32",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "code": {
            "tag": 2,
            "type": "int32",
            "propertyGenCache": {},
            "usedIds": {}
          },
          "message": {
            "tag": 3,
            "type": "string",
            "propertyGenCache": {},
            "usedIds": {}
          }
        },
        "usedIds": {
          "1": "id",
          "2": "code",
          "3": "message"
        }
      }
    }
  }
} satisfies ProtoSchema;
