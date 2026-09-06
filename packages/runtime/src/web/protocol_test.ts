import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeGrpcWeb,
  encodeGrpcWebMessage,
  encodeGrpcWebTrailers,
  isGrpcWebContentType,
} from './protocol.js';


describe('gRPC-Web framing', () => {
  it('round-trips a data frame and trailers', () => {
    const payload = new Uint8Array([1, 2, 3]);
    const body = new Uint8Array([
      ...encodeGrpcWebMessage(payload),
      ...encodeGrpcWebTrailers(0, 'ok'),
    ]);
    const decoded = decodeGrpcWeb(body);
    assert.deepEqual([...decoded.messages[0]!], [1, 2, 3]);
    assert.equal(decoded.trailers['grpc-status'], '0');
    assert.equal(decoded.trailers['grpc-message'], 'ok');
  });

  it('includes extra trailer metadata', () => {
    const decoded = decodeGrpcWeb(
      encodeGrpcWebTrailers(5, 'missing', { 'x-trace': 'abc' }),
    );
    assert.equal(decoded.trailers['grpc-status'], '5');
    assert.equal(decoded.trailers['grpc-message'], 'missing');
    assert.equal(decoded.trailers['x-trace'], 'abc');
  });

});

describe('isGrpcWebContentType', () => {
  it('detects application/grpc-web+proto', () => {
    assert.equal(isGrpcWebContentType('application/grpc-web+proto'), true);
    assert.equal(isGrpcWebContentType('text/plain'), false);
  });
});
