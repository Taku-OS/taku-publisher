import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  assessSubAppSource,
  subAppAssessmentConfirmationToken,
  type AssessSubAppOptions,
  type AssessedSubAppSource,
} from './subapp-assessment.js';
import type { JsonObject, JsonValue } from './types.js';
import { PublisherError } from './util.js';

const PROJECT_IMPORT_SCHEMA = 'taku.project-import-assessment.v1' as const;
const SKILL_CONFIRMATION_PREFIX = 'skill_confirm_';
const WORKFLOW_FILE_SUFFIXES = new Set([
  '.bash', '.js', '.mjs', '.py', '.rb', '.sh', '.ts', '.zsh',
]);

export type ProjectImportRoute =
  | 'subapp-migration'
  | 'existing-skill'
  | 'skill-generation'
  | 'reference-only';

export interface ProjectImportAssessment {
  schemaVersion: typeof PROJECT_IMPORT_SCHEMA;
  source: {
    path: string;
    digest: string;
  };
  project: {
    name: string;
    description: string;
    detectedType: string;
  };
  route: ProjectImportRoute;
  eligibility: 'eligible' | 'review-required' | 'rejected';
  reasons: string[];
  risks: string[];
  confirmationToken: string | null;
  nextCommand: string | null;
  subAppAssessment: JsonValue;
}

export interface AssessProjectOptions extends AssessSubAppOptions {
  homeDir?: string;
}

export async function assessProjectSource(
  sourceInput: string,
  options: AssessProjectOptions = {},
): Promise<ProjectImportAssessment> {
  const source = await validateLocalProjectSource(sourceInput, options.homeDir);
  const assessed = await assessSubAppSource({ source }, options);
  const analysis = assessed.assessment.analysis;
  const rootSkill = path.join(source, 'SKILL.md');
  const hasRootSkill = await isFile(rootSkill);
  const reasons = [...analysis.reasons];
  const risks = [...analysis.risks];
  const base = {
    schemaVersion: PROJECT_IMPORT_SCHEMA,
    source: { path: source, digest: assessed.converter.sourceDigest },
    project: {
      name: analysis.packageName || path.basename(source),
      description: analysis.description || '',
      detectedType: analysis.appType,
    },
    reasons,
    risks,
    subAppAssessment: assessed.assessment as unknown as JsonValue,
  };

  if (hasRootSkill) {
    return {
      ...base,
      route: 'existing-skill',
      eligibility: 'eligible',
      confirmationToken: null,
      nextCommand: 'init',
      reasons: [...reasons, 'A root SKILL.md is already present.'],
    };
  }

  if (assessed.assessment.route.kind === 'subapp-migration') {
    const conversionCanStart = assessed.assessment.eligibility === 'eligible';
    return {
      ...base,
      route: 'subapp-migration',
      eligibility: assessed.assessment.eligibility,
      confirmationToken: conversionCanStart
        ? subAppAssessmentConfirmationToken(assessed)
        : null,
      nextCommand: conversionCanStart ? 'subapp-prepare' : 'subapp-assess',
    };
  }

  if (await isSkillGenerationCandidate(source, assessed)) {
    const reviewRequired = skillGenerationNeedsReview(assessed);
    const draft: ProjectImportAssessment = {
      ...base,
      route: 'skill-generation',
      eligibility: reviewRequired ? 'review-required' : 'eligible',
      confirmationToken: null,
      nextCommand: reviewRequired ? null : 'skill-prepare',
      reasons: [
        ...reasons,
        'A repeatable local workflow was detected without a root SKILL.md.',
      ],
    };
    return {
      ...draft,
      confirmationToken: reviewRequired ? null : skillAssessmentConfirmationToken(draft),
    };
  }

  return {
    ...base,
    route: 'reference-only',
    eligibility: 'rejected',
    confirmationToken: null,
    nextCommand: null,
  };
}

