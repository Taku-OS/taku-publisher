import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { composeUsageSummary } from '#taku-passport-core';
import {
  exists,
  getHomeDir,
  normalizeChoiceToken,
  normalizeUsagePeriodId,
  stableId,
} from './cli.mjs';
import { readJsonFile } from './draft-state.mjs';
import { cleanText } from './privacy.mjs';

export { composeUsageSummary } from '#taku-passport-core';
import {
  createEmptyEstimatedCostSummary,
  estimateUsageCostForModel,
  sanitizeModelId,
  summarizeEstimatedCost,
} from './usage-pricing.mjs';

// Keep host/onboarding scans deterministic even when a local session history
// contains multi-gigabyte JSONL files. The scan returns a partial, recent sample
// when any budget is reached instead of blocking the surrounding workflow.
export const DEFAULT_MAX_USAGE_FILES = 2500;
export const DEFAULT_MAX_USAGE_BYTES = 128 * 1024 * 1024;
export const DEFAULT_MAX_USAGE_FILE_BYTES = 160 * 1024;
export const DEFAULT_USAGE_SCAN_TIMEOUT_MS = 15_000;
export const DEFAULT_USAGE_PERIOD_ID = 'last90Days';
export const CONTINUOUS_ACTIVITY_IDLE_MINUTES = 30;
const DEFAULT_MAX_PROMPT_STYLE_CHARS = 20000;
const BEHAVIOR_PROFILE_SCHEMA = 'taku.creator.behavior-profile.v1';
const MODEL_USAGE_SCHEMA = 'taku.creator.model-usage.v1';
const MODEL_USAGE_KEYS = new Set([
  'actualmodel',
  'chatmodel',
  'completionmodel',
  'configuredmodel',
  'defaultmodel',
  'deployment',
  'deploymentname',
  'engine',
  'engineid',
  'fallbackmodel',
  'llmmodel',
  'model',
  'modeldeployment',
  'modeldisplayname',
  'modelfamily',
  'modelid',
  'modelname',
  'modelpath',
  'modelslug',
  'modelversion',
  'providermodel',
  'requestedmodel',
  'selectedmodel',
]);
const MODEL_PROVIDER_KEYS = new Set(['modelprovider', 'provider']);
const MODEL_SCAN_SKIP_KEYS = new Set([
  'args',
  'arguments',
  'body',
  'command',
  'commands',
  'content',
  'input',
  'inputs',
  'output',
  'outputs',
  'prompt',
  'prompts',
  'text',
  'transcript',
]);

const USAGE_SOURCES = [
  { source: 'codex', label: 'Codex', root: ['.codex', 'sessions'], maxDepth: 5, extensions: ['.jsonl'] },
  { source: 'codex', label: 'Codex', root: ['.codex', 'archived_sessions'], maxDepth: 1, extensions: ['.jsonl'] },
  { source: 'claude-code', label: 'Claude Code', base: 'claude-config', root: ['projects'], maxDepth: 4, extensions: ['.jsonl'], usageRole: 'transcript' },
  { source: 'claude-code', label: 'Claude Code', base: 'claude-config', root: ['history.jsonl'], maxDepth: 0, extensions: ['.jsonl'], usageRole: 'history' },
  { source: 'claude-code', label: 'Claude Code', base: 'claude-config', root: ['stats-cache.json'], maxDepth: 0, extensions: ['.json'], usageRole: 'aggregate-fallback' },
  { source: 'cursor', label: 'Cursor', root: ['.cursor', 'projects'], maxDepth: 5, extensions: ['.jsonl', '.json'] },
  { source: 'gemini-cli', label: 'Gemini CLI', root: ['.gemini', 'tmp'], maxDepth: 4, extensions: ['.jsonl', '.json'] },
];
const SKIPPED_USAGE_DIRS = new Set(['.cache', '.git', 'cache', 'dist', 'node_modules', 'out']);
export const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4]);
export const DAY_HOURS = new Set([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value * 100)}%`;
}

function formatModelUsagePercent(value) {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  const percent = value * 100;
  if (percent < 0.1) return '<0.1%';
  const rounded = round(percent, 1);
  return `${Number.isInteger(rounded) ? Math.round(rounded) : rounded}%`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createEmptyUsageSummary(usagePeriodId = DEFAULT_USAGE_PERIOD_ID) {
  const period = selectUsagePeriod(buildUsagePeriods(new Date()), usagePeriodId);
  return {
    scanned: false,
    primaryPeriodId: period.id,
    periodLabel: period?.label || 'Last 90 Days',
    startsAt: period?.startsAt,
    endsAt: period?.endsAt,
    scannedFileCount: 0,
    sessionCount: 0,
    eventCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalReasoningTokens: 0,
    totalTokens: 0,
    sources: [],
    periods: [],
    activity: createEmptyActivitySummary(),
    workspaces: createEmptyWorkspaceSummary(),
    toolUsage: createEmptyToolUsageSummary(),
    modelUsage: createEmptyModelUsageSummary(),
    estimatedCost: createEmptyEstimatedCostSummary(),
    localActivity: createEmptyLocalActivitySummary(),
    behaviorProfile: createEmptyBehaviorProfile(period.id, period.label),
    behaviorProfileV1: createEmptyBehaviorProfile(period.id, period.label),
    promptStyle: createEmptyPromptStyleSummary(false),
    partial: false,
    scanCoverage: {
      partial: false,
      candidateFileCount: 0,
      scannedFileCount: 0,
      sampledFileCount: 0,
      oversizedJsonFileCount: 0,
      scannedByteCount: 0,
      periodFiltered: false,
    },
    warnings: [],
  };
}

export async function scanUsage(options = {}) {
  const maxFiles = positiveInteger(options.maxFiles, DEFAULT_MAX_USAGE_FILES);
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_USAGE_BYTES);
  const maxFileBytes = Math.min(
    maxBytes,
    positiveInteger(options.maxFileBytes, DEFAULT_MAX_USAGE_FILE_BYTES),
  );
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_USAGE_SCAN_TIMEOUT_MS);
  const usagePeriodId = normalizeUsagePeriodId(options.usagePeriodId);
  const now = options.now instanceof Date ? options.now : new Date();
  const selectedPeriod = selectUsagePeriod(buildUsagePeriods(now), usagePeriodId);
  const relevantAfterMs = selectedPeriod.startsAt
    ? new Date(selectedPeriod.startsAt).getTime()
    : undefined;
  const deadlineMs = Date.now() + timeoutMs;
  const records = [];
  const availability = new Map();
  const warnings = [];
  let scannedFileCount = 0;
  let scannedByteCount = 0;
  let sampledFileCount = 0;
  let oversizedJsonFileCount = 0;
  let candidateFileCount = 0;
  let stoppedReason;
  const candidatesBySource = new Map();
  const seenCandidatePaths = new Set();

  for (const spec of buildUsageSpecs({
    homeDir: options.homeDir,
    claudeConfigDir: options.claudeConfigDir,
  })) {
    const sourceAvailability = ensureUsageAvailability(availability, spec.source, spec.label);
    const rootExists = await exists(spec.root);
    sourceAvailability.available = sourceAvailability.available || rootExists;
    if (!rootExists) continue;
    if (Date.now() >= deadlineMs) {
      stoppedReason = 'time';
      break;
    }
    const collected = await collectUsageFiles(spec, maxFiles, {
      deadlineMs,
      relevantAfterMs,
    });
    if (collected.timedOut) stoppedReason = 'time';
    const sourceCandidates = candidatesBySource.get(spec.source) || [];
    for (const candidate of collected.files) {
      if (seenCandidatePaths.has(candidate.filePath)) continue;
      seenCandidatePaths.add(candidate.filePath);
      sourceCandidates.push({
        ...candidate,
        source: spec.source,
        label: spec.label,
        usageRole: spec.usageRole,
      });
    }
    candidatesBySource.set(spec.source, sourceCandidates);
  }

  for (const [source, sourceCandidates] of candidatesBySource.entries()) {
    const hasDetailedTranscript = sourceCandidates.some((candidate) => candidate.usageRole === 'transcript');
    const candidates = hasDetailedTranscript
      ? sourceCandidates.filter((candidate) => candidate.usageRole !== 'aggregate-fallback')
      : sourceCandidates;
    candidates.sort(compareUsageCandidates);
    candidatesBySource.set(source, candidates);
    candidateFileCount += candidates.length;
  }
  const candidates = interleaveUsageCandidates(candidatesBySource, maxFiles);

  for (const candidate of candidates) {
    if (Date.now() >= deadlineMs) {
      stoppedReason = 'time';
      break;
    }
    if (scannedFileCount >= maxFiles) {
      stoppedReason = 'files';
      break;
    }
    const remainingBytes = maxBytes - scannedByteCount;
    if (remainingBytes <= 0) {
      stoppedReason = 'bytes';
      break;
    }
    const fileByteBudget = Math.min(maxFileBytes, remainingBytes);
    try {
      const fileUsage = await readUsageFile(candidate.filePath, {
        includePromptStyle: Boolean(options.includePromptStyle),
        fileSize: candidate.size,
        maxBytes: fileByteBudget,
      });
      scannedFileCount += 1;
      scannedByteCount += Math.max(0, Number(fileUsage.__scanBytes) || 0);
      if (fileUsage.__partialSample) sampledFileCount += 1;
      if (fileUsage.__skippedReason === 'oversized_json') oversizedJsonFileCount += 1;
      if (fileUsage.eventCount > 0 || fileUsage.totals.totalTokens > 0) {
        records.push({
          source: candidate.source,
          label: candidate.label,
          sourceFileId: candidate.filePath,
          file: fileUsage,
        });
      }
    } catch (error) {
      warnings.push(`Failed to read usage log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!stoppedReason && candidates.length < candidateFileCount) stoppedReason = 'files';
  if (!stoppedReason && scannedByteCount >= maxBytes) stoppedReason = 'bytes';
  const partial = Boolean(stoppedReason || sampledFileCount || oversizedJsonFileCount);
  if (stoppedReason === 'time') {
    warnings.push(`Stopped usage scan after reaching the ${timeoutMs}ms time budget.`);
  } else if (stoppedReason === 'bytes') {
    warnings.push(`Stopped usage scan after reading ${formatBytes(maxBytes)}.`);
  } else if (stoppedReason === 'files') {
    warnings.push(`Stopped usage scan after reaching --max-usage-files ${maxFiles}.`);
  }
  if (sampledFileCount > 0) {
    warnings.push(`Read bounded heads and recent tails from ${sampledFileCount} oversized JSONL usage log(s).`);
  }
  if (oversizedJsonFileCount > 0) {
    warnings.push(`Skipped ${oversizedJsonFileCount} oversized JSON usage log(s) that cannot be safely tail-sampled.`);
  }

  const availableSources = Array.from(availability.values());
  const periods = buildUsagePeriods(now).map((period) => summarizeUsagePeriod(records, availableSources, period));
  const primary = selectUsagePeriod(periods, usagePeriodId);
  const personaUsage = summarizePersonaUsagePeriod(records, primary, now);
  const result = composeUsageSummary({
    primary: {
      ...primary,
      modelUsage: primary.modelUsage || createEmptyModelUsageSummary(),
      estimatedCost:
        primary.estimatedCost || createEmptyEstimatedCostSummary(),
    },
    periods,
    personaUsage,
    warnings,
    privateWorkspaceKeys: records.map((record) =>
      normalizeWorkspaceKey(record.file?.__workspaceKey)),
  });
  result.partial = partial;
  result.scanCoverage = {
    partial,
    stoppedReason,
    candidateFileCount,
    scannedFileCount,
    sampledFileCount,
    oversizedJsonFileCount,
    scannedByteCount,
    maxFiles,
    maxBytes,
    maxFileBytes,
    timeoutMs,
    periodFiltered: Number.isFinite(relevantAfterMs),
  };
  return result;
}

