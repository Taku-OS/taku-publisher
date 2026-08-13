import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_USAGE_PERIOD_ID = 'last90Days';

const USAGE_PERIOD_ALIASES = new Map([
  ['today', 'today'],
  ['day', 'today'],
  ['daily', 'today'],
  ['当天', 'today'],
  ['今天', 'today'],
  ['last7days', 'last7Days'],
  ['last7', 'last7Days'],
  ['week', 'last7Days'],
  ['weekly', 'last7Days'],
  ['最近7天', 'last7Days'],
  ['近7天', 'last7Days'],
  ['last30days', 'last30Days'],
  ['last30', 'last30Days'],
  ['30days', 'last30Days'],
  ['recentmonth', 'last30Days'],
  ['近30天', 'last30Days'],
  ['最近30天', 'last30Days'],
  ['近一个月', 'last30Days'],
  ['最近一个月', 'last30Days'],
  ['last90days', 'last90Days'],
  ['last90', 'last90Days'],
  ['90days', 'last90Days'],
  ['recentquarter', 'last90Days'],
  ['quarter', 'last90Days'],
  ['近90天', 'last90Days'],
  ['最近90天', 'last90Days'],
  ['近三个月', 'last90Days'],
  ['最近三个月', 'last90Days'],
  ['thismonth', 'thisMonth'],
  ['month', 'thisMonth'],
  ['monthly', 'thisMonth'],
  ['本月', 'thisMonth'],
  ['当月', 'thisMonth'],
  ['alltimelocal', 'allTimeLocal'],
  ['alltime', 'allTimeLocal'],
  ['all', 'allTimeLocal'],
  ['全部本地', 'allTimeLocal'],
  ['全部本地用量', 'allTimeLocal'],
]);

export function parseArgs(argv) {
  const positionals = [];
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    if (eq >= 0) {
      flags.set(token.slice(2, eq), token.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags.set(token.slice(2), true);
      continue;
    }
    flags.set(token.slice(2), next);
    i += 1;
  }
  return { positionals, flags };
}

export function getFlag(parsed, name) {
  const value = parsed.flags.get(name);
  return typeof value === 'string' ? value.trim() : undefined;
}

export function hasFlag(parsed, name) {
  return parsed.flags.get(name) === true;
}

export function readNumberFlag(parsed, name, fallback) {
  const raw = getFlag(parsed, name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export function normalizeChoiceToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

export function normalizeUsagePeriodId(value, fallback = DEFAULT_USAGE_PERIOD_ID) {
  if (!value) return fallback;
  const normalized = normalizeChoiceToken(value);
  const periodId = USAGE_PERIOD_ALIASES.get(normalized);
  if (periodId) return periodId;
  throw new Error(`Invalid --usage-period "${value}". Use one of: today, last7Days, last30Days, last90Days, thisMonth, allTimeLocal.`);
}

export function getHomeDir() {
  return os.homedir();
}

export function getScriptDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

export function getDefaultDraftDir() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'Taku', 'StaxCardDrafts');
  }
  return path.join(getHomeDir(), '.taku', 'stax-card-drafts');
}

export function getDefaultOutputPath(kind) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(getDefaultDraftDir(), `taku-${kind}-${stamp}.json`);
}

export async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(filePath) {
  try {
    return (await fs.stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

export function stableId(...parts) {
  return createHash('sha1').update(parts.filter(Boolean).join('\n')).digest('hex').slice(0, 16);
}

export function redactPath(filePath) {
  if (!filePath) return undefined;
  return `[redacted:${stableId(filePath)}]`;
}
