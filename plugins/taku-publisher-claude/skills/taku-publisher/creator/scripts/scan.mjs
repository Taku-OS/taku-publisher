import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  createPrivateInventory,
  dedupeItems,
  publicItem,
} from '#taku-passport-core';
import {
  exists,
  getHomeDir,
  isDirectory,
  redactPath,
  stableId,
} from './cli.mjs';
import { readJsonFile } from './draft-state.mjs';
import { cleanText } from './privacy.mjs';
import {
  DEFAULT_SKIPPED_INVENTORY_DIRS,
  fileScanPreview,
  jsonManifestScanPreview,
  mcpScanPreview,
  pluginScanPreview,
  readFileStart,
  skillScanPreview,
} from './scan-preview.mjs';

export {
  createPrivateInventory,
  dedupeItems,
  publicItem,
} from '#taku-passport-core';

const DEFAULT_MAX_INVENTORY_FILES = 1200;
const CLAUDE_PLUGIN_STATUS_TIMEOUT_MS = 3000;
const execFileAsync = promisify(execFile);

export function parseFrontmatter(markdown) {
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

export async function readSkillFile(filePath, source) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const meta = parseFrontmatter(raw);
    const name =
      cleanText(meta.name, 120) ||
      cleanText(path.basename(path.dirname(filePath)), 120) ||
      'Untitled Skill';
    const item = {
      id: stableId(source, name, filePath),
      type: 'skill',
      source,
      name,
      description: cleanText(meta.description),
      detectedFrom: 'SKILL.md',
      localPath: filePath,
    };
    return {
      ...item,
      scanPreview: await skillScanPreview(item, filePath, raw),
    };
  } catch {
    return null;
  }
}

export async function walkForSkillFiles(root, options = {}) {
  const maxDepth = options.maxDepth ?? 4;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_INVENTORY_FILES;
  const results = [];
  const visitedDirectories = new Set();
  const seenFiles = new Set();

  async function visit(dir, depth) {
    if (depth > maxDepth || results.length >= maxFiles) return;

    let realDirectory;
    try {
      const stat = await fs.stat(dir);
      if (!stat.isDirectory()) return;
      realDirectory = await fs.realpath(dir);
    } catch {
      return;
    }
    if (visitedDirectories.has(realDirectory)) return;
    visitedDirectories.add(realDirectory);

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.name === 'SKILL.md') {
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try {
            isFile = (await fs.stat(fullPath)).isFile();
          } catch {
            isFile = false;
          }
        }
        if (!isFile) continue;
        const realFile = await fs.realpath(fullPath).catch(() => fullPath);
        if (!seenFiles.has(realFile)) {
          seenFiles.add(realFile);
          results.push(fullPath);
        }
        continue;
      }
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        await visit(fullPath, depth + 1);
      }
    }
  }
  await visit(root, 0);
  return results;
}

export async function walkForFiles(root, options = {}) {
  const maxDepth = options.maxDepth ?? 4;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_INVENTORY_FILES;
  const shouldInclude = options.include || (() => false);
  const skippedDirs = options.skippedDirs || DEFAULT_SKIPPED_INVENTORY_DIRS;
  const results = [];
  async function visit(current, depth) {
    if (depth > maxDepth || results.length >= maxFiles) return;
    let stat;
    try {
      stat = await fs.stat(current);
    } catch {
      return;
    }
    if (stat.isFile()) {
      if (shouldInclude(current, path.basename(current))) results.push(current);
      return;
    }
    if (!stat.isDirectory()) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (entry.isDirectory() && skippedDirs.has(entry.name)) continue;
      await visit(path.join(current, entry.name), depth + 1);
    }
  }
  await visit(root, 0);
  return results;
}

function firstMarkdownHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return cleanText(match?.[1], 120);
}

export function defaultToolRoots() {
  const home = getHomeDir();
  const roots = [
    { source: 'codex', path: path.join(home, '.codex', 'skills') },
    { source: 'claude-code', path: path.join(home, '.claude', 'skills') },
    { source: 'taku', path: path.join(home, '.taku', 'skills') },
    { source: 'cursor', path: path.join(home, '.cursor', 'skills') },
  ];
  if (process.env.TAKU_CREATOR_EXTRA_SKILL_ROOTS) {
    for (const raw of process.env.TAKU_CREATOR_EXTRA_SKILL_ROOTS.split(path.delimiter)) {
      if (raw.trim()) roots.push({ source: 'custom', path: path.resolve(raw.trim()) });
    }
  }
  return roots;
}

