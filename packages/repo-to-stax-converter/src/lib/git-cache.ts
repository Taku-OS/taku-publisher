import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { canonicalizePotentialPath } from './fs.js';

const SENTINEL_NAME = '.taku-converter-cache.json';
const CACHE_OWNER = 'repo-to-stax-converter';

export type GitCacheKind = 'repo-source' | 'template-source';

interface CacheSentinel {
  schemaVersion: 1;
  owner: typeof CACHE_OWNER;
  kind: GitCacheKind;
  url: string;
}

export async function prepareOwnedGitCache(params: {
  target: string;
  boundaryRoot: string;
  kind: GitCacheKind;
  url: string;
}): Promise<{ target: string; isNew: boolean }> {
  const boundaryRoot = await canonicalizePotentialPath(params.boundaryRoot);
  const requestedTarget = resolve(params.target);
  const requestedMetadata = await lstat(requestedTarget).catch(() => null);
  if (requestedMetadata?.isSymbolicLink()) {
    throw new Error(`Refusing symbolic link as Git cache checkout: ${requestedTarget}`);
  }
  const target = await canonicalizePotentialPath(params.target);
  assertNestedInBoundary(boundaryRoot, target);
  if (basename(target) !== 'repo') {
    throw new Error(`Git cache target must use a dedicated repo directory: ${target}`);
  }

  const cacheRoot = dirname(target);
  await mkdir(cacheRoot, { recursive: true });
  await assertNoSymlinkChain(boundaryRoot, cacheRoot);
  await assertRealDirectory(cacheRoot, 'Git cache root');

  const targetMetadata = await lstat(target).catch(() => null);
  if (targetMetadata) {
    await assertOwnedGitCache({ ...params, target });
    return { target, isNew: false };
  }

  const sentinelPath = join(cacheRoot, SENTINEL_NAME);
  const sentinelMetadata = await lstat(sentinelPath).catch(() => null);
  if (sentinelMetadata) {
    await readAndValidateSentinel(sentinelPath, params.kind, params.url);
  } else {
    const entries = await readdir(cacheRoot);
    if (entries.length > 0) {
      throw new Error(`Refusing unowned Git cache without ownership sentinel: ${cacheRoot}`);
    }
    const sentinel: CacheSentinel = {
      schemaVersion: 1,
      owner: CACHE_OWNER,
      kind: params.kind,
      url: params.url,
    };
    await writeFile(sentinelPath, `${JSON.stringify(sentinel, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  }

  return { target, isNew: true };
}

export async function assertOwnedGitCache(params: {
  target: string;
  boundaryRoot: string;
  kind: GitCacheKind;
  url: string;
}): Promise<void> {
  const boundaryRoot = await canonicalizePotentialPath(params.boundaryRoot);
  const target = resolve(params.target);
  const cacheRoot = dirname(target);
  assertNestedInBoundary(boundaryRoot, target);
  await assertNoSymlinkChain(boundaryRoot, cacheRoot);
  await assertRealDirectory(cacheRoot, 'Git cache root');
  await readAndValidateSentinel(join(cacheRoot, SENTINEL_NAME), params.kind, params.url);

  const targetMetadata = await lstat(target).catch(() => null);
  if (!targetMetadata) throw new Error(`Owned Git cache checkout is missing: ${target}`);
  if (targetMetadata.isSymbolicLink()) {
    throw new Error(`Refusing symbolic link as Git cache checkout: ${target}`);
  }
  if (!targetMetadata.isDirectory()) {
    throw new Error(`Git cache checkout is not a directory: ${target}`);
  }

  const gitMetadata = await lstat(join(target, '.git')).catch(() => null);
  if (!gitMetadata?.isDirectory() || gitMetadata.isSymbolicLink()) {
    throw new Error(`Git cache target is not an owned standalone checkout: ${target}`);
  }

  const [realCacheRoot, realTarget] = await Promise.all([realpath(cacheRoot), realpath(target)]);
  if (dirname(realTarget) !== realCacheRoot || basename(realTarget) !== 'repo') {
    throw new Error(`Git cache checkout escapes its owned cache root: ${target}`);
  }

  const entries = await readdir(cacheRoot);
  const unexpected = entries.filter(entry => entry !== SENTINEL_NAME && entry !== 'repo');
  if (unexpected.length > 0) {
    throw new Error(`Owned Git cache contains unexpected entries: ${unexpected.join(', ')}`);
  }
}

function assertNestedInBoundary(boundaryRoot: string, target: string): void {
  const nested = relative(boundaryRoot, target);
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) {
    throw new Error(`Git cache target must stay inside its trusted work root: ${target}`);
  }
}

async function assertNoSymlinkChain(boundaryRoot: string, targetRoot: string): Promise<void> {
  const canonicalBoundary = await realpath(boundaryRoot);
  const lexicalRelative = relative(canonicalBoundary, resolve(targetRoot));
  if (lexicalRelative.startsWith('..') || isAbsolute(lexicalRelative)) {
    throw new Error(`Git cache path escapes its trusted work root: ${targetRoot}`);
  }
  if (!lexicalRelative) {
    await assertRealDirectory(canonicalBoundary, 'Git cache work root');
    return;
  }
  let cursor = canonicalBoundary;
  for (const segment of lexicalRelative.split(/[\\/]/)) {
    cursor = join(cursor, segment);
    const metadata = await lstat(cursor).catch(() => null);
    if (!metadata) throw new Error(`Git cache ancestor is missing: ${cursor}`);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Refusing symbolic link in Git cache ancestor chain: ${cursor}`);
    }
    if (!metadata.isDirectory()) throw new Error(`Git cache ancestor is not a directory: ${cursor}`);
  }
  const canonicalTarget = await realpath(targetRoot);
  const canonicalRelative = relative(canonicalBoundary, canonicalTarget);
  if (canonicalRelative.startsWith('..') || isAbsolute(canonicalRelative)) {
    throw new Error(`Git cache path escapes its trusted work root: ${targetRoot}`);
  }
}

async function assertRealDirectory(path: string, label: string): Promise<void> {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata) throw new Error(`${label} is missing: ${path}`);
  if (metadata.isSymbolicLink()) throw new Error(`Refusing symbolic link as ${label}: ${path}`);
  if (!metadata.isDirectory()) throw new Error(`${label} is not a directory: ${path}`);
}

async function readAndValidateSentinel(
  path: string,
  kind: GitCacheKind,
  url: string
): Promise<void> {
  const metadata = await lstat(path).catch(() => null);
  if (!metadata) throw new Error(`Git cache ownership sentinel is missing: ${path}`);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Git cache ownership sentinel must be a regular file: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(`Git cache ownership sentinel is malformed: ${path}`);
  }
  const sentinel = parsed as Partial<CacheSentinel>;
  if (
    sentinel.schemaVersion !== 1 ||
    sentinel.owner !== CACHE_OWNER ||
    sentinel.kind !== kind ||
    sentinel.url !== url
  ) {
    throw new Error(`Git cache ownership sentinel does not match this checkout: ${path}`);
  }
}
