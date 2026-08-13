import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  assertSubAppValidationResult,
  type SubAppValidationResultV1,
} from '@taku/subapp-contract';

import {
  runRepoToStaxAgentCommand,
  type ConverterAgentRunner,
} from './subapp-assessment.js';
import type { JsonObject } from './types.js';
import { isRecord, PublisherError } from './util.js';

const AGENT_HANDOFF_PROTOCOL = 'repo-to-stax.agent-handoff.v1';
const CONVERSION_CHECK_PROTOCOL = 'repo-to-stax.conversion-check.v1';
const SUPPORTED_CONVERTER_VERSIONS = new Set(['0.2.0']);
const REQUIRED_READS = [
  'UPSTREAM_CREDITS.md',
  'STAX_CONVERSION_PLAN.md',
  '.taku/migration.json',
  '.agents/skills/complete-repo-migration/SKILL.md',
  '.agents/skills/migration-safety-review/SKILL.md',
  '.agents/skills/taku-subapp-development/SKILL.md',
  '.agents/skills/taku-action-contract/SKILL.md',
];
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
];
const FORBIDDEN_ACTIONS = [
  'execute-upstream-source-scripts',
  'add-client-side-credentials',
  'add-public-generic-proxy-routes',
  'alter-template-authority-files',
  'upload-register-or-publish',
];

export interface SubAppAgentOptions {
  converterBin?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  runConverter?: ConverterAgentRunner;
}

export interface SubAppAgentHandoff {
  workspaceRoot: string;
  candidateDigest: string;
  migration: JsonObject;
  validation: SubAppValidationResultV1;
  agentContract: {
    requiredReads: string[];
    readOnlyPaths: string[];
    editableScope: string;
    forbiddenActions: string[];
    completionGate: 'conversion';
    reportPath: 'SUBAGENT_EXPERIENCE.md';
  };
}

export interface SubAppConversionCheck {
  workspaceRoot: string;
  candidateDigest: string;
  migration: JsonObject;
  validation: SubAppValidationResultV1;
  converted: boolean;
}

export async function createSubAppAgentHandoff(
  candidate: string,
  options: SubAppAgentOptions = {},
): Promise<SubAppAgentHandoff> {
  const workspaceRoot = await normalizeCandidate(candidate);
  const output = await runAgentConverter('handoff', workspaceRoot, options);
  const envelope = validateEnvelope(
    output,
    AGENT_HANDOFF_PROTOCOL,
    workspaceRoot,
  );
  const validation = validateResult(envelope.validation, 'workspace');
  if (!validation.ok) {
    throw new PublisherError(
      'SubApp candidate is not safe to hand to the conversion Agent.',
      'subapp_agent_handoff_rejected',
      { errors: validation.errors },
    );
  }
  const agentContract = requireRecord(
    envelope.agentContract,
    'SubApp Agent handoff is missing its contract.',
  );
  const normalizedContract = {
    requiredReads: stringArray(agentContract.requiredReads),
    readOnlyPaths: stringArray(agentContract.readOnlyPaths),
    editableScope: stringValue(agentContract.editableScope),
    forbiddenActions: stringArray(agentContract.forbiddenActions),
    completionGate: stringValue(agentContract.completionGate),
    reportPath: stringValue(agentContract.reportPath),
  };
  if (
    JSON.stringify(normalizedContract.requiredReads) !== JSON.stringify(REQUIRED_READS) ||
    JSON.stringify(normalizedContract.readOnlyPaths) !== JSON.stringify(READ_ONLY_PATHS) ||
    normalizedContract.editableScope !== workspaceRoot ||
    JSON.stringify(normalizedContract.forbiddenActions) !== JSON.stringify(FORBIDDEN_ACTIONS) ||
    normalizedContract.completionGate !== 'conversion' ||
    normalizedContract.reportPath !== 'SUBAGENT_EXPERIENCE.md' ||
    envelope.scriptsExecuted !== false
  ) {
    throw new PublisherError(
      'SubApp Agent handoff contract is incompatible with this Publisher build.',
      'subapp_agent_contract_mismatch',
    );
  }
  return {
    workspaceRoot,
    candidateDigest: digestValue(envelope.candidateDigest),
    migration: migrationSummary(envelope.migration),
    validation,
    agentContract: normalizedContract as SubAppAgentHandoff['agentContract'],
  };
}

