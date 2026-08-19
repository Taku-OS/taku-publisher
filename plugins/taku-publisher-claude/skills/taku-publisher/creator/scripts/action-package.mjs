import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { stableId } from './cli.mjs';
import { readJsonFile } from './draft-state.mjs';
import { assertInlineSkillPackageIsPublic } from './skill-package.mjs';
import { normalizeStaxDisplayItemType } from './public-inventory-item.mjs';
import { cleanText, isRecord, publicText } from './privacy.mjs';

const TAKU_ACTION_MANIFEST_VERSION = 'taku.action.v1';
const TAKU_MARKDOWN_COMMAND_RUNTIME_VERSION = 'taku.markdown-command-runtime.v1';
const MAX_ACTION_MARKDOWN_SOURCE_BYTES = 192 * 1024;
const MAX_ACTION_REGISTRY_SOURCE_BYTES = 16 * 1024 * 1024;

function privateInventoryItems(privateInventory) {
  return Array.isArray(privateInventory?.items) ? privateInventory.items : [];
}

function findPrivateInventoryItem(privateInventory, item) {
  const id = typeof item?.id === 'string' ? item.id : '';
  if (!id) return null;
  return privateInventoryItems(privateInventory).find((entry) => entry?.id === id) || null;
}

export async function createInlineActionDefinition(item, privateInventory) {
  if (!isRecord(item) || normalizeStaxDisplayItemType(item.type || item.kind, '') !== 'action') {
    return undefined;
  }
  const privateItem = findPrivateInventoryItem(privateInventory, item);
  const localPath = typeof privateItem?.localPath === 'string' ? privateItem.localPath : '';
  if (!localPath) return undefined;

  const definition = await readActionDefinitionFromPath(localPath, item);
  if (!definition) return undefined;
  const sanitized = sanitizeActionDefinition(definition);
  if (!isRecord(sanitized)) return undefined;
  assertInlineSkillPackageIsPublic(JSON.stringify(sanitized, null, 2), item.name || item.title || 'action definition');

  const serialized = JSON.stringify(sanitized);
  return {
    kind: 'action',
    format: 'taku.action.v1',
    definition: sanitized,
    hash: createHash('sha256').update(serialized).digest('hex'),
    size: Buffer.byteLength(serialized),
  };
}

export function sanitizeActionDefinition(value, depth = 0) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    if (depth > 8) return [];
    return value
      .slice(0, 100)
      .map((entry) => sanitizeActionDefinition(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (!isRecord(value) || depth > 8) return undefined;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    const sanitized = sanitizeActionDefinition(entry, depth + 1);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

async function readActionDefinitionFromPath(localPath, sourceItem) {
  const resolved = path.resolve(localPath);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile() || stat.size <= 0) return undefined;
  const lower = path.basename(resolved).toLowerCase();
  if (lower.endsWith('.json')) {
    if (stat.size > MAX_ACTION_REGISTRY_SOURCE_BYTES) return undefined;
    return readJsonActionDefinition(resolved, sourceItem);
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    if (stat.size > MAX_ACTION_MARKDOWN_SOURCE_BYTES) return undefined;
    return readMarkdownActionDefinition(resolved, sourceItem);
  }
  return undefined;
}

async function readJsonActionDefinition(filePath, sourceItem) {
  const manifest = await readJsonFile(filePath);
  if (!isRecord(manifest)) return undefined;
  if (Array.isArray(manifest.entries)) {
    return readRegistryActionDefinition(filePath, manifest.entries, sourceItem);
  }
  return actionDefinitionFromManifest(filePath, manifest, sourceItem);
}

async function readRegistryActionDefinition(filePath, entries, sourceItem) {
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const definition = isRecord(entry.definition) ? entry.definition : {};
    const entryType = normalizeStructuredItemType(entry.kind || definition.type || sourceItem.type, sourceItem.type || 'workflow');
    const entryName =
      cleanText(entry.name, 120) ||
      cleanText(definition.name, 120) ||
      cleanText(definition.commandName, 120) ||
      cleanText(entry.slug, 120) ||
      'Untitled';
    const entryId = stableId(sourceItem.source, entryType, entry.id || entryName, filePath);
    if (entryId === sourceItem.id) {
      return actionDefinitionFromManifest(filePath, {
        ...entry,
        ...definition,
        name: entryName,
        description: entry.description || entry.shortDescription || definition.description,
      }, sourceItem);
    }

    const commands = Array.isArray(definition.commands) ? definition.commands : [];
    const commandSource = String(sourceItem.source || '').replace(/-workflow$/, '-slash-command');
    const parentName = cleanText(entry.name || definition.name, 120);
    for (const command of commands) {
      if (!isRecord(command)) continue;
      const commandName =
        cleanText(command.commandName, 120) ||
        cleanText(command.title, 120) ||
        cleanText(command.entryFile ? path.basename(command.entryFile, path.extname(command.entryFile)) : '', 120);
      if (!commandName) continue;
      const displayName = commandName.startsWith('/') ? commandName : `/${commandName}`;
      const commandId = stableId(commandSource, 'slash-command', entry.id || parentName || '', displayName, filePath);
      if (commandId !== sourceItem.id) continue;
      const instructions = await commandInstructions(filePath, command);
      return buildActionManifest({
        id: `local:${slugify(commandName) || 'command'}`,
        name: cleanText(sourceItem.name || command.title || displayName, 160) || displayName,
        commandName,
        description: cleanText(sourceItem.description || command.description || parentName, 360),
        sourceFormat: cleanText(command.sourceFormat || definition.sourceFormat, 80) || 'markdown-command',
        entryFile: cleanText(command.entryFile, 220),
        sourcePath: publicSourceName(filePath),
        commands: [{
          commandName,
          title: cleanText(command.title || sourceItem.name || displayName, 160) || displayName,
          description: cleanText(command.description || sourceItem.description, 360),
          entryFile: cleanText(command.entryFile, 220),
          sourceFormat: cleanText(command.sourceFormat || definition.sourceFormat, 80) || 'markdown-command',
          argumentHint: cleanText(command.argumentHint, 160),
          allowedTools: stringList(command.allowedTools, 24, 120),
          disableModelInvocation: command.disableModelInvocation === true,
          instructions,
          warnings: stringList(command.warnings, 12, 220),
          resources: stringList(command.resources, 12, 220),
        }],
      });
    }
  }
  return undefined;
}

