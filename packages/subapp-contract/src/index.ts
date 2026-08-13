import { createHash } from 'node:crypto';

export const SUBAPP_CONTRACT_VERSION = '0.1.0' as const;
export const SUBAPP_ASSESSMENT_SCHEMA_VERSION =
  'taku.subapp-assessment.v1' as const;
export const SUBAPP_MIGRATION_SCHEMA_VERSION =
  'taku.subapp-migration.v2' as const;
export const SUBAPP_VALIDATION_SCHEMA_VERSION =
  'taku.subapp-validation.v1' as const;
export const SUBAPP_RELEASE_SCHEMA_VERSION = 'taku.subapp-release.v1' as const;

export const SUBAPP_RUNTIME_MANIFEST_FILE = 'taku.manifest.json' as const;
export const SUBAPP_MIGRATION_RECORD_FILE = '.taku/migration.json' as const;
export const SUBAPP_SOURCE_ARCHIVE_FILE = 'source.zip' as const;
export const SUBAPP_BUILD_ARCHIVE_FILE = 'build.zip' as const;
export const SUBAPP_BUILD_OUTPUT_DIRECTORY = '.next-preview' as const;

export const SUBAPP_PROJECT_TYPES = [
  'nextjs',
  'vite-react',
  'fastapi-next',
  'streamlit',
  'gradio',
  'workflow-skill',
  'browser-extension',
  'external-connector',
  'python-cli',
  'unknown',
] as const;

export const SUBAPP_ROUTE_KINDS = [
  'subapp-migration',
  'native-import',
  'reference-only',
] as const;

export const SUBAPP_RECOMMENDATIONS = [
  'convertible',
  'manual-review',
  'not-recommended',
] as const;

export const SUBAPP_ELIGIBILITY = [
  'eligible',
  'review-required',
  'rejected',
] as const;

export type SubAppProjectType = (typeof SUBAPP_PROJECT_TYPES)[number];
export type SubAppRouteKind = (typeof SUBAPP_ROUTE_KINDS)[number];
export type SubAppRecommendation = (typeof SUBAPP_RECOMMENDATIONS)[number];
export type SubAppEligibility = (typeof SUBAPP_ELIGIBILITY)[number];
export type SubAppSourceKind = 'local' | 'github';

export interface SubAppAssessmentSourceV1 {
  kind: SubAppSourceKind;
  /** Private locator used only by the local assessment process. */
  locator: string;
  repo?: string;
  url?: string;
  ref?: string | null;
  commit?: string | null;
  dirty?: boolean | null;
}

export interface SubAppAnalysisV1 {
  packageName: string;
  description: string;
  appType: SubAppProjectType;
  score: number;
  recommendation: SubAppRecommendation;
  strategy: string;
  license: string;
  hasReadme: boolean;
  hasUi: boolean;
  reasons: string[];
  risks: string[];
}

export interface SubAppRouteV1 {
  kind: SubAppRouteKind;
  capability: SubAppProjectType;
  reason: string;
  nextAction: string;
}

export interface SubAppAssessmentFindingV1 {
  code: string;
  category: 'technical' | 'security' | 'rights' | 'runtime' | 'product';
  severity: 'info' | 'warning' | 'blocker';
  message: string;
  path?: string;
}

export interface SubAppServiceRequirementV1 {
  id: string;
  capability: string;
  required: boolean;
  detectedProvider?: string;
  operations: string[];
  dataClasses: string[];
  mutation: boolean;
  mapping: {
    status: 'mapped' | 'review-required' | 'unavailable';
    /** Catalog service ID from taku-ai-proxy-go; never an upstream URL. */
    serviceId?: string;
    /** Catalog endpoint IDs from taku-ai-proxy-go; never credentials. */
    endpointIds?: string[];
    reason?: string;
  };
}

export interface SubAppAssessmentV1 {
  schemaVersion: typeof SUBAPP_ASSESSMENT_SCHEMA_VERSION;
  contractVersion: typeof SUBAPP_CONTRACT_VERSION;
  assessmentId: string;
  assessedAt: string;
  privacy: {
    localOnly: true;
    uploads: false;
    localLocatorIncluded: true;
  };
  source: SubAppAssessmentSourceV1;
  analysis: SubAppAnalysisV1;
  route: SubAppRouteV1;
  serviceRequirements: SubAppServiceRequirementV1[];
  eligibility: SubAppEligibility;
  nextStep:
    | 'start-conversion'
    | 'manual-review'
    | 'native-import'
    | 'reference-only'
    | 'stop';
  findings: SubAppAssessmentFindingV1[];
}

export interface SubAppAssessmentInput {
  assessmentId?: unknown;
  assessedAt?: unknown;
  source: SubAppAssessmentSourceV1;
  analysis: SubAppAnalysisV1;
  route: SubAppRouteV1;
  serviceRequirements?: SubAppServiceRequirementV1[];
  findings?: SubAppAssessmentFindingV1[];
}

export interface SubAppMigrationOmissionV2 {
  relativePath: string;
  size: number;
  reason: 'oversized-documentation-media';
}