export async function checkSubAppConversion(
  candidate: string,
  options: SubAppAgentOptions = {},
): Promise<SubAppConversionCheck> {
  const workspaceRoot = await normalizeCandidate(candidate);
  const output = await runAgentConverter(
    'validate-conversion',
    workspaceRoot,
    options,
  );
  const envelope = validateEnvelope(
    output,
    CONVERSION_CHECK_PROTOCOL,
    workspaceRoot,
  );
  const validation = validateResult(envelope.validation, 'conversion');
  if (envelope.scriptsExecuted !== false) {
    throw new PublisherError(
      'SubApp conversion check crossed the static-validation boundary.',
      'subapp_agent_contract_mismatch',
    );
  }
  const migration = migrationSummary(envelope.migration);
  return {
    workspaceRoot,
    candidateDigest: digestValue(envelope.candidateDigest),
    migration,
    validation,
    converted: validation.ok && migration.status === 'converted',
  };
}

async function runAgentConverter(
  command: 'handoff' | 'validate-conversion',
  candidate: string,
  options: SubAppAgentOptions,
): Promise<unknown> {
  return (options.runConverter || runRepoToStaxAgentCommand)({
    command,
    candidate,
    ...(options.converterBin ? { converterBin: options.converterBin } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.env ? { env: options.env } : {}),
  });
}

async function normalizeCandidate(candidate: string): Promise<string> {
  const requested = String(candidate ?? '').trim();
  if (!path.isAbsolute(requested)) {
    throw new PublisherError(
      'SubApp candidate must be an absolute directory path.',
      'subapp_candidate_not_absolute',
    );
  }
  try {
    const canonical = await fs.realpath(requested);
    const metadata = await fs.lstat(canonical);
    if (
      canonical !== path.resolve(requested) ||
      !metadata.isDirectory() ||
      metadata.isSymbolicLink()
    ) {
      throw new Error('unsafe candidate');
    }
    return canonical;
  } catch {
    throw new PublisherError(
      'SubApp candidate does not exist or has an unsafe path.',
      'subapp_candidate_unreadable',
    );
  }
}

function validateEnvelope(
  output: unknown,
  protocol: string,
  workspaceRoot: string,
): JsonObject {
  const envelope = requireRecord(
    output,
    'SubApp Converter Agent output must be an object.',
  );
  if (
    stringValue(envelope.protocol) !== protocol ||
    !SUPPORTED_CONVERTER_VERSIONS.has(stringValue(envelope.converterVersion)) ||
    stringValue(envelope.workspaceRoot) !== workspaceRoot
  ) {
    throw new PublisherError(
      'SubApp Converter Agent protocol is incompatible with this Publisher build.',
      'subapp_agent_converter_incompatible',
    );
  }
  return envelope;
}

function validateResult(
  value: unknown,
  level: 'workspace' | 'conversion',
): SubAppValidationResultV1 {
  try {
    const validation = assertSubAppValidationResult(value);
    if (validation.level !== level) throw new Error(`Expected ${level} validation.`);
    return validation;
  } catch (error) {
    throw new PublisherError(
      'SubApp Converter returned an invalid validation result.',
      'subapp_agent_contract_mismatch',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
}

function migrationSummary(value: unknown): JsonObject {
  const migration = requireRecord(
    value,
    'SubApp Agent output is missing migration provenance.',
  );
  const status = stringValue(migration.status);
  if (
    stringValue(migration.schemaVersion) !== 'taku.subapp-migration.v2' ||
    !['workspace', 'converted'].includes(status) ||
    !/^sha256:[a-f0-9]{64}$/.test(stringValue(migration.sourceProvenanceDigest)) ||
    !/^sha256:[a-f0-9]{64}$/.test(stringValue(migration.migrationImmutableDigest)) ||
    !/^[a-f0-9]{40}$/.test(stringValue(migration.templateCommit))
  ) {
    throw new PublisherError(
      'SubApp Agent migration provenance is invalid.',
      'subapp_agent_contract_mismatch',
    );
  }
  return migration;
}

function digestValue(value: unknown): string {
  const digest = stringValue(value);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new PublisherError(
      'SubApp Agent candidate digest is invalid.',
      'subapp_agent_contract_mismatch',
    );
  }
  return digest;
}

function requireRecord(value: unknown, message: string): JsonObject {
  if (!isRecord(value)) {
    throw new PublisherError(message, 'subapp_agent_contract_mismatch');
  }
  return value;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