export async function scanUsedTools(workspaceRoot) {
  const tools = [];
  const roots = [];
  await scanSkillInventory(roots, tools);
  await scanSubagentInventory(roots, tools, workspaceRoot);
  await scanSlashCommandInventory(roots, tools, workspaceRoot);
  await scanCodexPluginInventory(roots, tools);
  await scanTakuPluginInventory(roots, tools);
  await scanCursorPluginInventory(roots, tools);
  await scanClaudePluginInventory(roots, tools);
  await scanMcpInventory(roots, tools);
  await scanWorkflowInventory(roots, tools, workspaceRoot);
  await scanAgentInstructionInventory(roots, tools, workspaceRoot);
  return { roots, tools: dedupeItems(tools) };
}

function platformInventoryRoots(kind, workspaceRoot) {
  const home = getHomeDir();
  const directoryName = {
    subagent: 'agents',
    'slash-command': 'commands',
    workflow: 'workflows',
  }[kind] || `${kind}s`;
  const specs = [
    { platform: 'codex', homeDir: '.codex' },
    { platform: 'claude', homeDir: '.claude' },
    { platform: 'taku', homeDir: '.taku' },
    { platform: 'cursor', homeDir: '.cursor' },
  ];
  const roots = [];
  for (const spec of specs) {
    roots.push({
      source: `${spec.platform}-${kind}`,
      path: path.join(home, spec.homeDir, directoryName),
      maxDepth: 4,
      structured: true,
    });
  }
  if (workspaceRoot) {
    const resolved = path.resolve(workspaceRoot);
    for (const spec of specs) {
      roots.push({
        source: `workspace-${spec.platform}-${kind}`,
        path: path.join(resolved, spec.homeDir, directoryName),
        maxDepth: 4,
        structured: true,
      });
    }
  }
  return roots;
}

function inventoryFileKind(filePath, basename) {
  const lower = String(basename || path.basename(filePath)).toLowerCase();
  const ext = path.extname(lower);
  if (lower === 'registry.json') return 'registry';
  if (lower === 'workflow.json' || lower === 'taku.workflow.json' || lower.endsWith('.workflow.json')) return 'workflow';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.json') return 'json';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  if (ext === '.toml') return 'toml';
  return '';
}

function isStructuredInventoryFile(filePath, basename) {
  return Boolean(inventoryFileKind(filePath, basename));
}

async function scanStructuredInventoryRoots(roots, tools, rootsToScan, options = {}) {
  const itemType = options.itemType || 'tool';
  const rootType = options.rootType || `${itemType}-root`;
  const fallbackDescription = options.fallbackDescription || 'Local inventory item';
  for (const root of rootsToScan) {
    const rootExists = await isDirectory(root.path);
    roots.push({
      source: root.source,
      type: rootType,
      exists: rootExists,
      path: redactPath(root.path),
    });
    if (!rootExists) continue;
    const files = await walkForFiles(root.path, {
      maxDepth: root.maxDepth ?? 4,
      maxFiles: root.maxFiles ?? 300,
      include: root.structured
        ? isStructuredInventoryFile
        : (filePath, basename) => inventoryFileKind(filePath, basename) === 'workflow',
    });
    for (const filePath of files) {
      const items = await readStructuredInventoryFile(filePath, root.source, itemType, fallbackDescription);
      for (const item of items) tools.push(item);
    }
  }
}

async function scanSubagentInventory(roots, tools, workspaceRoot) {
  await scanStructuredInventoryRoots(roots, tools, platformInventoryRoots('subagent', workspaceRoot), {
    itemType: 'subagent',
    rootType: 'subagent-root',
    fallbackDescription: 'Delegated subagent.',
  });
}

async function scanSlashCommandInventory(roots, tools, workspaceRoot) {
  await scanStructuredInventoryRoots(roots, tools, platformInventoryRoots('slash-command', workspaceRoot), {
    itemType: 'slash-command',
    rootType: 'slash-command-root',
    fallbackDescription: 'Slash command.',
  });
}

async function readStructuredInventoryFile(filePath, source, itemType, fallbackDescription) {
  const kind = inventoryFileKind(filePath);
  if (kind === 'markdown') {
    const item = await readMarkdownWorkflow(filePath, source, itemType, fallbackDescription);
    return item ? [item] : [];
  }
  if (kind === 'workflow' && itemType === 'workflow') {
    const item = await readJsonWorkflow(filePath, source);
    return item ? [item] : [];
  }
  if (kind === 'json' || kind === 'registry' || kind === 'workflow') {
    const manifest = await readJsonFile(filePath);
    if (!manifest) return [];
    if (Array.isArray(manifest.entries)) {
      const items = [];
      for (const entry of manifest.entries) {
        const item = await readRegistryEntry(filePath, source, itemType, fallbackDescription, entry);
        if (item) items.push(item);
        if (itemType === 'workflow') {
          items.push(...await readRegistryEntryCommands(filePath, source, entry));
        }
      }
      return items;
    }
    const item = await readStructuredJsonItem(filePath, source, itemType, fallbackDescription, manifest);
    return item ? [item] : [];
  }
  if (kind === 'yaml' || kind === 'toml') {
    const item = await readStructuredTextItem(filePath, source, itemType, fallbackDescription);
    return item ? [item] : [];
  }
  return [];
}

