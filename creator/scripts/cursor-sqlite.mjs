import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_SQLITE_OUTPUT_BYTES = 32 * 1024 * 1024;

export function cursorStateDatabasePath(options = {}) {
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const env = options.env || process.env;
  const explicit = String(options.stateDbPath || env.CURSOR_STATE_DB || '').trim();
  if (explicit) return path.resolve(explicit);
  const platform = options.platform || process.platform;
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  if (platform === 'win32') {
    const appData = String(env.APPDATA || '').trim() || path.join(homeDir, 'AppData', 'Roaming');
    return path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
  const configRoot = String(env.XDG_CONFIG_HOME || '').trim() || path.join(homeDir, '.config');
  return path.join(configRoot, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

export async function readCursorStateUsage(options = {}) {
  const stateDbPath = cursorStateDatabasePath(options);
  const stat = await fs.stat(stateDbPath).catch(() => undefined);
  if (!stat?.isFile()) {
    return { found: false, scanned: false, exact: false, stateDbPath, sessions: [], rowCount: 0 };
  }

  const maxRows = boundedInteger(options.maxRows, DEFAULT_MAX_ROWS, 1, 50_000);
  try {
    const queryDatabase = options.queryDatabase || queryCursorDatabase;
    const queried = await queryDatabase(stateDbPath, {
      maxRows,
      timeoutMs: boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 30_000),
    });
    const sessions = cursorUsageSessionsFromRows(
      queried.bubbles,
      queried.composers,
      stat.mtimeMs,
    );
    const exactRowCount = sessions.reduce((total, session) => total + session.records.length, 0);
    return {
      found: true,
      scanned: true,
      exact: exactRowCount > 0,
      stateDbPath,
      sessions,
      rowCount: queried.bubbles.length,
      exactRowCount,
      partial: queried.bubbles.length >= maxRows,
      scannedByteCount: Number(queried.scannedByteCount || 0),
      warning: exactRowCount > 0
        ? undefined
        : 'Cursor local history did not expose explicit token counts; usage was not estimated.',
    };
  } catch (error) {
    return {
      found: true,
      scanned: false,
      exact: false,
      stateDbPath,
      sessions: [],
      rowCount: 0,
      warning: `Cursor local token usage is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function cursorUsageSessionsFromRows(bubbleRows, composerRows, fallbackTimestampMs = Date.now()) {
  const composerTimestamps = new Map();
  for (const row of Array.isArray(composerRows) ? composerRows : []) {
    if (typeof row?.key !== 'string' || !row.key.startsWith('composerData:')) continue;
    const composerId = row.key.slice('composerData:'.length);
    const value = parseRowValue(row.value);
    if (!composerId || !value) continue;
    const timestamp = firstTimestamp(value.lastUpdatedAt, value.createdAt, value.timestamp);
    if (timestamp) composerTimestamps.set(composerId, timestamp);
  }

  const sessions = new Map();
  const seen = new Set();
  for (const row of Array.isArray(bubbleRows) ? bubbleRows : []) {
    const keyParts = cursorBubbleKey(row?.key);
    const value = parseRowValue(row?.value);
    if (!keyParts || !value) continue;
    const usage = explicitCursorUsage(value.tokenCount);
    if (!usage) continue;
    const eventId = String(value.usageUuid || value.bubbleId || keyParts.bubbleId).trim();
    const dedupKey = `${keyParts.composerId}:${eventId}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const timestampMs = firstTimestamp(
      value.createdAt,
      value.timestamp,
      composerTimestamps.get(keyParts.composerId),
      fallbackTimestampMs,
    );
    const timestamp = new Date(timestampMs || Date.now()).toISOString();
    const model = firstString(
      value.model,
      value.modelId,
      value.selectedModel,
      value.tokenCount?.model,
    );
    const current = sessions.get(keyParts.composerId) || [];
    current.push({
      type: 'cursor_usage',
      timestamp,
      session_id: keyParts.composerId,
      event_id: eventId,
      model: model || 'cursor',
      usage,
    });
    sessions.set(keyParts.composerId, current);
  }

  return [...sessions.entries()].map(([sessionId, records]) => ({ sessionId, records }));
}

async function queryCursorDatabase(stateDbPath, options) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-cursor-db-'));
  const copiedDbPath = path.join(temporary, 'state.vscdb');
  try {
    await fs.copyFile(stateDbPath, copiedDbPath);
    for (const suffix of ['-wal', '-shm']) {
      await fs.copyFile(`${stateDbPath}${suffix}`, `${copiedDbPath}${suffix}`).catch(() => undefined);
    }
    const [bubbles, composers] = await Promise.all([
      queryPrefix(copiedDbPath, 'bubbleId:', options.maxRows, options.timeoutMs),
      queryPrefix(copiedDbPath, 'composerData:', options.maxRows, options.timeoutMs),
    ]);
    return {
      bubbles,
      composers,
      scannedByteCount: Buffer.byteLength(JSON.stringify(bubbles)) + Buffer.byteLength(JSON.stringify(composers)),
    };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

async function queryPrefix(dbPath, prefix, limit, timeoutMs) {
  const upper = `${prefix.slice(0, -1)}${String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)}`;
  const sql = `SELECT rowid, key, CAST(value AS TEXT) AS value FROM cursorDiskKV WHERE key >= '${prefix}' AND key < '${upper}' ORDER BY rowid DESC LIMIT ${limit};`;
  const completed = await execFileAsync(
    'sqlite3',
    ['-readonly', '-json', dbPath, sql],
    { encoding: 'utf8', timeout: timeoutMs, maxBuffer: MAX_SQLITE_OUTPUT_BYTES },
  );
  const output = String(completed.stdout || '').trim();
  if (!output) return [];
  const value = JSON.parse(output);
  return Array.isArray(value) ? value : [];
}

function cursorBubbleKey(value) {
  if (typeof value !== 'string' || !value.startsWith('bubbleId:')) return undefined;
  const remainder = value.slice('bubbleId:'.length);
  const separator = remainder.lastIndexOf(':');
  if (separator <= 0) return undefined;
  const composerId = remainder.slice(0, separator);
  const bubbleId = remainder.slice(separator + 1);
  return composerId && bubbleId ? { composerId, bubbleId } : undefined;
}

function explicitCursorUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = finiteToken(value.inputTokens);
  const output = finiteToken(value.outputTokens);
  const cacheRead = finiteToken(value.cacheReadTokens ?? value.cachedInputTokens);
  const cacheWrite = finiteToken(value.cacheWriteTokens ?? value.cacheCreationTokens);
  const reasoning = finiteToken(value.reasoningTokens);
  if (input + output + cacheRead + cacheWrite + reasoning <= 0) return undefined;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
    reasoning_output_tokens: reasoning,
  };
}

function finiteToken(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function parseRowValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function firstTimestamp(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value > 10_000_000_000 ? value : value * 1_000;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}
