import { execFileSync } from 'node:child_process';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repositoryRoot } from './repository-files.mjs';

const contractPackage = JSON.parse(
  await readFile(
    path.join(
      repositoryRoot,
      'packages',
      'capability-contract',
      'package.json',
    ),
    'utf8',
  ),
);
const contractVersion = String(contractPackage.version);
const artifact = path.join(
  repositoryRoot,
  'dist',
  'packages',
  `taku-capability-contract-${contractVersion}.tgz`,
);
await access(artifact);

const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), 'taku-capability-contract-'),
);

try {
  await writeFile(
    path.join(temporaryRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'taku-capability-contract-smoke',
        private: true,
        type: 'module',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  execFileSync('npm', ['install', '--ignore-scripts', artifact], {
    cwd: temporaryRoot,
    stdio: 'inherit',
  });
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        "import * as named from '@taku/capability-contract';",
        `if (named.CAPABILITY_CONTRACT_VERSION !== '${contractVersion}') throw new Error('Wrong contract version.');`,
        "if (typeof named.hashCanonicalCapability !== 'function') throw new Error('Missing canonical hash API.');",
      ].join('\n'),
    ],
    {
      cwd: temporaryRoot,
      stdio: 'inherit',
    },
  );
  await access(
    path.join(
      temporaryRoot,
      'node_modules',
      '@taku',
      'capability-contract',
      'dist',
      'index.d.ts',
    ),
  );
  console.log(
    JSON.stringify({
      ok: true,
      artifact: path.relative(repositoryRoot, artifact),
      version: contractVersion,
      esm: true,
      declarations: true,
    }),
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
