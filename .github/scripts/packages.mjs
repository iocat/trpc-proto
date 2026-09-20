import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Discover public packages and order their production dependencies first. */
export async function releasePackages(root) {
  const projects = JSON.parse(
    execFileSync('pnpm', ['list', '--recursive', '--depth', '-1', '--json'], {
      cwd: root,
      encoding: 'utf8',
    }),
  );
  const manifests = await Promise.all(
    projects.map(async (project) => ({
      ...JSON.parse(await readFile(join(project.path, 'package.json'), 'utf8')),
      cwd: project.path,
    })),
  );
  const packages = manifests.filter((pkg) => !pkg.private);
  if (packages.length === 0)
    throw new Error('No public workspace packages found.');
  const pending = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const ordered = [];
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((pkg) =>
      [pkg.dependencies, pkg.optionalDependencies].every((dependencies) =>
        Object.keys(dependencies ?? {}).every((name) => !pending.has(name)),
      ),
    );
    if (ready.length === 0) {
      throw new Error(
        `Cyclic production dependencies: ${[...pending.keys()].join(', ')}`,
      );
    }
    for (const pkg of ready) {
      ordered.push(pkg);
      pending.delete(pkg.name);
    }
  }
  return ordered;
}
