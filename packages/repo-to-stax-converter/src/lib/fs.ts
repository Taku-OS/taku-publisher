import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { constants, type BigIntStats } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';

export const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.next-preview',
  '.next-edit',
  'dist',
  'out',
  '.venv',
  'venv',
  '__pycache__',
  '.taku',
  '.turbo',
  '.cache',
]);

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function canonicalizePotentialPath(path: string): Promise<string> {
  let cursor = resolve(path);
  const missingSegments: string[] = [];

  while (true) {
    const metadata = await lstat(cursor).catch(() => null);
    if (metadata) {
      let canonicalAncestor: string;
      try {
        canonicalAncestor = await realpath(cursor);
      } catch {
        throw new Error(`Cannot resolve filesystem path safely: ${cursor}`);
      }
      return resolve(canonicalAncestor, ...missingSegments.reverse());
    }
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error(`Cannot resolve filesystem path safely: ${path}`);
    missingSegments.push(basename(cursor));
    cursor = parent;
  }
}

export async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

export async function readJsonIfExists<T = unknown>(path: string): Promise<T | null> {
  const raw = await readTextIfExists(path);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

export function safePackageName(input: string): string {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/[^a-zA-Z0-9._/-]+/g, '-')
    .replace(/[\/]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || 'stax-converted-app';
}

export async function listFiles(root: string, maxFiles = 400): Promise<string[]> {
  const absRoot = resolve(root);
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (out.length >= maxFiles) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (DEFAULT_IGNORE_DIRS.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      const rel = full.slice(absRoot.length + 1).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        out.push(rel);
      }
    }
  }

  await walk(absRoot);
  return out;
}

export interface CopyLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
}

export interface CopyDirectoryOptions {
  allowExisting?: boolean;
  limits?: Partial<CopyLimits>;
  oversizedFilePolicy?: 'omit-readme-media';
  /** @internal Deterministic race injection; production callers must not set this. */
  testHooks?: {
    afterPreflight?: () => Promise<void> | void;
    beforeDestinationEntry?: (entry: {
      destinationRoot: string;
      relativePath: string;
    }) => Promise<void> | void;
    beforePostflight?: () => Promise<void> | void;
    beforeDestinationCommit?: (entry: { destinationRoot: string }) => Promise<void> | void;
    afterDestinationBackup?: (entry: {
      destinationRoot: string;
      backupRoot: string;
    }) => Promise<void> | void;
  };
}

export interface CopyOmission {
  relativePath: string;
  size: number;
  reason: 'oversized-documentation-media';
}

export interface CopyDirectoryResult {
  omissions: CopyOmission[];
  sourceManifest: SourceCopyManifest;
  sourceManifestDigest: `sha256:${string}`;
}

export interface SourceCopyManifestEntry {
  relativePath: string;
  kind: 'directory' | 'file';
  size: number;
  disposition: 'copied' | 'ignored' | 'omitted-documentation-media';
}

export interface SourceCopyManifest {
  schemaVersion: 'taku.source-copy-manifest.v1';
  entries: SourceCopyManifestEntry[];
}

export const DEFAULT_COPY_LIMITS: Readonly<CopyLimits> = {
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 250 * 1024 * 1024,
  maxFiles: 20_000,
};

export const SOURCE_COPY_MANIFEST_MAX_BYTES = 8 * 1024 * 1024;

function isNestedPath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

const README_MEDIA_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']);

function canOmitOversizedReadmeMedia(relativePath: string): boolean {
  return (
    !relativePath.includes('\0') &&
    !relativePath.includes('\\') &&
    !posix.isAbsolute(relativePath) &&
    posix.normalize(relativePath) === relativePath &&
    relativePath.startsWith('readme-media/') &&
    README_MEDIA_EXTENSIONS.has(extname(relativePath).toLowerCase())
  );
}

export function isDefaultReadmeMediaOmission(value: unknown): value is CopyOmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const omission = value as Record<string, unknown>;
  return (
    typeof omission.relativePath === 'string' &&
    canOmitOversizedReadmeMedia(omission.relativePath) &&
    Number.isSafeInteger(omission.size) &&
    (omission.size as number) > DEFAULT_COPY_LIMITS.maxFileBytes &&
    omission.reason === 'oversized-documentation-media'
  );
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

