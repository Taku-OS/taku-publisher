import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { isAbsolute, join, normalize, posix, resolve } from 'node:path';
import { promisify } from 'node:util';
import { copyDirectory, pathExists, readJsonIfExists, writeJson } from './fs.js';

const execFileAsync = promisify(execFile);
const POLICY_FILE = '.taku-template.json';

interface TemplatePayloadPolicy {
  schemaVersion: 1;
  exclude: string[];
  overlayDirectory?: string;
  cleanup?: string[];
  packageJson?: { removeScripts: string[] };
}

export interface TemplateSnapshot {
  root: string;
  commit: string | null;
  ref: string | null;
  version: string | null;
  policyApplied: boolean;
  dirty: boolean | null;
}

export async function copySubAppTemplate(params: {
  templateRoot: string;
  workspaceRoot: string;
}): Promise<TemplateSnapshot> {
  if (!(await pathExists(params.templateRoot))) {
    throw new Error(`Template root not found: ${params.templateRoot}`);
  }
  if (await pathExists(params.workspaceRoot)) {
    throw new Error(`Template output already exists: ${params.workspaceRoot}`);
  }
  const policy = await readPolicy(params.templateRoot);
  await copyDirectory(params.templateRoot, params.workspaceRoot);
  if (policy) await applyPolicy(params.workspaceRoot, policy);

  const packageJson = await readJsonIfExists<{ version?: string }>(join(params.workspaceRoot, 'package.json'));
  const templateRoot = resolve(params.templateRoot);
  const gitTopLevel = await gitOutput(templateRoot, ['rev-parse', '--show-toplevel']);
  const isRepoRoot = gitTopLevel !== null && resolve(gitTopLevel) === templateRoot;
  const commit = isRepoRoot ? await gitOutput(templateRoot, ['rev-parse', 'HEAD']) : null;
  const ref = isRepoRoot
    ? (await gitOutput(templateRoot, ['describe', '--tags', '--exact-match'])) ??
      (await gitOutput(templateRoot, ['branch', '--show-current']))
    : null;
  const status = isRepoRoot
    ? await gitOutput(templateRoot, ['status', '--porcelain', '--untracked-files=all'])
    : null;
  return {
    root: templateRoot,
    commit,
    ref,
    version: packageJson?.version ?? null,
    policyApplied: policy !== null,
    dirty: isRepoRoot ? status !== null : null,
  };
}

async function readPolicy(templateRoot: string): Promise<TemplatePayloadPolicy | null> {
  const policyPath = join(templateRoot, POLICY_FILE);
  if (!(await pathExists(policyPath))) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(policyPath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid ${POLICY_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${POLICY_FILE} must be an object`);
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== 1) throw new Error(`${POLICY_FILE} schemaVersion must be 1`);
  const exclude = parsePaths(record.exclude, 'exclude', true);
  const cleanup = parsePaths(record.cleanup, 'cleanup', false);
  const overlayDirectory =
    record.overlayDirectory === undefined
      ? undefined
      : normalizePolicyPath(record.overlayDirectory, 'overlayDirectory');
  let packageJson: TemplatePayloadPolicy['packageJson'];
  if (record.packageJson !== undefined) {
    if (!record.packageJson || typeof record.packageJson !== 'object' || Array.isArray(record.packageJson)) {
      throw new Error('packageJson must be an object');
    }
    const scripts = (record.packageJson as Record<string, unknown>).removeScripts;
    if (!Array.isArray(scripts) || scripts.some(value => typeof value !== 'string' || !value.trim())) {
      throw new Error('packageJson.removeScripts must be an array of names');
    }
    packageJson = { removeScripts: scripts.map(value => String(value).trim()) };
  }
  return { schemaVersion: 1, exclude, cleanup, overlayDirectory, packageJson };
}

function parsePaths(value: unknown, label: string, required: boolean): string[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (value.length > 128) throw new Error(`${label} exceeds the 128-path limit`);
  const paths = value.map((entry, index) => normalizePolicyPath(entry, `${label}[${index}]`));
  if (new Set(paths).size !== paths.length) throw new Error(`${label} contains duplicate paths`);
  return paths;
}

function normalizePolicyPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a relative path`);
  const candidate = value.trim();
  if (candidate.includes('\\') || isAbsolute(candidate) || posix.isAbsolute(candidate)) {
    throw new Error(`${label} must be a relative POSIX path`);
  }
  const normalized = posix.normalize(candidate);
  if (
    normalized !== candidate ||
    normalized === '.' ||
    normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} contains an unsafe path: ${candidate}`);
  }
  return normalized;
}

function policyPath(workspaceRoot: string, relativePath: string): string {
  const root = resolve(workspaceRoot);
  const target = resolve(root, normalize(relativePath));
  if (!target.startsWith(`${root}/`)) throw new Error(`Template payload path escapes output: ${relativePath}`);
  return target;
}

async function applyPolicy(workspaceRoot: string, policy: TemplatePayloadPolicy): Promise<void> {
  for (const excluded of policy.exclude) {
    await rm(policyPath(workspaceRoot, excluded), { recursive: true, force: true });
  }
  if (policy.overlayDirectory) {
    const overlay = policyPath(workspaceRoot, policy.overlayDirectory);
    if (!(await pathExists(overlay))) throw new Error(`Template payload overlay does not exist: ${policy.overlayDirectory}`);
    await copyDirectory(overlay, workspaceRoot, { allowExisting: true });
  }
  if (policy.packageJson?.removeScripts.length) {
    const packagePath = join(workspaceRoot, 'package.json');
    const packageJson = await readJsonIfExists<Record<string, unknown>>(packagePath);
    if (!packageJson) throw new Error('Cannot apply template package policy: invalid package.json');
    if (packageJson.scripts && typeof packageJson.scripts === 'object' && !Array.isArray(packageJson.scripts)) {
      const scripts = packageJson.scripts as Record<string, unknown>;
      for (const name of policy.packageJson.removeScripts) delete scripts[name];
      await writeJson(packagePath, packageJson);
    }
  }
  for (const cleanup of policy.cleanup ?? []) {
    await rm(policyPath(workspaceRoot, cleanup), { recursive: true, force: true });
  }
  await rm(join(workspaceRoot, POLICY_FILE), { force: true });
}

async function gitOutput(cwd: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync('git', args, { cwd });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}
