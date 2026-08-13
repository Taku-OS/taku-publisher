import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { JsonObject } from './types.js';
import {
  atomicWriteJson,
  isRecord,
  PublisherError,
  sha256File,
  sortJson,
} from './util.js';

const PACKAGE_SCHEMA = 'taku.publisher.subapp-package.v1';
const HANDOFF_SCHEMA = 'taku.publisher.subapp-install-handoff.v1';
const RESULT_SCHEMA = 'taku.subapp-install-result.v1';
const SOURCE_FILE = 'source.zip';
const BUILD_FILE = 'build.zip';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const HANDOFF_TTL_MS = 10 * 60 * 1000;

export interface SubAppLocalInstallPlan {
  packageRoot: string;
  packageDigest: string;
  manifest: JsonObject;
  confirmationToken: string;
  registrationStarted: false;
  publishStarted: false;
}

export interface SubAppLocalInstallResult {
  packageRoot: string;
  handoffId: string;
  deepLink: string;
  status: 'pending' | 'installed_and_opened' | 'cancelled' | 'failed';
  applicationId?: string;
  error?: string;
  registrationStarted: false;
  publishStarted: false;
}

export interface SubAppLocalInstallOptions {
  handoffRoot?: string;
  now?: () => number;
  openTaku?: (url: string) => Promise<boolean> | boolean;
  takuAppPath?: string;
  waitForResult?: boolean;
  waitTimeoutMs?: number;
  pollIntervalMs?: number;
}

type ValidatedPackage = {
  packageRoot: string;
  manifest: JsonObject;
  source: { sha256: string; size: number; fileCount: number };
  build: { sha256: string; size: number; fileCount: number };
  packageDigest: string;
};

function asPositiveInteger(value: unknown, label: string, maximum: number): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1 || numeric > maximum) {
    throw new PublisherError(`${label} is invalid.`, 'subapp_local_install_package_invalid');
  }
  return numeric;
}

function asSha256(value: unknown, label: string): string {
  const digest = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new PublisherError(`${label} is invalid.`, 'subapp_local_install_package_invalid');
  }
  return digest;
}

async function assertRegularFile(filePath: string, label: string): Promise<fs.Stats> {
  const stat = await fsp.lstat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new PublisherError(`${label} is missing or unsafe.`, 'subapp_local_install_package_invalid');
  }
  return stat;
}