function buildUsageSpecs(options = {}) {
  const home = options.homeDir || getHomeDir();
  const configuredClaudeRoot = options.claudeConfigDir ||
    (!options.homeDir ? process.env.CLAUDE_CONFIG_DIR : undefined);
  const claudeRoot = configuredClaudeRoot
    ? path.resolve(configuredClaudeRoot)
    : path.join(home, '.claude');
  return USAGE_SOURCES.map((spec) => ({
    ...spec,
    root: path.join(spec.base === 'claude-config' ? claudeRoot : home, ...spec.root),
  }));
}

export function buildUsagePeriods(now) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last7DaysStart = new Date(todayStart);
  last7DaysStart.setDate(todayStart.getDate() - 6);
  const last30DaysStart = new Date(todayStart);
  last30DaysStart.setDate(todayStart.getDate() - 29);
  const last90DaysStart = new Date(todayStart);
  last90DaysStart.setDate(todayStart.getDate() - 89);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const endsAt = now.toISOString();
  return [
    { id: 'today', label: 'Today', startsAt: todayStart.toISOString(), endsAt },
    { id: 'last7Days', label: 'Last 7 Days', startsAt: last7DaysStart.toISOString(), endsAt },
    { id: 'last30Days', label: 'Last 30 Days', startsAt: last30DaysStart.toISOString(), endsAt },
    { id: 'last90Days', label: 'Last 90 Days', startsAt: last90DaysStart.toISOString(), endsAt },
    { id: 'thisMonth', label: 'This Month', startsAt: monthStart.toISOString(), endsAt },
    { id: 'allTimeLocal', label: 'All-Time Local', endsAt },
  ];
}

export function selectUsagePeriod(periods, usagePeriodId) {
  const normalized = normalizeUsagePeriodId(usagePeriodId);
  const selected = periods.find((period) => period.id === normalized);
  if (!selected) {
    throw new Error(`Invalid usage period "${usagePeriodId}". Use one of: today, last7Days, last30Days, last90Days, thisMonth, allTimeLocal.`);
  }
  return selected;
}

async function collectUsageFiles(spec, remaining, options = {}) {
  if (remaining <= 0) return { files: [], timedOut: false };
  let stat;
  try {
    stat = await fs.stat(spec.root);
  } catch {
    return { files: [], timedOut: false };
  }
  if (stat.isFile()) {
    const matchesPeriod = !Number.isFinite(options.relevantAfterMs) || stat.mtimeMs >= options.relevantAfterMs;
    return {
      files: matchesExtension(spec.root, spec.extensions) && matchesPeriod
        ? [{ filePath: spec.root, mtimeMs: stat.mtimeMs, size: stat.size }]
        : [],
      timedOut: false,
    };
  }
  if (!stat.isDirectory()) return { files: [], timedOut: false };

  const files = [];
  let timedOut = false;
  const candidateLimit = Math.max(remaining, Math.min(DEFAULT_MAX_USAGE_FILES * 10, remaining * 10, 1000));
  async function walk(current, depth) {
    if (files.length >= candidateLimit || timedOut) return;
    if (Number.isFinite(options.deadlineMs) && Date.now() >= options.deadlineMs) {
      timedOut = true;
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of entries) {
      if (files.length >= candidateLimit || timedOut) return;
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth >= spec.maxDepth || SKIPPED_USAGE_DIRS.has(entry.name)) continue;
        await walk(nextPath, depth + 1);
        continue;
      }
      if (entry.isFile() && matchesExtension(nextPath, spec.extensions)) {
        try {
          const entryStat = await fs.stat(nextPath);
          if (!Number.isFinite(options.relevantAfterMs) || entryStat.mtimeMs >= options.relevantAfterMs) {
            files.push({ filePath: nextPath, mtimeMs: entryStat.mtimeMs, size: entryStat.size });
          }
        } catch {
          // Ignore files that disappear while the local scan is running.
        }
      }
    }
  }
  await walk(spec.root, 0);
  return {
    files: files.sort(compareUsageCandidates).slice(0, candidateLimit),
    timedOut,
  };
}

function matchesExtension(filePath, extensions) {
  return extensions.includes(path.extname(filePath).toLowerCase());
}

function compareUsageCandidates(left, right) {
  return right.mtimeMs - left.mtimeMs || left.filePath.localeCompare(right.filePath);
}

function interleaveUsageCandidates(candidatesBySource, maxFiles) {
  const queues = Array.from(candidatesBySource.values()).filter((items) => items.length > 0);
  const selected = [];
  let index = 0;
  while (selected.length < maxFiles && queues.length > 0) {
    const queue = queues[index % queues.length];
    const candidate = queue.shift();
    if (candidate) selected.push(candidate);
    if (queue.length === 0) {
      queues.splice(index % queues.length, 1);
      if (queues.length === 0) break;
      index %= queues.length;
    } else {
      index = (index + 1) % queues.length;
    }
  }
  return selected;
}

async function readUsageFile(filePath, options = {}) {
  const fallbackTimestamp = await fileMtimeIso(filePath);
  const result = filePath.endsWith('.jsonl')
    ? await readUsageJsonl(filePath, options)
    : filePath.endsWith('.json')
      ? await readUsageJson(filePath, options)
      : emptyUsageFile(filePath);
  result.startedAt = result.startedAt || fallbackTimestamp;
  result.lastActivityAt = result.lastActivityAt || fallbackTimestamp;
  return result;
}

async function fileMtimeIso(filePath) {
  try {
    return new Date((await fs.stat(filePath)).mtimeMs).toISOString();
  } catch {
    return undefined;
  }
}

async function readUsageJson(filePath, options = {}) {
  const fileSize = Math.max(0, Number(options.fileSize) || Number((await fs.stat(filePath)).size) || 0);
  if (fileSize > options.maxBytes) {
    return withUsageScanMetadata(emptyUsageFile(filePath), {
      bytesRead: 0,
      partialSample: true,
      skippedReason: 'oversized_json',
    });
  }
  const parsed = await readJsonFile(filePath);
  const records = Array.isArray(parsed) ? parsed : [parsed];
  return withUsageScanMetadata(summarizeUsageRecords(records, filePath, options), {
    bytesRead: fileSize,
  });
}

async function readUsageJsonl(filePath, options = {}) {
  const fileSize = Math.max(0, Number(options.fileSize) || Number((await fs.stat(filePath)).size) || 0);
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_USAGE_FILE_BYTES);
  if (fileSize > maxBytes) {
    const handle = await fs.open(filePath, 'r');
    try {
      // Codex writes the selected model near the beginning of a rollout and
      // cumulative token usage near the end. Sample both within the same
      // bounded budget so the usage can be attributed without reading the
      // entire (sometimes multi-megabyte) transcript.
      const tailBudget = Math.min(32 * 1024, Math.max(1, Math.floor(maxBytes / 3)));
      const headBudget = Math.max(0, maxBytes - tailBudget);
      const tailStart = Math.max(0, fileSize - tailBudget);
      const headLength = Math.min(headBudget, tailStart);
      const headBuffer = Buffer.alloc(headLength);
      const tailBuffer = Buffer.alloc(Math.min(tailBudget, fileSize - tailStart));
      const headRead = headLength > 0
        ? await handle.read(headBuffer, 0, headBuffer.length, 0)
        : { bytesRead: 0 };
      const tailRead = tailBuffer.length > 0
        ? await handle.read(tailBuffer, 0, tailBuffer.length, tailStart)
        : { bytesRead: 0 };
      const records = [
        ...parseJsonlSample(headBuffer.subarray(0, headRead.bytesRead).toString('utf8'), {
          discardLastLine: headLength < fileSize,
        }),
        ...parseJsonlSample(tailBuffer.subarray(0, tailRead.bytesRead).toString('utf8'), {
          discardFirstLine: tailStart > 0,
        }),
      ];
      return withUsageScanMetadata(summarizeUsageRecords(records, filePath, options), {
        bytesRead: headRead.bytesRead + tailRead.bytesRead,
        partialSample: true,
      });
    } finally {
      await handle.close();
    }
  }
  const records = [];
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Ignore non-JSON log lines.
    }
  }
  return withUsageScanMetadata(summarizeUsageRecords(records, filePath, options), {
    bytesRead: fileSize,
  });
}

function parseJsonlSample(text, options = {}) {
  let sample = text;
  if (options.discardFirstLine) {
    const firstLineBreak = sample.indexOf('\n');
    sample = firstLineBreak >= 0 ? sample.slice(firstLineBreak + 1) : '';
  }
  if (options.discardLastLine && sample && !sample.endsWith('\n')) {
    const lastLineBreak = sample.lastIndexOf('\n');
    sample = lastLineBreak >= 0 ? sample.slice(0, lastLineBreak + 1) : '';
  }
  const records = [];
  for (const line of sample.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Ignore non-JSON or truncated log lines.
    }
  }
  return records;
}

