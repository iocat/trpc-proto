import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GRPC_WEB_CONTENT_TYPE,
  GRPC_WEB_TEXT_CONTENT_TYPE,
  grpcWebContentType,
  grpcWebEncoding,
  isGrpcWebContentType,
  negotiateGrpcWebResponseEncoding,
} from './content_type.js';

describe('gRPC-Web content types', () => {
  const cases = [
    {
      name: 'raw protobuf content type',
      value: 'application/grpc-web+proto',
      encoding: 'raw',
    },
    {
      name: 'raw base content type',
      value: 'application/grpc-web',
      encoding: 'raw',
    },
    {
      name: 'base64 protobuf content type',
      value: 'application/grpc-web-text+proto',
      encoding: 'base64',
    },
    {
      name: 'base64 base content type',
      value: 'application/grpc-web-text',
      encoding: 'base64',
    },
    {
      name: 'case and media parameters',
      value: 'Application/Grpc-Web-Text+Proto; charset=utf-8',
      encoding: 'base64',
    },
    { name: 'unrelated', value: 'text/plain', encoding: undefined },
  ] as const;

  for (const row of cases) {
    it(row.name, () => {
      assert.equal(grpcWebEncoding(row.value), row.encoding);
      assert.equal(isGrpcWebContentType(row.value), row.encoding !== undefined);
    });
  }

  it('maps encodings to concrete protobuf content types', () => {
    assert.equal(grpcWebContentType('raw'), GRPC_WEB_CONTENT_TYPE);
    assert.equal(grpcWebContentType('base64'), GRPC_WEB_TEXT_CONTENT_TYPE);
  });

  it('negotiates the first supported response type', () => {
    assert.equal(
      negotiateGrpcWebResponseEncoding(
        'text/plain, application/grpc-web-text+proto',
        'raw',
      ),
      'base64',
    );
    assert.equal(negotiateGrpcWebResponseEncoding(undefined, 'base64'), 'base64');
  });
});
