import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releasePackages } from './packages.mjs';

const [target, ...extra] = process.argv.slice(2);
if (!target || target.startsWith('-') || extra.length > 0) {
  throw new Error('Usage: pnpm release:version <patch|minor|major|version>');
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const options = [
  '--no-git-tag-version',
  '--ignore-scripts',
  '--allow-same-version',
];
const packages = await releasePackages(root);
execFileSync('npm', ['version', target, ...options], {
  cwd: root,
  stdio: 'inherit',
});
const { version } = JSON.parse(
  await readFile(join(root, 'package.json'), 'utf8'),
);
for (const pkg of packages) {
  execFileSync('npm', ['version', version, ...options], {
    cwd: pkg.cwd,
    stdio: 'inherit',
  });
}
console.log(
  `All packages now use ${version}. Commit the manifests before tagging v${version}.`,
);
