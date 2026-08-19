import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { cleanText, isRecord } from './privacy.mjs';

export const DEFAULT_SKIPPED_INVENTORY_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', 'build', '.next', '.cache']);

const LIGHT_SNIPPET_BYTES = 4096;
const LIGHT_SNIPPET_CHARS = 1200;
const PREVIEWABLE_LIGHT_EXTENSIONS = new Set(['.md', '.markdown', '.json', '.toml', '.yaml', '.yml']);

function typeBadge(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'skill') return 'SKILLS';
  if (normalized === 'mcp-server') return 'MCP';
  if (normalized === 'agents-md') return 'AGENTS.MD';
  if (normalized === 'subagent') return 'SUBAGENT';
  if (normalized === 'slash-command') return 'COMMAND';
  if (normalized === 'plugin') return 'PLUGIN';
  if (normalized.includes('workflow')) return 'WORKFLOW';
  return cleanText(type, 28)?.toUpperCase() || 'TOOL';
}

function sourceBadge(source) {
  const normalized = String(source || '').toLowerCase();
  if (normalized.includes('codex')) return 'CODEX';
  if (normalized.includes('claude')) return 'CLAUDE';
  if (normalized.includes('cursor')) return 'CURSOR';
  if (normalized.includes('workspace')) return 'WORKSPACE';
  if (normalized.includes('taku')) return 'TAKU';
  return cleanText(source, 28)?.toUpperCase() || 'LOCAL';
}

function confidenceBadge(item) {
  if (item?.availability === 'disabled') return 'DISABLED';
  if (item?.availability === 'unknown' || item?.availability === 'unlisted') return 'UNVERIFIED';
  if (item?.type === 'agents-md' || item?.type === 'subagent' || item?.type === 'slash-command') return 'MEDIUM';
  return 'HIGH';
}

function previewStatus(item) {
  if (item?.availability === 'disabled') return 'Disabled';
  if (item?.type === 'mcp-server') return 'Configured';
  return 'Synced';
}

function redactedValueForKey(key, value) {
  const normalized = String(key || '').toLowerCase();
  if (/(?:^|[_-])(env|environment|headers?)(?:$|[_-])/.test(normalized)) {
    if (!isRecord(value)) return '[redacted]';
    return Object.fromEntries(Object.keys(value).map((name) => [name, '[redacted]']));
  }
  if (/(token|secret|api[_-]?key|authorization|auth|password|passwd|cookie|session|credential)/i.test(normalized)) {
    return '[redacted]';
  }
  return undefined;
}

