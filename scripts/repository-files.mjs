import { execFileSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

const EXCLUDED_SEGMENTS = new Set([
  '.git',
  '.next',
  '.open-next',
  '.pytest_cache',
  '.venv',
  '__pycache__',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'venv',
]);
// Scoped generated workspaces ignored by the repository's .gitignore files.
// Keep source fixtures such as tests/fixtures/tmp in the exported audit.
const EXCLUDED_EXPORT_PATHS = new Set(['.superpowers', 'tmp', 'packages/repo-to-stax-converter/tmp']);

async function walk(relativeDirectory = '') {
  const directory = path.join(repositoryRoot, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (EXCLUDED_SEGMENTS.has(entry.name) || entry.name.startsWith('.converter-build-')) continue;
    const relativePath = path.posix.join(
      relativeDirectory.split(path.sep).join(path.posix.sep),
      entry.name,
    );
    if (EXCLUDED_EXPORT_PATHS.has(relativePath)) continue;
    if (entry.isDirectory()) {
      files.push(...(await walk(relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

export async function listRepositoryFiles() {
  try {
    const output = execFileSync(
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const candidates = [...new Set(output.split('\0').filter(Boolean))];
    const files = [];
    for (const relativePath of candidates) {
      if ([...EXCLUDED_EXPORT_PATHS].some(root => relativePath === root || relativePath.startsWith(`${root}/`))) continue;
      if (relativePath.split('/').some((part) => part.startsWith('.converter-build-'))) continue;
      try {
        if ((await stat(path.join(repositoryRoot, relativePath))).isFile()) {
          files.push(relativePath);
        }
      } catch {
        // Deleted tracked files are intentionally absent from the audited tree.
      }
    }
    if (files.length > 0) return files.sort();
  } catch {
    // A clean exported source tree intentionally has no .git directory.
  }
  return (await walk()).sort();
}
