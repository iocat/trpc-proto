/** Binary protobuf gRPC-Web content type. */
export const GRPC_WEB_CONTENT_TYPE = 'application/grpc-web+proto';
/** Base64-encoded protobuf gRPC-Web content type. */
export const GRPC_WEB_TEXT_CONTENT_TYPE = 'application/grpc-web-text+proto';

const GRPC_WEB_BASE_CONTENT_TYPE = 'application/grpc-web';
const GRPC_WEB_TEXT_BASE_CONTENT_TYPE = 'application/grpc-web-text';

/** HTTP body representation used for gRPC-Web requests and responses. */
export type GrpcWebEncoding =
  /** Raw binary gRPC-Web frames without base64 wrapping. */
  | 'raw'
  /** Base64 text representation of complete binary gRPC-Web frames. */
  | 'base64';

const CONTENT_TYPE_BY_ENCODING: Record<GrpcWebEncoding, string> = {
  raw: GRPC_WEB_CONTENT_TYPE,
  base64: GRPC_WEB_TEXT_CONTENT_TYPE,
};

/** Returns the concrete protobuf content type for an encoding. */
export function grpcWebContentType(encoding: GrpcWebEncoding): string {
  return CONTENT_TYPE_BY_ENCODING[encoding];
}

/** Recognizes supported gRPC-Web content types, ignoring media parameters. */
export function grpcWebEncoding(
  value: string | null | undefined,
): GrpcWebEncoding | undefined {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase();
  switch (mediaType) {
    case GRPC_WEB_TEXT_BASE_CONTENT_TYPE:
    case GRPC_WEB_TEXT_CONTENT_TYPE:
      return 'base64';
    case GRPC_WEB_BASE_CONTENT_TYPE:
    case GRPC_WEB_CONTENT_TYPE:
      return 'raw';
    default:
      return undefined;
  }
}

/** Chooses the first supported Accept value, then falls back to the request. */
export function negotiateGrpcWebResponseEncoding(
  accept: string | undefined,
  requestEncoding: GrpcWebEncoding,
): GrpcWebEncoding {
  for (const value of accept?.split(',') ?? []) {
    const encoding = grpcWebEncoding(value);
    if (encoding) return encoding;
  }
  return requestEncoding;
}

/** Whether a value is one of the supported gRPC-Web content types. */
export function isGrpcWebContentType(value: string | undefined): boolean {
  return grpcWebEncoding(value) !== undefined;
}
