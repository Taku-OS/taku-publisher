// The legacy Persona engine was migrated as a behavior-preserving unit.
// @ts-nocheck
import {
  applyPersonaOverrides,
  buildPersonaIdentity,
  normalizePersonaOverrides,
  personaSignatureFor,
  publicHiddenPersona,
  publicTraitBadge,
  refreshPersonaIdentity,
} from './persona.js';
import {
  ROOKIE_PERSONA_LOCALIZATIONS,
  personaLegacyArchetypes,
} from './persona-catalog.js';
import { cleanText } from './privacy.js';

export type PersonaRecord = Record<string, any>;

export interface CreatorMetricsOptions {
  source?: string;
  path?: string;
  warnings?: string[];
}

export interface PersonaSignalsInput {
  usage?: PersonaRecord;
  usedTools?: PersonaRecord[];
  ownedCreations?: PersonaRecord[];
  projectMetadata?: PersonaRecord;
  creatorMetrics?: PersonaRecord;
  includeGitHubMetrics?: boolean;
  generatedAt?: string;
}

export interface PersonaBuildOptions {
  rules?: PersonaRecord;
  tone?: string;
  rulesSource?: string;
  rulesPath?: string;
  warnings?: string[];
  overrides?: PersonaRecord;
  generatedAt?: string;
}

export {
  applyPersonaOverrides,
  buildPersonaIdentity,
  normalizePersonaOverrides,
  personaSignatureFor,
  publicHiddenPersona,
  publicTraitBadge,
  refreshPersonaIdentity,
} from './persona.js';

