#!/usr/bin/env node

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  exists,
  getDefaultOutputPath,
  getFlag,
  getHomeDir,
  hasFlag,
  normalizeUsagePeriodId,
  parseArgs,
  readNumberFlag,
  redactPath,
  stableId,
} from './cli.mjs';
import {
  fetchCreatorMetricsFromWorker,
  loadCreatorMetrics,
  mergeCreatorMetrics,
} from './creator-metrics.mjs';
import {
  fetchTakuCreatorProfile,
  normalizeTakuCreatorProfile,
} from './creator-profile.mjs';
import {
  editorStatePathFor,
  previewPathFor,
  readEditorState,
  readJsonFile,
  readPrivateState,
  writeEditorState,
  writeJson,
  writePrivateState,
  writeText,
} from './draft-state.mjs';
import {
  buildTakuLoginUrl,
  readIconAuthToken,
  readPublishToken,
  resolveSiteUrl,
  resolveWorkerUrl,
} from './publish-config.mjs';
import {
  buildPersonaIdentity,
  buildPersonaSignals,
  buildPersonaV2,
  loadPersonaRules,
  normalizePersonaTone,
} from './persona.mjs';
import { hydrateDraftListingDrafts } from './listing-drafts.mjs';
import {
  createPublishContext,
  renderPreview,
} from './editor-renderer.mjs';
import { startEditorServer } from './editor-server.mjs';
import { DEFAULT_MAX_PROJECT_REPOS } from './project-metadata.mjs';
import {
  DRAFT_SCHEMA,
  buildDraft,
  fallbackCreationChoicesFromDraft,
  fallbackToolChoicesFromDraft,
  refreshBuilderProfileSnapshot,
  selectDisplayedCreations,
  selectDisplayedTools,
} from './draft.mjs';
import { publishDraftToTaku } from './publish-flow.mjs';
import {
  createPrivateInventory,
  publicItem,
  scanOwnedCreations,
  scanUsedTools,
} from './scan.mjs';
import {
  DEFAULT_MAX_USAGE_BYTES,
  DEFAULT_MAX_USAGE_FILE_BYTES,
  DEFAULT_MAX_USAGE_FILES,
  DEFAULT_USAGE_SCAN_TIMEOUT_MS,
  createEmptyUsageSummary,
  scanUsage,
} from './usage.mjs';
import {
  loadReferencePricing,
  resolveReferencePricingUrl,
} from './usage-pricing-client.mjs';
import { buildAiSetupSnapshot } from './ai-setup.mjs';
import {
  runCreatorCenterList,
  runCreatorCenterShow,
  runCreatorCenterStats,
  runCreatorCenterUnpublish,
  runCreatorCenterUpdate,
} from './creator-center.mjs';
import { compactScanCommandResult } from './host-output.mjs';
import {
  detectInvokingAiClient,
  discoverAiClients,
} from './host-platform.mjs';

const VERSION = '0.2.4';
const SCAN_SCHEMA = 'taku.creator.scan.v1';
const DEFAULT_INCLUDE_CREATION_CANDIDATES = false;
const READONLY_PREVIEW_OPTIONS = { readonlyPreview: true };
const DETACHED_EDITOR_START_TIMEOUT_MS = 60000;
function shouldIncludeCreationCandidates(parsed) {
  if (hasFlag(parsed, 'include-creation-candidates') || hasFlag(parsed, 'include-built-candidates')) return true;
  if (hasFlag(parsed, 'no-creation-candidates') || hasFlag(parsed, 'no-built-candidates')) return false;
  const envValue = String(process.env.TAKU_INCLUDE_CREATION_CANDIDATES || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(envValue)) return true;
  if (['0', 'false', 'no', 'off'].includes(envValue)) return false;
  return DEFAULT_INCLUDE_CREATION_CANDIDATES;
}

function shouldIncludePromptStyle(parsed) {
  if (hasFlag(parsed, 'include-prompt-style') || hasFlag(parsed, 'prompt-style') || hasFlag(parsed, 'analyze-prompts')) return true;
  if (hasFlag(parsed, 'no-prompt-style') || hasFlag(parsed, 'no-analyze-prompts')) return false;
  const envValue = String(process.env.TAKU_INCLUDE_PROMPT_STYLE || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(envValue)) return true;
  if (['0', 'false', 'no', 'off'].includes(envValue)) return false;
  return false;
}

