import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  assertTakuSubAppRuntimeManifest,
  SUBAPP_BUILD_ARCHIVE_FILE,
  SUBAPP_BUILD_OUTPUT_DIRECTORY,
  SUBAPP_SOURCE_ARCHIVE_FILE,
} from '@taku/subapp-contract';
import { buildPublisherPackageArtifact, type PublisherPackageEntry } from './core.js';
import { checkSubAppConversion, type SubAppConversionCheck } from './subapp-agent.js';
import {
  readSubAppServiceAuthorizations,
  type SubAppServiceAuthorizationV1,
} from './subapp-services.js';
import { MAX_APP_STORE_PACKAGE_BYTES } from './constants.js';
import type { JsonObject } from './types.js';
import {
  atomicWriteBytes,
  atomicWriteJson,
  isRecord,
  PublisherError,
  sha256Bytes,
} from './util.js';

const RECEIPT_SCHEMA = 'taku.publisher.subapp-runtime-receipt.v1';
const PACKAGE_SCHEMA = 'taku.publisher.subapp-package.v1';
const BUILD_ARTIFACT_SCHEMA = 'taku.subapp-runtime-build.v1';
const BUILD_EVIDENCE_RELATIVE_PATH = 'build-output/.next-preview';
const MAX_FILES = 50_000;
const MAX_SOURCE_BYTES = MAX_APP_STORE_PACKAGE_BYTES;
const MAX_BUILD_BYTES = MAX_APP_STORE_PACKAGE_BYTES;
const MAX_BUILD_EVIDENCE_BYTES = 512 * 1024 * 1024;
const SOURCE_EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.next-edit',
  '.next-preview',
  '.turbo',
  '.cache',
  'dist',
  'build',
  'node_modules',
  'out',
]);
const REQUIRED_BUILD_FILES = [
  'BUILD_ID',
  'prerender-manifest.json',
  'routes-manifest.json',
  'build-manifest.json',
  'required-server-files.json',
] as const;
const UPSTREAM_ATTRIBUTION_FILE = /^(?:licen[cs]e|notice)(?:[._-].*)?$/i;

interface GitIgnoreRule {
  ignored: boolean;
  matcher: RegExp;
}

export interface SubAppPackagePlan {
  workspaceRoot: string;
  candidateDigest: string;
  runtimeEvidenceRoot: string;
  buildArtifact: JsonObject;
  runtimeManifest: JsonObject;
  serviceAuthorizations: SubAppServiceAuthorizationV1[];
  confirmationToken: string;
  scriptsExecuted: false;
  uploadStarted: false;
  publishStarted: false;
}

export interface SubAppPackageResult {
  packageRoot: string;
  candidateDigest: string;
  source: JsonObject;
  build: JsonObject;
  manifest: JsonObject;
  scriptsExecuted: false;
  uploadStarted: false;
  publishStarted: false;
}

export interface SubAppPackageOptions {
  stateRoot?: string;
  converterBin?: string;
  timeoutMs?: number;
  checkConversion?: (
    candidate: string,
    options?: { converterBin?: string; timeoutMs?: number },
  ) => Promise<SubAppConversionCheck>;
}