async function commandInstructions(filePath, command) {
  const direct = typeof command.instructions === 'string' ? command.instructions : '';
  if (direct.trim()) {
    assertInlineSkillPackageIsPublic(direct, command.title || command.commandName || 'command instructions');
    return direct;
  }
  const entryFile = cleanText(command.entryFile, 220);
  if (!entryFile || isUnsafeRelativePath(entryFile)) return '';
  const commandPath = path.resolve(path.dirname(filePath), entryFile);
  const raw = await fs.readFile(commandPath, 'utf8').catch(() => '');
  if (!raw) return '';
  assertInlineSkillPackageIsPublic(raw, command.title || command.commandName || 'command instructions', entryFile);
  return stripFrontmatter(raw);
}

async function readMarkdownActionDefinition(filePath, sourceItem) {
  const raw = await fs.readFile(filePath, 'utf8');
  assertInlineSkillPackageIsPublic(raw, sourceItem.name || sourceItem.title || 'action command', path.basename(filePath));
  const meta = parseFrontmatter(raw);
  const instructions = stripFrontmatter(raw);
  const title =
    cleanText(sourceItem.name, 160) ||
    cleanText(meta.name, 160) ||
    cleanText(meta.title, 160) ||
    firstMarkdownHeading(raw) ||
    cleanText(path.basename(filePath, path.extname(filePath)), 160) ||
    'Imported command';
  const commandName =
    cleanText(meta.commandName, 120) ||
    cleanText(meta.command, 120) ||
    cleanText(title.replace(/^\//, ''), 120) ||
    'imported-command';
  const sourceFormat = cleanText(meta.sourceFormat, 80) || inferSourceFormat(sourceItem.source);
  const description = cleanText(sourceItem.description || meta.description || meta.summary, 360);
  return buildActionManifest({
    id: `local:${slugify(commandName) || slugify(title) || 'command'}`,
    name: title,
    commandName,
    description,
    sourceFormat,
    entryFile: path.basename(filePath),
    sourcePath: publicSourceName(filePath),
    commands: [{
      commandName,
      title,
      description,
      entryFile: path.basename(filePath),
      sourceFormat,
      argumentHint: cleanText(meta.argumentHint || meta['argument-hint'], 160),
      allowedTools: csvOrList(meta.allowedTools || meta['allowed-tools'], 24, 120),
      disableModelInvocation: booleanValue(meta.disableModelInvocation || meta['disable-model-invocation']),
      instructions,
    }],
  });
}

function actionDefinitionFromManifest(filePath, manifest, sourceItem) {
  const existing = existingActionDefinition(manifest);
  if (existing) return existing;
  const commands = Array.isArray(manifest.commands) ? manifest.commands.filter(isRecord) : [];
  if (commands.length === 0 && typeof manifest.instructions !== 'string') return undefined;
  const name =
    cleanText(sourceItem.name, 160) ||
    cleanText(manifest.name || manifest.title, 160) ||
    'Imported action';
  const commandName =
    cleanText(manifest.commandName || manifest.command, 120) ||
    cleanText(commands[0]?.commandName, 120) ||
    slugify(name) ||
    'imported-action';
  const normalizedCommands = commands.length
    ? commands.map((command) => ({
        commandName: cleanText(command.commandName || command.command || command.title, 120) || commandName,
        title: cleanText(command.title || command.name || command.commandName, 160) || name,
        description: cleanText(command.description, 360),
        entryFile: cleanText(command.entryFile || command.entry_file, 220),
        sourceFormat: cleanText(command.sourceFormat || command.source_format || manifest.sourceFormat, 80) || 'markdown-command',
        argumentHint: cleanText(command.argumentHint || command.argument_hint, 160),
        allowedTools: stringList(command.allowedTools || command.allowed_tools, 24, 120),
        disableModelInvocation: command.disableModelInvocation === true || command.disable_model_invocation === true,
        instructions: typeof command.instructions === 'string' ? command.instructions : '',
        warnings: stringList(command.warnings, 12, 220),
        resources: stringList(command.resources, 12, 220),
      }))
    : [{
        commandName,
        title: name,
        description: cleanText(manifest.description, 360),
        entryFile: cleanText(manifest.entryFile || manifest.entry_file, 220),
        sourceFormat: cleanText(manifest.sourceFormat || manifest.source_format, 80) || 'markdown-command',
        instructions: manifest.instructions,
      }];

  for (const command of normalizedCommands) {
    if (command.instructions) {
      assertInlineSkillPackageIsPublic(command.instructions, command.title || command.commandName || 'command instructions');
    }
  }

  return buildActionManifest({
    id: cleanText(manifest.id, 220) || `local:${slugify(commandName) || 'action'}`,
    name,
    commandName,
    description: cleanText(sourceItem.description || manifest.description, 360),
    sourceFormat: normalizedCommands.length > 1 ? 'command-pack' : normalizedCommands[0]?.sourceFormat,
    entryFile: normalizedCommands.length > 1 ? null : normalizedCommands[0]?.entryFile,
    sourcePath: publicSourceName(filePath),
    commands: normalizedCommands,
  });
}

function existingActionDefinition(manifest) {
  if (!isRecord(manifest)) return null;
  if (
    manifest.schemaVersion === TAKU_ACTION_MANIFEST_VERSION ||
    manifest.schema_version === TAKU_ACTION_MANIFEST_VERSION ||
    manifest.type === 'action' ||
    manifest.executionMode === 'chat-start'
  ) {
    return manifest;
  }
  const definition = isRecord(manifest.definition) ? manifest.definition : null;
  if (!definition) return null;
  return existingActionDefinition(definition);
}

function buildActionManifest(input) {
  const commands = input.commands.map(normalizeCommand).filter(Boolean);
  const isCommandPack = commands.length > 1 || input.sourceFormat === 'command-pack';
  const commandName = normalizeCommandName(input.commandName || commands[0]?.commandName || slugify(input.name) || 'imported-command');
  const instructions = isCommandPack ? buildCommandPackInstructions(commands) : commands[0]?.instructions || '';
  const resources = uniqueStrings(commands.flatMap((command) => command.resources || []));
  const warnings = uniqueStrings(commands.flatMap((command) => command.warnings || []));
  const inputs = instructions.includes('$ARGUMENTS') && !isCommandPack
    ? [{
        name: 'arguments',
        label: 'Arguments',
        type: 'textarea',
        required: false,
        source: 'arguments',
      }]
    : [];
  return {
    schemaVersion: TAKU_ACTION_MANIFEST_VERSION,
    type: 'action',
    id: input.id,
    name: input.name,
    commandName,
    description: input.description,
    sourceFormat: input.sourceFormat || (isCommandPack ? 'command-pack' : commands[0]?.sourceFormat),
    entryFile: input.entryFile ?? commands[0]?.entryFile ?? null,
    executionMode: 'chat-start',
    execution: {
      mode: 'chat-start',
      adapter: 'taku-chat-start',
    },
    inputs,
    inputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: inputs.length ? { arguments: { type: 'string' } } : {},
    },
    instructions,
    commands,
    dependencies: {},
    readiness: readyReadiness(commands.length > 0),
    limits: {
      externalExecution: 'blocked',
      fileWrites: 'chat-output',
      network: 'needs-config',
    },
    resources,
    warnings,
    source: {
      kind: 'local-upload',
      path: input.sourcePath,
      entryFile: input.entryFile ?? commands[0]?.entryFile,
    },
    runtime: {
      adapter: 'taku-chat-start',
      commandRuntime: TAKU_MARKDOWN_COMMAND_RUNTIME_VERSION,
      argumentVariable: '$ARGUMENTS',
      preservesRawCommand: true,
      writePolicy: 'chat-output',
      note: 'Imported command files start in Taku chat. Local platform hooks or external services require separate setup.',
    },
  };
}

function normalizeCommand(command) {
  if (!isRecord(command)) return null;
  const commandName = normalizeCommandName(command.commandName || command.command || command.title);
  if (!commandName) return null;
  const instructions = typeof command.instructions === 'string' ? command.instructions : '';
  return {
    commandName,
    name: cleanText(command.title || command.name || commandName, 160) || commandName,
    title: cleanText(command.title || command.name || commandName, 160) || commandName,
    description: cleanText(command.description, 360),
    entryFile: cleanText(command.entryFile || command.entry_file, 220),
    sourceFormat: cleanText(command.sourceFormat || command.source_format, 80) || 'markdown-command',
    argumentHint: cleanText(command.argumentHint || command.argument_hint, 160),
    allowedTools: stringList(command.allowedTools || command.allowed_tools, 24, 120),
    disableModelInvocation: command.disableModelInvocation === true || command.disable_model_invocation === true,
    resources: stringList(command.resources, 12, 220),
    warnings: stringList(command.warnings, 12, 220),
    readiness: readyReadiness(Boolean(instructions)),
    instructions,
    inputs: [],
    dependencies: {},
    limits: {
      externalExecution: 'blocked',
      fileWrites: 'chat-output',
      network: 'needs-config',
    },
  };
}

function buildCommandPackInstructions(commands) {
  const rows = commands.map((command) => {
    const summary = command.description ? ` - ${command.description}` : '';
    return `/${command.commandName}${summary}`;
  });
  return [
    'This imported action contains multiple slash commands.',
    'Ask the user which command to run, then execute the matching command instructions.',
    '',
    'Available commands:',
    ...rows.map((row) => `- ${row}`),
  ].join('\n');
}

function readyReadiness(hasInstructions) {
  return hasInstructions
    ? {
        status: 'ready',
        label: 'Ready',
        reason: 'Imported command metadata is available.',
        checks: [],
      }
    : {
        status: 'degraded',
        label: 'Needs source context',
        reason: 'The command was published without source instructions.',
        checks: [],
      };
}

function normalizeStructuredItemType(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'command' || normalized === 'commands' || normalized === 'slash-command' || normalized === 'slash_command') return 'slash-command';
  if (normalized === 'workflow' || normalized === 'workflows' || normalized === 'action' || normalized === 'actions') return 'workflow';
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
  if (text.includes('claude')) return 'claude-command-md';
  if (text.includes('cursor')) return 'cursor-plugin-command';
  if (text.includes('codex')) return 'markdown-command';
  return 'markdown-command';
}

function publicSourceName(filePath) {
  return path.basename(filePath);
}

function slugify(value) {
  return String(value || '')
    .trim()
    .replace(/^\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCommandName(value) {
  return cleanText(String(value || '').replace(/^\//, ''), 120);
}

function stringList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => publicText(entry, maxLength)).filter(Boolean).slice(0, maxItems);
}

function csvOrList(value, maxItems, maxLength) {
  if (Array.isArray(value)) return stringList(value, maxItems, maxLength);
  if (typeof value !== 'string') return [];
  return value.split(',').map((entry) => publicText(entry, maxLength)).filter(Boolean).slice(0, maxItems);
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  return String(value || '').trim().toLowerCase() === 'true';
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isUnsafeRelativePath(value) {
  const text = String(value || '');
  return path.isAbsolute(text) || text.split(/[\\/]+/).includes('..');
}