async function scan(parsed, options = {}) {
  const workspaceRoot = path.resolve(getFlag(parsed, 'workspace') || parsed.positionals[1] || process.cwd());
  const usagePeriodId = normalizeUsagePeriodId(getFlag(parsed, 'usage-period'));
  const personaRulesResult = await loadPersonaRules(parsed);
  const localOnly = hasFlag(parsed, 'local-only');
  const usageDisabled = hasFlag(parsed, 'no-usage');
  const referencePricingPromise = usageDisabled
    ? Promise.resolve({ source: 'disabled' })
    : loadReferencePricing({
        homeDir: getHomeDir(),
        localOnly,
        url: resolveReferencePricingUrl(parsed),
      });
  const [localCreatorMetrics, workerCreatorMetrics, creatorProfileResult] = await Promise.all([
    loadCreatorMetrics(parsed),
    localOnly ? Promise.resolve(null) : fetchCreatorMetricsFromWorker(parsed),
    localOnly
      ? Promise.resolve({ profile: null, warning: undefined })
      : fetchCreatorProfileForScan(parsed),
  ]);
  const creatorProfile = creatorProfileResult?.profile || null;
  const staxProfile = creatorProfileResult?.staxProfile || null;
  const creatorMetrics = mergeCreatorMetrics(localCreatorMetrics, workerCreatorMetrics);
  const personaTone = normalizePersonaTone(getFlag(parsed, 'persona-tone') || getFlag(parsed, 'tone'), personaRulesResult.rules);
  const includeCreationCandidates = shouldIncludeCreationCandidates(parsed);
  const includeGitHubMetrics = hasFlag(parsed, 'include-github-metrics') || hasFlag(parsed, 'github-metrics');
  const includePromptStyle = shouldIncludePromptStyle(parsed);
  const invokingAiClient = await detectInvokingAiClient({
    explicitHost: getFlag(parsed, 'ai-host') || getFlag(parsed, 'creator-host'),
    moduleUrl: import.meta.url,
  });
  const used = await scanUsedTools(workspaceRoot);
  const referencePricing = await referencePricingPromise;
  const [ownedCreations, usage] = await Promise.all([
    includeCreationCandidates
      ? scanOwnedCreations(workspaceRoot, used.tools)
      : Promise.resolve([]),
    usageDisabled
      ? Promise.resolve(createEmptyUsageSummary(usagePeriodId))
      : scanUsage({
          maxFiles: readNumberFlag(parsed, 'max-usage-files', DEFAULT_MAX_USAGE_FILES),
          maxBytes: readNumberFlag(parsed, 'max-usage-bytes', DEFAULT_MAX_USAGE_BYTES),
          maxFileBytes: readNumberFlag(parsed, 'max-usage-file-bytes', DEFAULT_MAX_USAGE_FILE_BYTES),
          timeoutMs: readNumberFlag(parsed, 'usage-scan-timeout-ms', DEFAULT_USAGE_SCAN_TIMEOUT_MS),
          usagePeriodId,
          includePromptStyle,
        }),
  ]);
  if (referencePricing.warning && Array.isArray(usage.warnings)) {
    usage.warnings.push(referencePricing.warning);
  }
  const personaSignals = await buildPersonaSignals({
    usage,
    usedTools: used.tools,
    ownedCreations,
    workspaceRoot,
    maxProjectRepos: readNumberFlag(parsed, 'max-project-repos', DEFAULT_MAX_PROJECT_REPOS),
    creatorMetrics,
    includeGitHubMetrics,
  });
  const personaV2 = buildPersonaV2(personaSignals, {
    rules: personaRulesResult.rules,
    tone: personaTone,
    rulesSource: personaRulesResult.source,
    rulesPath: personaRulesResult.path,
    warnings: personaRulesResult.warnings,
  });
  const personaIdentity = personaV2.identity || buildPersonaIdentity(personaV2);
  const aiIdentity = await discoverAiClients({
    invokingHost: invokingAiClient,
    homeDir: getHomeDir(),
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    usageSources: usage.sources,
  });
  const result = {
    schemaVersion: SCAN_SCHEMA,
    generatedAt: new Date().toISOString(),
    privacy: {
      uploads: false,
      promptContentRead: includePromptStyle,
      promptContentUploaded: false,
      sourceContentUploaded: false,
      envVarsUploaded: false,
      tokensUploaded: false,
      localPathsIncluded: false,
    },
    ...(creatorProfile ? { creatorProfile } : {}),
    ...(staxProfile ? { staxProfile } : {}),
    workspace: {
      path: redactPath(workspaceRoot),
    },
    roots: used.roots,
    usedTools: used.tools.map((item) => publicItem(item, 'used')),
    creationCandidates: ownedCreations.map((item) => publicItem(item, 'candidate')),
    ownedCreations: ownedCreations.map((item) => publicItem(item, 'candidate')),
    aiIdentity,
    usage,
    personaSignals,
    behaviorProfileV1: personaSignals.behaviorProfileV1 || personaSignals.behaviorProfile,
    personaV2,
    basePersona: personaIdentity.basePersona,
    featuredHidden: personaIdentity.hidden?.featured || null,
    badges: personaIdentity.badges || [],
    summary: {
      usedToolCount: used.tools.length,
      ownedCreationCount: ownedCreations.length,
      creationCandidateCount: ownedCreations.length,
      usagePeriodId: usage.primaryPeriodId,
      usagePeriodLabel: usage.periodLabel,
      usageTokenCount: usage.totalTokens,
      usageSessionCount: usage.sessionCount,
      personaCode: personaV2.code,
      personaTitle: personaV2.archetype.title,
      personaTone: personaV2.tone,
      behaviorPlanningRatio: personaSignals.behaviorProfile?.planningRatio || 0,
      behaviorSteeringRatio: personaSignals.behaviorProfile?.steeringRatio || 0,
      behaviorAutonomyScore: personaSignals.behaviorProfile?.autonomyScore || 0,
      behaviorDominantToolCategory: personaSignals.behaviorProfile?.dominantToolCategory || 'none',
      creationCandidatesEnabled: includeCreationCandidates,
      creatorMetricsSourceCount: personaSignals.external?.sourceCount || 0,
      creatorMetricsSources: personaSignals.external?.sources || [],
      githubMetricsEnabled: includeGitHubMetrics,
      promptStyleEnabled: includePromptStyle,
      creatorProfileSynced: Boolean(creatorProfile),
      creatorProfileWarning: creatorProfileResult?.warning,
      defaultAiClient: aiIdentity.defaultClient,
      availableAiClients: aiIdentity.options.map((item) => item.id),
    },
  };
  if (options.includePrivateInventory) {
    Object.defineProperty(result, '__privateInventory', {
      value: createPrivateInventory([...used.tools, ...ownedCreations]),
      enumerable: false,
    });
  }
  return result;
}