async function validatePackage(packageRootInput: string): Promise<ValidatedPackage> {
  const requested = path.resolve(String(packageRootInput ?? '').trim());
  const rootStat = await fsp.lstat(requested).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new PublisherError(
      'SubApp package root must be an existing local directory.',
      'subapp_local_install_package_invalid',
    );
  }
  const packageRoot = await fsp.realpath(requested);
  const names = (await fsp.readdir(packageRoot)).sort();
  const expectedNames = [BUILD_FILE, 'package-manifest.json', SOURCE_FILE].sort();
  if (names.length !== expectedNames.length || names.some((name, index) => name !== expectedNames[index])) {
    throw new PublisherError(
      'SubApp package root contains unexpected files.',
      'subapp_local_install_package_invalid',
    );
  }
  const manifestPath = path.join(packageRoot, 'package-manifest.json');
  const sourcePath = path.join(packageRoot, SOURCE_FILE);
  const buildPath = path.join(packageRoot, BUILD_FILE);
  const manifestStat = await assertRegularFile(manifestPath, 'SubApp package manifest');
  if (manifestStat.size > MAX_MANIFEST_BYTES) {
    throw new PublisherError('SubApp package manifest is too large.', 'subapp_local_install_package_invalid');
  }

  let value: unknown;
  try {
    value = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) as unknown;
  } catch {
    throw new PublisherError('SubApp package manifest is invalid.', 'subapp_local_install_package_invalid');
  }
  if (!isRecord(value) || value.schemaVersion !== PACKAGE_SCHEMA) {
    throw new PublisherError('SubApp package schema is unsupported.', 'subapp_local_install_package_invalid');
  }
  const runtimeManifest = value.runtimeManifest;
  const sourceValue = value.source;
  const buildValue = value.build;
  const installContract = value.installContract;
  if (!isRecord(runtimeManifest) || !isRecord(sourceValue) || !isRecord(buildValue) || !isRecord(installContract)) {
    throw new PublisherError('SubApp package manifest is incomplete.', 'subapp_local_install_package_invalid');
  }
  if (
    sourceValue.fileName !== SOURCE_FILE ||
    buildValue.fileName !== BUILD_FILE ||
    buildValue.outputDirectory !== '.next-preview' ||
    installContract.buildRequired !== true ||
    installContract.buildOutputDir !== '.next-preview' ||
    installContract.startScriptPreview !== 'start:preview' ||
    installContract.startScriptEdit !== 'start:edit' ||
    value.uploadStarted !== false ||
    value.publishStarted !== false ||
    !Array.isArray(value.serviceAuthorizations) ||
    value.serviceAuthorizations.length > 0
  ) {
    throw new PublisherError(
      'SubApp package does not match the local Taku installation contract.',
      'subapp_local_install_contract_invalid',
    );
  }
  const name = String(runtimeManifest.name ?? '').trim();
  if (!name || name.length > 120) {
    throw new PublisherError('SubApp runtime name is invalid.', 'subapp_local_install_package_invalid');
  }

  const source = {
    sha256: asSha256(sourceValue.sha256, 'SubApp source digest'),
    size: asPositiveInteger(sourceValue.size, 'SubApp source size', MAX_ARCHIVE_BYTES),
    fileCount: asPositiveInteger(sourceValue.fileCount, 'SubApp source file count', 50_000),
  };
  const build = {
    sha256: asSha256(buildValue.sha256, 'SubApp build digest'),
    size: asPositiveInteger(buildValue.size, 'SubApp build size', MAX_ARCHIVE_BYTES),
    fileCount: asPositiveInteger(buildValue.fileCount, 'SubApp build file count', 50_000),
  };
  const [sourceStat, buildStat] = await Promise.all([
    assertRegularFile(sourcePath, 'SubApp source archive'),
    assertRegularFile(buildPath, 'SubApp build archive'),
  ]);
  if (sourceStat.size !== source.size || buildStat.size !== build.size) {
    throw new PublisherError('SubApp archive size changed.', 'subapp_local_install_package_changed');
  }
  const [sourceDigest, buildDigest] = await Promise.all([sha256File(sourcePath), sha256File(buildPath)]);
  if (sourceDigest !== source.sha256 || buildDigest !== build.sha256) {
    throw new PublisherError('SubApp archive digest changed.', 'subapp_local_install_package_changed');
  }
  const canonical = JSON.stringify(sortJson({
    manifest: value,
    sourceSha256: source.sha256,
    buildSha256: build.sha256,
  }));
  const packageDigest = `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
  return { packageRoot, manifest: value, source, build, packageDigest };
}

function confirmationToken(validated: ValidatedPackage): string {
  return `subapp_install_confirm_${createHash('sha256')
    .update(JSON.stringify({ packageDigest: validated.packageDigest, packageRoot: validated.packageRoot }))
    .digest('hex')}`;
}

function resolveHandoffRoot(options: SubAppLocalInstallOptions): string {
  if (options.handoffRoot) return path.resolve(options.handoffRoot);
  return path.join(os.homedir(), '.taku', 'publisher', 'subapp-handoffs');
}

export async function planLocalSubAppInstall(
  request: { packageRoot: string },
): Promise<SubAppLocalInstallPlan> {
  const validated = await validatePackage(request.packageRoot);
  return {
    packageRoot: validated.packageRoot,
    packageDigest: validated.packageDigest,
    manifest: validated.manifest,
    confirmationToken: confirmationToken(validated),
    registrationStarted: false,
    publishStarted: false,
  };
}

async function openTakuDeepLink(url: string, takuAppPath?: string): Promise<boolean> {
  let packagedAppPath = '';
  if (takuAppPath) {
    if (process.platform !== 'darwin') {
      throw new PublisherError(
        'An explicit packaged Taku app path is currently supported only on macOS.',
        'taku_desktop_path_invalid',
      );
    }
    const requested = path.resolve(takuAppPath);
    const stat = await fsp.lstat(requested).catch(() => null);
    if (!stat?.isDirectory() || stat.isSymbolicLink() || !requested.toLowerCase().endsWith('.app')) {
      throw new PublisherError(
        'The explicit Taku Desktop path must be an existing packaged .app directory.',
        'taku_desktop_path_invalid',
      );
    }
    const infoPlist = await fsp.lstat(path.join(requested, 'Contents', 'Info.plist')).catch(() => null);
    const macOsDir = await fsp.lstat(path.join(requested, 'Contents', 'MacOS')).catch(() => null);
    if (!infoPlist?.isFile() || !macOsDir?.isDirectory()) {
      throw new PublisherError(
        'The explicit Taku Desktop path is not a valid packaged macOS app.',
        'taku_desktop_path_invalid',
      );
    }
    packagedAppPath = await fsp.realpath(requested);
  }
  const command = process.platform === 'darwin'
    ? { file: 'open', args: packagedAppPath ? ['-a', packagedAppPath, url] : [url] }
    : process.platform === 'win32'
      ? { file: 'cmd', args: ['/c', 'start', '', url] }
      : { file: 'xdg-open', args: [url] };
  return await new Promise(resolve => {
    let settled = false;
    const child = spawn(command.file, command.args, {
      stdio: 'ignore',
      windowsHide: true,
    });
    const finish = (opened: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(opened);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, 15_000);
    child.once('error', () => finish(false));
    child.once('close', code => finish(code === 0));
  });
}

async function waitForResult(
  resultPath: string,
  handoffId: string,
  options: SubAppLocalInstallOptions,
): Promise<JsonObject | null> {
  if (options.waitForResult === false) return null;
  const deadline = Date.now() + Math.max(1_000, options.waitTimeoutMs ?? 5 * 60_000);
  const interval = Math.max(50, options.pollIntervalMs ?? 250);
  while (Date.now() < deadline) {
    const stat = await fsp.lstat(resultPath).catch(() => null);
    if (stat && (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > MAX_MANIFEST_BYTES ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
      (stat.mode & 0o077) !== 0
    )) {
      throw new PublisherError('Taku returned an unsafe install result.', 'subapp_local_install_result_invalid');
    }
    const raw = stat ? await fsp.readFile(resultPath, 'utf8').catch(() => null) : null;
    if (raw) {
      let result: unknown;
      try {
        result = JSON.parse(raw) as unknown;
      } catch {
        throw new PublisherError('Taku returned an invalid install result.', 'subapp_local_install_result_invalid');
      }
      if (!isRecord(result) || result.schemaVersion !== RESULT_SCHEMA || result.handoffId !== handoffId) {
        throw new PublisherError('Taku returned a mismatched install result.', 'subapp_local_install_result_invalid');
      }
      await fsp.rm(resultPath, { force: true }).catch(() => undefined);
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  return null;
}

export async function requestLocalSubAppInstall(
  request: { packageRoot: string; confirmationToken: string },
  options: SubAppLocalInstallOptions = {},
): Promise<SubAppLocalInstallResult> {
  const validated = await validatePackage(request.packageRoot);
  if (request.confirmationToken !== confirmationToken(validated)) {
    throw new PublisherError(
      'The local SubApp install confirmation is missing, stale, or belongs to different package bytes.',
      'subapp_local_install_confirmation_mismatch',
    );
  }
  const handoffId = randomBytes(32).toString('hex');
  const root = resolveHandoffRoot(options);
  await fsp.mkdir(root, { recursive: true, mode: 0o700 });
  await fsp.chmod(root, 0o700).catch(() => undefined);
  const handoffPath = path.join(root, `${handoffId}.json`);
  const resultPath = path.join(root, `${handoffId}.result.json`);
  const now = (options.now ?? Date.now)();
  const runtimeManifest = validated.manifest.runtimeManifest as JsonObject;
  await atomicWriteJson(handoffPath, {
    schemaVersion: HANDOFF_SCHEMA,
    handoffId,
    packageRoot: validated.packageRoot,
    packageDigest: validated.packageDigest,
    createdAt: now,
    expiresAt: now + HANDOFF_TTL_MS,
    runtimeManifest: {
      name: String(runtimeManifest.name ?? ''),
      description: String(runtimeManifest.description ?? ''),
      version: String(runtimeManifest.version ?? ''),
    },
    source: validated.source,
    build: validated.build,
    installContract: validated.manifest.installContract,
  });
  const deepLink = `taku://subapp/install?handoff=${handoffId}`;
  let opened: boolean;
  try {
    opened = options.openTaku
      ? await options.openTaku(deepLink)
      : await openTakuDeepLink(deepLink, options.takuAppPath);
  } catch (error) {
    await fsp.rm(handoffPath, { force: true }).catch(() => undefined);
    throw error;
  }
  if (!opened) {
    await fsp.rm(handoffPath, { force: true }).catch(() => undefined);
    throw new PublisherError(
      'Taku could not be opened. Install or update the Taku desktop app and try again.',
      'taku_desktop_unavailable',
    );
  }

  const result = await waitForResult(resultPath, handoffId, options);
  if (!result) {
    return {
      packageRoot: validated.packageRoot,
      handoffId,
      deepLink,
      status: 'pending',
      registrationStarted: false,
      publishStarted: false,
    };
  }
  const status = String(result.status ?? 'failed');
  if (status === 'installed_and_opened' && result.ok === true) {
    return {
      packageRoot: validated.packageRoot,
      handoffId,
      deepLink,
      status,
      applicationId: String(result.applicationId ?? ''),
      registrationStarted: false,
      publishStarted: false,
    };
  }
  return {
    packageRoot: validated.packageRoot,
    handoffId,
    deepLink,
    status: status === 'cancelled' ? 'cancelled' : 'failed',
    error: String(result.error ?? '').trim() || undefined,
    registrationStarted: false,
    publishStarted: false,
  };
}