export interface SubAppMigrationRecordV2 {
  schemaVersion: typeof SUBAPP_MIGRATION_SCHEMA_VERSION;
  status: 'workspace' | 'converted';
  createdAt: string;
  source: {
    kind: SubAppSourceKind;
    url: string;
    repo: string;
    commit: string | null;
    ref: string | null;
    dirty: boolean | null;
    license: string;
    snapshotPath: 'upstream-source';
    snapshotDigest: string;
    snapshotPolicy: 'taku.upstream-source-snapshot.v1';
    snapshotCompleteness: 'complete' | 'partial';
    omissions: SubAppMigrationOmissionV2[];
    sourceManifestPath: '.taku/upstream-source-manifest.json';
    sourceManifestDigest: string;
    sourceEvidencePolicyPath: '.taku/source-evidence-policy.json';
    sourceEvidencePolicyDigest: string;
    migrationImmutableDigest: string;
    provenanceDigest: string;
  };
  template: {
    kind: 'local' | 'github';
    url: string;
    requestedRef: string | null;
    resolvedRef: string | null;
    commit: string | null;
    version: string | null;
    policyApplied: boolean;
    dirty: boolean | null;
    snapshotDigest: string;
  };
  analysis: {
    appType: SubAppProjectType;
    strategy: string;
    score: number;
    recommendation: SubAppRecommendation;
    risks: string[];
    riskResolutions: Array<{
      risk: string;
      status: 'resolved';
      evidence: string;
    }>;
  };
}

export type SubAppValidationLevel = 'workspace' | 'conversion' | 'publish';

export interface SubAppValidationFindingV1 {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
}

export interface SubAppValidationResultV1 {
  schemaVersion: typeof SUBAPP_VALIDATION_SCHEMA_VERSION;
  level: SubAppValidationLevel;
  ok: boolean;
  findings: SubAppValidationFindingV1[];
  errors: string[];
  warnings: string[];
}

export type SubAppActionParamType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'filePath'
  | 'directoryPath';

export interface SubAppActionParamV1 {
  type: SubAppActionParamType;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  ui?: {
    label?: string;
    placeholder?: string;
    widget?:
      | 'text'
      | 'textarea'
      | 'select'
      | 'number'
      | 'switch'
      | 'filePicker'
      | 'pathPicker';
  };
}

export interface SubAppActionV1 {
  name: string;
  description?: string;
  runtime?: 'server_http' | 'client_postmessage';
  params?: Record<string, SubAppActionParamV1>;
  returns?: { type?: string; description?: string };
  execution?: { defaultMode?: 'sync' | 'async'; timeoutMs?: number };
  isUserVisible?: boolean;
}

/** Runtime-only shape of the existing, intentionally unversioned taku.manifest.json. */
export interface TakuSubAppRuntimeManifestV1 {
  name: string;
  description?: string;
  version?: string;
  iconPath?: string;
  actions?: SubAppActionV1[];
  llm?: {
    required?: boolean;
    preferLocal?: boolean;
    fallback?: 'cloud' | 'none';
  };
}

export interface SubAppPublishSourceRightsV1 {
  authorshipKind: 'original' | 'derived' | 'third_party';
  rightsBasis: 'self_owned' | 'open_source_license' | 'explicit_permission';
  sourceUrl: string;
  sourceAuthor: string;
  license: string;
  sourceNotes: string;
}

export interface SubAppReleaseArtifactV1 {
  fileName: typeof SUBAPP_SOURCE_ARCHIVE_FILE | typeof SUBAPP_BUILD_ARCHIVE_FILE;
  url: string;
  sha256: string;
  size: number;
}

export interface SubAppServiceAuthorizationV1 {
  serviceId: string;
  endpointIds: string[];
}