export async function planSubAppPackage(
  request: { candidate: string; runtimeEvidence: string },
  options: SubAppPackageOptions = {},
): Promise<SubAppPackagePlan> {
  const checked = await (options.checkConversion || checkSubAppConversion)(
    request.candidate,
    conversionOptions(options),
  );
  if (!checked.converted) {
    throw new PublisherError(
      'SubApp candidate must pass conversion validation before packaging.',
      'subapp_package_conversion_gate_required',
    );
  }
  const evidenceRoot = await canonicalEvidenceRoot(request.runtimeEvidence, options.stateRoot);
  const receipt = await readRuntimeReceipt(evidenceRoot);
  if (receipt.candidateDigest !== checked.candidateDigest || receipt.ok !== true) {
    throw new PublisherError(
      'Trusted runtime evidence is stale or belongs to different candidate content.',
      'subapp_package_runtime_evidence_mismatch',
    );
  }
  const buildArtifact = requireBuildArtifact(receipt.buildArtifact);
  const buildRoot = path.join(evidenceRoot, BUILD_EVIDENCE_RELATIVE_PATH);
  const buildSummary = await summarizeBuildTree(buildRoot).catch(() => null);
  if (
    !buildSummary ||
    buildSummary.treeDigest !== buildArtifact.treeDigest ||
    buildSummary.fileCount !== buildArtifact.fileCount ||
    buildSummary.sizeBytes !== buildArtifact.sizeBytes
  ) {
    throw new PublisherError(
      'Trusted preview build no longer matches its runtime evidence.',
      'subapp_package_build_artifact_changed',
    );
  }
  await assertRequiredBuildFiles(buildRoot);
  const runtimeManifest = await readRuntimeManifest(checked.workspaceRoot);
  const serviceAuthorizations = await readSubAppServiceAuthorizations(
    checked.workspaceRoot,
  );
  await assertRuntimeScripts(checked.workspaceRoot);
  const confirmationToken = packageConfirmationToken({
    candidateDigest: checked.candidateDigest,
    buildDigest: String(buildArtifact.treeDigest),
    runtimeManifest,
    serviceAuthorizations,
  });
  return {
    workspaceRoot: checked.workspaceRoot,
    candidateDigest: checked.candidateDigest,
    runtimeEvidenceRoot: evidenceRoot,
    buildArtifact,
    runtimeManifest,
    serviceAuthorizations,
    confirmationToken,
    scriptsExecuted: false,
    uploadStarted: false,
    publishStarted: false,
  };
}

