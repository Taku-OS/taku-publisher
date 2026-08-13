import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { checkSubAppConversion, type SubAppConversionCheck } from './subapp-agent.js';
import type { JsonObject } from './types.js';
import { isRecord, PublisherError, secureDirectory } from './util.js';

const RUNTIME_PROTOCOL = 'repo-to-stax.trusted-runtime.v1';
const SUPPORTED_CONVERTER_VERSIONS = new Set(['0.2.0']);
const REQUIRED_COMMANDS = [
  'install',
  'test',
  'check:slots',
  'type-check',
  'ci:check',
  'build',
] as const;
const MAX_TOOLCHAIN_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const NODE_DISTRIBUTIONS = {
  '20.20.2': {
    arm64: {
      archive: 'node-v20.20.2-darwin-arm64.tar.gz',
      sha256: '466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6',
    },
    x64: {
      archive: 'node-v20.20.2-darwin-x64.tar.gz',
      sha256: '8be6f5e4bb128c82774f8a0b8d7a1cc1365a7977d9657cece0ca647b3fe04e61',
    },
  },
} as const;
const PNPM_DISTRIBUTIONS = {
  '10.15.1': {
    archive: 'pnpm-10.15.1.tgz',
    sha512: 'NOU4wym1VTAUyo6PRTWZf5YYCh0PYUM5NXRJk1NQ2STiL4YUaCGRJk7DPRRirCFWGv+X9rsYBlNRwWLH6PbeZw==',
  },
} as const;

export interface RuntimeRequirements {
  nodeVersion: string;
  pnpmVersion: string;
}

export interface ManagedRuntimeToolchain {
  nodeExecutable: string;
  pnpmCli: string;
}

export interface SubAppRuntimePlan {
  workspaceRoot: string;
  candidateDigest: string;
  nodeVersion: string;
  pnpmVersion: string;
  confirmationToken: string;
  scriptsExecuted: false;
  publishStarted: false;
}

export interface SubAppRuntimeResult {
  ok: boolean;
  workspaceRoot: string;
  candidateDigest: string;
  toolchain: RuntimeRequirements;
  qualification: JsonObject;
  dependencyPrefetch: JsonObject;
  commands: JsonObject[];
  failurePhase: string | null;
  originalCandidateUnchanged: boolean;
  disposableWorkspaceRemoved: boolean;
  scriptsExecutedInDisposableWorkspace: boolean;
  buildArtifact: JsonObject | null;
  publishStarted: false;
  evidenceRoot: string;
}

export interface SubAppRuntimeOptions {
  timeoutMs?: number;
  stateRoot?: string;
  checkConversion?: (
    candidate: string,
    options?: { converterBin?: string; timeoutMs?: number },
  ) => Promise<SubAppConversionCheck>;
  ensureToolchain?: (
    requirements: RuntimeRequirements,
  ) => Promise<ManagedRuntimeToolchain>;
  runRuntime?: (request: {
    candidate: string;
    workRoot: string;
    evidenceRoot: string;
    nodeExecutable: string;
    pnpmCli: string;
    timeoutMs: number;
  }) => Promise<unknown>;
  converterBin?: string;
}

export async function planSubAppRuntimeValidation(
  candidate: string,
  options: SubAppRuntimeOptions = {},
): Promise<SubAppRuntimePlan> {
  const checked = await (options.checkConversion || checkSubAppConversion)(
    candidate,
    conversionOptions(options),
  );
  if (!checked.converted) {
    throw new PublisherError(
      'SubApp candidate must pass the static conversion gate before runtime validation.',
      'subapp_runtime_static_gate_required',
    );
  }
  const requirements = await readRuntimeRequirements(checked.workspaceRoot);
  return {
    workspaceRoot: checked.workspaceRoot,
    candidateDigest: checked.candidateDigest,
    nodeVersion: requirements.nodeVersion,
    pnpmVersion: requirements.pnpmVersion,
    confirmationToken: runtimeConfirmationToken(
      checked.workspaceRoot,
      checked.candidateDigest,
      requirements,
    ),
    scriptsExecuted: false,
    publishStarted: false,
  };
}