interface EntryFingerprint {
  dev: string;
  ino: string;
  mode: string;
  nlink: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
}

interface CopyManifestEntry {
  relativePath: string;
  kind: 'directory' | 'file' | 'ignored-directory' | 'ignored-file' | 'omitted-file';
  size: number;
  fingerprint: EntryFingerprint;
}

interface CopySourceSnapshot {
  rootFingerprint: EntryFingerprint;
  entries: CopyManifestEntry[];
  omissions: CopyOmission[];
}

export function computeSourceCopyManifestDigest(
  manifest: SourceCopyManifest
): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}`;
}

function sourceCopyManifest(snapshot: CopySourceSnapshot): SourceCopyManifest {
  return {
    schemaVersion: 'taku.source-copy-manifest.v1',
    entries: snapshot.entries.map(entry => ({
      relativePath: entry.relativePath,
      kind: entry.kind.endsWith('directory') ? 'directory' : 'file',
      size: entry.size,
      disposition:
        entry.kind === 'omitted-file'
          ? 'omitted-documentation-media'
          : entry.kind.startsWith('ignored-')
            ? 'ignored'
            : 'copied',
    })),
  };
}

function fingerprint(metadata: BigIntStats): EntryFingerprint {
  return {
    dev: metadata.dev.toString(),
    ino: metadata.ino.toString(),
    mode: metadata.mode.toString(),
    nlink: metadata.nlink.toString(),
    size: metadata.size.toString(),
    mtimeNs: metadata.mtimeNs.toString(),
    ctimeNs: metadata.ctimeNs.toString(),
  };
}

function fingerprintsEqual(left: EntryFingerprint, right: EntryFingerprint): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function scanSafeCopySource(
  sourceRoot: string,
  limits: CopyLimits,
  oversizedFilePolicy?: CopyDirectoryOptions['oversizedFilePolicy'],
  ignoreDefaultDirectories = true
): Promise<CopySourceSnapshot> {
  let entries = 0;
  let totalBytes = 0;
  const omissions: CopyOmission[] = [];
  const manifestEntries: CopyManifestEntry[] = [];
  const rootMetadata = await lstat(sourceRoot, { bigint: true });
  if (!rootMetadata.isDirectory()) {
    throw new Error(`Copy source directory not found: ${sourceRoot}`);
  }

  async function walk(dir: string): Promise<void> {
    const directoryEntries = await readdir(dir, { withFileTypes: true });
    directoryEntries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of directoryEntries) {
      const full = join(dir, entry.name);
      const rel = relative(sourceRoot, full).replace(/\\/g, '/');
      if (/\p{Cc}/u.test(entry.name) || entry.name.includes('\\')) {
        throw new Error(`Unsafe source entry name during preflight: ${rel}`);
      }
      entries += 1;
      if (entries > limits.maxFiles) {
        throw new Error(`Copy entry count limit exceeded at ${rel}`);
      }
      const metadata = await lstat(full, { bigint: true });
      if (metadata.isSymbolicLink()) {
        throw new Error(`Refusing symbolic link in copy source: ${rel}`);
      }
      if (
        (entry.isDirectory() && !metadata.isDirectory()) ||
        (entry.isFile() && !metadata.isFile())
      ) {
        throw new Error(`Copy source changed during preflight: ${rel}`);
      }
      if (!metadata.isDirectory() && !metadata.isFile()) {
        throw new Error(`Refusing unsupported filesystem entry: ${rel}`);
      }
      if (entry.name === '.git') {
        if (rel !== '.git') throw new Error(`Refusing submodule or nested Git metadata: ${rel}`);
        manifestEntries.push({
          relativePath: rel,
          kind: metadata.isDirectory() ? 'ignored-directory' : 'ignored-file',
          size: metadata.isFile() ? Number(metadata.size) : 0,
          fingerprint: fingerprint(metadata),
        });
        continue;
      }
      if (entry.isDirectory()) {
        const ignored = ignoreDefaultDirectories && DEFAULT_IGNORE_DIRS.has(entry.name);
        manifestEntries.push({
          relativePath: rel,
          kind: ignored ? 'ignored-directory' : 'directory',
          size: 0,
          fingerprint: fingerprint(metadata),
        });
        if (!ignored) await walk(full);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Refusing unsupported filesystem entry: ${rel}`);
      if (metadata.size > limits.maxFileBytes) {
        if (
          oversizedFilePolicy === 'omit-readme-media' &&
          canOmitOversizedReadmeMedia(rel)
        ) {
          omissions.push({
            relativePath: rel,
            size: Number(metadata.size),
            reason: 'oversized-documentation-media',
          });
          manifestEntries.push({
            relativePath: rel,
            kind: 'omitted-file',
            size: Number(metadata.size),
            fingerprint: fingerprint(metadata),
          });
          continue;
        }
        throw new Error(`Copy file size limit exceeded by ${rel}`);
      }
      totalBytes += Number(metadata.size);
      if (totalBytes > limits.maxTotalBytes) {
        throw new Error(`Copy total size limit exceeded at ${rel}`);
      }
      manifestEntries.push({
        relativePath: rel,
        kind: 'file',
        size: Number(metadata.size),
        fingerprint: fingerprint(metadata),
      });
    }
  }

  await walk(sourceRoot);
  manifestEntries.sort((left, right) => compareText(left.relativePath, right.relativePath));
  omissions.sort((left, right) => compareText(left.relativePath, right.relativePath));
  return { rootFingerprint: fingerprint(rootMetadata), entries: manifestEntries, omissions };
}