async function readRegistryEntry(filePath, source, itemType, fallbackDescription, entry) {
  if (!entry || typeof entry !== 'object') return null;
  const definition = entry.definition && typeof entry.definition === 'object' ? entry.definition : {};
  const type = normalizeStructuredItemType(entry.kind || definition.type || itemType, itemType);
  const name =
    cleanText(entry.name, 120) ||
    cleanText(definition.name, 120) ||
    cleanText(definition.commandName, 120) ||
    cleanText(entry.slug, 120) ||
    'Untitled';
  const description = cleanText(
    entry.shortDescription ||
    entry.description ||
    definition.description ||
    definition.summary ||
    fallbackDescription,
  );
  const item = {
    id: stableId(source, type, entry.id || name, filePath),
    type,
    source,
    name,
    description,
    detectedFrom: path.basename(filePath),
    localPath: filePath,
  };
  return {
    ...item,
    scanPreview: await jsonManifestScanPreview(item, filePath, compactStructuredManifest(entry, definition)),
  };
}

async function readRegistryEntryCommands(filePath, source, entry) {
  const definition = entry?.definition && typeof entry.definition === 'object' ? entry.definition : {};
  if (!Array.isArray(definition.commands) || definition.commands.length === 0) return [];
  const commandSource = source.replace(/-workflow$/, '-slash-command');
  const parentName = cleanText(entry.name || definition.name, 120);
  const items = [];
  for (const command of definition.commands) {
    if (!command || typeof command !== 'object') continue;
    const commandName =
      cleanText(command.commandName, 120) ||
      cleanText(command.title, 120) ||
      cleanText(command.entryFile ? path.basename(command.entryFile, path.extname(command.entryFile)) : '', 120);
    if (!commandName) continue;
    const name = commandName.startsWith('/') ? commandName : `/${commandName}`;
    const item = {
      id: stableId(commandSource, 'slash-command', entry.id || parentName || '', name, filePath),
      type: 'slash-command',
      source: commandSource,
      name,
      description: cleanText(command.description || parentName || 'Slash command.'),
      detectedFrom: path.basename(filePath),
      localPath: filePath,
    };
    items.push({
      ...item,
      scanPreview: await jsonManifestScanPreview(item, filePath, {
        parent: parentName,
        commandName: command.commandName,
        title: command.title,
        description: command.description,
        entryFile: command.entryFile,
        sourceFormat: command.sourceFormat || definition.sourceFormat,
      }),
    });
  }
  return items;
}

async function readStructuredJsonItem(filePath, source, itemType, fallbackDescription, manifest) {
  const type = normalizeStructuredItemType(manifest.kind || manifest.type || itemType, itemType);
  const name =
    cleanText(manifest.name, 120) ||
    cleanText(manifest.title, 120) ||
    cleanText(manifest.commandName, 120) ||
    cleanText(path.basename(filePath, path.extname(filePath)), 120) ||
    'Untitled';
  const item = {
    id: stableId(source, type, name, filePath),
    type,
    source,
    name,
    description: cleanText(manifest.description || manifest.summary || manifest.shortDescription || fallbackDescription),
    detectedFrom: path.basename(filePath),
    localPath: filePath,
  };
  return {
    ...item,
    scanPreview: await jsonManifestScanPreview(item, filePath, compactStructuredManifest(manifest)),
  };
}

async function readStructuredTextItem(filePath, source, itemType, fallbackDescription) {
  const raw = await readFileStart(filePath);
  if (!raw) return null;
  const meta = parseSimpleKeyValueHeader(raw);
  const name =
    cleanText(meta.name, 120) ||
    cleanText(meta.title, 120) ||
    cleanText(path.basename(filePath, path.extname(filePath)), 120) ||
    'Untitled';
  const item = {
    id: stableId(source, itemType, name, filePath),
    type: itemType,
    source,
    name,
    description: cleanText(meta.description || meta.summary || fallbackDescription),
    detectedFrom: path.basename(filePath),
    localPath: filePath,
  };
  return {
    ...item,
    scanPreview: await fileScanPreview(item, filePath, { snippetLabel: 'Redacted definition snippet' }),
  };
}

function normalizeStructuredItemType(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'agent' || normalized === 'agents' || normalized === 'subagent' || normalized === 'subagents') return 'subagent';
  if (normalized === 'command' || normalized === 'commands' || normalized === 'slash-command' || normalized === 'slash_command') return 'slash-command';
  if (normalized === 'workflow' || normalized === 'workflows' || normalized === 'action' || normalized === 'actions') return 'workflow';
  return fallback;
}