export async function runSubAppRuntimeValidation(
  request: { candidate: string; confirmationToken: string },
  options: SubAppRuntimeOptions = {},
): Promise<SubAppRuntimeResult> {
  const plan = await planSubAppRuntimeValidation(request.candidate, options);
  if (request.confirmationToken !== plan.confirmationToken) {
    throw new PublisherError(
      'The trusted-runtime confirmation is missing, stale, or belongs to different candidate content.',
      'subapp_runtime_confirmation_mismatch',
    );
  }

  const requirements = {
    nodeVersion: plan.nodeVersion,
    pnpmVersion: plan.pnpmVersion,
  };
  const stateRoot = await secureDirectory(
    path.resolve(options.stateRoot ?? defaultRuntimeStateRoot()),
  );
  const toolchain = await (options.ensureToolchain || (value =>
    ensureManagedRuntimeToolchain(value, stateRoot)))(requirements);
  const workParent = await secureDirectory(path.join(stateRoot, 'work'));
  const evidenceParent = await secureDirectory(path.join(stateRoot, 'evidence'));
  const workRoot = await fs.mkdtemp(path.join(workParent, 'runtime-'));
  const evidenceRoot = await secureDirectory(
    path.join(evidenceParent, `runtime-${randomUUID()}`),
  );
  const timeoutMs = normalizeCommandTimeout(options.timeoutMs);

  let raw: unknown;
  try {
    raw = await (options.runRuntime || runRepoToStaxRuntime)({
      candidate: plan.workspaceRoot,
      workRoot,
      evidenceRoot,
      nodeExecutable: toolchain.nodeExecutable,
      pnpmCli: toolchain.pnpmCli,
      timeoutMs,
    });
  } finally {
    await fs.rm(workRoot, { recursive: true, force: true });
  }

  const result = validateRuntimeEnvelope(raw, plan, evidenceRoot);
  const after = await (options.checkConversion || checkSubAppConversion)(
    request.candidate,
    conversionOptions(options),
  );
  if (!after.converted || after.candidateDigest !== plan.candidateDigest) {
    throw new PublisherError(
      'The original SubApp candidate changed during trusted runtime validation.',
      'subapp_runtime_candidate_changed',
    );
  }
  if (result.ok) await writeRuntimeReceipt(result);
  return result;
}

export async function ensureManagedRuntimeToolchain(
  requirements: RuntimeRequirements,
  stateRoot = defaultRuntimeStateRoot(),
): Promise<ManagedRuntimeToolchain> {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
    throw new PublisherError(
      'Trusted SubApp runtime validation currently requires macOS Seatbelt.',
      'subapp_runtime_platform_unsupported',
    );
  }
  const nodeRelease = NODE_DISTRIBUTIONS[
    requirements.nodeVersion as keyof typeof NODE_DISTRIBUTIONS
  ];
  const pnpmRelease = PNPM_DISTRIBUTIONS[
    requirements.pnpmVersion as keyof typeof PNPM_DISTRIBUTIONS
  ];
  if (!nodeRelease || !pnpmRelease) {
    throw new PublisherError(
      'The candidate requests a runtime version that is not approved by this Publisher build.',
      'subapp_runtime_version_unapproved',
      { node: requirements.nodeVersion, pnpm: requirements.pnpmVersion },
    );
  }
  const architecture = process.arch as 'arm64' | 'x64';
  const selectedNode = nodeRelease[architecture];
  const runtimeRoot = await secureDirectory(path.resolve(stateRoot));
  const toolchainsRoot = await secureDirectory(path.join(runtimeRoot, 'toolchains'));
  const nodeRoot = path.join(
    toolchainsRoot,
    `node-v${requirements.nodeVersion}-darwin-${architecture}`,
  );
  const nodeExecutable = path.join(nodeRoot, 'bin', 'node');
  const pnpmRoot = path.join(nodeRoot, 'lib', `pnpm-${requirements.pnpmVersion}`);
  const pnpmCli = path.join(pnpmRoot, 'bin', 'pnpm.cjs');

  if (!(await validNode(nodeExecutable, requirements.nodeVersion))) {
    await installVerifiedArchive({
      parent: toolchainsRoot,
      target: nodeRoot,
      url: `https://nodejs.org/dist/v${requirements.nodeVersion}/${selectedNode.archive}`,
      algorithm: 'sha256',
      digest: selectedNode.sha256,
    });
  }
  if (!(await validPnpm(nodeExecutable, pnpmCli, requirements.pnpmVersion))) {
    await installVerifiedArchive({
      parent: path.join(nodeRoot, 'lib'),
      target: pnpmRoot,
      url: `https://registry.npmjs.org/pnpm/-/${pnpmRelease.archive}`,
      algorithm: 'sha512',
      digest: pnpmRelease.sha512,
    });
  }
  if (
    !(await validNode(nodeExecutable, requirements.nodeVersion)) ||
    !(await validPnpm(nodeExecutable, pnpmCli, requirements.pnpmVersion))
  ) {
    throw new PublisherError(
      'The verified SubApp runtime toolchain could not be initialized.',
      'subapp_runtime_toolchain_invalid',
    );
  }
  await ensurePnpmExecutable(nodeRoot, pnpmCli);
  return {
    nodeExecutable: await fs.realpath(nodeExecutable),
    pnpmCli: await fs.realpath(pnpmCli),
  };
}

