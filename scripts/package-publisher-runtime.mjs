import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { repositoryRoot } from './repository-files.mjs';

const packageName = '@taku/publisher-runtime';
const packageDirectory = path.join(
  repositoryRoot,
  'packages',
  'publisher-runtime',
);
const outputDirectory = path.join(
  repositoryRoot,
  'dist',
  'packages',
  'publisher-runtime',
);
const packageJson = JSON.parse(
  await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
);
const version = String(packageJson.version || '');
if (packageJson.name !== packageName) {
  throw new Error('Publisher Runtime package identity is invalid.');
}
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Publisher Runtime package has an invalid version.');
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
const raw = execFileSync(
  'npm',
  [
    'pack',
    '--workspace',
    packageName,
    '--pack-destination',
    outputDirectory,
    '--json',
  ],
  {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
const result = JSON.parse(raw);
const artifact = result[0]?.filename;
if (!artifact) throw new Error('npm pack did not return a Publisher Runtime artifact.');

const artifactPath = path.join(outputDirectory, artifact);
const bytes = await readFile(artifactPath);
const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim();
const sourceDirty = Boolean(
  execFileSync('git', ['status', '--porcelain'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim(),
);
const metadata = {
  package: packageName,
  version,
  coreApiVersion: 'taku.publisher-core.v1',
  contractVersion: 'taku.publisher-contract.v1',
  artifact,
  artifactBytes: bytes.length,
  artifactSha256,
  sourceCommit,
  sourceDirty,
};
const metadataPath = path.join(
  outputDirectory,
  `taku-publisher-runtime-${version}.metadata.json`,
);
await writeFile(
  `${artifactPath}.sha256`,
  `${artifactSha256}  ${artifact}\n`,
  'utf8',
);
await writeFile(
  metadataPath,
  `${JSON.stringify(metadata, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify({
  ok: true,
  artifact: path.relative(repositoryRoot, artifactPath),
  metadata: path.relative(repositoryRoot, metadataPath),
  bytes: bytes.length,
  sha256: artifactSha256,
  sourceCommit,
  sourceDirty,
}));
