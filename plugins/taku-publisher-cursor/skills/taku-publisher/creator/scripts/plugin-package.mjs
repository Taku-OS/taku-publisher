import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createInlineActionDefinition } from './action-package.mjs';
import { stableId } from './cli.mjs';
import { readJsonFile } from './draft-state.mjs';
import { createInlineAgentDefinition } from './agent-package.mjs';
import { createInlineSkillPackage } from './skill-package.mjs';
import { cleanText, isRecord, publicText } from './privacy.mjs';

const MAX_PLUGIN_CHILDREN = 24;

function privateInventoryItems(privateInventory) {
  return Array.isArray(privateInventory?.items) ? privateInventory.items : [];
}

function findPrivateInventoryItem(privateInventory, item) {
  const id = typeof item?.id === 'string' ? item.id : '';
  if (!id) return null;
  return privateInventoryItems(privateInventory).find((entry) => entry?.id === id) || null;
}

async function isFile(filePath) {
  const stat = await fs.stat(filePath).catch(() => null);
  return Boolean(stat?.isFile());
}

async function isDirectory(dirPath) {
  const stat = await fs.stat(dirPath).catch(() => null);
  return Boolean(stat?.isDirectory());
}

function normalizeZipPath(value) {
  return String(value || '').split(path.sep).join('/').replace(/^\/+/, '');
}

function stripFrontmatter(markdown) {
  const text = String(markdown || '');
  if (!text.startsWith('---')) return text.trim();
  const end = text.indexOf('\n---', 3);
  if (end < 0) return text.trim();
  return text.slice(end + 4).trim();
}

function parseFrontmatter(markdown) {
  const text = String(markdown || '');
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end < 0) return {};
  const result = {};
  for (const line of text.slice(3, end).trim().split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return result;
}

function firstMarkdownHeading(markdown) {
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const match = line.match(/^#\s+(.+)$/);
    if (match) return cleanText(match[1], 160);
  }
  return '';
}

async function readTextHeader(filePath) {
  const raw = await fs.readFile(filePath, 'utf8').catch(() => '');
  const meta = parseFrontmatter(raw);
  const title =
    cleanText(meta.name, 160) ||
    cleanText(meta.title, 160) ||
    firstMarkdownHeading(stripFrontmatter(raw)) ||
    cleanText(path.basename(filePath, path.extname(filePath)), 160);
  return {
    title,
    description: cleanText(meta.description || meta.summary, 800),
  };
}

async function readJsonHeader(filePath) {
  const manifest = await readJsonFile(filePath);
  const definition = isRecord(manifest?.definition) ? manifest.definition : {};
  return {
    title:
      cleanText(manifest?.name, 160) ||
      cleanText(manifest?.title, 160) ||
      cleanText(definition.name, 160) ||
      cleanText(definition.title, 160) ||
      cleanText(definition.commandName, 160) ||
      cleanText(path.basename(filePath, path.extname(filePath)), 160),
    description: cleanText(
      manifest?.description ||
        manifest?.summary ||
        manifest?.shortDescription ||
        definition.description ||
        definition.summary,
      800
    ),
  };
}

async function readChildHeader(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.json')) return readJsonHeader(filePath);
  return readTextHeader(filePath);
}

async function walkForFiles(root, options = {}) {
  const maxDepth = options.maxDepth ?? 3;
  const include = options.include || (() => false);
  const results = [];

  async function visit(current, depth) {
    if (depth > maxDepth || results.length >= MAX_PLUGIN_CHILDREN) return;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= MAX_PLUGIN_CHILDREN) break;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1);
        continue;
      }
      if (entry.isFile() && include(fullPath, entry.name)) results.push(fullPath);
    }
  }

  if (await isDirectory(root)) await visit(root, 0);
  return results;
}

