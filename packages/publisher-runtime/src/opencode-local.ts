import { execFile } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_PROJECTS = 200;
const DEFAULT_MAX_SESSIONS = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_SQLITE_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_PROJECT_METADATA_BYTES = 256 * 1024;

type JsonRecord = Record<string, unknown>;
type QueryKind = 'projects' | 'sessions';

export interface OpenCodeDatabaseQueryOptions {
  kind: QueryKind;
  limit: number;
  timeoutMs: number;
}

export interface OpenCodeDatabaseQueryResult {
  rows: JsonRecord[];
  scannedByteCount?: number;
}

export type OpenCodeDatabaseQuery = (
  databasePath: string,
  options: OpenCodeDatabaseQueryOptions,
) => Promise<OpenCodeDatabaseQueryResult>;

export interface OpenCodePathOptions {
  homeDir?: string;
  dataDir?: string;
  stateDbPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface OpenCodeProjectRecord {
  projectId: string;
  workspace: string;
  name: string;
  activityMs: number;
  source: string;
}

export interface OpenCodeUsageRecord {
  type: 'opencode_usage';
  timestamp: string;
  session_id: string;
  event_id: string;
  model: string;
  workspace?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    reasoning_output_tokens: number;
  };
}

export interface OpenCodeUsageSession {
  sessionId: string;
  records: OpenCodeUsageRecord[];
}

export function resolveOpenCodeDataDir(options: OpenCodePathOptions = {}): string {
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const env = options.env ?? process.env;
  const explicit = String(options.dataDir ?? env.OPENCODE_DATA_DIR ?? '').trim();
  if (explicit) return path.resolve(explicit);
  const xdgDataHome = String(env.XDG_DATA_HOME ?? '').trim();
  if (xdgDataHome) return path.resolve(xdgDataHome, 'opencode');
  if ((options.platform ?? process.platform) === 'win32') {
    const localAppData = String(env.LOCALAPPDATA ?? '').trim();
    if (localAppData) return path.resolve(localAppData, 'opencode');
  }
  return path.join(homeDir, '.local', 'share', 'opencode');
}

export function openCodeStateDatabasePath(options: OpenCodePathOptions = {}): string {
  const env = options.env ?? process.env;
  const explicit = String(options.stateDbPath ?? env.OPENCODE_STATE_DB ?? '').trim();
  if (explicit) return path.resolve(explicit);
  return path.join(resolveOpenCodeDataDir(options), 'opencode.db');
}

export async function readOpenCodeProjects(options: OpenCodePathOptions & {
  maxProjects?: number;
  timeoutMs?: number;
  queryDatabase?: OpenCodeDatabaseQuery;
} = {}): Promise<{
  found: boolean;
  scanned: boolean;
  stateDbPath: string;
  projects: OpenCodeProjectRecord[];
  warning?: string;
}> {
  const stateDbPath = openCodeStateDatabasePath(options);
  const maxProjects = boundedInteger(options.maxProjects, DEFAULT_MAX_PROJECTS, 1, 2_000);
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 30_000);
  const databaseStat = await fsp.stat(stateDbPath).catch(() => undefined);
  if (databaseStat?.isFile()) {
    try {
      const result = await (options.queryDatabase ?? queryOpenCodeDatabase)(stateDbPath, {
        kind: 'projects',
        limit: maxProjects,
        timeoutMs,
      });
      return {
        found: true,
        scanned: true,
        stateDbPath,
        projects: openCodeProjectsFromRows(result.rows, stateDbPath),
      };
    } catch (error) {
      const fallback = await readLegacyOpenCodeProjects(resolveOpenCodeDataDir(options), maxProjects);
      return {
        found: true,
        scanned: fallback.length > 0,
        stateDbPath,
        projects: fallback,
        warning: `OpenCode recent projects are unavailable from its database: ${errorMessage(error)}`,
      };
    }
  }

  const fallback = await readLegacyOpenCodeProjects(resolveOpenCodeDataDir(options), maxProjects);
  return {
    found: fallback.length > 0,
    scanned: fallback.length > 0,
    stateDbPath,
    projects: fallback,
  };
}

export async function readOpenCodeStateUsage(options: OpenCodePathOptions & {
  maxRows?: number;
  timeoutMs?: number;
  queryDatabase?: OpenCodeDatabaseQuery;
} = {}): Promise<{
  found: boolean;
  scanned: boolean;
  exact: boolean;
  stateDbPath: string;
  sessions: OpenCodeUsageSession[];
  rowCount: number;
  exactRowCount?: number;
  partial?: boolean;
  scannedByteCount?: number;
  warning?: string;
}> {
  const stateDbPath = openCodeStateDatabasePath(options);
  const stat = await fsp.stat(stateDbPath).catch(() => undefined);
  if (!stat?.isFile()) {
    return { found: false, scanned: false, exact: false, stateDbPath, sessions: [], rowCount: 0 };
  }

  const maxRows = boundedInteger(options.maxRows, DEFAULT_MAX_SESSIONS, 1, 50_000);
  try {
    const queried = await (options.queryDatabase ?? queryOpenCodeDatabase)(stateDbPath, {
      kind: 'sessions',
      limit: maxRows,
      timeoutMs: boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 30_000),
    });
    const sessions = openCodeUsageSessionsFromRows(queried.rows, stat.mtimeMs);
    const exactRowCount = sessions.reduce((total, session) => total + session.records.length, 0);
    return {
      found: true,
      scanned: true,
      exact: exactRowCount > 0,
      stateDbPath,
      sessions,
      rowCount: queried.rows.length,
      exactRowCount,
      partial: queried.rows.length >= maxRows,
      scannedByteCount: Number(queried.scannedByteCount ?? 0),
      warning: exactRowCount > 0
        ? undefined
        : 'OpenCode local history did not expose explicit token counts; usage was not estimated.',
    };
  } catch (error) {
    return {
      found: true,
      scanned: false,
      exact: false,
      stateDbPath,
      sessions: [],
      rowCount: 0,
      warning: `OpenCode local token usage is unavailable: ${errorMessage(error)}`,
    };
  }
}