export async function packageSubApp(
  request: {
    candidate: string;
    runtimeEvidence: string;
    outputRoot: string;
    confirmationToken: string;
    name?: string;
  },
  options: SubAppPackageOptions = {},
): Promise<SubAppPackageResult> {
  const plan = await planSubAppPackage(
    { candidate: request.candidate, runtimeEvidence: request.runtimeEvidence },
    options,
  );
  if (request.confirmationToken !== plan.confirmationToken) {
    throw new PublisherError(
      'The SubApp package confirmation is missing, stale, or belongs to different evidence.',
      'subapp_package_confirmation_mismatch',
    );
  }

  const outputRoot = await canonicalExistingDirectory(request.outputRoot, 'package output');
  const packageName = normalizePackageName(
    request.name || String(plan.runtimeManifest.name ?? 'subapp'),
  );
  const packageRoot = path.join(outputRoot, `${packageName}-release`);
  if (
    isWithin(packageRoot, plan.workspaceRoot) ||
    isWithin(plan.workspaceRoot, packageRoot) ||
    isWithin(packageRoot, plan.runtimeEvidenceRoot) ||
    isWithin(plan.runtimeEvidenceRoot, packageRoot)
  ) {
    throw new PublisherError(
      'SubApp package output must be separate from the candidate and runtime evidence.',
      'subapp_package_output_overlaps_input',
    );
  }
  if (await fs.lstat(packageRoot).catch(() => null)) {
    throw new PublisherError(
      'SubApp package output already exists.',
      'subapp_package_output_exists',
    );
  }
  await fs.mkdir(packageRoot, { mode: 0o700 });

  try {
    const sourceEntries = await collectSourceEntries(plan.workspaceRoot);
    const buildEntries = await collectBuildEntries(
      path.join(plan.runtimeEvidenceRoot, BUILD_EVIDENCE_RELATIVE_PATH),
    );
    const sourceArtifact = buildPublisherPackageArtifact(sourceEntries);
    const buildArtifact = buildPublisherPackageArtifact(buildEntries);
    assertAppStoreArtifactSize(sourceArtifact.size, 'source');
    assertAppStoreArtifactSize(buildArtifact.size, 'build');
    const sourcePath = path.join(packageRoot, SUBAPP_SOURCE_ARCHIVE_FILE);
    const buildPath = path.join(packageRoot, SUBAPP_BUILD_ARCHIVE_FILE);
    await atomicWriteBytes(sourcePath, sourceArtifact.bytes);
    await atomicWriteBytes(buildPath, buildArtifact.bytes);

    const manifest: JsonObject = {
      schemaVersion: PACKAGE_SCHEMA,
      candidateDigest: plan.candidateDigest,
      runtimeManifest: plan.runtimeManifest,
      serviceAuthorizations: plan.serviceAuthorizations.map(authorization => ({
        serviceId: authorization.serviceId,
        endpointIds: [...authorization.endpointIds],
      })),
      source: {
        fileName: SUBAPP_SOURCE_ARCHIVE_FILE,
        sha256: sourceArtifact.sha256,
        size: sourceArtifact.size,
        fileCount: sourceArtifact.fileCount,
      },
      build: {
        fileName: SUBAPP_BUILD_ARCHIVE_FILE,
        sha256: buildArtifact.sha256,
        size: buildArtifact.size,
        fileCount: buildArtifact.fileCount,
        outputDirectory: SUBAPP_BUILD_OUTPUT_DIRECTORY,
        trustedTreeDigest: plan.buildArtifact.treeDigest,
      },
      installContract: {
        buildRequired: true,
        buildOutputDir: SUBAPP_BUILD_OUTPUT_DIRECTORY,
        startScriptPreview: 'start:preview',
        startScriptEdit: 'start:edit',
      },
      uploadStarted: false,
      publishStarted: false,
    };
    await atomicWriteJson(path.join(packageRoot, 'package-manifest.json'), manifest);
    await verifyWrittenArtifact(sourcePath, sourceArtifact.sha256, sourceArtifact.size);
    await verifyWrittenArtifact(buildPath, buildArtifact.sha256, buildArtifact.size);
    return {
      packageRoot,
      candidateDigest: plan.candidateDigest,
      source: manifest.source as JsonObject,
      build: manifest.build as JsonObject,
      manifest,
      scriptsExecuted: false,
      uploadStarted: false,
      publishStarted: false,
    };
  } catch (error) {
    await fs.rm(packageRoot, { recursive: true, force: true });
    throw error;
  }
}

async function readRuntimeReceipt(evidenceRoot: string): Promise<JsonObject> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(path.join(evidenceRoot, 'runtime-receipt.json'), 'utf8'));
  } catch {
    throw new PublisherError(
      'Trusted runtime receipt is missing or invalid.',
      'subapp_package_runtime_receipt_missing',
    );
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== RECEIPT_SCHEMA ||
    value.ok !== true ||
    value.publishStarted !== false ||
    !/^sha256:[a-f0-9]{64}$/.test(String(value.candidateDigest ?? ''))
  ) {
    throw new PublisherError(
      'Trusted runtime receipt is incompatible.',
      'subapp_package_runtime_receipt_invalid',
    );
  }
  return value;
}

function requireBuildArtifact(value: unknown): JsonObject {
  if (
    !isRecord(value) ||
    value.schemaVersion !== BUILD_ARTIFACT_SCHEMA ||
    value.buildOutputDir !== SUBAPP_BUILD_OUTPUT_DIRECTORY ||
    value.evidenceRelativePath !== BUILD_EVIDENCE_RELATIVE_PATH ||
    !/^sha256:[a-f0-9]{64}$/.test(String(value.treeDigest ?? '')) ||
    !Number.isInteger(value.fileCount) ||
    Number(value.fileCount) <= 0 ||
    !Number.isInteger(value.sizeBytes) ||
    Number(value.sizeBytes) <= 0
  ) {
    throw new PublisherError(
      'Trusted runtime build artifact record is incompatible.',
      'subapp_package_build_artifact_invalid',
    );
  }
  return value;
}