/** Public, installable projection returned after Taku registers an App version. */
export interface SubAppReleaseV1 {
  schemaVersion: typeof SUBAPP_RELEASE_SCHEMA_VERSION;
  contractVersion: typeof SUBAPP_CONTRACT_VERSION;
  appId: string;
  versionNumber: number;
  manifest: TakuSubAppRuntimeManifestV1;
  source: SubAppReleaseArtifactV1 & { fileName: typeof SUBAPP_SOURCE_ARCHIVE_FILE };
  build: SubAppReleaseArtifactV1 & { fileName: typeof SUBAPP_BUILD_ARCHIVE_FILE };
  publishManifest: {
    releaseNotes: string;
    buildRequired: true;
    buildOutputDir: typeof SUBAPP_BUILD_OUTPUT_DIRECTORY;
    startScriptPreview: 'start:preview';
    startScriptEdit: 'start:edit';
    sourceHash: string;
    buildHash: string;
    sourceSize: number;
    buildSize: number;
    sourceRights: SubAppPublishSourceRightsV1;
    serviceAuthorizations?: SubAppServiceAuthorizationV1[];
  };
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PREFIXED_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const RELATIVE_PATH_PATTERN =
  /^(?!\/)(?![A-Za-z]:[\\/])(?!.*(?:^|\/)\.\.(?:\/|$))[^\0]+$/;
const PRIVATE_PATH_PATTERN =
  /(?:^|[\s"'`(])(?:\/Users|\/home|\/private\/var\/folders|\/var\/folders|\/Volumes)\/[^\s"'`)]+|[A-Za-z]:\\(?:Users|Documents and Settings)\\/;
const FILE_URL_PATTERN = /file:\/\/\//i;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;
const KNOWN_TOKEN_PATTERN =
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{20,})\b/;
const FORBIDDEN_PUBLIC_KEYS = new Set([
  'accessToken',
  'authorization',
  'cookie',
  'env',
  'environment',
  'localPath',
  'local_path',
  'locator',
  'refreshToken',
  'session',
  'sourceContent',
  'token',
]);

export function createSubAppAssessment(
  input: SubAppAssessmentInput,
): SubAppAssessmentV1 {
  const assessedAt = validTimestamp(input.assessedAt) || new Date().toISOString();
  const serviceRequirements = (input.serviceRequirements || []).map(cloneServiceRequirement);
  const findings = normalizeFindings(
    input.findings,
    input.analysis.risks,
    serviceRequirements,
  );
  const eligibility = eligibilityFor(
    input.analysis,
    input.route,
    serviceRequirements,
    findings,
  );
  const nextStep = nextStepFor(eligibility, input.route.kind);
  if (eligibility === 'rejected' && !findings.some((finding) => finding.severity === 'blocker')) {
    findings.push({
      code: 'assessment.subapp-ineligible',
      category: 'product',
      severity: 'blocker',
      message:
        input.route.kind === 'subapp-migration'
          ? 'Static assessment does not recommend starting SubApp conversion.'
          : input.route.reason,
    });
  }
  const assessmentId = cleanText(input.assessmentId, 160) || `assessment_${createHash('sha256')
    .update(`${assessedAt}\0${input.source.kind}\0${input.source.locator}`)
    .digest('hex')
    .slice(0, 24)}`;

  const assessment: SubAppAssessmentV1 = {
    schemaVersion: SUBAPP_ASSESSMENT_SCHEMA_VERSION,
    contractVersion: SUBAPP_CONTRACT_VERSION,
    assessmentId,
    assessedAt,
    privacy: {
      localOnly: true,
      uploads: false,
      localLocatorIncluded: true,
    },
    source: { ...input.source },
    analysis: cloneAnalysis(input.analysis),
    route: { ...input.route },
    serviceRequirements,
    eligibility,
    nextStep,
    findings,
  };
  return assertSubAppAssessment(assessment);
}

export function assertSubAppAssessment(value: unknown): SubAppAssessmentV1 {
  const assessment = requireRecord(value, 'SubApp assessment');
  assertExactKeys(assessment, [
    'schemaVersion',
    'contractVersion',
    'assessmentId',
    'assessedAt',
    'privacy',
    'source',
    'analysis',
    'route',
    'serviceRequirements',
    'eligibility',
    'nextStep',
    'findings',
  ], 'SubApp assessment');
  requireEqual(assessment.schemaVersion, SUBAPP_ASSESSMENT_SCHEMA_VERSION, 'assessment schemaVersion');
  requireEqual(assessment.contractVersion, SUBAPP_CONTRACT_VERSION, 'assessment contractVersion');
  requireText(assessment.assessmentId, 'assessmentId');
  requireTimestamp(assessment.assessedAt, 'assessedAt');

  const privacy = requireRecord(assessment.privacy, 'assessment privacy');
  assertExactKeys(privacy, ['localOnly', 'uploads', 'localLocatorIncluded'], 'assessment privacy');
  if (privacy.localOnly !== true || privacy.uploads !== false || privacy.localLocatorIncluded !== true) {
    throw new TypeError('SubApp assessment must remain private and local-only.');
  }

  const source = requireRecord(assessment.source, 'assessment source');
  assertExactKeys(source, ['kind', 'locator', 'repo', 'url', 'ref', 'commit', 'dirty'], 'assessment source');
  requireEnum(source.kind, ['local', 'github'], 'assessment source kind');
  requireText(source.locator, 'assessment source locator');
  optionalNullableText(source.ref, 'assessment source ref');
  optionalNullableText(source.commit, 'assessment source commit');
  if (source.dirty !== undefined && source.dirty !== null && typeof source.dirty !== 'boolean') {
    throw new TypeError('Assessment source dirty must be boolean or null.');
  }

  const analysis = assertAnalysis(assessment.analysis);
  const route = assertRoute(assessment.route);
  if (route.capability !== analysis.appType) {
    throw new TypeError(
      'Assessment route capability must match the detected appType.',
    );
  }
  const expectedRoute = routeKindForProjectType(analysis.appType);
  if (route.kind !== expectedRoute) {
    throw new TypeError(
      `Assessment route for ${analysis.appType} must be ${expectedRoute}.`,
    );
  }
  const serviceRequirements = requireArray(
    assessment.serviceRequirements,
    'assessment serviceRequirements',
  ).map(assertServiceRequirement);
  const serviceIds = serviceRequirements.map((requirement) => requirement.id);
  if (new Set(serviceIds).size !== serviceIds.length) {
    throw new TypeError('Assessment service requirement IDs must be unique.');
  }
  const findings = requireArray(assessment.findings, 'assessment findings');
  for (const finding of findings) assertAssessmentFinding(finding);
  const eligibility = requireEnum(
    assessment.eligibility,
    SUBAPP_ELIGIBILITY,
    'assessment eligibility',
  );
  const expectedEligibility = eligibilityFor(
    analysis,
    route,
    serviceRequirements,
    findings as SubAppAssessmentFindingV1[],
  );
  if (eligibility !== expectedEligibility) {
    throw new TypeError(`Assessment eligibility must be ${expectedEligibility} for its route and recommendation.`);
  }
  const expectedNextStep = nextStepFor(expectedEligibility, route.kind);
  requireEqual(assessment.nextStep, expectedNextStep, 'assessment nextStep');
  if (eligibility === 'eligible' && findings.some((item) => requireRecord(item, 'finding').severity === 'blocker')) {
    throw new TypeError('Eligible assessments cannot contain blocker findings.');
  }
  if (eligibility === 'rejected' && !findings.some((item) => requireRecord(item, 'finding').severity === 'blocker')) {
    throw new TypeError('Rejected assessments require at least one blocker finding.');
  }
  return value as SubAppAssessmentV1;
}

export function assertSubAppMigrationRecord(value: unknown): SubAppMigrationRecordV2 {
  const record = requireRecord(value, 'SubApp migration record');
  assertExactKeys(record, ['schemaVersion', 'status', 'createdAt', 'source', 'template', 'analysis'], 'SubApp migration record');
  requireEqual(record.schemaVersion, SUBAPP_MIGRATION_SCHEMA_VERSION, 'migration schemaVersion');
  requireEnum(record.status, ['workspace', 'converted'], 'migration status');
  requireTimestamp(record.createdAt, 'migration createdAt');

  const source = requireRecord(record.source, 'migration source');
  assertExactKeys(source, [
    'kind', 'url', 'repo', 'commit', 'ref', 'dirty', 'license', 'snapshotPath',
    'snapshotDigest', 'snapshotPolicy', 'snapshotCompleteness', 'omissions',
    'sourceManifestPath', 'sourceManifestDigest', 'sourceEvidencePolicyPath',
    'sourceEvidencePolicyDigest', 'migrationImmutableDigest', 'provenanceDigest',
  ], 'migration source');
  requireEnum(source.kind, ['local', 'github'], 'migration source kind');
  for (const key of ['url', 'repo', 'license'] as const) requireText(source[key], `migration source ${key}`);
  optionalNullableText(source.commit, 'migration source commit');
  optionalNullableText(source.ref, 'migration source ref');
  if (source.dirty !== null && typeof source.dirty !== 'boolean') {
    throw new TypeError('Migration source dirty must be boolean or null.');
  }
  requireEqual(source.snapshotPath, 'upstream-source', 'migration snapshotPath');
  requireEqual(source.snapshotPolicy, 'taku.upstream-source-snapshot.v1', 'migration snapshotPolicy');
  requireEnum(source.snapshotCompleteness, ['complete', 'partial'], 'migration snapshotCompleteness');
  requireEqual(source.sourceManifestPath, '.taku/upstream-source-manifest.json', 'migration sourceManifestPath');
  requireEqual(source.sourceEvidencePolicyPath, '.taku/source-evidence-policy.json', 'migration sourceEvidencePolicyPath');
  for (const key of [
    'snapshotDigest', 'sourceManifestDigest', 'sourceEvidencePolicyDigest',
    'migrationImmutableDigest', 'provenanceDigest',
  ] as const) requirePrefixedSha256(source[key], `migration ${key}`);
  const omissions = requireArray(source.omissions, 'migration omissions');
  for (const item of omissions) {
    const omission = requireRecord(item, 'migration omission');
    assertExactKeys(omission, ['relativePath', 'size', 'reason'], 'migration omission');
    requireRelativePath(omission.relativePath, 'migration omission path');
    requireNonNegativeInteger(omission.size, 'migration omission size');
    requireEqual(omission.reason, 'oversized-documentation-media', 'migration omission reason');
  }
  if (source.snapshotCompleteness === 'complete' && omissions.length > 0) {
    throw new TypeError('Complete migration snapshots cannot declare omissions.');
  }
  if (source.snapshotCompleteness === 'partial' && omissions.length === 0) {
    throw new TypeError('Partial migration snapshots must declare omissions.');
  }

  const template = requireRecord(record.template, 'migration template');
  assertExactKeys(template, [
    'kind', 'url', 'requestedRef', 'resolvedRef', 'commit', 'version',
    'policyApplied', 'dirty', 'snapshotDigest',
  ], 'migration template');
  requireEnum(template.kind, ['local', 'github'], 'migration template kind');
  requireText(template.url, 'migration template URL');
  for (const key of ['requestedRef', 'resolvedRef', 'commit', 'version'] as const) {
    optionalNullableText(template[key], `migration template ${key}`);
  }
  if (template.policyApplied !== true) throw new TypeError('Migration template policy must be applied.');
  if (template.dirty !== null && typeof template.dirty !== 'boolean') {
    throw new TypeError('Migration template dirty must be boolean or null.');
  }
  requirePrefixedSha256(template.snapshotDigest, 'migration template snapshotDigest');

  const analysis = assertMigrationAnalysis(record.analysis);
  if (record.status === 'converted') {
    const resolved = new Set(analysis.riskResolutions.map((item) => item.risk));
    if (analysis.risks.some((risk) => !resolved.has(risk))) {
      throw new TypeError('Converted migration records must resolve every recorded risk.');
    }
  }
  return value as SubAppMigrationRecordV2;
}

export function assertSubAppValidationResult(value: unknown): SubAppValidationResultV1 {
  const result = requireRecord(value, 'SubApp validation result');
  assertExactKeys(result, ['schemaVersion', 'level', 'ok', 'findings', 'errors', 'warnings'], 'SubApp validation result');
  requireEqual(result.schemaVersion, SUBAPP_VALIDATION_SCHEMA_VERSION, 'validation schemaVersion');
  requireEnum(result.level, ['workspace', 'conversion', 'publish'], 'validation level');
  if (typeof result.ok !== 'boolean') throw new TypeError('Validation ok must be boolean.');
  const findings = requireArray(result.findings, 'validation findings');
  for (const item of findings) {
    const finding = requireRecord(item, 'validation finding');
    assertExactKeys(finding, ['severity', 'code', 'message', 'path'], 'validation finding');
    requireEnum(finding.severity, ['error', 'warning'], 'validation severity');
    requireText(finding.code, 'validation code');
    requireText(finding.message, 'validation message');
    if (finding.path !== undefined) requireRelativePath(finding.path, 'validation path');
  }
  const errors = requireStringArray(result.errors, 'validation errors');
  const warnings = requireStringArray(result.warnings, 'validation warnings');
  const findingErrors = findings.filter((item) => requireRecord(item, 'finding').severity === 'error').length;
  const findingWarnings = findings.length - findingErrors;
  if (errors.length !== findingErrors || warnings.length !== findingWarnings) {
    throw new TypeError('Validation error/warning summaries must match findings.');
  }
  if (result.ok !== (findingErrors === 0)) {
    throw new TypeError('Validation ok must be false exactly when error findings exist.');
  }
  return value as SubAppValidationResultV1;
}

export function assertTakuSubAppRuntimeManifest(value: unknown): TakuSubAppRuntimeManifestV1 {
  const manifest = requireRecord(value, 'Taku SubApp runtime manifest');
  assertExactKeys(manifest, ['name', 'description', 'version', 'iconPath', 'actions', 'llm'], 'Taku SubApp runtime manifest');
  requireText(manifest.name, 'runtime manifest name');
  if (manifest.description !== undefined) requireText(manifest.description, 'runtime manifest description', true);
  if (manifest.version !== undefined) requireText(manifest.version, 'runtime manifest version');
  if (manifest.iconPath !== undefined) requireRelativePath(manifest.iconPath, 'runtime manifest iconPath');
  if (manifest.actions !== undefined) {
    const actions = requireArray(manifest.actions, 'runtime manifest actions');
    const names = new Set<string>();
    for (const item of actions) {
      const action = assertAction(item);
      if (names.has(action.name)) throw new TypeError(`Duplicate SubApp Action name: ${action.name}.`);
      names.add(action.name);
    }
  }
  if (manifest.llm !== undefined) {
    const llm = requireRecord(manifest.llm, 'runtime manifest llm');
    assertExactKeys(llm, ['required', 'preferLocal', 'fallback'], 'runtime manifest llm');
    for (const key of ['required', 'preferLocal'] as const) {
      if (llm[key] !== undefined && typeof llm[key] !== 'boolean') {
        throw new TypeError(`Runtime manifest llm ${key} must be boolean.`);
      }
    }
    if (llm.fallback !== undefined) requireEnum(llm.fallback, ['cloud', 'none'], 'runtime manifest llm fallback');
  }
  return value as TakuSubAppRuntimeManifestV1;
}

export function assertSubAppRelease(value: unknown): SubAppReleaseV1 {
  assertPublicSubAppValue(value);
  const release = requireRecord(value, 'SubApp release');
  assertExactKeys(release, ['schemaVersion', 'contractVersion', 'appId', 'versionNumber', 'manifest', 'source', 'build', 'publishManifest'], 'SubApp release');
  requireEqual(release.schemaVersion, SUBAPP_RELEASE_SCHEMA_VERSION, 'release schemaVersion');
  requireEqual(release.contractVersion, SUBAPP_CONTRACT_VERSION, 'release contractVersion');
  requireText(release.appId, 'release appId');
  requirePositiveInteger(release.versionNumber, 'release versionNumber');
  assertTakuSubAppRuntimeManifest(release.manifest);
  const source = assertReleaseArtifact(release.source, SUBAPP_SOURCE_ARCHIVE_FILE);
  const build = assertReleaseArtifact(release.build, SUBAPP_BUILD_ARCHIVE_FILE);
  const publish = requireRecord(release.publishManifest, 'SubApp publish manifest');
  assertExactKeys(publish, [
    'releaseNotes', 'buildRequired', 'buildOutputDir', 'startScriptPreview',
    'startScriptEdit', 'sourceHash', 'buildHash', 'sourceSize', 'buildSize',
    'sourceRights', 'serviceAuthorizations',
  ], 'SubApp publish manifest');
  requireText(publish.releaseNotes, 'release notes', true);
  requireEqual(publish.buildRequired, true, 'publish buildRequired');
  requireEqual(publish.buildOutputDir, SUBAPP_BUILD_OUTPUT_DIRECTORY, 'publish buildOutputDir');
  requireEqual(publish.startScriptPreview, 'start:preview', 'publish startScriptPreview');
  requireEqual(publish.startScriptEdit, 'start:edit', 'publish startScriptEdit');
  requireEqual(publish.sourceHash, source.sha256, 'publish sourceHash');
  requireEqual(publish.buildHash, build.sha256, 'publish buildHash');
  requireEqual(publish.sourceSize, source.size, 'publish sourceSize');
  requireEqual(publish.buildSize, build.size, 'publish buildSize');
  assertSourceRights(publish.sourceRights);
  const serviceAuthorizations = publish.serviceAuthorizations === undefined
    ? []
    : requireArray(
        publish.serviceAuthorizations,
        'publish serviceAuthorizations',
      );
  const seenServices = new Set<string>();
  for (const value of serviceAuthorizations) {
    const authorization = requireRecord(value, 'publish service authorization');
    assertExactKeys(
      authorization,
      ['serviceId', 'endpointIds'],
      'publish service authorization',
    );
    const serviceId = requireCatalogId(
      authorization.serviceId,
      'publish service authorization serviceId',
    );
    if (seenServices.has(serviceId)) {
      throw new TypeError(`Duplicate publish service authorization: ${serviceId}.`);
    }
    seenServices.add(serviceId);
    const endpointIds = requireStringArray(
      authorization.endpointIds,
      'publish service authorization endpointIds',
    );
    if (endpointIds.length === 0 || new Set(endpointIds).size !== endpointIds.length) {
      throw new TypeError('Publish service authorization endpointIds must be non-empty and unique.');
    }
    endpointIds.forEach(endpointId =>
      requireCatalogId(endpointId, 'publish service authorization endpointId'),
    );
  }
  return value as SubAppReleaseV1;
}

export function canonicalSubAppJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function hashCanonicalSubApp(value: unknown): string {
  return createHash('sha256').update(canonicalSubAppJson(value)).digest('hex');
}

export function assertPublicSubAppValue(value: unknown): void {
  inspectPublicValue(value, '$');
}

function eligibilityFor(
  analysis: SubAppAnalysisV1,
  route: SubAppRouteV1,
  services: SubAppServiceRequirementV1[],
  findings: SubAppAssessmentFindingV1[],
): SubAppEligibility {
  if (route.kind !== 'subapp-migration' || analysis.recommendation === 'not-recommended') return 'rejected';
  if (findings.some((finding) => finding.severity === 'blocker')) {
    return 'rejected';
  }
  if (
    services.some(
      (service) => service.required && service.mapping.status === 'unavailable',
    )
  ) {
    return 'rejected';
  }
  if (
    analysis.recommendation === 'manual-review' ||
    findings.some((finding) => finding.severity === 'warning') ||
    services.some(
      (service) =>
        service.required && service.mapping.status === 'review-required',
    )
  ) {
    return 'review-required';
  }
  return 'eligible';
}

function routeKindForProjectType(appType: SubAppProjectType): SubAppRouteKind {
  if (
    ['nextjs', 'vite-react', 'fastapi-next', 'streamlit', 'gradio'].includes(
      appType,
    )
  ) {
    return 'subapp-migration';
  }
  return appType === 'workflow-skill' ? 'native-import' : 'reference-only';
}

function nextStepFor(
  eligibility: SubAppEligibility,
  route: SubAppRouteKind,
): SubAppAssessmentV1['nextStep'] {
  if (eligibility === 'eligible') return 'start-conversion';
  if (eligibility === 'review-required') return 'manual-review';
  if (route === 'native-import') return 'native-import';
  if (route === 'reference-only') return 'reference-only';
  return 'stop';
}

function normalizeFindings(
  provided: SubAppAssessmentFindingV1[] | undefined,
  risks: string[],
  services: SubAppServiceRequirementV1[],
): SubAppAssessmentFindingV1[] {
  const findings = (provided || []).map((item) => ({ ...item }));
  const messages = new Set(findings.map((item) => item.message));
  for (const risk of risks) {
    if (!messages.has(risk)) {
      findings.push({
        code: 'analysis.detected-risk',
        category: risk.toLowerCase().includes('license') ? 'rights' : 'technical',
        severity: 'warning',
        message: risk,
      });
    }
  }
  for (const service of services) {
    if (!service.required || service.mapping.status === 'mapped') continue;
    const message =
      service.mapping.reason ||
      `Required service capability "${service.capability}" is not mapped to Taku.`;
    if (messages.has(message)) continue;
    findings.push({
      code:
        service.mapping.status === 'unavailable'
          ? 'service.mapping-unavailable'
          : 'service.mapping-review-required',
      category: 'runtime',
      severity:
        service.mapping.status === 'unavailable' ? 'blocker' : 'warning',
      message,
    });
    messages.add(message);
  }
  return findings;
}

function cloneAnalysis(input: SubAppAnalysisV1): SubAppAnalysisV1 {
  return {
    ...input,
    reasons: [...input.reasons],
    risks: [...input.risks],
  };
}

function cloneServiceRequirement(
  input: SubAppServiceRequirementV1,
): SubAppServiceRequirementV1 {
  return {
    ...input,
    operations: [...input.operations],
    dataClasses: [...input.dataClasses],
    mapping: {
      ...input.mapping,
      ...(input.mapping.endpointIds
        ? { endpointIds: [...input.mapping.endpointIds] }
        : {}),
    },
  };
}

function assertServiceRequirement(value: unknown): SubAppServiceRequirementV1 {
  const service = requireRecord(value, 'assessment service requirement');
  assertExactKeys(
    service,
    [
      'id',
      'capability',
      'required',
      'detectedProvider',
      'operations',
      'dataClasses',
      'mutation',
      'mapping',
    ],
    'assessment service requirement',
  );
  const id = requireText(service.id, 'service requirement id');
  if (!/^[a-z][a-z0-9._-]{0,127}$/.test(id)) {
    throw new TypeError(`Invalid service requirement ID: ${id}.`);
  }
  requireText(service.capability, 'service requirement capability');
  if (typeof service.required !== 'boolean' || typeof service.mutation !== 'boolean') {
    throw new TypeError('Service requirement required and mutation must be boolean.');
  }
  if (service.detectedProvider !== undefined) {
    requireText(service.detectedProvider, 'service requirement detectedProvider');
  }
  const operations = requireStringArray(
    service.operations,
    'service requirement operations',
  );
  if (operations.length === 0) {
    throw new TypeError('Service requirement operations cannot be empty.');
  }
  requireStringArray(service.dataClasses, 'service requirement dataClasses');
  const mapping = requireRecord(service.mapping, 'service requirement mapping');
  assertExactKeys(
    mapping,
    ['status', 'serviceId', 'endpointIds', 'reason'],
    'service requirement mapping',
  );
  const status = requireEnum(
    mapping.status,
    ['mapped', 'review-required', 'unavailable'],
    'service mapping status',
  );
  if (mapping.serviceId !== undefined) {
    requireCatalogId(mapping.serviceId, 'service mapping serviceId');
  }
  const endpointIds =
    mapping.endpointIds === undefined
      ? []
      : requireStringArray(
          mapping.endpointIds,
          'service mapping endpointIds',
        );
  endpointIds.forEach((endpointId) =>
    requireCatalogId(endpointId, 'service mapping endpointId'),
  );
  if (mapping.reason !== undefined) {
    requireText(mapping.reason, 'service mapping reason');
  }
  if (status === 'mapped' && (!mapping.serviceId || endpointIds.length === 0)) {
    throw new TypeError(
      'Mapped services require a Taku serviceId and at least one endpointId.',
    );
  }
  if (status !== 'mapped' && !cleanText(mapping.reason, 2000)) {
    throw new TypeError(
      'Unmapped or review-required services require a reason.',
    );
  }
  return service as unknown as SubAppServiceRequirementV1;
}

function assertAnalysis(value: unknown): SubAppAnalysisV1 {
  const analysis = requireRecord(value, 'assessment analysis');
  assertExactKeys(analysis, [
    'packageName', 'description', 'appType', 'score', 'recommendation',
    'strategy', 'license', 'hasReadme', 'hasUi', 'reasons', 'risks',
  ], 'assessment analysis');
  requireText(analysis.packageName, 'analysis packageName');
  requireText(analysis.description, 'analysis description', true);
  requireEnum(analysis.appType, SUBAPP_PROJECT_TYPES, 'analysis appType');
  requireScore(analysis.score);
  requireEnum(analysis.recommendation, SUBAPP_RECOMMENDATIONS, 'analysis recommendation');
  requireText(analysis.strategy, 'analysis strategy');
  requireText(analysis.license, 'analysis license');
  if (typeof analysis.hasReadme !== 'boolean' || typeof analysis.hasUi !== 'boolean') {
    throw new TypeError('Analysis hasReadme and hasUi must be boolean.');
  }
  requireStringArray(analysis.reasons, 'analysis reasons');
  requireStringArray(analysis.risks, 'analysis risks');
  return analysis as unknown as SubAppAnalysisV1;
}

function assertRoute(value: unknown): SubAppRouteV1 {
  const route = requireRecord(value, 'assessment route');
  assertExactKeys(route, ['kind', 'capability', 'reason', 'nextAction'], 'assessment route');
  requireEnum(route.kind, SUBAPP_ROUTE_KINDS, 'route kind');
  requireEnum(route.capability, SUBAPP_PROJECT_TYPES, 'route capability');
  requireText(route.reason, 'route reason');
  requireText(route.nextAction, 'route nextAction');
  return route as unknown as SubAppRouteV1;
}

function assertAssessmentFinding(value: unknown): void {
  const finding = requireRecord(value, 'assessment finding');
  assertExactKeys(finding, ['code', 'category', 'severity', 'message', 'path'], 'assessment finding');
  requireText(finding.code, 'assessment finding code');
  requireEnum(finding.category, ['technical', 'security', 'rights', 'runtime', 'product'], 'assessment finding category');
  requireEnum(finding.severity, ['info', 'warning', 'blocker'], 'assessment finding severity');
  requireText(finding.message, 'assessment finding message');
  if (finding.path !== undefined) requireRelativePath(finding.path, 'assessment finding path');
}

function assertMigrationAnalysis(value: unknown): SubAppMigrationRecordV2['analysis'] {
  const analysis = requireRecord(value, 'migration analysis');
  assertExactKeys(analysis, ['appType', 'strategy', 'score', 'recommendation', 'risks', 'riskResolutions'], 'migration analysis');
  requireEnum(analysis.appType, SUBAPP_PROJECT_TYPES, 'migration appType');
  requireText(analysis.strategy, 'migration strategy');
  requireScore(analysis.score);
  requireEnum(analysis.recommendation, SUBAPP_RECOMMENDATIONS, 'migration recommendation');
  const risks = requireStringArray(analysis.risks, 'migration risks');
  const resolutions = requireArray(analysis.riskResolutions, 'migration riskResolutions');
  for (const item of resolutions) {
    const resolution = requireRecord(item, 'migration risk resolution');
    assertExactKeys(resolution, ['risk', 'status', 'evidence'], 'migration risk resolution');
    const risk = requireText(resolution.risk, 'migration resolved risk');
    if (!risks.includes(risk)) throw new TypeError('Migration risk resolution must reference an exact recorded risk.');
    requireEqual(resolution.status, 'resolved', 'migration risk resolution status');
    requireText(resolution.evidence, 'migration risk resolution evidence');
  }
  return analysis as unknown as SubAppMigrationRecordV2['analysis'];
}

function assertAction(value: unknown): SubAppActionV1 {
  const action = requireRecord(value, 'SubApp Action');
  assertExactKeys(action, ['name', 'description', 'runtime', 'params', 'returns', 'execution', 'isUserVisible'], 'SubApp Action');
  const name = requireText(action.name, 'Action name');
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(name)) throw new TypeError(`Invalid SubApp Action name: ${name}.`);
  if (action.description !== undefined) requireText(action.description, 'Action description', true);
  if (action.runtime !== undefined) requireEnum(action.runtime, ['server_http', 'client_postmessage'], 'Action runtime');
  if (action.params !== undefined) {
    const params = requireRecord(action.params, 'Action params');
    for (const [paramName, input] of Object.entries(params)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(paramName)) throw new TypeError(`Invalid Action parameter name: ${paramName}.`);
      const param = requireRecord(input, `Action parameter ${paramName}`);
      assertExactKeys(param, ['type', 'description', 'required', 'default', 'enum', 'format', 'ui'], `Action parameter ${paramName}`);
      requireEnum(param.type, ['string', 'number', 'boolean', 'object', 'array', 'filePath', 'directoryPath'], `Action parameter ${paramName} type`);
      if (param.description !== undefined) requireText(param.description, `Action parameter ${paramName} description`, true);
      if (param.required !== undefined && typeof param.required !== 'boolean') throw new TypeError(`Action parameter ${paramName} required must be boolean.`);
      if (param.enum !== undefined && !Array.isArray(param.enum)) throw new TypeError(`Action parameter ${paramName} enum must be an array.`);
      if (param.format !== undefined) requireText(param.format, `Action parameter ${paramName} format`);
      if (param.ui !== undefined) assertActionUi(param.ui, paramName);
    }
  }
  if (action.returns !== undefined) {
    const returns = requireRecord(action.returns, 'Action returns');
    assertExactKeys(returns, ['type', 'description'], 'Action returns');
    if (returns.type !== undefined) requireText(returns.type, 'Action returns type');
    if (returns.description !== undefined) requireText(returns.description, 'Action returns description', true);
  }
  if (action.execution !== undefined) {
    const execution = requireRecord(action.execution, 'Action execution');
    assertExactKeys(execution, ['defaultMode', 'timeoutMs'], 'Action execution');
    if (execution.defaultMode !== undefined) requireEnum(execution.defaultMode, ['sync', 'async'], 'Action defaultMode');
    if (execution.timeoutMs !== undefined) requirePositiveInteger(execution.timeoutMs, 'Action timeoutMs');
  }
  if (action.isUserVisible !== undefined && typeof action.isUserVisible !== 'boolean') {
    throw new TypeError('Action isUserVisible must be boolean.');
  }
  return action as unknown as SubAppActionV1;
}

