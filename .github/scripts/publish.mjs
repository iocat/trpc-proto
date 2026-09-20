import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releasePackages } from './packages.mjs';

const [tag, mode = '--dry-run', ...extra] = process.argv.slice(2);
if (
  !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/.test(
    tag ?? '',
  ) ||
  !['--check', '--dry-run', '--publish'].includes(mode) ||
  extra.length > 0
) {
  throw new Error(
    'Usage: node .github/scripts/publish.mjs vX.Y.Z [--check|--dry-run|--publish]',
  );
}
const version = tag.slice(1);
const prerelease = version.includes('-');
if (
  process.env.RELEASE_PRERELEASE !== undefined &&
  process.env.RELEASE_PRERELEASE !== String(prerelease)
) {
  throw new Error('The GitHub prerelease flag must match the version suffix.');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const registry = 'https://registry.npmjs.org';
const packages = await releasePackages(root);
const packageNames = new Set(packages.map((pkg) => pkg.name));
const workspace = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
);
if (workspace.version !== version) {
  throw new Error(
    `Release ${tag} must match root version ${workspace.version}.`,
  );
}
for (const pkg of packages) {
  if (pkg.private || pkg.version !== version) {
    throw new Error(
      `${pkg.name} must be public and use the shared version ${version}.`,
    );
  }
  for (const section of [
    'dependencies',
    'optionalDependencies',
    'devDependencies',
    'peerDependencies',
  ]) {
    for (const [dependency, range] of Object.entries(pkg[section] ?? {})) {
      if (packageNames.has(dependency) && range !== 'workspace:*') {
        throw new Error(
          `${pkg.name}: ${dependency} must use workspace:* for an exact release version.`,
        );
      }
    }
  }
}
if (mode === '--check') {
  console.log(
    `All ${packages.length} packages match ${tag} with exact internal dependencies.`,
  );
  process.exit(0);
}

// Preflight all registry reads before publishing; only a 404 means unpublished.
for (const pkg of packages) {
  const response = await fetch(
    `${registry}/${encodeURIComponent(pkg.name)}/${pkg.version}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `npm lookup failed for ${pkg.name}: HTTP ${response.status}`,
    );
  }
  pkg.published = response.ok;
  await response.body?.cancel();
}
for (const pkg of packages) {
  console.log(
    `${pkg.name}@${pkg.version}: ${pkg.published ? 'already published' : 'new version'}`,
  );
}

const temporary = await mkdtemp(join(tmpdir(), 'trpc-proto-release-'));
try {
  const artifacts = [];
  for (const pkg of packages) {
    if (mode === '--publish' && pkg.published) continue;
    const tarball = join(
      temporary,
      `${pkg.name.replace('@', '').replace('/', '-')}-${version}.tgz`,
    );
    // pnpm pack resolves workspace:* to the exact dependency versions.
    execFileSync('pnpm', ['pack', '--out', tarball], {
      cwd: pkg.cwd,
      stdio: 'inherit',
    });
    artifacts.push(tarball);
  }
  for (const tarball of artifacts) {
    execFileSync(
      'npm',
      [
        'publish',
        tarball,
        '--access',
        'public',
        '--registry',
        registry,
        '--tag',
        prerelease ? 'next' : 'latest',
        '--ignore-scripts',
        mode === '--publish' ? '--provenance' : '--dry-run',
      ],
      { cwd: root, stdio: 'inherit' },
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