async function readRuntimeManifest(candidate: string): Promise<JsonObject> {
  try {
    const value = JSON.parse(
      await fs.readFile(path.join(candidate, 'taku.manifest.json'), 'utf8'),
    ) as unknown;
    return assertTakuSubAppRuntimeManifest(value) as unknown as JsonObject;
  } catch (error) {
    throw new PublisherError(
      'SubApp runtime manifest is invalid.',
      'subapp_package_manifest_invalid',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
}

async function assertRuntimeScripts(candidate: string): Promise<void> {
  let packageJson: JsonObject;
  try {
    const value = JSON.parse(await fs.readFile(path.join(candidate, 'package.json'), 'utf8'));
    packageJson = isRecord(value) ? value : {};
  } catch {
    packageJson = {};
  }
  const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};
  if (
    typeof scripts['start:preview'] !== 'string' ||
    !scripts['start:preview'].trim() ||
    typeof scripts['start:edit'] !== 'string' ||
    !scripts['start:edit'].trim()
  ) {
    throw new PublisherError(
      'SubApp package requires start:preview and start:edit scripts.',
      'subapp_package_runtime_scripts_missing',
    );
  }
  for (const command of [scripts['start:preview'], scripts['start:edit']]) {
    if (/(?:--port|-p)\s*=?\s*\d+|\bPORT\s*=\s*\d+/i.test(command)) {
      throw new PublisherError(
        'SubApp runtime scripts must not hard-code a port.',
        'subapp_package_hardcoded_port',
      );
    }
  }
}

async function assertRequiredBuildFiles(buildRoot: string): Promise<void> {
  for (const required of REQUIRED_BUILD_FILES) {
    const metadata = await fs.lstat(path.join(buildRoot, required)).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) {
      throw new PublisherError(
        `Trusted preview build is missing ${required}.`,
        'subapp_package_build_incomplete',
      );
    }
  }
}

