import * as path from 'node:path';

import {
  DEFAULT_PERSONA_RULES,
  applyPersonaOverrides,
  buildPersonaIdentity,
  buildPersonaV2,
  composePersonaSignals,
  formatNumber,
  formatPercent,
  mergePersonaRules,
  normalizePersonaOverrides,
  normalizePersonaTone,
  personaSignatureFor,
  publicHiddenPersona,
  publicTraitBadge,
  refreshPersonaIdentity,
} from '#taku-passport-core';
import {
  getFlag,
  redactPath,
} from './cli.mjs';
import { createEmptyCreatorMetrics } from './creator-metrics.mjs';
import { readJsonFile } from './draft-state.mjs';
import {
  DEFAULT_MAX_PROJECT_REPOS,
  scanProjectMetadata,
} from './project-metadata.mjs';

export {
  DEFAULT_PERSONA_RULES,
  applyPersonaOverrides,
  buildPersonaIdentity,
  buildPersonaV2,
  composePersonaSignals,
  formatNumber,
  formatPercent,
  mergePersonaRules,
  normalizePersonaOverrides,
  normalizePersonaTone,
  personaSignatureFor,
  publicHiddenPersona,
  publicTraitBadge,
  refreshPersonaIdentity,
} from '#taku-passport-core';

export async function loadPersonaRules(parsed) {
  const explicitPath =
    getFlag(parsed, 'persona-rules') || process.env.TAKU_PERSONA_RULES_PATH;
  if (!explicitPath) {
    return {
      rules: DEFAULT_PERSONA_RULES,
      source: 'passport-core',
      path: undefined,
      warnings: [],
    };
  }
  const candidatePath = path.resolve(explicitPath);
  const warnings = [];
  const externalRules = await readJsonFile(candidatePath);
  if (externalRules) {
    return {
      rules: mergePersonaRules(DEFAULT_PERSONA_RULES, externalRules),
      source: 'custom-file',
      path: redactPath(candidatePath),
      warnings,
    };
  }
  warnings.push(
    `Persona rules file could not be read: ${redactPath(candidatePath)}`,
  );
  return {
    rules: DEFAULT_PERSONA_RULES,
    source: 'passport-core',
    path: undefined,
    warnings,
  };
}

export async function buildPersonaSignals({
  usage,
  usedTools = [],
  ownedCreations = [],
  workspaceRoot,
  maxProjectRepos = DEFAULT_MAX_PROJECT_REPOS,
  creatorMetrics = createEmptyCreatorMetrics(),
  includeGitHubMetrics = false,
  projectMetadata,
  generatedAt,
}) {
  const collectedProjectMetadata =
    projectMetadata ||
    (await scanProjectMetadata({
      workspaceRoot,
      usage,
      ownedCreations,
      maxRepos: maxProjectRepos,
      includeGitHubMetrics,
    }));
  return composePersonaSignals({
    usage,
    usedTools,
    ownedCreations,
    projectMetadata: collectedProjectMetadata,
    creatorMetrics,
    includeGitHubMetrics,
    generatedAt,
  });
}
