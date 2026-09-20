import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  readOpenCodeProjects,
  type OpenCodeDatabaseQuery,
} from './opencode-local.js';
import { PublisherError } from './util.js';

const DEFAULT_MAX_PROJECTS = 20;
const DEFAULT_MAX_SESSION_FILES = 200;
const MAX_SESSION_LINE_BYTES = 2 * 1024 * 1024;
const MAX_SESSION_LINES = 2_000;
const MAX_PROJECT_METADATA_BYTES = 256 * 1024;
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
const TIMESTAMP_KEYS = new Set([
  'createdat',
  'lastactivityat',
  'timestamp',
  'updatedat',
]);

export type ProjectHost = 'codex' | 'claude-code' | 'cursor' | 'opencode' | 'other';
export type ProjectHostFilter = ProjectHost | 'all';

export interface ProjectDiscoveryOptions {
  host?: ProjectHostFilter;
  maxProjects?: number;
  maxSessionFiles?: number;
  homeDir?: string;
  codexHome?: string;
  claudeConfigDir?: string;
  cursorUserDir?: string;
  openCodeDataDir?: string;
  openCodeStateDbPath?: string;
  openCodeQueryDatabase?: OpenCodeDatabaseQuery;
  explicitProjects?: string[];
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface DiscoveredProject {
  id: string;
  name: string;
  path: string;
  hosts: ProjectHost[];
  lastActiveAt: string;
  sessionFileCount: number;
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
  sourceFile: string;
}

interface ProjectAccumulator {
  path: string;
  hosts: Set<ProjectHost>;
  lastActivityMs: number;
  sessionFiles: Set<string>;
}

export async function discoverRecentProjects(
  options: ProjectDiscoveryOptions = {},
): Promise<DiscoveredProject[]> {
  const host = normalizeProjectHost(options.host ?? 'all');
  const maxProjects = boundedInteger(
    options.maxProjects,
    DEFAULT_MAX_PROJECTS,
    1,
    100,
    'maxProjects',
  );
  const maxSessionFiles = boundedInteger(
    options.maxSessionFiles,
    DEFAULT_MAX_SESSION_FILES,
    1,
    2_000,
    'maxSessionFiles',
  );
  const env = options.env ?? process.env;
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const codexHome = path.resolve(
    options.codexHome ?? env.CODEX_HOME ?? path.join(homeDir, '.codex'),
  );
  const claudeConfigDir = path.resolve(
    options.claudeConfigDir ?? env.CLAUDE_CONFIG_DIR ?? path.join(homeDir, '.claude'),
  );
  const cursorUserDir = path.resolve(
    options.cursorUserDir ?? resolveCursorUserDir(homeDir, options.platform ?? process.platform, env),
  );
  const observations: ProjectObservation[] = [];
  for (const candidate of options.explicitProjects ?? []) {
    if (!path.isAbsolute(candidate)) {
      throw new PublisherError(
        'Explicit projects must use absolute paths.',
        'invalid_explicit_project',
      );
    }
    observations.push({
      host: host === 'all' ? 'other' : host,
      workspace: candidate,
      activityMs: Date.now(),
      sourceFile: 'explicit-project',
    });
  }
  if (host === 'all' || host === 'codex' || host === 'claude-code') {
    const sessionFiles = await collectSessionFiles({
      host,
      codexHome,
      claudeConfigDir,
      maxSessionFiles,
    });
    for (const sessionFile of sessionFiles) {
      const observation = await readProjectObservation(sessionFile);
      if (observation) observations.push(observation);
    }
  }
  if (host === 'all' || host === 'cursor') {
    observations.push(...await readCursorWorkspaceObservations(cursorUserDir, maxSessionFiles));
  }
  if (host === 'all' || host === 'opencode') {
    const openCode = await readOpenCodeProjects({
      homeDir,
      dataDir: options.openCodeDataDir,
      stateDbPath: options.openCodeStateDbPath,
      maxProjects: maxSessionFiles,
      queryDatabase: options.openCodeQueryDatabase,
      env,
      platform: options.platform,
    });
    observations.push(...openCode.projects.map((project) => ({
      host: 'opencode' as const,
      workspace: project.workspace,
      activityMs: project.activityMs,
      sourceFile: `${project.source}#${project.projectId}`,
    })));
  }

  const projects = new Map<string, ProjectAccumulator>();
  for (const observation of observations) {
    const workspace = await safeWorkspaceDirectory(observation.workspace, homeDir);
    if (!workspace) continue;
    const current = projects.get(workspace) ?? {
      path: workspace,
      hosts: new Set<ProjectHost>(),
      lastActivityMs: 0,
      sessionFiles: new Set<string>(),
    };
    current.hosts.add(observation.host);
    current.lastActivityMs = Math.max(current.lastActivityMs, observation.activityMs);
    current.sessionFiles.add(`${observation.host}:${observation.sourceFile}`);
    projects.set(workspace, current);
  }

  const sorted = [...projects.values()]
    .sort((left, right) =>
      right.lastActivityMs - left.lastActivityMs || left.path.localeCompare(right.path),
    )
    .slice(0, maxProjects);
  const output: DiscoveredProject[] = [];
  for (const project of sorted) {
    const metadata = await inspectProjectMetadata(project.path);
    output.push({
      id: `project_${createHash('sha256').update(project.path).digest('hex').slice(0, 20)}`,
      name: metadata.name,
      path: project.path,
      hosts: [...project.hosts].sort(),
      lastActiveAt: new Date(project.lastActivityMs || Date.now()).toISOString(),
      sessionFileCount: project.sessionFiles.size,
      signals: metadata.signals,
      routeHint: metadata.routeHint,
    });
  }
  return output;
}

export function resolveCursorUserDir(
  homeDir: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = String(env.CURSOR_USER_DIR ?? '').trim();
  if (override) return path.resolve(override);
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User');
  }
  if (platform === 'win32') {
    const appData = String(env.APPDATA ?? '').trim() || path.join(homeDir, 'AppData', 'Roaming');
    return path.join(appData, 'Cursor', 'User');
  }
  const configRoot = String(env.XDG_CONFIG_HOME ?? '').trim() || path.join(homeDir, '.config');
  return path.join(configRoot, 'Cursor', 'User');
}