async function ensurePnpmExecutable(
  nodeRoot: string,
  pnpmCli: string,
): Promise<void> {
  const executable = path.join(nodeRoot, 'bin', 'pnpm');
  const existing = await fs.lstat(executable).catch(() => null);
  const existingTarget = existing
    ? await fs.realpath(executable).catch(() => null)
    : null;
  if (existing?.isSymbolicLink() && existingTarget === await fs.realpath(pnpmCli)) {
    return;
  }
  await fs.rm(executable, { force: true });
  await fs.symlink(path.relative(path.dirname(executable), pnpmCli), executable);
}

export async function runRepoToStaxRuntime(request: {
  candidate: string;
  workRoot: string;
  evidenceRoot: string;
  nodeExecutable: string;
  pnpmCli: string;
  timeoutMs: number;
}): Promise<unknown> {
  const script = createRequire(import.meta.url).resolve(
    'repo-to-stax-converter/runtime-cli',
  );
  const result = await spawnCaptured(
    request.nodeExecutable,
    [
      script,
      'check',
      request.candidate,
      request.workRoot,
      request.evidenceRoot,
      request.pnpmCli,
      String(request.timeoutMs),
    ],
    request.candidate,
    70 * 60_000,
  );
  try {
    const output = JSON.parse(result.stdout) as unknown;
    if (result.code !== 0 && !isRecord(output)) throw new Error('missing failure report');
    return output;
  } catch {
    throw new PublisherError(
      'Trusted SubApp runtime could not produce a validation report.',
      'subapp_runtime_execution_failed',
      { exit_code: result.code, error: result.stderr.slice(0, 2_000) },
    );
  }
}

function validateRuntimeEnvelope(
  value: unknown,
  plan: SubAppRuntimePlan,
  expectedEvidenceRoot: string,
): SubAppRuntimeResult {
  const envelope = requireRecord(value);
  const toolchain = requireRecord(envelope.toolchain);
  const qualification = requireRecord(envelope.qualification);
  const dependencyPrefetch = requireRecord(envelope.dependencyPrefetch);
  const buildArtifact = isRecord(envelope.buildArtifact)
    ? envelope.buildArtifact
    : null;
  const commands = Array.isArray(envelope.commands)
    ? envelope.commands.map(requireRecord)
    : [];
  const ids = commands.map(command => String(command.id ?? ''));
  const expectedPrefix = REQUIRED_COMMANDS.slice(0, ids.length);
  const commandsMatch = JSON.stringify(ids) === JSON.stringify(expectedPrefix);
  const commandsPassed =
    commands.length === REQUIRED_COMMANDS.length &&
    commands.every(command =>
      command.exitCode === 0 &&
      command.signal === null &&
      command.timedOut === false
    );
  const failurePhase = typeof envelope.failurePhase === 'string'
    ? envelope.failurePhase
    : null;
  if (
    envelope.protocol !== RUNTIME_PROTOCOL ||
    !SUPPORTED_CONVERTER_VERSIONS.has(String(envelope.converterVersion ?? '')) ||
    envelope.workspaceRoot !== plan.workspaceRoot ||
    envelope.candidateDigest !== plan.candidateDigest ||
    toolchain.nodeVersion !== plan.nodeVersion ||
    toolchain.pnpmVersion !== plan.pnpmVersion ||
    !commandsMatch ||
    envelope.evidenceRoot !== expectedEvidenceRoot ||
    envelope.publishStarted !== false
  ) {
    throw new PublisherError(
      'Trusted SubApp runtime returned an incompatible validation report.',
      'subapp_runtime_contract_mismatch',
    );
  }
  const ok =
    qualification.qualified === true &&
    dependencyPrefetch.ok === true &&
    commandsPassed &&
    validBuildArtifact(buildArtifact) &&
    envelope.originalCandidateUnchanged === true &&
    envelope.disposableWorkspaceRemoved === true &&
    envelope.scriptsExecutedInDisposableWorkspace === true &&
    failurePhase === null;
  if (typeof envelope.ok === 'boolean' && envelope.ok !== ok) {
    throw new PublisherError(
      'Trusted SubApp runtime success status is inconsistent with its evidence.',
      'subapp_runtime_contract_mismatch',
    );
  }
  return {
    ok,
    workspaceRoot: plan.workspaceRoot,
    candidateDigest: plan.candidateDigest,
    toolchain: {
      nodeVersion: plan.nodeVersion,
      pnpmVersion: plan.pnpmVersion,
    },
    qualification,
    dependencyPrefetch,
    commands,
    failurePhase,
    originalCandidateUnchanged: envelope.originalCandidateUnchanged === true,
    disposableWorkspaceRemoved: envelope.disposableWorkspaceRemoved === true,
    scriptsExecutedInDisposableWorkspace:
      envelope.scriptsExecutedInDisposableWorkspace === true,
    buildArtifact,
    publishStarted: false,
    evidenceRoot: String(envelope.evidenceRoot ?? ''),
  };
}

