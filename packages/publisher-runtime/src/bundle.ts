import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import {
  type CapabilityPackageFile,
  canonicalCapabilityJson,
  createCapabilityPackageManifest,
  stableCapabilityId,
} from '@taku/capability-contract';

import { SCHEMA_VERSION, SUPPORTED_RUNTIME_PLATFORMS } from './constants.js';
import { assertPublishTypeAvailable } from './discovery.js';
import { assertScanReady } from './scanner.js';
import type { FileManifestEntry, JsonObject, PublisherState } from './types.js';
import {
  atomicWriteBytes,
  atomicWriteJson,
  isRecord,
  nowIso,
  PublisherError,
  readJson,
  saveState,
  sha256Bytes,
} from './util.js';
import { assertStageUnchanged } from './workspace.js';
import { createStoredZip } from './zip.js';

const GENERATED_PACKAGE_MANIFEST_PATH = '.taku/package.json';
const GENERATED_MANIFEST_PATH = '.taku/manifest.json';
const GENERATED_REQUIREMENTS_PATH = '.taku/requirements.json';

export async function buildBundle(
  directory: string,
  state: PublisherState,
  outputPath?: string,
): Promise<JsonObject> {
  assertPublishTypeAvailable(String(state.unit.type ?? ''));
  const manifest = await assertStageUnchanged(directory, state);
  await assertScanReady(directory, state);
  const requirements = await readJson(path.join(directory, 'requirements.json'));
  if (!isRecord(requirements)) {
    throw new PublisherError('Requirements file is invalid.', 'invalid_requirements');
  }
  const generated = new Map<string, Buffer>([
    [GENERATED_MANIFEST_PATH, canonicalJson(bundleManifest(state))],
    [GENERATED_REQUIREMENTS_PATH, canonicalJson(requirements)],
  ]);
  const archivePath = outputPath ? path.resolve(outputPath) : path.join(directory, 'bundle.zip');
  if (!outputPath && fs.existsSync(archivePath)) throw new PublisherError('Bundle already exists for this draft.', 'bundle_exists');
  const files = Array.isArray(manifest.files) ? manifest.files.filter(isRecord) as FileManifestEntry[] : [];
  const { bytes, bundleFiles } = await createReproducibleZip(
    path.join(directory, 'staging'),
    files,
    generated,
    state,
    requirements,
  );
  const digest = sha256Bytes(bytes);
  await atomicWriteBytes(archivePath, bytes);
  if (!outputPath) {
    await atomicWriteBytes(path.join(directory, 'bundle.sha256'), Buffer.from(`${digest}  bundle.zip\n`, 'ascii'));
    const fileList: JsonObject = { ...manifest, bundle_files: bundleFiles, bundle_file_count: bundleFiles.length };
    await atomicWriteJson(path.join(directory, 'file-list.json'), fileList);
    state.status = 'packaged';
    state.bundle_sha256 = digest;
    state.bundle_size = bytes.length;
    state.bundle_file_count = bundleFiles.length;
    state.updated_at = nowIso();
    await saveState(directory, state);
  }
  return {
    path: archivePath,
    sha256: digest,
    size: bytes.length,
    file_count: bundleFiles.length,
    files: bundleFiles,
  };
}

function capabilityPackageManifest(
  state: PublisherState,
  files: CapabilityPackageFile[],
  requirements: JsonObject,
): JsonObject {
  const unit = isRecord(state.unit) ? state.unit : {};
  const kind = String(unit.type ?? '').trim();
  const name = String(unit.name ?? unit.id ?? '').trim();
  const description = String(unit.description ?? '').trim();
  const capabilityId = String(unit.id ?? '').trim() || stableCapabilityId({
    kind,
    source: 'taku',
    name,
    detectedFrom: String(unit.entrypoint_relative ?? unit.entrypoint ?? '').trim(),
  });
  const requiredSecrets = Array.isArray(requirements.secrets)
    ? requirements.secrets
      .filter(isRecord)
      .map((requirement) => String(requirement.name ?? '').trim())
      .filter(Boolean)
    : [];
  const contentHash = sha256Bytes(Buffer.from(
    canonicalCapabilityJson({
      files: [...files].sort((left, right) => left.path.localeCompare(right.path)),
    }),
    'utf8',
  ));
  return createCapabilityPackageManifest({
    channel: 'publish',
    packageVersion: '1.0.0',
    kind,
    contentHash,
    capability: {
      id: capabilityId,
      kind,
      name,
      description,
    },
    compatibility: {
      hosts: [...SUPPORTED_RUNTIME_PLATFORMS],
      platforms: [...SUPPORTED_RUNTIME_PLATFORMS],
    },
    files,
    permissions: [],
    requiredSecrets,
  }) as unknown as JsonObject;
}

export async function verifyLocalBundle(directory: string, state: PublisherState): Promise<string> {
  await assertStageUnchanged(directory, state);
  const bundlePath = path.join(directory, 'bundle.zip');
  if (!fs.existsSync(bundlePath)) throw new PublisherError('Bundle has not been created.', 'missing_bundle');
  const actual = sha256Bytes(await fsp.readFile(bundlePath));
  if (actual !== state.bundle_sha256) throw new PublisherError('Bundle digest no longer matches local state.', 'bundle_changed');
  return bundlePath;
}

function bundleManifest(state: PublisherState): JsonObject {
  const unit = isRecord(state.unit) ? state.unit : {};
  const children = Array.isArray(unit.children) ? unit.children.filter(isRecord) : [];
  return {
    schema_version: SCHEMA_VERSION,
    type: unit.type,
    name: unit.name,
    description: unit.description ?? '',
    entrypoint: unit.entrypoint_relative || path.basename(String(unit.entrypoint ?? '')),
    capabilities: children.map((child) => ({
      id: child.id,
      type: child.type,
      name: child.name,
      path: child.relative_path,
    })),
  };
}

function canonicalJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(sortDeep(value), null, 2)}\n`, 'utf8');
}

async function createReproducibleZip(
  staging: string,
  stagedFiles: FileManifestEntry[],
  generated: Map<string, Buffer>,
  state: PublisherState,
  requirements: JsonObject,
): Promise<{ bytes: Buffer; bundleFiles: JsonObject[] }> {
  const entries: Array<{ name: string; data: Buffer; mode: number }> = [];
  for (const entry of stagedFiles) {
    if (generated.has(entry.path) || entry.path.startsWith('.taku/')) {
      throw new PublisherError('Source uses the reserved .taku package namespace.', 'reserved_package_path');
    }
    entries.push({
      name: entry.path,
      data: await fsp.readFile(path.join(staging, entry.path)),
      mode: executableScript(entry.path) ? 0o755 : 0o644,
    });
  }
  for (const [name, data] of generated) entries.push({ name, data, mode: 0o644 });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const packageFiles = entries.map((entry) => ({
    path: entry.name,
    size: entry.data.length,
    sha256: sha256Bytes(entry.data),
  }));
  const packageManifest = capabilityPackageManifest(
    state,
    packageFiles,
    requirements,
  );
  entries.push({
    name: GENERATED_PACKAGE_MANIFEST_PATH,
    data: canonicalJson(packageManifest),
    mode: 0o644,
  });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const bundleFiles = entries.map((entry) => ({
    path: entry.name,
    size: entry.data.length,
    sha256: sha256Bytes(entry.data),
  }));
  return { bytes: createStoredZip(entries), bundleFiles };
}

function executableScript(relative: string): boolean {
  return ['.bash', '.command', '.sh', '.zsh'].includes(path.extname(relative).toLowerCase())
    || relative.startsWith('bin/');
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortDeep(child)]),
  );
}