const PERSONA_SIGNALS_SCHEMA = 'taku.creator.persona-signals.v1';
const PERSONA_SCHEMA = 'taku.creator.persona.v1';
const DEFAULT_USAGE_PERIOD_ID = 'last90Days';
const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4]);
const DAY_HOURS = new Set([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeChoiceToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function behaviorCategoryLabel(id) {
  return {
    planning: 'Planning',
    read: 'Read',
    search: 'Search',
    edit: 'Edit',
    shell: 'Shell',
    browser: 'Browser',
    tooling: 'Tooling',
    other: 'Other',
    none: 'None',
  }[id] || id;
}

function createEmptyActivitySummary() {
  return {
    hourBuckets: Array(24).fill(0),
    activeEventCount: 0,
    nightEventCount: 0,
    dayEventCount: 0,
    nightShare: 0,
    dayShare: 0,
    medianSessionMinutes: 0,
    averageSessionMinutes: 0,
    longestSessionMinutes: 0,
    longestContinuousActiveMinutes: 0,
    continuousActivityIdleMinutes: 30,
    medianGapMinutes: 0,
    snackSessionCount: 0,
    deepSessionCount: 0,
  };
}

function createEmptyWorkspaceSummary() {
  return {
    activeWorkspaceCount: 0,
    knownWorkspaceSessionCount: 0,
    unknownWorkspaceSessionCount: 0,
    topWorkspaceSessionShare: 0,
    topWorkspaceActiveDays: 0,
    reopenCount: 0,
    activeDaysByWorkspace: [],
    topWorkspaces: [],
  };
}

function createEmptyToolUsageSummary() {
  return {
    usedToolCount: 0,
    toolCallCount: 0,
    topTools: [],
  };
}

function createEmptyPromptStyleSummary(enabled = false) {
  return {
    schemaVersion: 'taku.creator.prompt-style.v1',
    enabled: Boolean(enabled),
    promptContentRead: Boolean(enabled),
    rawPromptStored: false,
    rawPromptUploaded: false,
    promptCount: 0,
    analyzedPromptCount: 0,
    totalChars: 0,
    averageChars: 0,
    maxChars: 0,
    longPromptCount: 0,
    longPromptShare: 0,
    gratitudeCount: 0,
    gratitudeShare: 0,
    cinematicCount: 0,
    cinematicShare: 0,
    complexStepCount: 0,
    complexStepShare: 0,
    roastCount: 0,
    roastShare: 0,
    spicyCount: 0,
    spicyShare: 0,
    evidence: [],
  };
}

function createEmptyBehaviorProfile(
  periodId = DEFAULT_USAGE_PERIOD_ID,
  periodLabel = 'Last 90 Days',
) {
  return {
    schemaVersion: 'taku.creator.behavior.v1',
    period: {
      id: periodId || DEFAULT_USAGE_PERIOD_ID,
      label: periodLabel || 'Last 90 Days',
    },
    sessionCount: 0,
    observedSessionCount: 0,
    userTurnCount: 0,
    assistantTurnCount: 0,
    toolCallCount: 0,
    planningRatio: 0,
    plannedSessionCount: 0,
    steeringRatio: 0,
    steeredSessionCount: 0,
    steeringTurnCount: 0,
    autonomyScore: 0,
    autonomyLevel: 'unknown',
    autonomyComponents: {},
    averageToolRunLength: 0,
    medianToolRunLength: 0,
    longestToolRun: 0,
    medianSessionMinutes: 0,
    averageSessionMinutes: 0,
    toolRunCount: 0,
    dominantToolCategory: 'none',
    topToolsMix: [],
    metricDefinitions: [],
    evidence: [],
  };
}

export function createEmptyCreatorMetrics(
  options: CreatorMetricsOptions = {},
): PersonaRecord {
  const sources = options.source ? [options.source] : [];
  return {
    schemaVersion: 'taku.creator.metrics.v1',
    sources,
    sourceCount: sources.length,
    warnings: options.warnings || [],
    taku: {
      skillInstallCount: 0,
      skillCount: 0,
      skillReferenceCount: 0,
      trustedCreatorReferenceCount: 0,
      toolReferenceCount: 0,
      subscriberCount: 0,
      shareCount: 0,
      registrationRank: 0,
      creatorLevel: 0,
      activeInLast30Days: false,
      betaTester: false,
    },
    github: {
      repoCount: 0,
      publicRepoCount: 0,
      privateRepoCount: 0,
      totalStars: 0,
      maxRepoStars: 0,
      fetchedRepoCount: 0,
    },
    percentiles: {
      tokens: 0,
      stars: 0,
      installs: 0,
      subscribers: 0,
    },
    topPercentiles: {
      tokens: 0,
      stars: 0,
      installs: 0,
      subscribers: 0,
    },
    ...(options.path ? { path: options.path } : {}),
  };
}

export function normalizeCreatorMetrics(
  input: unknown,
  options: CreatorMetricsOptions = {},
): PersonaRecord {
  const root = asRecord(input?.metrics) || asRecord(input) || {};
  const profile = {
    ...(asRecord(root.profile) || {}),
    ...(asRecord(root.creator) || {}),
    ...(asRecord(root.creatorProfile) || {}),
  };
  const stats = {
    ...(asRecord(root.stats) || {}),
    ...(asRecord(root.creatorStats) || {}),
    ...(asRecord(root.summary) || {}),
  };
  const taku = {
    ...root,
    ...profile,
    ...stats,
    ...(asRecord(root.taku) || {}),
    ...(asRecord(root.platform) || {}),
    ...(asRecord(root.takuPlatform) || {}),
  };
  const github = {
    ...(asRecord(root.github) || {}),
    ...(asRecord(profile.github) || {}),
    ...(asRecord(stats.github) || {}),
  };
  const percentiles = {
    ...(asRecord(root.percentiles) || {}),
    ...(asRecord(taku.percentiles) || {}),
    ...(asRecord(github.percentiles) || {}),
  };
  const topPercentiles = {
    ...(asRecord(root.topPercentiles) || {}),
    ...(asRecord(root.top_percentiles) || {}),
    ...(asRecord(taku.topPercentiles) || {}),
    ...(asRecord(github.topPercentiles) || {}),
  };
  const rankGrade = normalizeRankGrade(root.rankGrade ?? taku.rankGrade);
  const publicRepoCount = readMetricNumber(github, [
    'publicRepoCount',
    'publicRepos',
    'public_repo_count',
  ]);
  const privateRepoCount = readMetricNumber(github, [
    'privateRepoCount',
    'privateRepos',
    'private_repo_count',
  ]);
  const repoCount =
    readMetricNumber(github, [
      'repoCount',
      'repos',
      'repositoryCount',
      'totalRepoCount',
    ]) ||
    publicRepoCount + privateRepoCount;
  const normalized = createEmptyCreatorMetrics(options);
  normalized.taku = {
    skillInstallCount: readMetricNumber(taku, [
      'skillInstallCount',
      'skillInstalls',
      'installCount',
      'installs',
      'totalInstalls',
      'total_installs',
    ]),
    skillCount: readMetricNumber(taku, [
      'skillCount',
      'skills',
      'publishedSkillCount',
      'createdSkillCount',
      'toolCount',
      'tool_count',
      'itemCount',
      'item_count',
    ]),
    skillReferenceCount: readMetricNumber(taku, [
      'skillReferenceCount',
      'skillReferences',
      'referenceCount',
      'references',
    ]),
    trustedCreatorReferenceCount: readMetricNumber(taku, [
      'trustedCreatorReferenceCount',
      'trustedReferences',
      'verifiedReferenceCount',
      'level3ReferenceCount',
      'lv3ReferenceCount',
    ]),
    toolReferenceCount: readMetricNumber(taku, [
      'toolReferenceCount',
      'toolReferences',
      'ecosystemReferenceCount',
    ]),
    subscriberCount: readMetricNumber(taku, [
      'subscriberCount',
      'subscriber_count',
      'subscribers',
      'followers',
      'followerCount',
      'follower_count',
    ]),
    shareCount: readMetricNumber(taku, [
      'shareCount',
      'staxShareCount',
      'socialShareCount',
      'mediaShareCount',
    ]),
    registrationRank: readMetricNumber(taku, [
      'registrationRank',
      'registeredRank',
      'creatorRegistrationRank',
      'earlyUserRank',
    ]),
    creatorLevel: readMetricNumber(taku, ['creatorLevel', 'level']),
    activeInLast30Days: readMetricBoolean(taku, [
      'activeInLast30Days',
      'last30DaysActive',
      'recentlyActive',
      'active30d',
    ]),
    betaTester: readMetricBoolean(taku, [
      'betaTester',
      'beta_tester',
      'isBetaTester',
      'is_beta_tester',
      'earlyAccessTester',
    ]),
  };
  normalized.github = {
    repoCount,
    publicRepoCount,
    privateRepoCount,
    totalStars: readMetricNumber(github, [
      'totalStars',
      'stars',
      'stargazerCount',
      'starCount',
    ]),
    maxRepoStars: readMetricNumber(github, [
      'maxRepoStars',
      'maxStars',
      'topRepoStars',
      'singleRepoStars',
    ]),
    fetchedRepoCount: readMetricNumber(github, [
      'fetchedRepoCount',
      'scannedRepoCount',
    ]),
  };
  normalized.percentiles = {
    tokens:
      readPercentileRank(percentiles, [
        'tokens',
        'token',
        'tokenUsage',
        'tokenPercentile',
      ]) || readPercentileRank(root, ['tokenPercentile', 'tokensPercentile']),
    stars:
      readPercentileRank(percentiles, [
        'stars',
        'githubStars',
        'starPercentile',
      ]) || readPercentileRank(github, ['starPercentile', 'starsPercentile']),
    installs:
      readPercentileRank(percentiles, [
        'installs',
        'skillInstalls',
        'installPercentile',
      ]) ||
      readPercentileRank(taku, [
        'installPercentile',
        'skillInstallPercentile',
      ]),
    subscribers:
      readPercentileRank(percentiles, [
        'subscribers',
        'followers',
        'subscriberPercentile',
      ]) ||
      readPercentileRank(taku, [
        'subscriberPercentile',
        'followerPercentile',
      ]),
  };
  normalized.topPercentiles = {
    tokens:
      readTopPercent(topPercentiles, [
        'tokens',
        'token',
        'tokenUsage',
        'tokensTopPercent',
      ]) || readTopPercent(root, ['tokenTopPercent', 'tokensTopPercent']),
    stars:
      readTopPercent(topPercentiles, [
        'stars',
        'githubStars',
        'starsTopPercent',
      ]) || readTopPercent(github, ['starsTopPercent', 'starTopPercent']),
    installs:
      readTopPercent(topPercentiles, [
        'installs',
        'skillInstalls',
        'installsTopPercent',
      ]) ||
      readTopPercent(taku, [
        'installsTopPercent',
        'skillInstallsTopPercent',
      ]),
    subscribers:
      readTopPercent(topPercentiles, [
        'subscribers',
        'followers',
        'subscribersTopPercent',
      ]) ||
      readTopPercent(taku, [
        'subscribersTopPercent',
        'followersTopPercent',
      ]),
  };
  if (rankGrade) {
    normalized.rankGrade = rankGrade;
  }
  if (Array.isArray(root.warnings)) {
    normalized.warnings = Array.from(
      new Set([
        ...(normalized.warnings || []),
        ...root.warnings
          .filter((warning) => typeof warning === 'string' && warning.trim())
          .map((warning) => warning.trim()),
      ]),
    ).slice(0, 12);
  }
  return normalized;
}

export function mergeCreatorMetrics(...items: unknown[]): PersonaRecord {
  const merged = createEmptyCreatorMetrics();
  const sourceSet = new Set();
  const warnings = [];
  for (const item of items) {
    const metrics =
      item?.schemaVersion === 'taku.creator.metrics.v1'
        ? item
        : normalizeCreatorMetrics(item);
    for (const source of metrics.sources || []) sourceSet.add(source);
    warnings.push(...(metrics.warnings || []));
    mergeMetricNumberFields(
      merged.taku,
      metrics.taku,
      [
        'skillInstallCount',
        'skillCount',
        'skillReferenceCount',
        'trustedCreatorReferenceCount',
        'toolReferenceCount',
        'subscriberCount',
        'shareCount',
        'creatorLevel',
      ],
      'max',
    );
    mergeMetricNumberFields(
      merged.github,
      metrics.github,
      [
        'repoCount',
        'publicRepoCount',
        'privateRepoCount',
        'totalStars',
        'maxRepoStars',
        'fetchedRepoCount',
      ],
      'max',
    );
    merged.taku.registrationRank = mergeRankMetric(
      merged.taku.registrationRank,
      metrics.taku?.registrationRank,
    );
    merged.taku.activeInLast30Days = Boolean(
      merged.taku.activeInLast30Days || metrics.taku?.activeInLast30Days,
    );
    merged.taku.betaTester = Boolean(
      merged.taku.betaTester || metrics.taku?.betaTester,
    );
    mergeMetricNumberFields(
      merged.percentiles,
      metrics.percentiles,
      ['tokens', 'stars', 'installs', 'subscribers'],
      'max',
    );
    mergeMetricNumberFields(
      merged.topPercentiles,
      metrics.topPercentiles,
      ['tokens', 'stars', 'installs', 'subscribers'],
      'min-positive',
    );
    const rankGrade = mergeRankGradeObject(merged.rankGrade, metrics.rankGrade);
    if (rankGrade) {
      merged.rankGrade = rankGrade;
    }
  }
  merged.sources = Array.from(sourceSet).sort();
  merged.sourceCount = merged.sources.length;
  merged.warnings = warnings.slice(0, 12);
  return merged;
}

function normalizeRankGrade(value) {
  const rankGrade = asRecord(value);
  if (!rankGrade) return null;
  const grade = typeof rankGrade.grade === 'string' ? rankGrade.grade.trim() : '';
  const label = typeof rankGrade.label === 'string' ? rankGrade.label.trim() : '';
  if (!grade && !label) return null;
  const metric = typeof rankGrade.metric === 'string' ? rankGrade.metric.trim() : null;
  const reason = typeof rankGrade.reason === 'string' ? rankGrade.reason.trim() : '';
  const topPercent = Number(rankGrade.topPercent ?? rankGrade.top_percent);
  return {
    grade: grade || 'Unranked',
    label: label || grade || 'Unranked',
    topPercent: Number.isFinite(topPercent) && topPercent > 0 ? round(topPercent, 4) : null,
    metric,
    reason,
  };
}

function mergeRankGradeObject(current, next) {
  const currentRank = normalizeRankGrade(current);
  const nextRank = normalizeRankGrade(next);
  if (!currentRank) return nextRank;
  if (!nextRank) return currentRank;
  if (currentRank.topPercent && nextRank.topPercent) {
    return nextRank.topPercent < currentRank.topPercent ? nextRank : currentRank;
  }
  if (nextRank.topPercent) return nextRank;
  return currentRank;
}

function mergeMetricNumberFields(target, source, fields, mode = 'max') {
  for (const field of fields) {
    const value = Number(source?.[field]) || 0;
    target[field] =
      mode === 'min-positive'
        ? mergeRankMetric(target[field], value)
        : Math.max(Number(target[field]) || 0, value);
  }
}

function mergeRankMetric(current, next) {
  const left = Number(current) || 0;
  const right = Number(next) || 0;
  if (left <= 0) return right;
  if (right <= 0) return left;
  return Math.min(left, right);
}

function readMetricNumber(record, names) {
  const source = asRecord(record) || {};
  for (const name of names) {
    const value = Number(source[name]);
    if (Number.isFinite(value) && value >= 0) return Math.floor(value);
  }
  return 0;
}

function readMetricBoolean(record, names) {
  const source = asRecord(record) || {};
  for (const name of names) {
    const value = source[name];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && value.trim()) {
      return /^(1|true|yes|y)$/i.test(value.trim());
    }
    if (typeof value === 'number') return value > 0;
  }
  return false;
}

function readPercentileRank(record, names) {
  const source = asRecord(record) || {};
  for (const name of names) {
    const value = Number(source[name]);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (value <= 1) return round(value, 3);
    if (value <= 100) return round(value / 100, 3);
  }
  return 0;
}

function readTopPercent(record, names) {
  const source = asRecord(record) || {};
  for (const name of names) {
    const value = Number(source[name]);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (value <= 1) return round(value, 4);
    if (value <= 100) return round(value / 100, 4);
  }
  return 0;
}

export function metricTopPercent(
  metrics: PersonaRecord,
  key: string,
): number {
  const topPercent = Number(metrics?.topPercentiles?.[key]) || 0;
  if (topPercent > 0) return topPercent;
  const rank = Number(metrics?.percentiles?.[key]) || 0;
  return rank > 0 ? round(1 - rank, 4) : 0;
}

export function isMetricTopPercent(
  metrics: PersonaRecord,
  key: string,
  maxTopPercent: number,
): boolean {
  const topPercent = metricTopPercent(metrics, key);
  return topPercent > 0 && topPercent <= maxTopPercent;
}

export function topPercentEvidence(
  label: string,
  topPercent: number,
): string {
  const percent = Math.max(1, round(topPercent * 100, 1));
  return `${label} top ${percent}%`;
}

function summarizeBuiltItemTypes(items) {
  return summarizeItemTypes(items);
}

function summarizeItemTypes(items) {
  const counts = { maker: 0, infra: 0, hybrid: 0, unknown: 0 };
  const examples = { maker: [], infra: [], hybrid: [], unknown: [] };
  for (const item of items) {
    const classification = classifyBuiltItem(item);
    counts[classification.kind] += 1;
    if (examples[classification.kind].length < 6) {
      examples[classification.kind].push({
        name: item.name,
        type: item.type,
        reason: classification.reason,
      });
    }
  }
  const classifiedCount = counts.maker + counts.infra + counts.hybrid;
  return {
    ...counts,
    classifiedCount,
    makerShare:
      classifiedCount > 0
        ? round((counts.maker + counts.hybrid * 0.5) / classifiedCount, 3)
        : 0,
    infraShare:
      classifiedCount > 0
        ? round((counts.infra + counts.hybrid * 0.5) / classifiedCount, 3)
        : 0,
    examples,
  };
}

function classifyBuiltItem(item) {
  const type = normalizeChoiceToken(item?.type);
  const text = [
    item?.type,
    item?.name,
    item?.description,
    item?.detectedFrom,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const makerTypes = new Set([
    'app',
    'website',
    'webapp',
    'ui',
    'component',
    'assetlibrary',
    'asset',
    'template',
    'theme',
    'content',
    'document',
    'presentation',
    'spreadsheet',
  ]);
  const infraTypes = new Set([
    'mcp',
    'mcpserver',
    'workflow',
    'agent',
    'automation',
    'cli',
    'command',
    'connector',
    'plugin',
    'server',
    'daemon',
  ]);
  if (makerTypes.has(type)) {
    return { kind: 'maker', reason: `${item.type || 'item'} is user-facing` };
  }
  if (infraTypes.has(type)) {
    return {
      kind: 'infra',
      reason: `${item.type || 'item'} is infrastructure/tooling`,
    };
  }
  const makerKeywords = [
    'react',
    'vite',
    'next',
    'electron',
    'ui',
    'frontend',
    'component',
    'image',
    'design',
    'theme',
    'template',
    'canvas',
    'viewer',
    'dashboard',
    'site',
    'app',
  ];
  const infraKeywords = [
    'mcp',
    'agent',
    'workflow',
    'automation',
    'cli',
    'daemon',
    'server',
    'api',
    'connector',
    'toolchain',
    'pipeline',
    'deploy',
    'script',
  ];
  const makerScore = makerKeywords.filter((keyword) =>
    text.includes(keyword),
  ).length;
  const infraScore = infraKeywords.filter((keyword) =>
    text.includes(keyword),
  ).length;
  if (makerScore > infraScore) {
    return {
      kind: 'maker',
      reason: `matched maker keywords (${makerScore})`,
    };
  }
  if (infraScore > makerScore) {
    return {
      kind: 'infra',
      reason: `matched infra keywords (${infraScore})`,
    };
  }
  if (makerScore > 0 && infraScore > 0) {
    return { kind: 'hybrid', reason: 'matched maker and infra keywords' };
  }
  if (type === 'skill' || type === 'tool') {
    return {
      kind: 'hybrid',
      reason: `${item.type || 'item'} can be user-facing or infra`,
    };
  }
  return { kind: 'unknown', reason: 'not enough metadata to classify' };
}

function summarizeInstalledToolUsage(usedTools, rawToolUsage) {
  const installed = usedTools.map((item) => ({
    name: item.name,
    keys: [item?.name, item?.type, item?.detectedFrom]
      .map(normalizeToolMatchKey)
      .filter((value) => value && value.length >= 3),
  }));
  let usedInstalledToolCount = 0;
  for (const item of installed) {
    const matched = (rawToolUsage.topTools || []).some((tool) => {
      const toolKey = normalizeToolMatchKey(tool.name);
      return item.keys.some(
        (key) => key && (toolKey.includes(key) || key.includes(toolKey)),
      );
    });
    if (matched) usedInstalledToolCount += 1;
  }
  return { usedInstalledToolCount };
}

function normalizeToolMatchKey(value) {
  return normalizeChoiceToken(value)
    .replace(/^mcp/, '')
    .replace(/^tool/, '')
    .replace(/^skill/, '');
}

const MAIN_ARCHETYPES = personaLegacyArchetypes('zh-CN');
const ROOKIE_COPY = ROOKIE_PERSONA_LOCALIZATIONS['zh-CN'];
const DEFAULT_ROOKIE_PERSONA = {
  code: 'ROOKIE',
  title: ROOKIE_COPY.title,
  subtitle: ROOKIE_COPY.subtitle,
  signature: ROOKIE_COPY.description,
  minSessionCount: 3,
  minActiveEvents: 12,
  minConfidentAxes: 3,
  minAxisConfidence: 0.3,
};
const DEFAULT_LOCAL_TRAIT_RULES = {
  slowCook: { label: 'Slow Cook', category: 'Work Pattern', thresholdMinutes: 240, confidence: 0.72 },
  flowState: { label: 'Flow State', category: 'Work Pattern', thresholdMinutes: 360, confidence: 0.78 },
  snackCoder: { label: 'Snack Coder', category: 'Work Pattern', maxMedianMinutes: 15, minShortSessions: 4, confidence: 0.66 },
  speedDemon: { label: 'Speed Demon', category: 'Work Pattern', maxMedianGapMinutes: 20, minActiveEvents: 12, confidence: 0.62 },
  diceRoller: { label: 'Dice Roller', category: 'Work Pattern', minSteeringRatio: 0.75, minSteeringTurns: 30, maxPlanningRatio: 0.3, confidence: 0.58 },
  oneShotShipper: { label: 'One-Shot Shipper', category: 'Output Style', minCommitCount: 3, maxDirtyFiles: 2, maxBranchCount: 2, confidence: 0.58 },
  iterationFreak: { label: 'Iteration Freak', category: 'Output Style', minReopenCount: 50, confidence: 0.68 },
  reArchitect: { label: 'Re-Architect', category: 'Output Style', minBranchCount: 6, minDirtyFiles: 20, confidence: 0.62 },
  selfReflector: { label: 'Self-Reflector', category: 'Output Style', minReopenCount: 30, minMaxUncommittedDays: 30, confidence: 0.6 },
  polisher: { label: 'Polisher', category: 'Output Style', minUiFileRatio: 0.32, minScannedFiles: 30, confidence: 0.6 },
  polyglot: { label: 'Polyglot', category: 'Stack & Tech', minLanguages: 5, confidence: 0.66 },
  monoStack: { label: 'Mono-Stack', category: 'Stack & Tech', minTopLanguageShare: 0.9, minTotalFiles: 30, confidence: 0.6 },
  docDevourer: { label: 'Doc Devourer', category: 'Stack & Tech', minDocFileCount: 80, minReadSearchShare: 0.025, confidence: 0.6 },
  toolHoarder: { label: 'Tool Hoarder', category: 'Ecosystem', minInstalledTools: 50, maxUsageCoverage: 0.4, confidence: 0.68 },
  tokenTycoon: { label: 'Token Tycoon', category: 'Achievement', maxTopPercent: 5, threshold: 1000000000, confidence: 0.72 },
  starMagnet: { label: 'Star Magnet', category: 'Achievement', minMaxRepoStars: 1000, confidence: 0.76 },
  ossBuff: { label: 'OSS Buff', category: 'Achievement', minPublicRepos: 10, confidence: 0.66 },
  helper: { label: 'Helper', category: 'Achievement', minSkillInstalls: 100, confidence: 0.7 },
  prolificAuthor: { label: 'Prolific Author', category: 'Achievement', minSkillCount: 10, confidence: 0.66 },
  privateCoder: { label: 'Private Coder', category: 'Ecosystem', minPrivateRepoShare: 0.8, minRepoCount: 3, confidence: 0.62 },
  worldBuilder: { label: 'World Builder', category: 'Ecosystem', minReferenceCount: 10, confidence: 0.66 },
  aesthete: { label: 'Aesthete', category: 'Ecosystem', minUiFileCount: 80, minUiFileRatio: 0.06, confidence: 0.6 },
  showOff: { label: 'Show Off', category: 'Ecosystem', minShareCount: 5, confidence: 0.6 },
  betaTester: { label: 'Beta Tester', category: 'Personality', confidence: 0.72 },
  gratefulCoder: { label: 'Grateful Coder', category: 'Personality', minPromptCount: 8, minGratitudeCount: 3, minGratitudeShare: 0.16, confidence: 0.62 },
  cinematicPrompter: { label: 'Cinematic Prompter', category: 'Personality', minPromptCount: 5, minCinematicCount: 2, minLongPromptShare: 0.25, minAverageChars: 500, confidence: 0.62 },
  promptWizard: { label: 'Prompt Wizard', category: 'Personality', minPromptCount: 5, minComplexStepCount: 3, minComplexStepShare: 0.18, confidence: 0.66 },
  codeRoaster: { label: 'Code Roaster', category: 'Personality', minPromptCount: 8, minRoastCount: 2, minRoastShare: 0.08, confidence: 0.58 },
  spicyPrompter: { label: 'Spicy Prompter', category: 'Personality', minPromptCount: 8, minSpicyCount: 2, minSpicyShare: 0.08, confidence: 0.58 },
};
export const DEFAULT_PERSONA_RULES = {
  schemaVersion: 'taku.creator.persona-rules.v1',
  defaultTone: 'brainrot',
  tonePacks: {
    brainrot: {
      label: 'Brainrot',
      archetypes: MAIN_ARCHETYPES,
    },
  },
  starter: {
    rookie: DEFAULT_ROOKIE_PERSONA,
  },
  traits: DEFAULT_LOCAL_TRAIT_RULES,
  hidden: {
    architect: { title: 'The Architect', subtitle: '缔造者', description: '他造的工具，每个 AI 创作者都用过。影响力维度的天花板。', trigger: '累计 skill 安装数 1000+', confidence: 0.95 },
    oracle: { title: 'The Oracle', subtitle: '神谕者', description: '从 Taku 第一天就在，至今仍活跃。时间的见证者，元老中的元老。', trigger: '首 100 注册 + 近 30 天活跃', confidence: 0.9 },
    demiurge: { title: 'The Demiurge', subtitle: '造物主', description: '造物者之造物者。其他大佬的工具，都建在他造的工具之上。', trigger: 'skills 被可信/认证创作者引用 50+', confidence: 0.92 },
    sovereign: { title: 'The Sovereign', subtitle: '主宰者', description: '所有维度的王。token、stars、安装数、订阅数，每一项都在前 1%。', trigger: '4 项核心指标全部 top 1%', confidence: 0.96 },
    insomniacDaywalker: { title: 'Insomniac Daywalker', subtitle: '不眠行者', description: '凌晨在线，早上也在线。你究竟什么时候睡？没人知道。', trigger: '22-04 + 06-12 双时段都高活跃', confidence: 0.68 },
    schrodingersCoder: { title: "Schrödinger's Coder", subtitle: '薛定谔程序员', description: '同时在写 12 个项目，没一个完成。永远在进行中，永远不会发布。', trigger: '10+ 项目全部 WIP 状态', confidence: 0.62 },
    phantom: { title: 'The Phantom', subtitle: '幽灵', description: '巨量 token 消耗，零公开输出。这个人到底在写什么？没人知道。', trigger: 'token top 10% + 零 public skill / repo', confidence: 0.7 },
    polymath: { title: 'The Polymath', subtitle: '全能怪', description: '每个维度都 50/50。不夜不日，不混不乱，不囤不独。系统无法分类的人。', trigger: '4 轴每轴偏差 <= 10%', confidence: 0.58 },
  },
  manualTraits: {
    betaTester: {
      label: 'Beta Tester',
      category: 'Personality',
      description: 'Confirmed participation in an early-access or beta program.',
    },
  },
};

export function mergePersonaRules(
  base: PersonaRecord,
  override: unknown,
): PersonaRecord {
  const merged = {
    ...base,
    ...asRecord(override),
    tonePacks: {
      ...(base.tonePacks || {}),
      ...(asRecord(override?.tonePacks) || {}),
    },
    traits: {
      ...(base.traits || {}),
      ...(asRecord(override?.traits) || {}),
    },
    hidden: {
      ...(base.hidden || {}),
      ...(asRecord(override?.hidden) || {}),
    },
    manualTraits: {
      ...(base.manualTraits || {}),
      ...(asRecord(override?.manualTraits) || {}),
    },
  };
  if (!merged.defaultTone || !merged.tonePacks?.[merged.defaultTone]) merged.defaultTone = base.defaultTone;
  return merged;
}

export function normalizePersonaTone(
  value: unknown,
  rules: PersonaRecord = DEFAULT_PERSONA_RULES,
): string {
  const tonePacks = asRecord(rules?.tonePacks) || {};
  const defaultTone = stringValue(rules?.defaultTone) || DEFAULT_PERSONA_RULES.defaultTone;
  if (!value) return tonePacks[defaultTone] ? defaultTone : Object.keys(tonePacks)[0] || 'brainrot';
  const normalized = normalizeChoiceToken(value);
  const match = Object.keys(tonePacks).find((tone) => normalizeChoiceToken(tone) === normalized || normalizeChoiceToken(tonePacks[tone]?.label) === normalized);
  return match || (tonePacks[defaultTone] ? defaultTone : Object.keys(tonePacks)[0] || 'brainrot');
}

export function composePersonaSignals({
  usage,
  usedTools = [],
  ownedCreations = [],
  projectMetadata = {},
  creatorMetrics = createEmptyCreatorMetrics(),
  includeGitHubMetrics = false,
  generatedAt,
}: PersonaSignalsInput): PersonaRecord {
  const activity = usage?.activity || createEmptyActivitySummary();
  const workspaces = usage?.workspaces || createEmptyWorkspaceSummary();
  const rawToolUsage = usage?.toolUsage || createEmptyToolUsageSummary();
  const behaviorProfile = usage?.behaviorProfile || createEmptyBehaviorProfile(usage?.primaryPeriodId, usage?.periodLabel);
  const promptStyle = usage?.promptStyle || createEmptyPromptStyleSummary(false);
  const builtItems = summarizeBuiltItemTypes(ownedCreations);
  const activeToolItems = (rawToolUsage.topTools || []).length
    ? rawToolUsage.topTools.map((tool) => ({
        type: 'tool',
        name: tool.name,
        description: `${tool.count || 0} local call(s)`,
      }))
    : usedTools;
  const toolTypes = summarizeItemTypes(activeToolItems);
  const externalMetrics = mergeCreatorMetrics(
    creatorMetrics,
    normalizeCreatorMetrics({
      github: projectMetadata.github,
    }, {
      source: includeGitHubMetrics ? 'github-public-repo-metrics' : undefined,
      warnings: projectMetadata.github?.warnings || [],
    })
  );
  const installedToolCount = usedTools.length;
  const builtItemCount = ownedCreations.length;
  const installedBuiltRatio = builtItemCount > 0
    ? round(installedToolCount / builtItemCount, 2)
    : 0;
  const matchedToolUsage = summarizeInstalledToolUsage(usedTools, rawToolUsage);
  const activeToolCount = (rawToolUsage.topTools || []).length || matchedToolUsage.usedInstalledToolCount || 0;
  const installedActiveRatio = activeToolCount > 0
    ? round(installedToolCount / activeToolCount, 2)
    : installedToolCount > 0 ? installedToolCount : 0;

  return {
    schemaVersion: PERSONA_SIGNALS_SCHEMA,
    generatedAt: generatedAt || new Date().toISOString(),
    source: 'local-metadata',
    privacy: {
      promptContentRead: Boolean(promptStyle.enabled),
      sourceContentRead: false,
      localPathsIncluded: false,
      workspaceValuesHashed: true,
      externalMetricsIncluded: externalMetrics.sourceCount > 0,
      publicGitHubMetricsRead: includeGitHubMetrics,
    },
    period: {
      id: usage?.primaryPeriodId || DEFAULT_USAGE_PERIOD_ID,
      label: usage?.periodLabel || 'Last 90 Days',
      startsAt: usage?.startsAt,
      endsAt: usage?.endsAt,
    },
    usage: {
      totalTokens: usage?.totalTokens || 0,
      sessionCount: usage?.sessionCount || 0,
      eventCount: usage?.eventCount || 0,
    },
    activity,
    workspaces,
    promptStyle,
    behaviorProfile,
    behaviorProfileV1: behaviorProfile,
    toolUsage: {
      ...rawToolUsage,
      usedInstalledToolCount: matchedToolUsage.usedInstalledToolCount,
      installedButUnusedCount: Math.max(0, installedToolCount - matchedToolUsage.usedInstalledToolCount),
      installedUsageCoverage: installedToolCount > 0
        ? round(matchedToolUsage.usedInstalledToolCount / installedToolCount, 3)
        : 0,
    },
    projects: projectMetadata.projects,
    git: projectMetadata.git,
    stack: projectMetadata.stack,
    external: externalMetrics,
    builtItems,
    toolTypes,
    ecosystem: {
      installedToolCount,
      builtItemCount,
      installedBuiltRatio,
      activeToolCount,
      installedActiveRatio,
      installedSourceCount: new Set(usedTools.map((item) => item.source).filter(Boolean)).size,
      builtSourceCount: new Set(ownedCreations.map((item) => item.source).filter(Boolean)).size,
      creationCandidatesEnabled: ownedCreations.length > 0,
      skillInstallCount: externalMetrics.taku.skillInstallCount,
      skillCount: externalMetrics.taku.skillCount,
      skillReferenceCount: externalMetrics.taku.skillReferenceCount,
      trustedCreatorReferenceCount: externalMetrics.taku.trustedCreatorReferenceCount,
      toolReferenceCount: externalMetrics.taku.toolReferenceCount,
      subscriberCount: externalMetrics.taku.subscriberCount,
      shareCount: externalMetrics.taku.shareCount,
      publicRepoCount: externalMetrics.github.publicRepoCount,
      privateRepoCount: externalMetrics.github.privateRepoCount,
      repoCount: externalMetrics.github.repoCount,
      totalStars: externalMetrics.github.totalStars,
      maxRepoStars: externalMetrics.github.maxRepoStars,
    },
  };
}

function normalizePersonaArchetype(code, tone, archetype = {}) {
  return {
    title: cleanText(archetype.title, 120) || 'AI Builder',
    subtitle: cleanText(archetype.subtitle, 240) || '',
    signature: personaSignatureFor(code, tone, archetype),
  };
}

export function buildPersonaV2(
  signals: PersonaRecord,
  options: PersonaBuildOptions = {},
): PersonaRecord {
  const rules = options.rules || DEFAULT_PERSONA_RULES;
  const tone = normalizePersonaTone(options.tone, rules);
  const axes = [
    scoreArchitectExplorer(signals),
    scoreMakerInfra(signals),
    scoreOwlLark(signals),
    scoreHoarderWolf(signals),
  ];
  const provisionalCode = axes.map((axis) => axis.letter).join('');
  const rookieRule = {
    ...DEFAULT_ROOKIE_PERSONA,
    ...(asRecord(rules.starter?.rookie) || {}),
  };
  const isRookie = shouldUseRookiePersona(signals, axes, rookieRule);
  const code = isRookie ? cleanText(rookieRule.code, 12) || 'ROOKIE' : provisionalCode;
  const rookieVariant = isRookie ? selectRookieVariant(signals) : undefined;
  const tonePacks = asRecord(rules.tonePacks) || DEFAULT_PERSONA_RULES.tonePacks;
  const tonePack = tonePacks[tone] || tonePacks[rules.defaultTone] || DEFAULT_PERSONA_RULES.tonePacks.brainrot;
  const archetypeAlternates = isRookie ? {} : buildArchetypeAlternates(code, tonePacks);
  const archetype = normalizePersonaArchetype(code, tone, isRookie ? rookieRule : tonePack?.archetypes?.[code] || MAIN_ARCHETYPES[code] || {
    title: 'AI Builder',
    subtitle: 'Builds with a mixed local AI stack.',
  });
  const traits = derivePersonaTraits(signals, axes, rules);
  const hiddenCandidates = deriveHiddenCandidates(signals, axes, rules);
  const influences = derivePersonaInfluences(signals, axes);
  return applyPersonaOverrides({
    schemaVersion: PERSONA_SCHEMA,
    generatedAt: options.generatedAt || new Date().toISOString(),
    code,
    stage: isRookie ? 'rookie' : 'classified',
    ...(isRookie ? { provisionalCode, rookieVariant } : {}),
    tone,
    toneLabel: cleanText(tonePack?.label, 80) || tone,
    availableTones: Object.entries(tonePacks).map(([id, pack]) => ({
      id,
      label: cleanText(pack?.label, 80) || id,
    })),
    archetypeAlternates,
    archetype,
    confidence: round(average(axes.map((axis) => axis.confidence)), 2),
    axes,
    influences,
    autoTraits: traits,
    traits,
    hiddenCandidates,
    manualTraitCatalog: buildManualTraitCatalog(rules),
    rules: {
      source: options.rulesSource || 'built-in',
      path: options.rulesPath,
      warnings: options.warnings || [],
    },
    note: isRookie
      ? 'Not enough local activity has been observed to assign a stable four-axis persona yet.'
      : signals.external?.sourceCount > 0
      ? 'Generated from local metadata plus optional user-provided/public creator metrics. Prompt content and source content are not analyzed.'
      : 'Generated from local metadata only. Prompt content and source content are not analyzed.',
  }, options.overrides || {});
}

function selectRookieVariant(signals) {
  const sessionCount = Number(signals?.usage?.sessionCount) || 0;
  const activeEventCount = Number(signals?.activity?.activeEventCount) || 0;
  return sessionCount > 0 || activeEventCount > 0 ? 'alt' : 'default';
}

function shouldUseRookiePersona(signals, axes, rule) {
  if (rule?.enabled === false) return false;
  const sessionCount = Number(signals?.usage?.sessionCount) || 0;
  const activeEventCount = Number(signals?.activity?.activeEventCount) || 0;
  const minAxisConfidence = Number(rule?.minAxisConfidence) || DEFAULT_ROOKIE_PERSONA.minAxisConfidence;
  const confidentAxisCount = axes.filter((axis) => (Number(axis?.confidence) || 0) >= minAxisConfidence).length;
  return sessionCount < (Number(rule?.minSessionCount) || DEFAULT_ROOKIE_PERSONA.minSessionCount) ||
    activeEventCount < (Number(rule?.minActiveEvents) || DEFAULT_ROOKIE_PERSONA.minActiveEvents) ||
    confidentAxisCount < (Number(rule?.minConfidentAxes) || DEFAULT_ROOKIE_PERSONA.minConfidentAxes);
}

function buildManualTraitCatalog(rules = DEFAULT_PERSONA_RULES) {
  return Object.entries(rules.manualTraits || {})
    .map(([id, item]) => ({
      id: traitIdFromKey(id),
      label: cleanText(item?.label, 80) || id,
      category: cleanText(item?.category, 80) || 'Personality',
      description: cleanText(item?.description, 180) || '',
    }))
    .sort((left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label));
}

function traitIdFromKey(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function buildArchetypeAlternates(code, tonePacks) {
  const alternates = {};
  for (const [tone, pack] of Object.entries(tonePacks || {})) {
    const archetype = pack?.archetypes?.[code];
    if (!archetype) continue;
    const normalized = normalizePersonaArchetype(code, tone, archetype);
    alternates[tone] = {
      tone,
      toneLabel: cleanText(pack?.label, 80) || tone,
      title: normalized.title,
      subtitle: normalized.subtitle,
      signature: normalized.signature,
    };
  }
  return alternates;
}

function scoreArchitectExplorer(signals) {
  const workspaces = signals.workspaces || createEmptyWorkspaceSummary();
  const activity = signals.activity || createEmptyActivitySummary();
  const behavior = signals.behaviorProfile || createEmptyBehaviorProfile(signals.period?.id, signals.period?.label);
  let score = 0.5;
  const evidence = [];
  if (behavior.observedSessionCount > 0) {
    score += (behavior.planningRatio - 0.35) * 0.22;
    evidence.push(`${formatPercent(behavior.planningRatio)} planning-first session ratio`);
  }
  if (workspaces.knownWorkspaceSessionCount > 0) {
    score += (workspaces.topWorkspaceSessionShare - 0.45) * 0.65;
    evidence.push(`${formatPercent(workspaces.topWorkspaceSessionShare)} of known sessions in top workspace`);
  }
  if (workspaces.activeWorkspaceCount >= 8) {
    score -= 0.18;
    evidence.push(`${workspaces.activeWorkspaceCount} active workspaces`);
  } else if (workspaces.activeWorkspaceCount > 0 && workspaces.activeWorkspaceCount <= 2) {
    score += 0.12;
    evidence.push(`${workspaces.activeWorkspaceCount} active workspace(s)`);
  }
  if (activity.medianSessionMinutes >= 45) {
    score += 0.1;
    evidence.push(`${activity.medianSessionMinutes}m median session`);
  } else if (activity.medianSessionMinutes > 0 && activity.medianSessionMinutes <= 15) {
    score -= 0.08;
    evidence.push(`${activity.medianSessionMinutes}m median session`);
  }
  if (workspaces.topWorkspaceActiveDays >= 5) {
    score += 0.08;
    evidence.push(`${workspaces.topWorkspaceActiveDays} active day(s) in top workspace`);
  }
  if (workspaces.reopenCount >= 20 && workspaces.topWorkspaceSessionShare >= 0.5) {
    score += 0.06;
    evidence.push(`${workspaces.reopenCount} workspace revisit(s)`);
  }
  const confidence = clamp(0.25 + workspaces.knownWorkspaceSessionCount * 0.04 + (activity.activeEventCount > 0 ? 0.12 : 0) + (behavior.observedSessionCount > 0 ? 0.04 : 0), 0.2, 0.86);
  return axisResult({
    id: 'howYouBuild',
    label: 'Architect ↔ Explorer',
    first: 'A',
    second: 'E',
    score,
    confidence,
    evidence,
  });
}

function scoreMakerInfra(signals) {
  const tools = signals.toolTypes || {};
  const behavior = signals.behaviorProfile || createEmptyBehaviorProfile(signals.period?.id, signals.period?.label);
  const total = tools.classifiedCount || 0;
  const mixByCategory = new Map((behavior.topToolsMix || []).map((item) => [item.category, item.share || 0]));
  const infraBehaviorShare = (mixByCategory.get('shell') || 0) + (mixByCategory.get('tooling') || 0);
  const makerBehaviorShare = (mixByCategory.get('edit') || 0) + (mixByCategory.get('browser') || 0);
  let score = total > 0 ? tools.makerShare : 0.5;
  if (behavior.observedSessionCount > 0) {
    score += (makerBehaviorShare - infraBehaviorShare) * 0.22;
  }
  const evidence = total > 0
    ? [
        `${tools.maker} maker-facing, ${tools.infra} infra-facing, ${tools.hybrid} hybrid used tool(s)`,
        behavior.dominantToolCategory && behavior.dominantToolCategory !== 'none'
          ? `${behaviorCategoryLabel(behavior.dominantToolCategory)} leads behavior mix`
          : '',
      ]
    : ['No classified tool usage yet'];
  const confidence = total > 0 ? clamp(0.32 + total * 0.06 + (behavior.observedSessionCount > 0 ? 0.04 : 0), 0.28, 0.9) : 0.2;
  return axisResult({
    id: 'whatYouUse',
    label: 'Maker-facing ↔ Infra-facing',
    first: 'M',
    second: 'I',
    score,
    confidence,
    evidence,
  });
}

function scoreOwlLark(signals) {
  const activity = signals.activity || createEmptyActivitySummary();
  const nightIntensity = activity.nightEventCount / NIGHT_HOURS.size;
  const dayIntensity = activity.dayEventCount / DAY_HOURS.size;
  const totalIntensity = nightIntensity + dayIntensity;
  const score = totalIntensity > 0 ? nightIntensity / totalIntensity : 0.5;
  const evidence = activity.activeEventCount > 0
    ? [`${formatPercent(activity.nightShare)} night events, ${formatPercent(activity.dayShare)} day events`]
    : ['No activity timestamps found'];
  const confidence = activity.activeEventCount > 0 ? clamp(0.3 + activity.activeEventCount * 0.01, 0.3, 0.86) : 0.2;
  return axisResult({
    id: 'whenYouBuild',
    label: 'Owl ↔ Lark',
    first: 'O',
    second: 'L',
    score,
    confidence,
    evidence,
  });
}

function scoreHoarderWolf(signals) {
  const ecosystem = signals.ecosystem || {};
  const toolUsage = signals.toolUsage || createEmptyToolUsageSummary();
  const installed = ecosystem.installedToolCount || 0;
  const active = toolUsage.usedInstalledToolCount || ecosystem.activeToolCount || 0;
  const coverage = installed > 0 ? active / installed : 0;
  const score = installed > 0
    ? clamp(1 - coverage + (installed >= 50 ? 0.08 : 0), 0, 1)
    : 0.5;
  const evidence = [
    `${installed} installed/available tool(s)`,
    `${active} tool(s) seen in local calls`,
    `${formatPercent(coverage)} installed-tool usage coverage`,
  ];
  const confidence = installed + active > 0 ? clamp(0.3 + (installed + active) * 0.01, 0.3, 0.84) : 0.2;
  return axisResult({
    id: 'howYouEcosystem',
    label: 'Hoarder ↔ Wolf',
    first: 'H',
    second: 'W',
    score,
    confidence,
    evidence,
  });
}

function axisResult({ id, label, first, second, score, confidence, evidence }) {
  const clampedScore = clamp(score, 0, 1);
  return {
    id,
    label,
    first,
    second,
    letter: clampedScore >= 0.5 ? first : second,
    score: round(clampedScore, 3),
    confidence: round(confidence, 2),
    evidence: evidence.filter(Boolean).slice(0, 4),
  };
}

function derivePersonaInfluences(signals, axes) {
  const activity = signals.activity || createEmptyActivitySummary();
  const workspaces = signals.workspaces || createEmptyWorkspaceSummary();
  const behavior = signals.behaviorProfile || createEmptyBehaviorProfile(signals.period?.id, signals.period?.label);
  const ecosystem = signals.ecosystem || {};
  const toolUsage = signals.toolUsage || createEmptyToolUsageSummary();
  const installed = ecosystem.installedToolCount || 0;
  const active = toolUsage.usedInstalledToolCount || ecosystem.activeToolCount || 0;
  const coverage = installed > 0 ? active / installed : 0;
  const dominantMix = behavior.topToolsMix?.[0];
  return axes.map((axis) => {
    let impact = '';
    let meaning = '';
    if (axis.id === 'howYouBuild') {
      meaning = axis.letter === 'A' ? 'Architect' : 'Explorer';
      impact = axis.letter === 'A'
        ? `Planning-first work (${formatPercent(behavior.planningRatio)}) and focused workspace activity pull this toward Architect.`
        : `${workspaces.activeWorkspaceCount} active workspace(s), ${formatPercent(behavior.planningRatio)} planning-first ratio, and ${activity.medianSessionMinutes}m median sessions pull this toward Explorer.`;
    } else if (axis.id === 'whatYouUse') {
      meaning = axis.letter === 'M' ? 'Maker-facing' : 'Infra-facing';
      impact = axis.letter === 'M'
        ? `User-facing/edit/browser activity is stronger than infra signals; dominant mix is ${behaviorCategoryLabel(behavior.dominantToolCategory)}.`
        : `${behaviorCategoryLabel(behavior.dominantToolCategory)} leads the tool mix${dominantMix ? ` at ${formatPercent(dominantMix.share)}` : ''}, pulling this toward Infra.`;
    } else if (axis.id === 'whenYouBuild') {
      meaning = axis.letter === 'O' ? 'Owl' : 'Lark';
      impact = axis.letter === 'O'
        ? `${formatPercent(activity.nightShare)} of activity lands in late-night hours, pulling this toward Owl.`
        : `${formatPercent(activity.dayShare)} of activity lands in daytime hours, pulling this toward Lark.`;
    } else if (axis.id === 'howYouEcosystem') {
      meaning = axis.letter === 'H' ? 'Hoarder' : 'Wolf';
      impact = axis.letter === 'H'
        ? `${installed} installed/available tool(s) with ${formatPercent(coverage)} observed usage coverage pulls this toward Hoarder.`
        : `${formatPercent(coverage)} observed usage coverage across ${installed} installed/available tool(s) pulls this toward Wolf.`;
    }
    return {
      axisId: axis.id,
      label: axis.label,
      letter: axis.letter,
      meaning,
      impact,
      evidence: (axis.evidence || []).slice(0, 3),
    };
  });
}

function derivePersonaTraits(signals, axes, rules = DEFAULT_PERSONA_RULES) {
  const traits = [];
  const traitRules = rules.traits || DEFAULT_PERSONA_RULES.traits;
  if (!Object.keys(traitRules || {}).length) return traits;
  const traitRule = (id) => asRecord(traitRules?.[id]);
  const numberOption = (rule, key, fallback) => {
    const value = Number(rule?.[key]);
    return Number.isFinite(value) ? value : fallback;
  };
  const activity = signals.activity || createEmptyActivitySummary();
  const usagePeriod = signals.period?.label || 'selected period';
  const usageTokens = Number(signals?.usage?.totalTokens) || 0;
  const ecosystem = signals.ecosystem || {};
  const external = signals.external || createEmptyCreatorMetrics();
  const toolUsage = signals.toolUsage || createEmptyToolUsageSummary();
  const behavior = signals.behaviorProfile || createEmptyBehaviorProfile(signals.period?.id, signals.period?.label);
  const workspaces = signals.workspaces || createEmptyWorkspaceSummary();
  const git = signals.git || {};
  const stack = signals.stack || {};
  const promptStyle = signals.promptStyle || createEmptyPromptStyleSummary(false);
  const behaviorMixShare = (categories) => (behavior.topToolsMix || [])
    .filter((item) => categories.includes(item.category))
    .reduce((sum, item) => sum + (Number(item.share) || 0), 0);
  const add = (id, rule, evidence, fallbackConfidence = 0.7) => {
    const label = cleanText(rule?.label, 80) || id;
    const category = cleanText(rule?.category, 80) || 'Trait';
    const confidence = Number.isFinite(rule?.confidence) ? rule.confidence : fallbackConfidence;
    traits.push({ id, label, category, evidence, confidence: round(confidence, 2) });
  };

  const tokenTycoonRule = traitRule('tokenTycoon');
  const highVoltageRule = traitRule('highVoltage');
  if (
    tokenTycoonRule &&
    (usageTokens >= numberOption(tokenTycoonRule, 'threshold', 1000000000) ||
      isMetricTopPercent(external, 'tokens', numberOption(tokenTycoonRule, 'maxTopPercent', 5) / 100))
  ) {
    const topPercent = metricTopPercent(external, 'tokens');
    add('token-tycoon', tokenTycoonRule, topPercent
      ? topPercentEvidence('token usage', topPercent)
      : `${formatNumber(usageTokens)} local-token estimate in ${usagePeriod}`, 0.72);
  } else if (highVoltageRule && usageTokens >= numberOption(highVoltageRule, 'threshold', 100000000)) {
    add('high-voltage', highVoltageRule, `${formatNumber(usageTokens)} local-token estimate in ${usagePeriod}`, 0.64);
  }
  const flowStateRule = traitRule('flowState');
  const slowCookRule = traitRule('slowCook');
  const continuousActiveMinutes = Math.max(0, Number(activity.longestContinuousActiveMinutes) || 0);
  const continuousIdleMinutes = Math.max(1, Number(activity.continuousActivityIdleMinutes) || 30);
  if (flowStateRule && continuousActiveMinutes >= numberOption(flowStateRule, 'thresholdMinutes', 360)) {
    add('flow-state', flowStateRule, `${continuousActiveMinutes}m longest continuous active span (${continuousIdleMinutes}m idle cutoff)`, 0.78);
  } else if (slowCookRule && continuousActiveMinutes >= numberOption(slowCookRule, 'thresholdMinutes', 240)) {
    add('slow-cook', slowCookRule, `${continuousActiveMinutes}m longest continuous active span (${continuousIdleMinutes}m idle cutoff)`, 0.72);
  }
  const snackCoderRule = traitRule('snackCoder');
  if (
    snackCoderRule &&
    activity.medianSessionMinutes > 0 &&
    activity.medianSessionMinutes <= numberOption(snackCoderRule, 'maxMedianMinutes', 15) &&
    activity.snackSessionCount >= numberOption(snackCoderRule, 'minShortSessions', 4)
  ) {
    add('snack-coder', snackCoderRule, `${activity.snackSessionCount} short session(s), ${activity.medianSessionMinutes}m median`, 0.66);
  }
  const speedDemonRule = traitRule('speedDemon');
  if (
    speedDemonRule &&
    activity.medianGapMinutes > 0 &&
    activity.medianGapMinutes <= numberOption(speedDemonRule, 'maxMedianGapMinutes', 20) &&
    activity.activeEventCount >= numberOption(speedDemonRule, 'minActiveEvents', 12)
  ) {
      add('speed-demon', speedDemonRule, `${activity.medianGapMinutes}m median gap between sessions`, 0.62);
  }
  const diceRollerRule = traitRule('diceRoller');
  if (
    diceRollerRule &&
    (behavior.steeringRatio || 0) >= numberOption(diceRollerRule, 'minSteeringRatio', 0.75) &&
    (behavior.steeringTurnCount || 0) >= numberOption(diceRollerRule, 'minSteeringTurns', 30) &&
    (behavior.planningRatio || 0) <= numberOption(diceRollerRule, 'maxPlanningRatio', 0.3)
  ) {
    add('dice-roller', diceRollerRule, `${formatPercent(behavior.steeringRatio)} steering ratio across ${behavior.steeringTurnCount || 0} refinement turn(s)`, 0.58);
  }
  const toolSommelierRule = traitRule('toolSommelier');
  if (toolSommelierRule && (toolUsage.topTools || []).length >= numberOption(toolSommelierRule, 'minDistinctTools', 8)) {
    add('tool-sommelier', toolSommelierRule, `${toolUsage.topTools.length} distinct called tools`, 0.66);
  }
  const toolHoarderRule = traitRule('toolHoarder') || traitRule('boxcar');
  const installedToolCount = ecosystem.installedToolCount || 0;
  const installedUsageCoverage = installedToolCount > 0
    ? (toolUsage.usedInstalledToolCount || 0) / installedToolCount
    : 0;
  if (
    toolHoarderRule &&
    installedToolCount >= numberOption(toolHoarderRule, 'minInstalledTools', 50) &&
    installedUsageCoverage <= numberOption(toolHoarderRule, 'maxUsageCoverage', 0.4)
  ) {
    add('tool-hoarder', toolHoarderRule, `${installedToolCount} detected tools, ${formatPercent(installedUsageCoverage)} observed usage coverage`, 0.68);
  }
  const starMagnetRule = traitRule('starMagnet');
  if (starMagnetRule && (external.github?.maxRepoStars || 0) >= numberOption(starMagnetRule, 'minMaxRepoStars', 1000)) {
    add('star-magnet', starMagnetRule, `${formatNumber(external.github.maxRepoStars)} stars on top public repo`, 0.76);
  }
  const ossBuffRule = traitRule('ossBuff');
  if (ossBuffRule && (external.github?.publicRepoCount || 0) >= numberOption(ossBuffRule, 'minPublicRepos', 10)) {
    add('oss-buff', ossBuffRule, `${formatNumber(external.github.publicRepoCount)} public repo(s)`, 0.66);
  }
  const helperRule = traitRule('helper');
  if (helperRule && (external.taku?.skillInstallCount || 0) >= numberOption(helperRule, 'minSkillInstalls', 100)) {
    add('helper', helperRule, `${formatNumber(external.taku.skillInstallCount)} skill install(s)`, 0.7);
  }
  const prolificAuthorRule = traitRule('prolificAuthor');
  if (prolificAuthorRule && (external.taku?.skillCount || 0) >= numberOption(prolificAuthorRule, 'minSkillCount', 10)) {
    add('prolific-author', prolificAuthorRule, `${formatNumber(external.taku.skillCount)} published skill(s)`, 0.66);
  }
  const privateCoderRule = traitRule('privateCoder');
  const repoCount = external.github?.repoCount || ((external.github?.publicRepoCount || 0) + (external.github?.privateRepoCount || 0));
  const privateRepoShare = repoCount > 0 ? (external.github?.privateRepoCount || 0) / repoCount : 0;
  if (
    privateCoderRule &&
    repoCount >= numberOption(privateCoderRule, 'minRepoCount', 3) &&
    privateRepoShare >= numberOption(privateCoderRule, 'minPrivateRepoShare', 0.8)
  ) {
    add('private-coder', privateCoderRule, `${formatPercent(privateRepoShare)} private repo share`, 0.62);
  }
  const worldBuilderRule = traitRule('worldBuilder');
  const referenceCount = Math.max(external.taku?.toolReferenceCount || 0, external.taku?.skillReferenceCount || 0);
  if (worldBuilderRule && referenceCount >= numberOption(worldBuilderRule, 'minReferenceCount', 10)) {
    add('world-builder', worldBuilderRule, `${formatNumber(referenceCount)} tool/skill reference(s)`, 0.66);
  }
  const showOffRule = traitRule('showOff');
  if (showOffRule && (external.taku?.shareCount || 0) >= numberOption(showOffRule, 'minShareCount', 5)) {
    add('show-off', showOffRule, `${formatNumber(external.taku.shareCount)} Stax/social share(s)`, 0.6);
  }
  const betaTesterRule = traitRule('betaTester');
  if (betaTesterRule && external.taku?.betaTester) {
    add('beta-tester', betaTesterRule, 'Beta participation confirmed by Taku creator metrics', 0.72);
  }
  const aestheteRule = traitRule('aesthete');
  if (
    aestheteRule &&
    (stack.uiFileCount || 0) >= numberOption(aestheteRule, 'minUiFileCount', 80) &&
    (stack.uiFileRatio || 0) >= numberOption(aestheteRule, 'minUiFileRatio', 0.06) &&
    (stack.uiFileRatio || 0) > (stack.infraFileRatio || 0)
  ) {
    add('aesthete', aestheteRule, `${formatNumber(stack.uiFileCount || 0)} UI/style file(s), ${formatPercent(stack.uiFileRatio)} UI share`, 0.6);
  }
  const planningHeavyRule = traitRule('planningHeavy');
  if (planningHeavyRule && (behavior.planningRatio || 0) >= numberOption(planningHeavyRule, 'minPlanningRatio', 0.45)) {
    add('planning-heavy', planningHeavyRule, `${formatPercent(behavior.planningRatio)} planning-first session ratio`, 0.66);
  }
  const steeringConductorRule = traitRule('steeringConductor');
  if (steeringConductorRule && (behavior.steeringRatio || 0) >= numberOption(steeringConductorRule, 'minSteeringRatio', 0.35)) {
    add('steering-conductor', steeringConductorRule, `${formatPercent(behavior.steeringRatio)} steering ratio, ${behavior.steeringTurnCount || 0} steering turn(s)`, 0.64);
  }
  const autonomousRunnerRule = traitRule('autonomousRunner');
  if (autonomousRunnerRule && (behavior.autonomyScore || 0) >= numberOption(autonomousRunnerRule, 'minAutonomyScore', 0.6)) {
    add('autonomous-runner', autonomousRunnerRule, `autonomy score ${behavior.autonomyScore}, ${behavior.medianToolRunLength || 0} median tool-call run`, 0.64);
  }
  const shellMix = (behavior.topToolsMix || []).find((item) => item.category === 'shell');
  const shellOperatorRule = traitRule('shellOperator');
  if (shellOperatorRule && (shellMix?.share || 0) >= numberOption(shellOperatorRule, 'minShellShare', 0.45)) {
    add('shell-operator', shellOperatorRule, `${formatPercent(shellMix.share)} shell/tool execution share`, 0.6);
  }
  const owlAxis = axes.find((axis) => axis.id === 'whenYouBuild');
  const nightShiftRule = traitRule('nightShift');
  if (nightShiftRule && owlAxis?.letter === 'O' && owlAxis.score >= numberOption(nightShiftRule, 'minOwlScore', 0.66)) {
    add('night-shift', nightShiftRule, `Owl score ${owlAxis.score}`, 0.7);
  }
  const iterationFreakRule = traitRule('iterationFreak');
  if (iterationFreakRule && (workspaces.reopenCount || 0) >= numberOption(iterationFreakRule, 'minReopenCount', 20)) {
    add('iteration-freak', iterationFreakRule, `${workspaces.reopenCount} workspace reopen/session return(s)`, 0.68);
  }
  const reArchitectRule = traitRule('reArchitect');
  if (
    reArchitectRule &&
    (git.branchCount || 0) >= numberOption(reArchitectRule, 'minBranchCount', 6) &&
    (git.dirtyFileCount || 0) >= numberOption(reArchitectRule, 'minDirtyFiles', 20)
  ) {
    add('re-architect', reArchitectRule, `${git.branchCount} branch(es), ${git.dirtyFileCount} dirty file(s)`, 0.62);
  }
  const selfReflectorRule = traitRule('selfReflector');
  if (
    selfReflectorRule &&
    (workspaces.reopenCount || 0) >= numberOption(selfReflectorRule, 'minReopenCount', 30) &&
    (git.maxUncommittedDays || 0) >= numberOption(selfReflectorRule, 'minMaxUncommittedDays', 30)
  ) {
    add('self-reflector', selfReflectorRule, `${workspaces.reopenCount} workspace return(s), ${git.maxUncommittedDays}d oldest local WIP`, 0.6);
  }
  const oneShotShipperRule = traitRule('oneShotShipper');
  if (
    oneShotShipperRule &&
    (git.commitCount || 0) >= numberOption(oneShotShipperRule, 'minCommitCount', 3) &&
    (git.dirtyFileCount || 0) <= numberOption(oneShotShipperRule, 'maxDirtyFiles', 2) &&
    (git.branchCount || 0) <= numberOption(oneShotShipperRule, 'maxBranchCount', 2)
  ) {
    add('one-shot-shipper', oneShotShipperRule, `${git.commitCount} commit(s), ${git.dirtyFileCount || 0} dirty file(s)`, 0.58);
  }
  const polisherRule = traitRule('polisher');
  if (
    polisherRule &&
    (stack.scannedFileCount || 0) >= numberOption(polisherRule, 'minScannedFiles', 30) &&
    (stack.uiFileRatio || 0) >= numberOption(polisherRule, 'minUiFileRatio', 0.32) &&
    (stack.uiFileRatio || 0) > (stack.infraFileRatio || 0)
  ) {
    add('polisher', polisherRule, `${formatPercent(stack.uiFileRatio)} UI/style file share`, 0.6);
  }
  const polyglotRule = traitRule('polyglot');
  if (polyglotRule && (stack.languageCount || 0) >= numberOption(polyglotRule, 'minLanguages', 5)) {
    add('polyglot', polyglotRule, `${stack.languageCount} detected file type(s)`, 0.66);
  }
  const docDevourerRule = traitRule('docDevourer');
  const readSearchShare = behaviorMixShare(['read', 'search']);
  if (
    docDevourerRule &&
    (stack.docFileCount || 0) >= numberOption(docDevourerRule, 'minDocFileCount', 80) &&
    readSearchShare >= numberOption(docDevourerRule, 'minReadSearchShare', 0.025)
  ) {
    add('doc-devourer', docDevourerRule, `${formatNumber(stack.docFileCount || 0)} doc-like file(s), ${formatPercent(readSearchShare)} read/search tool mix`, 0.6);
  }
  const monoStackRule = traitRule('monoStack');
  if (
    monoStackRule &&
    (stack.topLanguageShare || 0) >= numberOption(monoStackRule, 'minTopLanguageShare', 0.9) &&
    (stack.scannedFileCount || 0) >= numberOption(monoStackRule, 'minTotalFiles', 30)
  ) {
    add('mono-stack', monoStackRule, `${formatPercent(stack.topLanguageShare)} top language share`, 0.6);
  }
  const wipHeavyRule = traitRule('wipHeavy');
  if (
    wipHeavyRule &&
    ((git.dirtyRepoCount || 0) >= numberOption(wipHeavyRule, 'minDirtyRepos', 3) ||
      (git.dirtyFileCount || 0) >= numberOption(wipHeavyRule, 'minDirtyFiles', 20))
  ) {
    add('wip-heavy', wipHeavyRule, `${git.dirtyRepoCount || 0} dirty repo(s), ${git.dirtyFileCount || 0} dirty file(s)`, 0.56);
  }
  if (promptStyle.enabled) {
    const promptCount = promptStyle.analyzedPromptCount || promptStyle.promptCount || 0;
    const promptEvidence = (count, label, share) => `${formatNumber(count)} ${label} across ${formatNumber(promptCount)} local prompt(s)${Number.isFinite(share) ? ` (${formatPercent(share)})` : ''}`;
    const gratefulCoderRule = traitRule('gratefulCoder');
    if (
      gratefulCoderRule &&
      promptCount >= numberOption(gratefulCoderRule, 'minPromptCount', 8) &&
      (promptStyle.gratitudeCount || 0) >= numberOption(gratefulCoderRule, 'minGratitudeCount', 3) &&
      (promptStyle.gratitudeShare || 0) >= numberOption(gratefulCoderRule, 'minGratitudeShare', 0.16)
    ) {
      add('grateful-coder', gratefulCoderRule, promptEvidence(promptStyle.gratitudeCount || 0, 'gratitude marker prompt(s)', promptStyle.gratitudeShare), 0.62);
    }
    const cinematicPrompterRule = traitRule('cinematicPrompter');
    if (
      cinematicPrompterRule &&
      promptCount >= numberOption(cinematicPrompterRule, 'minPromptCount', 5) &&
      (promptStyle.cinematicCount || 0) >= numberOption(cinematicPrompterRule, 'minCinematicCount', 2) &&
      ((promptStyle.longPromptShare || 0) >= numberOption(cinematicPrompterRule, 'minLongPromptShare', 0.25) ||
        (promptStyle.averageChars || 0) >= numberOption(cinematicPrompterRule, 'minAverageChars', 500))
    ) {
      add('cinematic-prompter', cinematicPrompterRule, `${formatNumber(promptStyle.averageChars || 0)} average prompt chars, ${formatPercent(promptStyle.longPromptShare || 0)} long prompt share`, 0.62);
    }
    const promptWizardRule = traitRule('promptWizard');
    if (
      promptWizardRule &&
      promptCount >= numberOption(promptWizardRule, 'minPromptCount', 5) &&
      (promptStyle.complexStepCount || 0) >= numberOption(promptWizardRule, 'minComplexStepCount', 3) &&
      (promptStyle.complexStepShare || 0) >= numberOption(promptWizardRule, 'minComplexStepShare', 0.18)
    ) {
      add('prompt-wizard', promptWizardRule, promptEvidence(promptStyle.complexStepCount || 0, 'structured/multi-step prompt(s)', promptStyle.complexStepShare), 0.66);
    }
    const codeRoasterRule = traitRule('codeRoaster');
    if (
      codeRoasterRule &&
      promptCount >= numberOption(codeRoasterRule, 'minPromptCount', 8) &&
      (promptStyle.roastCount || 0) >= numberOption(codeRoasterRule, 'minRoastCount', 2) &&
      (promptStyle.roastShare || 0) >= numberOption(codeRoasterRule, 'minRoastShare', 0.08)
    ) {
      add('code-roaster', codeRoasterRule, promptEvidence(promptStyle.roastCount || 0, 'code-roast prompt(s)', promptStyle.roastShare), 0.58);
    }
    const spicyPrompterRule = traitRule('spicyPrompter');
    if (
      spicyPrompterRule &&
      promptCount >= numberOption(spicyPrompterRule, 'minPromptCount', 8) &&
      (promptStyle.spicyCount || 0) >= numberOption(spicyPrompterRule, 'minSpicyCount', 2) &&
      (promptStyle.spicyShare || 0) >= numberOption(spicyPrompterRule, 'minSpicyShare', 0.08)
    ) {
      add('spicy-prompter', spicyPrompterRule, promptEvidence(promptStyle.spicyCount || 0, 'spicy-tone prompt(s)', promptStyle.spicyShare), 0.58);
    }
  }
  return traits.slice(0, 16);
}

function deriveHiddenCandidates(signals, axes, rules = DEFAULT_PERSONA_RULES) {
  const hidden = [];
  const hiddenRules = rules.hidden || DEFAULT_PERSONA_RULES.hidden;
  const activity = signals.activity || createEmptyActivitySummary();
  const workspaces = signals.workspaces || createEmptyWorkspaceSummary();
  const ecosystem = signals.ecosystem || {};
  const external = signals.external || createEmptyCreatorMetrics();
  const git = signals.git || {};
  const add = (id, rule, trigger, fallbackConfidence) => {
    const title = cleanText(rule?.title, 120) || id;
    const subtitle = cleanText(rule?.subtitle, 120) || '';
    const description = cleanText(rule?.description, 240) || '';
    const triggerText = cleanText(rule?.trigger, 180) || trigger;
    const confidence = Number.isFinite(rule?.confidence) ? rule.confidence : fallbackConfidence;
    hidden.push({
      id,
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(description ? { description } : {}),
      trigger: triggerText,
      confidence: round(confidence, 2),
    });
  };
  if ((external.taku?.skillInstallCount || 0) >= 1000) {
    add('architect', hiddenRules.architect, `${formatNumber(external.taku.skillInstallCount)} skill install(s)`, 0.95);
  }
  if (
    ((external.taku?.registrationRank || 0) > 0 && external.taku.registrationRank <= 100) &&
    external.taku?.activeInLast30Days
  ) {
    add('oracle', hiddenRules.oracle, `registered #${external.taku.registrationRank} and active in last 30 days`, 0.9);
  }
  const trustedReferenceCount = external.taku?.trustedCreatorReferenceCount || 0;
  if (trustedReferenceCount >= 50) {
    add('demiurge', hiddenRules.demiurge, `${formatNumber(trustedReferenceCount)} trusted creator reference(s)`, 0.92);
  }
  const sovereignTopMetrics = ['tokens', 'stars', 'installs', 'subscribers']
    .filter((metric) => isMetricTopPercent(external, metric, 0.01));
  if (sovereignTopMetrics.length >= 4) {
    add('sovereign', hiddenRules.sovereign, 'tokens, stars, installs, and subscribers are all top 1%', 0.96);
  }
  const publicOutputCount = (external.github?.publicRepoCount || 0) + (external.taku?.skillCount || 0);
  if (isMetricTopPercent(external, 'tokens', 0.1) && publicOutputCount === 0) {
    add('phantom', hiddenRules.phantom, 'token usage top 10% with zero public repo/skill output', 0.7);
  }
  if (activity.nightShare >= 0.25 && activity.dayShare >= 0.35 && activity.activeEventCount >= 12) {
    add('insomniac-daywalker', hiddenRules.insomniacDaywalker, 'High activity in both late-night and daytime windows', 0.68);
  }
  if ((workspaces.activeWorkspaceCount >= 10 && workspaces.topWorkspaceSessionShare <= 0.35) || (git.dirtyRepoCount >= 3 && git.dirtyFileCount >= 20)) {
    add('schrodingers-coder', hiddenRules.schrodingersCoder, `${workspaces.activeWorkspaceCount} active workspace(s), ${git.dirtyRepoCount || 0} dirty repo(s)`, 0.62);
  }
  const balancedAxes = axes.filter((axis) => axis.score >= 0.4 && axis.score <= 0.6);
  if (balancedAxes.length >= 3 && axes.every((axis) => axis.confidence >= 0.35)) {
    add('polymath', hiddenRules.polymath, `${balancedAxes.length} axes are close to center`, 0.58);
  }
  return hidden;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value * 100)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}