async function readCursorWorkspaceObservations(
  cursorUserDir: string,
  limit: number,
): Promise<ProjectObservation[]> {
  const workspaceStorage = path.join(cursorUserDir, 'workspaceStorage');
  const entries = await fsp.readdir(workspaceStorage, { withFileTypes: true }).catch(() => []);
  const candidates: Array<{ file: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const file = path.join(workspaceStorage, entry.name, 'workspace.json');
    const stat = await fsp.stat(file).catch(() => undefined);
    if (stat?.isFile() && stat.size <= MAX_PROJECT_METADATA_BYTES) {
      candidates.push({ file, mtimeMs: stat.mtimeMs });
    }
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || left.file.localeCompare(right.file));

  const observations: ProjectObservation[] = [];
  for (const candidate of candidates.slice(0, limit)) {
    const value = await readSmallJson(candidate.file);
    const workspace = cursorWorkspacePath(value);
    if (!workspace) continue;
    observations.push({
      host: 'cursor',
      workspace,
      activityMs: Math.max(candidate.mtimeMs, timestampMs(value?.lastUpdatedAt)),
      sourceFile: candidate.file,
    });
  }
  return observations;
}

function cursorWorkspacePath(value: Record<string, unknown> | undefined): string {
  const raw = typeof value?.folder === 'string'
    ? value.folder.trim()
    : typeof value?.workspace === 'string'
      ? value.workspace.trim()
      : '';
  if (!raw) return '';
  if (path.isAbsolute(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'file:') return '';
    return fileURLToPath(url);
  } catch {
    return '';
  }
}

async function collectSessionFiles(options: {
  host: ProjectHostFilter;
  codexHome: string;
  claudeConfigDir: string;
  maxSessionFiles: number;
}): Promise<SessionFile[]> {
  const specs: Array<{
    host: ProjectHost;
    root: string;
    maxDepth: number;
    fileName?: string;
  }> = [];
  if (options.host === 'all' || options.host === 'codex') {
    specs.push(
      { host: 'codex', root: path.join(options.codexHome, 'sessions'), maxDepth: 5 },
      { host: 'codex', root: path.join(options.codexHome, 'archived_sessions'), maxDepth: 2 },
    );
  }
  if (options.host === 'all' || options.host === 'claude-code') {
    specs.push(
      { host: 'claude-code', root: path.join(options.claudeConfigDir, 'projects'), maxDepth: 5 },
      {
        host: 'claude-code',
        root: options.claudeConfigDir,
        maxDepth: 0,
        fileName: 'history.jsonl',
      },
    );
  }
  const files: SessionFile[] = [];
  for (const spec of specs) {
    await collectJsonlFiles(spec.root, spec.maxDepth, spec.host, files, spec.fileName);
  }
  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path))
    .slice(0, options.maxSessionFiles);
}

async function collectJsonlFiles(
  root: string,
  maxDepth: number,
  host: ProjectHost,
  output: SessionFile[],
  exactFileName?: string,
): Promise<void> {
  const stat = await fsp.stat(root).catch(() => undefined);
  if (!stat?.isDirectory()) return;
  const visit = async (current: string, depth: number): Promise<void> => {
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (depth < maxDepth) await visit(entryPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (exactFileName ? entry.name !== exactFileName : !entry.name.endsWith('.jsonl')) continue;
      const fileStat = await fsp.stat(entryPath).catch(() => undefined);
      if (fileStat?.isFile()) output.push({ host, path: entryPath, mtimeMs: fileStat.mtimeMs });
    }
  };
  await visit(root, 0);
}

