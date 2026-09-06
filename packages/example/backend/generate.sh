#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="$(go env GOPATH)/bin:$PATH"
OUT="$ROOT/gen/examplev1"
mkdir -p "$OUT"
protoc \
  -I "$ROOT/../generated" \
  -I /opt/homebrew/include \
  --go_out="$OUT" \
  --go_opt=paths=source_relative \
  --go_opt=Mexample_v1.proto=example/backend/gen/examplev1 \
  --go-grpc_out="$OUT" \
  --go-grpc_opt=paths=source_relative \
  --go-grpc_opt=Mexample_v1.proto=example/backend/gen/examplev1 \
  example_v1.proto