function compactStructuredManifest(value, definition = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const def = definition && typeof definition === 'object' ? definition : {};
  const output = {};
  for (const key of ['id', 'kind', 'type', 'name', 'slug', 'title', 'commandName', 'shortDescription', 'description', 'creatorUsername', 'source', 'sourceFormat', 'storagePath', 'installedAt', 'updatedAt']) {
    if (source[key] !== undefined) output[key] = source[key];
    else if (def[key] !== undefined) output[key] = def[key];
  }
  if (Array.isArray(def.commands)) {
    output.commands = def.commands.slice(0, 16).map((command) => ({
      commandName: command.commandName,
      title: command.title,
      description: command.description,
      entryFile: command.entryFile,
    }));
  }
  return output;
}

function parseSimpleKeyValueHeader(raw) {
  const result = {};
  for (const line of String(raw || '').split(/\r?\n/).slice(0, 80)) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*(?::|=)\s*(.+?)\s*$/);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return result;
}

async function scanSkillInventory(roots, tools) {
  for (const root of defaultToolRoots()) {
    const rootExists = await isDirectory(root.path);
    roots.push({
      source: root.source,
      type: 'skill-root',
      exists: rootExists,
      path: redactPath(root.path),
    });
    if (!rootExists) continue;
    const skillFiles = await walkForSkillFiles(root.path, { maxDepth: 5 });
    for (const filePath of skillFiles) {
      const item = await readSkillFile(filePath, root.source);
      if (item) tools.push(item);
    }
  }
}

async function scanCodexPluginInventory(roots, tools) {
  const rootPath = path.join(getHomeDir(), '.codex', 'plugins', 'cache');
  const rootExists = await isDirectory(rootPath);
  roots.push({
    source: 'codex-plugin',
    type: 'plugin-cache',
    exists: rootExists,
    path: redactPath(rootPath),
  });
  if (!rootExists) return;
  const pluginFiles = await walkForFiles(rootPath, {
    maxDepth: 8,
    include: (filePath) => filePath.endsWith(path.join('.codex-plugin', 'plugin.json')),
  });
  for (const filePath of pluginFiles) {
    const item = await readPluginManifest(filePath, 'codex-plugin');
    if (item) tools.push(item);
  }
}

async function scanTakuPluginInventory(roots, tools) {
  const rootPath = path.join(getHomeDir(), '.taku', 'plugins');
  const rootExists = await isDirectory(rootPath);
  roots.push({
    source: 'taku-plugin',
    type: 'plugin-root',
    exists: rootExists,
    path: redactPath(rootPath),
  });
  if (!rootExists) return;
  const pluginFiles = await walkForFiles(rootPath, {
    maxDepth: 6,
    maxFiles: 300,
    include: (_filePath, basename) => basename === 'plugin.json' || basename === 'taku.stax.json',
  });
  for (const filePath of pluginFiles) {
    const item = await readPluginManifest(filePath, 'taku-plugin');
    if (item) tools.push(item);
  }
}

async function scanCursorPluginInventory(roots, tools) {
  const rootPath = path.join(getHomeDir(), '.cursor', 'extensions');
  const rootExists = await isDirectory(rootPath);
  roots.push({
    source: 'cursor-plugin',
    type: 'plugin-root',
    exists: rootExists,
    path: redactPath(rootPath),
  });
  if (!rootExists) return;
  const pluginFiles = await walkForFiles(rootPath, {
    maxDepth: 2,
    maxFiles: 400,
    include: (_filePath, basename) => basename === 'package.json',
  });
  for (const filePath of pluginFiles) {
    const item = await readCursorPluginManifest(filePath);
    if (item) tools.push(item);
  }
}