function pluginRootFromManifestPath(localPath) {
  if (typeof localPath !== 'string' || !localPath.trim()) return null;
  const resolved = path.resolve(localPath);
  const basename = path.basename(resolved);
  const parent = path.basename(path.dirname(resolved));
  if (basename === 'plugin.json' && (parent === '.codex-plugin' || parent === '.claude-plugin')) {
    return path.dirname(path.dirname(resolved));
  }
  if (basename === 'plugin.json' || basename === 'taku.stax.json' || basename === 'package.json') {
    return path.dirname(resolved);
  }
  return null;
}

function normalizeManifestDir(value) {
  const text = cleanText(value, 240);
  if (!text || text.startsWith('http://') || text.startsWith('https://')) return '';
  return text;
}

async function pluginSkillFiles(pluginRoot, manifest) {
  const dirs = new Set(['skills']);
  const manifestSkills = normalizeManifestDir(manifest?.skills);
  if (manifestSkills) dirs.add(manifestSkills);
  const files = [];
  for (const dir of dirs) {
    const root = path.resolve(pluginRoot, dir);
    const rootFiles = await walkForFiles(root, {
      maxDepth: 5,
      include: (_filePath, basename) => basename === 'SKILL.md',
    });
    files.push(...rootFiles);
  }
  return uniquePaths(files);
}

async function pluginActionFiles(pluginRoot) {
  const specs = [
    { dir: 'commands', type: 'slash-command' },
    { dir: 'workflows', type: 'workflow' },
    { dir: 'actions', type: 'workflow' },
  ];
  const results = [];
  for (const spec of specs) {
    const root = path.join(pluginRoot, spec.dir);
    const files = await walkForFiles(root, {
      maxDepth: 3,
      include: (_filePath, basename) => /\.(md|markdown|json)$/i.test(basename),
    });
    for (const filePath of files) results.push({ filePath, type: spec.type });
  }
  return results;
}

async function pluginAgentFiles(pluginRoot) {
  const files = await walkForFiles(path.join(pluginRoot, 'agents'), {
    maxDepth: 3,
    include: (_filePath, basename) => /\.(md|markdown|json)$/i.test(basename),
  });
  return files;
}

function uniquePaths(paths) {
  return [...new Set(paths.map((entry) => path.resolve(entry)))];
}

function pluginMetadataCapability(sourceItem, privateItem, pluginRoot, manifest) {
  const name =
    publicText(sourceItem.name || sourceItem.title, 160) ||
    publicText(manifest?.interface?.displayName || manifest?.name, 160) ||
    'Plugin metadata';
  return {
    id: stableId(sourceItem.source || 'plugin', 'plugin-wrapper', name, privateItem.localPath || pluginRoot),
    kind: 'plugin-wrapper',
    type: 'plugin-wrapper',
    name,
    title: name,
    description: publicText(sourceItem.description || manifest?.description || manifest?.interface?.shortDescription, 800),
    path: normalizeZipPath(path.relative(pluginRoot, privateItem.localPath || pluginRoot)) || 'plugin.json',
    installPolicy: 'metadata',
    install_policy: 'metadata',
    sourceType: 'plugin',
    source_type: 'plugin',
    sourceKind: sourceItem.source || privateItem.source || 'plugin',
    source_kind: sourceItem.source || privateItem.source || 'plugin',
  };
}

function childPrivateInventoryItem(sourceItem, child, type) {
  return {
    id: child.id,
    name: child.name,
    type,
    source: sourceItem.source || 'plugin',
    detectedFrom: path.basename(child.localPath),
    localPath: child.localPath,
  };
}

