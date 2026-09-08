/** Protocol-neutral input for one gRPC-Web dispatcher invocation. */
export interface GrpcWebDispatchRequest {
  grpcPath: string;
  message: Uint8Array;
  metadata: ReadonlyMap<string, string>;
  signal: AbortSignal;
}

/** Final gRPC status returned by a dispatcher. */
export interface GrpcWebDispatchStatus {
  code: number;
  message: string;
  metadata?: Record<string, string>;
}

export type EmitGrpcWebMessage = (message: Uint8Array) => Promise<void>;

export type GrpcWebDispatcher = (
  request: GrpcWebDispatchRequest,
  emit: EmitGrpcWebMessage,
) => Promise<GrpcWebDispatchStatus>;
