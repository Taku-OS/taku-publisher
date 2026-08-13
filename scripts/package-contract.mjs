import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot } from './repository-files.mjs';

const outputDirectory = path.join(repositoryRoot, 'dist', 'packages');
const contractPackagePath = path.join(
  repositoryRoot,
  'packages',
  'capability-contract',
  'package.json',
);
const contractPackage = JSON.parse(
  await readFile(contractPackagePath, 'utf8'),
);
const contractVersion = String(contractPackage.version || '');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(contractVersion)) {
  throw new Error('Capability contract package has an invalid version.');
}
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const raw = execFileSync(
  'npm',
  [
    'pack',
    '--workspace',
    '@taku/capability-contract',
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
const filename = result[0]?.filename;
if (!filename) throw new Error('npm pack did not return an artifact filename.');

const artifactPath = path.join(outputDirectory, filename);
const bytes = await readFile(artifactPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const checksumPath = `${artifactPath}.sha256`;
await writeFile(checksumPath, `${sha256}  ${filename}\n`, 'utf8');
const schemaFiles = [
  'capability-snapshot.v1.schema.json',
  'capability-package.v1.schema.json',
];
const schemaSha256 = {};
for (const schemaFile of schemaFiles) {
  const schemaBytes = await readFile(
    path.join(
      repositoryRoot,
      'packages',
      'capability-contract',
      'schemas',
      schemaFile,
    ),
  );
  schemaSha256[schemaFile] = createHash('sha256')
    .update(schemaBytes)
    .digest('hex');
}
const fixturePath = path.join(
  repositoryRoot,
  'packages',
  'capability-contract',
  'fixtures',
  'canonical-v1.json',
);
const fixtureSha256 = createHash('sha256')
  .update(await readFile(fixturePath))
  .digest('hex');
const sourceCommit =
  cleanSourceCommit(process.env.TAKU_CONTRACT_SOURCE_COMMIT) ||
  execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
const sourceDirty =
  process.env.TAKU_CONTRACT_SOURCE_DIRTY === 'false'
    ? false
    : Boolean(
        execFileSync('git', ['status', '--porcelain'], {
          cwd: repositoryRoot,
          encoding: 'utf8',
        }).trim(),
      );
const metadataPath = path.join(
  outputDirectory,
  `taku-capability-contract-${contractVersion}.metadata.json`,
);
const metadata = {
  package: '@taku/capability-contract',
  version: contractVersion,
  artifact: filename,
  artifactBytes: bytes.length,
  artifactSha256: sha256,
  schemaSha256,
  fixtureSha256,
  sourceCommit,
  sourceDirty,
};
await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

console.log(
  JSON.stringify({
    ok: true,
    artifact: path.relative(repositoryRoot, artifactPath),
    bytes: bytes.length,
    sha256,
    checksum: path.relative(repositoryRoot, checksumPath),
    metadata: path.relative(repositoryRoot, metadataPath),
    schemaSha256,
    fixtureSha256,
    sourceCommit,
    sourceDirty,
  }),
);

function cleanSourceCommit(value) {
  const commit = String(value || '').trim();
  return /^[a-f0-9]{40}$/.test(commit) ? commit : '';
}