function withUsageScanMetadata(result, metadata = {}) {
  Object.defineProperties(result, {
    __scanBytes: {
      value: Math.max(0, Number(metadata.bytesRead) || 0),
      enumerable: false,
    },
    __partialSample: {
      value: Boolean(metadata.partialSample),
      enumerable: false,
    },
    __skippedReason: {
      value: metadata.skippedReason,
      enumerable: false,
    },
  });
  return result;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${round(bytes / 1024, 1)} KiB`;
  return `${round(bytes / (1024 * 1024), 1)} MiB`;
}

function summarizeUsageRecords(records, filePath, options = {}) {
  const totals = createZeroUsageNumbers();
  const seenEvents = new Set();
  const activityTimestamps = [];
  const toolCallCounts = new Map();
  const modelCounts = new Map();
  const behavior = createEmptySessionBehaviorSummary();
  const promptStyle = createEmptyPromptStyleSummary(Boolean(options.includePromptStyle));
  let currentToolRunLength = 0;
  let sessionId = path.basename(filePath, path.extname(filePath));
  let eventCount = 0;
  let startedAtMs;
  let lastActivityAtMs;
  let hasCumulativeUsage = false;
  let cumulativeBest = createZeroUsageNumbers();
  let cumulativeModelName;
  let currentModelName;
  let workspaceKey = inferWorkspaceKeyFromFilePath(filePath);
  let explicitDurationMs = 0;
  const observedModelNames = new Set(
    records.map((record) => extractModelName(record)).filter(Boolean),
  );

  const finishToolRun = () => {
    if (currentToolRunLength <= 0) return;
    behavior.toolRunLengths.push(currentToolRunLength);
    behavior.longestToolRun = Math.max(behavior.longestToolRun, currentToolRunLength);
    currentToolRunLength = 0;
  };

  records.forEach((record, index) => {
    sessionId = extractSessionId(record) || sessionId;
    workspaceKey = extractWorkspaceKey(record) || workspaceKey;
    explicitDurationMs += extractRecordDurationMs(record);
    const recordModelName = extractModelName(record);
    if (recordModelName) currentModelName = recordModelName;
    const toolCalls = extractToolCalls(record);
    const behaviorFlags = extractBehaviorFlags(record);
    if (behaviorFlags.isUserTurn) {
      finishToolRun();
      behavior.userTurnCount += 1;
      if (behavior.userTurnCount > 1) behavior.steeringTurnCount += 1;
      if (options.includePromptStyle) {
        addPromptStyleText(promptStyle, extractUserPromptText(record));
      }
    }
    if (behaviorFlags.isAssistantTurn) {
      behavior.assistantTurnCount += 1;
    }
    if (toolCalls.length > 0) {
      behavior.toolEventCount += 1;
      behavior.toolCallCount += toolCalls.length;
      currentToolRunLength += toolCalls.length;
      for (const toolCall of toolCalls) {
        const category = categorizeToolForBehavior(toolCall);
        behavior.toolCategoryCounts[category.id] = (behavior.toolCategoryCounts[category.id] || 0) + 1;
        if (behavior.firstToolNames.length < 8) behavior.firstToolNames.push(toolCall);
        if (behavior.firstToolCategories.length < 8) behavior.firstToolCategories.push(category.id);
      }
    }
    for (const toolCall of toolCalls) {
      const current = toolCallCounts.get(toolCall) || 0;
      toolCallCounts.set(toolCall, current + 1);
    }
    const timestamp = extractUsageTimestamp(record);
    if (timestamp) {
      const time = new Date(timestamp).getTime();
      if (Number.isFinite(time)) {
        startedAtMs = startedAtMs === undefined ? time : Math.min(startedAtMs, time);
        lastActivityAtMs = lastActivityAtMs === undefined ? time : Math.max(lastActivityAtMs, time);
        activityTimestamps.push(new Date(time).toISOString());
      }
    }
    for (const candidate of extractUsageCandidates(record)) {
      const numbers = readUsageNumbers(candidate.value);
      if (!hasAnyUsage(numbers)) continue;
      const candidateModelName = extractModelName(candidate.value) || recordModelName || currentModelName;
      if (candidate.path.includes('total_token_usage')) {
        hasCumulativeUsage = true;
        if (numbers.totalTokens >= cumulativeBest.totalTokens) {
          cumulativeBest = numbers;
          cumulativeModelName = candidateModelName;
        }
        eventCount = Math.max(eventCount, 1);
        continue;
      }
      const eventId = extractUsageEventId(record) || String(index + 1);
      const key = `${candidate.path}:${eventId}:${usageSignature(numbers)}`;
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
      eventCount += 1;
      mergeUsageNumbers(totals, numbers);
      addModelUsage(modelCounts, candidateModelName, numbers, 1);
    }
  });
  if (hasCumulativeUsage && observedModelNames.size === 1) {
    modelCounts.clear();
    addModelUsage(modelCounts, observedModelNames.values().next().value, cumulativeBest, 1);
  } else if (hasCumulativeUsage && modelCounts.size === 0) {
    addModelUsage(modelCounts, cumulativeModelName || currentModelName, cumulativeBest, 1);
  }
  finishToolRun();
  behavior.hasPlanningSignal = inferSessionPlanningSignal(behavior);
  behavior.hasSteeringSignal = behavior.steeringTurnCount > 0;
  behavior.planningToolCallCount = (behavior.toolCategoryCounts.planning || 0) + (behavior.toolCategoryCounts.read || 0) + (behavior.toolCategoryCounts.search || 0);

  const result = {
    sessionId,
    eventCount,
    totals: hasCumulativeUsage ? cumulativeBest : totals,
    startedAt: startedAtMs !== undefined ? new Date(startedAtMs).toISOString() : undefined,
    lastActivityAt: lastActivityAtMs !== undefined ? new Date(lastActivityAtMs).toISOString() : undefined,
    tokenKind: 'api',
    activityTimestamps,
    workspaceHash: workspaceKey ? createWorkspaceHash(workspaceKey) : undefined,
    durationMs: explicitDurationMs,
    toolCalls: Array.from(toolCallCounts.entries()).map(([name, count]) => ({ name, count })),
    toolCallCount: Array.from(toolCallCounts.values()).reduce((sum, count) => sum + count, 0),
    buildSignal: toolCallCounts.size > 0,
    models: summarizeModelUsage(modelCounts).models,
    behavior,
    promptStyle: finalizePromptStyleSummary(promptStyle),
  };
  if (workspaceKey) {
    Object.defineProperty(result, '__workspaceKey', {
      value: workspaceKey,
      enumerable: false,
    });
  }
  return result;
}

function emptyUsageFile(filePath) {
  return {
    sessionId: path.basename(filePath, path.extname(filePath)),
    eventCount: 0,
    totals: createZeroUsageNumbers(),
    models: [],
    promptStyle: createEmptyPromptStyleSummary(false),
  };
}

function extractUsageCandidates(value, pathParts = [], candidates = []) {
  const record = asRecord(value);
  if (!record) return candidates;
  if (looksLikeUsageObject(record)) {
    candidates.push({ path: pathParts.join('.'), value: record });
    return candidates;
  }
  for (const [key, child] of Object.entries(record)) {
    if (child && typeof child === 'object') {
      extractUsageCandidates(child, [...pathParts, key], candidates);
    }
  }
  return candidates;
}

function looksLikeUsageObject(record) {
  return [
    'input_tokens',
    'inputTokens',
    'prompt_tokens',
    'promptTokens',
    'output_tokens',
    'outputTokens',
    'completion_tokens',
    'completionTokens',
    'total_tokens',
    'totalTokens',
    'cached_input_tokens',
    'cachedInputTokens',
    'cache_read_input_tokens',
    'cacheReadInputTokens',
    'cache_creation_input_tokens',
    'cacheCreationInputTokens',
    'reasoning_output_tokens',
    'reasoningOutputTokens',
  ].some((key) => isFiniteNumber(record[key]));
}

function readUsageNumbers(record) {
  const inputTokens = readNumberFields(record, ['input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens']);
  const outputTokens = readNumberFields(record, ['output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens']);
  const cacheReadTokens = readNumberFields(record, ['cache_read_input_tokens', 'cacheReadInputTokens', 'cached_input_tokens', 'cachedInputTokens']);
  const cacheCreationTokens = readNumberFields(record, ['cache_creation_input_tokens', 'cacheCreationInputTokens']);
  const reasoningTokens = readNumberFields(record, ['reasoning_output_tokens', 'reasoningOutputTokens']);
  const explicitTotalTokens = readNumberFields(record, ['total_tokens', 'totalTokens']);
  const totalTokens = explicitTotalTokens || inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens + reasoningTokens;
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, reasoningTokens, totalTokens };
}

function summarizeUsagePeriod(records, availableSources, period) {
  const sourceAccumulators = new Map();
  const total = createZeroUsageNumbers();
  const modelCounts = new Map();
  const sessionIds = new Set();
  const scannedFileIds = new Set();
  let eventCount = 0;
  for (const source of availableSources) {
    ensureUsageAccumulator(sourceAccumulators, source.source, source.label, source.available);
  }
  for (const record of records) {
    if (record.file.eventCount <= 0 || !isUsageRecordInPeriod(record.file, period)) continue;
    const accumulator = ensureUsageAccumulator(sourceAccumulators, record.source, record.label, true);
    const fileId = `${record.source}:${record.sourceFileId}`;
    scannedFileIds.add(fileId);
    accumulator.scannedFileIds.add(fileId);
    accumulator.eventCount += record.file.eventCount;
    accumulator.sessionIds.add(record.file.sessionId);
    accumulator.tokenKinds.add(record.file.tokenKind || 'api');
    sessionIds.add(`${record.source}:${record.file.sessionId}`);
    eventCount += record.file.eventCount;
    mergeUsageNumbers(accumulator, record.file.totals);
    mergeUsageNumbers(total, record.file.totals);
    mergeModelUsageRows(accumulator.modelCounts, record.file.models);
    mergeModelUsageRows(modelCounts, record.file.models);
  }
  return {
    id: period.id,
    label: period.label,
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    scannedFileCount: scannedFileIds.size,
    sessionCount: sessionIds.size,
    eventCount,
    totalInputTokens: total.inputTokens,
    totalOutputTokens: total.outputTokens,
    totalCacheReadTokens: total.cacheReadTokens,
    totalCacheCreationTokens: total.cacheCreationTokens,
    totalReasoningTokens: total.reasoningTokens,
    totalTokens: total.totalTokens,
    modelUsage: summarizeModelUsage(modelCounts),
    estimatedCost: summarizeEstimatedCost(Array.from(modelCounts.values()), total.totalTokens),
    sources: Array.from(sourceAccumulators.values()).map(toUsageSourceSummary),
  };
}

function summarizePersonaUsagePeriod(records, period, now = new Date()) {
  const activeRecords = records.filter((record) => record.file.eventCount > 0 && isUsageRecordInPeriod(record.file, period));
  const hourBuckets = Array(24).fill(0);
  const durations = [];
  const continuousActiveDurations = [];
  const sessionStarts = [];
  const workspaceCounts = new Map();
  const workspaceActiveDays = new Map();
  const toolCounts = new Map();
  const sessionBehaviors = [];
  const promptStyle = createEmptyPromptStyleSummary(activeRecords.some((record) => record.file?.promptStyle?.enabled));
  let activeEventCount = 0;
  let nightEventCount = 0;
  let dayEventCount = 0;
  let knownWorkspaceSessionCount = 0;
  let unknownWorkspaceSessionCount = 0;
  let toolCallCount = 0;

  for (const record of activeRecords) {
    const file = record.file;
    const timestamps = selectActivityTimestamps(file, period);
    activeEventCount += timestamps.length || 1;
    for (const timestamp of timestamps) {
      const hour = new Date(timestamp).getHours();
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
      hourBuckets[hour] += 1;
      if (NIGHT_HOURS.has(hour)) nightEventCount += 1;
      if (DAY_HOURS.has(hour)) dayEventCount += 1;
    }

    const durationMinutes = sessionDurationMinutes(file);
    if (durationMinutes > 0) durations.push(durationMinutes);
    const continuousActiveMinutes = longestContinuousActiveMinutes(file.activityTimestamps);
    if (continuousActiveMinutes > 0) continuousActiveDurations.push(continuousActiveMinutes);
    sessionBehaviors.push({
      ...(file.behavior || createEmptySessionBehaviorSummary()),
      sessionDurationMinutes: round(durationMinutes, 1),
    });
    mergePromptStyleSummary(promptStyle, file.promptStyle);
    const startTime = firstValidDateMs(file.startedAt, timestamps[0]);
    if (startTime !== undefined) sessionStarts.push(startTime);

    if (file.workspaceHash) {
      knownWorkspaceSessionCount += 1;
      workspaceCounts.set(file.workspaceHash, (workspaceCounts.get(file.workspaceHash) || 0) + 1);
      const timestampsForWorkspace = timestamps.length ? timestamps : [file.startedAt, file.lastActivityAt].filter(Boolean);
      const daySet = workspaceActiveDays.get(file.workspaceHash) || new Set();
      for (const timestamp of timestampsForWorkspace) {
        const iso = firstValidIsoDateString([timestamp]);
        if (iso) daySet.add(iso.slice(0, 10));
      }
      workspaceActiveDays.set(file.workspaceHash, daySet);
    } else {
      unknownWorkspaceSessionCount += 1;
    }

    for (const toolCall of Array.isArray(file.toolCalls) ? file.toolCalls : []) {
      const name = cleanText(toolCall?.name, 100);
      const count = Math.max(0, Math.floor(Number(toolCall?.count) || 0));
      if (!name || count <= 0) continue;
      toolCallCount += count;
      toolCounts.set(name, (toolCounts.get(name) || 0) + count);
    }
  }

  sessionStarts.sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sessionStarts.length; i += 1) {
    const gapMinutes = (sessionStarts[i] - sessionStarts[i - 1]) / 60000;
    if (gapMinutes > 0) gaps.push(gapMinutes);
  }

  const workspaceList = Array.from(workspaceCounts.entries())
    .map(([workspaceHash, sessionCount]) => ({ workspaceHash, sessionCount }))
    .sort((a, b) => b.sessionCount - a.sessionCount || a.workspaceHash.localeCompare(b.workspaceHash));
  const topWorkspaceSessionCount = workspaceList[0]?.sessionCount || 0;
  const topWorkspaceSessionShare = knownWorkspaceSessionCount > 0
    ? round(topWorkspaceSessionCount / knownWorkspaceSessionCount, 3)
    : 0;
  const activeDaysByWorkspace = workspaceList.map((workspace) => ({
    workspaceHash: workspace.workspaceHash,
    activeDays: workspaceActiveDays.get(workspace.workspaceHash)?.size || 0,
  }));
  const topWorkspaceActiveDays = activeDaysByWorkspace[0]?.activeDays || 0;
  const reopenCount = Math.max(0, knownWorkspaceSessionCount - workspaceList.length);

  const topTools = Array.from(toolCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 20);
  const toolUsage = {
    ...createEmptyToolUsageSummary(),
    usedToolCount: topTools.length,
    toolCallCount,
    topTools,
  };

  return {
    activity: {
      ...createEmptyActivitySummary(),
      hourBuckets,
      activeEventCount,
      nightEventCount,
      dayEventCount,
      nightShare: activeEventCount > 0 ? round(nightEventCount / activeEventCount, 3) : 0,
      dayShare: activeEventCount > 0 ? round(dayEventCount / activeEventCount, 3) : 0,
      medianSessionMinutes: round(median(durations), 1),
      averageSessionMinutes: round(average(durations), 1),
      longestSessionMinutes: round(Math.max(0, ...durations), 1),
      longestContinuousActiveMinutes: round(Math.max(0, ...continuousActiveDurations), 1),
      continuousActivityIdleMinutes: CONTINUOUS_ACTIVITY_IDLE_MINUTES,
      medianGapMinutes: round(median(gaps), 1),
      snackSessionCount: durations.filter((value) => value > 0 && value < 15).length,
      deepSessionCount: durations.filter((value) => value >= 120).length,
    },
    workspaces: {
      ...createEmptyWorkspaceSummary(),
      activeWorkspaceCount: workspaceList.length,
      knownWorkspaceSessionCount,
      unknownWorkspaceSessionCount,
      topWorkspaceSessionShare,
      topWorkspaceActiveDays,
      reopenCount,
      activeDaysByWorkspace: activeDaysByWorkspace.slice(0, 12),
      topWorkspaces: workspaceList.slice(0, 12),
    },
    toolUsage,
    localActivity: summarizeLocalActivity(records, period, now),
    behaviorProfile: summarizeBehaviorProfile(sessionBehaviors, toolUsage, period),
    promptStyle: finalizePromptStyleSummary(promptStyle),
  };
}

export function createEmptyActivitySummary() {
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
    continuousActivityIdleMinutes: CONTINUOUS_ACTIVITY_IDLE_MINUTES,
    medianGapMinutes: 0,
    snackSessionCount: 0,
    deepSessionCount: 0,
  };
}

export function createEmptyLocalActivitySummary() {
  return {
    schemaVersion: 'taku.creator.local-activity.v1',
    period: {
      id: DEFAULT_USAGE_PERIOD_ID,
      label: 'Last 90 Days',
    },
    dailyHeatmap: [],
    activeDayCount: 0,
    buildDayCount: 0,
    buildSessionCount: 0,
    chatSessionCount: 0,
    sessionSplit: {
      sessionCount: 0,
      buildSessionCount: 0,
      chatSessionCount: 0,
      buildShare: 0,
      chatShare: 0,
      buildMinutes: 0,
      chatMinutes: 0,
      buildTimeShare: 0,
      chatTimeShare: 0,
    },
    buildStreak: {
      currentDays: 0,
      bestDays: 0,
    },
    trend30d: {
      metric: 'buildSessions',
      buckets: [],
    },
    delta30d: {
      metric: 'buildSessions',
      current: 0,
      previous: 0,
      delta: null,
      display: '',
    },
    workPattern: {
      timezone: 'local',
      hourBuckets: Array(24).fill(0),
      peakHour: null,
      activeHourCount: 0,
      nightShare: 0,
      morningShare: 0,
      businessHoursShare: 0,
      weekendShare: 0,
      durationSessionCount: 0,
      avgSessionMinutes: 0,
      longestSessionMinutes: 0,
      shortSessionShare: 0,
      longSessionShare: 0,
      flowSessionShare: 0,
    },
  };
}

export function createEmptyWorkspaceSummary() {
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

export function createEmptyToolUsageSummary() {
  return {
    usedToolCount: 0,
    toolCallCount: 0,
    topTools: [],
  };
}

export function createEmptyModelUsageSummary() {
  return {
    schemaVersion: MODEL_USAGE_SCHEMA,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalReasoningTokens: 0,
    observedEventCount: 0,
    modelCount: 0,
    estimatedCost: createEmptyEstimatedCostSummary(),
    topModels: [],
    models: [],
  };
}

function addModelUsage(modelCounts, value, numbers, eventCount = 1) {
  const modelId = normalizeModelUsageName(value);
  const usageNumbers = normalizeUsageNumbersForModel(numbers);
  if (!modelId || !hasAnyUsage(usageNumbers)) return;
  const current = modelCounts.get(modelId) || {
    ...createZeroUsageNumbers(),
    modelId,
    name: modelId,
    eventCount: 0,
  };
  mergeUsageNumbers(current, usageNumbers);
  current.eventCount += Math.max(1, Math.floor(Number(eventCount) || 1));
  modelCounts.set(modelId, current);
}

function mergeModelUsageRows(modelCounts, rows) {
  for (const row of Array.isArray(rows) ? rows : []) {
    addModelUsage(modelCounts, row?.modelId || row?.name, normalizeUsageNumbersForModel(row), row?.eventCount);
  }
}

function summarizeModelUsage(modelCounts) {
  const empty = createEmptyModelUsageSummary();
  const rows = Array.from(modelCounts?.values?.() || [])
    .filter((row) => row.name && row.totalTokens > 0)
    .sort((left, right) => right.totalTokens - left.totalTokens || left.name.localeCompare(right.name));
  const totalTokens = rows.reduce((sum, row) => sum + row.totalTokens, 0);
  const estimatedCost = summarizeEstimatedCost(rows);
  const models = rows.slice(0, 20).map((row) => {
    const share = totalTokens > 0 ? round(row.totalTokens / totalTokens, 3) : 0;
    const rowCost = estimateUsageCostForModel(row.modelId || row.name, row);
    return {
      modelId: row.modelId || row.name,
      name: row.name,
      totalInputTokens: row.inputTokens,
      totalOutputTokens: row.outputTokens,
      totalCacheReadTokens: row.cacheReadTokens,
      totalCacheCreationTokens: row.cacheCreationTokens,
      totalReasoningTokens: row.reasoningTokens,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      reasoningTokens: row.reasoningTokens,
      totalTokens: row.totalTokens,
      eventCount: row.eventCount,
      share,
      percentage: formatModelUsagePercent(share),
      estimatedCost: rowCost,
      estimatedCostUsd: rowCost.totalUsd,
    };
  });
  return {
    ...empty,
    totalTokens,
    totalInputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
    totalOutputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
    totalCacheReadTokens: rows.reduce((sum, row) => sum + row.cacheReadTokens, 0),
    totalCacheCreationTokens: rows.reduce((sum, row) => sum + row.cacheCreationTokens, 0),
    totalReasoningTokens: rows.reduce((sum, row) => sum + row.reasoningTokens, 0),
    observedEventCount: rows.reduce((sum, row) => sum + row.eventCount, 0),
    modelCount: rows.length,
    estimatedCost,
    topModels: models.slice(0, 4),
    models,
  };
}

function normalizeUsageNumbersForModel(value) {
  const inputTokens = Math.max(0, Math.floor(Number(value?.inputTokens ?? value?.totalInputTokens) || 0));
  const outputTokens = Math.max(0, Math.floor(Number(value?.outputTokens ?? value?.totalOutputTokens) || 0));
  const cacheReadTokens = Math.max(0, Math.floor(Number(value?.cacheReadTokens ?? value?.totalCacheReadTokens) || 0));
  const cacheCreationTokens = Math.max(0, Math.floor(Number(value?.cacheCreationTokens ?? value?.totalCacheCreationTokens) || 0));
  const reasoningTokens = Math.max(0, Math.floor(Number(value?.reasoningTokens ?? value?.totalReasoningTokens) || 0));
  const explicitTotalTokens = Math.max(0, Math.floor(Number(value?.totalTokens) || 0));
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    reasoningTokens,
    totalTokens: explicitTotalTokens || inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens + reasoningTokens,
  };
}

function extractModelName(value, depth = 0, seen = new Set(), allowString = false) {
  if (depth > 6 || value === null || value === undefined) return undefined;
  if (typeof value === 'string') return allowString ? normalizeModelUsageName(value) : undefined;
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 60)) {
      const found = extractModelName(item, depth + 1, seen, allowString);
      if (found) return found;
    }
    return undefined;
  }

  const record = asRecord(value);
  for (const [key, child] of Object.entries(record || {})) {
    const normalizedKey = normalizeChoiceToken(key);
    if (!MODEL_USAGE_KEYS.has(normalizedKey) && !MODEL_PROVIDER_KEYS.has(normalizedKey)) continue;
    const direct = normalizeModelUsageName(stringValue(child));
    if (direct) return direct;
    const nested = extractModelName(child, depth + 1, seen, true);
    if (nested) return nested;
  }

  for (const [key, child] of Object.entries(record || {})) {
    const normalizedKey = normalizeChoiceToken(key);
    if (MODEL_SCAN_SKIP_KEYS.has(normalizedKey)) continue;
    const found = extractModelName(child, depth + 1, seen, false);
    if (found) return found;
  }
  return undefined;
}

export function normalizeModelUsageName(value) {
  const text = sanitizeModelId(cleanText(value, 160));
  return text && looksLikeModelString(text) ? text : undefined;
}

function looksLikeModelString(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 160) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (/\s/.test(text) && text.split(/\s+/).length > 4) return false;
  const lower = text.toLowerCase();
  if (/(gemini|claude|sonnet|opus|haiku|gpt|grok|deepseek|qwen|llama|mistral)/.test(lower)) return true;
  if (/^o[134][\w.-]*/.test(lower)) return true;
  return /[-_.:/]\d|\d[-_.:/]|(mini|preview|latest|instruct|chat|reasoning|turbo|coder|code)/.test(lower);
}

export function createEmptyPromptStyleSummary(enabled = false) {
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

function addPromptStyleText(summary, text) {
  if (!summary?.enabled) return;
  const prompt = cleanPromptStyleText(text);
  if (!prompt) return;
  const analysis = analyzePromptStyleText(prompt);
  summary.promptCount += 1;
  summary.analyzedPromptCount += 1;
  summary.totalChars += analysis.charCount;
  summary.maxChars = Math.max(summary.maxChars || 0, analysis.charCount);
  if (analysis.isLongPrompt) summary.longPromptCount += 1;
  if (analysis.hasGratitude) summary.gratitudeCount += 1;
  if (analysis.isCinematic) summary.cinematicCount += 1;
  if (analysis.hasComplexSteps) summary.complexStepCount += 1;
  if (analysis.hasRoast) summary.roastCount += 1;
  if (analysis.hasSpicyTone) summary.spicyCount += 1;
}

function mergePromptStyleSummary(target, source) {
  if (!source?.enabled) return target;
  target.enabled = true;
  target.promptContentRead = true;
  for (const key of [
    'promptCount',
    'analyzedPromptCount',
    'totalChars',
    'longPromptCount',
    'gratitudeCount',
    'cinematicCount',
    'complexStepCount',
    'roastCount',
    'spicyCount',
  ]) {
    target[key] = (Number(target[key]) || 0) + (Number(source[key]) || 0);
  }
  target.maxChars = Math.max(Number(target.maxChars) || 0, Number(source.maxChars) || 0);
  return target;
}

function finalizePromptStyleSummary(summary) {
  const next = {
    ...createEmptyPromptStyleSummary(Boolean(summary?.enabled)),
    ...(summary || {}),
    rawPromptStored: false,
    rawPromptUploaded: false,
  };
  const count = Math.max(0, Math.floor(Number(next.analyzedPromptCount || next.promptCount) || 0));
  next.promptCount = count;
  next.analyzedPromptCount = count;
  next.totalChars = Math.max(0, Math.floor(Number(next.totalChars) || 0));
  next.maxChars = Math.max(0, Math.floor(Number(next.maxChars) || 0));
  next.averageChars = count > 0 ? Math.round(next.totalChars / count) : 0;
  next.longPromptShare = count > 0 ? round((Number(next.longPromptCount) || 0) / count, 3) : 0;
  next.gratitudeShare = count > 0 ? round((Number(next.gratitudeCount) || 0) / count, 3) : 0;
  next.cinematicShare = count > 0 ? round((Number(next.cinematicCount) || 0) / count, 3) : 0;
  next.complexStepShare = count > 0 ? round((Number(next.complexStepCount) || 0) / count, 3) : 0;
  next.roastShare = count > 0 ? round((Number(next.roastCount) || 0) / count, 3) : 0;
  next.spicyShare = count > 0 ? round((Number(next.spicyCount) || 0) / count, 3) : 0;
  next.evidence = next.enabled
    ? [
        `${formatNumber(count)} local user prompt(s) analyzed`,
        `${formatNumber(next.averageChars)} average chars, ${formatPercent(next.longPromptShare)} long prompt share`,
        `${formatNumber(next.complexStepCount)} structured/multi-step prompt(s)`,
        `${formatNumber(next.gratitudeCount)} gratitude marker prompt(s)`,
      ]
    : [];
  return next;
}

function analyzePromptStyleText(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const charCount = [...raw].length;
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const paragraphCount = raw.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean).length;
  const bulletCount = lines.filter((line) => /^([-*•]|\d+[.)]|[（(]?\d+[）)])\s+/.test(line)).length;
  const gratitudeHits = countMatches(lower, /\b(thanks|thank you|thank u|thx|appreciate it)\b|谢谢|感谢|多谢|谢啦|辛苦了?|麻烦你/g);
  const complexMarkers = countMatches(lower, /\b(step by step|constraints?|requirements?|output format|checklist|acceptance criteria|pseudocode)\b|分步骤|步骤|先.*然后|输出格式|验收标准|约束|要求|注意事项|请按/g);
  const cinematicMarkers = countMatches(lower, /\b(scene|cinematic|storyboard|narrative|atmosphere|visual|camera|shot|mood|tone)\b|画面|镜头|氛围|叙事|小作文|故事|场景|分镜|质感/g);
  const roastHits = countMatches(lower, /屎山|垃圾代码|烂代码|破代码|这坨|烂摊子|救救|救命|吐槽|绷不住|又炸了|怎么又|离谱|trash code|garbage code|dumpster|messy code|horrible code|why[^.!?\n]{0,80}broken/g);
  const spicyHits = countMatches(lower, /别废话|不要废话|少废话|直接给|给我|立刻|马上|必须|严禁|别糊弄|别偷懒|搞快|wtf|damn|nonsense|are you kidding|离谱|服了|崩了|炸了/g);
  const isLongPrompt = charCount >= 800 || lines.length >= 10 || paragraphCount >= 4;
  return {
    charCount,
    isLongPrompt,
    hasGratitude: gratitudeHits > 0,
    isCinematic: isLongPrompt || cinematicMarkers >= 3,
    hasComplexSteps: bulletCount >= 3 || complexMarkers >= 2,
    hasRoast: roastHits > 0,
    hasSpicyTone: spicyHits >= 2,
  };
}

function countMatches(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function cleanPromptStyleText(value) {
  const text = cleanText(value, DEFAULT_MAX_PROMPT_STYLE_CHARS);
  return text && text.length >= 2 ? text : '';
}

export function createEmptyBehaviorProfile(periodId = DEFAULT_USAGE_PERIOD_ID, periodLabel = 'Last 90 Days') {
  return {
    schemaVersion: BEHAVIOR_PROFILE_SCHEMA,
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
    metricDefinitions: behaviorMetricDefinitions(),
    evidence: [],
  };
}

function createEmptySessionBehaviorSummary() {
  return {
    userTurnCount: 0,
    assistantTurnCount: 0,
    toolEventCount: 0,
    toolCallCount: 0,
    planningToolCallCount: 0,
    steeringTurnCount: 0,
    toolRunLengths: [],
    longestToolRun: 0,
    sessionDurationMinutes: 0,
    firstToolNames: [],
    firstToolCategories: [],
    toolCategoryCounts: {},
    hasPlanningSignal: false,
    hasSteeringSignal: false,
  };
}

function behaviorMetricDefinitions() {
  return [
    {
      id: 'planningRatio',
      label: 'Planning',
      description: 'Share of sessions where the agent explored, read, searched, or planned before editing.',
      personaImpact: 'High Planning pulls Architect/Explorer toward Architect.',
    },
    {
      id: 'steeringRatio',
      label: 'Steering',
      description: 'How often the user comes back after the first prompt to redirect or refine the run.',
      personaImpact: 'High Steering adds conductor-style behavior traits.',
    },
    {
      id: 'autonomyScore',
      label: 'Autonomy',
      description: 'How much work the agent performs after each user handoff, balanced by run length and session depth.',
      personaImpact: 'High Autonomy adds agent-runner or daemon-style traits.',
    },
    {
      id: 'topToolsMix',
      label: 'Top Mix',
      description: 'The dominant categories of local tool calls used to move work forward.',
      personaImpact: 'Shell/tooling-heavy mixes pull Maker/Infra toward Infra.',
    },
  ];
}

function autonomyLevel(score) {
  if (score >= 0.75) return 'high';
  if (score >= 0.5) return 'medium';
  if (score > 0) return 'low';
  return 'unknown';
}

export function summarizeLocalActivity(records, period, now = new Date()) {
  const activeRecords = (Array.isArray(records) ? records : [])
    .filter((record) => record.file?.eventCount > 0 && isUsageRecordInPeriod(record.file, period));
  const dailyHeatmap = summarizeDailyHeatmap(activeRecords, period);
  const sessionSplit = summarizeSessionSplit(activeRecords);
  const buildDates = dailyHeatmap
    .filter((day) => day.buildSessionCount > 0)
    .map((day) => day.date);
  const delta30d = summarizeLocalActivityDelta(records, now);

  return {
    ...createEmptyLocalActivitySummary(),
    period: {
      id: period?.id || DEFAULT_USAGE_PERIOD_ID,
      label: period?.label || 'Last 90 Days',
      startsAt: period?.startsAt,
      endsAt: period?.endsAt,
    },
    dailyHeatmap,
    activeDayCount: dailyHeatmap.filter((day) => day.active).length,
    buildDayCount: buildDates.length,
    buildSessionCount: dailyHeatmap.reduce((sum, day) => sum + day.buildSessionCount, 0),
    chatSessionCount: sessionSplit.chatSessionCount,
    sessionSplit,
    buildStreak: summarizeBuildStreak(buildDates, now),
    trend30d: summarizeBuildTrend30d(records, now),
    delta30d,
    workPattern: summarizeWorkPattern(activeRecords, period),
  };
}

function summarizeDailyHeatmap(records, period) {
  const days = new Map();
  for (const record of records) {
    const file = record.file || {};
    const sessionKey = `${record.source}:${file.sessionId || record.sourceFileId}`;
    const timestamps = selectActivityTimestamps(file, period);
    const dayKeys = timestamps.length
      ? Array.from(new Set(timestamps.map(localDateKey).filter(Boolean)))
      : [];
    if (!dayKeys.length) continue;

    const primaryDay = dayKeys[0];
    const buildSession = isBuildSession(file);
    const toolCallCount = readFileToolCallCount(file);
    const tokenCount = readFileTotalTokens(file);
    for (const dayKey of dayKeys) {
      const day = ensureDailyActivityRow(days, dayKey);
      day.sessionIds.add(sessionKey);
      if (buildSession) day.buildSessionIds.add(sessionKey);
      day.eventCount += timestamps.filter((timestamp) => localDateKey(timestamp) === dayKey).length || 1;
      if (dayKey === primaryDay) {
        day.toolCallCount += toolCallCount;
        day.tokenCount += tokenCount;
      }
    }
  }

  return Array.from(days.values())
    .map(finalizeDailyActivityRow)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function ensureDailyActivityRow(days, date) {
  const existing = days.get(date);
  if (existing) return existing;
  const row = {
    date,
    active: true,
    sessionIds: new Set(),
    buildSessionIds: new Set(),
    eventCount: 0,
    toolCallCount: 0,
    tokenCount: 0,
  };
  days.set(date, row);
  return row;
}

function finalizeDailyActivityRow(row) {
  const sessionCount = row.sessionIds.size;
  const buildSessionCount = row.buildSessionIds.size;
  const buildIntensity = Math.min(
    4,
    Math.max(
      buildSessionCount > 0 ? 1 : 0,
      Math.ceil((buildSessionCount * 2 + row.toolCallCount) / 8),
    ),
  );
  return {
    date: row.date,
    active: row.active,
    sessionCount,
    buildSessionCount,
    eventCount: row.eventCount,
    toolCallCount: row.toolCallCount,
    tokenCount: row.tokenCount,
    buildIntensity,
  };
}

function summarizeSessionSplit(records) {
  let buildSessionCount = 0;
  let chatSessionCount = 0;
  let buildMinutes = 0;
  let chatMinutes = 0;

  for (const record of records) {
    const file = record.file || {};
    const duration = sessionDurationMinutes(file);
    if (isBuildSession(file)) {
      buildSessionCount += 1;
      buildMinutes += duration;
    } else {
      chatSessionCount += 1;
      chatMinutes += duration;
    }
  }

  const sessionCount = buildSessionCount + chatSessionCount;
  const totalMinutes = buildMinutes + chatMinutes;
  return {
    sessionCount,
    buildSessionCount,
    chatSessionCount,
    buildShare: sessionCount > 0 ? round(buildSessionCount / sessionCount, 3) : 0,
    chatShare: sessionCount > 0 ? round(chatSessionCount / sessionCount, 3) : 0,
    buildMinutes: round(buildMinutes, 1),
    chatMinutes: round(chatMinutes, 1),
    buildTimeShare: totalMinutes > 0 ? round(buildMinutes / totalMinutes, 3) : 0,
    chatTimeShare: totalMinutes > 0 ? round(chatMinutes / totalMinutes, 3) : 0,
  };
}

function summarizeBuildStreak(buildDates, now = new Date()) {
  const dates = Array.from(new Set(buildDates)).sort();
  let bestDays = 0;
  let currentRun = 0;
  let previousMs;
  for (const date of dates) {
    const time = localDateStartMs(date);
    if (!Number.isFinite(time)) continue;
    currentRun = previousMs !== undefined && time - previousMs === 24 * 60 * 60 * 1000
      ? currentRun + 1
      : 1;
    bestDays = Math.max(bestDays, currentRun);
    previousMs = time;
  }

  const buildSet = new Set(dates);
  let currentDays = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  while (buildSet.has(localDateKey(cursor))) {
    currentDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { currentDays, bestDays };
}

function summarizeBuildTrend30d(records, now = new Date()) {
  const start = startOfLocalDay(now);
  start.setDate(start.getDate() - 29);
  const buckets = [];
  for (let index = 0; index < 5; index += 1) {
    const bucketStart = new Date(start);
    bucketStart.setDate(start.getDate() + index * 6);
    const bucketEnd = new Date(bucketStart);
    bucketEnd.setDate(bucketStart.getDate() + 5);
    buckets.push({
      id: `w${index + 1}`,
      label: `${bucketStart.getMonth() + 1}/${bucketStart.getDate()}-${bucketEnd.getMonth() + 1}/${bucketEnd.getDate()}`,
      startsAt: bucketStart.toISOString(),
      endsAt: endOfLocalDay(bucketEnd).toISOString(),
      buildSessionCount: 0,
      activeDayCount: 0,
      toolCallCount: 0,
      tokenCount: 0,
      __activeDays: new Set(),
    });
  }

  for (const record of Array.isArray(records) ? records : []) {
    const file = record.file || {};
    if (file.eventCount <= 0) continue;
    const timestamp = primaryActivityTimestamp(file);
    const time = firstValidDateMs(timestamp);
    if (time === undefined || time < start.getTime() || time > now.getTime()) continue;
    const bucket = buckets.find((item) => time >= new Date(item.startsAt).getTime() && time <= new Date(item.endsAt).getTime());
    if (!bucket) continue;
    const day = localDateKey(new Date(time));
    if (day) bucket.__activeDays.add(day);
    if (isBuildSession(file)) bucket.buildSessionCount += 1;
    bucket.toolCallCount += readFileToolCallCount(file);
    bucket.tokenCount += readFileTotalTokens(file);
  }

  return {
    metric: 'buildSessions',
    periodId: 'last30Days',
    buckets: buckets.map(({ __activeDays, ...bucket }) => ({
      ...bucket,
      activeDayCount: __activeDays.size,
    })),
  };
}

function summarizeLocalActivityDelta(records, now = new Date()) {
  const current = summarizeBuildWindow(records, daysAgoStart(now, 29), now);
  const previousEnd = daysAgoEnd(now, 30);
  const previous = summarizeBuildWindow(records, daysAgoStart(now, 59), previousEnd);
  const delta = ratioDelta(current.buildSessionCount, previous.buildSessionCount);
  return {
    metric: 'buildSessions',
    current: current.buildSessionCount,
    previous: previous.buildSessionCount,
    delta,
    display: formatDelta(delta, current.buildSessionCount, previous.buildSessionCount),
    currentWindow: current,
    previousWindow: previous,
  };
}

function summarizeBuildWindow(records, startsAt, endsAt) {
  const activeDays = new Set();
  let buildSessionCount = 0;
  let toolCallCount = 0;
  let tokenCount = 0;
  for (const record of Array.isArray(records) ? records : []) {
    const file = record.file || {};
    if (file.eventCount <= 0) continue;
    const timestamp = primaryActivityTimestamp(file);
    const time = firstValidDateMs(timestamp);
    if (time === undefined || time < startsAt.getTime() || time > endsAt.getTime()) continue;
    const day = localDateKey(new Date(time));
    if (day) activeDays.add(day);
    if (isBuildSession(file)) buildSessionCount += 1;
    toolCallCount += readFileToolCallCount(file);
    tokenCount += readFileTotalTokens(file);
  }
  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    buildSessionCount,
    activeDayCount: activeDays.size,
    toolCallCount,
    tokenCount,
  };
}

function summarizeWorkPattern(records, period) {
  const hourBuckets = Array(24).fill(0);
  let activeEventCount = 0;
  let nightEventCount = 0;
  let morningEventCount = 0;
  let businessHourEventCount = 0;
  let weekendEventCount = 0;
  const durations = [];

  for (const record of records) {
    const file = record.file || {};
    const timestamps = selectActivityTimestamps(file, period);
    for (const timestamp of timestamps) {
      const date = new Date(timestamp);
      const hour = date.getHours();
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
      activeEventCount += 1;
      hourBuckets[hour] += 1;
      if (NIGHT_HOURS.has(hour)) nightEventCount += 1;
      if (hour >= 5 && hour <= 11) morningEventCount += 1;
      if (hour >= 9 && hour <= 17) businessHourEventCount += 1;
      if (date.getDay() === 0 || date.getDay() === 6) weekendEventCount += 1;
    }
    const duration = sessionDurationMinutes(file);
    if (duration > 0) durations.push(duration);
  }

  const durationSessionCount = durations.length;
  const peakHour = hourBuckets.reduce(
    (best, count, hour) => (count > hourBuckets[best] ? hour : best),
    0,
  );
  return {
    timezone: 'local',
    hourBuckets,
    peakHour: activeEventCount > 0 ? peakHour : null,
    activeHourCount: hourBuckets.filter((count) => count > 0).length,
    nightShare: activeEventCount > 0 ? round(nightEventCount / activeEventCount, 3) : 0,
    morningShare: activeEventCount > 0 ? round(morningEventCount / activeEventCount, 3) : 0,
    businessHoursShare: activeEventCount > 0 ? round(businessHourEventCount / activeEventCount, 3) : 0,
    weekendShare: activeEventCount > 0 ? round(weekendEventCount / activeEventCount, 3) : 0,
    durationSessionCount,
    avgSessionMinutes: round(average(durations), 1),
    longestSessionMinutes: round(Math.max(0, ...durations), 1),
    shortSessionShare: durationSessionCount > 0 ? round(durations.filter((value) => value > 0 && value < 15).length / durationSessionCount, 3) : 0,
    longSessionShare: durationSessionCount > 0 ? round(durations.filter((value) => value >= 120).length / durationSessionCount, 3) : 0,
    flowSessionShare: durationSessionCount > 0 ? round(durations.filter((value) => value >= 30 && value < 120).length / durationSessionCount, 3) : 0,
  };
}

function selectActivityTimestamps(file, period) {
  const candidates = Array.isArray(file.activityTimestamps) && file.activityTimestamps.length
    ? file.activityTimestamps
    : [file.startedAt, file.lastActivityAt].filter(Boolean);
  const unique = Array.from(new Set(candidates.map((value) => firstValidIsoDateString([value])).filter(Boolean)));
  return unique.filter((timestamp) => isTimestampInPeriod(timestamp, period));
}

function isTimestampInPeriod(timestamp, period) {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return false;
  if (period.startsAt && time < new Date(period.startsAt).getTime()) return false;
  return time <= new Date(period.endsAt).getTime();
}

function sessionDurationMinutes(file) {
  const start = firstValidDateMs(file.startedAt);
  const end = firstValidDateMs(file.lastActivityAt);
  const elapsedMs = start !== undefined && end !== undefined && end >= start ? end - start : 0;
  const explicitMs = Math.max(0, Number(file.durationMs) || 0);
  const activeMs = activeDurationMsFromTimestamps(file.activityTimestamps || []);
  const boundedElapsedMs = elapsedMs > 0 && elapsedMs <= 8 * 60 * 60 * 1000 ? elapsedMs : 0;
  return Math.max(activeMs, explicitMs, boundedElapsedMs) / 60000;
}

function firstValidDateMs(...values) {
  for (const value of values) {
    const text = stringValue(value);
    if (!text) continue;
    const time = new Date(text).getTime();
    if (Number.isFinite(time)) return time;
  }
  return undefined;
}

function activeDurationMsFromTimestamps(values) {
  const times = Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => firstValidDateMs(value))
    .filter((value) => value !== undefined)))
    .sort((a, b) => a - b);
  if (times.length < 2) return 0;
  const maxGapMs = 30 * 60 * 1000;
  let total = 0;
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    if (gap > 0 && gap <= maxGapMs) total += gap;
  }
  return total;
}

export function longestContinuousActiveMinutes(
  values,
  idleMinutes = CONTINUOUS_ACTIVITY_IDLE_MINUTES,
) {
  const times = Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => firstValidDateMs(value))
    .filter((value) => value !== undefined)))
    .sort((a, b) => a - b);
  if (times.length < 2) return 0;

  const maxGapMs = Math.max(1, Number(idleMinutes) || CONTINUOUS_ACTIVITY_IDLE_MINUTES) * 60 * 1000;
  let currentMs = 0;
  let longestMs = 0;
  for (let i = 1; i < times.length; i += 1) {
    const gapMs = times[i] - times[i - 1];
    if (gapMs > 0 && gapMs <= maxGapMs) {
      currentMs += gapMs;
      longestMs = Math.max(longestMs, currentMs);
    } else {
      currentMs = 0;
    }
  }
  return longestMs / 60000;
}

function isBuildSession(file) {
  return Boolean(file?.buildSignal) || readFileToolCallCount(file) > 0;
}

function readFileToolCallCount(file) {
  if (Number.isFinite(file?.toolCallCount)) return Math.max(0, Math.floor(file.toolCallCount));
  return (Array.isArray(file?.toolCalls) ? file.toolCalls : []).reduce((sum, toolCall) => {
    const count = Math.max(0, Math.floor(Number(toolCall?.count) || 0));
    return sum + count;
  }, 0);
}

function readFileTotalTokens(file) {
  return Math.max(0, Math.floor(Number(file?.totals?.totalTokens) || 0));
}

function primaryActivityTimestamp(file) {
  const timestamps = Array.isArray(file?.activityTimestamps) ? file.activityTimestamps : [];
  return firstValidIsoDateString([timestamps[0], file?.startedAt, file?.lastActivityAt]);
}

function localDateKey(value) {
  const time = value instanceof Date ? value.getTime() : firstValidDateMs(value);
  if (time === undefined || !Number.isFinite(time)) return '';
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function localDateStartMs(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return undefined;
  const [year, month, day] = dateKey.split('-').map((part) => Number(part));
  return new Date(year, month - 1, day).getTime();
}

function startOfLocalDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function endOfLocalDay(value) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999);
}

function daysAgoStart(now, daysAgo) {
  const date = startOfLocalDay(now);
  date.setDate(date.getDate() - daysAgo);
  return date;
}

function daysAgoEnd(now, daysAgo) {
  return endOfLocalDay(daysAgoStart(now, daysAgo));
}

function ratioDelta(current, previous) {
  if (previous > 0) return round((current - previous) / previous, 3);
  if (current > 0) return null;
  return 0;
}

function formatDelta(delta, current, previous) {
  if (previous <= 0 && current > 0) return 'NEW';
  if (!Number.isFinite(delta)) return '';
  if (delta === 0) return '0%';
  const percent = Math.round(delta * 100);
  return percent > 0 ? `+${percent}%` : `${percent}%`;
}

export function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

export function median(values) {
  const filtered = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!filtered.length) return 0;
  const middle = Math.floor(filtered.length / 2);
  return filtered.length % 2 ? filtered[middle] : (filtered[middle - 1] + filtered[middle]) / 2;
}

export function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isUsageRecordInPeriod(record, period) {
  if (!period.startsAt) return true;
  const timestamp = record.lastActivityAt || record.startedAt;
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  return time >= new Date(period.startsAt).getTime() && time <= new Date(period.endsAt).getTime();
}

function ensureUsageAvailability(availability, source, label) {
  const current = availability.get(source);
  if (current) return current;
  const next = { source, label, available: false };
  availability.set(source, next);
  return next;
}

function ensureUsageAccumulator(accumulators, source, label, available) {
  const current = accumulators.get(source);
  if (current) {
    current.available = current.available || available;
    return current;
  }
  const next = {
    ...createZeroUsageNumbers(),
    source,
    label,
    available,
    scannedFileIds: new Set(),
    eventCount: 0,
    sessionIds: new Set(),
    tokenKinds: new Set(),
    modelCounts: new Map(),
  };
  accumulators.set(source, next);
  return next;
}

function toUsageSourceSummary(accumulator) {
  const tokenKinds = Array.from(accumulator.tokenKinds);
  return {
    source: accumulator.source,
    label: accumulator.label,
    available: accumulator.available,
    scannedFileCount: accumulator.scannedFileIds.size,
    sessionCount: accumulator.sessionIds.size,
    eventCount: accumulator.eventCount,
    tokenKind: tokenKinds.length === 1 ? tokenKinds[0] : tokenKinds.length > 1 ? 'mixed' : 'api',
    totalInputTokens: accumulator.inputTokens,
    totalOutputTokens: accumulator.outputTokens,
    totalCacheReadTokens: accumulator.cacheReadTokens,
    totalCacheCreationTokens: accumulator.cacheCreationTokens,
    totalReasoningTokens: accumulator.reasoningTokens,
    totalTokens: accumulator.totalTokens,
    modelUsage: summarizeModelUsage(accumulator.modelCounts),
    estimatedCost: summarizeEstimatedCost(Array.from(accumulator.modelCounts.values()), accumulator.totalTokens),
  };
}

function extractWorkspaceKey(value) {
  const candidate = findStringByKey(value, new Set([
    'cwd',
    'workspace',
    'workspaceroot',
    'workspacepath',
    'projectroot',
    'projectpath',
    'projectcwd',
    'workingdirectory',
    'currentworkingdirectory',
  ]));
  return normalizeWorkspaceKey(candidate);
}

function inferWorkspaceKeyFromFilePath(filePath) {
  const parts = path.resolve(filePath).split(path.sep);
  for (let i = 0; i < parts.length - 2; i += 1) {
    const parent = parts[i];
    const child = parts[i + 1];
    if ((parent === '.claude' || parent === '.cursor') && child === 'projects') {
      return normalizeWorkspaceKey(`${parent}/${child}/${parts[i + 2]}`);
    }
  }
  return undefined;
}

export function normalizeWorkspaceKey(value) {
  const text = stringValue(value);
  if (!text || text.length > 600) return undefined;
  if (/^https?:\/\//i.test(text)) return undefined;
  return text.replace(/^~(?=$|[\\/])/, getHomeDir()).replace(/[\\/]+$/g, '');
}

export function createWorkspaceHash(value) {
  const normalized = normalizeWorkspaceKey(value);
  return normalized ? `w_${stableId('workspace', normalized).slice(0, 10)}` : undefined;
}

function findStringByKey(value, keyNames, depth = 0, seen = new Set()) {
  if (depth > 5 || !value || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 40)) {
      const found = findStringByKey(item, keyNames, depth + 1, seen);
      if (found) return found;
    }
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = normalizeChoiceToken(key);
    if (keyNames.has(normalizedKey)) {
      const text = stringValue(child);
      if (text) return text;
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = normalizeChoiceToken(key);
    if (['content', 'text', 'message', 'messages', 'prompt', 'prompts', 'output'].includes(normalizedKey)) continue;
    const found = findStringByKey(child, keyNames, depth + 1, seen);
    if (found) return found;
  }
  return undefined;
}

function extractRecordDurationMs(value) {
  const record = asRecord(value);
  if (!record) return 0;
  const payload = asRecord(record.payload);
  const candidates = [
    readDurationMs(record.duration_ms, 'ms'),
    readDurationMs(record.durationMs, 'ms'),
    readDurationMs(record.elapsed_ms, 'ms'),
    readDurationMs(record.elapsedMs, 'ms'),
    readDurationMs(record.duration, 'auto'),
    readDurationMs(payload?.duration_ms, 'ms'),
    readDurationMs(payload?.durationMs, 'ms'),
    readDurationMs(payload?.elapsed_ms, 'ms'),
    readDurationMs(payload?.elapsedMs, 'ms'),
    readDurationMs(payload?.duration, 'auto'),
  ];
  return Math.max(0, ...candidates.filter((value) => Number.isFinite(value)));
}

function readDurationMs(value, unit) {
  if (!isFiniteNumber(value) || value <= 0) return 0;
  if (unit === 'ms') return Math.floor(value);
  return value < 10000 ? Math.floor(value * 1000) : Math.floor(value);
}

function extractToolCalls(value) {
  const names = [];
  const record = asRecord(value);
  const payload = asRecord(record?.payload);
  collectToolCallNames(record, names);
  collectToolCallNames(payload, names);
  return Array.from(new Set(names.map(normalizeToolCallName).filter(Boolean)));
}

function extractBehaviorFlags(value) {
  const record = asRecord(value) || {};
  const payload = asRecord(record.payload) || {};
  const message = asRecord(record.message) || {};
  const payloadMessage = asRecord(payload.message) || {};
  const rootType = normalizeChoiceToken(record.type);
  const payloadType = normalizeChoiceToken(payload.type);
  const rootRole = normalizeChoiceToken(record.role);
  const payloadRole = normalizeChoiceToken(payload.role);
  const messageRole = normalizeChoiceToken(message.role);
  const payloadMessageRole = normalizeChoiceToken(payloadMessage.role);
  const isUserTurn =
    rootType === 'user' ||
    payloadType === 'usermessage' ||
    rootRole === 'user' ||
    payloadRole === 'user' ||
    messageRole === 'user' ||
    payloadMessageRole === 'user' ||
    (rootType === 'responseitem' && payloadType === 'message' && payloadRole === 'user');
  const isAssistantTurn =
    rootType === 'assistant' ||
    payloadType === 'agentmessage' ||
    rootRole === 'assistant' ||
    payloadRole === 'assistant' ||
    messageRole === 'assistant' ||
    payloadMessageRole === 'assistant' ||
    (rootType === 'responseitem' && payloadType === 'message' && payloadRole === 'assistant');
  return { isUserTurn, isAssistantTurn };
}

function extractUserPromptText(value) {
  const record = asRecord(value) || {};
  const payload = asRecord(record.payload) || {};
  const message = asRecord(record.message) || {};
  const payloadMessage = asRecord(payload.message) || {};
  const candidates = [];
  const pushText = (candidate) => {
    const text = promptContentToText(candidate);
    if (text) candidates.push(text);
  };

  pushText(record.content);
  pushText(record.text);
  pushText(record.prompt);
  pushText(record.input);
  pushText(payload.content);
  pushText(payload.text);
  pushText(payload.prompt);
  pushText(payload.input);
  pushText(message.content);
  pushText(message.text);
  pushText(payloadMessage.content);
  pushText(payloadMessage.text);

  const messageArrays = [
    record.messages,
    payload.messages,
    record.conversation,
    payload.conversation,
  ].filter(Array.isArray);
  for (const messages of messageArrays) {
    const userMessages = messages
      .map(asRecord)
      .filter(Boolean)
      .filter((item) => normalizeChoiceToken(item.role) === 'user');
    const latest = userMessages[userMessages.length - 1];
    if (latest) {
      pushText(latest.content);
      pushText(latest.text);
      pushText(latest.message);
    }
  }

  return candidates
    .map(cleanPromptStyleText)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] || '';
}

function promptContentToText(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return '';
  if (Array.isArray(value)) {
    return value
      .slice(0, 40)
      .map((item) => promptContentToText(item, depth + 1))
      .filter(Boolean)
      .join('\n');
  }
  const record = asRecord(value);
  if (!record) return '';
  const direct =
    stringValue(record.text) ||
    stringValue(record.content) ||
    stringValue(record.value) ||
    stringValue(record.message);
  if (direct) return direct;
  const nested = [];
  for (const key of ['parts', 'segments', 'items']) {
    if (Array.isArray(record[key])) nested.push(promptContentToText(record[key], depth + 1));
  }
  return nested.filter(Boolean).join('\n');
}

function categorizeToolForBehavior(name) {
  const key = normalizeToolCallName(name) || '';
  const normalized = normalizeChoiceToken(key);
  if (!normalized) return { id: 'other', label: 'Other' };
  if (
    normalized.includes('updateplan') ||
    normalized.includes('todowrite') ||
    normalized.includes('taskexplore') ||
    normalized === 'plan'
  ) {
    return { id: 'planning', label: 'Planning' };
  }
  if (
    normalized.includes('applypatch') ||
    normalized.includes('edit') ||
    normalized.includes('writefile') ||
    normalized.includes('replace') ||
    normalized.includes('createfile')
  ) {
    return { id: 'edit', label: 'Edit' };
  }
  if (
    normalized.includes('search') ||
    normalized.includes('grep') ||
    normalized.includes('find') ||
    normalized.includes('rg')
  ) {
    return { id: 'search', label: 'Search' };
  }
  if (
    normalized.includes('read') ||
    normalized.includes('open') ||
    normalized.includes('view') ||
    normalized.includes('list')
  ) {
    return { id: 'read', label: 'Read' };
  }
  if (
    normalized.includes('exec') ||
    normalized.includes('bash') ||
    normalized.includes('shell') ||
    normalized.includes('terminal') ||
    normalized.includes('stdin')
  ) {
    return { id: 'shell', label: 'Shell' };
  }
  if (normalized.includes('browser') || normalized.includes('chrome') || normalized.includes('page')) {
    return { id: 'browser', label: 'Browser' };
  }
  if (normalized.includes('mcp') || normalized.includes('tool')) {
    return { id: 'tooling', label: 'Tooling' };
  }
  return { id: 'other', label: 'Other' };
}

export function behaviorCategoryLabel(id) {
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

function inferSessionPlanningSignal(behavior) {
  const categories = behavior.firstToolCategories || [];
  if (!categories.length) return false;
  if (categories.includes('planning')) return true;
  const executionIndex = categories.findIndex((category) => ['edit'].includes(category));
  const earlyWindow = executionIndex >= 0 ? categories.slice(0, executionIndex) : categories.slice(0, 5);
  const explorationCount = earlyWindow.filter((category) => ['read', 'search', 'browser', 'planning'].includes(category)).length;
  const shellProbeCount = earlyWindow.filter((category) => category === 'shell').length;
  return explorationCount >= 2 || (explorationCount >= 1 && shellProbeCount >= 1) || (shellProbeCount >= 2 && executionIndex >= 2);
}

function summarizeBehaviorProfile(sessionBehaviors, toolUsage, period) {
  const profile = createEmptyBehaviorProfile(period?.id, period?.label);
  const observed = (Array.isArray(sessionBehaviors) ? sessionBehaviors : [])
    .filter((behavior) => behavior && (behavior.userTurnCount > 0 || behavior.toolCallCount > 0 || behavior.assistantTurnCount > 0));
  profile.sessionCount = Array.isArray(sessionBehaviors) ? sessionBehaviors.length : 0;
  profile.observedSessionCount = observed.length;
  if (!observed.length) {
    profile.evidence = ['No behavior events found in local session metadata'];
    return profile;
  }

  const toolRunLengths = [];
  const sessionDurations = [];
  const categoryCounts = new Map();
  for (const behavior of observed) {
    profile.userTurnCount += behavior.userTurnCount || 0;
    profile.assistantTurnCount += behavior.assistantTurnCount || 0;
    profile.toolCallCount += behavior.toolCallCount || 0;
    profile.steeringTurnCount += behavior.steeringTurnCount || 0;
    if (behavior.hasPlanningSignal) profile.plannedSessionCount += 1;
    if (behavior.hasSteeringSignal) profile.steeredSessionCount += 1;
    for (const length of behavior.toolRunLengths || []) {
      if (Number.isFinite(length) && length > 0) toolRunLengths.push(length);
    }
    if (Number.isFinite(behavior.sessionDurationMinutes) && behavior.sessionDurationMinutes > 0) {
      sessionDurations.push(behavior.sessionDurationMinutes);
    }
    for (const [category, count] of Object.entries(behavior.toolCategoryCounts || {})) {
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + count);
    }
  }

  profile.planningRatio = round(profile.plannedSessionCount / observed.length, 3);
  profile.steeringRatio = profile.userTurnCount > 0 ? round(profile.steeringTurnCount / profile.userTurnCount, 3) : 0;
  profile.toolRunCount = toolRunLengths.length;
  profile.averageToolRunLength = round(average(toolRunLengths), 1);
  profile.medianToolRunLength = round(median(toolRunLengths), 1);
  profile.longestToolRun = Math.max(0, ...toolRunLengths);
  profile.medianSessionMinutes = round(median(sessionDurations), 1);
  profile.averageSessionMinutes = round(average(sessionDurations), 1);
  const autonomyComponents = {
    medianToolRunScore: round(clamp((profile.medianToolRunLength - 1) / 24, 0, 1), 3),
    averageToolRunScore: round(clamp((profile.averageToolRunLength - 1) / 40, 0, 1), 3),
    longestToolRunScore: round(clamp(Math.log1p(profile.longestToolRun) / Math.log1p(300), 0, 1), 3),
    medianSessionScore: round(clamp((profile.medianSessionMinutes - 10) / 80, 0, 1), 3),
  };
  profile.autonomyComponents = autonomyComponents;
  profile.autonomyScore = round(clamp(
    autonomyComponents.medianToolRunScore * 0.4 +
    autonomyComponents.averageToolRunScore * 0.25 +
    autonomyComponents.longestToolRunScore * 0.2 +
    autonomyComponents.medianSessionScore * 0.15,
    0,
    1
  ), 2);
  profile.autonomyLevel = autonomyLevel(profile.autonomyScore);

  const categoryTotal = Array.from(categoryCounts.values()).reduce((sum, count) => sum + count, 0);
  profile.topToolsMix = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({
      category,
      label: behaviorCategoryLabel(category),
      count,
      share: categoryTotal > 0 ? round(count / categoryTotal, 3) : 0,
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 8);
  profile.dominantToolCategory = profile.topToolsMix[0]?.category || 'none';
  profile.evidence = [
    `${profile.plannedSessionCount}/${observed.length} sessions show pre-edit exploration/planning`,
    `${profile.steeringTurnCount} steering turn(s) after initial prompts`,
    `${profile.medianToolRunLength} median tool calls per user handoff, ${profile.medianSessionMinutes}m median session`,
    profile.topToolsMix[0]
      ? `${profile.topToolsMix[0].label} leads tool mix at ${formatPercent(profile.topToolsMix[0].share)}`
      : `${toolUsage?.toolCallCount || 0} tool call(s) detected`,
  ];
  return profile;
}

function collectToolCallNames(value, names, depth = 0, seen = new Set()) {
  if (depth > 6 || !value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 80)) collectToolCallNames(item, names, depth + 1, seen);
    return;
  }

  const record = asRecord(value);
  const type = normalizeChoiceToken(record?.type);
  if ([
    'functioncall',
    'customtoolcall',
    'tooluse',
    'toolcall',
    'websearchcall',
    'toolsearchcall',
    'mcp_tool_call_end',
    'mcp_tool_call_start',
  ].includes(type)) {
    const directName =
      stringValue(record.name) ||
      stringValue(record.tool_name) ||
      stringValue(record.toolName) ||
      stringValue(record.function?.name) ||
      stringValue(record.action?.type);
    if (directName) names.push(directName);
    if (type === 'websearchcall') names.push('web.search');
    if (type === 'toolsearchcall') names.push('tool_search');
  }

  const invocation = asRecord(record?.invocation);
  if (invocation) {
    const server = stringValue(invocation.server) || stringValue(invocation.serverName) || stringValue(invocation.namespace);
    const tool = stringValue(invocation.tool) || stringValue(invocation.toolName) || stringValue(invocation.name);
    if (tool) names.push(server ? `${server}.${tool}` : tool);
  }

  for (const [key, child] of Object.entries(record || {})) {
    const normalizedKey = normalizeChoiceToken(key);
    if (['prompt', 'prompts', 'output'].includes(normalizedKey) && !Array.isArray(child)) continue;
    collectToolCallNames(child, names, depth + 1, seen);
  }
}

function normalizeToolCallName(value) {
  const text = cleanText(value, 120);
  if (!text) return undefined;
  return text
    .replace(/^functions\./, '')
    .replace(/^mcp__/, 'mcp:')
    .replace(/__+/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSessionId(value) {
  const record = asRecord(value);
  if (!record) return undefined;
  const payload = asRecord(record.payload);
  const message = asRecord(record.message);
  return stringValue(record.sessionId) || stringValue(record.session_id) || stringValue(record.session) || stringValue(payload?.sessionId) || stringValue(payload?.session_id) || stringValue(payload?.id) || stringValue(message?.sessionId);
}

function extractUsageTimestamp(value) {
  const record = asRecord(value);
  if (!record) return undefined;
  const payload = asRecord(record.payload);
  const info = asRecord(payload?.info);
  const message = asRecord(record.message);
  return firstValidIsoDateString([
    record.timestamp,
    record.created_at,
    record.updated_at,
    payload?.timestamp,
    payload?.started_at,
    payload?.completed_at,
    payload?.created_at,
    payload?.updated_at,
    info?.timestamp,
    message?.timestamp,
    message?.created_at,
  ]);
}

function extractUsageEventId(value) {
  const record = asRecord(value);
  if (!record) return undefined;
  const payload = asRecord(record.payload);
  const message = asRecord(record.message);
  return stringValue(message?.id) || stringValue(record.uuid) || stringValue(record.id) || stringValue(record.turn_id) || stringValue(payload?.id) || stringValue(payload?.turn_id);
}

export function firstValidIsoDateString(values) {
  for (const value of values) {
    const candidate = stringValue(value);
    if (!candidate) continue;
    const timestamp = new Date(candidate).getTime();
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return undefined;
}

export function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

export function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function readNumberFields(record, names) {
  let total = 0;
  for (const name of names) {
    const value = record[name];
    if (isFiniteNumber(value)) total += Math.max(0, Math.floor(value));
  }
  return total;
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function createZeroUsageNumbers() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

function hasAnyUsage(numbers) {
  return numbers.totalTokens > 0 || numbers.inputTokens > 0 || numbers.outputTokens > 0;
}

function mergeUsageNumbers(target, input) {
  target.inputTokens += input.inputTokens;
  target.outputTokens += input.outputTokens;
  target.cacheReadTokens += input.cacheReadTokens;
  target.cacheCreationTokens += input.cacheCreationTokens;
  target.reasoningTokens += input.reasoningTokens;
  target.totalTokens += input.totalTokens;
}

function usageSignature(numbers) {
  return [
    numbers.inputTokens,
    numbers.outputTokens,
    numbers.cacheReadTokens,
    numbers.cacheCreationTokens,
    numbers.reasoningTokens,
    numbers.totalTokens,
  ].join(':');
}