async function summarizeBuildTree(root: string): Promise<{
  treeDigest: `sha256:${string}`;
  fileCount: number;
  sizeBytes: number;
}> {
  const hash = createHash('sha256');
  let fileCount = 0;
  let sizeBytes = 0;

  async function walk(relativeRoot: string): Promise<void> {
    const children = await fs.readdir(path.join(root, relativeRoot), { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath = path.join(relativeRoot, child.name).replace(/\\/g, '/');
      const absolutePath = path.join(root, relativePath);
      const metadata = await fs.lstat(absolutePath);
      if (metadata.isSymbolicLink()) throw new Error('build artifact contains a symlink');
      if (metadata.isDirectory()) {
        await walk(relativePath);
        continue;
      }
      if (!metadata.isFile()) throw new Error('build artifact contains an unsupported entry');
      fileCount += 1;
      sizeBytes += metadata.size;
      if (fileCount > MAX_FILES || sizeBytes > MAX_BUILD_EVIDENCE_BYTES) {
        throw new Error('build artifact exceeds the package limit');
      }
      const content = await fs.readFile(absolutePath);
      hash.update(relativePath);
      hash.update('\0');
      hash.update(String(metadata.size));
      hash.update('\0');
      hash.update(content);
      hash.update('\0');
    }
  }

  await walk('');
  if (fileCount === 0 || sizeBytes === 0) throw new Error('build artifact is empty');
  return {
    treeDigest: `sha256:${hash.digest('hex')}`,
    fileCount,
    sizeBytes,
  };
}

async function collectSourceEntries(root: string): Promise<PublisherPackageEntry[]> {
  const gitIgnoreRules = await readGitIgnoreRules(root);
  return collectEntries(root, {
    prefix: '',
    maxBytes: MAX_SOURCE_BYTES,
    include(relativePath, isDirectory) {
      const parts = relativePath.split('/');
      if (parts.includes('.taku')) return false;
      if (isDirectory && SOURCE_EXCLUDED_DIRECTORIES.has(parts.at(-1) ?? '')) return false;
      const base = parts.at(-1) ?? '';
      if (base === '.env' || base.startsWith('.env.')) return false;
      if (parts[0] === 'upstream-source') {
        if (parts.length === 1) return isDirectory;
        if (isDirectory || parts.length !== 2) return false;
        return UPSTREAM_ATTRIBUTION_FILE.test(base);
      }
      if (isRequiredSourceEvidence(relativePath)) return true;
      return isDirectory || !isGitIgnored(relativePath, gitIgnoreRules);
    },
  });
}

async function collectBuildEntries(root: string): Promise<PublisherPackageEntry[]> {
  return collectEntries(root, {
    prefix: `${SUBAPP_BUILD_OUTPUT_DIRECTORY}/`,
    maxBytes: MAX_BUILD_BYTES,
    include(relativePath) {
      return relativePath !== 'trace' && relativePath !== 'cache' && !relativePath.startsWith('cache/');
    },
  });
}

async function readGitIgnoreRules(root: string): Promise<GitIgnoreRule[]> {
  const content = await fs.readFile(path.join(root, '.gitignore'), 'utf8').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  });
  const rules: GitIgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let ignored = true;
    if (line.startsWith('!')) {
      ignored = false;
      line = line.slice(1);
    } else if (line.startsWith('\\#') || line.startsWith('\\!')) {
      line = line.slice(1);
    }
    if (!line) continue;
    const directoryOnly = line.endsWith('/');
    if (directoryOnly) line = line.slice(0, -1);
    const anchored = line.startsWith('/');
    if (anchored) line = line.slice(1);
    if (!line) continue;
    const hasSlash = line.includes('/');
    const glob = gitIgnoreGlobPattern(line);
    const prefix = anchored || hasSlash ? '^' : '(?:^|/)';
    const suffix = directoryOnly || !hasSlash ? '(?:$|/)' : '$';
    rules.push({ ignored, matcher: new RegExp(`${prefix}${glob}${suffix}`) });
  }
  return rules;
}

function gitIgnoreGlobPattern(pattern: string): string {
  let output = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? '';
    if (character === '*' && pattern[index + 1] === '*') {
      while (pattern[index + 1] === '*') index += 1;
      if (pattern[index + 1] === '/') {
        index += 1;
        output += '(?:.*/)?';
      } else {
        output += '.*';
      }
      continue;
    }
    if (character === '*') output += '[^/]*';
    else if (character === '?') output += '[^/]';
    else output += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return output;
}

function isGitIgnored(relativePath: string, rules: GitIgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.matcher.test(relativePath)) ignored = rule.ignored;
  }
  return ignored;
}

function isRequiredSourceEvidence(relativePath: string): boolean {
  if (relativePath.includes('/')) return false;
  return relativePath === 'UPSTREAM_CREDITS.md' || UPSTREAM_ATTRIBUTION_FILE.test(relativePath);
}

function assertAppStoreArtifactSize(size: number, label: string): void {
  if (size <= MAX_APP_STORE_PACKAGE_BYTES) return;
  throw new PublisherError(
    `SubApp ${label} archive exceeds the ${MAX_APP_STORE_PACKAGE_BYTES} byte App Store limit.`,
    'subapp_package_too_large',
    { archive: label, size, max_bytes: MAX_APP_STORE_PACKAGE_BYTES },
  );
}

