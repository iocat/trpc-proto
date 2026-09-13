# @trpc-proto/plugin

Generate `.proto` files and runtime schema data from a tRPC 11 router using Zod 4 contracts.

## Install

```bash
pnpm add -D @trpc-proto/plugin
```

## CLI

```bash
trpc-proto generate \
  --router src/router.ts \
  --export appRouter \
  --out generated
```

The output contains a protobuf contract for normal language-specific stub generation and a data-only `schema.ts` consumed by `@trpc-proto/runtime`.

See the [repository README](https://github.com/iocat/trpc-proto#readme) for contract rules, unsupported examples, and deployment modes.