async function verifySourceEntry(
  sourceRoot: string,
  entry: CopyManifestEntry,
  phase: 'after preflight' | 'before postflight'
): Promise<void> {
  const metadata = await lstat(join(sourceRoot, entry.relativePath), { bigint: true }).catch(() => null);
  if (!metadata || !fingerprintsEqual(fingerprint(metadata), entry.fingerprint)) {
    throw new Error(`Copy source changed ${phase}: ${entry.relativePath}`);
  }
  const expectedType = entry.kind.endsWith('directory') ? 'directory' : 'file';
  if (
    (expectedType === 'directory' && !metadata.isDirectory()) ||
    (expectedType === 'file' && !metadata.isFile())
  ) {
    throw new Error(`Copy source changed ${phase}: ${entry.relativePath}`);
  }
}

async function verifySourceRoot(
  sourceRoot: string,
  snapshot: CopySourceSnapshot,
  phase: 'after preflight' | 'before postflight'
): Promise<void> {
  const metadata = await lstat(sourceRoot, { bigint: true }).catch(() => null);
  if (
    !metadata ||
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !fingerprintsEqual(fingerprint(metadata), snapshot.rootFingerprint)
  ) {
    throw new Error(`Copy source changed ${phase}: <source-root>`);
  }
}

interface DirectoryIdentity {
  path: string;
  fingerprint: EntryFingerprint;
}

function sameFilesystemIdentity(left: EntryFingerprint, right: EntryFingerprint): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

async function captureSafeDirectoryChain(path: string): Promise<DirectoryIdentity[]> {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const suffix = relative(root, absolutePath);
  const segments = suffix ? suffix.split(sep) : [];
  const chain: DirectoryIdentity[] = [];
  let cursor = root;

  for (const segment of ['', ...segments]) {
    if (segment) cursor = join(cursor, segment);
    const metadata = await lstat(cursor, { bigint: true }).catch(() => null);
    if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`Copy destination directory is unsafe: ${cursor}`);
    }
    const resolved = await realpath(cursor).catch(() => null);
    if (!resolved || resolve(resolved) !== resolve(cursor)) {
      throw new Error(`Copy destination directory contains a symbolic link: ${cursor}`);
    }
    chain.push({ path: cursor, fingerprint: fingerprint(metadata) });
  }
  return chain;
}

