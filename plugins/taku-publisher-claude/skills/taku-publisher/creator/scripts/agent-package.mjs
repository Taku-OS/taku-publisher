import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stableId } from './cli.mjs';
import { readJsonFile } from './draft-state.mjs';
import { assertInlineSkillPackageIsPublic } from './skill-package.mjs';
import { normalizeStaxDisplayItemType } from './public-inventory-item.mjs';
import { cleanText, isRecord, publicText } from './privacy.mjs';

const TAKU_AGENT_MANIFEST_VERSION = 'taku.agent.v1';
const MAX_AGENT_MARKDOWN_SOURCE_BYTES = 192 * 1024;
const MAX_AGENT_REGISTRY_SOURCE_BYTES = 16 * 1024 * 1024;

function privateInventoryItems(privateInventory) {
  return Array.isArray(privateInventory?.items) ? privateInventory.items : [];
}

function findPrivateInventoryItem(privateInventory, item) {
  const id = typeof item?.id === 'string' ? item.id : '';
  if (!id) return null;
  return privateInventoryItems(privateInventory).find((entry) => entry?.id === id) || null;
}

export async function createInlineAgentDefinition(item, privateInventory) {
  if (!isRecord(item) || normalizeStaxDisplayItemType(item.type || item.kind, '') !== 'agent') {
    return undefined;
  }
  const privateItem = findPrivateInventoryItem(privateInventory, item);
  const localPath = typeof privateItem?.localPath === 'string' ? privateItem.localPath : '';
  if (!localPath) return undefined;

  const definition = await readAgentDefinitionFromPath(localPath, item);
  if (!definition) return undefined;
  const sanitized = sanitizeAgentDefinition(definition);
  if (!isRecord(sanitized)) return undefined;
  assertInlineSkillPackageIsPublic(
    JSON.stringify(sanitized, null, 2),
    item.name || item.title || 'agent definition'
  );

  const serialized = JSON.stringify(sanitized);
  return {
    kind: 'agent',
    format: TAKU_AGENT_MANIFEST_VERSION,
    definition: sanitized,
    hash: createHash('sha256').update(serialized).digest('hex'),
    size: Buffer.byteLength(serialized),
  };
}

