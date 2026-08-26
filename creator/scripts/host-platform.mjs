import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AI_CLIENTS_SCHEMA = 'taku.creator.ai-clients.v1';

const CLIENTS = {
  codex: { id: 'codex', label: 'CODEX', icon: 'codex' },
  'claude-code': { id: 'claude-code', label: 'CLAUDE', icon: 'claude' },
  cursor: { id: 'cursor', label: 'CURSOR', icon: 'cursor' },
  gemini: { id: 'gemini', label: 'GEMINI', icon: 'gemini' },
};

const CLIENT_ORDER = ['codex', 'claude-code', 'cursor', 'gemini'];

export function normalizeAiClient(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'codex' || normalized === 'openai') return 'codex';
  if (['claude', 'claude-code', 'cc', 'anthropic'].includes(normalized)) return 'claude-code';
  if (normalized === 'cursor' || normalized === 'composer') return 'cursor';
  if (normalized === 'gemini' || normalized === 'google') return 'gemini';
  return '';
}

export async function detectInvokingAiClient(options = {}) {
  const explicit = normalizeAiClient(options.explicitHost);
  if (explicit) return explicit;

  const env = options.env || process.env;
  const fromEnvironment = normalizeAiClient(env.TAKU_CREATOR_HOST);
  if (fromEnvironment) return fromEnvironment;

  const modulePath = fileURLToPath(options.moduleUrl || import.meta.url);
  const markerPath = options.markerPath || path.resolve(path.dirname(modulePath), '..', '..', 'host-adapter.json');
  try {
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    const fromMarker = normalizeAiClient(marker?.host);
    if (fromMarker) return fromMarker;
  } catch {
    // Source checkouts do not have an adapter marker. Path inference below is
    // only a compatibility fallback for older packaged plugins.
  }

  const normalizedPath = modulePath.split(path.sep).join('/').toLowerCase();
  if (normalizedPath.includes('/.codex/')) return 'codex';
  if (normalizedPath.includes('/.claude/')) return 'claude-code';
  return '';
}

export async function discoverAiClients(options = {}) {
  const invokingHost = normalizeAiClient(options.invokingHost);
  const homeDir = path.resolve(options.homeDir || process.cwd());
  const claudeConfigDir = path.resolve(options.claudeConfigDir || path.join(homeDir, '.claude'));
  const candidates = new Map();

  const add = (value, detectedBy) => {
    const id = normalizeAiClient(value);
    if (!id || !CLIENTS[id]) return;
    const existing = candidates.get(id) || { ...CLIENTS[id], detectedBy: [] };
    if (detectedBy && !existing.detectedBy.includes(detectedBy)) existing.detectedBy.push(detectedBy);
    candidates.set(id, existing);
  };

  add(invokingHost, 'invoking-host');

  const localRoots = [
    ['codex', path.join(homeDir, '.codex')],
    ['claude-code', claudeConfigDir],
    ['cursor', path.join(homeDir, '.cursor')],
    ['gemini', path.join(homeDir, '.gemini')],
  ];
  await Promise.all(localRoots.map(async ([id, root]) => {
    try {
      const stat = await fs.stat(root);
      if (stat.isDirectory()) add(id, 'local-install');
    } catch {
      // Missing client roots are expected.
    }
  }));

  for (const source of Array.isArray(options.usageSources) ? options.usageSources : []) {
    add(source?.source || source?.label, 'local-usage');
  }

  const defaultClient = invokingHost || CLIENT_ORDER.find((id) => candidates.has(id)) || '';
  const optionsList = [...candidates.values()]
    .sort((left, right) => {
      if (left.id === defaultClient) return -1;
      if (right.id === defaultClient) return 1;
      return CLIENT_ORDER.indexOf(left.id) - CLIENT_ORDER.indexOf(right.id);
    });

  return {
    schemaVersion: AI_CLIENTS_SCHEMA,
    defaultClient,
    options: optionsList,
  };
}