async function writeRuntimeReceipt(result: SubAppRuntimeResult): Promise<void> {
  const receipt = {
    schemaVersion: 'taku.publisher.subapp-runtime-receipt.v1',
    ok: true,
    candidateDigest: result.candidateDigest,
    toolchain: result.toolchain,
    qualificationDigest: String(result.qualification.profileDigest ?? ''),
    buildArtifact: result.buildArtifact,
    publishStarted: false,
  };
  await fs.writeFile(
    path.join(result.evidenceRoot, 'runtime-receipt.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'wx' },
  );
}

function validBuildArtifact(value: JsonObject | null): value is JsonObject {
  return Boolean(
    value &&
    value.schemaVersion === 'taku.subapp-runtime-build.v1' &&
    value.buildOutputDir === '.next-preview' &&
    value.evidenceRelativePath === 'build-output/.next-preview' &&
    /^sha256:[a-f0-9]{64}$/.test(String(value.treeDigest ?? '')) &&
    Number.isInteger(value.fileCount) &&
    Number(value.fileCount) > 0 &&
    Number.isInteger(value.sizeBytes) &&
    Number(value.sizeBytes) > 0
  );
}

async function readRuntimeRequirements(
  candidate: string,
): Promise<RuntimeRequirements> {
  const [nvmrc, packageContents] = await Promise.all([
    fs.readFile(path.join(candidate, '.nvmrc'), 'utf8'),
    fs.readFile(path.join(candidate, 'package.json'), 'utf8'),
  ]);
  if (!/^\d+\.\d+\.\d+\n$/.test(nvmrc)) {
    throw new PublisherError(
      'SubApp candidate must pin one exact Node version in .nvmrc.',
      'subapp_runtime_requirements_invalid',
    );
  }
  let packageJson: Record<string, unknown>;
  try {
    packageJson = JSON.parse(packageContents) as Record<string, unknown>;
  } catch {
    throw new PublisherError(
      'SubApp candidate package.json is invalid.',
      'subapp_runtime_requirements_invalid',
    );
  }
  const match = String(packageJson.packageManager ?? '').match(
    /^pnpm@(\d+\.\d+\.\d+)$/,
  );
  if (!match?.[1]) {
    throw new PublisherError(
      'SubApp candidate must pin one exact pnpm version.',
      'subapp_runtime_requirements_invalid',
    );
  }
  return { nodeVersion: nvmrc.trim(), pnpmVersion: match[1] };
}

function runtimeConfirmationToken(
  workspaceRoot: string,
  candidateDigest: string,
  requirements: RuntimeRequirements,
): string {
  const payload = JSON.stringify({
    protocol: RUNTIME_PROTOCOL,
    workspaceRoot,
    candidateDigest,
    ...requirements,
    commands: REQUIRED_COMMANDS,
  });
  return `subapp_runtime_confirm_${createHash('sha256').update(payload).digest('hex')}`;
}

async function installVerifiedArchive(options: {
  parent: string;
  target: string;
  url: string;
  algorithm: 'sha256' | 'sha512';
  digest: string;
}): Promise<void> {
  const parent = await secureDirectory(options.parent);
  const stage = await fs.mkdtemp(path.join(parent, '.install-'));
  const archive = path.join(parent, `.download-${randomUUID()}.tgz`);
  try {
    const bytes = await downloadPinnedArtifact(options.url);
    const actual = createHash(options.algorithm)
      .update(bytes)
      .digest(options.algorithm === 'sha512' ? 'base64' : 'hex');
    if (actual !== options.digest) {
      throw new PublisherError(
        'Trusted runtime download failed its compiled checksum.',
        'subapp_runtime_download_checksum_mismatch',
      );
    }
    await fs.writeFile(archive, bytes, { mode: 0o600 });
    const extracted = await spawnCaptured(
      '/usr/bin/tar',
      ['-xzf', archive, '--strip-components=1', '-C', stage],
      parent,
      120_000,
    );
    if (extracted.code !== 0) {
      throw new PublisherError(
        'Trusted runtime archive could not be extracted.',
        'subapp_runtime_archive_invalid',
      );
    }
    try {
      await fs.rename(stage, options.target);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw error;
      }
    }
  } finally {
    await fs.rm(archive, { force: true });
    await fs.rm(stage, { recursive: true, force: true });
  }
}