export function openCodeProjectsFromRows(
  rows: JsonRecord[],
  source = 'opencode.db',
): OpenCodeProjectRecord[] {
  const projects: OpenCodeProjectRecord[] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const workspace = firstString(row.worktree, row.directory);
    if (!workspace || !path.isAbsolute(workspace) || seen.has(workspace)) continue;
    seen.add(workspace);
    projects.push({
      projectId: firstString(row.project_id, row.id) || workspace,
      workspace,
      name: firstString(row.name),
      activityMs: firstTimestamp(row.time_updated, row.updated_at, row.time_created),
      source,
    });
  }
  return projects;
}

export function openCodeUsageSessionsFromRows(
  rows: JsonRecord[],
  fallbackTimestampMs = Date.now(),
): OpenCodeUsageSession[] {
  const sessions: OpenCodeUsageSession[] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const sessionId = firstString(row.session_id, row.id);
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    const usage = {
      input_tokens: finiteToken(row.tokens_input),
      output_tokens: finiteToken(row.tokens_output),
      cache_read_input_tokens: finiteToken(row.tokens_cache_read),
      cache_creation_input_tokens: finiteToken(row.tokens_cache_write),
      reasoning_output_tokens: finiteToken(row.tokens_reasoning),
    };
    if (Object.values(usage).reduce((sum, value) => sum + value, 0) <= 0) continue;
    const timestampMs = firstTimestamp(row.time_updated, row.time_created, fallbackTimestampMs);
    const workspace = firstString(row.directory, row.worktree);
    sessions.push({
      sessionId,
      records: [{
        type: 'opencode_usage',
        timestamp: new Date(timestampMs || fallbackTimestampMs).toISOString(),
        session_id: sessionId,
        event_id: sessionId,
        model: openCodeModel(row.model) || 'opencode',
        ...(workspace ? { workspace } : {}),
        usage,
      }],
    });
  }
  return sessions;
}

async function queryOpenCodeDatabase(
  databasePath: string,
  options: OpenCodeDatabaseQueryOptions,
): Promise<OpenCodeDatabaseQueryResult> {
  const sql = options.kind === 'projects'
    ? `SELECT p.id AS project_id, p.worktree, p.name, CASE WHEN COALESCE(MAX(s.time_updated), 0) > p.time_updated THEN MAX(s.time_updated) ELSE p.time_updated END AS time_updated FROM project AS p LEFT JOIN session AS s ON s.project_id = p.id GROUP BY p.id, p.worktree, p.name, p.time_updated ORDER BY time_updated DESC LIMIT ${options.limit};`
    : `SELECT id AS session_id, project_id, directory, model, time_created, time_updated, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write FROM session WHERE tokens_input > 0 OR tokens_output > 0 OR tokens_reasoning > 0 OR tokens_cache_read > 0 OR tokens_cache_write > 0 ORDER BY time_updated DESC LIMIT ${options.limit};`;
  const completed = await execFileAsync(
    'sqlite3',
    ['-readonly', '-json', databasePath, sql],
    { encoding: 'utf8', timeout: options.timeoutMs, maxBuffer: MAX_SQLITE_OUTPUT_BYTES },
  );
  const output = String(completed.stdout ?? '').trim();
  if (!output) return { rows: [], scannedByteCount: 0 };
  const value: unknown = JSON.parse(output);
  const rows = Array.isArray(value)
    ? value.filter((entry): entry is JsonRecord => isRecord(entry))
    : [];
  return { rows, scannedByteCount: Buffer.byteLength(output) };
}

async function readLegacyOpenCodeProjects(
  dataDir: string,
  limit: number,
): Promise<OpenCodeProjectRecord[]> {
  const root = path.join(dataDir, 'storage', 'project');
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const projects: OpenCodeProjectRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue;
    const file = path.join(root, entry.name);
    const stat = await fsp.stat(file).catch(() => undefined);
    if (!stat?.isFile() || stat.size > MAX_PROJECT_METADATA_BYTES) continue;
    try {
      const value: unknown = JSON.parse(await fsp.readFile(file, 'utf8'));
      if (!isRecord(value)) continue;
      const workspace = firstString(value.worktree, value.directory);
      if (!workspace || !path.isAbsolute(workspace)) continue;
      const time = isRecord(value.time) ? value.time : {};
      projects.push({
        projectId: firstString(value.id) || entry.name,
        workspace,
        name: firstString(value.name),
        activityMs: firstTimestamp(time.updated, value.time_updated, stat.mtimeMs),
        source: file,
      });
    } catch {
      // Older OpenCode project records may be stale or partially written.
    }
  }
  return projects
    .sort((left, right) => right.activityMs - left.activityMs || left.workspace.localeCompare(right.workspace))
    .slice(0, limit);
}

function openCodeModel(value: unknown): string {
  if (isRecord(value)) return firstString(value.id, value.modelID, value.model);
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) return firstString(parsed.id, parsed.modelID, parsed.model);
  } catch {
    return value.trim();
  }
  return value.trim();
}

function firstTimestamp(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value > 10_000_000_000 ? value : value * 1_000;
    }
    if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric > 10_000_000_000 ? numeric : numeric * 1_000;
      }
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function finiteToken(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
