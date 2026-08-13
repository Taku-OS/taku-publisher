import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { publisherHome, SCHEMA_VERSION } from './constants.js';
import type { JsonObject, JsonValue, PublisherOutput, PublisherState } from './types.js';

export class PublisherError extends Error {
  readonly code: string;
  readonly details: JsonObject;

  constructor(message: string, code = 'publisher_error', details: JsonObject = {}) {
    super(message);
    this.name = 'PublisherError';
    this.code = code;
    this.details = details;
  }
}

export function jsonOutput(
  status: string,
  data: JsonObject = {},
  options: { ok?: boolean; requiresAction?: boolean; actionType?: string | null } = {},
): PublisherOutput {
  const output: PublisherOutput = {
    schema_version: SCHEMA_VERSION,
    ok: options.ok ?? true,
    status,
    requires_action: options.requiresAction ?? false,
    ...data,
  };
  if (options.actionType) output.action_type = options.actionType;
  return output;
}

export function emitJson(payload: JsonValue): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export async function secureDirectory(directory: string, mode = 0o700): Promise<string> {
  await fsp.mkdir(directory, { recursive: true, mode });
  await fsp.chmod(directory, mode).catch(() => undefined);
  return directory;
}

export async function atomicWriteBytes(file: string, data: Uint8Array, mode = 0o600): Promise<void> {
  await secureDirectory(path.dirname(file));
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await fsp.open(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsp.rename(temporary, file);
    await fsp.chmod(file, mode).catch(() => undefined);
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function atomicWriteJson(file: string, value: JsonValue, mode = 0o600): Promise<void> {
  const serialized = `${JSON.stringify(sortJson(value), null, 2)}\n`;
  await atomicWriteBytes(file, Buffer.from(serialized, 'utf8'), mode);
}

export async function readJson(file: string): Promise<JsonValue> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as JsonValue;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new PublisherError(`Required file does not exist: ${file}`, 'missing_file');
    }
    throw new PublisherError(`Could not read JSON file: ${file}`, 'invalid_json');
  }
}

export function draftDirectory(draftId: string, env: NodeJS.ProcessEnv = process.env): string {
  const normalized = String(draftId ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(normalized)) {
    throw new PublisherError('Invalid draft ID.', 'invalid_draft_id');
  }
  const root = path.resolve(publisherHome(env));
  const candidate = path.resolve(root, normalized);
  if (path.dirname(candidate) !== root) {
    throw new PublisherError('Draft path escapes publisher home.', 'unsafe_draft_path');
  }
  return candidate;
}

export async function loadState(
  draftId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ directory: string; state: PublisherState }> {
  const directory = draftDirectory(draftId, env);
  const value = await readJson(path.join(directory, 'state.json'));
  if (!isRecord(value) || value.draft_id !== draftId) {
    throw new PublisherError('Local draft state is invalid.', 'invalid_draft_state');
  }
  return { directory, state: value as PublisherState };
}

export async function saveState(directory: string, state: PublisherState): Promise<void> {
  await atomicWriteJson(path.join(directory, 'state.json'), state);
}

export function makeDraftId(): string {
  return `local_${randomBytes(12).toString('hex')}`;
}

export function sha256Bytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function ensureWithin(candidate: string, root: string, label = 'path'): string {
  const resolved = path.resolve(candidate);
  if (!isWithin(resolved, root)) {
    throw new PublisherError(`${label} must stay inside the selected source.`, 'unsafe_path');
  }
  return resolved;
}

export function normalizedRelative(candidate: string, root: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(candidate)).split(path.sep).join('/');
  if (!relative) return '.';
  if (path.isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new PublisherError('Unsafe relative path.', 'unsafe_path');
  }
  return relative;
}

export async function setTreeReadOnly(root: string): Promise<void> {
  await walkTree(root, async (entry, kind) => {
    await fsp.chmod(entry, kind === 'file' ? 0o400 : 0o500).catch(() => undefined);
  }, true);
}

export async function setTreeWritable(root: string): Promise<void> {
  if (!fs.existsSync(root)) return;
  await walkTree(root, async (entry, kind) => {
    await fsp.chmod(entry, kind === 'file' ? 0o600 : 0o700).catch(() => undefined);
  }, true);
}

export async function walkTree(
  root: string,
  visitor: (entry: string, kind: 'file' | 'directory' | 'symlink' | 'other') => Promise<void>,
  postOrder = false,
): Promise<void> {
  const stat = await fsp.lstat(root);
  if (stat.isSymbolicLink()) {
    await visitor(root, 'symlink');
    return;
  }
  if (!stat.isDirectory()) {
    await visitor(root, stat.isFile() ? 'file' : 'other');
    return;
  }
  if (!postOrder) await visitor(root, 'directory');
  const entries = await fsp.readdir(root);
  entries.sort((a, b) => a.localeCompare(b));
  for (const name of entries) await walkTree(path.join(root, name), visitor, postOrder);
  if (postOrder) await visitor(root, 'directory');
}

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child as JsonValue)]),
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}
