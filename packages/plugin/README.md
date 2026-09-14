# @trpc-proto/plugin

Generate `.proto` files and runtime schema data from a tRPC 11 router using Zod 4 contracts.

## Install

```bash
npm install --save-dev @trpc-proto/plugin
```

## CLI

After this package is installed in the current project, `npx` resolves its local
`trpc-proto` binary. The npm package name is scoped; only the executable name is
unscoped. Without that local install, `npx trpc-proto` asks npm for the unscoped
`trpc-proto` package, which this project does not publish. pnpm is not required.

```bash
npx trpc-proto generate \
  --router src/router.ts \
  --export appRouter \
  --out generated
```

To select this scoped package explicitly—for example, for a one-off run without
a local plugin install—use:

```bash
npx --package=@trpc-proto/plugin -- trpc-proto generate \
  --router src/router.ts \
  --export appRouter \
  --out generated
```

The output contains a protobuf contract for normal language-specific stub generation and a data-only `schema.ts` consumed by `@trpc-proto/runtime`.

See the [repository README](https://github.com/iocat/trpc-proto#readme) for contract rules, unsupported examples, and deployment modes.
