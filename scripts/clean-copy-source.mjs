import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export function cleanGitEnvironment(env = process.env) {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([name]) => !name.toUpperCase().startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ATTR_NOSYSTEM: '1',
  };
}

function git(repository, ...args) {
  return execFileSync('git', ['--no-replace-objects', '-C', repository, ...args], {
    env: cleanGitEnvironment(), stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function resolveCleanSourceCommit(repository) {
  const commit = git(repository, 'rev-parse', '--verify', 'HEAD^{commit}').toString('utf8').trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Invalid clean source commit.');
  return commit;
}

export async function exportCleanSource(repository, commit, sourceDirectory, archive) {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Invalid clean source commit.');
  const format = git(repository, 'rev-parse', '--show-object-format').toString('utf8').trim();
  if (!['sha1', 'sha256'].includes(format)) throw new Error('Unsupported clean source object format.');
  const records = new TextDecoder('utf-8', { fatal: true }).decode(
    git(repository, 'ls-tree', '-r', '-z', '--full-tree', commit),
  ).split('\0').filter(Boolean);
  const expected = new Map();
  const directories = new Set();
  for (const record of records) {
    const separator = record.indexOf('\t');
    const [mode, type, objectId] = record.slice(0, separator).split(' ');
    const relative = record.slice(separator + 1);
    const segments = relative.split('/');
    const relativeToRoot = path.relative(sourceDirectory, path.resolve(sourceDirectory, relative));
    if (separator < 0 || !['100644', '100755'].includes(mode) || type !== 'blob'
        || !new RegExp(`^[a-f0-9]{${format === 'sha1' ? 40 : 64}}$`).test(objectId)) {
      throw new Error(`Unsupported clean source type: ${relative}`);
    }
    if (segments.some(segment => !segment || ['.', '..', '.git'].includes(segment))
        || relative.includes('\\') || expected.has(relative)
        || path.isAbsolute(relativeToRoot) || relativeToRoot === '..'
        || relativeToRoot.startsWith(`..${path.sep}`)) {
      throw new Error(`Invalid clean source path: ${relative}`);
    }
    expected.set(relative, { mode, objectId });
    for (let index = 1; index < segments.length; index++) directories.add(segments.slice(0, index).join('/'));
  }
  if (!expected.size) throw new Error('Clean source tree is empty.');
  git(repository, 'archive', '--format=tar', '--output', archive, commit);
  execFileSync('tar', ['-xf', archive, '-C', sourceDirectory], {
    env: cleanGitEnvironment(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  const root = await lstat(sourceDirectory);
  if (!root.isDirectory()) throw new Error('Invalid clean source root type.');
  const found = new Set();
  async function verify(directory = '') {
    for (const entry of await readdir(path.join(sourceDirectory, directory), { withFileTypes: true })) {
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!directories.has(relative)) throw new Error(`Unexpected clean source directory: ${relative}`);
        await verify(relative);
        continue;
      }
      const source = expected.get(relative);
      if (!source) throw new Error(`Unexpected clean source file: ${relative}`);
      const filename = path.join(sourceDirectory, relative);
      const stat = await lstat(filename);
      if (!entry.isFile() || !stat.isFile()) throw new Error(`Clean source type mismatch: ${relative}`);
      if (process.platform !== 'win32' && Boolean(stat.mode & 0o111) !== (source.mode === '100755')) {
        throw new Error(`Clean source mode mismatch: ${relative}`);
      }
      const bytes = await readFile(filename);
      const objectId = createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (objectId !== source.objectId) throw new Error(`Clean source byte mismatch: ${relative}`);
      found.add(relative);
    }
  }
  await verify();
  for (const relative of expected.keys()) {
    if (!found.has(relative)) throw new Error(`Clean source file missing: ${relative}`);
  }
}