async function assertDirectoryChainUnchanged(chain: DirectoryIdentity[]): Promise<void> {
  for (const expected of chain) {
    const metadata = await lstat(expected.path, { bigint: true }).catch(() => null);
    if (
      !metadata ||
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      !sameFilesystemIdentity(fingerprint(metadata), expected.fingerprint)
    ) {
      throw new Error(`Copy destination directory changed: ${expected.path}`);
    }
    const resolved = await realpath(expected.path).catch(() => null);
    if (!resolved || resolve(resolved) !== resolve(expected.path)) {
      throw new Error(`Copy destination directory changed through a symbolic link: ${expected.path}`);
    }
  }
}

async function ensureSafeDirectoryPath(path: string): Promise<DirectoryIdentity[]> {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const suffix = relative(root, absolutePath);
  const segments = suffix ? suffix.split(sep) : [];
  let cursor = root;
  let chain = await captureSafeDirectoryChain(root);

  for (const segment of segments) {
    const next = join(cursor, segment);
    await assertDirectoryChainUnchanged(chain);
    const existing = await lstat(next, { bigint: true }).catch(() => null);
    if (!existing) {
      await mkdir(next);
    } else if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error(`Copy destination directory is unsafe: ${next}`);
    }
    await assertDirectoryChainUnchanged(chain);
    chain = await captureSafeDirectoryChain(next);
    cursor = next;
  }
  return chain;
}

