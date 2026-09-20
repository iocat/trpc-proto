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

## Publishing a release

All public pnpm workspace packages share the root package version. Internal
dependencies must use `workspace:*`: pnpm packs them as exact versions, never
caret or tilde ranges. A dependency change therefore ships with the matching
versions of its consumers. Private examples and benchmarks are not published.

### One-time npm setup

For each public package, open **Settings → Trusted publishing → GitHub Actions**
on npmjs.com and configure:

| Setting              | Value                                       |
| -------------------- | ------------------------------------------- |
| Organization or user | `iocat`                                     |
| Repository           | `trpc-proto`                                |
| Workflow filename    | `publish.yml`                               |
| Environment name     | Leave empty                                 |
| Allowed actions      | Enable direct publishing with `npm publish` |

The workflow uses GitHub-hosted runners, OIDC, and provenance. No `NPM_TOKEN`
secret is needed. New public packages also need their own npm trusted-publisher
configuration before they can be released.

### Each release

1. Run `pnpm release:version patch` (or `minor`, `major`, or an explicit version).
   This updates the root and every public workspace package discovered by pnpm;
   it does not commit or tag.
2. Run `pnpm install --frozen-lockfile`, `pnpm build`, and `pnpm -r test`.
3. Run `pnpm release:check vX.Y.Z --check` to check lockstep versions and exact
   internal dependency declarations. Run `pnpm release:check vX.Y.Z --dry-run`
   to also pack every public package and dry-run npm publishing.
4. Commit the changes and push them to GitHub.
5. Create and publish a **GitHub Release** with tag `vX.Y.Z` targeting that commit.
   Publishing the release triggers `.github/workflows/publish.yml`; pushing
   a tag alone or saving a draft release does not publish packages.

The workflow rejects version mismatches, builds and tests public packages, packs
them with pnpm, then publishes with npm in production-dependency order. It
discovers packages from the workspace rather than maintaining a directory list.
Stable releases use npm's `latest` tag. Suffixed versions such as
`v0.3.0-rc.1` must be marked as GitHub prereleases and use npm's `next` tag.

npm cannot publish a group of packages atomically. If a run partially succeeds,
rerun that same workflow: existing versions are skipped and remaining packages
are published. Never move a published release tag or overwrite a package version.
