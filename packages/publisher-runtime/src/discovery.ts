import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  EXCLUDED_DIR_NAMES,
  MAX_DISCOVERY_DEPTH,
  SUPPORTED_TYPES,
  UNAVAILABLE_PUBLISH_TYPES,
} from './constants.js';
import type { JsonObject } from './types.js';
import { isWithin, normalizedRelative, PublisherError } from './util.js';

const PLUGIN_MANIFESTS = ['.codex-plugin/plugin.json', 'taku.plugin.json', 'plugin.json'];
const AGENT_FILE_NAMES = new Set(['agent.md', 'agents.md', 'agent.json', 'agent.yaml', 'agent.yml']);
const ACTION_PARENT_NAMES = new Set(['action', 'actions', 'command', 'commands', 'workflow', 'workflows']);
const AGENT_PARENT_NAMES = new Set(['agent', 'agents']);
const DEFINITION_SUFFIXES = new Set(['.md', '.json', '.yaml', '.yml']);
const HOST_METADATA_DIR_NAMES = new Set(['.codex-plugin', '.claude-plugin']);

export async function discoverUnits(workspaceInput: string, explicitSource?: string): Promise<JsonObject[]> {
  const workspace = await canonicalPath(workspaceInput);
  if (!(await isDirectory(workspace))) {
    throw new PublisherError('Workspace must be an existing directory.', 'invalid_workspace');
  }
  if (explicitSource) {
    const rawSource = path.resolve(explicitSource);
    if (await isSymlink(rawSource)) {
      throw new PublisherError('An explicit publish source cannot be a symlink.', 'unsafe_source');
    }
    if (!fs.existsSync(rawSource)) {
      throw new PublisherError('Explicit source does not exist.', 'invalid_source');
    }
    return discoverExplicit(await canonicalPath(rawSource), workspace);
  }

  const candidates: JsonObject[] = [];
  const seen = new Set<string>();
  await visitWorkspace(workspace, workspace, 0, async (current, files) => {
    const manifestPath = await pluginManifest(current);
    if (manifestPath) appendCandidate(candidates, seen, await candidate('plugin', current, workspace, manifestPath));
    if (files.includes('SKILL.md')) {
      appendCandidate(candidates, seen, await candidate('skill', current, workspace, path.join(current, 'SKILL.md')));
    }
    for (const fileName of files) {
      const filePath = path.join(current, fileName);
      const lower = fileName.toLowerCase();
      const parent = path.basename(current).toLowerCase();
      const suffix = path.extname(fileName).toLowerCase();
      if ((AGENT_FILE_NAMES.has(lower) || (AGENT_PARENT_NAMES.has(parent) && suffix === '.md'))
        && DEFINITION_SUFFIXES.has(suffix)) {
        appendCandidate(candidates, seen, await candidate('agent', filePath, workspace, filePath));
      }
      if (ACTION_PARENT_NAMES.has(parent) && DEFINITION_SUFFIXES.has(suffix)) {
        appendCandidate(candidates, seen, await candidate('action', filePath, workspace, filePath));
      }
    }
  });
  return candidates.sort(compareCandidates);
}