export function sanitizeAgentDefinition(value, depth = 0) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth > 8) return [];
    return value
      .slice(0, 100)
      .map((entry) => sanitizeAgentDefinition(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (!isRecord(value) || depth > 8) return undefined;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    const sanitized = sanitizeAgentDefinition(entry, depth + 1);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

async function readAgentDefinitionFromPath(localPath, sourceItem) {
  const resolved = path.resolve(localPath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile() || stat.size <= 0) return undefined;
  const lower = path.basename(resolved).toLowerCase();
  if (lower.endsWith('.json')) {
    if (stat.size > MAX_AGENT_REGISTRY_SOURCE_BYTES) return undefined;
    return readJsonAgentDefinition(resolved, sourceItem);
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    if (stat.size > MAX_AGENT_MARKDOWN_SOURCE_BYTES) return undefined;
    return readMarkdownAgentDefinition(resolved, sourceItem);
  }
  return undefined;
}

async function readJsonAgentDefinition(filePath, sourceItem) {
  const manifest = await readJsonFile(filePath);
  if (!isRecord(manifest)) return undefined;
  if (Array.isArray(manifest.entries)) {
    return readRegistryAgentDefinition(filePath, manifest.entries, sourceItem);
  }
  return agentDefinitionFromManifest(filePath, manifest, sourceItem);
}

async function readRegistryAgentDefinition(filePath, entries, sourceItem) {
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const definition = isRecord(entry.definition) ? entry.definition : {};
    const entryType = normalizeStructuredItemType(entry.kind || definition.type || sourceItem.type, sourceItem.type || 'subagent');
    const entryName =
      cleanText(entry.name, 120) ||
      cleanText(definition.name, 120) ||
      cleanText(entry.slug, 120) ||
      'Untitled';
    const entryId = stableId(sourceItem.source, entryType, entry.id || entryName, filePath);
    if (entryId !== sourceItem.id) continue;
    if (isRecord(definition) && Object.keys(definition).length > 0) {
      return agentDefinitionFromManifest(filePath, definition, {
        ...sourceItem,
        name: sourceItem.name || entryName,
        description: sourceItem.description || entry.description || entry.shortDescription || definition.description,
      });
    }
    return agentDefinitionFromManifest(filePath, {
      kind: entry.kind,
      type: entry.kind,
      id: entry.id,
      name: entryName,
      description: entry.description || entry.shortDescription,
      sourceFormat: entry.sourceFormat,
    }, sourceItem);
  }
  return undefined;
}

async function readMarkdownAgentDefinition(filePath, sourceItem) {
  const raw = await fs.readFile(filePath, 'utf8');
  assertInlineSkillPackageIsPublic(raw, sourceItem.name || sourceItem.title || 'agent prompt', path.basename(filePath));
  const meta = parseFrontmatter(raw);
  const instructions = stripFrontmatter(raw);
  const name =
    cleanText(sourceItem.name, 160) ||
    cleanText(meta.name, 160) ||
    cleanText(meta.title, 160) ||
    firstMarkdownHeading(raw) ||
    cleanText(path.basename(filePath, path.extname(filePath)), 160) ||
    'Imported agent';
  const description = cleanText(sourceItem.description || meta.description || meta.summary, 360);
  return buildAgentManifest({
    id: `local:${slugify(name) || 'agent'}`,
    name,
    description,
    modelHint: cleanText(meta.model || meta.modelHint || meta.model_hint, 80),
    sourceFormat: inferSourceFormat(sourceItem.source),
    entryFile: path.basename(filePath),
    sourcePath: publicSourceName(filePath),
    instructions,
  });
}

function agentDefinitionFromManifest(filePath, manifest, sourceItem) {
  const existing = existingAgentDefinition(manifest);
  if (existing) return existing;

  const prompt = isRecord(manifest.prompt) && typeof manifest.prompt.content === 'string'
    ? manifest.prompt.content
    : '';
  const instructions = typeof manifest.instructions === 'string'
    ? manifest.instructions
    : prompt;
  if (!instructions.trim()) return undefined;
  assertInlineSkillPackageIsPublic(instructions, manifest.name || sourceItem.name || 'agent instructions');

  const name =
    cleanText(sourceItem.name, 160) ||
    cleanText(manifest.name || manifest.title, 160) ||
    cleanText(path.basename(filePath, path.extname(filePath)), 160) ||
    'Imported agent';
  return buildAgentManifest({
    id: cleanText(manifest.id, 220) || `local:${slugify(name) || 'agent'}`,
    name,
    description: cleanText(sourceItem.description || manifest.description || manifest.summary, 360),
    modelHint: cleanText(manifest.modelHint || manifest.model_hint || manifest.model, 80),
    sourceFormat: cleanText(manifest.sourceFormat || manifest.source_format, 80) || inferSourceFormat(sourceItem.source),
    entryFile: cleanText(manifest.entryFile || manifest.entry_file, 220),
    sourcePath: publicSourceName(filePath),
    instructions,
    resources: stringList(manifest.resources, 12, 220),
    warnings: stringList(manifest.warnings, 12, 220),
  });
}

function existingAgentDefinition(manifest) {
  if (!isRecord(manifest)) return null;
  if (
    manifest.schemaVersion === TAKU_AGENT_MANIFEST_VERSION ||
    manifest.schema_version === TAKU_AGENT_MANIFEST_VERSION ||
    manifest.type === 'agent' ||
    manifest.executionMode === 'delegated-agent'
  ) {
    return manifest;
  }
  const definition = isRecord(manifest.definition) ? manifest.definition : null;
  if (!definition) return null;
  return existingAgentDefinition(definition);
}

function buildAgentManifest(input) {
  const instructions = typeof input.instructions === 'string' ? input.instructions.trim() : '';
  return {
    schemaVersion: TAKU_AGENT_MANIFEST_VERSION,
    type: 'agent',
    id: input.id,
    name: input.name,
    description: input.description,
    sourceFormat: input.sourceFormat || 'markdown-agent',
    entryFile: input.entryFile ?? null,
    modelHint: input.modelHint,
    executionMode: 'delegated-agent',
    execution: {
      mode: 'delegated-agent',
      adapter: 'taku-agent-runtime',
    },
    instructions,
    prompt: {
      role: 'system',
      content: instructions,
    },
    dependencies: {},
    requirements: [],
    readiness: instructions
      ? {
          status: 'ready',
          label: 'Ready',
          reason: 'This agent can be loaded as a delegated Taku prompt.',
          checks: [],
        }
      : {
          status: 'degraded',
          label: 'Needs source context',
          reason: 'The agent was published without source instructions.',
          checks: [],
        },
    limits: {
      externalExecution: 'blocked',
      hooks: 'blocked',
      mcp: 'needs-config',
      fileWrites: 'chat-output',
      network: 'needs-config',
    },
    resources: uniqueStrings(input.resources ?? []),
    warnings: uniqueStrings(input.warnings ?? []),
    source: {
      kind: 'local-upload',
      path: input.sourcePath,
      entryFile: input.entryFile ?? undefined,
    },
    runtime: {
      adapter: 'taku-agent-runtime',
      contextPolicy: 'child-agent',
      note:
        'Installed agents are delegated child-agent prompts. Plugin hooks, MCP servers, and external commands are not enabled automatically.',
    },
  };
}

function normalizeStructuredItemType(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'agent' || normalized === 'agents' || normalized === 'subagent' || normalized === 'subagents') return 'subagent';
  return fallback;
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---')) return {};
  const end = markdown.indexOf('\n---', 3);
  if (end < 0) return {};
  const raw = markdown.slice(3, end).trim();
  const result = {};
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (/^[>|][+-]?$/.test(value.trim())) {
      const block = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (/^[A-Za-z0-9_-]+:\s*/.test(next)) break;
        index += 1;
        block.push(next.replace(/^\s{2,}/, ''));
      }
      result[key] = block.join(value.trim().startsWith('|') ? '\n' : ' ').trim();
    } else {
      result[key] = value.replace(/^['"]|['"]$/g, '').trim();
    }
  }
  return result;
}

function stripFrontmatter(markdown) {
  if (!markdown.startsWith('---')) return markdown.trim();
  const end = markdown.indexOf('\n---', 3);
  if (end < 0) return markdown.trim();
  return markdown.slice(end + 4).trim();
}

function firstMarkdownHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return cleanText(match?.[1], 120);
}

function inferSourceFormat(source) {
  const text = String(source || '').toLowerCase();
  if (text.includes('claude')) return 'claude-agent-md';
  if (text.includes('cursor')) return 'cursor-agent-md';
  if (text.includes('codex')) return 'codex-agent-md';
  return 'markdown-agent';
}

function publicSourceName(filePath) {
  return path.basename(filePath);
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stringList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => publicText(entry, maxLength)).filter(Boolean).slice(0, maxItems);
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
