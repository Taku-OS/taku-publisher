#!/usr/bin/env node
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_TO_STAX_CONVERTER_VERSION } from './analyze-cli.js';
import { computeTreeDigest } from './lib/tree-digest.js';
import { validateSubAppWorkspace } from './lib/validator.js';

export const REPO_TO_STAX_AGENT_HANDOFF_PROTOCOL =
  'repo-to-stax.agent-handoff.v1';
export const REPO_TO_STAX_CONVERSION_CHECK_PROTOCOL =
  'repo-to-stax.conversion-check.v1';

const REQUIRED_READS = [
  'UPSTREAM_CREDITS.md',
  'STAX_CONVERSION_PLAN.md',
  '.taku/migration.json',
  '.agents/skills/complete-repo-migration/SKILL.md',
  '.agents/skills/migration-safety-review/SKILL.md',
  '.agents/skills/taku-subapp-development/SKILL.md',
  '.agents/skills/taku-action-contract/SKILL.md',
] as const;

const READ_ONLY_PATHS = [
  'upstream-source/**',
  'UPSTREAM_CREDITS.md',
  '.taku/upstream-source-manifest.json',
  '.taku/source-evidence-policy.json',
  'next.config.ts',
  'tsconfig.json',
  'src/__taku/**',
  'src/app/api/taku/**',
  'src/lib/actions/index.ts',
  'src/lib/actions/registry.ts',
  'scripts/start-preview.js',
  'scripts/start-edit.js',
  'scripts/install-with-status.js',
  'scripts/check-design-mode-slots.js',
  'scripts/run-tests.js',
  'scripts/register-test-server-only-hook.mjs',
  'scripts/test-server-only-loader.mjs',
  'scripts/test-server-only-noop.mjs',
] as const;

const FORBIDDEN_ACTIONS = [
  'execute-upstream-source-scripts',
  'add-client-side-credentials',
  'add-public-generic-proxy-routes',
  'alter-template-authority-files',
  'upload-register-or-publish',
] as const;

export async function createAgentHandoff(candidate: string): Promise<unknown> {
  const workspaceRoot = await normalizeCandidate(candidate);
  const candidateDigest = await computeTreeDigest(workspaceRoot);
  const validation = await validateSubAppWorkspace(workspaceRoot, {
    level: 'workspace',
  });
  if (!validation.ok) {
    throw new Error(
      `Candidate failed workspace validation: ${validation.errors.join('; ')}`,
    );
  }
  const migration = await readMigrationSummary(workspaceRoot);
  const candidateDigestAfterValidation = await computeTreeDigest(workspaceRoot);
  if (candidateDigestAfterValidation !== candidateDigest) {
    throw new Error('SubApp candidate changed during Agent handoff validation.');
  }
  return {
    protocol: REPO_TO_STAX_AGENT_HANDOFF_PROTOCOL,
    converterVersion: REPO_TO_STAX_CONVERTER_VERSION,
    workspaceRoot,
    candidateDigest,
    migration,
    validation,
    agentContract: {
      requiredReads: [...REQUIRED_READS],
      readOnlyPaths: [...READ_ONLY_PATHS],
      editableScope: workspaceRoot,
      forbiddenActions: [...FORBIDDEN_ACTIONS],
      completionGate: 'conversion',
      reportPath: 'SUBAGENT_EXPERIENCE.md',
    },
    scriptsExecuted: false,
  };
}

export async function checkAgentConversion(candidate: string): Promise<unknown> {
  const workspaceRoot = await normalizeCandidate(candidate);
  const candidateDigest = await computeTreeDigest(workspaceRoot);
  const validation = await validateSubAppWorkspace(workspaceRoot, {
    level: 'conversion',
  });
  const migration = await readMigrationSummary(workspaceRoot);
  const candidateDigestAfterValidation = await computeTreeDigest(workspaceRoot);
  if (candidateDigestAfterValidation !== candidateDigest) {
    throw new Error('SubApp candidate changed during conversion validation.');
  }
  return {
    protocol: REPO_TO_STAX_CONVERSION_CHECK_PROTOCOL,
    converterVersion: REPO_TO_STAX_CONVERTER_VERSION,
    workspaceRoot,
    candidateDigest,
    migration,
    validation,
    scriptsExecuted: false,
  };
}

async function normalizeCandidate(candidate: string): Promise<string> {
  const requested = String(candidate ?? '').trim();
  if (!isAbsolute(requested)) {
    throw new Error('SubApp candidate must be an absolute directory path.');
  }
  const workspaceRoot = await realpath(requested).catch(() => null);
  if (!workspaceRoot || workspaceRoot !== resolve(requested)) {
    throw new Error('SubApp candidate path is missing or has a symbolic-link ancestor.');
  }
  const metadata = await lstat(workspaceRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('SubApp candidate must be a regular directory.');
  }
  return workspaceRoot;
}

async function readMigrationSummary(workspaceRoot: string): Promise<{
  schemaVersion: string;
  status: string;
  sourceProvenanceDigest: string;
  migrationImmutableDigest: string;
  templateCommit: string;
}> {
  const parsed = JSON.parse(
    await readFile(join(workspaceRoot, '.taku', 'migration.json'), 'utf8'),
  ) as Record<string, unknown>;
  const source = parsed.source as Record<string, unknown> | undefined;
  const template = parsed.template as Record<string, unknown> | undefined;
  const summary = {
    schemaVersion: String(parsed.schemaVersion ?? ''),
    status: String(parsed.status ?? ''),
    sourceProvenanceDigest: String(source?.provenanceDigest ?? ''),
    migrationImmutableDigest: String(source?.migrationImmutableDigest ?? ''),
    templateCommit: String(template?.commit ?? ''),
  };
  if (
    summary.schemaVersion !== 'taku.subapp-migration.v2' ||
    !['workspace', 'converted'].includes(summary.status) ||
    !/^sha256:[a-f0-9]{64}$/.test(summary.sourceProvenanceDigest) ||
    !/^sha256:[a-f0-9]{64}$/.test(summary.migrationImmutableDigest) ||
    !/^[a-f0-9]{40}$/.test(summary.templateCommit)
  ) {
    throw new Error('SubApp candidate migration summary is invalid.');
  }
  return summary;
}

async function main(): Promise<void> {
  const [command, candidate, ...rest] = process.argv.slice(2);
  if (rest.length > 0 || !candidate) {
    throw new Error(
      'Usage: agent-cli <handoff|validate-conversion> <absolute-candidate-path>',
    );
  }
  const result = command === 'handoff'
    ? await createAgentHandoff(candidate)
    : command === 'validate-conversion'
      ? await checkAgentConversion(candidate)
      : null;
  if (!result) throw new Error(`Unsupported Agent command: ${command}`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