export async function inspectSelectedUnit(
  sourceInput: string,
  unitType: string,
  workspaceInput: string,
): Promise<JsonObject> {
  assertPublishTypeAvailable(unitType);
  let source = path.resolve(sourceInput);
  if (await isSymlink(source)) {
    throw new PublisherError('A selected publish unit cannot be a symlink.', 'unsafe_source');
  }
  if (!fs.existsSync(source)) {
    throw new PublisherError('Selected source does not exist.', 'invalid_source');
  }
  source = await canonicalPath(source);
  const workspace = await canonicalPath(workspaceInput);

  let entrypoint = '';
  if (unitType === 'skill') {
    const sourceStat = await fsp.stat(source);
    const root = sourceStat.isFile() ? path.dirname(source) : source;
    entrypoint = path.join(root, 'SKILL.md');
    if (!(await isFile(entrypoint))) {
      throw new PublisherError('A skill source must contain SKILL.md.', 'invalid_skill');
    }
    source = root;
  } else if (unitType === 'plugin') {
    if (!(await isDirectory(source))) {
      throw new PublisherError('A plugin source must be a directory.', 'invalid_plugin');
    }
    entrypoint = await pluginManifest(source) ?? '';
    if (!entrypoint) {
      throw new PublisherError(
        'A plugin source must contain .codex-plugin/plugin.json, taku.plugin.json, or plugin.json.',
        'invalid_plugin',
      );
    }
  } else {
    if (await isFile(source)) {
      entrypoint = source;
    } else {
      const entries = await fsp.readdir(source);
      if (unitType === 'agent') {
        entrypoint = entries
          .map((name) => path.join(source, name))
          .find((file) => AGENT_FILE_NAMES.has(path.basename(file).toLowerCase())) ?? '';
      }
      if (!entrypoint) {
        entrypoint = entries
          .filter((name) => DEFINITION_SUFFIXES.has(path.extname(name).toLowerCase()))
          .sort()
          .map((name) => path.join(source, name))[0] ?? '';
      }
    }
    if (!entrypoint || !(await isFile(entrypoint))) {
      throw new PublisherError(
        `The selected ${unitType} has no supported definition file.`,
        `invalid_${unitType}`,
      );
    }
  }

  const result = await candidate(unitType, source, workspace, entrypoint);
  if (unitType === 'plugin') result.children = await discoverPluginChildren(source);
  return result;
}

export function assertPublishTypeAvailable(unitType: string): void {
  if ((UNAVAILABLE_PUBLISH_TYPES as readonly string[]).includes(unitType)) {
    throw new PublisherError(
      `${unitType} publishing is not available yet. Taku Publisher currently accepts Skills only.`,
      'publish_type_not_available',
    );
  }
  if (!(SUPPORTED_TYPES as readonly string[]).includes(unitType)) {
    throw new PublisherError(`Unsupported publish type: ${unitType}`, 'unsupported_type');
  }
}

export async function discoverPluginChildren(pluginRoot: string): Promise<JsonObject[]> {
  const discovered = await discoverUnits(pluginRoot);
  return discovered
    .filter((entry) => !(entry.type === 'plugin' && entry.relative_path === '.'))
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      name: entry.name,
      relative_path: entry.relative_path,
    }));
}

async function discoverExplicit(source: string, workspace: string): Promise<JsonObject[]> {
  const candidates: JsonObject[] = [];
  if (await isDirectory(source)) {
    const manifest = await pluginManifest(source);
    if (manifest) candidates.push(await candidate('plugin', source, workspace, manifest));
    const skill = path.join(source, 'SKILL.md');
    if (await isFile(skill)) candidates.push(await candidate('skill', source, workspace, skill));
    if (!candidates.some((entry) => (SUPPORTED_TYPES as readonly string[]).includes(String(entry.type)))) {
      candidates.push(...await discoverUnits(source));
    }
  } else {
    const lower = path.basename(source).toLowerCase();
    const parent = path.basename(path.dirname(source)).toLowerCase();
    if (lower === 'skill.md') candidates.push(await candidate('skill', path.dirname(source), workspace, source));
    if (AGENT_FILE_NAMES.has(lower) || AGENT_PARENT_NAMES.has(parent)) {
      candidates.push(await candidate('agent', source, workspace, source));
    }
    if (ACTION_PARENT_NAMES.has(parent) || DEFINITION_SUFFIXES.has(path.extname(source).toLowerCase())) {
      candidates.push(await candidate('action', source, workspace, source));
    }
  }
  const unique = new Map<string, JsonObject>();
  for (const entry of candidates) unique.set(`${entry.type}\0${entry.path}`, entry);
  return [...unique.values()]
    .filter((entry) => (SUPPORTED_TYPES as readonly string[]).includes(String(entry.type)))
    .sort(compareCandidates);
}