function assertActionUi(value: unknown, paramName: string): void {
  const ui = requireRecord(value, `Action parameter ${paramName} UI`);
  assertExactKeys(ui, ['label', 'placeholder', 'widget'], `Action parameter ${paramName} UI`);
  if (ui.label !== undefined) requireText(ui.label, 'Action UI label');
  if (ui.placeholder !== undefined) requireText(ui.placeholder, 'Action UI placeholder', true);
  if (ui.widget !== undefined) requireEnum(ui.widget, ['text', 'textarea', 'select', 'number', 'switch', 'filePicker', 'pathPicker'], 'Action UI widget');
}

function assertReleaseArtifact(value: unknown, fileName: string): SubAppReleaseArtifactV1 {
  const artifact = requireRecord(value, `SubApp ${fileName} artifact`);
  assertExactKeys(artifact, ['fileName', 'url', 'sha256', 'size'], `SubApp ${fileName} artifact`);
  requireEqual(artifact.fileName, fileName, `SubApp artifact fileName`);
  requirePublicHttpsUrl(artifact.url, `SubApp ${fileName} URL`);
  requireSha256(artifact.sha256, `SubApp ${fileName} SHA-256`);
  requirePositiveInteger(artifact.size, `SubApp ${fileName} size`);
  return artifact as unknown as SubAppReleaseArtifactV1;
}