async function ensureDestinationDirectory(path: string): Promise<void> {
  const parentChain = await captureSafeDirectoryChain(dirname(path));
  await assertDirectoryChainUnchanged(parentChain);
  const metadata = await lstat(path, { bigint: true }).catch(() => null);
  if (!metadata) {
    await mkdir(path);
  } else if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Copy destination directory is unsafe: ${path}`);
  }
  await assertDirectoryChainUnchanged(parentChain);
  await captureSafeDirectoryChain(path);
}

async function copyValidatedFile(params: {
  sourceRoot: string;
  destRoot: string;
  entry: CopyManifestEntry;
  allowExisting: boolean;
}): Promise<void> {
  const sourcePath = join(params.sourceRoot, params.entry.relativePath);
  const destinationPath = join(params.destRoot, params.entry.relativePath);
  const sourceHandle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let destinationHandle: Awaited<ReturnType<typeof open>> | null = null;
  let temporaryPath: string | null = null;
  try {
    const sourceBefore = await sourceHandle.stat({ bigint: true });
    if (
      !sourceBefore.isFile() ||
      !fingerprintsEqual(fingerprint(sourceBefore), params.entry.fingerprint)
    ) {
      throw new Error(`Copy source changed after preflight: ${params.entry.relativePath}`);
    }

    const parentChain = await captureSafeDirectoryChain(dirname(destinationPath));
    await assertDirectoryChainUnchanged(parentChain);
    const destinationMetadata = await lstat(destinationPath, { bigint: true }).catch(() => null);
    if (destinationMetadata?.isSymbolicLink() || destinationMetadata?.isDirectory()) {
      throw new Error(`Copy destination file is unsafe: ${params.entry.relativePath}`);
    }
    if (destinationMetadata && !params.allowExisting) {
      throw new Error(`Copy destination already exists: ${destinationPath}`);
    }
    if (destinationMetadata && (!destinationMetadata.isFile() || destinationMetadata.nlink > 1n)) {
      throw new Error(`Copy destination hardlink or unsupported file is unsafe: ${params.entry.relativePath}`);
    }
    const destinationFingerprint = destinationMetadata ? fingerprint(destinationMetadata) : null;
    temporaryPath = params.allowExisting
      ? join(dirname(destinationPath), `.${basename(destinationPath)}.taku-write-${randomUUID()}`)
      : destinationPath;
    destinationHandle = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      Number(sourceBefore.mode & 0o777n)
    );
    await assertDirectoryChainUnchanged(parentChain);

    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      if (position > params.entry.size) {
        throw new Error(`Copy source changed during copy: ${params.entry.relativePath}`);
      }
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(
          buffer,
          written,
          bytesRead - written,
          position - bytesRead + written
        );
        written += result.bytesWritten;
      }
    }
    if (position !== params.entry.size) {
      throw new Error(`Copy source changed during copy: ${params.entry.relativePath}`);
    }
    await destinationHandle.chmod(Number(sourceBefore.mode & 0o777n));
    const sourceAfter = await sourceHandle.stat({ bigint: true });
    if (!fingerprintsEqual(fingerprint(sourceAfter), params.entry.fingerprint)) {
      throw new Error(`Copy source changed during copy: ${params.entry.relativePath}`);
    }
    const destinationAfter = await destinationHandle.stat({ bigint: true });
    if (
      !destinationAfter.isFile() ||
      destinationAfter.nlink !== 1n ||
      Number(destinationAfter.size) !== params.entry.size
    ) {
      throw new Error(`Copy destination verification failed: ${params.entry.relativePath}`);
    }
    const writtenIdentity = fingerprint(destinationAfter);
    await destinationHandle.close();
    destinationHandle = null;
    await assertDirectoryChainUnchanged(parentChain);

    if (params.allowExisting) {
      const currentDestination = await lstat(destinationPath, { bigint: true }).catch(() => null);
      if (
        (destinationFingerprint === null && currentDestination !== null) ||
        (destinationFingerprint !== null &&
          (!currentDestination ||
            !fingerprintsEqual(fingerprint(currentDestination), destinationFingerprint)))
      ) {
        throw new Error(`Copy destination changed before replacement: ${params.entry.relativePath}`);
      }
      await rename(temporaryPath, destinationPath);
      temporaryPath = null;
      await assertDirectoryChainUnchanged(parentChain);
      const installed = await lstat(destinationPath, { bigint: true }).catch(() => null);
      if (
        !installed?.isFile() ||
        installed.isSymbolicLink() ||
        installed.nlink !== 1n ||
        !sameFilesystemIdentity(fingerprint(installed), writtenIdentity)
      ) {
        throw new Error(`Copy destination verification failed: ${params.entry.relativePath}`);
      }
    } else {
      const installed = await lstat(destinationPath, { bigint: true }).catch(() => null);
      if (
        !installed?.isFile() ||
        installed.isSymbolicLink() ||
        installed.nlink !== 1n ||
        !sameFilesystemIdentity(fingerprint(installed), writtenIdentity)
      ) {
        throw new Error(`Copy destination verification failed: ${params.entry.relativePath}`);
      }
    }
  } finally {
    await destinationHandle?.close().catch(() => undefined);
    if (temporaryPath && temporaryPath !== destinationPath) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    await sourceHandle.close().catch(() => undefined);
  }
}

async function copySnapshotIntoDestination(params: {
  sourceRoot: string;
  destRoot: string;
  snapshot: CopySourceSnapshot;
  allowExisting: boolean;
  testHooks?: CopyDirectoryOptions['testHooks'];
}): Promise<void> {
  for (const entry of params.snapshot.entries) {
    await verifySourceEntry(params.sourceRoot, entry, 'after preflight');
    if (
      entry.kind === 'ignored-directory' ||
      entry.kind === 'ignored-file' ||
      entry.kind === 'omitted-file'
    ) {
      continue;
    }
    await params.testHooks?.beforeDestinationEntry?.({
      destinationRoot: params.destRoot,
      relativePath: entry.relativePath,
    });
    const destinationPath = join(params.destRoot, entry.relativePath);
    if (entry.kind === 'directory') {
      await ensureDestinationDirectory(destinationPath);
      continue;
    }
    await copyValidatedFile({
      sourceRoot: params.sourceRoot,
      destRoot: params.destRoot,
      entry,
      allowExisting: params.allowExisting,
    });
  }
}

function assertSnapshotHasNoHardlinks(snapshot: CopySourceSnapshot): void {
  const hardlink = snapshot.entries.find(
    entry =>
      (entry.kind === 'file' || entry.kind === 'ignored-file') &&
      BigInt(entry.fingerprint.nlink) > 1n
  );
  if (hardlink) {
    throw new Error(`Copy destination contains a hardlink: ${hardlink.relativePath}`);
  }
}

async function removeOwnedTransaction(path: string, identity: EntryFingerprint): Promise<void> {
  const metadata = await lstat(path, { bigint: true }).catch(() => null);
  if (!metadata) return;
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    !sameFilesystemIdentity(fingerprint(metadata), identity)
  ) {
    throw new Error(`Refusing to clean changed copy transaction directory: ${path}`);
  }
  await rm(path, { recursive: true, force: true });
}

async function assertSnapshotUnchanged(
  sourceRoot: string,
  expected: CopySourceSnapshot,
  limits: CopyLimits,
  oversizedFilePolicy?: CopyDirectoryOptions['oversizedFilePolicy'],
  ignoreDefaultDirectories = true
): Promise<void> {
  let actual: CopySourceSnapshot;
  try {
    actual = await scanSafeCopySource(
      sourceRoot,
      limits,
      oversizedFilePolicy,
      ignoreDefaultDirectories
    );
  } catch {
    throw new Error('Copy source changed before postflight: source tree no longer passes policy');
  }
  if (
    !fingerprintsEqual(actual.rootFingerprint, expected.rootFingerprint) ||
    JSON.stringify(actual.entries) !== JSON.stringify(expected.entries) ||
    JSON.stringify(actual.omissions) !== JSON.stringify(expected.omissions)
  ) {
    const expectedPaths = new Map(expected.entries.map(entry => [entry.relativePath, entry]));
    const changedPath =
      actual.entries.find(
        entry => JSON.stringify(entry) !== JSON.stringify(expectedPaths.get(entry.relativePath))
      )?.relativePath ??
      expected.entries.find(
        entry => !actual.entries.some(candidate => candidate.relativePath === entry.relativePath)
      )?.relativePath ??
      '<source-root>';
    throw new Error(`Copy source changed before postflight: ${changedPath}`);
  }
}

export async function copyDirectory(
  src: string,
  dest: string,
  options: CopyDirectoryOptions = {}
): Promise<CopyDirectoryResult> {
  const sourceRoot = await realpath(resolve(src));
  const destRoot = resolve(dest);
  if (isNestedPath(sourceRoot, destRoot)) {
    throw new Error(`Copy destination is nested inside source: ${destRoot}`);
  }
  if (isNestedPath(destRoot, sourceRoot) && !options.allowExisting) {
    throw new Error(`Copy source is nested inside destination: ${sourceRoot}`);
  }
  const sourceMetadata = await stat(sourceRoot).catch(() => null);
  if (!sourceMetadata?.isDirectory()) throw new Error(`Copy source directory not found: ${sourceRoot}`);
  const initialDestination = await lstat(destRoot, { bigint: true }).catch(() => null);
  if (initialDestination?.isSymbolicLink()) {
    throw new Error(`Copy destination is unsafe: ${destRoot}`);
  }
  if (initialDestination && !options.allowExisting) {
    throw new Error(`Copy destination already exists: ${destRoot}`);
  }
  if (options.allowExisting && (!initialDestination || !initialDestination.isDirectory())) {
    throw new Error(`Copy destination directory is unsafe: ${destRoot}`);
  }
  const limits = { ...DEFAULT_COPY_LIMITS, ...(options.limits ?? {}) };
  const snapshot = await scanSafeCopySource(sourceRoot, limits, options.oversizedFilePolicy);
  await options.testHooks?.afterPreflight?.();
  const destinationParentChain = await ensureSafeDirectoryPath(dirname(destRoot));
  await assertDirectoryChainUnchanged(destinationParentChain);

  let destinationSnapshot: CopySourceSnapshot | null = null;
  if (options.allowExisting) {
    destinationSnapshot = await scanSafeCopySource(
      destRoot,
      { ...DEFAULT_COPY_LIMITS },
      undefined,
      false
    );
    if (destinationSnapshot.entries.some(entry => entry.kind.startsWith('ignored-'))) {
      throw new Error('Copy destination contains unsupported Git metadata');
    }
    assertSnapshotHasNoHardlinks(destinationSnapshot);
  }

  const transactionRoot = await mkdtemp(
    join(dirname(destRoot), `.${basename(destRoot)}.taku-copy-`)
  );
  const transactionMetadata = await lstat(transactionRoot, { bigint: true });
  const transactionIdentity = fingerprint(transactionMetadata);
  const candidateRoot = join(transactionRoot, 'candidate');
  const backupRoot = join(transactionRoot, 'original');
  const failedInstallRoot = join(transactionRoot, 'failed-install');
  let committed = false;
  let primaryError: unknown;
  let preserveTransactionForRecovery = false;

  try {
    await assertDirectoryChainUnchanged(destinationParentChain);
    if (options.allowExisting) {
      await verifySourceRoot(destRoot, destinationSnapshot as CopySourceSnapshot, 'after preflight');
      await mkdir(candidateRoot);
      await copySnapshotIntoDestination({
        sourceRoot: destRoot,
        destRoot: candidateRoot,
        snapshot: destinationSnapshot as CopySourceSnapshot,
        allowExisting: false,
      });
    } else {
      await mkdir(candidateRoot);
    }
    await verifySourceRoot(sourceRoot, snapshot, 'after preflight');
    await copySnapshotIntoDestination({
      sourceRoot,
      destRoot: candidateRoot,
      snapshot,
      allowExisting: options.allowExisting === true,
      testHooks: options.testHooks,
    });

    await options.testHooks?.beforePostflight?.();
    await assertSnapshotUnchanged(sourceRoot, snapshot, limits, options.oversizedFilePolicy);
    if (destinationSnapshot) {
      await assertSnapshotUnchanged(
        destRoot,
        destinationSnapshot,
        { ...DEFAULT_COPY_LIMITS },
        undefined,
        false
      );
    }
    await options.testHooks?.beforeDestinationCommit?.({ destinationRoot: candidateRoot });
    await assertDirectoryChainUnchanged(destinationParentChain);
    await captureSafeDirectoryChain(candidateRoot);
    const candidateMetadata = await lstat(candidateRoot, { bigint: true });
    const candidateIdentity = fingerprint(candidateMetadata);

    if (options.allowExisting) {
      await rename(destRoot, backupRoot);
      try {
        await options.testHooks?.afterDestinationBackup?.({
          destinationRoot: destRoot,
          backupRoot,
        });
        await rename(candidateRoot, destRoot);
        const installed = await lstat(destRoot, { bigint: true }).catch(() => null);
        if (
          !installed?.isDirectory() ||
          installed.isSymbolicLink() ||
          !sameFilesystemIdentity(fingerprint(installed), candidateIdentity)
        ) {
          throw new Error(`Copy destination verification failed after commit: ${destRoot}`);
        }
        await assertDirectoryChainUnchanged(destinationParentChain);
      } catch (error) {
        try {
          if (await lstat(destRoot).catch(() => null)) {
            await rename(destRoot, failedInstallRoot);
          }
          await rename(backupRoot, destRoot);
        } catch (rollbackError) {
          preserveTransactionForRecovery = true;
          throw new AggregateError(
            [error, rollbackError],
            `Copy installation and rollback failed; the original remains recoverable at ${backupRoot}.`,
            { cause: error }
          );
        }
        throw error;
      }
    } else {
      const destinationBeforeCommit = await lstat(destRoot).catch(() => null);
      if (destinationBeforeCommit) {
        throw new Error(`Copy destination appeared before commit: ${destRoot}`);
      }
      await rename(candidateRoot, destRoot);
      const installed = await lstat(destRoot, { bigint: true }).catch(() => null);
      if (
        !installed?.isDirectory() ||
        installed.isSymbolicLink() ||
        !sameFilesystemIdentity(fingerprint(installed), candidateIdentity)
      ) {
        await rename(destRoot, candidateRoot).catch(() => undefined);
        throw new Error(`Copy destination verification failed after commit: ${destRoot}`);
      }
      await assertDirectoryChainUnchanged(destinationParentChain);
    }
    committed = true;

    const manifest = sourceCopyManifest(snapshot);
    return {
      omissions: snapshot.omissions,
      sourceManifest: manifest,
      sourceManifestDigest: computeSourceCopyManifestDigest(manifest),
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (!preserveTransactionForRecovery) {
      try {
        await removeOwnedTransaction(transactionRoot, transactionIdentity);
      } catch (cleanupError) {
        if (primaryError !== undefined) {
          throw new AggregateError(
            [primaryError, cleanupError],
            'Copy failed and its transaction directory could not be cleaned safely.',
            { cause: primaryError }
          );
        }
        if (!committed) throw cleanupError;
      }
    }
  }
}
