import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BUILD_MANIFEST_NAME = '.source-digest.json';
const BUILD_MANIFEST_SCHEMA = 'repo-to-stax.source-digest.v1';
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.next',
  '.next-edit',
  '.next-preview',
  'dist',
  'out',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
]);

export async function buildConverter({ projectRoot, runCompiler }) {
  const sourceRoot = join(projectRoot, 'src');
  const temporaryBuildRoot = await mkdtemp(join(projectRoot, '.converter-build-'));
  const snapshotSource = join(temporaryBuildRoot, 'src');
  const temporaryDist = join(temporaryBuildRoot, 'dist');
  const snapshotTsconfig = join(temporaryBuildRoot, 'tsconfig.json');

  try {
    await copySourceSnapshot(sourceRoot, snapshotSource);
    const snapshotDigest = await computeSourceTreeDigest(snapshotSource);
    const sourceDigestAfterSnapshot = await computeSourceTreeDigest(sourceRoot);
    if (sourceDigestAfterSnapshot !== snapshotDigest) {
      throw new Error('Converter source tree changed while creating the build snapshot.');
    }

    await mkdir(temporaryDist);
    await writeFile(
      snapshotTsconfig,
      `${JSON.stringify(
        {
          extends: resolve(projectRoot, 'tsconfig.json'),
          compilerOptions: { rootDir: './src', outDir: './dist' },
          include: ['src/**/*.ts'],
        },
        null,
        2
      )}\n`
    );

    const exitCode = await runCompiler({ temporaryDist, snapshotSource, snapshotTsconfig });
    if (exitCode !== 0) {
      throw new Error(`TypeScript compiler failed with exit code ${exitCode}.`);
    }

    const snapshotDigestAfter = await computeSourceTreeDigest(snapshotSource);
    if (snapshotDigestAfter !== snapshotDigest) {
      throw new Error('Converter build snapshot changed during compilation; build was not published.');
    }
    const currentSourceDigest = await computeSourceTreeDigest(sourceRoot);
    if (currentSourceDigest !== snapshotDigest) {
      throw new Error('Converter source tree changed during compilation; build was not published.');
    }

    await writeFile(
      join(temporaryDist, BUILD_MANIFEST_NAME),
      `${JSON.stringify(
        { schemaVersion: BUILD_MANIFEST_SCHEMA, sourceDigest: snapshotDigest },
        null,
        2
      )}\n`
    );
    await publishTemporaryDist(projectRoot, temporaryDist);
  } finally {
    await rm(temporaryBuildRoot, { recursive: true, force: true });
  }
}

async function copySourceSnapshot(sourceRoot, snapshotRoot) {
  await mkdir(snapshotRoot);

  async function walk(relativeRoot) {
    const sourceDirectory = join(sourceRoot, relativeRoot);
    const snapshotDirectory = join(snapshotRoot, relativeRoot);
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = join(relativeRoot, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing symlink while snapshotting source tree: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await mkdir(join(snapshotDirectory, entry.name));
        await walk(relativePath);
        continue;
      }
      const metadata = await lstat(join(sourceRoot, relativePath));
      if (!metadata.isFile()) {
        throw new Error(`Unsupported entry while snapshotting source tree: ${relativePath}`);
      }
      await copyFile(join(sourceRoot, relativePath), join(snapshotRoot, relativePath));
    }
  }

  await walk('');
}

async function publishTemporaryDist(projectRoot, temporaryDist) {
  const distRoot = join(projectRoot, 'dist');
  const backupRoot = join(projectRoot, `.dist-backup-${randomUUID()}`);
  let hadExistingDist = false;

  try {
    const metadata = await lstat(distRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('Refusing to replace a non-directory or symbolic dist path.');
    }
    hadExistingDist = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (hadExistingDist) await rename(distRoot, backupRoot);
  try {
    await rename(temporaryDist, distRoot);
  } catch (error) {
    if (hadExistingDist) await rename(backupRoot, distRoot);
    throw error;
  }
  if (hadExistingDist) await rm(backupRoot, { recursive: true });
}

async function computeSourceTreeDigest(root) {
  const hash = createHash('sha256');

  async function walk(relativeRoot) {
    const entries = await readdir(join(root, relativeRoot), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = join(relativeRoot, entry.name).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) {
        throw new Error(`Refusing symlink while hashing source tree: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(relativePath);
        continue;
      }
      const metadata = await lstat(join(root, relativePath));
      if (!metadata.isFile()) {
        throw new Error(`Unsupported entry while hashing source tree: ${relativePath}`);
      }
      const content = await readFile(join(root, relativePath));
      hash.update(relativePath);
      hash.update('\0');
      hash.update(String(metadata.size));
      hash.update('\0');
      hash.update(content);
      hash.update('\0');
    }
  }

  await walk('');
  return `sha256:${hash.digest('hex')}`;
}