async function readProjectObservation(file: SessionFile): Promise<ProjectObservation | undefined> {
  const input = fs.createReadStream(file.path, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let workspace = '';
  let activityMs = file.mtimeMs;
  let lineCount = 0;
  try {
    for await (const rawLine of lines) {
      lineCount += 1;
      if (lineCount > MAX_SESSION_LINES) break;
      if (!rawLine || Buffer.byteLength(rawLine, 'utf8') > MAX_SESSION_LINE_BYTES) continue;
      let value: unknown;
      try {
        value = JSON.parse(rawLine);
      } catch {
        continue;
      }
      workspace ||= findWorkspaceMetadata(value);
      activityMs = Math.max(activityMs, findActivityTimestamp(value));
      if (workspace && lineCount >= 25) break;
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (!workspace) return undefined;
  return { host: file.host, workspace, activityMs, sourceFile: file.path };
}

function findWorkspaceMetadata(value: unknown, depth = 0): string {
  if (depth > 6 || typeof value !== 'object' || value === null) return '';
  if (Array.isArray(value)) {
    for (const child of value.slice(0, 50)) {
      const found = findWorkspaceMetadata(child, depth + 1);
      if (found) return found;
    }
    return '';
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (
      WORKSPACE_KEYS.has(normalizedKey) &&
      typeof child === 'string' &&
      path.isAbsolute(child.trim())
    ) {
      return child.trim();
    }
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (typeof child !== 'object' || child === null) continue;
    const found = findWorkspaceMetadata(child, depth + 1);
    if (found) return found;
  }
  return '';
}

function findActivityTimestamp(value: unknown, depth = 0): number {
  if (depth > 3 || typeof value !== 'object' || value === null) return 0;
  if (Array.isArray(value)) {
    return Math.max(0, ...value.slice(0, 25).map((child) => findActivityTimestamp(child, depth + 1)));
  }
  let latest = 0;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (TIMESTAMP_KEYS.has(normalizedKey)) latest = Math.max(latest, timestampMs(child));
    if (typeof child === 'object' && child !== null) {
      latest = Math.max(latest, findActivityTimestamp(child, depth + 1));
    }
  }
  return latest;
}

function timestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1_000;
  }
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function safeWorkspaceDirectory(candidate: string, homeDir: string): Promise<string | undefined> {
  const resolved = path.resolve(candidate);
  if (resolved === path.parse(resolved).root || resolved === homeDir) return undefined;
  const stat = await fsp.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) return undefined;
  return fsp.realpath(resolved).catch(() => undefined);
}

async function inspectProjectMetadata(root: string): Promise<{
  name: string;
  signals: string[];
  routeHint: DiscoveredProject['routeHint'];
}> {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const names = new Set(entries.map((entry) => entry.name));
  const signals: string[] = [];
  if (names.has('SKILL.md')) signals.push('SKILL.md');
  if (names.has('AGENTS.md')) signals.push('AGENTS.md');
  if (names.has('README.md')) signals.push('README.md');
  if (names.has('pyproject.toml')) signals.push('pyproject.toml');
  if (names.has('requirements.txt')) signals.push('requirements.txt');
  if (names.has('manifest.json')) signals.push('manifest.json');
  let name = path.basename(root);
  let hasAppFramework = false;
  if (names.has('package.json')) {
    signals.push('package.json');
    const packageValue = await readSmallJson(path.join(root, 'package.json'));
    if (typeof packageValue?.name === 'string' && packageValue.name.trim()) {
      name = packageValue.name.trim().slice(0, 120);
    }
    const dependencies = {
      ...record(packageValue?.dependencies),
      ...record(packageValue?.devDependencies),
    };
    const framework = ['next', 'react', 'vite'].filter((dependency) => dependency in dependencies);
    if (framework.length) {
      signals.push(...framework.map((dependency) => `dependency:${dependency}`));
      hasAppFramework = framework.includes('next') ||
        (framework.includes('react') && framework.includes('vite'));
    }
  }
  let routeHint: DiscoveredProject['routeHint'] = 'unknown';
  if (signals.includes('SKILL.md')) routeHint = 'existing-skill';
  else if (hasAppFramework) routeHint = 'subapp-candidate';
  else if (
    signals.some((signal) =>
      ['AGENTS.md', 'README.md', 'pyproject.toml', 'requirements.txt', 'package.json'].includes(signal),
    )
  ) routeHint = 'workflow-candidate';
  return { name, signals: [...new Set(signals)].sort(), routeHint };
}

async function readSmallJson(file: string): Promise<Record<string, unknown> | undefined> {
  const stat = await fsp.stat(file).catch(() => undefined);
  if (!stat?.isFile() || stat.size > MAX_PROJECT_METADATA_BYTES) return undefined;
  try {
    const value = JSON.parse(await fsp.readFile(file, 'utf8')) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeProjectHost(value: string): ProjectHostFilter {
  const normalized = value.trim().toLowerCase();
  if (['all', 'codex', 'claude-code', 'cursor', 'opencode', 'other'].includes(normalized)) {
    return normalized as ProjectHostFilter;
  }
  if (normalized === 'claude' || normalized === 'cc') return 'claude-code';
  throw new PublisherError(
    'Project host must be codex, claude-code, cursor, opencode, other, or all.',
    'invalid_project_host',
  );
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
    throw new PublisherError(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
      'invalid_project_discovery_limit',
    );
  }
  return normalized;
}
