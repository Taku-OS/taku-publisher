export type BenchmarkTier = 'pilot' | 'holdout';
export type BenchmarkAgent = 'codex' | 'kimi';

export interface BenchmarkSample {
  id: string;
  repo: string;
  tier: BenchmarkTier;
  framework: string;
  coreWorkflow: string;
  assignedAgent: BenchmarkAgent;
}

export interface BenchmarkGates {
  generated: boolean;
  conversion: boolean;
  build: boolean;
  smoke: boolean;
  safety: boolean;
}

export interface BenchmarkRubric {
  workflow: 0 | 1 | 2;
  actionContract: 0 | 1 | 2;
  honestDependencies: 0 | 1 | 2;
  usability: 0 | 1 | 2;
  maintainability: 0 | 1 | 2;
}

export interface BenchmarkReview {
  gates: BenchmarkGates;
  rubric: BenchmarkRubric;
  evidence?: readonly string[];
}

export interface BenchmarkScore {
  points: number;
  aGrade: boolean;
}

export interface BenchmarkSnapshot {
  commit: string;
  dirtyDigest: string;
}

export interface BenchmarkAgentEvidence {
  identity: BenchmarkAgent;
  model: string;
  reasoningEffort: string;
}

export interface BenchmarkCommandLog {
  command: string;
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface BenchmarkSandboxQualification {
  runner: string;
  qualified: true;
  qualifiedAt: string;
  profileDigest: string;
  workspaceDigest: string;
}

export interface BenchmarkRerunLineage {
  parentRunId: string;
  parentRecordDigest: string;
  reason: string;
}

export interface BenchmarkRunInput {
  runId: string;
  sample: BenchmarkSample;
  source: BenchmarkSnapshot;
  converter: BenchmarkSnapshot;
  template: BenchmarkSnapshot;
  agent: BenchmarkAgentEvidence;
  commands: readonly BenchmarkCommandLog[];
  sandbox: BenchmarkSandboxQualification;
  review: BenchmarkReview;
  rerun?: BenchmarkRerunLineage;
}

export interface BenchmarkRunRecord extends BenchmarkRunInput {
  schemaVersion: 'taku.cold-migration-benchmark.v1';
}

export const BENCHMARK_SAMPLES: readonly BenchmarkSample[] = Object.freeze([
  Object.freeze({
    id: 'roomgpt',
    repo: 'Nutlope/roomGPT',
    tier: 'pilot',
    framework: 'Next.js',
    coreWorkflow: 'Generate interior redesigns from room photos.',
    assignedAgent: 'codex',
  }),
  Object.freeze({
    id: 'openflowkit',
    repo: 'Vrun-design/openflowkit',
    tier: 'pilot',
    framework: 'React',
    coreWorkflow: 'Create and export interactive workflow diagrams.',
    assignedAgent: 'kimi',
  }),
  Object.freeze({
    id: 'robby',
    repo: 'yvann-ba/Robby-chatbot',
    tier: 'pilot',
    framework: 'Streamlit',
    coreWorkflow: 'Chat with uploaded documents and videos.',
    assignedAgent: 'codex',
  }),
  Object.freeze({
    id: 'primusread',
    repo: 'crisanlucid/primusread',
    tier: 'holdout',
    framework: 'vite-react',
    coreWorkflow: 'Open a supported document and complete a reading interaction',
    assignedAgent: 'codex',
  }),
  Object.freeze({
    id: 'podcastfy',
    repo: 'souzatharsis/podcastfy-demo',
    tier: 'holdout',
    framework: 'gradio',
    coreWorkflow: 'Generate a podcast from input content or present a managed-service connection path',
    assignedAgent: 'codex',
  }),
  Object.freeze({
    id: 'stardew',
    repo: 'communitycenter/stardew.app',
    tier: 'holdout',
    framework: 'nextjs',
    coreWorkflow: 'Create and review a game progress/task record',
    assignedAgent: 'kimi',
  }),
  Object.freeze({
    id: 'prettymapp',
    repo: 'chrieke/prettymapp',
    tier: 'holdout',
    framework: 'streamlit',
    coreWorkflow: 'Enter a location and generate or export a map',
    assignedAgent: 'kimi',
  }),
  Object.freeze({
    id: 'nextcrm',
    repo: 'pdovhomilja/nextcrm-app',
    tier: 'holdout',
    framework: 'nextjs',
    coreWorkflow: 'Complete a local CRM primary workflow without fabricated authorization or explicitly separate managed capabilities',
    assignedAgent: 'kimi',
  }),
]);

export function createBenchmarkRun(input: BenchmarkRunInput): BenchmarkRunRecord {
  return {
    ...input,
    schemaVersion: 'taku.cold-migration-benchmark.v1',
  };
}

export function scoreBenchmarkReview(review: BenchmarkReview): BenchmarkScore {
  const points = Object.values(review.rubric).reduce<number>((sum, value) => sum + value, 0);
  return { points, aGrade: Object.values(review.gates).every(Boolean) && points >= 8 };
}

export function validateBenchmarkRun(record: unknown): string[] {
  if (!isRecord(record)) return requiredErrors();

  const errors: string[] = [];
  if (record.schemaVersion !== 'taku.cold-migration-benchmark.v1') {
    errors.push('schema version is invalid');
  }
  const sample = findLockedSample(record.sample);
  if (!isRecord(record.sample)) errors.push('sample is required');
  else if (!sample) errors.push('sample is not a locked benchmark sample');
  if (sample && !hasText(record.runId)) errors.push('run id is required');
  validateSnapshot(record.source, 'source', 'source commit is required', errors);
  validateProvenance(record.converter, 'converter', errors);
  validateProvenance(record.template, 'template', errors);

  if (!isAgentEvidence(record.agent) || !hasCommandEvidence(record.commands)) {
    errors.push('agent evidence is required');
  }
  if (sample && isAgentEvidence(record.agent) && record.agent.identity !== sample.assignedAgent) {
    errors.push('agent assignment does not match sample');
  }
  if (!isSandboxQualification(record.sandbox)) errors.push('sandbox qualification is required');
  if (!isReviewEvidence(record.review)) errors.push('review is required');
  if (record.rerun !== undefined && !isRerunLineage(record.rerun, record.runId)) {
    errors.push('rerun lineage is invalid');
  }

  return errors;
}

function requiredErrors(): string[] {
  return [
    'sample is required',
    'source commit is required',
    'converter provenance is required',
    'template provenance is required',
    'agent evidence is required',
    'sandbox qualification is required',
    'review is required',
  ];
}

function validateSnapshot(value: unknown, name: string, missingMessage: string, errors: string[]): void {
  if (!isSnapshot(value)) {
    errors.push(missingMessage);
    return;
  }
  if (!hasText(value.dirtyDigest)) errors.push(`${name} dirty digest is required`);
}

function validateProvenance(value: unknown, name: string, errors: string[]): void {
  if (!isSnapshot(value)) {
    errors.push(`${name} provenance is required`);
    return;
  }
  if (!hasText(value.dirtyDigest)) errors.push(`${name} dirty digest is required`);
}

function isAgentEvidence(value: unknown): value is BenchmarkAgentEvidence {
  if (!isRecord(value) || (value.identity !== 'codex' && value.identity !== 'kimi')) return false;
  if (!hasText(value.model) || !hasText(value.reasoningEffort)) return false;
  return value.identity !== 'kimi' || (value.model === 'k3' && value.reasoningEffort === 'high');
}

function isSandboxQualification(value: unknown): value is BenchmarkSandboxQualification {
  return (
    isRecord(value) &&
    hasText(value.runner) &&
    value.qualified === true &&
    hasText(value.qualifiedAt) &&
    hasText(value.profileDigest) &&
    hasText(value.workspaceDigest)
  );
}

function isReviewEvidence(value: unknown): value is BenchmarkReview {
  return (
    isRecord(value) &&
    isGates(value.gates) &&
    isRubric(value.rubric) &&
    Array.isArray(value.evidence) &&
    value.evidence.length > 0 &&
    value.evidence.every(hasText)
  );
}

function hasCommandEvidence(value: unknown): value is readonly BenchmarkCommandLog[] {
  return Array.isArray(value) && value.length > 0 && value.every(isCommandLog);
}

function isCommandLog(value: unknown): value is BenchmarkCommandLog {
  return isRecord(value) && hasText(value.command) && typeof value.exitCode === 'number' && Number.isInteger(value.exitCode);
}

function isGates(value: unknown): value is BenchmarkGates {
  return (
    isRecord(value) &&
    ['generated', 'conversion', 'build', 'smoke', 'safety'].every(key => typeof value[key] === 'boolean')
  );
}

function isRubric(value: unknown): value is BenchmarkRubric {
  return (
    isRecord(value) &&
    ['workflow', 'actionContract', 'honestDependencies', 'usability', 'maintainability'].every(
      key => {
        const score = value[key];
        return Number.isInteger(score) && typeof score === 'number' && score >= 0 && score <= 2;
      },
    )
  );
}

function isRerunLineage(value: unknown, runId: unknown): value is BenchmarkRerunLineage {
  return (
    isRecord(value) &&
    hasText(value.parentRunId) &&
    value.parentRunId !== runId &&
    hasText(value.parentRecordDigest) &&
    hasText(value.reason)
  );
}

function findLockedSample(value: unknown): BenchmarkSample | undefined {
  if (!isRecord(value)) return undefined;
  return BENCHMARK_SAMPLES.find(
    sample =>
      sample.id === value.id &&
      sample.repo === value.repo &&
      sample.tier === value.tier &&
      sample.framework === value.framework &&
      sample.coreWorkflow === value.coreWorkflow &&
      sample.assignedAgent === value.assignedAgent,
  );
}

function isSnapshot(value: unknown): value is BenchmarkSnapshot {
  return isRecord(value) && hasText(value.commit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
