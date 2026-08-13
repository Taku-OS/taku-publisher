import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repositoryRoot } from './repository-files.mjs';

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
      TAKU_CONTRACT_SOURCE_DIRTY: 'false',
    },
  });
}

try {
  run('mkdir', ['-p', sourceDirectory]);
  const archive = path.join(temporaryRoot, 'source.tar');
  run('git', ['archive', '--format=tar', '--output', archive, 'HEAD']);
  run('tar', ['-xf', archive, '-C', sourceDirectory]);
  run('npm', ['ci'], sourceDirectory);
  run('npm', ['run', 'audit:repo'], sourceDirectory);
  run('npm', ['test'], sourceDirectory);
  run('npm', ['run', 'build:adapters'], sourceDirectory);
  run('npm', ['run', 'smoke:core'], sourceDirectory);
  run('npm', ['run', 'smoke:contract'], sourceDirectory);
  run('npm', ['run', 'checksum:source'], sourceDirectory);
  console.log(
    JSON.stringify({
      ok: true,
      source: 'git archive HEAD',
      desktopDependency: false,
    }),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