async function buildSkillCapability(sourceItem, pluginRoot, filePath) {
  const header = await readChildHeader(filePath);
  const name = header.title || cleanText(path.basename(path.dirname(filePath)), 160) || 'Imported skill';
  const id = stableId(sourceItem.source || 'plugin', 'skill', name, filePath);
  const childItem = {
    id,
    type: 'skill',
    source: sourceItem.source || 'plugin',
    name,
    description: header.description || sourceItem.description,
  };
  const childPrivateInventory = {
    items: [childPrivateInventoryItem(sourceItem, { id, name, localPath: filePath }, 'skill')],
  };
  const inlinePackage = await createInlineSkillPackage(childItem, childPrivateInventory);
  if (!inlinePackage) return null;
  const relPath = normalizeZipPath(path.relative(pluginRoot, path.dirname(filePath)));
  return {
    id,
    kind: 'skill',
    type: 'skill',
    name,
    title: name,
    description: publicText(header.description || sourceItem.description, 800),
    path: relPath || 'skills',
    installPolicy: 'installable',
    install_policy: 'installable',
    sourceKind: 'local_upload',
    source_kind: 'local_upload',
    package: inlinePackage,
    skillPackage: inlinePackage,
    skill_package: inlinePackage,
  };
}

async function buildActionCapability(sourceItem, pluginRoot, child) {
  const header = await readChildHeader(child.filePath);
  const name = header.title || cleanText(path.basename(child.filePath, path.extname(child.filePath)), 160) || 'Imported action';
  const id = stableId(sourceItem.source || 'plugin', child.type, name, child.filePath);
  const childItem = {
    id,
    type: child.type,
    source: sourceItem.source || 'plugin',
    name,
    description: header.description || sourceItem.description,
  };
  const childPrivateInventory = {
    items: [childPrivateInventoryItem(sourceItem, { id, name, localPath: child.filePath }, child.type)],
  };
  const inlineAction = await createInlineActionDefinition(childItem, childPrivateInventory);
  if (!inlineAction?.definition) return null;
  const relPath = normalizeZipPath(path.relative(pluginRoot, child.filePath));
  return {
    id,
    kind: child.type === 'slash-command' ? 'slash-command' : 'workflow',
    type: child.type === 'slash-command' ? 'slash-command' : 'workflow',
    name,
    title: name,
    description: publicText(header.description || sourceItem.description, 800),
    path: relPath,
    installPolicy: 'installable',
    install_policy: 'installable',
    sourceKind: 'local_upload',
    source_kind: 'local_upload',
    definition: inlineAction.definition,
    actionDefinition: inlineAction.definition,
    action_definition: inlineAction.definition,
    workflowDefinition: inlineAction.definition,
    workflow_definition: inlineAction.definition,
    actionPackage: {
      kind: inlineAction.kind,
      format: inlineAction.format,
      hash: inlineAction.hash,
      size: inlineAction.size,
    },
    action_package: {
      kind: inlineAction.kind,
      format: inlineAction.format,
      hash: inlineAction.hash,
      size: inlineAction.size,
    },
  };
}

async function buildAgentCapability(sourceItem, pluginRoot, filePath) {
  const header = await readChildHeader(filePath);
  const name = header.title || cleanText(path.basename(filePath, path.extname(filePath)), 160) || 'Imported agent';
  const id = stableId(sourceItem.source || 'plugin', 'agent', name, filePath);
  const childItem = {
    id,
    type: 'agent',
    source: sourceItem.source || 'plugin',
    name,
    description: header.description || sourceItem.description,
  };
  const childPrivateInventory = {
    items: [childPrivateInventoryItem(sourceItem, { id, name, localPath: filePath }, 'agent')],
  };
  const inlineAgent = await createInlineAgentDefinition(childItem, childPrivateInventory);
  if (!inlineAgent?.definition) return null;
  const relPath = normalizeZipPath(path.relative(pluginRoot, filePath));
  return {
    id,
    kind: 'agent',
    type: 'agent',
    name,
    title: name,
    description: publicText(header.description || sourceItem.description, 800),
    path: relPath,
    installPolicy: 'installable',
    install_policy: 'installable',
    sourceKind: 'local_upload',
    source_kind: 'local_upload',
    definition: inlineAgent.definition,
    agentDefinition: inlineAgent.definition,
    agent_definition: inlineAgent.definition,
    agent: inlineAgent.definition,
    agentPackage: {
      kind: inlineAgent.kind,
      format: inlineAgent.format,
      hash: inlineAgent.hash,
      size: inlineAgent.size,
    },
    agent_package: {
      kind: inlineAgent.kind,
      format: inlineAgent.format,
      hash: inlineAgent.hash,
      size: inlineAgent.size,
    },
  };
}