async function fetchCreatorProfileForScan(parsed) {
  const token = readPublishToken(parsed);
  if (!token) return { profile: null, warning: 'Taku account profile skipped: missing local Creator Profile authorization.' };
  try {
    const result = await fetchTakuCreatorProfile({
      workerUrl: resolveWorkerUrl(parsed),
      token,
    });
    if (!result.ok) {
      return {
        profile: await fallbackCreatorProfileFromToken(token),
        warning: `Taku account profile endpoint skipped: ${result.error}`,
      };
    }
    return {
      profile: result.profile,
      staxProfile: result.staxProfile || null,
      warning: undefined,
    };
  } catch (error) {
    return {
      profile: await fallbackCreatorProfileFromToken(token),
      warning: `Taku account profile endpoint skipped: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function fallbackCreatorProfileFromToken(token) {
  const profile = await normalizeTakuCreatorProfile(null, token);
  return profile?.displayName || profile?.avatarUrl ? profile : null;
}

async function createDraftResult(parsed) {
  const scanResult = await scan(parsed, { includePrivateInventory: true });
  const toolChoices = selectDisplayedTools(scanResult.usedTools, parsed);
  const creationChoices = selectDisplayedCreations(scanResult.ownedCreations, parsed);
  let draft = buildDraft(scanResult, toolChoices, creationChoices);
  ({ draft } = await hydrateDraftListingDrafts(parsed, draft, toolChoices, {
    includeStoredDrafts: hasFlag(parsed, 'reuse-listing-drafts'),
  }));
  const output = path.resolve(getFlag(parsed, 'output') || getDefaultOutputPath('draft'));
  const previewPath = path.resolve(getFlag(parsed, 'preview') || previewPathFor(output));
  await writeJson(output, draft);
  await writeText(previewPath, renderPreview({ ...draft, __toolChoices: toolChoices, __creationChoices: creationChoices }, READONLY_PREVIEW_OPTIONS));
  const privateInventory = scanResult.__privateInventory;
  const privateStatePath = await writePrivateState(output, privateInventory);
  const editorStatePath = await writeEditorState(output, { previewPath, toolChoices, creationChoices });
  const result = {
    ok: true,
    schemaVersion: 'taku.creator.draft-result.v1',
    draftPath: output,
    previewPath,
    previewUrl: pathToFileURL(previewPath).toString(),
    editorStatePath,
    privateStatePath,
    summary: draft.stats,
    toolChoices,
    creationChoices,
    draft,
  };
  Object.defineProperty(result, 'privateInventory', {
    value: privateInventory,
    enumerable: false,
  });
  return result;
}

async function runDraft(parsed) {
  const result = await createDraftResult(parsed);
  if (hasFlag(parsed, 'editor')) {
    if (!hasFlag(parsed, 'foreground-editor')) {
      return startDetachedEditorServer(parsed, result);
    }
    return startEditorServer(parsed, result);
  }
  return result;
}

async function startDetachedEditorServer(parsed, draftResult) {
  const childArgs = [
    fileURLToPath(import.meta.url),
    'editor',
    '--json',
    '--draft',
    draftResult.draftPath,
    '--preview',
    draftResult.previewPath,
  ];
  for (const [name, value] of parsed.flags.entries()) {
    if (['draft', 'editor', 'foreground-editor', 'json', 'output', 'preview'].includes(name)) continue;
    childArgs.push(`--${name}`);
    if (value !== true) childArgs.push(String(value));
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, {
      detached: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let settled = false;
    let stdout = '';
    let stderr = '';
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.destroy();
      child.stderr?.destroy();
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const tryResolve = () => {
      try {
        const payload = JSON.parse(stdout);
        if (!payload || typeof payload !== 'object') return;
        child.unref();
        settle(resolve, {
          ...payload,
          detached: true,
          editorProcessId: child.pid,
        });
      } catch {
        // The editor command prints formatted JSON; keep reading until complete.
      }
    };
    const timer = setTimeout(() => {
      settle(reject, new Error(`Timed out waiting for the editor URL.${stderr ? ` ${stderr.trim()}` : ''}`));
    }, DETACHED_EDITOR_START_TIMEOUT_MS);
    child.stdout?.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      tryResolve();
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => settle(reject, error));
    child.once('exit', (code) => {
      if (!settled) {
        settle(reject, new Error(`Editor exited before returning a URL (code ${code ?? 1}).${stderr ? ` ${stderr.trim()}` : ''}`));
      }
    });
  });
}

async function readDraft(filePath) {
  const draft = await readJsonFile(path.resolve(filePath));
  if (!draft || draft.schemaVersion !== DRAFT_SCHEMA) {
    throw new Error(`Draft file is not a ${DRAFT_SCHEMA} document.`);
  }
  return draft;
}

async function runEditor(parsed) {
  const draftPath = getFlag(parsed, 'draft');
  if (draftPath) {
    const resolvedDraftPath = path.resolve(draftPath);
    let draft = await readDraft(resolvedDraftPath);
    const state = await readEditorState(resolvedDraftPath);
    const previewPath = path.resolve(getFlag(parsed, 'preview') || state?.previewPath || previewPathFor(resolvedDraftPath));
    const toolChoices = state?.toolChoices || fallbackToolChoicesFromDraft(draft);
    const creationChoices = state?.creationChoices || fallbackCreationChoicesFromDraft(draft);
    ({ draft } = await hydrateDraftListingDrafts(parsed, draft, toolChoices, {
      includeStoredDrafts: hasFlag(parsed, 'reuse-listing-drafts'),
      persist: true,
    }));
    draft = refreshBuilderProfileSnapshot(draft);
    await writeJson(resolvedDraftPath, draft);
    await writeText(previewPath, renderPreview({ ...draft, __toolChoices: toolChoices, __creationChoices: creationChoices }, READONLY_PREVIEW_OPTIONS));
    return startEditorServer(parsed, {
      ok: true,
      schemaVersion: 'taku.creator.draft-result.v1',
      draftPath: resolvedDraftPath,
      previewPath,
      previewUrl: pathToFileURL(previewPath).toString(),
      editorStatePath: editorStatePathFor(resolvedDraftPath),
      summary: draft.stats,
      toolChoices,
      creationChoices,
      draft,
    });
  }
  const result = await createDraftResult(parsed);
  return startEditorServer(parsed, result);
}

async function runPublish(parsed) {
  const draftPath = getFlag(parsed, 'draft');
  if (!draftPath) throw new Error('Missing --draft <file>.');
  const draft = await readDraft(draftPath);
  const privateState = await readPrivateState(draftPath);
  const privateInventory = privateState?.privateInventory;
  const workerUrl = resolveWorkerUrl(parsed);
  const siteUrl = resolveSiteUrl(parsed);
  const token = readPublishToken(parsed);
  const avatarUploadToken = readIconAuthToken(parsed);
  if (!workerUrl) {
    return {
      ok: false,
      needsConfig: 'worker-url',
      message: 'Set TAKU_WORKER_URL or pass --worker-url to sync.',
      draftPath: path.resolve(draftPath),
    };
  }
  if (!token) {
    return {
      ok: false,
      needsAuth: true,
      message: 'Set TAKU_BEARER_TOKEN or pass --bearer-token to sync. Do not paste tokens into chat.',
      draftPath: path.resolve(draftPath),
      loginUrl: buildTakuLoginUrl(parsed, { draftPath: path.resolve(draftPath) }),
    };
  }
  return publishDraftToTaku({
    draft,
    privateInventory,
    workerUrl,
    token,
    avatarUploadToken,
    siteUrl,
    context: createPublishContext(),
  });
}

function printUsage() {
  console.log(`Usage:
  node scripts/taku_creator.mjs doctor --json
  node scripts/taku_creator.mjs scan --json [--compact] [--workspace <dir>] [--usage-period today|last7Days|last30Days|last90Days|thisMonth|allTimeLocal] [--persona-tone brainrot] [--persona-rules <json>] [--creator-metrics <json>] [--fetch-creator-stats] [--include-github-metrics] [--include-prompt-style]
  node scripts/taku_creator.mjs ai-setup --json [--workspace <dir>] [--usage-period today|last7Days|last30Days|last90Days|thisMonth|allTimeLocal]
  node scripts/taku_creator.mjs draft --json [--editor] [--foreground-editor] [--workspace <dir>] [--usage-period today|last7Days|last30Days|last90Days|thisMonth|allTimeLocal] [--persona-tone brainrot] [--persona-rules <json>] [--creator-metrics <json>] [--fetch-creator-stats] [--include-github-metrics] [--include-prompt-style] [--tool-limit <n>] [--display-tools <ids,names,or indexes>] [--hide-tools <ids,names,or indexes>] [--creation-limit <n>] [--display-creations <ids,names,or indexes>] [--hide-creations <ids,names,or indexes>] [--reuse-listing-drafts] [--worker-url <url>] [--site-url <url>] [--output <file>]
  node scripts/taku_creator.mjs editor --json [--draft <file>] [--workspace <dir>] [--port <port>] [--site-url <url>] [--worker-url <url>] [--reuse-listing-drafts]
  node scripts/taku_creator.mjs publish --json --draft <file> [--worker-url <url>] [--site-url <url>]
  node scripts/taku_creator.mjs center-list --json [--type <type>] [--status <status>] [--search <text>] [--limit <n>] [--offset <n>]
  node scripts/taku_creator.mjs center-show --json --item-id <id>
  node scripts/taku_creator.mjs center-stats --json
  node scripts/taku_creator.mjs center-update --json --item-id <id> [--name <text>] [--short-description <text>] [--description <text>] [--tags <csv>] [--categories <csv>] [--metadata <json>]

This script is bundled with the Taku Creator skill. It does not require Taku Desktop.`);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.positionals[0];
  if (!command || command === 'help' || hasFlag(parsed, 'help')) {
    printUsage();
    return 0;
  }
  let result;
  if (command === 'doctor') {
    result = {
      ok: true,
      name: 'taku_creator',
      version: VERSION,
      runtime: 'node',
      platform: process.platform,
      arch: process.arch,
      desktopRequired: false,
      commands: [
        'doctor',
        'scan',
        'ai-setup',
        'draft',
        'editor',
        'publish',
        'center-list',
        'center-show',
        'center-stats',
        'center-update',
        'center-unpublish',
      ],
    };
  } else if (command === 'scan') {
    result = await scan(parsed);
    if (hasFlag(parsed, 'compact')) result = compactScanCommandResult(result);
  } else if (command === 'ai-setup') {
    const scanResult = await scan(parsed, { includePrivateInventory: true });
    result = buildAiSetupSnapshot(scanResult, scanResult.__privateInventory);
  } else if (command === 'draft') {
    result = await runDraft(parsed);
  } else if (command === 'editor') {
    result = await runEditor(parsed);
  } else if (command === 'publish') {
    result = await runPublish(parsed);
  } else if (command === 'center-list') {
    result = await runCreatorCenterList(parsed);
  } else if (command === 'center-show') {
    result = await runCreatorCenterShow(parsed);
  } else if (command === 'center-stats') {
    result = await runCreatorCenterStats(parsed);
  } else if (command === 'center-update') {
    result = await runCreatorCenterUpdate(parsed);
  } else if (command === 'center-unpublish') {
    result = await runCreatorCenterUnpublish(parsed);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  if (hasFlag(parsed, 'json') || command !== 'help') {
    console.log(JSON.stringify(result, null, 2));
  }
  return result?.ok === false ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