async function scanClaudePluginInventory(roots, tools) {
  const installedPath = path.join(getHomeDir(), '.claude', 'plugins', 'installed_plugins.json');
  const cacheRoot = path.join(getHomeDir(), '.claude', 'plugins', 'cache');
  const statusInfo = await readClaudePluginStatusInfo();
  roots.push({
    source: 'claude-plugin',
    type: 'plugin-registry',
    exists: await exists(installedPath),
    path: redactPath(installedPath),
  });
  roots.push({
    source: 'claude-plugin-status',
    type: 'plugin-status',
    exists: statusInfo.available,
    detectedFrom: statusInfo.detectedFrom,
    enabledCount: statusInfo.enabledCount,
    disabledCount: statusInfo.disabledCount,
  });
  const installed = await readJsonFile(installedPath);
  const installPaths = new Set();
  for (const [pluginKey, versions] of Object.entries(installed?.plugins || {})) {
    const latest = Array.isArray(versions) ? versions[versions.length - 1] : undefined;
    const availability = getClaudePluginAvailability(statusInfo, pluginKey);
    if (!shouldScanClaudePlugin(statusInfo, pluginKey)) continue;
    if (latest?.installPath) installPaths.add(latest.installPath);
    const [name, marketplace] = pluginKey.split('@');
    tools.push({
      id: stableId('claude-plugin', pluginKey),
      type: 'plugin',
      source: 'claude-plugin',
      name: cleanText(name, 120) || pluginKey,
      description: marketplace ? `Claude plugin from ${marketplace}.` : 'Claude plugin.',
      detectedFrom: 'installed_plugins.json',
      availability,
      localPath: latest?.installPath || installedPath,
    });
  }

  const cacheExists = await isDirectory(cacheRoot);
  roots.push({
    source: 'claude-plugin-cache',
    type: 'plugin-cache',
    exists: cacheExists,
    path: redactPath(cacheRoot),
  });
  if (cacheExists) {
    const pluginFiles = await walkForFiles(cacheRoot, {
      maxDepth: 8,
      include: (filePath) => filePath.endsWith(path.join('.claude-plugin', 'plugin.json')),
    });
    for (const filePath of pluginFiles) {
      const pluginKey = claudePluginKeyFromCachePath(cacheRoot, filePath);
      if (!shouldScanClaudePlugin(statusInfo, pluginKey)) continue;
      const item = await readPluginManifest(filePath, 'claude-plugin', {
        availability: getClaudePluginAvailability(statusInfo, pluginKey),
      });
      if (item) tools.push(item);
      installPaths.add(path.dirname(path.dirname(filePath)));
    }
  }

  for (const installPath of installPaths) {
    const pluginKey = claudePluginKeyFromInstallPath(cacheRoot, installPath);
    if (!shouldScanClaudePlugin(statusInfo, pluginKey)) continue;
    const availability = getClaudePluginAvailability(statusInfo, pluginKey);
    await scanClaudePluginWorkflows(installPath, tools, { availability });
    await scanMcpJsonFile(path.join(installPath, '.mcp.json'), 'claude-plugin-mcp', tools, undefined, { availability });
  }
}

