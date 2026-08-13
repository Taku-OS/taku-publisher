import { createHash } from 'node:crypto';

export const CAPABILITY_CONTRACT_VERSION = '0.2.0' as const;
export const CAPABILITY_SNAPSHOT_SCHEMA_VERSION =
  'taku.capability-snapshot.v1' as const;
export const CAPABILITY_PACKAGE_SCHEMA_VERSION = 'taku.package.v1' as const;
export const LEGACY_AI_SETUP_SCHEMA_VERSION = 'taku.ai-setup.v1' as const;

export const CAPABILITY_KINDS = [
  'skill',
  'agent',
  'rule',
  'workflow',
  'plugin',
  'mcp',
] as const;

export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];
export type CapabilityPackageKind = CapabilityKind | 'action';
export type CapabilityEligibility =
  | 'eligible'
  | 'review-required'
  | 'blocked';

export interface CapabilityPolicyDecision {
  eligibility: CapabilityEligibility;
  mode?: 'local-only';
  reason?: string;
}

export interface CapabilityPolicy {
  import: CapabilityPolicyDecision & { mode: 'local-only' };
  publish: CapabilityPolicyDecision;
}

export interface CapabilityLocator {
  type: 'local-path';
  value: string;
}

export interface CapabilityItemV1 {
  id: string;
  kind: CapabilityKind;
  source: string;
  sourceLabel: string;
  sourceFormat: string;
  name: string;
  description: string;
  detectedFrom?: string;
  locator?: CapabilityLocator;
  scanPreview?: unknown;
  policy: CapabilityPolicy;
}

export interface CapabilitySnapshotV1 {
  schemaVersion: typeof CAPABILITY_SNAPSHOT_SCHEMA_VERSION;
  contractVersion: typeof CAPABILITY_CONTRACT_VERSION;
  scanId: string;
  generatedAt: string;
  privacy: {
    localOnly: true;
    uploads: false;
    localPathsIncluded: true;
    promptContentUploaded: false;
    sourceContentUploaded: false;
  };
  profile: {
    persona: unknown;
    basePersona: unknown;
    badges: unknown[];
    behaviorProfile: unknown;
    usage: unknown;
  };
  roots: unknown[];
  summary: CapabilitySnapshotSummary;
  items: CapabilityItemV1[];
}

export interface CapabilitySnapshotSummary {
  totalCount: number;
  byKind: Record<CapabilityKind, number>;
  skillCount: number;
  agentCount: number;
  ruleCount: number;
  workflowCount: number;
  pluginCount: number;
  mcpCount: number;
  importEligibleCount: number;
  publishReviewCount: number;
  publishBlockedCount: number;
}

export interface CapabilityPackageFile {
  path: string;
  size: number;
  sha256: string;
}

export interface PluginPermissionReview {
  status: 'approved';
  reviewedPermissions: string[];
  reviewer?: string;
}

export interface CapabilityPackageManifestV1 {
  schemaVersion: typeof CAPABILITY_PACKAGE_SCHEMA_VERSION;
  contractVersion: typeof CAPABILITY_CONTRACT_VERSION;
  channel: 'import' | 'publish';
  packageVersion: string;
  capability: {
    id: string;
    kind: CapabilityPackageKind;
    sourceKind: CapabilityKind;
    name: string;
    description?: string;
  };
  contentHash: string;
  compatibility: {
    hosts: string[];
    platforms: string[];
  };
  files: CapabilityPackageFile[];
  permissions: string[];
  requiredSecrets: string[];
  permissionReview?: PluginPermissionReview;
}

export interface StableCapabilityIdInput {
  kind: CapabilityKind | string;
  source?: string;
  locator?: string;
  detectedFrom?: string;
  name?: string;
}

export interface CapabilityItemInput {
  id?: unknown;
  kind?: unknown;
  type?: unknown;
  source?: unknown;
  sourceLabel?: unknown;
  sourceFormat?: unknown;
  name?: unknown;
  description?: unknown;
  detectedFrom?: unknown;
  localPath?: unknown;
  scanPreview?: unknown;
  publishable?: unknown;
}