async function collectEntries(
  root: string,
  options: {
    prefix: string;
    maxBytes: number;
    include: (relativePath: string, isDirectory: boolean) => boolean;
  },
): Promise<PublisherPackageEntry[]> {
  const entries: PublisherPackageEntry[] = [];
  let totalBytes = 0;

  async function walk(relativeRoot: string): Promise<void> {
    const children = await fs.readdir(path.join(root, relativeRoot), { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath = path.join(relativeRoot, child.name).replace(/\\/g, '/');
      if (!options.include(relativePath, child.isDirectory())) continue;
      const absolutePath = path.join(root, relativePath);
      const metadata = await fs.lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw new PublisherError(
          `SubApp package contains a symbolic link: ${relativePath}`,
          'subapp_package_symlink',
        );
      }
      if (metadata.isDirectory()) {
        await walk(relativePath);
        continue;
      }
      if (!metadata.isFile()) {
        throw new PublisherError(
          `SubApp package contains an unsupported entry: ${relativePath}`,
          'subapp_package_entry_unsupported',
        );
      }
      totalBytes += metadata.size;
      if (entries.length + 1 > MAX_FILES || totalBytes > options.maxBytes) {
        throw new PublisherError(
          'SubApp package exceeds the local file or size limit.',
          'subapp_package_too_large',
        );
      }
      entries.push({
        path: `${options.prefix}${relativePath}`,
        data: await fs.readFile(absolutePath),
        mode: metadata.mode & 0o111 ? 0o755 : 0o644,
      });
    }
  }

  await walk('');
  if (entries.length === 0) {
    throw new PublisherError('SubApp package has no files.', 'subapp_package_empty');
  }
  return entries;
}

async function canonicalEvidenceRoot(input: string, stateRoot?: string): Promise<string> {
  const evidenceRoot = await canonicalExistingDirectory(input, 'runtime evidence');
  const allowedRoot = await fs.realpath(
    path.resolve(stateRoot ?? path.join(os.homedir(), '.taku', 'publisher', 'subapp-runtime')),
  );
  if (!isWithin(evidenceRoot, path.join(allowedRoot, 'evidence'))) {
    throw new PublisherError(
      'Runtime evidence is outside the Publisher trusted-runtime state.',
      'subapp_package_evidence_outside_state',
    );
  }
  return evidenceRoot;
}

async function canonicalExistingDirectory(input: string, label: string): Promise<string> {
  if (!path.isAbsolute(input)) {
    throw new PublisherError(`${label} must be an absolute directory.`, 'invalid_arguments');
  }
  const resolved = path.resolve(input);
  const canonical = await fs.realpath(resolved).catch(() => null);
  if (!canonical || canonical !== resolved) {
    throw new PublisherError(`${label} must be a canonical existing directory.`, 'invalid_arguments');
  }
  const metadata = await fs.lstat(canonical);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new PublisherError(`${label} must be a directory.`, 'invalid_arguments');
  }
  return canonical;
}

function packageConfirmationToken(input: {
  candidateDigest: string;
  buildDigest: string;
  runtimeManifest: JsonObject;
  serviceAuthorizations: SubAppServiceAuthorizationV1[];
}): string {
  const payload = JSON.stringify({
    protocol: PACKAGE_SCHEMA,
    candidateDigest: input.candidateDigest,
    buildDigest: input.buildDigest,
    runtimeManifest: sortDeep(input.runtimeManifest),
    serviceAuthorizations: sortDeep(input.serviceAuthorizations),
  });
  return `subapp_package_confirm_${createHash('sha256').update(payload).digest('hex')}`;
}

function normalizePackageName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new PublisherError('SubApp package name is invalid.', 'subapp_package_name_invalid');
  }
  return normalized;
}

async function verifyWrittenArtifact(
  filePath: string,
  expectedSha256: string,
  expectedSize: number,
): Promise<void> {
  const bytes = await fs.readFile(filePath);
  if (bytes.length !== expectedSize || sha256Bytes(bytes) !== expectedSha256) {
    throw new PublisherError(
      'SubApp package failed its final integrity check.',
      'subapp_package_integrity_failed',
    );
  }
}

function conversionOptions(options: SubAppPackageOptions): {
  converterBin?: string;
  timeoutMs?: number;
} {
  return {
    ...(options.converterBin ? { converterBin: options.converterBin } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  };
}

function isWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortDeep(child)]),
  );
}