async function downloadPinnedArtifact(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    !['nodejs.org', 'registry.npmjs.org'].includes(parsed.hostname)
  ) {
    throw new PublisherError(
      'Trusted runtime artifact host is not approved.',
      'subapp_runtime_download_host_unapproved',
    );
  }
  let response: Response;
  try {
    response = await fetch(parsed, { redirect: 'error' });
  } catch (error) {
    throw new PublisherError(
      'Trusted runtime artifact could not be downloaded.',
      'subapp_runtime_download_failed',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  if (!response.ok || !response.body) {
    throw new PublisherError(
      'Trusted runtime artifact download returned an unexpected response.',
      'subapp_runtime_download_failed',
      { status: response.status },
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_TOOLCHAIN_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new PublisherError(
        'Trusted runtime artifact exceeds the download limit.',
        'subapp_runtime_download_too_large',
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), length);
}

async function validNode(executable: string, version: string): Promise<boolean> {
  try {
    const metadata = await fs.lstat(executable);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
    const result = await spawnCaptured(executable, ['--version'], path.dirname(executable), 10_000);
    return result.code === 0 && result.stdout.trim() === `v${version}`;
  } catch {
    return false;
  }
}

async function validPnpm(
  nodeExecutable: string,
  pnpmCli: string,
  version: string,
): Promise<boolean> {
  try {
    const metadata = await fs.lstat(pnpmCli);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
    const result = await spawnCaptured(
      nodeExecutable,
      [pnpmCli, '--version'],
      path.dirname(pnpmCli),
      10_000,
    );
    return result.code === 0 && result.stdout.trim() === version;
  } catch {
    return false;
  }
}

function spawnCaptured(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        PATH: [path.dirname(command), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
        HOME: cwd,
        TMPDIR: `${cwd}${path.sep}`,
        CI: '1',
        NO_COLOR: '1',
      },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr });
    });
    const timer = setTimeout(() => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    }, timeoutMs);
  });
}

function conversionOptions(options: SubAppRuntimeOptions): {
  converterBin?: string;
  timeoutMs?: number;
} {
  return {
    ...(options.converterBin ? { converterBin: options.converterBin } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  };
}

function normalizeCommandTimeout(value: number | undefined): number {
  const timeout = value ?? 120_000;
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
    throw new PublisherError(
      'Trusted runtime command timeout must be between 1 and 120 seconds.',
      'subapp_runtime_timeout_invalid',
    );
  }
  return timeout;
}

function defaultRuntimeStateRoot(): string {
  return path.join(os.homedir(), '.taku', 'publisher', 'subapp-runtime');
}

function requireRecord(value: unknown): JsonObject {
  if (!isRecord(value)) {
    throw new PublisherError(
      'Trusted SubApp runtime returned malformed evidence.',
      'subapp_runtime_contract_mismatch',
    );
  }
  return value;
}
