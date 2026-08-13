import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repositoryRoot } from './repository-files.mjs';

const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), 'taku-passport-core-install-'),
);
const appDirectory = path.join(temporaryRoot, 'app');

function run(command, args, cwd = repositoryRoot, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CI: 'true',
    },
  });
}

function pack(workspace) {
  const output = run('npm', [
    'pack',
    '--workspace',
    workspace,
    '--json',
    '--pack-destination',
    temporaryRoot,
  ]);
  const [result] = JSON.parse(output);
  if (!result?.filename) {
    throw new Error(`npm pack did not return an archive for ${workspace}.`);
  }
  return path.join(temporaryRoot, result.filename);
}

try {
  const contractArchive = pack('@taku/capability-contract');
  const coreArchive = pack('@taku/passport-core');
  run('mkdir', ['-p', appDirectory]);
  await writeFile(
    path.join(appDirectory, 'package.json'),
    `${JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        '@taku/capability-contract': `file:${contractArchive}`,
        '@taku/passport-core': `file:${coreArchive}`,
      },
    }, null, 2)}\n`,
  );
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
  ], appDirectory, {
    stdio: 'inherit',
  });

  const script = `
    import {
      TAKU_PASSPORT_CORE_API_VERSION,
      buildPassportSnapshot,
      sanitizePublishJson,
    } from '@taku/passport-core';

    const snapshot = buildPassportSnapshot({
      generatedAt: '2026-07-21T00:00:00.000Z',
      usedTools: [{
        id: 'skill-1',
        type: 'skill',
        source: 'codex',
        name: 'Review',
      }],
    }, {
      items: [{
        id: 'skill-1',
        localPath: '/tmp/skills/review/SKILL.md',
      }],
    });
    const publicValue = sanitizePublishJson({
      name: 'Review',
      localPath: '/tmp/skills/review/SKILL.md',
    });
    if (TAKU_PASSPORT_CORE_API_VERSION !== 'taku.passport-core.v1') {
      throw new Error('Unexpected Passport Core API version.');
    }
    if (snapshot.schemaVersion !== 'taku.capability-snapshot.v1') {
      throw new Error('Unexpected capability snapshot schema.');
    }
    if ('localPath' in publicValue) {
      throw new Error('Private locator escaped the public projection.');
    }
  `;
  run(process.execPath, ['--input-type=module', '--eval', script], appDirectory);

  const packageJson = JSON.parse(
    await readFile(
      path.join(
        appDirectory,
        'node_modules',
        '@taku',
        'passport-core',
        'package.json',
      ),
      'utf8',
    ),
  );
  console.log(JSON.stringify({
    ok: true,
    package: packageJson.name,
    version: packageJson.version,
    standalone: true,
  }));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