export interface CapabilitySnapshotInput {
  generatedAt?: unknown;
  scanId?: unknown;
  items?: CapabilityItemInput[];
  privateItems?: Array<{ id?: unknown; localPath?: unknown }>;
  roots?: unknown[];
  profile?: {
    persona?: unknown;
    basePersona?: unknown;
    badges?: unknown[];
    behaviorProfile?: unknown;
    usage?: unknown;
  };
}

export interface CapabilityPackageInput {
  channel?: unknown;
  packageVersion?: unknown;
  kind?: unknown;
  contentHash?: unknown;
  capability?: {
    id?: unknown;
    kind?: unknown;
    name?: unknown;
    description?: unknown;
  };
  compatibility?: {
    hosts?: unknown;
    platforms?: unknown;
  };
  files?: unknown;
  permissions?: unknown;
  requiredSecrets?: unknown;
  permissionReview?: unknown;
}

const KIND_ALIASES = new Map<string, CapabilityKind>([
  ['skill', 'skill'],
  ['skills', 'skill'],
  ['agent', 'agent'],
  ['agents', 'agent'],
  ['subagent', 'agent'],
  ['subagents', 'agent'],
  ['agents-md', 'rule'],
  ['rule', 'rule'],
  ['rules', 'rule'],
  ['slash-command', 'workflow'],
  ['slash_command', 'workflow'],
  ['command', 'workflow'],
  ['commands', 'workflow'],
  ['action', 'workflow'],
  ['actions', 'workflow'],
  ['workflow', 'workflow'],
  ['workflows', 'workflow'],
  ['plugin', 'plugin'],
  ['plugins', 'plugin'],
  ['mcp', 'mcp'],
  ['mcp-server', 'mcp'],
  ['mcp-servers', 'mcp'],
]);

const FORBIDDEN_PUBLIC_KEYS = new Set([
  'accessToken',
  'authorization',
  'cookie',
  'detectedFrom',
  'env',
  'environment',
  'idToken',
  'localPath',
  'local_path',
  'locator',
  'prompt',
  'promptContent',
  'refreshToken',
  'roots',
  'scanPreview',
  'session',
  'sourceContent',
  'token',
]);

