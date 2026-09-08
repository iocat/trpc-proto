import * as grpc from '@grpc/grpc-js';
import type { TRPCError } from '@trpc/server';

/** Maps a tRPC error code to its equivalent gRPC status. */
export function grpcStatus(error: TRPCError): grpc.status {
  switch (error.code) {
    case 'PARSE_ERROR':
    case 'BAD_REQUEST':
    case 'UNPROCESSABLE_CONTENT':
    case 'UNSUPPORTED_MEDIA_TYPE':
      return grpc.status.INVALID_ARGUMENT;

    case 'UNAUTHORIZED':
      return grpc.status.UNAUTHENTICATED;

    case 'FORBIDDEN':
    case 'PAYMENT_REQUIRED':
      return grpc.status.PERMISSION_DENIED;

    case 'NOT_FOUND':
      return grpc.status.NOT_FOUND;

    case 'CONFLICT':
      return grpc.status.ALREADY_EXISTS;

    case 'PRECONDITION_FAILED':
    case 'PRECONDITION_REQUIRED':
      return grpc.status.FAILED_PRECONDITION;

    case 'PAYLOAD_TOO_LARGE':
    case 'TOO_MANY_REQUESTS':
      return grpc.status.RESOURCE_EXHAUSTED;

    case 'TIMEOUT':
    case 'GATEWAY_TIMEOUT':
      return grpc.status.DEADLINE_EXCEEDED;

    case 'CLIENT_CLOSED_REQUEST':
      return grpc.status.CANCELLED;

    case 'METHOD_NOT_SUPPORTED':
    case 'NOT_IMPLEMENTED':
      return grpc.status.UNIMPLEMENTED;

    case 'SERVICE_UNAVAILABLE':
    case 'BAD_GATEWAY':
      return grpc.status.UNAVAILABLE;

    case 'INTERNAL_SERVER_ERROR':
      return grpc.status.INTERNAL;

    default:
      return grpc.status.UNKNOWN;
  }
}
