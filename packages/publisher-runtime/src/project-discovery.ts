import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { PublisherError } from './util.js';

const DEFAULT_MAX_PROJECTS = 20;
const DEFAULT_MAX_SESSION_FILES = 200;
const MAX_SESSION_BYTES = 2 * 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;
const WORKSPACE_KEYS = new Set([
  'cwd',
  'projectcwd',
  'projectdir',
  'projectdirectory',
  'projectpath',
  'workingdirectory',
  'workspace',
  'workspacedir',
  'workspaceroot',
  'workspacepath',
]);

export type ProjectHost = 'codex' | 'claude-code';
export type ProjectHostFilter = ProjectHost | 'all';

export interface ProjectDiscoveryOptions {
  host?: ProjectHostFilter;
  maxProjects?: number;
  maxSessionFiles?: number;
  homeDir?: string;
  codexHome?: string;
  claudeConfigDir?: string;
}

export interface DiscoveredProject {
  id: string;
  name: string;
  path: string;
  hosts: ProjectHost[];
  lastActiveAt: string;
  signals: string[];
  routeHint: 'existing-skill' | 'subapp-candidate' | 'workflow-candidate' | 'unknown';
}

interface SessionFile {
  host: ProjectHost;
  path: string;
  mtimeMs: number;
}

interface ProjectObservation {
  host: ProjectHost;
  workspace: string;
  activityMs: number;
}

export async function discoverRecentProjects(
  options: ProjectDiscoveryOptions = {},
): Promise<DiscoveredProject[]> {
  const host = normalizeHost(options.host ?? 'all');
  const maxProjects = boundedInteger(options.maxProjects, DEFAULT_MAX_PROJECTS, 1, 100, 'maxProjects');
  const maxSessionFiles = boundedInteger(
    options.maxSessionFiles,
    DEFAULT_MAX_SESSION_FILES,
    1,
    2_000,
    'maxSessionFiles',
  );
  const resolvedHomeDir = path.resolve(options.homeDir ?? os.homedir());
  const homeDir = await fsp.realpath(resolvedHomeDir).catch(() => resolvedHomeDir);
  const codexHome = path.resolve(options.codexHome ?? process.env.CODEX_HOME ?? path.join(homeDir, '.codex'));
  const claudeConfigDir = path.resolve(
    options.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homeDir, '.claude'),
  );
  const files = await collectSessionFiles({ host, codexHome, claudeConfigDir, maxSessionFiles });
  const projects = new Map<string, { hosts: Set<ProjectHost>; lastActivityMs: number }>();

  for (const file of files) {
    const observation = await readObservation(file);
    if (!observation) continue;
    const workspace = await safeWorkspaceDirectory(observation.workspace, homeDir);
    if (!workspace) continue;
    const current = projects.get(workspace) ?? { hosts: new Set<ProjectHost>(), lastActivityMs: 0 };
    current.hosts.add(observation.host);
    current.lastActivityMs = Math.max(current.lastActivityMs, observation.activityMs);
    projects.set(workspace, current);
  }

  const ordered = [...projects.entries()]
    .sort((left, right) => right[1].lastActivityMs - left[1].lastActivityMs || left[0].localeCompare(right[0]))
    .slice(0, maxProjects);
  return Promise.all(ordered.map(async ([workspace, value]) => {
    const metadata = await inspectProjectMetadata(workspace);
    return {
      id: `project_${createHash('sha256').update(workspace).digest('hex').slice(0, 20)}`,
      name: metadata.name,
      path: workspace,
      hosts: [...value.hosts].sort(),
      lastActiveAt: new Date(value.lastActivityMs).toISOString(),
      signals: metadata.signals,
      routeHint: metadata.routeHint,
    };
  }));
}

async function collectSessionFiles(options: {
  host: ProjectHostFilter;
  codexHome: string;
  claudeConfigDir: string;
  maxSessionFiles: number;
}): Promise<SessionFile[]> {
  const output: SessionFile[] = [];
  if (options.host === 'all' || options.host === 'codex') {
    await collectJsonlFiles(path.join(options.codexHome, 'sessions'), 5, 'codex', output);
    await collectJsonlFiles(path.join(options.codexHome, 'archived_sessions'), 2, 'codex', output);
  }
  if (options.host === 'all' || options.host === 'claude-code') {
    await collectJsonlFiles(path.join(options.claudeConfigDir, 'projects'), 5, 'claude-code', output);
    await collectJsonlFiles(options.claudeConfigDir, 0, 'claude-code', output, 'history.jsonl');
  }
  return output
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path))
    .slice(0, options.maxSessionFiles);
}

async function collectJsonlFiles(
  root: string,
  maxDepth: number,
  host: ProjectHost,
  output: SessionFile[],
  exactName?: string,
): Promise<void> {
  if (!(await fsp.stat(root).catch(() => undefined))?.isDirectory()) return;
  const visit = async (current: string, depth: number): Promise<void> => {
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < maxDepth) await visit(candidate, depth + 1);
        continue;
      }
      if (!entry.isFile() || (exactName ? entry.name !== exactName : !entry.name.endsWith('.jsonl'))) continue;
      const stat = await fsp.stat(candidate).catch(() => undefined);
      if (stat?.isFile()) output.push({ host, path: candidate, mtimeMs: stat.mtimeMs });
    }
  };
  await visit(root, 0);
}

