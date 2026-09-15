import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listRepositoryFiles, repositoryRoot } from './repository-files.mjs';

const workingTree = process.argv.includes('--working-tree');
if (process.argv.slice(2).some((arg) => arg !== '--working-tree')) throw new Error('Unknown smoke option.');

const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), 'taku-passport-clean-'),
);
const sourceDirectory = path.join(temporaryRoot, 'source');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();

function run(command, args, cwd = repositoryRoot) {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      CI: 'true',
      TAKU_CONTRACT_SOURCE_COMMIT: sourceCommit,
      TAKU_CONTRACT_SOURCE_DIRTY: workingTree ? 'true' : 'false',
    },
  });
}

try {
  await mkdir(sourceDirectory);
  if (workingTree) {
    for (const relative of await listRepositoryFiles()) {
      const source = path.join(repositoryRoot, relative);
      if ((await lstat(source)).isSymbolicLink()) throw new Error(`Source symlink unsupported: ${relative}`);
      const target = path.join(sourceDirectory, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
  } else {
    const archive = path.join(temporaryRoot, 'source.tar');
    run('git', ['archive', '--format=tar', '--output', archive, 'HEAD']);
    run('tar', ['-xf', archive, '-C', sourceDirectory]);
  }
  run('npm', ['ci'], sourceDirectory);
  run('npm', ['run', 'audit:repo'], sourceDirectory);
  run('npm', ['test'], sourceDirectory);
  run('npm', ['run', 'build:adapters'], sourceDirectory);
  for (const host of ['codex', 'claude', 'cursor']) {
    run('node', ['scripts/no-python-plugin-smoke.mjs', host], sourceDirectory);
  }
  run('node', ['scripts/build-challenge-test.mjs'], sourceDirectory);
  run('node', ['scripts/challenge-test-smoke.mjs'], sourceDirectory);
  run('node', ['scripts/build-marketplace-release.mjs'], sourceDirectory);
  run('node', ['scripts/package-cursor-release.mjs'], sourceDirectory);
  run('npm', ['run', 'smoke:cursor-install'], sourceDirectory);
  run('npm', ['run', 'smoke:core'], sourceDirectory);
  run('npm', ['run', 'smoke:contract'], sourceDirectory);
  run('npm', ['run', 'checksum:source'], sourceDirectory);
  console.log(
    JSON.stringify({
      ok: true,
      source: workingTree ? 'current source snapshot (uncommitted candidate)' : 'git archive HEAD',
      desktopDependency: false,
    }),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