async function visitWorkspace(
  workspace: string,
  current: string,
  depth: number,
  visitor: (directory: string, files: string[]) => Promise<void>,
): Promise<void> {
  const entries = await fsp.readdir(current, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  await visitor(current, files);
  if (depth >= MAX_DISCOVERY_DEPTH) return;
  const directories = entries
    .filter((entry) => entry.isDirectory()
      && !entry.isSymbolicLink()
      && !EXCLUDED_DIR_NAMES.has(entry.name.toLowerCase())
      && !HOST_METADATA_DIR_NAMES.has(entry.name.toLowerCase()))
    .map((entry) => entry.name)
    .sort();
  for (const name of directories) {
    await visitWorkspace(workspace, path.join(current, name), depth + 1, visitor);
  }
}

async function pluginManifest(root: string): Promise<string | undefined> {
  for (const relative of PLUGIN_MANIFESTS) {
    const file = path.join(root, relative);
    if (await isFile(file)) return file;
  }
  return undefined;
}

async function candidate(
  unitType: string,
  sourceInput: string,
  workspace: string,
  entrypointInput: string,
): Promise<JsonObject> {
  const source = path.resolve(sourceInput);
  const entrypoint = path.resolve(entrypointInput);
  const relativePath = isWithin(source, workspace)
    ? normalizedRelative(source, workspace)
    : path.basename(source);
  const metadata = await readMetadata(entrypoint, source);
  const identifier = createHash('sha256')
    .update(`${unitType}\0${relativePath}\0${path.basename(entrypoint)}`)
    .digest('hex')
    .slice(0, 20);
  return {
    id: `${unitType}_${identifier}`,
    type: unitType,
    name: metadata.name,
    description: metadata.description,
    path: source,
    relative_path: relativePath,
    entrypoint,
    entrypoint_relative: (await isDirectory(source)) && isWithin(entrypoint, source)
      ? normalizedRelative(entrypoint, source)
      : path.basename(entrypoint),
  };
}

async function readMetadata(entrypoint: string, source: string): Promise<{ name: string; description: string }> {
  const sourceStat = await fsp.stat(source);
  const fallback = path.parse(sourceStat.isFile() ? path.basename(source) : source).name;
  if (path.extname(entrypoint).toLowerCase() === '.json') {
    try {
      const value = JSON.parse(await fsp.readFile(entrypoint, 'utf8')) as Record<string, unknown>;
      return {
        name: cleanText(value.name ?? value.title) || fallback,
        description: cleanText(value.description ?? value.summary),
      };
    } catch {
      // Fall through to text metadata.
    }
  }
  try {
    const text = (await fsp.readFile(entrypoint, 'utf8')).slice(0, 64_000);
    const frontmatter = parseFrontmatter(text);
    const heading = /^#\s+(.+?)\s*$/m.exec(text);
    return {
      name: cleanText(frontmatter.name ?? frontmatter.title) || heading?.[1]?.trim() || fallback,
      description: cleanText(frontmatter.description ?? frontmatter.summary),
    };
  } catch {
    return { name: fallback, description: '' };
  }
}

function parseFrontmatter(text: string): Record<string, string> {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end < 0) return {};
  const output: Record<string, string> = {};
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*["']?(.*?)["']?\s*$/.exec(line);
    if (match?.[1]) output[match[1]] = match[2] ?? '';
  }
  return output;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
}

function appendCandidate(candidates: JsonObject[], seen: Set<string>, entry: JsonObject): void {
  if (!(SUPPORTED_TYPES as readonly string[]).includes(String(entry.type))) return;
  const key = `${entry.type}\0${entry.path}`;
  if (seen.has(key)) return;
  seen.add(key);
  candidates.push(entry);
}

function compareCandidates(left: JsonObject, right: JsonObject): number {
  return `${left.type}\0${left.relative_path}\0${left.id}`.localeCompare(
    `${right.type}\0${right.relative_path}\0${right.id}`,
  );
}

async function isFile(candidatePath: string): Promise<boolean> {
  return fsp.stat(candidatePath).then((stat) => stat.isFile(), () => false);
}

async function isDirectory(candidatePath: string): Promise<boolean> {
  return fsp.stat(candidatePath).then((stat) => stat.isDirectory(), () => false);
}

async function isSymlink(candidatePath: string): Promise<boolean> {
  return fsp.lstat(candidatePath).then((stat) => stat.isSymbolicLink(), () => false);
}

async function canonicalPath(candidatePath: string): Promise<string> {
  const resolved = path.resolve(candidatePath);
  return fsp.realpath(resolved).catch(() => resolved);
}