async function readClaudePluginStatusInfo() {
  try {
    const { stdout } = await execFileAsync('claude', ['plugin', 'list'], {
      timeout: CLAUDE_PLUGIN_STATUS_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const statuses = parseClaudePluginList(stdout);
    return {
      available: true,
      detectedFrom: 'claude plugin list',
      statuses,
      enabledCount: countMapValues(statuses, 'enabled'),
      disabledCount: countMapValues(statuses, 'disabled'),
    };
  } catch {
    return {
      available: false,
      detectedFrom: 'claude plugin list unavailable',
      statuses: new Map(),
      enabledCount: 0,
      disabledCount: 0,
    };
  }
}

function parseClaudePluginList(output) {
  const statuses = new Map();
  let currentKey;
  for (const line of String(output || '').split(/\r?\n/)) {
    const pluginMatch = line.match(/^\s*(?:[^\w@./-]+\s*)?([A-Za-z0-9._-]+@[A-Za-z0-9._-]+)\s*$/);
    if (pluginMatch) {
      currentKey = normalizePluginKey(pluginMatch[1]);
      continue;
    }
    const statusMatch = line.match(/\bStatus:\s*(?:[^\w]+)?\s*(enabled|disabled)\b/i);
    if (statusMatch && currentKey) {
      statuses.set(currentKey, statusMatch[1].toLowerCase());
    }
  }
  return statuses;
}

function countMapValues(map, value) {
  let count = 0;
  for (const item of map.values()) {
    if (item === value) count += 1;
  }
  return count;
}

function normalizePluginKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getClaudePluginAvailability(statusInfo, pluginKey) {
  if (!pluginKey) return statusInfo.available ? 'unlisted' : 'unknown';
  const status = statusInfo.statuses.get(normalizePluginKey(pluginKey));
  if (status) return status;
  return statusInfo.available ? 'unlisted' : 'unknown';
}

function shouldScanClaudePlugin(statusInfo, pluginKey) {
  const availability = getClaudePluginAvailability(statusInfo, pluginKey);
  if (availability === 'enabled') return true;
  if (availability === 'disabled') return false;
  return !statusInfo.available;
}

function claudePluginKeyFromCachePath(cacheRoot, filePath) {
  const parts = path.relative(cacheRoot, filePath).split(path.sep);
  return parts.length >= 2 ? `${parts[1]}@${parts[0]}` : undefined;
}

function claudePluginKeyFromInstallPath(cacheRoot, installPath) {
  const parts = path.relative(cacheRoot, installPath).split(path.sep);
  return parts.length >= 2 ? `${parts[1]}@${parts[0]}` : undefined;
}

async function readPluginManifest(filePath, source, extra = {}) {
  const manifest = await readJsonFile(filePath);
  if (!manifest) return null;
  const name =
    cleanText(manifest.name, 120) ||
    cleanText(manifest.title, 120) ||
    cleanText(path.basename(path.dirname(path.dirname(filePath))), 120) ||
    'Untitled Plugin';
  const item = {
    id: stableId(source, 'plugin', name, filePath),
    type: 'plugin',
    source,
    name,
    description: cleanText(manifest.description || manifest.summary || manifest.title),
    detectedFrom: path.basename(path.dirname(filePath)) === '.codex-plugin'
      ? '.codex-plugin/plugin.json'
      : path.basename(path.dirname(filePath)) === '.claude-plugin'
        ? '.claude-plugin/plugin.json'
        : 'plugin.json',
    ...extra,
    localPath: filePath,
  };
  return {
    ...item,
    scanPreview: await pluginScanPreview(item, filePath, manifest),
  };
}

async function readCursorPluginManifest(filePath) {
  const manifest = await readJsonFile(filePath);
  if (!manifest || !isAiRelevantCursorExtension(manifest)) return null;
  const name =
    cleanText(manifest.displayName, 120) ||
    cleanText(manifest.name, 120) ||
    cleanText(path.basename(path.dirname(filePath)), 120) ||
    'Untitled Cursor Extension';
  const item = {
    id: stableId('cursor-plugin', 'plugin', name, filePath),
    type: 'plugin',
    source: 'cursor-plugin',
    name,
    description: cleanText(manifest.description || manifest.summary || manifest.publisher),
    detectedFrom: 'package.json',
    localPath: filePath,
  };
  return {
    ...item,
    scanPreview: await pluginScanPreview(item, filePath, manifest),
  };
}

function isAiRelevantCursorExtension(manifest) {
  const keywords = Array.isArray(manifest.keywords) ? manifest.keywords.join(' ') : '';
  const categories = Array.isArray(manifest.categories) ? manifest.categories.join(' ') : '';
  const text = [
    manifest.name,
    manifest.displayName,
    manifest.publisher,
    manifest.description,
    keywords,
    categories,
  ].filter(Boolean).join(' ').toLowerCase();
  return /\b(ai|agent|agents|assistant|chat|copilot|claude|openai|anthropic|gpt|llm|mcp|cursor)\b/.test(text);
}

async function scanClaudePluginWorkflows(installPath, tools, extra = {}) {
  const workflowSpecs = [
    { dir: 'commands', type: 'slash-command', label: 'Claude slash command' },
    { dir: 'agents', type: 'subagent', label: 'Claude subagent' },
  ];
  for (const spec of workflowSpecs) {
    const root = path.join(installPath, spec.dir);
    if (!await isDirectory(root)) continue;
    const files = await walkForFiles(root, {
      maxDepth: 2,
      include: (_filePath, basename) => basename.endsWith('.md'),
    });
    for (const filePath of files) {
      const item = await readMarkdownWorkflow(filePath, 'claude-plugin', spec.type, spec.label, extra);
      if (item) tools.push(item);
    }
  }
}

async function readMarkdownWorkflow(filePath, source, type = 'workflow', fallbackDescription = 'Workflow', extra = {}) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const meta = parseFrontmatter(raw);
    const name =
      cleanText(meta.name, 120) ||
      firstMarkdownHeading(raw) ||
      cleanText(path.basename(filePath, path.extname(filePath)), 120) ||
      'Untitled Workflow';
    const item = {
      id: stableId(source, type, name, filePath),
      type,
      source,
      name,
      description: cleanText(meta.description || fallbackDescription),
      detectedFrom: path.basename(filePath),
      ...extra,
      localPath: filePath,
    };
    return {
      ...item,
      scanPreview: await fileScanPreview(item, filePath, { snippetLabel: 'Redacted workflow snippet' }),
    };
  } catch {
    return null;
  }
}

async function scanMcpInventory(roots, tools) {
  const home = getHomeDir();
  await scanCodexTomlInventory(path.join(home, '.codex', 'config.toml'), roots, tools);
  await scanMcpJsonFile(path.join(home, '.claude', 'settings.json'), 'claude-mcp', tools, roots);
  await scanMcpJsonFile(path.join(home, '.claude', 'config.json'), 'claude-mcp', tools, roots);
  await scanMcpJsonFile(path.join(home, '.cursor', 'mcp.json'), 'cursor-mcp', tools, roots);

  const cursorRoots = [
    path.join(home, '.cursor', 'extensions'),
    path.join(home, '.cursor', 'projects'),
  ];
  for (const rootPath of cursorRoots) {
    const rootExists = await isDirectory(rootPath);
    roots.push({
      source: 'cursor-mcp',
      type: 'mcp-cache',
      exists: rootExists,
      path: redactPath(rootPath),
    });
    if (!rootExists) continue;
    const mcpFiles = await walkForFiles(rootPath, {
      maxDepth: rootPath.endsWith('projects') ? 2 : 5,
      maxFiles: 200,
      include: (_filePath, basename) => basename === 'mcp.json' || basename === 'mcp-cache.json',
    });
    for (const filePath of mcpFiles) {
      await scanMcpJsonFile(filePath, 'cursor-mcp', tools);
    }
  }
}