export function skillAssessmentConfirmationToken(
  assessment: Omit<ProjectImportAssessment, 'confirmationToken'> | ProjectImportAssessment,
): string {
  if (assessment.route !== 'skill-generation' || assessment.eligibility !== 'eligible') {
    throw new PublisherError(
      'Only an eligible Skill generation assessment can be confirmed.',
      'skill_generation_not_eligible',
    );
  }
  const canonical = JSON.stringify({
    schemaVersion: assessment.schemaVersion,
    source: assessment.source,
    project: assessment.project,
    route: assessment.route,
    eligibility: assessment.eligibility,
    reasons: assessment.reasons,
    risks: assessment.risks,
  });
  return `${SKILL_CONFIRMATION_PREFIX}${createHash('sha256').update(canonical).digest('hex')}`;
}

export function projectAssessmentJson(
  assessment: ProjectImportAssessment,
): JsonObject {
  return {
    schema_version: assessment.schemaVersion,
    source: assessment.source,
    project: assessment.project,
    route: assessment.route,
    eligibility: assessment.eligibility,
    reasons: assessment.reasons,
    risks: assessment.risks,
    confirmation_token: assessment.confirmationToken,
    next_command: assessment.nextCommand,
    subapp_assessment: assessment.subAppAssessment,
  };
}

async function validateLocalProjectSource(
  sourceInput: string,
  homeDir = os.homedir(),
): Promise<string> {
  if (!path.isAbsolute(sourceInput)) {
    throw new PublisherError(
      'Project assessment requires one explicit absolute local directory.',
      'invalid_project_source',
    );
  }
  const resolved = path.resolve(sourceInput);
  const home = path.resolve(homeDir);
  if (resolved === path.parse(resolved).root || resolved === home) {
    throw new PublisherError(
      'Project assessment cannot use a filesystem root or the whole home directory.',
      'unsafe_project_source',
    );
  }
  const stat = await fsp.lstat(resolved).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new PublisherError(
      'Project assessment source must be an existing non-symlink directory.',
      'invalid_project_source',
    );
  }
  return fsp.realpath(resolved);
}

async function isSkillGenerationCandidate(
  source: string,
  assessed: AssessedSubAppSource,
): Promise<boolean> {
  const appType = assessed.assessment.analysis.appType;
  if (
    assessed.assessment.route.kind === 'reference-only' &&
    ['browser-extension', 'external-connector'].includes(appType)
  ) return false;
  if (appType === 'workflow-skill') return true;
  if (!['python-cli', 'unknown'].includes(appType)) return false;
  const entries = await boundedProjectEntries(source, 3, 600);
  const hasWorkflowFile = entries.some((entry) =>
    WORKFLOW_FILE_SUFFIXES.has(path.extname(entry).toLowerCase()),
  );
  const hasWorkflowMetadata = entries.some((entry) =>
    ['AGENTS.md', 'README.md', 'package.json', 'pyproject.toml', 'requirements.txt']
      .includes(path.basename(entry)),
  );
  return hasWorkflowFile && hasWorkflowMetadata;
}

function skillGenerationNeedsReview(assessed: AssessedSubAppSource): boolean {
  if (assessed.assessment.findings.some((finding) =>
    finding.severity === 'blocker' && finding.code !== 'assessment.subapp-ineligible',
  )) return true;
  if (assessed.assessment.serviceRequirements.some((requirement) => requirement.required)) return true;
  return assessed.assessment.analysis.risks.some((risk) =>
    !/unknown license blocks publish until review/i.test(risk),
  );
}

async function boundedProjectEntries(
  root: string,
  maxDepth: number,
  maxEntries: number,
): Promise<string[]> {
  const output: string[] = [];
  const skipped = new Set([
    '.git', '.next', '.venv', 'build', 'dist', 'node_modules', 'out', 'venv',
  ]);
  const visit = async (current: string, depth: number): Promise<void> => {
    if (output.length >= maxEntries) return;
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (output.length >= maxEntries || entry.isSymbolicLink()) break;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth && !skipped.has(entry.name)) await visit(entryPath, depth + 1);
      } else if (entry.isFile()) {
        output.push(entryPath);
      }
    }
  };
  await visit(root, 0);
  return output;
}

async function isFile(candidate: string): Promise<boolean> {
  return fsp.stat(candidate).then((stat) => stat.isFile(), () => false);
}
