import type { ProtoSchema } from '@trpc-proto/runtime';

export const protoSchema = {
  syntax: 'proto3',
  package: 'operations.v1',
  services: [
    {
      name: 'OperationsService',
      methods: [
        {
          name: 'Snapshot',
          path: 'operations.snapshot',
          type: 'query',
          requestType: 'OperationsSnapshotRequest',
          responseType: 'OperationsSnapshot',
          isResponseStreaming: false,
        },
        {
          name: 'Responders',
          path: 'operations.responders',
          type: 'query',
          requestType: 'OperationsRespondersRequest',
          responseType: 'OperationsRespondersResponse',
          isResponseStreaming: false,
        },
      ],
    },
    {
      name: 'IncidentService',
      methods: [
        {
          name: 'List',
          path: 'incident.list',
          type: 'query',
          requestType: 'IncidentListRequest',
          responseType: 'IncidentListResponse',
          isResponseStreaming: false,
        },
        {
          name: 'Get',
          path: 'incident.get',
          type: 'query',
          requestType: 'IncidentGetRequest',
          responseType: 'Incident',
          isResponseStreaming: false,
        },
        {
          name: 'Create',
          path: 'incident.create',
          type: 'mutation',
          requestType: 'IncidentCreateRequest',
          responseType: 'Incident',
          isResponseStreaming: false,
        },
        {
          name: 'Update',
          path: 'incident.update',
          type: 'mutation',
          requestType: 'IncidentUpdateRequest',
          responseType: 'Incident',
          isResponseStreaming: false,
        },
        {
          name: 'ToggleChecklist',
          path: 'incident.toggleChecklist',
          type: 'mutation',
          requestType: 'IncidentToggleChecklistRequest',
          responseType: 'Incident',
          isResponseStreaming: false,
        },
        {
          name: 'Delete',
          path: 'incident.delete',
          type: 'mutation',
          requestType: 'IncidentDeleteRequest',
          responseType: 'IncidentDeleteResponse',
          isResponseStreaming: false,
        },
        {
          name: 'AddNote',
          path: 'incident.addNote',
          type: 'mutation',
          requestType: 'IncidentAddNoteRequest',
          responseType: 'TimelineEntry',
          isResponseStreaming: false,
        },
        {
          name: 'Timeline',
          path: 'incident.timeline',
          type: 'query',
          requestType: 'IncidentTimelineRequest',
          responseType: 'IncidentTimelineResponse',
          isResponseStreaming: false,
        },
        {
          name: 'Watch',
          path: 'incident.watch',
          type: 'subscription',
          requestType: 'IncidentWatchRequest',
          responseType: 'IncidentEvent',
          isResponseStreaming: true,
        },
      ],
    },
  ],
  messages: [
    {
      name: 'OperationsSnapshotRequest',
      fields: [],
      subMessages: [],
      comment: '',
    },
    {
      name: 'Responder',
      fields: [
        {
          name: 'id',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'name',
          number: 2,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'role',
          number: 3,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'avatar_color',
          number: 4,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'online',
          number: 5,
          type: {
            kind: 'scalar',
            type: 'bool',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: 'A responder available to command or assist an incident.',
    },
    {
      name: 'ChecklistItem',
      fields: [
        {
          name: 'id',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'label',
          number: 2,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'completed',
          number: 3,
          type: {
            kind: 'scalar',
            type: 'bool',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'Incident',
      fields: [
        {
          name: 'id',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'title',
          number: 2,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'summary',
          number: 3,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'service',
          number: 4,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'status',
          number: 5,
          type: {
            kind: 'enum',
            name: 'IncidentStatus',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'severity',
          number: 6,
          type: {
            kind: 'enum',
            name: 'IncidentSeverity',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'commander',
          number: 7,
          type: {
            kind: 'message',
            name: 'Responder',
          },
          repeated: false,
          optional: true,
          comment: 'A responder available to command or assist an incident.',
        },
        {
          name: 'tags',
          number: 8,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: true,
          optional: true,
          comment: '',
        },
        {
          name: 'labels',
          number: 9,
          type: {
            kind: 'map',
            key: 'string',
            value: {
              kind: 'scalar',
              type: 'string',
            },
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'checklist',
          number: 10,
          type: {
            kind: 'message',
            name: 'ChecklistItem',
          },
          repeated: true,
          optional: true,
          comment: '',
        },
        {
          name: 'created_at',
          number: 11,
          type: {
            kind: 'message',
            name: 'google.protobuf.Timestamp',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'updated_at',
          number: 12,
          type: {
            kind: 'message',
            name: 'google.protobuf.Timestamp',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'revision',
          number: 13,
          type: {
            kind: 'scalar',
            type: 'int32',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: 'The current materialized state of an operational incident.',
    },
    {
      name: 'OperationsSnapshot',
      fields: [
        {
          name: 'incidents',
          number: 1,
          type: {
            kind: 'message',
            name: 'Incident',
          },
          repeated: true,
          optional: true,
          comment: 'The current materialized state of an operational incident.',
        },
        {
          name: 'responders',
          number: 2,
          type: {
            kind: 'message',
            name: 'Responder',
          },
          repeated: true,
          optional: true,
          comment: 'A responder available to command or assist an incident.',
        },
        {
          name: 'open_by_severity',
          number: 3,
          type: {
            kind: 'map',
            key: 'string',
            value: {
              kind: 'scalar',
              type: 'int32',
            },
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'services',
          number: 4,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: true,
          optional: true,
          comment: '',
        },
        {
          name: 'revision',
          number: 5,
          type: {
            kind: 'scalar',
            type: 'int32',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'OperationsRespondersRequest',
      fields: [
        {
          name: 'online_only',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'bool',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'OperationsRespondersResponse',
      fields: [
        {
          name: 'items',
          number: 1,
          type: {
            kind: 'message',
            name: 'Responder',
          },
          repeated: true,
          optional: true,
          comment: 'A responder available to command or assist an incident.',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentListRequest',
      fields: [
        {
          name: 'query',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'status',
          number: 2,
          type: {
            kind: 'enum',
            name: 'IncidentStatus',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'severity',
          number: 3,
          type: {
            kind: 'enum',
            name: 'IncidentSeverity',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'service',
          number: 4,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'page_size',
          number: 5,
          type: {
            kind: 'scalar',
            type: 'int32',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentListResponse',
      fields: [
        {
          name: 'items',
          number: 1,
          type: {
            kind: 'message',
            name: 'Incident',
          },
          repeated: true,
          optional: true,
          comment: 'The current materialized state of an operational incident.',
        },
        {
          name: 'total',
          number: 2,
          type: {
            kind: 'scalar',
            type: 'int32',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'revision',
          number: 3,
          type: {
            kind: 'scalar',
            type: 'int32',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentGetRequest',
      fields: [
        {
          name: 'id',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentCreateRequest',
      fields: [
        {
          name: 'title',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'summary',
          number: 2,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'service',
          number: 3,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'severity',
          number: 4,
          type: {
            kind: 'enum',
            name: 'IncidentSeverity',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'commander_id',
          number: 5,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'tags',
          number: 6,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: true,
          optional: true,
          comment: '',
        },
        {
          name: 'labels',
          number: 7,
          type: {
            kind: 'map',
            key: 'string',
            value: {
              kind: 'scalar',
              type: 'string',
            },
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentUpdateRequest',
      fields: [
        {
          name: 'id',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'title',
          number: 2,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'summary',
          number: 3,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'service',
          number: 4,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'status',
          number: 5,
          type: {
            kind: 'enum',
            name: 'IncidentStatus',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'severity',
          number: 6,
          type: {
            kind: 'enum',
            name: 'IncidentSeverity',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'commander_id',
          number: 7,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'clear_commander',
          number: 10,
          type: {
            kind: 'scalar',
            type: 'bool',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'tags',
          number: 8,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: true,
          optional: true,
          comment: '',
        },
        {
          name: 'replace_tags',
          number: 11,
          type: {
            kind: 'scalar',
            type: 'bool',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'labels',
          number: 9,
          type: {
            kind: 'map',
            key: 'string',
            value: {
              kind: 'scalar',
              type: 'string',
            },
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'replace_labels',
          number: 12,
          type: {
            kind: 'scalar',
            type: 'bool',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentToggleChecklistRequest',
      fields: [
        {
          name: 'incident_id',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'item_id',
          number: 2,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'completed',
          number: 3,
          type: {
            kind: 'scalar',
            type: 'bool',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentDeleteRequest',
      fields: [
        {
          name: 'id',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentDeleteResponse',
      fields: [
        {
          name: 'id',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'deleted',
          number: 2,
          type: {
            kind: 'scalar',
            type: 'bool',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'revision',
          number: 3,
          type: {
            kind: 'scalar',
            type: 'int32',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentAddNoteRequest',
      fields: [
        {
          name: 'incident_id',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'author_id',
          number: 2,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'message',
          number: 3,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'TimelineEntry',
      fields: [
        {
          name: 'id',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'incident_id',
          number: 2,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'kind',
          number: 3,
          type: {
            kind: 'enum',
            name: 'ActivityKind',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'actor',
          number: 4,
          type: {
            kind: 'message',
            name: 'Responder',
          },
          repeated: false,
          optional: true,
          comment: 'A responder available to command or assist an incident.',
        },
        {
          name: 'message',
          number: 5,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'created_at',
          number: 6,
          type: {
            kind: 'message',
            name: 'google.protobuf.Timestamp',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'revision',
          number: 7,
          type: {
            kind: 'scalar',
            type: 'int32',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentTimelineRequest',
      fields: [
        {
          name: 'incident_id',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentTimelineResponse',
      fields: [
        {
          name: 'items',
          number: 1,
          type: {
            kind: 'message',
            name: 'TimelineEntry',
          },
          repeated: true,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentWatchRequest',
      fields: [
        {
          name: 'after_revision',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'int32',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'heartbeat_seconds',
          number: 2,
          type: {
            kind: 'scalar',
            type: 'int32',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: '',
    },
    {
      name: 'IncidentEvent',
      fields: [
        {
          name: 'revision',
          number: 1,
          type: {
            kind: 'scalar',
            type: 'int32',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'kind',
          number: 2,
          type: {
            kind: 'enum',
            name: 'ActivityKind',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'incident',
          number: 3,
          type: {
            kind: 'message',
            name: 'Incident',
          },
          repeated: false,
          optional: true,
          comment: 'The current materialized state of an operational incident.',
        },
        {
          name: 'entry',
          number: 4,
          type: {
            kind: 'message',
            name: 'TimelineEntry',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'incident_id',
          number: 5,
          type: {
            kind: 'scalar',
            type: 'string',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
        {
          name: 'emitted_at',
          number: 6,
          type: {
            kind: 'message',
            name: 'google.protobuf.Timestamp',
          },
          repeated: false,
          optional: true,
          comment: '',
        },
      ],
      subMessages: [],
      comment: 'A resumable event emitted when incident state changes.',
    },
  ],
  enums: [
    {
      name: 'IncidentStatus',
      values: [
        {
          name: 'investigating',
          number: 0,
        },
        {
          name: 'identified',
          number: 1,
        },
        {
          name: 'monitoring',
          number: 2,
        },
        {
          name: 'resolved',
          number: 3,
        },
      ],
      comment: '',
    },
    {
      name: 'IncidentSeverity',
      values: [
        {
          name: 'sev1',
          number: 0,
        },
        {
          name: 'sev2',
          number: 1,
        },
        {
          name: 'sev3',
          number: 2,
        },
        {
          name: 'sev4',
          number: 3,
        },
      ],
      comment: '',
    },
    {
      name: 'ActivityKind',
      values: [
        {
          name: 'incident_created',
          number: 0,
        },
        {
          name: 'incident_updated',
          number: 1,
        },
        {
          name: 'note_added',
          number: 2,
        },
        {
          name: 'responder_joined',
          number: 3,
        },
        {
          name: 'incident_deleted',
          number: 4,
        },
        {
          name: 'heartbeat',
          number: 5,
        },
      ],
      comment: '',
    },
  ],
  generateCache: {
    propertyGenCache: {
      TelemetryWatchRequest: {
        propertyGenCache: {
          rate_per_second: {
            tag: 1,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
          duration_seconds: {
            tag: 2,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
          payload_bytes: {
            tag: 3,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'rate_per_second',
          '2': 'duration_seconds',
          '3': 'payload_bytes',
        },
      },
      TelemetryEvent: {
        propertyGenCache: {
          sequence: {
            tag: 1,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
          source: {
            tag: 2,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          reading: {
            tag: 3,
            type: 'double',
            propertyGenCache: {},
            usedIds: {},
          },
          trend: {
            tag: 4,
            type: 'double',
            propertyGenCache: {},
            usedIds: {},
          },
          sent_at_unix_ms: {
            tag: 5,
            type: 'double',
            propertyGenCache: {},
            usedIds: {},
          },
          payload: {
            tag: 6,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'sequence',
          '2': 'source',
          '3': 'reading',
          '4': 'trend',
          '5': 'sent_at_unix_ms',
          '6': 'payload',
        },
      },
      ChatRespondRequest: {
        propertyGenCache: {
          prompt: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          tokens_per_second: {
            tag: 2,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
          max_tokens: {
            tag: 3,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'prompt',
          '2': 'tokens_per_second',
          '3': 'max_tokens',
        },
      },
      ChatEvent: {
        propertyGenCache: {
          sequence: {
            tag: 1,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
          kind: {
            tag: 2,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          content: {
            tag: 3,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          sent_at_unix_ms: {
            tag: 4,
            type: 'double',
            propertyGenCache: {},
            usedIds: {},
          },
          progress: {
            tag: 5,
            type: 'double',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'sequence',
          '2': 'kind',
          '3': 'content',
          '4': 'sent_at_unix_ms',
          '5': 'progress',
        },
      },
      OperationsSnapshotRequest: {
        propertyGenCache: {},
        usedIds: {},
      },
      OperationsSnapshot: {
        propertyGenCache: {
          incidents: {
            tag: 1,
            type: 'Incident',
            propertyGenCache: {},
            usedIds: {},
          },
          responders: {
            tag: 2,
            type: 'Responder',
            propertyGenCache: {},
            usedIds: {},
          },
          open_by_severity: {
            tag: 3,
            type: 'map<string, int32>',
            propertyGenCache: {},
            usedIds: {},
          },
          services: {
            tag: 4,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          revision: {
            tag: 5,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'incidents',
          '2': 'responders',
          '3': 'open_by_severity',
          '4': 'services',
          '5': 'revision',
        },
      },
      Incident: {
        propertyGenCache: {
          id: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          title: {
            tag: 2,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          summary: {
            tag: 3,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          service: {
            tag: 4,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          status: {
            tag: 5,
            type: 'IncidentStatus',
            propertyGenCache: {},
            usedIds: {},
          },
          severity: {
            tag: 6,
            type: 'IncidentSeverity',
            propertyGenCache: {},
            usedIds: {},
          },
          commander: {
            tag: 7,
            type: 'Responder',
            propertyGenCache: {},
            usedIds: {},
          },
          tags: {
            tag: 8,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          labels: {
            tag: 9,
            type: 'map<string, string>',
            propertyGenCache: {},
            usedIds: {},
          },
          checklist: {
            tag: 10,
            type: 'ChecklistItem',
            propertyGenCache: {},
            usedIds: {},
          },
          created_at: {
            tag: 11,
            type: 'google.protobuf.Timestamp',
            propertyGenCache: {},
            usedIds: {},
          },
          updated_at: {
            tag: 12,
            type: 'google.protobuf.Timestamp',
            propertyGenCache: {},
            usedIds: {},
          },
          revision: {
            tag: 13,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'id',
          '2': 'title',
          '3': 'summary',
          '4': 'service',
          '5': 'status',
          '6': 'severity',
          '7': 'commander',
          '8': 'tags',
          '9': 'labels',
          '10': 'checklist',
          '11': 'created_at',
          '12': 'updated_at',
          '13': 'revision',
        },
      },
      Responder: {
        propertyGenCache: {
          id: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          name: {
            tag: 2,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          role: {
            tag: 3,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          avatar_color: {
            tag: 4,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          online: {
            tag: 5,
            type: 'bool',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'id',
          '2': 'name',
          '3': 'role',
          '4': 'avatar_color',
          '5': 'online',
        },
      },
      ChecklistItem: {
        propertyGenCache: {
          id: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          label: {
            tag: 2,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          completed: {
            tag: 3,
            type: 'bool',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'id',
          '2': 'label',
          '3': 'completed',
        },
      },
      OperationsRespondersRequest: {
        propertyGenCache: {
          online_only: {
            tag: 1,
            type: 'bool',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'online_only',
        },
      },
      OperationsRespondersResponse: {
        propertyGenCache: {
          items: {
            tag: 1,
            type: 'Responder',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'items',
        },
      },
      IncidentListRequest: {
        propertyGenCache: {
          query: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          status: {
            tag: 2,
            type: 'IncidentStatus',
            propertyGenCache: {},
            usedIds: {},
          },
          severity: {
            tag: 3,
            type: 'IncidentSeverity',
            propertyGenCache: {},
            usedIds: {},
          },
          service: {
            tag: 4,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          page_size: {
            tag: 5,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'query',
          '2': 'status',
          '3': 'severity',
          '4': 'service',
          '5': 'page_size',
        },
      },
      IncidentListResponse: {
        propertyGenCache: {
          items: {
            tag: 1,
            type: 'Incident',
            propertyGenCache: {},
            usedIds: {},
          },
          total: {
            tag: 2,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
          revision: {
            tag: 3,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'items',
          '2': 'total',
          '3': 'revision',
        },
      },
      IncidentGetRequest: {
        propertyGenCache: {
          id: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'id',
        },
      },
      IncidentCreateRequest: {
        propertyGenCache: {
          title: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          summary: {
            tag: 2,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          service: {
            tag: 3,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          severity: {
            tag: 4,
            type: 'IncidentSeverity',
            propertyGenCache: {},
            usedIds: {},
          },
          commander_id: {
            tag: 5,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          tags: {
            tag: 6,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          labels: {
            tag: 7,
            type: 'map<string, string>',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'title',
          '2': 'summary',
          '3': 'service',
          '4': 'severity',
          '5': 'commander_id',
          '6': 'tags',
          '7': 'labels',
        },
      },
      IncidentUpdateRequest: {
        propertyGenCache: {
          id: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          title: {
            tag: 2,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          summary: {
            tag: 3,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          service: {
            tag: 4,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          status: {
            tag: 5,
            type: 'IncidentStatus',
            propertyGenCache: {},
            usedIds: {},
          },
          severity: {
            tag: 6,
            type: 'IncidentSeverity',
            propertyGenCache: {},
            usedIds: {},
          },
          commander_id: {
            tag: 7,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          tags: {
            tag: 8,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          labels: {
            tag: 9,
            type: 'map<string, string>',
            propertyGenCache: {},
            usedIds: {},
          },
          clear_commander: {
            tag: 10,
            type: 'bool',
            propertyGenCache: {},
            usedIds: {},
          },
          replace_tags: {
            tag: 11,
            type: 'bool',
            propertyGenCache: {},
            usedIds: {},
          },
          replace_labels: {
            tag: 12,
            type: 'bool',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'id',
          '2': 'title',
          '3': 'summary',
          '4': 'service',
          '5': 'status',
          '6': 'severity',
          '7': 'commander_id',
          '8': 'tags',
          '9': 'labels',
          '10': 'clear_commander',
          '11': 'replace_tags',
          '12': 'replace_labels',
        },
      },
      IncidentDeleteRequest: {
        propertyGenCache: {
          id: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'id',
        },
      },
      IncidentDeleteResponse: {
        propertyGenCache: {
          id: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          deleted: {
            tag: 2,
            type: 'bool',
            propertyGenCache: {},
            usedIds: {},
          },
          revision: {
            tag: 3,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'id',
          '2': 'deleted',
          '3': 'revision',
        },
      },
      IncidentAddNoteRequest: {
        propertyGenCache: {
          incident_id: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          author_id: {
            tag: 2,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          message: {
            tag: 3,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'incident_id',
          '2': 'author_id',
          '3': 'message',
        },
      },
      TimelineEntry: {
        propertyGenCache: {
          id: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          incident_id: {
            tag: 2,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          kind: {
            tag: 3,
            type: 'ActivityKind',
            propertyGenCache: {},
            usedIds: {},
          },
          actor: {
            tag: 4,
            type: 'Responder',
            propertyGenCache: {},
            usedIds: {},
          },
          message: {
            tag: 5,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          created_at: {
            tag: 6,
            type: 'google.protobuf.Timestamp',
            propertyGenCache: {},
            usedIds: {},
          },
          revision: {
            tag: 7,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'id',
          '2': 'incident_id',
          '3': 'kind',
          '4': 'actor',
          '5': 'message',
          '6': 'created_at',
          '7': 'revision',
        },
      },
      IncidentTimelineRequest: {
        propertyGenCache: {
          incident_id: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'incident_id',
        },
      },
      IncidentTimelineResponse: {
        propertyGenCache: {
          items: {
            tag: 1,
            type: 'TimelineEntry',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'items',
        },
      },
      IncidentWatchRequest: {
        propertyGenCache: {
          after_revision: {
            tag: 1,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
          heartbeat_seconds: {
            tag: 2,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'after_revision',
          '2': 'heartbeat_seconds',
        },
      },
      IncidentEvent: {
        propertyGenCache: {
          revision: {
            tag: 1,
            type: 'int32',
            propertyGenCache: {},
            usedIds: {},
          },
          kind: {
            tag: 2,
            type: 'ActivityKind',
            propertyGenCache: {},
            usedIds: {},
          },
          incident: {
            tag: 3,
            type: 'Incident',
            propertyGenCache: {},
            usedIds: {},
          },
          entry: {
            tag: 4,
            type: 'TimelineEntry',
            propertyGenCache: {},
            usedIds: {},
          },
          incident_id: {
            tag: 5,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          emitted_at: {
            tag: 6,
            type: 'google.protobuf.Timestamp',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'revision',
          '2': 'kind',
          '3': 'incident',
          '4': 'entry',
          '5': 'incident_id',
          '6': 'emitted_at',
        },
      },
      IncidentToggleChecklistRequest: {
        propertyGenCache: {
          incident_id: {
            tag: 1,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          item_id: {
            tag: 2,
            type: 'string',
            propertyGenCache: {},
            usedIds: {},
          },
          completed: {
            tag: 3,
            type: 'bool',
            propertyGenCache: {},
            usedIds: {},
          },
        },
        usedIds: {
          '1': 'incident_id',
          '2': 'item_id',
          '3': 'completed',
        },
      },
    },
  },
} satisfies ProtoSchema;