async function scanCodexTomlInventory(filePath, roots, tools) {
  const fileExists = await exists(filePath);
  roots.push({
    source: 'codex-config',
    type: 'agent-config',
    exists: fileExists,
    path: redactPath(filePath),
  });
  if (!fileExists) return;
  let raw = '';
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return;
  }
  const pluginMatches = raw.matchAll(/^\[plugins\."([^"]+)"\]/gm);
  for (const match of pluginMatches) {
    const pluginKey = match[1];
    const [name, marketplace] = pluginKey.split('@');
    tools.push({
      id: stableId('codex-config', 'plugin', pluginKey),
      type: 'plugin',
      source: 'codex-config',
      name: cleanText(name, 120) || pluginKey,
      description: marketplace ? `Enabled Codex plugin from ${marketplace}.` : 'Enabled Codex plugin.',
      detectedFrom: 'config.toml',
      localPath: filePath,
    });
  }
  const mcpMatches = raw.matchAll(/^\[mcp_servers\.([^\]\.]+)\]/gm);
  for (const match of mcpMatches) {
    const name = match[1].replace(/^"|"$/g, '');
    tools.push(createMcpItem(name, 'codex-mcp', filePath, 'config.toml'));
  }
}

async function scanMcpJsonFile(filePath, source, tools, roots, extra = {}) {
  const fileExists = await exists(filePath);
  if (roots) {
    roots.push({
      source,
      type: 'mcp-config',
      exists: fileExists,
      path: redactPath(filePath),
    });
  }
  if (!fileExists) return;
  const config = await readJsonFile(filePath);
  const servers = config?.mcpServers || config?.mcp_servers || config?.servers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return;
  for (const name of Object.keys(servers)) {
    tools.push(createMcpItem(name, source, filePath, path.basename(filePath), extra, servers[name]));
  }
}

function createMcpItem(name, source, filePath, detectedFrom, extra = {}, serverConfig) {
  const item = {
    id: stableId(source, 'mcp-server', name, filePath),
    type: 'mcp-server',
    source,
    name: cleanText(name, 120) || 'Untitled MCP Server',
    description: 'Configured MCP/tool server. Command, args, env, and secrets are not included.',
    detectedFrom,
    ...extra,
    localPath: filePath,
  };
  return {
    ...item,
    scanPreview: mcpScanPreview(item, serverConfig),
  };
}

async function scanWorkflowInventory(roots, tools, workspaceRoot) {
  const rootsToScan = [
    ...platformInventoryRoots('workflow', workspaceRoot),
    { source: 'workspace-workflow', path: workspaceRoot || process.cwd(), maxDepth: 3, structured: false },
  ];
  await scanStructuredInventoryRoots(roots, tools, rootsToScan, {
    itemType: 'workflow',
    rootType: 'workflow-root',
    fallbackDescription: 'AI workflow.',
  });
}

async function scanAgentInstructionInventory(roots, tools, workspaceRoot) {
  const home = getHomeDir();
  const rootsToScan = [
    { source: 'workspace-agents-md', path: workspaceRoot || process.cwd(), maxDepth: 3 },
    { source: 'codex-agents-md', path: path.join(home, '.codex'), maxDepth: 2 },
  ];
  const names = new Set(['agents.md', 'agent.md']);
  for (const root of rootsToScan) {
    const rootExists = await isDirectory(root.path);
    roots.push({
      source: root.source,
      type: 'agent-instructions-root',
      exists: rootExists,
      path: redactPath(root.path),
    });
    if (!rootExists) continue;
    const files = await walkForFiles(root.path, {
      maxDepth: root.maxDepth,
      maxFiles: 160,
      include: (_filePath, basename) => names.has(String(basename || '').toLowerCase()),
    });
    for (const filePath of files) {
      const item = await readAgentInstructionFile(filePath, root.source);
      if (item) tools.push(item);
    }
  }
}

async function readAgentInstructionFile(filePath, source) {
  const raw = await readFileStart(filePath);
  if (!raw) return null;
  const name = cleanText(path.basename(filePath), 120) || 'AGENTS.md';
  const title = firstMarkdownHeading(raw);
  const item = {
    id: stableId(source, 'agents-md', filePath),
    type: 'agents-md',
    source,
    name,
    description: title || 'Agent instruction file.',
    detectedFrom: path.basename(filePath),
    localPath: filePath,
  };
  return {
    ...item,
    scanPreview: await fileScanPreview(item, filePath, { snippetLabel: 'Redacted snippet' }),
  };
}

async function readJsonWorkflow(filePath, source) {
  const manifest = await readJsonFile(filePath);
  if (!manifest) return null;
  const name =
    cleanText(manifest?.name, 120) ||
    cleanText(manifest?.title, 120) ||
    cleanText(path.basename(path.dirname(filePath)), 120) ||
    'Untitled Workflow';
  const item = {
    id: stableId(source, 'workflow', name, filePath),
    type: 'workflow',
    source,
    name,
    description: cleanText(manifest?.description || manifest?.summary || manifest?.shortDescription || manifest?.short_description),
    detectedFrom: path.basename(filePath),
    localPath: filePath,
  };
  return {
    ...item,
    scanPreview: await jsonManifestScanPreview(item, filePath, manifest),
  };
}