const PRIVATE_PATH_PATTERN =
  /(?:^|[\s"'`(])(?:\/Users|\/home|\/private\/var\/folders|\/var\/folders|\/Volumes)\/[^\s"'`)]+|[A-Za-z]:\\(?:Users|Documents and Settings)\\/;
const FILE_URL_PATTERN = /file:\/\/\//i;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;
const KNOWN_TOKEN_PATTERN =
  /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{20,})\b/;
const SECRET_QUERY_PATTERN =
  /[?&#](?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|password|passwd|secret|session|token)=/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const RELATIVE_PACKAGE_PATH_PATTERN =
  /^(?!\/)(?![A-Za-z]:[\\/])(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/;

export function normalizeCapabilityKind(value: unknown): CapabilityKind | null {
  return KIND_ALIASES.get(String(value || '').trim().toLowerCase()) || null;
}

export function normalizeCapabilitySource(value: unknown): string {
  const source = String(value || '').trim().toLowerCase();
  if (source.startsWith('claude')) return 'claude-code';
  if (source.startsWith('cursor')) return 'cursor';
  if (source.startsWith('codex')) return 'codex';
  if (source.startsWith('taku')) return 'taku';
  if (source.startsWith('workspace-')) {
    return normalizeCapabilitySource(source.slice('workspace-'.length));
  }
  return 'custom';
}

export function capabilitySourceLabel(value: unknown): string {
  const source = normalizeCapabilitySource(value);
  if (source === 'claude-code') return 'Claude Code';
  if (source === 'codex') return 'Codex';
  if (source === 'cursor') return 'Cursor';
  if (source === 'taku') return 'Taku';
  return 'Local';
}

export function defaultCapabilityPolicy(
  kind: CapabilityKind,
  options: { publishable?: boolean } = {},
): CapabilityPolicy {
  const publishable = options.publishable !== false;
  if (kind === 'mcp') {
    return {
      import: { eligibility: 'eligible', mode: 'local-only' },
      publish: { eligibility: 'blocked', reason: 'mcp-local-only' },
    };
  }
  if (kind === 'rule') {
    return {
      import: { eligibility: 'eligible', mode: 'local-only' },
      publish: { eligibility: 'blocked', reason: 'rule-publishing-disabled' },
    };
  }
  if (kind === 'plugin') {
    return {
      import: {
        eligibility: 'review-required',
        mode: 'local-only',
        reason: 'permission-review-required',
      },
      publish: publishable
        ? {
            eligibility: 'review-required',
            reason: 'permission-review-required',
          }
        : { eligibility: 'blocked', reason: 'source-not-publishable' },
    };
  }
  if (kind === 'workflow') {
    return {
      import: {
        eligibility: 'review-required',
        mode: 'local-only',
        reason: 'workflow-review-required',
      },
      publish: publishable
        ? {
            eligibility: 'review-required',
            reason: 'workflow-action-projection-review-required',
          }
        : { eligibility: 'blocked', reason: 'source-not-publishable' },
    };
  }
  return {
    import: { eligibility: 'eligible', mode: 'local-only' },
    publish: publishable
      ? { eligibility: 'review-required', reason: 'privacy-review-required' }
      : { eligibility: 'blocked', reason: 'source-not-publishable' },
  };
}

export function stableCapabilityId(input: StableCapabilityIdInput): string {
  const kind = normalizeCapabilityKind(input.kind);
  if (!kind) throw new TypeError('Stable capability ID requires a valid kind.');
  const source = normalizeCapabilitySource(input.source);
  const canonicalLocator = cleanLocator(
    input.locator || input.detectedFrom || input.name,
  );
  if (!canonicalLocator) {
    throw new TypeError(
      'Stable capability ID requires a locator, detected source, or name.',
    );
  }
  const digest = createHash('sha256')
    .update(
      [
        CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
        kind,
        source,
        canonicalLocator,
      ].join('\0'),
    )
    .digest('hex')
    .slice(0, 32);
  return `cap_${digest}`;
}

export function normalizeCapabilityItem(
  item: CapabilityItemInput,
  privateItem: { localPath?: unknown } = {},
): CapabilityItemV1 | null {
  const kind = normalizeCapabilityKind(item?.kind || item?.type);
  if (!kind) return null;
  const source = normalizeCapabilitySource(item?.source);
  const name = cleanText(item?.name, 160) || `Untitled ${kind}`;
  const localPath = cleanText(
    privateItem?.localPath || item?.localPath,
    4096,
  );
  const detectedFrom = cleanText(item?.detectedFrom, 512);
  const id =
    cleanText(item?.id, 512) ||
    stableCapabilityId({
      kind,
      source,
      name,
      detectedFrom,
      locator: localPath,
    });

  return {
    id,
    kind,
    source,
    sourceLabel:
      cleanText(item?.sourceLabel, 120) || capabilitySourceLabel(source),
    sourceFormat:
      cleanText(item?.sourceFormat, 120) ||
      inferSourceFormat(kind, source, localPath),
    name,
    description: cleanText(item?.description, 2000),
    ...(detectedFrom ? { detectedFrom } : {}),
    ...(localPath
      ? { locator: { type: 'local-path' as const, value: localPath } }
      : {}),
    ...(item?.scanPreview ? { scanPreview: item.scanPreview } : {}),
    policy: defaultCapabilityPolicy(kind, {
      publishable: item?.publishable !== false,
    }),
  };
}

export function createCapabilitySnapshot(
  input: CapabilitySnapshotInput = {},
): CapabilitySnapshotV1 {
  const privateById = new Map(
    (input.privateItems || [])
      .filter((item) => item?.id)
      .map((item) => [String(item.id), item]),
  );
  const items = (input.items || [])
    .map((item) =>
      normalizeCapabilityItem(item, privateById.get(String(item?.id))),
    )
    .filter((item): item is CapabilityItemV1 => Boolean(item))
    .sort(compareCapabilityItems);
  const generatedAt =
    validTimestamp(input.generatedAt) || new Date().toISOString();
  const scanId =
    cleanText(input.scanId, 512) ||
    createHash('sha256')
      .update(
        `${generatedAt}\0${items
          .map((item) => item.id)
          .sort()
          .join('\0')}`,
      )
      .digest('hex')
      .slice(0, 24);

  return {
    schemaVersion: CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    scanId,
    generatedAt,
    privacy: {
      localOnly: true,
      uploads: false,
      localPathsIncluded: true,
      promptContentUploaded: false,
      sourceContentUploaded: false,
    },
    profile: {
      persona: input.profile?.persona || null,
      basePersona: input.profile?.basePersona || null,
      badges: Array.isArray(input.profile?.badges)
        ? input.profile.badges
        : [],
      behaviorProfile: input.profile?.behaviorProfile || null,
      usage: input.profile?.usage || null,
    },
    roots: Array.isArray(input.roots) ? input.roots : [],
    summary: summarizeCapabilityItems(items),
    items,
  };
}

export function assertCapabilitySnapshot(
  value: unknown,
): CapabilitySnapshotV1 {
  if (!isRecord(value)) {
    throw new TypeError('Capability snapshot must be an object.');
  }
  if (value.schemaVersion !== CAPABILITY_SNAPSHOT_SCHEMA_VERSION) {
    throw new TypeError(
      `Unsupported capability snapshot schema: ${String(value.schemaVersion || 'missing')}.`,
    );
  }
  if (value.contractVersion !== CAPABILITY_CONTRACT_VERSION) {
    throw new TypeError(
      `Unsupported capability contract version: ${String(value.contractVersion || 'missing')}.`,
    );
  }
  if (!Array.isArray(value.items)) {
    throw new TypeError('Capability snapshot items must be an array.');
  }
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      !cleanText(item.id, 512) ||
      !normalizeCapabilityKind(item.kind)
    ) {
      throw new TypeError('Capability snapshot contains an invalid item.');
    }
    if (!isRecord(item.policy)) {
      throw new TypeError(
        `Capability item "${String(item.id)}" is missing policy.`,
      );
    }
    const importPolicy = item.policy.import;
    const publishPolicy = item.policy.publish;
    if (!isRecord(importPolicy) || !isRecord(publishPolicy)) {
      throw new TypeError(
        `Capability item "${String(item.id)}" is missing import/publish policy.`,
      );
    }
  }
  return value as unknown as CapabilitySnapshotV1;
}

export function readCapabilitySnapshot(value: unknown): CapabilitySnapshotV1 {
  if (
    isRecord(value) &&
    value.schemaVersion === LEGACY_AI_SETUP_SCHEMA_VERSION
  ) {
    return createCapabilitySnapshot({
      generatedAt: value.generatedAt,
      scanId: value.scanId,
      items: Array.isArray(value.items)
        ? (value.items as CapabilityItemInput[])
        : [],
      roots: Array.isArray(value.roots) ? value.roots : [],
      profile: isRecord(value.profile)
        ? {
            persona: value.profile.persona,
            basePersona: value.profile.basePersona,
            badges: Array.isArray(value.profile.badges)
              ? value.profile.badges
              : [],
            behaviorProfile: value.profile.behaviorProfile,
            usage: value.profile.usage,
          }
        : undefined,
    });
  }
  return assertCapabilitySnapshot(value);
}

export function projectCapabilityKindForPackage(
  kind: CapabilityKind,
  channel: 'import' | 'publish',
): CapabilityPackageKind {
  return channel === 'publish' && kind === 'workflow' ? 'action' : kind;
}

export function createCapabilityPackageManifest(
  input: CapabilityPackageInput = {},
): CapabilityPackageManifestV1 {
  const channel =
    input.channel === 'publish'
      ? 'publish'
      : input.channel === 'import'
        ? 'import'
        : null;
  const sourceKind = normalizeCapabilityKind(
    input.kind || input.capability?.kind,
  );
  if (!channel || !sourceKind) {
    throw new TypeError(
      'Capability package requires a valid channel and kind.',
    );
  }
  if (channel === 'publish' && (sourceKind === 'mcp' || sourceKind === 'rule')) {
    throw new TypeError(
      `${sourceKind} capabilities are not publishable in taku.package.v1.`,
    );
  }
  const contentHash = cleanText(input.contentHash, 256);
  if (!SHA256_PATTERN.test(contentHash)) {
    throw new TypeError(
      'Capability package requires a SHA-256 contentHash.',
    );
  }
  const capabilityId = cleanText(input.capability?.id, 512);
  if (!capabilityId) {
    throw new TypeError('Capability package requires a capability ID.');
  }
  const permissions = uniqueStrings(input.permissions);
  const requiredSecrets = uniqueStrings(input.requiredSecrets).filter((name) =>
    /^[A-Z][A-Z0-9_]{1,127}$/.test(name),
  );
  const permissionReview = normalizePluginPermissionReview(
    input.permissionReview,
  );
  if (sourceKind === 'plugin' && channel === 'publish') {
    if (!permissionReview) {
      throw new TypeError(
        'Plugin publishing requires an approved permission review.',
      );
    }
    const reviewed = new Set(permissionReview.reviewedPermissions);
    if (permissions.some((permission) => !reviewed.has(permission))) {
      throw new TypeError(
        'Plugin permission review must cover every requested permission.',
      );
    }
  }

  const manifest: CapabilityPackageManifestV1 = {
    schemaVersion: CAPABILITY_PACKAGE_SCHEMA_VERSION,
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    channel,
    packageVersion:
      cleanText(input.packageVersion, 80) || CAPABILITY_CONTRACT_VERSION,
    capability: {
      id: capabilityId,
      kind: projectCapabilityKindForPackage(sourceKind, channel),
      sourceKind,
      name:
        cleanText(input.capability?.name, 160) ||
        `Untitled ${sourceKind}`,
      ...(cleanText(input.capability?.description, 2000)
        ? { description: cleanText(input.capability?.description, 2000) }
        : {}),
    },
    contentHash: contentHash.toLowerCase(),
    compatibility: {
      hosts: uniqueStrings(input.compatibility?.hosts),
      platforms: uniqueStrings(input.compatibility?.platforms),
    },
    files: normalizePackageFiles(input.files),
    permissions,
    requiredSecrets,
    ...(permissionReview ? { permissionReview } : {}),
  };

  assertCapabilityPackageManifest(manifest);
  return manifest;
}

export function assertCapabilityPackageManifest(
  value: unknown,
): CapabilityPackageManifestV1 {
  assertPublicCapabilityValue(value);
  if (!isRecord(value)) {
    throw new TypeError('Capability package manifest must be an object.');
  }
  assertOnlyKeys(value, [
    'schemaVersion',
    'contractVersion',
    'channel',
    'packageVersion',
    'capability',
    'contentHash',
    'compatibility',
    'files',
    'permissions',
    'requiredSecrets',
    'permissionReview',
  ], 'Capability package manifest');
  if (value.schemaVersion !== CAPABILITY_PACKAGE_SCHEMA_VERSION) {
    throw new TypeError(
      `Unsupported capability package schema: ${String(value.schemaVersion || 'missing')}.`,
    );
  }
  if (value.contractVersion !== CAPABILITY_CONTRACT_VERSION) {
    throw new TypeError(
      `Unsupported capability contract version: ${String(value.contractVersion || 'missing')}.`,
    );
  }
  if (value.channel !== 'import' && value.channel !== 'publish') {
    throw new TypeError('Capability package channel is invalid.');
  }
  if (!boundedString(value.packageVersion, 1, 80)) {
    throw new TypeError('Capability package packageVersion is invalid.');
  }
  if (!isRecord(value.capability)) {
    throw new TypeError('Capability package capability is invalid.');
  }
  assertOnlyKeys(
    value.capability,
    ['id', 'kind', 'sourceKind', 'name', 'description'],
    'Capability package capability',
  );
  const sourceKind = normalizeCapabilityKind(value.capability.sourceKind);
  if (
    !sourceKind ||
    !boundedString(value.capability.id, 1, 512) ||
    !boundedString(value.capability.name, 1, 160) ||
    (value.capability.description !== undefined &&
      !boundedString(value.capability.description, 0, 2000))
  ) {
    throw new TypeError('Capability package capability identity is invalid.');
  }
  const projected = projectCapabilityKindForPackage(sourceKind, value.channel);
  if (value.capability.kind !== projected) {
    throw new TypeError(
      'Capability package kind does not match its channel projection.',
    );
  }
  if (
    value.channel === 'publish' &&
    (sourceKind === 'mcp' || sourceKind === 'rule')
  ) {
    throw new TypeError(`${sourceKind} capabilities are not publishable.`);
  }
  if (!SHA256_PATTERN.test(String(value.contentHash || ''))) {
    throw new TypeError('Capability package contentHash is invalid.');
  }
  if (!Array.isArray(value.files)) {
    throw new TypeError('Capability package files must be an array.');
  }
  normalizePackageFiles(value.files);
  if (
    !isUniqueStringArray(value.permissions) ||
    !isUniqueStringArray(value.requiredSecrets) ||
    value.requiredSecrets.some(
      (name) => !/^[A-Z][A-Z0-9_]{1,127}$/.test(name),
    )
  ) {
    throw new TypeError(
      'Capability package permissions and requiredSecrets must be arrays.',
    );
  }
  if (!isRecord(value.compatibility)) {
    throw new TypeError('Capability package compatibility is invalid.');
  }
  assertOnlyKeys(
    value.compatibility,
    ['hosts', 'platforms'],
    'Capability package compatibility',
  );
  if (
    !isUniqueStringArray(value.compatibility.hosts) ||
    !isUniqueStringArray(value.compatibility.platforms)
  ) {
    throw new TypeError('Capability package compatibility is invalid.');
  }
  if (value.permissionReview !== undefined) {
    if (!isRecord(value.permissionReview)) {
      throw new TypeError('Capability package permissionReview is invalid.');
    }
    assertOnlyKeys(
      value.permissionReview,
      ['status', 'reviewedPermissions', 'reviewer'],
      'Capability package permissionReview',
    );
    if (
      value.permissionReview.status !== 'approved' ||
      !isUniqueStringArray(value.permissionReview.reviewedPermissions) ||
      (value.permissionReview.reviewer !== undefined &&
        !boundedString(value.permissionReview.reviewer, 1, 160))
    ) {
      throw new TypeError('Capability package permissionReview is invalid.');
    }
  }
  if (sourceKind === 'plugin' && value.channel === 'publish') {
    const review = normalizePluginPermissionReview(value.permissionReview);
    if (!review) {
      throw new TypeError(
        'Plugin publishing requires an approved permission review.',
      );
    }
    const reviewed = new Set(review.reviewedPermissions);
    if (
      value.permissions.some(
        (permission) =>
          typeof permission !== 'string' || !reviewed.has(permission),
      )
    ) {
      throw new TypeError(
        'Plugin permission review must cover every requested permission.',
      );
    }
  }
  return value as unknown as CapabilityPackageManifestV1;
}

export function assertPublicCapabilityValue(
  value: unknown,
  path: string[] = [],
): void {
  if (typeof value === 'string') {
    if (
      PRIVATE_PATH_PATTERN.test(value) ||
      FILE_URL_PATTERN.test(value) ||
      PRIVATE_KEY_PATTERN.test(value) ||
      KNOWN_TOKEN_PATTERN.test(value) ||
      SECRET_QUERY_PATTERN.test(value)
    ) {
      throw new TypeError(
        `Public capability manifest contains private content at ${formatPath(path)}.`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertPublicCapabilityValue(entry, [...path, String(index)]),
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.has(key)) {
      throw new TypeError(
        `Public capability manifest contains forbidden field ${formatPath([...path, key])}.`,
      );
    }
    assertPublicCapabilityValue(entry, [...path, key]);
  }
}

export function canonicalCapabilityJson(value: unknown): string {
  return JSON.stringify(sortCanonicalValue(value));
}

export function hashCanonicalCapability(value: unknown): string {
  return createHash('sha256')
    .update(canonicalCapabilityJson(value))
    .digest('hex');
}

function summarizeCapabilityItems(
  items: CapabilityItemV1[],
): CapabilitySnapshotSummary {
  const byKind = Object.fromEntries(
    CAPABILITY_KINDS.map((kind) => [
      kind,
      items.filter((item) => item.kind === kind).length,
    ]),
  ) as Record<CapabilityKind, number>;
  return {
    totalCount: items.length,
    byKind,
    skillCount: byKind.skill,
    agentCount: byKind.agent,
    ruleCount: byKind.rule,
    workflowCount: byKind.workflow,
    pluginCount: byKind.plugin,
    mcpCount: byKind.mcp,
    importEligibleCount: items.filter(
      (item) => item.policy.import.eligibility === 'eligible',
    ).length,
    publishReviewCount: items.filter(
      (item) => item.policy.publish.eligibility === 'review-required',
    ).length,
    publishBlockedCount: items.filter(
      (item) => item.policy.publish.eligibility === 'blocked',
    ).length,
  };
}

function normalizePackageFiles(value: unknown): CapabilityPackageFile[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError('Capability package files must be an array.');
  }
  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        throw new TypeError('Capability package contains an invalid file.');
      }
      assertOnlyKeys(
        entry,
        ['path', 'size', 'sha256'],
        'Capability package file',
      );
      const filePath = String(entry.path || '').replaceAll('\\', '/');
      const size = Number(entry.size);
      const sha256 = cleanText(entry.sha256, 128).toLowerCase();
      if (
        !RELATIVE_PACKAGE_PATH_PATTERN.test(filePath) ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        !SHA256_PATTERN.test(sha256)
      ) {
        throw new TypeError(
          `Capability package file "${filePath || 'missing'}" is invalid.`,
        );
      }
      return { path: filePath, size, sha256 };
    })
    .sort((first, second) => first.path.localeCompare(second.path));
}