function redactUrlSecrets(text) {
  return String(text || '').replace(/([?&](?:token|secret|api[_-]?key|key|auth|code|password|session|access_token|refresh_token)=)[^&#\s"')]+/gi, '$1[redacted]');
}

export function redactSensitiveText(value) {
  if (typeof value !== 'string') return value;
  return redactUrlSecrets(value)
    .replace(/\b(?:sk|sk-proj|ghp|gho|ghu|ghs|xoxb|xoxp|xoxa|glpat|npm)[:_-]?[A-Za-z0-9_-]{12,}\b/g, '[redacted-token]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '$1 [redacted]')
    .replace(/\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|AUTH|PASSWORD|COOKIE|SESSION)[A-Z0-9_]*)\s*=\s*[^\s"'`]+/g, '$1=[redacted]')
    .replace(/(["']?(?:token|secret|api[_-]?key|authorization|auth|password|cookie|session|credential)["']?\s*[:=]\s*)["']?[^"',\n\r}]+["']?/gi, '$1[redacted]')
    .replace(/(?:^|[\s"'`(])\/Users\/[^\s"'`)]+/g, ' [redacted-path]')
    .replace(/(?:^|[\s"'`(])\/home\/[^\s"'`)]+/g, ' [redacted-path]');
}

function sanitizeConfigValue(value, key = '', depth = 0) {
  const redacted = redactedValueForKey(key, value);
  if (redacted !== undefined) return redacted;
  if (typeof value === 'string') return cleanText(redactSensitiveText(value), 260) || '';
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    if (depth >= 3) return '[truncated]';
    return value.slice(0, 12).map((item) => sanitizeConfigValue(item, key, depth + 1));
  }
  if (isRecord(value)) {
    if (depth >= 3) return '[truncated]';
    const output = {};
    for (const [entryKey, entryValue] of Object.entries(value).slice(0, 24)) {
      output[entryKey] = sanitizeConfigValue(entryValue, entryKey, depth + 1);
    }
    return output;
  }
  return undefined;
}

export function redactedJsonSnippet(value) {
  const text = JSON.stringify(sanitizeConfigValue(value), null, 2);
  return clipSnippetText(text, LIGHT_SNIPPET_CHARS);
}

function clipSnippetText(value, max = LIGHT_SNIPPET_CHARS) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

export async function readFileStart(filePath, maxBytes = LIGHT_SNIPPET_BYTES) {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await handle?.close().catch(() => {});
  }
}

function stripMarkdownFrontmatter(markdown) {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  return end >= 0 ? markdown.slice(end + 4).replace(/^\r?\n/, '') : markdown;
}

function markdownLightSnippet(markdown) {
  const body = stripMarkdownFrontmatter(markdown);
  const lines = body.split(/\r?\n/);
  const picked = [];
  for (const line of lines) {
    if (picked.join('\n').length >= LIGHT_SNIPPET_CHARS) break;
    if (!line.trim() && picked.length && !picked[picked.length - 1]) continue;
    picked.push(line);
  }
  return clipSnippetText(redactSensitiveText(picked.join('\n').trim()), LIGHT_SNIPPET_CHARS);
}

function previewableLightFile(filePath) {
  const basename = path.basename(filePath).toLowerCase();
  return basename === 'skill.md' || basename === 'agents.md' || PREVIEWABLE_LIGHT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function lightFolderStats(root, options = {}) {
  const maxDepth = options.maxDepth ?? 2;
  const maxFiles = options.maxFiles ?? 120;
  let fileCount = 0;
  let previewableCount = 0;
  let latestMtimeMs = 0;
  async function visit(current, depth) {
    if (depth > maxDepth || fileCount >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (fileCount >= maxFiles) return;
      if (entry.isDirectory() && DEFAULT_SKIPPED_INVENTORY_DIRS.has(entry.name)) continue;
      const fullPath = path.join(current, entry.name);
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }
      latestMtimeMs = Math.max(latestMtimeMs, stat.mtimeMs || 0);
      if (entry.isFile()) {
        fileCount += 1;
        if (previewableLightFile(fullPath)) previewableCount += 1;
      } else if (entry.isDirectory()) {
        await visit(fullPath, depth + 1);
      }
    }
  }
  await visit(root, 0);
  return {
    fileCount,
    previewableCount,
    lastSyncedAt: latestMtimeMs ? new Date(latestMtimeMs).toISOString() : undefined,
  };
}

async function fileLastSyncedAt(filePath) {
  try {
    return new Date((await fs.stat(filePath)).mtimeMs).toISOString();
  } catch {
    return undefined;
  }
}

export function baseScanPreview(item, extra = {}) {
  return {
    title: item.name,
    status: previewStatus(item),
    badges: [typeBadge(item.type), sourceBadge(item.source), confidenceBadge(item)].filter(Boolean),
    description: item.description,
    detectedFrom: item.detectedFrom,
    ...extra,
  };
}

export async function skillScanPreview(item, filePath, raw) {
  return baseScanPreview(item, {
    snippetLabel: 'SKILL.md snippet',
    snippet: markdownLightSnippet(raw),
    folder: await lightFolderStats(path.dirname(filePath)),
  });
}

export async function fileScanPreview(item, filePath, options = {}) {
  const raw = await readFileStart(filePath);
  return baseScanPreview(item, {
    snippetLabel: options.snippetLabel || 'Redacted snippet',
    snippet: markdownLightSnippet(raw),
    lastSyncedAt: await fileLastSyncedAt(filePath),
  });
}

export async function pluginScanPreview(item, filePath, manifest) {
  return baseScanPreview(item, {
    snippetLabel: 'Redacted manifest',
    snippet: redactedJsonSnippet(manifest),
    folder: await lightFolderStats(path.dirname(path.dirname(filePath)), { maxDepth: 2, maxFiles: 120 }),
  });
}

export async function jsonManifestScanPreview(item, filePath, manifest, options = {}) {
  return baseScanPreview(item, {
    snippetLabel: options.snippetLabel || 'Redacted manifest',
    snippet: redactedJsonSnippet(manifest),
    lastSyncedAt: await fileLastSyncedAt(filePath),
  });
}

export function mcpScanPreview(item, serverConfig) {
  const snippet = serverConfig
    ? redactedJsonSnippet({ mcpServers: { [item.name]: serverConfig } })
    : '';
  return baseScanPreview(item, {
    snippetLabel: snippet ? 'Redacted snippet' : 'Config summary',
    snippet,
  });
}