async function readObservation(file: SessionFile): Promise<ProjectObservation | undefined> {
  const stat = await fsp.stat(file.path).catch(() => undefined);
  if (!stat?.isFile()) return undefined;
  const start = Math.max(0, stat.size - MAX_SESSION_BYTES);
  const handle = await fsp.open(file.path, 'r');
  try {
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/);
    if (start > 0) lines.shift();
    let workspace = '';
    let activityMs = file.mtimeMs;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as unknown;
        workspace ||= findWorkspace(value);
        activityMs = Math.max(activityMs, findTimestamp(value));
      } catch {
        // Ignore truncated and non-JSON session lines.
      }
    }
    return workspace ? { host: file.host, workspace, activityMs } : undefined;
  } finally {
    await handle.close();
  }
}

function findWorkspace(value: unknown, depth = 0): string {
  if (depth > 6 || typeof value !== 'object' || value === null) return '';
  if (Array.isArray(value)) {
    for (const child of value.slice(0, 50)) {
      const found = findWorkspace(child, depth + 1);
      if (found) return found;
    }
    return '';
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (WORKSPACE_KEYS.has(normalized) && typeof child === 'string' && path.isAbsolute(child.trim())) {
      return child.trim();
    }
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findWorkspace(child, depth + 1);
    if (found) return found;
  }
  return '';
}

function findTimestamp(value: unknown, depth = 0): number {
  if (depth > 3 || typeof value !== 'object' || value === null) return 0;
  if (Array.isArray(value)) return Math.max(0, ...value.slice(0, 25).map((child) => findTimestamp(child, depth + 1)));
  let latest = 0;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (['createdat', 'lastactivityat', 'timestamp', 'updatedat'].includes(key.replace(/[^a-z0-9]/gi, '').toLowerCase())) {
      const numeric = typeof child === 'number' ? child : Date.parse(String(child ?? ''));
      if (Number.isFinite(numeric)) latest = Math.max(latest, numeric < 10_000_000_000 ? numeric * 1_000 : numeric);
    }
    if (typeof child === 'object' && child !== null) latest = Math.max(latest, findTimestamp(child, depth + 1));
  }
  return latest;
}

async function safeWorkspaceDirectory(candidate: string, homeDir: string): Promise<string | undefined> {
  const resolved = path.resolve(candidate);
  if (resolved === path.parse(resolved).root) return undefined;
  const stat = await fsp.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return undefined;
  const real = await fsp.realpath(resolved).catch(() => undefined);
  if (!real || real === homeDir || real === path.parse(real).root) return undefined;
  return real;
}

async function inspectProjectMetadata(root: string): Promise<{
  name: string;
  signals: string[];
  routeHint: DiscoveredProject['routeHint'];
}> {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const names = new Set(entries.map((entry) => entry.name));
  const signals = ['SKILL.md', 'AGENTS.md', 'README.md', 'pyproject.toml', 'requirements.txt', 'manifest.json']
    .filter((name) => names.has(name));
  let name = path.basename(root);
  let hasAppFramework = false;
  if (names.has('package.json')) {
    signals.push('package.json');
    const packageValue = await readSmallJson(path.join(root, 'package.json'));
    if (typeof packageValue?.name === 'string' && packageValue.name.trim()) name = packageValue.name.trim().slice(0, 120);
    const dependencies = { ...record(packageValue?.dependencies), ...record(packageValue?.devDependencies) };
    const frameworks = ['next', 'react', 'vite'].filter((dependency) => dependency in dependencies);
    signals.push(...frameworks.map((framework) => `dependency:${framework}`));
    hasAppFramework = frameworks.includes('next') || (frameworks.includes('react') && frameworks.includes('vite'));
  }
  const routeHint = signals.includes('SKILL.md')
    ? 'existing-skill'
    : hasAppFramework
      ? 'subapp-candidate'
      : signals.length
        ? 'workflow-candidate'
        : 'unknown';
  return { name, signals: [...new Set(signals)].sort(), routeHint };
}

async function readSmallJson(file: string): Promise<Record<string, unknown> | undefined> {
  const stat = await fsp.stat(file).catch(() => undefined);
  if (!stat?.isFile() || stat.size > MAX_METADATA_BYTES) return undefined;
  try {
    const value = JSON.parse(await fsp.readFile(file, 'utf8')) as unknown;
    return record(value);
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeHost(value: string): ProjectHostFilter {
  if (value === 'all' || value === 'codex' || value === 'claude-code') return value;
  throw new PublisherError('Project host must be codex, claude-code, or all.', 'invalid_project_host');
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const normalized = value ?? fallback;
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new PublisherError(`${name} must be an integer between ${minimum} and ${maximum}.`, 'invalid_project_discovery_limit');
  }
  return normalized;
}