function normalizePluginPermissionReview(
  value: unknown,
): PluginPermissionReview | null {
  if (!isRecord(value) || value.status !== 'approved') return null;
  const reviewedPermissions = uniqueStrings(value.reviewedPermissions);
  return {
    status: 'approved',
    reviewedPermissions,
    ...(cleanText(value.reviewer, 160)
      ? { reviewer: cleanText(value.reviewer, 160) }
      : {}),
  };
}

function inferSourceFormat(
  kind: CapabilityKind,
  source: string,
  localPath: string,
): string {
  if (kind === 'skill') return 'skill-directory';
  if (kind === 'mcp') return 'mcp-config';
  const lower = String(localPath || '').toLowerCase();
  if (lower.endsWith('.toml')) return 'codex-toml';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (source === 'cursor') return 'cursor-markdown';
  return 'markdown';
}

function compareCapabilityItems(
  first: CapabilityItemV1,
  second: CapabilityItemV1,
): number {
  return (
    first.kind.localeCompare(second.kind) ||
    first.source.localeCompare(second.source) ||
    first.name.localeCompare(second.name) ||
    first.id.localeCompare(second.id)
  );
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanLocator(value: unknown): string {
  return String(value || '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

function uniqueStrings(values: unknown): string[] {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => cleanText(value, 160))
        .filter(Boolean),
    ),
  ].sort();
}

function validTimestamp(value: unknown): string {
  const text = cleanText(value, 80);
  return text && Number.isFinite(Date.parse(text))
    ? new Date(text).toISOString()
    : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) {
    throw new TypeError(`${label} contains unknown field "${unknownKey}".`);
  }
}

function boundedString(
  value: unknown,
  minLength: number,
  maxLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length >= minLength &&
    value.length <= maxLength
  );
}

function isUniqueStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string') &&
    new Set(value).size === value.length
  );
}

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortCanonicalValue(value[key])]),
  );
}

function formatPath(path: string[]): string {
  return path.length > 0 ? path.join('.') : '<root>';
}