function assertSourceRights(value: unknown): void {
  const rights = requireRecord(value, 'SubApp source rights');
  assertExactKeys(rights, ['authorshipKind', 'rightsBasis', 'sourceUrl', 'sourceAuthor', 'license', 'sourceNotes'], 'SubApp source rights');
  const authorship = requireEnum(rights.authorshipKind, ['original', 'derived', 'third_party'], 'source authorshipKind');
  const basis = requireEnum(rights.rightsBasis, ['self_owned', 'open_source_license', 'explicit_permission'], 'source rightsBasis');
  requireText(rights.sourceAuthor, 'source author', true);
  requireText(rights.license, 'source license', true);
  requireText(rights.sourceNotes, 'source notes', true);
  if (authorship === 'original') {
    if (basis !== 'self_owned') throw new TypeError('Original SubApps require self_owned rights.');
    if (rights.sourceUrl !== '') requirePublicHttpsUrl(rights.sourceUrl, 'original source URL');
    return;
  }
  requirePublicHttpsUrl(rights.sourceUrl, 'derived source URL');
  if (basis === 'self_owned') throw new TypeError('Derived and third-party SubApps cannot use self_owned rights.');
  if (basis === 'open_source_license' && !cleanText(rights.license, 256)) {
    throw new TypeError('Open-source SubApps require a license.');
  }
  if (authorship === 'derived' && !cleanText(rights.sourceNotes, 2000)) {
    throw new TypeError('Derived SubApps require source notes.');
  }
  if (authorship === 'third_party' && !cleanText(rights.sourceAuthor, 512)) {
    throw new TypeError('Third-party SubApps require a source author.');
  }
}