function isSafeInlinePackageSkip(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.startsWith('Refusing to publish inline skill package');
}

async function maybeCapability(builder) {
  try {
    return await builder();
  } catch (error) {
    if (isSafeInlinePackageSkip(error)) return null;
    throw error;
  }
}

function capabilitySummary(capabilities) {
  const summary = {
    skills: 0,
    actions: 0,
    agents: 0,
    connectors: 0,
    apps: 0,
  };
  for (const capability of capabilities) {
    const kind = String(capability.kind || capability.type || '').toLowerCase();
    if (kind === 'skill') summary.skills += 1;
    else if (kind === 'agent' || kind === 'subagent') summary.agents += 1;
    else if (kind === 'action' || kind === 'workflow' || kind === 'slash-command') summary.actions += 1;
  }
  return summary;
}

export async function createInlinePluginBundle(item, privateInventory) {
  if (!isRecord(item) || String(item.type || item.kind || '').toLowerCase() !== 'plugin') return null;
  const privateItem = findPrivateInventoryItem(privateInventory, item);
  const pluginRoot = pluginRootFromManifestPath(privateItem?.localPath);
  if (!pluginRoot || !(await isDirectory(pluginRoot)) || !(await isFile(privateItem.localPath))) return null;
  const manifest = await readJsonFile(privateItem.localPath);
  if (!isRecord(manifest)) return null;

  const capabilities = [pluginMetadataCapability(item, privateItem, pluginRoot, manifest)];
  const installableCapabilities = [];

  for (const filePath of await pluginSkillFiles(pluginRoot, manifest)) {
    const capability = await maybeCapability(() => buildSkillCapability(item, pluginRoot, filePath));
    if (capability) installableCapabilities.push(capability);
  }
  for (const actionFile of await pluginActionFiles(pluginRoot)) {
    const capability = await maybeCapability(() => buildActionCapability(item, pluginRoot, actionFile));
    if (capability) installableCapabilities.push(capability);
  }
  for (const filePath of await pluginAgentFiles(pluginRoot)) {
    const capability = await maybeCapability(() => buildAgentCapability(item, pluginRoot, filePath));
    if (capability) installableCapabilities.push(capability);
  }

  if (installableCapabilities.length === 0) return null;
  capabilities.push(...installableCapabilities.slice(0, MAX_PLUGIN_CHILDREN));
  const selectedCapabilities = capabilities;
  const summary = capabilitySummary(installableCapabilities);
  const name =
    publicText(item.name || item.title, 160) ||
    publicText(manifest?.interface?.displayName || manifest?.name, 160) ||
    'Plugin bundle';
  return {
    kind: 'plugin-wrapper',
    pluginRoot,
    manifestPath: privateItem.localPath,
    name,
    description: publicText(
      item.description || manifest?.description || manifest?.interface?.shortDescription,
      800
    ),
    capabilities,
    installableCapabilities,
    selectedCapabilities,
    capabilitySummary: summary,
    decomposition: {
      schemaVersion: 'taku.plugin-decomposition.v1',
      source: item.source || privateItem.source || 'plugin',
      rootKind: 'plugin-wrapper',
      recommended: 'bundle',
      summary: {
        installableCount: installableCapabilities.length,
        metadataCount: capabilities.length - installableCapabilities.length,
        needsSetupCount: 0,
      },
      capabilities,
    },
    intent: {
      schemaVersion: 'taku.bundle-intent.v1',
      source: item.source || privateItem.source || 'plugin',
      selectedCapabilities,
      selected_capabilities: selectedCapabilities,
      selectedInstallableCount: installableCapabilities.length,
      selected_installable_count: installableCapabilities.length,
    },
  };
}
