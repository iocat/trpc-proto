# Contributing

## Development

Requirements:

- Node.js with Corepack
- pnpm 10
- Go and Rust only when changing their respective examples

Install dependencies and verify the workspace:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm -r test
pnpm lint
```

Run the focused package test while developing. Regenerate checked-in protobuf artifacts whenever their router contracts change.

## Pull requests

Keep changes focused. Describe the observable behavior, compatibility impact, and exact verification performed. Include tests for new contracts or regressions, and update generated files and documentation in the same pull request.

Do not commit credentials, generated build directories, or unrelated formatting changes.