function withOwnership(item, options = {}, fallback = {}) {
  const ownership = options.ownership || fallback.ownership || 'candidate';
  const ownershipConfidence = Number.isFinite(options.ownershipConfidence)
    ? options.ownershipConfidence
    : fallback.ownershipConfidence ?? 0.35;
  const ownershipReasons = [
    ...(Array.isArray(fallback.ownershipReasons) ? fallback.ownershipReasons : []),
    ...(Array.isArray(options.ownershipReasons) ? options.ownershipReasons : []),
  ].filter(Boolean);
  return {
    ...item,
    ownership,
    ownershipConfidence,
    ...(ownershipReasons.length ? { ownershipReasons: Array.from(new Set(ownershipReasons)) } : {}),
  };
}

async function inspectCreation(candidatePath, options = {}) {
  const statIsDir = await isDirectory(candidatePath);
  const dir = statIsDir ? candidatePath : path.dirname(candidatePath);
  const source = options.source || 'workspace';
  const staxManifestPath = path.join(dir, 'taku.stax.json');
  const legacyManifestPath = path.join(dir, 'taku.manifest.json');
  const skillPath = statIsDir ? path.join(dir, 'SKILL.md') : candidatePath.endsWith('SKILL.md') ? candidatePath : '';
  const packageJsonPath = path.join(dir, 'package.json');

  const staxManifest = await readJsonFile(staxManifestPath);
  const legacyManifest = staxManifest ? null : await readJsonFile(legacyManifestPath);
  const manifest = staxManifest || legacyManifest;
  if (manifest) {
    return withOwnership({
      id: stableId(source, 'creation', dir),
      type: cleanText(manifest.type, 60) || 'tool',
      source,
      name: cleanText(manifest.name, 120) || path.basename(dir),
      description: cleanText(manifest.description || manifest.short_description || manifest.shortDescription),
      detectedFrom: staxManifest ? 'taku.stax.json' : 'taku.manifest.json',
      publishable: true,
      localPath: dir,
    }, options, {
      ownership: 'owned',
      ownershipConfidence: 0.95,
      ownershipReasons: ['Taku manifest present'],
    });
  }

  if (skillPath && await exists(skillPath)) {
    const skill = await readSkillFile(skillPath, source);
    if (skill) {
      return withOwnership({
        ...skill,
        publishable: true,
        localPath: dir,
      }, options);
    }
  }

  const pkg = await readJsonFile(packageJsonPath);
  if (pkg?.name) {
    return withOwnership({
      id: stableId(source, 'creation', dir),
      type: 'app',
      source,
      name: cleanText(pkg.name, 120) || path.basename(dir),
      description: cleanText(pkg.description),
      detectedFrom: 'package.json',
      publishable: Boolean(pkg.name),
      localPath: dir,
    }, options);
  }

  return null;
}


export async function scanOwnedCreations(workspaceRoot, usedTools = []) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const candidates = [];
  if (await isDirectory(resolvedWorkspaceRoot)) {
    const direct = await inspectCreation(resolvedWorkspaceRoot, {
      source: 'workspace',
      ownership: 'likely-owned',
      ownershipConfidence: 0.75,
      ownershipReasons: ['Current workspace root'],
    });
    if (direct) candidates.push(direct);
    const skillFiles = await walkForSkillFiles(resolvedWorkspaceRoot, { maxDepth: 3 });
    for (const filePath of skillFiles) {
      const item = await inspectCreation(filePath, {
        source: 'workspace',
        ownership: 'likely-owned',
        ownershipConfidence: 0.65,
        ownershipReasons: ['Current workspace SKILL.md'],
      });
      if (item) candidates.push(item);
    }
  }
  for (const root of defaultToolRoots()) {
    if (!await isDirectory(root.path)) continue;
    const skillFiles = await walkForSkillFiles(root.path, { maxDepth: 5 });
    for (const filePath of skillFiles) {
      const item = await inspectCreation(filePath, {
        source: root.source,
        ownership: 'candidate',
        ownershipConfidence: 0.35,
        ownershipReasons: [`Detected in ${root.source} skill directory`],
      });
      if (item) candidates.push(item);
    }
  }
  for (const tool of usedTools) {
    if (!tool?.id || !tool?.name) continue;
    candidates.push(withOwnership({
      ...tool,
      publishable: true,
    }, {
      ownership: 'candidate',
      ownershipConfidence: 0.3,
      ownershipReasons: [`Detected as local ${tool.type || 'tool'} inventory`],
    }));
  }
  return dedupeItems(candidates);
}