function inspectPublicValue(value: unknown, path: string): void {
  if (typeof value === 'string') {
    if (PRIVATE_PATH_PATTERN.test(value) || FILE_URL_PATTERN.test(value) || PRIVATE_KEY_PATTERN.test(value) || KNOWN_TOKEN_PATTERN.test(value)) {
      throw new TypeError(`Public SubApp release contains private content at ${path}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectPublicValue(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.has(key)) throw new TypeError(`Public SubApp release contains forbidden field ${key} at ${path}.`);
    inspectPublicValue(child, `${path}.${key}`);
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new TypeError(`${label} contains unknown field "${key}".`);
  }
}

function cleanText(value: unknown, maxLength = 4096): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function requireText(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new TypeError(`${label} must be ${allowEmpty ? 'a' : 'a non-empty'} string.`);
  return value;
}

function optionalNullableText(value: unknown, label: string): void {
  if (value !== undefined && value !== null) requireText(value, label);
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  const array = requireArray(value, label);
  for (const item of array) requireText(item, `${label} item`);
  return array as string[];
}

function requireEnum<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) throw new TypeError(`${label} must be one of: ${allowed.join(', ')}.`);
  return value as T[number];
}

function requireEqual<T>(value: unknown, expected: T, label: string): asserts value is T {
  if (value !== expected) throw new TypeError(`${label} must be ${String(expected)}.`);
}

function validTimestamp(value: unknown): string {
  return typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value)) ? value : '';
}

function requireTimestamp(value: unknown, label: string): void {
  if (!validTimestamp(value)) throw new TypeError(`${label} must be an ISO-8601 UTC timestamp.`);
}

function requireScore(value: unknown): void {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100) throw new TypeError('Analysis score must be an integer from 0 to 100.');
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  return value;
}

function requirePrefixedSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !PREFIXED_SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must use the sha256:<lowercase digest> format.`);
  }
  return value;
}

function requireRelativePath(value: unknown, label: string): string {
  const path = requireText(value, label);
  if (!RELATIVE_PATH_PATTERN.test(path) || path.includes('\\')) throw new TypeError(`${label} must be a safe POSIX relative path.`);
  return path;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new TypeError(`${label} must be a positive integer.`);
  return value as number;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${label} must be a non-negative integer.`);
  return value as number;
}

function requirePublicHttpsUrl(value: unknown, label: string): string {
  const text = requireText(value, label);
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('not public HTTPS');
  } catch {
    throw new TypeError(`${label} must be a public HTTPS URL without credentials.`);
  }
  return text;
}

function requireCatalogId(value: unknown, label: string): string {
  const id = requireText(value, label);
  if (!/^[a-z][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new TypeError(`${label} must be a taku-ai-proxy catalog ID.`);
  }
  return id;
}
