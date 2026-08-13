import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { canonicalizePotentialPath, pathExists, safePackageName } from './fs.js';
import { assertOwnedGitCache, prepareOwnedGitCache } from './git-cache.js';
import { toGitHubUrl } from './repo-source.js';

const execFileAsync = promisify(execFile);

export interface PreparedTemplateSource {
  templateRoot: string;
  sourceKind: 'local' | 'github';
  sourceUrl: string;
  requestedRef: string | null;
  resolvedRef: string | null;
  commit: string | null;
  dirty: boolean | null;
}

export async function prepareTemplateSource(params: {
  input: string;
  ref?: string;
  workRoot: string;
}): Promise<PreparedTemplateSource> {
  const input = params.input.trim();
  if (!input) throw new Error('template input is required');
  if (await pathExists(input)) {
    const templateRoot = await realpath(resolve(input));
    const gitTopLevel = await gitOutput(templateRoot, ['rev-parse', '--show-toplevel']);
    const isRepoRoot = gitTopLevel !== null && resolve(gitTopLevel) === templateRoot;
    const status = isRepoRoot
      ? await gitOutput(templateRoot, ['status', '--porcelain', '--untracked-files=all'])
      : null;
    return {
      templateRoot,
      sourceKind: 'local',
      sourceUrl: `local:${basename(templateRoot)}`,
      requestedRef: null,
      resolvedRef: isRepoRoot
        ? (await gitOutput(templateRoot, ['describe', '--tags', '--exact-match'])) ??
          (await gitOutput(templateRoot, ['branch', '--show-current']))
        : null,
      commit: isRepoRoot ? await gitOutput(templateRoot, ['rev-parse', 'HEAD']) : null,
      dirty: isRepoRoot ? status !== null : null,
    };
  }

  if (!params.ref) {
    throw new Error('Remote template input requires an explicit immutable --template-ref.');
  }
  validateGitRef(params.ref);
  const sourceUrl = toGitHubUrl(input);
  const slug = sourceUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  const boundaryRoot = await canonicalizePotentialPath(params.workRoot);
  const target = join(
    boundaryRoot,
    '.template-source-cache',
    safePackageName(`${slug}-${params.ref}`),
    'repo'
  );
  const commit = await refreshImmutableGitRef({
    url: sourceUrl,
    ref: params.ref,
    target,
    boundaryRoot,
  });
  return {
    templateRoot: target,
    sourceKind: 'github',
    sourceUrl: sourceUrl.replace(/\.git$/, ''),
    requestedRef: params.ref,
    resolvedRef: params.ref,
    commit,
    dirty: false,
  };
}

export async function refreshImmutableGitRef(params: {
  url: string;
  ref: string;
  target: string;
  boundaryRoot: string;
}): Promise<string> {
  validateGitRef(params.ref);
  const cache = await prepareOwnedGitCache({
    target: params.target,
    boundaryRoot: params.boundaryRoot,
    kind: 'template-source',
    url: params.url,
  });
  const target = cache.target;
  if (cache.isNew) {
    await execFileAsync('git', ['clone', '--no-checkout', '--no-tags', params.url, target], {
      maxBuffer: 10 * 1024 * 1024,
    });
  }
  await assertOwnedGitCache({ target, boundaryRoot: params.boundaryRoot, kind: 'template-source', url: params.url });
  const origin = await gitOutput(target, ['remote', 'get-url', 'origin']);
  if (origin !== params.url) throw new Error(`Template cache origin mismatch for ${target}`);

  const tagRef = `refs/tags/${params.ref}`;
  await execFileAsync('git', ['fetch', '--prune', 'origin', `${tagRef}:${tagRef}`], {
    cwd: target,
    maxBuffer: 10 * 1024 * 1024,
  });
  const commit = await gitOutput(target, ['rev-parse', `${tagRef}^{commit}`]);
  if (!commit) throw new Error(`Cannot resolve immutable template ref ${params.ref}`);
  await assertOwnedGitCache({ target, boundaryRoot: params.boundaryRoot, kind: 'template-source', url: params.url });
  await execFileAsync('git', ['reset', '--hard', commit], { cwd: target });
  await assertOwnedGitCache({ target, boundaryRoot: params.boundaryRoot, kind: 'template-source', url: params.url });
  await execFileAsync('git', ['clean', '-ffdx'], { cwd: target });
  return commit;
}

function validateGitRef(ref: string): void {
  if (!ref || ref.startsWith('-') || ref.includes('..') || !/^[A-Za-z0-9._/-]+$/.test(ref)) {
    throw new Error(`Unsafe template Git ref: ${ref}`);
  }
}

async function gitOutput(cwd: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}
