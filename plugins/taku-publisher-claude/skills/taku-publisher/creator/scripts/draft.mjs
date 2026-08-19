import {
  getFlag,
  hasFlag,
  normalizeChoiceToken,
  readNumberFlag,
} from './cli.mjs';
import {
  cleanText,
  isRecord,
  publicHttpUrl,
} from './privacy.mjs';
import { buildPersonaProfileV1 } from '#taku-passport-core';
import {
  applyPersonaOverrides,
  buildPersonaIdentity,
  formatPercent,
  personaSignatureFor,
  publicHiddenPersona,
} from './persona.mjs';
import { getDraftSectionItems } from './publish-payload.mjs';
import {
  asRecord,
  behaviorCategoryLabel,
  createEmptyBehaviorProfile,
  createEmptyModelUsageSummary,
  createEmptyPromptStyleSummary,
  round,
} from './usage.mjs';
import { createEmptyEstimatedCostSummary } from './usage-pricing.mjs';
import { buildStaxBlocks } from './stax-blocks.mjs';

export const DRAFT_SCHEMA = 'taku.creator.draft.v1';
export const BUILDER_PROFILE_SNAPSHOT_SCHEMA = 'taku.creator.builder-profile-snapshot.v1';

const DEFAULT_DISPLAY_TOOL_LIMIT = 0;
const STAX_CARD_FEATURED_TOOL_LIMIT = 3;
const DEFAULT_DISPLAY_CREATION_LIMIT = 12;
const CREATION_ROLES = new Set(['using', 'made', 'remixed', 'hidden']);
const DRAFT_SECTION_ALIASES = new Map([
  ['using-tools', ['using-tools', 'used-tools', 'used-candidates']],
  ['made-items', ['made-items', 'owned-creations']],
  ['remixed-items', ['remixed-items']],
  ['hidden-items', ['hidden-items']],
  ['creator-tools', ['creator-tools']],
]);

export function buildDraft(scanResult, toolSelection, creationSelection) {
  const creatorProfile = isRecord(scanResult.creatorProfile) ? scanResult.creatorProfile : {};
  const creatorName = cleanText(
    creatorProfile.displayName
    || process.env.TAKU_CREATOR_NAME
    || process.env.TAKU_CREATOR_DISPLAY_NAME,
    120,
  );
  const creatorAvatarUrl = publicHttpUrl(
    creatorProfile.avatarUrl || process.env.TAKU_CREATOR_AVATAR_URL,
  );
  const allCreatorTools = getToolSelectionItemsForDraft(toolSelection);
  const staxTools = (toolSelection.displayedTools || []).length
    ? toolSelection.displayedTools.slice(0, STAX_CARD_FEATURED_TOOL_LIMIT)
    : allCreatorTools.slice(0, STAX_CARD_FEATURED_TOOL_LIMIT);
  const creatorTools = allCreatorTools.map((tool) => ({
    ...tool,
    role: 'using',
    relation: 'using',
    ownership: 'others',
    ownershipReasons: ['Selected in Creator Tool Dock'],
    publishable: tool.publishable !== false,
    selected: false,
  }));
  const usingItems = [
    ...staxTools.map((tool) => ({ ...tool, selected: true })),
    ...(creationSelection.usedCreations || []),
  ];
  const sections = [
    {
      id: 'using-tools',
      title: 'Tools I use',
      items: usingItems,
    },
    {
      id: 'creator-tools',
      title: 'Creator tools',
      items: creatorTools,
    },
  ];
  if ((creationSelection.madeCreations || []).length > 0) {
    sections.push({
      id: 'made-items',
      title: 'I made',
      items: creationSelection.madeCreations,
    });
  }
  if ((creationSelection.remixedCreations || []).length > 0) {
    sections.push({
      id: 'remixed-items',
      title: 'I remixed',
      items: creationSelection.remixedCreations,
    });
  }
  const staxProfile = isRecord(scanResult.staxProfile) ? scanResult.staxProfile : {};
  const publisherUserId = cleanText(process.env.TAKU_DESKTOP_AUTH_USER_ID, 160);
  const publisherUsername = (cleanText(staxProfile.username || staxProfile.handle, 80) || '').replace(/^@+/, '');
  const publisherDisplayName = cleanText(staxProfile.displayName || creatorName, 120);
  const draft = {
    schemaVersion: DRAFT_SCHEMA,
    generatedAt: new Date().toISOString(),
    privacy: scanResult.privacy,
    creator: {
      ...(creatorName ? { name: creatorName } : {}),
      ...(creatorAvatarUrl ? { avatarUrl: creatorAvatarUrl } : {}),
    },
    ...(publisherUserId || publisherUsername ? {
      publisherAccount: {
        ...(publisherUserId ? { userId: publisherUserId } : {}),
        ...(publisherUsername ? { username: publisherUsername } : {}),
        ...(publisherDisplayName ? { displayName: publisherDisplayName } : {}),
      },
    } : {}),
    card: createDefaultCardSettings({
      avatarUrl: creatorAvatarUrl,
      primaryAi: scanResult.aiIdentity?.defaultClient,
    }),
    sections,
    ...(isRecord(scanResult.aiIdentity) ? { aiIdentity: scanResult.aiIdentity } : {}),
    stats: {
      ...scanResult.summary,
      ownedCreationCandidateCount: scanResult.ownedCreations.length,
      creationCandidateCount: scanResult.ownedCreations.length,
      displayedToolCount: staxTools.length,
      hiddenToolCount: Math.max(0, allCreatorTools.length - staxTools.length),
      toolSelectionMode: toolSelection.mode,
      toolDisplayLimit: STAX_CARD_FEATURED_TOOL_LIMIT,
      displayedToolIds: staxTools.map((item) => item.id),
      creatorToolSelectionMode: 'default-none',
      creatorToolIds: [],
      creatorToolCount: creatorTools.length,
      displayedCreationCount: creationSelection.confirmedCreations.length,
      usedCreationCount: creationSelection.usedCreations.length,
      madeItemCount: creationSelection.madeCreations.length,
      remixedItemCount: creationSelection.remixedCreations.length,
      hiddenCreationCount: creationSelection.hiddenCreations.length,
      creationSelectionMode: creationSelection.mode,
      creationDisplayLimit: creationSelection.displayLimit,
      displayedCreationIds: creationSelection.confirmedCreations.map((item) => item.id),
      creationRoles: creationSelection.creationRoles,
      usage: selectUsageForDraft(scanResult.usage),
    },
    personaSignals: scanResult.personaSignals,
    ...(isRecord(scanResult.staxProfile) ? { staxProfile: scanResult.staxProfile } : {}),
    behaviorProfileV1: scanResult.personaSignals?.behaviorProfileV1 || scanResult.personaSignals?.behaviorProfile,
    personaOverrides: scanResult.personaOverrides || {},
    personaV2: scanResult.personaV2,
  };
  return refreshBuilderProfileSnapshot(draft);
}

function getToolSelectionItemsForDraft(toolSelection) {
  const byId = new Map();
  for (const item of [...(toolSelection?.displayedTools || []), ...(toolSelection?.hiddenTools || [])]) {
    if (!item?.id || byId.has(item.id)) continue;
    byId.set(item.id, stripEditorToolFields(item));
  }
  const ordered = (toolSelection?.availableTools || [])
    .map((choice) => (choice?.id ? byId.get(choice.id) : null))
    .filter(Boolean);
  return ordered.length ? ordered : Array.from(byId.values());
}

export function selectDisplayedCreations(creations, parsed) {
  const displayLimit = readNumberFlag(parsed, 'creation-limit', DEFAULT_DISPLAY_CREATION_LIMIT);
  const useTokens = parseChoiceList(getFlag(parsed, 'use-creations'));
  const madeTokens = [
    ...parseChoiceList(getFlag(parsed, 'made-creations')),
    ...parseChoiceList(getFlag(parsed, 'display-creations') || getFlag(parsed, 'creations')),
  ];
  const remixedTokens = parseChoiceList(getFlag(parsed, 'remixed-creations') || getFlag(parsed, 'remix-creations'));
  const hideTokens = parseChoiceList(getFlag(parsed, 'hide-creations'));
  const indexedCreations = rankCreationsForDefaultDisplay(creations).map((creation, index) => ({
    ...creation,
    choiceIndex: index + 1,
  }));
  const roles = new Map(indexedCreations.map((creation) => [creation.id, 'hidden']));
  let mode = 'unconfirmed';

  if (displayLimit > 0 && hasFlag(parsed, 'auto-confirm-creation-candidates')) {
    for (const creation of indexedCreations.filter(shouldDisplayCreationByDefault).slice(0, displayLimit)) {
      roles.set(creation.id, 'made');
    }
    mode = 'auto-confirmed';
  }

  if (useTokens.length > 0) {
    for (const creation of resolveToolChoiceTokens(indexedCreations, useTokens)) roles.set(creation.id, 'using');
    mode = 'custom';
  }
  if (madeTokens.length > 0) {
    for (const creation of resolveToolChoiceTokens(indexedCreations, madeTokens)) roles.set(creation.id, 'made');
    mode = 'custom';
  }
  if (remixedTokens.length > 0) {
    for (const creation of resolveToolChoiceTokens(indexedCreations, remixedTokens)) roles.set(creation.id, 'remixed');
    mode = 'custom';
  }

  if (hideTokens.length > 0) {
    for (const creation of resolveToolChoiceTokens(indexedCreations, hideTokens)) roles.set(creation.id, 'hidden');
    mode = 'custom';
  }

  const roleFor = (creation) => normalizeCreationRole(roles.get(creation.id));
  const withCreationRole = (creation, role) => ({
    ...stripChoiceIndex(creation),
    role,
    relation: role,
    selected: true,
  });
  const usedCreations = indexedCreations.filter((creation) => roleFor(creation) === 'using').map((creation) => withCreationRole(creation, 'using'));
  const madeCreations = indexedCreations.filter((creation) => roleFor(creation) === 'made').map((creation) => withCreationRole(creation, 'made'));
  const remixedCreations = indexedCreations.filter((creation) => roleFor(creation) === 'remixed').map((creation) => withCreationRole(creation, 'remixed'));
  const confirmedCreations = [...usedCreations, ...madeCreations, ...remixedCreations];
  const confirmedIds = new Set(confirmedCreations.map((creation) => creation.id));
  const creationRoles = Object.fromEntries(indexedCreations.map((creation) => [creation.id, roleFor(creation)]));
  return {
    mode,
    displayLimit,
    usedCreations,
    madeCreations,
    remixedCreations,
    confirmedCreations,
    displayedCreations: confirmedCreations,
    hiddenCreations: indexedCreations.filter((creation) => !confirmedIds.has(creation.id)).map(stripChoiceIndex),
    creationRoles,
    availableCreations: indexedCreations.map((creation) => ({
      index: creation.choiceIndex,
      id: creation.id,
      name: creation.name,
      type: creation.type,
      source: creation.source,
      ownership: creation.ownership,
      ownershipConfidence: creation.ownershipConfidence,
      ...(creation.scanPreview ? { scanPreview: creation.scanPreview } : {}),
      role: roleFor(creation),
      displayed: confirmedIds.has(creation.id),
    })),
  };
}

export function normalizeCreationRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'use') return 'using';
  return CREATION_ROLES.has(role) ? role : 'hidden';
}

function shouldDisplayCreationByDefault(creation) {
  if (creation.ownership === 'owned' || Number(creation.ownershipConfidence) >= 0.9) return true;
  if (creation.source === 'workspace' && creation.ownership === 'likely-owned' && Number(creation.ownershipConfidence) >= 0.65) return true;
  return false;
}

function rankCreationsForDefaultDisplay(creations) {
  return creations
    .map((creation, originalIndex) => ({
      creation,
      originalIndex,
      score: scoreCreationForDefaultDisplay(creation),
    }))
    .sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex)
    .map((item) => item.creation);
}

function scoreCreationForDefaultDisplay(creation) {
  const ownershipScore = {
    owned: 120,
    'likely-owned': 80,
    candidate: 40,
  }[creation.ownership] ?? 20;
  const sourceScore = {
    workspace: 24,
    taku: 18,
    codex: 12,
    'claude-code': 10,
    cursor: 8,
    custom: 6,
  }[creation.source] ?? 4;
  let score = ownershipScore + sourceScore + Math.round(Number(creation.ownershipConfidence || 0) * 20);
  if (creation.detectedFrom === 'taku.stax.json' || creation.detectedFrom === 'taku.manifest.json') score += 40;
  if (creation.description) score += 5;
  return score;
}

export function selectDisplayedTools(tools, parsed) {
  const displayLimit = readNumberFlag(parsed, 'tool-limit', DEFAULT_DISPLAY_TOOL_LIMIT);
  const includeTokens = parseChoiceList(getFlag(parsed, 'display-tools') || getFlag(parsed, 'tools'));
  const hideTokens = parseChoiceList(getFlag(parsed, 'hide-tools'));
  const indexedTools = rankToolsForDefaultDisplay(tools).map((tool, index) => ({
    ...tool,
    choiceIndex: index + 1,
  }));
  let selected;
  let mode = 'recommended';

  if (includeTokens.length > 0) {
    selected = resolveToolChoiceTokens(indexedTools, includeTokens);
    mode = 'custom';
  } else {
    selected = displayLimit === 0
      ? []
      : indexedTools.filter(shouldDisplayToolByDefault).slice(0, displayLimit);
  }

  if (hideTokens.length > 0) {
    const hiddenIds = new Set(resolveToolChoiceTokens(indexedTools, hideTokens).map((tool) => tool.id));
    selected = selected.filter((tool) => !hiddenIds.has(tool.id));
    mode = 'custom';
  }

  const selectedIds = new Set(selected.map((tool) => tool.id));
  return {
    mode,
    displayLimit,
    displayedTools: selected.map(stripChoiceIndex),
    hiddenTools: indexedTools.filter((tool) => !selectedIds.has(tool.id)).map(stripChoiceIndex),
    availableTools: indexedTools.map((tool) => ({
      index: tool.choiceIndex,
      id: tool.id,
      name: tool.name,
      type: tool.type,
      source: tool.source,
      availability: tool.availability,
      ...(tool.scanPreview ? { scanPreview: tool.scanPreview } : {}),
      displayed: selectedIds.has(tool.id),
    })),
  };
}

function rankToolsForDefaultDisplay(tools) {
  return tools
    .map((tool, originalIndex) => ({
      tool,
      originalIndex,
      score: scoreToolForDefaultDisplay(tool),
    }))
    .sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex)
    .map((item) => item.tool);
}

function shouldDisplayToolByDefault(tool) {
  return tool.availability !== 'disabled' && tool.availability !== 'unknown' && tool.availability !== 'unlisted';
}

function scoreToolForDefaultDisplay(tool) {
  const sourceScore = {
    taku: 120,
    'taku-workflow': 118,
    'workspace-workflow': 116,
    'taku-subagent': 114,
    'taku-slash-command': 112,
    'codex-subagent': 111,
    'codex-slash-command': 110,
    custom: 110,
    'codex-plugin': 108,
    'claude-plugin': 106,
    'claude-plugin-cache': 104,
    'claude-subagent': 102,
    'claude-slash-command': 100,
    'cursor-subagent': 98,
    'cursor-slash-command': 97,
    'taku-plugin': 96,
    'codex-config': 96,
    'cursor-plugin': 95,
    'codex-mcp': 94,
    'claude-mcp': 92,
    'cursor-mcp': 90,
    'claude-plugin-mcp': 88,
    'claude-code': 85,
    cursor: 85,
    codex: 70,
  }[tool.source] ?? 60;
  let score = sourceScore;
  const typeScore = {
    workflow: 14,
    subagent: 13,
    'slash-command': 12,
    plugin: 10,
    'mcp-server': 8,
    skill: 0,
  }[tool.type] ?? 0;
  score += typeScore;
  const name = normalizeChoiceToken(tool.name);
  if (tool.description) score += 8;
  if (name === 'imagegen' || name === 'webapptesting') score += 10;
  if (name === 'findskills') score -= 20;
  if (['openaidocs', 'plugincreator', 'skillcreator', 'skillinstaller'].includes(name)) score -= 35;
  if (name === 'takucreator' || /^e2e/.test(name)) score -= 1000;
  if (tool.availability === 'unknown' || tool.availability === 'unlisted') score -= 90;
  if (tool.availability === 'disabled') score -= 1000;
  return score;
}

function parseChoiceList(value) {
  if (!value) return [];
  return String(value)
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveToolChoiceTokens(indexedTools, tokens) {
  const selected = [];
  const seenIds = new Set();
  for (const token of tokens) {
    const matches = matchToolChoice(indexedTools, token);
    for (const match of matches) {
      if (seenIds.has(match.id)) continue;
      seenIds.add(match.id);
      selected.push(match);
    }
  }
  return selected;
}

function matchToolChoice(indexedTools, token) {
  const trimmed = String(token || '').trim();
  if (!trimmed) return [];
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed);
    return indexedTools.filter((tool) => tool.choiceIndex === index);
  }
  const normalized = normalizeChoiceToken(trimmed);
  return indexedTools.filter((tool) => {
    const candidates = [
      tool.id,
      tool.name,
      `${tool.source}:${tool.name}`,
      `${tool.type}:${tool.name}`,
    ];
    return candidates.some((candidate) => normalizeChoiceToken(candidate) === normalized);
  });
}

function stripChoiceIndex(tool) {
  const { choiceIndex, scanPreview, ...rest } = tool;
  return rest;
}

export function getToolChoicesItems(toolChoices) {
  const itemById = new Map();
  for (const item of [...(toolChoices?.displayedTools || []), ...(toolChoices?.hiddenTools || [])]) {
    itemById.set(item.id, item);
  }
  return (toolChoices?.availableTools || [])
    .map((choice) => {
      const item = itemById.get(choice.id);
      if (!item) return null;
      return {
        ...item,
        index: choice.index,
        displayed: Boolean(choice.displayed),
        ...(choice.scanPreview ? { scanPreview: choice.scanPreview } : {}),
      };
    })
    .filter(Boolean);
}

export function rebuildToolChoices(toolChoices, displayedToolIds) {
  const selectedIds = new Set(displayedToolIds);
  const allTools = getToolChoicesItems(toolChoices);
  const displayedTools = [];
  const hiddenTools = [];
  const availableTools = allTools.map((tool) => {
    const displayed = selectedIds.has(tool.id);
    const publicTool = stripEditorToolFields(tool);
    if (displayed) {
      displayedTools.push(publicTool);
    } else {
      hiddenTools.push(publicTool);
    }
    return {
      index: tool.index,
      id: tool.id,
      name: tool.name,
      type: tool.type,
      source: tool.source,
      availability: tool.availability,
      ...(tool.scanPreview ? { scanPreview: tool.scanPreview } : {}),
      displayed,
    };
  });
  return {
    ...toolChoices,
    mode: 'custom',
    displayedTools,
    hiddenTools,
    availableTools,
  };
}

export function upsertToolChoice(toolChoices, incomingTool, options = {}) {
  const tool = stripEditorToolFields(incomingTool);
  if (!tool?.id) return toolChoices;
  const currentTools = getToolChoicesItems(toolChoices);
  const existing = currentTools.find((item) => item.id === tool.id);
  const displayed = typeof options.displayed === 'boolean'
    ? options.displayed
    : Boolean(existing?.displayed);
  const currentWithoutIncoming = currentTools.filter((item) => item.id !== tool.id);
  const nextTools = options.position === 'start'
    ? [
      {
        ...tool,
        index: 1,
        displayed,
      },
      ...currentWithoutIncoming.map((item, index) => ({
        ...item,
        index: index + 2,
      })),
    ]
    : [
      ...currentWithoutIncoming,
      {
        ...tool,
        index: existing?.index
          ?? currentTools.reduce((max, item) => Math.max(max, Number(item.index) || 0), 0) + 1,
        displayed,
      },
    ].sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
  const displayedTools = [];
  const hiddenTools = [];
  const availableTools = nextTools.map((item) => {
    const publicTool = stripEditorToolFields(item);
    if (item.displayed) displayedTools.push(publicTool);
    else hiddenTools.push(publicTool);
    return {
      index: item.index,
      id: item.id,
      name: item.name,
      type: item.type,
      source: item.source,
      availability: item.availability,
      ...(item.scanPreview ? { scanPreview: item.scanPreview } : {}),
      displayed: Boolean(item.displayed),
    };
  });
  return {
    ...toolChoices,
    displayedTools,
    hiddenTools,
    availableTools,
  };
}

export function applyToolChoicesToDraft(draft, toolChoices) {
  const nextDraft = structuredClone(draft);
  const toolIds = new Set(getToolChoicesItems(toolChoices).map((tool) => tool.id).filter(Boolean));
  const preservedUsingItems = getDraftSectionItemsByCanonicalId(nextDraft, 'using-tools')
    .filter((item) => !toolIds.has(item.id));
  setDraftSectionItems(nextDraft, 'using-tools', 'Tools I use', [
    ...toolChoices.displayedTools,
    ...preservedUsingItems,
  ]);
  nextDraft.stats = {
    ...nextDraft.stats,
    displayedToolCount: toolChoices.displayedTools.length,
    hiddenToolCount: toolChoices.hiddenTools.length,
    toolSelectionMode: toolChoices.mode,
    toolDisplayLimit: toolChoices.displayLimit,
    displayedToolIds: toolChoices.displayedTools.map((item) => item.id),
  };
  return refreshBuilderProfileSnapshot(nextDraft);
}

export function hasCreatorToolDockSelectionMarker(item) {
  const reasons = Array.isArray(item?.ownershipReasons) ? item.ownershipReasons : [];
  return reasons.some((reason) => String(reason || '').trim() === 'Selected in Creator Tool Dock');
}

export function creatorToolItemsFromDraft(draft) {
  const creatorTools = getDraftSectionItems(draft, 'creator-tools');
  if (creatorTools.length) return creatorTools;
  return [
    ...getDraftSectionItemsByCanonicalId(draft, 'made-items').filter(hasCreatorToolDockSelectionMarker),
    ...getDraftSectionItemsByCanonicalId(draft, 'remixed-items').filter(hasCreatorToolDockSelectionMarker),
  ];
}

export function creatorToolIdsFromDraft(draft, fallbackIds = []) {
  const ids = creatorToolItemsFromDraft(draft)
    .map((item) => (typeof item?.id === 'string' ? item.id : ''))
    .filter(Boolean);
  const selectionMode = draft?.stats?.creatorToolSelectionMode;
  if (selectionMode === 'custom') return ids;
  if (selectionMode === 'default-none') return [];
  return ids.length ? ids : fallbackIds;
}

export function applyCreatorToolChoicesToDraft(draft, toolChoices, creatorToolIds) {
  const nextDraft = structuredClone(draft);
  const selectedIds = new Set(
    Array.isArray(creatorToolIds)
      ? creatorToolIds.filter((id) => typeof id === 'string')
      : []
  );
  const creatorTools = getToolChoicesItems(toolChoices)
    .filter((tool) => selectedIds.has(tool.id))
    .map((tool) => {
      const role = creatorToolPublishRole(tool);
      return {
        ...stripEditorToolFields(tool),
        role,
        relation: role,
        ownership: role === 'made' ? 'mine' : role === 'remixed' ? 'others' : 'others',
        ownershipReasons: ['Selected in Creator Tool Dock'],
        publishable: tool.publishable !== false,
        selected: true,
      };
    });
  const madeItems = getDraftSectionItems(nextDraft, 'made-items')
    .filter((item) => !hasCreatorToolDockSelectionMarker(item));
  const remixedItems = getDraftSectionItems(nextDraft, 'remixed-items')
    .filter((item) => !hasCreatorToolDockSelectionMarker(item));
  setDraftSectionItems(nextDraft, 'creator-tools', 'Creator tools', creatorTools);
  setDraftSectionItems(nextDraft, 'made-items', 'I made', madeItems);
  setDraftSectionItems(nextDraft, 'remixed-items', 'I remixed', remixedItems);
  removeDraftSection(nextDraft, 'owned-creations');
  const toolChoiceIds = new Set(getToolChoicesItems(toolChoices).map((tool) => tool.id).filter(Boolean));
  const usedCreations = getDraftSectionItemsByCanonicalId(nextDraft, 'using-tools')
    .filter((item) => !toolChoiceIds.has(item.id));
  nextDraft.stats = {
    ...nextDraft.stats,
    creatorToolSelectionMode: 'custom',
    creatorToolIds: creatorTools.map((item) => item.id),
    creatorToolCount: creatorTools.length,
    displayedCreationCount: usedCreations.length + madeItems.length + remixedItems.length,
    usedCreationCount: usedCreations.length,
    madeItemCount: madeItems.length,
    remixedItemCount: remixedItems.length,
    displayedCreationIds: [...usedCreations, ...madeItems, ...remixedItems].map((item) => item.id),
  };
  return refreshBuilderProfileSnapshot(nextDraft);
}

function creatorToolPublishRole(tool) {
  const role = normalizeCreationRole(tool?.role || tool?.relation);
  if (role === 'made' || role === 'remixed') return role;
  const ownership = String(tool?.ownership || '').trim().toLowerCase();
  if (ownership === 'owned' || ownership === 'mine') return 'made';
  return 'using';
}

export function getCreationChoicesItems(creationChoices) {
  const itemById = new Map();
  for (const item of [
    ...(creationChoices?.usedCreations || []),
    ...(creationChoices?.madeCreations || []),
    ...(creationChoices?.remixedCreations || []),
    ...(creationChoices?.displayedCreations || []),
    ...(creationChoices?.hiddenCreations || []),
  ]) {
    itemById.set(item.id, item);
  }
  return (creationChoices?.availableCreations || [])
    .map((choice) => {
      const item = itemById.get(choice.id);
      if (!item) return null;
      const role = normalizeCreationRole(choice.role || item.role || item.relation || (choice.displayed ? 'made' : 'hidden'));
      return {
        ...item,
        index: choice.index,
        role,
        relation: role,
        displayed: role !== 'hidden',
      };
    })
    .filter(Boolean);
}

export function rebuildCreationChoices(creationChoices, nextRolesOrDisplayedIds) {
  const allCreations = getCreationChoicesItems(creationChoices);
  const incomingRoles = asRecord(nextRolesOrDisplayedIds);
  const selectedIds = Array.isArray(nextRolesOrDisplayedIds) ? new Set(nextRolesOrDisplayedIds) : undefined;
  const usedCreations = [];
  const madeCreations = [];
  const remixedCreations = [];
  const hiddenCreations = [];
  const creationRoles = {};
  const availableCreations = allCreations.map((creation) => {
    const role = selectedIds
      ? (selectedIds.has(creation.id) ? 'made' : 'hidden')
      : normalizeCreationRole(incomingRoles?.[creation.id] || creation.role);
    const displayed = role !== 'hidden';
    const publicCreation = {
      ...stripEditorToolFields(creation),
      role,
      relation: role,
    };
    if (role === 'using') {
      usedCreations.push(publicCreation);
    } else if (role === 'made') {
      madeCreations.push(publicCreation);
    } else if (role === 'remixed') {
      remixedCreations.push(publicCreation);
    } else {
      hiddenCreations.push(publicCreation);
    }
    creationRoles[creation.id] = role;
    return {
      index: creation.index,
      id: creation.id,
      name: creation.name,
      type: creation.type,
      source: creation.source,
      ownership: creation.ownership,
      ownershipConfidence: creation.ownershipConfidence,
      role,
      displayed,
    };
  });
  const confirmedCreations = [...usedCreations, ...madeCreations, ...remixedCreations];
  return {
    ...creationChoices,
    mode: 'custom',
    usedCreations,
    madeCreations,
    remixedCreations,
    confirmedCreations,
    displayedCreations: confirmedCreations,
    hiddenCreations,
    creationRoles,
    availableCreations,
  };
}

export function applyCreationChoicesToDraft(draft, creationChoices) {
  const nextDraft = structuredClone(draft);
  const creationIds = new Set(getCreationChoicesItems(creationChoices).map((creation) => creation.id).filter(Boolean));
  const usingTools = getDraftSectionItemsByCanonicalId(nextDraft, 'using-tools')
    .filter((item) => !creationIds.has(item.id));
  setDraftSectionItems(nextDraft, 'using-tools', 'Tools I use', [
    ...usingTools,
    ...(creationChoices.usedCreations || []),
  ]);
  setDraftSectionItems(nextDraft, 'made-items', 'I made', creationChoices.madeCreations || []);
  setDraftSectionItems(nextDraft, 'remixed-items', 'I remixed', creationChoices.remixedCreations || []);
  removeDraftSection(nextDraft, 'owned-creations');
  nextDraft.stats = {
    ...nextDraft.stats,
    displayedCreationCount: creationChoices.confirmedCreations.length,
    usedCreationCount: creationChoices.usedCreations.length,
    madeItemCount: creationChoices.madeCreations.length,
    remixedItemCount: creationChoices.remixedCreations.length,
    hiddenCreationCount: creationChoices.hiddenCreations.length,
    creationSelectionMode: creationChoices.mode,
    creationDisplayLimit: creationChoices.displayLimit,
    displayedCreationIds: creationChoices.confirmedCreations.map((item) => item.id),
    creationRoles: creationChoices.creationRoles,
  };
  return refreshBuilderProfileSnapshot(nextDraft);
}

function setDraftSectionItems(draft, id, title, items) {
  removeDraftSection(draft, id);
  if (!items.length) return;
  draft.sections.push({ id, title, items });
}

function removeDraftSection(draft, id) {
  const aliases = DRAFT_SECTION_ALIASES.get(id) || [id];
  draft.sections = (draft.sections || []).filter((section) => !aliases.includes(section.id));
}

export function getDraftSectionItemsByCanonicalId(draft, sectionId) {
  const aliases = DRAFT_SECTION_ALIASES.get(sectionId) || [sectionId];
  return dedupeDraftInventoryItems(aliases.flatMap((id) => getDraftSectionItems(draft, id)));
}

export function applyPersonaOverridesToDraft(draft, overrides) {
  const nextDraft = structuredClone(draft);
  if (!nextDraft.personaV2) return nextDraft;
  const persona = applyPersonaOverrides(nextDraft.personaV2, overrides);
  nextDraft.personaOverrides = persona.overrides || {};
  nextDraft.personaV2 = persona;
  nextDraft.stats = {
    ...nextDraft.stats,
    personaCode: persona.code,
    personaTitle: persona.archetype?.title,
    personaTone: persona.tone,
    personaTraitCount: persona.traits?.length || 0,
    personaSelectedHiddenId: persona.selectedHidden?.id || '',
  };
  return refreshBuilderProfileSnapshot(nextDraft);
}

function stripEditorToolFields(tool) {
  const { index, displayed, scanPreview, ...rest } = tool;
  return rest;
}

function draftInventoryItemKey(item) {
  if (item?.id) return `id:${item.id}`;
  const type = String(item?.type || item?.kind || 'item').trim().toLowerCase();
  const name = String(item?.name || item?.title || '').trim().toLowerCase();
  return name ? `${type}:${name}` : '';
}

function dedupeDraftInventoryItems(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = draftInventoryItemKey(item);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, item);
  }
  return Array.from(byKey.values());
}

export function refreshBuilderProfileSnapshot(draft) {
  draft.staxBlocks = buildStaxBlocks(draft);
  draft.builderProfileSnapshot = buildBuilderProfileSnapshot(draft);
  return draft;
}

export function buildBuilderProfileSnapshot(draft) {
  const persona = draft?.personaV2 || {};
  const usage = draft?.stats?.usage || {};
  const git = draft?.personaSignals?.git || {};
  const card = cardSettingsForDraft(draft);
  const behavior = draft?.behaviorProfileV1 || usage.behaviorProfileV1 || usage.behaviorProfile || draft?.personaSignals?.behaviorProfileV1 || draft?.personaSignals?.behaviorProfile || createEmptyBehaviorProfile(usage.periodId, usage.label);
  const localActivity = usage.localActivity || draft?.personaSignals?.localActivity || draft?.personaSignals?.local_activity || {};
  const usingTools = dedupeDraftInventoryItems([
    ...getDraftSectionItemsByCanonicalId(draft, 'using-tools'),
    ...getDraftSectionItems(draft, 'creator-tools'),
    ...getDraftSectionItemsByCanonicalId(draft, 'made-items').filter(hasCreatorToolDockSelectionMarker),
    ...getDraftSectionItemsByCanonicalId(draft, 'remixed-items').filter(hasCreatorToolDockSelectionMarker),
  ]);
  const madeItems = getDraftSectionItemsByCanonicalId(draft, 'made-items');
  const remixedItems = getDraftSectionItemsByCanonicalId(draft, 'remixed-items');
  const topMix = (behavior.topToolsMix || []).slice(0, 4).map((item) => ({
    category: cleanText(item.category, 80) || 'other',
    label: cleanText(item.label, 80) || behaviorCategoryLabel(item.category),
    share: round(Number(item.share) || 0, 3),
  }));
  const publicInventoryItem = (item) => ({
    name: cleanText(item?.name || item?.title, 120) || 'Untitled',
    type: cleanText(item?.type, 80) || 'item',
    source: cleanText(item?.source, 80) || undefined,
  });
  const personaIdentity = buildPersonaIdentity(persona);
  const personaProfile = buildPersonaProfileV1(persona, { locale: 'en-US' });
  return {
    schemaVersion: BUILDER_PROFILE_SNAPSHOT_SCHEMA,
    generatedAt: new Date().toISOString(),
    privacy: {
      publicSummaryOnly: true,
      excludesPromptContent: true,
      excludesCommandArguments: true,
      excludesRawLogs: true,
      excludesSourceContent: true,
      excludesLocalPaths: true,
      excludesWorkspaceHashes: true,
      excludesRawSignals: true,
    },
    card: {
      displayName: card.name || '',
      avatarUrl: card.avatarUrl,
      qrTarget: card.qrTarget,
      showPersonaCode: card.showPersonaCode,
      showUsage: card.showUsage,
      showCreatorPageLink: card.showCreatorPageLink,
      visibility: card.visibility,
    },
    persona: {
      code: cleanText(persona.code, 12) || '',
      title: cleanText(persona.archetype?.title, 120) || 'AI Builder',
      subtitle: cleanText(persona.archetype?.subtitle, 220) || '',
      description: cleanText(personaProfile.basePersona.description, 220) || '',
      signature: cleanText(persona.archetype?.signature, 220) || personaSignatureFor(persona.code, persona.tone, persona.archetype),
      tone: cleanText(persona.tone, 80) || '',
      ...(persona.code === 'ROOKIE'
        ? { rookieVariant: persona.rookieVariant === 'alt' ? 'alt' : 'default' }
        : {}),
      confidence: round(Number(persona.confidence) || 0, 2),
      basePersona: personaIdentity.basePersona,
      hidden: personaIdentity.hidden,
      badges: personaIdentity.badges,
      axes: (persona.code === 'ROOKIE' ? [] : persona.axes || []).map((axis) => ({
        id: cleanText(axis.id, 80) || '',
        label: cleanText(axis.label, 120) || '',
        letter: cleanText(axis.letter, 8) || '',
        score: round(Number(axis.score) || 0, 3),
        confidence: round(Number(axis.confidence) || 0, 2),
        evidence: (axis.evidence || []).map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 3),
      })),
      influences: (persona.influences || []).map((item) => ({
        axisId: cleanText(item.axisId, 80) || '',
        letter: cleanText(item.letter, 8) || '',
        meaning: cleanText(item.meaning, 80) || '',
        impact: cleanText(item.impact, 240) || '',
      })).slice(0, 4),
      traits: personaIdentity.badges.slice(0, 12),
      selectedHidden: publicHiddenPersona(persona.selectedHidden),
      featuredHidden: personaIdentity.hidden.featured,
    },
    badges: personaIdentity.badges,
    featuredHidden: personaIdentity.hidden.featured,
    ...(draft?.staxCardSnapshot ? { staxCardSnapshot: draft.staxCardSnapshot } : {}),
    behavior: {
      period: {
        id: cleanText(behavior.period?.id || usage.periodId, 80) || 'thisMonth',
        label: cleanText(behavior.period?.label || usage.label, 80) || 'This Month',
      },
      planningRatio: round(Number(behavior.planningRatio) || 0, 3),
      steeringRatio: round(Number(behavior.steeringRatio) || 0, 3),
      autonomyScore: round(Number(behavior.autonomyScore) || 0, 2),
      autonomyLevel: cleanText(behavior.autonomyLevel, 80) || '',
      dominantToolCategory: cleanText(behavior.dominantToolCategory, 80) || 'none',
      topToolsMix: topMix,
      display: {
        planning: formatPercent(Number(behavior.planningRatio) || 0),
        steering: formatPercent(Number(behavior.steeringRatio) || 0),
        autonomy: `${round(Number(behavior.autonomyScore) || 0, 2)}${behavior.autonomyLevel ? ` ${behavior.autonomyLevel}` : ''}`,
        topMix: topMix[0] ? `${topMix[0].label} ${formatPercent(topMix[0].share)}` : behaviorCategoryLabel(behavior.dominantToolCategory),
      },
      workPattern: localActivity.workPattern,
      evidence: (behavior.evidence || []).map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 4),
    },
    usage: {
      label: cleanText(usage.label, 80) || 'This Month',
      periodId: cleanText(usage.periodId, 80) || 'thisMonth',
      totalTokens: Math.max(0, Math.floor(Number(usage.totalTokens) || 0)),
      sessionCount: Math.max(0, Math.floor(Number(usage.sessionCount) || 0)),
      eventCount: Math.max(0, Math.floor(Number(usage.eventCount) || 0)),
      modelUsage: normalizeDraftModelUsage(usage.modelUsage),
      estimatedCost: normalizeDraftEstimatedCost(usage.estimatedCost || usage.modelUsage?.estimatedCost),
      localActivity: normalizeDraftLocalActivity(localActivity),
    },
    codeActivity: {
      periodId: cleanText(usage.periodId, 80) || 'thisMonth',
      repoCount: Math.max(0, Math.floor(Number(git.repoCount) || 0)),
      aiSessionRepoCount: Math.max(0, Math.floor(Number(git.aiSessionRepoCount) || 0)),
      commitCount: Math.max(0, Math.floor(Number(git.commitCount) || 0)),
      commitCount30d: Math.max(0, Math.floor(Number(git.commitCount30d) || Number(git.recentCommitCount) || 0)),
      aiSessionCommitCount: Math.max(0, Math.floor(Number(git.aiSessionCommitCount) || 0)),
      aiSessionCommitCount30d: Math.max(0, Math.floor(Number(git.aiSessionCommitCount30d) || 0)),
      filesChanged: Math.max(0, Math.floor(Number(git.filesChanged) || 0)),
      linesAdded: Math.max(0, Math.floor(Number(git.linesAdded) || 0)),
      linesDeleted: Math.max(0, Math.floor(Number(git.linesDeleted) || 0)),
      aiSessionFilesChanged: Math.max(0, Math.floor(Number(git.aiSessionFilesChanged) || 0)),
      aiSessionLinesAdded: Math.max(0, Math.floor(Number(git.aiSessionLinesAdded) || 0)),
      aiSessionLinesDeleted: Math.max(0, Math.floor(Number(git.aiSessionLinesDeleted) || 0)),
      sourceFilesChanged: Math.max(0, Math.floor(Number(git.sourceFilesChanged) || 0)),
      sourceLinesAdded: Math.max(0, Math.floor(Number(git.sourceLinesAdded) || 0)),
      sourceLinesDeleted: Math.max(0, Math.floor(Number(git.sourceLinesDeleted) || 0)),
      aiSessionSourceFilesChanged: Math.max(0, Math.floor(Number(git.aiSessionSourceFilesChanged) || 0)),
      aiSessionSourceLinesAdded: Math.max(0, Math.floor(Number(git.aiSessionSourceLinesAdded) || 0)),
      aiSessionSourceLinesDeleted: Math.max(0, Math.floor(Number(git.aiSessionSourceLinesDeleted) || 0)),
    },
    inventory: {
      usingToolCount: usingTools.length,
      madeItemCount: madeItems.length,
      remixedItemCount: remixedItems.length,
      usingToolsPreview: usingTools.slice(0, 8).map(publicInventoryItem),
      madeItemsPreview: madeItems.slice(0, 6).map(publicInventoryItem),
      remixedItemsPreview: remixedItems.slice(0, 6).map(publicInventoryItem),
    },
    staxBlocks: draft?.staxBlocks || buildStaxBlocks(draft),
    dataReceipt: {
      reads: [
        'local tool inventory',
        'local session metadata',
        'hashed workspace distribution',
        'bounded git/file metadata for current/session/explicit candidate repos',
        'optional user-provided creator metrics or public GitHub metrics when supplied',
      ],
      publicShareIncludes: [
        'persona title/code and axis summary',
        'behavior metric summary',
        'selected traits',
        'usage summary',
        'selected public inventory counts/previews',
      ],
      neverIncludes: [
        'prompts',
        'command arguments',
        'raw logs',
        'source content',
        'environment variables',
        'tokens or secrets',
        'local paths',
        'workspace hashes',
        'raw personaSignals or behaviorProfile details',
      ],
    },
  };
}

function normalizeDraftModelUsage(modelUsage, limit = 4) {
  const empty = createEmptyModelUsageSummary();
  const sourceRows = Array.isArray(modelUsage?.topModels) && modelUsage.topModels.length
    ? modelUsage.topModels
    : Array.isArray(modelUsage?.models)
      ? modelUsage.models
      : [];
  const candidateRows = sourceRows
    .map((row) => ({
      modelId: cleanText(row?.modelId || row?.name, 160),
      name: cleanText(row?.name || row?.modelId, 160),
      inputTokens: Math.max(0, Math.floor(Number(row?.inputTokens ?? row?.totalInputTokens) || 0)),
      outputTokens: Math.max(0, Math.floor(Number(row?.outputTokens ?? row?.totalOutputTokens) || 0)),
      cacheReadTokens: Math.max(0, Math.floor(Number(row?.cacheReadTokens ?? row?.totalCacheReadTokens) || 0)),
      cacheCreationTokens: Math.max(0, Math.floor(Number(row?.cacheCreationTokens ?? row?.totalCacheCreationTokens) || 0)),
      reasoningTokens: Math.max(0, Math.floor(Number(row?.reasoningTokens ?? row?.totalReasoningTokens) || 0)),
      totalTokens: Math.max(0, Math.floor(Number(row?.totalTokens) || 0)),
      eventCount: Math.max(0, Math.floor(Number(row?.eventCount) || 0)),
      share: Math.max(0, Math.min(1, Number(row?.share) || 0)),
      percentage: cleanText(row?.percentage, 16),
      estimatedCost: normalizeDraftEstimatedCost(row?.estimatedCost),
    }))
    .filter((row) => row.modelId && (row.totalTokens > 0 || row.share > 0))
    .sort((left, right) => right.totalTokens - left.totalTokens || right.share - left.share || left.name.localeCompare(right.name));
  const explicitTotalTokens = Math.max(0, Math.floor(Number(modelUsage?.totalTokens) || 0));
  const totalTokens = explicitTotalTokens || candidateRows.reduce((sum, row) => sum + row.totalTokens, 0);
  const rows = candidateRows.slice(0, limit).map((row) => {
    const share = row.share || (totalTokens > 0 ? round(row.totalTokens / totalTokens, 3) : 0);
    return {
      modelId: row.modelId,
      name: row.name || row.modelId,
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
      percentage: row.percentage || formatDraftModelPercentage(share),
      estimatedCost: row.estimatedCost,
      estimatedCostUsd: row.estimatedCost.totalUsd,
    };
  });
  return {
    ...empty,
    totalTokens,
    totalInputTokens: candidateRows.reduce((sum, row) => sum + row.inputTokens, 0),
    totalOutputTokens: candidateRows.reduce((sum, row) => sum + row.outputTokens, 0),
    totalCacheReadTokens: candidateRows.reduce((sum, row) => sum + row.cacheReadTokens, 0),
    totalCacheCreationTokens: candidateRows.reduce((sum, row) => sum + row.cacheCreationTokens, 0),
    totalReasoningTokens: candidateRows.reduce((sum, row) => sum + row.reasoningTokens, 0),
    observedEventCount: Math.max(0, Math.floor(Number(modelUsage?.observedEventCount) || rows.reduce((sum, row) => sum + row.eventCount, 0))),
    modelCount: Math.max(rows.length, Math.floor(Number(modelUsage?.modelCount) || 0)),
    estimatedCost: normalizeDraftEstimatedCost(modelUsage?.estimatedCost),
    topModels: rows,
    models: rows,
  };
}

function normalizeDraftEstimatedCost(value) {
  const empty = createEmptyEstimatedCostSummary();
  const raw = asRecord(value) || {};
  const topModels = Array.isArray(raw.topModels)
    ? raw.topModels.map((row) => ({
      modelId: cleanText(row?.modelId, 160),
      provider: cleanText(row?.provider, 80),
      pricingModel: cleanText(row?.pricingModel, 120),
      priceSource: cleanText(row?.priceSource, 40),
      totalUsd: round(Number(row?.totalUsd) || 0, 6),
    })).filter((row) => row.modelId && row.totalUsd > 0).slice(0, 4)
    : [];
  return {
    ...empty,
    actualSpend: false,
    pricingBasis: cleanText(raw.pricingBasis, 100) || empty.pricingBasis,
    priceTableUpdatedAt: cleanText(raw.priceTableUpdatedAt, 40) || empty.priceTableUpdatedAt,
    totalUsd: round(Number(raw.totalUsd) || 0, 6),
    totalObservedTokenCount: Math.max(0, Math.floor(Number(raw.totalObservedTokenCount) || 0)),
    pricedTokenCount: Math.max(0, Math.floor(Number(raw.pricedTokenCount) || 0)),
    unpricedTokenCount: Math.max(0, Math.floor(Number(raw.unpricedTokenCount) || 0)),
    coverageRatio: Math.max(0, Math.min(1, Number(raw.coverageRatio) || 0)),
    partial: raw.partial === true,
    pricedModelCount: Math.max(0, Math.floor(Number(raw.pricedModelCount) || 0)),
    unpricedModelCount: Math.max(0, Math.floor(Number(raw.unpricedModelCount) || 0)),
    topModels,
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : [])
      .map((item) => cleanText(item, 180))
      .filter(Boolean)
      .slice(0, 4),
  };
}

function normalizeDraftLocalActivity(value) {
  const raw = asRecord(value) || {};
  const dailyHeatmap = Array.isArray(raw.dailyHeatmap)
    ? raw.dailyHeatmap.map(normalizeDailyActivityRow).filter(Boolean).slice(-120)
    : [];
  const sessionSplit = normalizeSessionSplit(raw.sessionSplit);
  const buildStreak = normalizeBuildStreak(raw.buildStreak);
  const trend30d = normalizeTrend30d(raw.trend30d);
  const delta30d = normalizeDelta30d(raw.delta30d);
  const workPattern = normalizeWorkPattern(raw.workPattern);
  return {
    schemaVersion: cleanText(raw.schemaVersion, 80) || 'taku.creator.local-activity.v1',
    period: {
      id: cleanText(raw.period?.id, 80) || 'thisMonth',
      label: cleanText(raw.period?.label, 80) || 'This Month',
      ...(cleanText(raw.period?.startsAt, 80) ? { startsAt: cleanText(raw.period.startsAt, 80) } : {}),
      ...(cleanText(raw.period?.endsAt, 80) ? { endsAt: cleanText(raw.period.endsAt, 80) } : {}),
    },
    dailyHeatmap,
    activeDayCount: Math.max(0, Math.floor(Number(raw.activeDayCount) || dailyHeatmap.filter((day) => day.active).length)),
    buildDayCount: Math.max(0, Math.floor(Number(raw.buildDayCount) || dailyHeatmap.filter((day) => day.buildSessionCount > 0).length)),
    buildSessionCount: Math.max(0, Math.floor(Number(raw.buildSessionCount) || dailyHeatmap.reduce((sum, day) => sum + day.buildSessionCount, 0))),
    chatSessionCount: Math.max(0, Math.floor(Number(raw.chatSessionCount) || sessionSplit.chatSessionCount)),
    sessionSplit,
    buildStreak,
    trend30d,
    delta30d,
    workPattern,
  };
}

function normalizeDailyActivityRow(value) {
  const row = asRecord(value);
  const date = cleanText(row?.date, 20);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    date,
    active: row.active !== false,
    sessionCount: Math.max(0, Math.floor(Number(row.sessionCount) || 0)),
    buildSessionCount: Math.max(0, Math.floor(Number(row.buildSessionCount) || 0)),
    eventCount: Math.max(0, Math.floor(Number(row.eventCount) || 0)),
    toolCallCount: Math.max(0, Math.floor(Number(row.toolCallCount) || 0)),
    tokenCount: Math.max(0, Math.floor(Number(row.tokenCount) || 0)),
    buildIntensity: Math.max(0, Math.min(4, Math.floor(Number(row.buildIntensity) || 0))),
  };
}

function normalizeSessionSplit(value) {
  const raw = asRecord(value) || {};
  return {
    sessionCount: Math.max(0, Math.floor(Number(raw.sessionCount) || 0)),
    buildSessionCount: Math.max(0, Math.floor(Number(raw.buildSessionCount) || 0)),
    chatSessionCount: Math.max(0, Math.floor(Number(raw.chatSessionCount) || 0)),
    buildShare: clampRatio(raw.buildShare),
    chatShare: clampRatio(raw.chatShare),
    buildMinutes: round(Math.max(0, Number(raw.buildMinutes) || 0), 1),
    chatMinutes: round(Math.max(0, Number(raw.chatMinutes) || 0), 1),
    buildTimeShare: clampRatio(raw.buildTimeShare),
    chatTimeShare: clampRatio(raw.chatTimeShare),
  };
}

function normalizeBuildStreak(value) {
  const raw = asRecord(value) || {};
  return {
    currentDays: Math.max(0, Math.floor(Number(raw.currentDays) || 0)),
    bestDays: Math.max(0, Math.floor(Number(raw.bestDays) || 0)),
  };
}

function normalizeTrend30d(value) {
  const raw = asRecord(value) || {};
  const buckets = Array.isArray(raw.buckets)
    ? raw.buckets.map(normalizeTrendBucket).filter(Boolean).slice(0, 8)
    : [];
  return {
    metric: cleanText(raw.metric, 80) || 'buildSessions',
    periodId: cleanText(raw.periodId, 80) || 'last30Days',
    buckets,
  };
}

function normalizeTrendBucket(value) {
  const raw = asRecord(value);
  const id = cleanText(raw?.id, 40);
  if (!id) return null;
  return {
    id,
    label: cleanText(raw.label, 80) || id,
    startsAt: cleanText(raw.startsAt, 80) || '',
    endsAt: cleanText(raw.endsAt, 80) || '',
    buildSessionCount: Math.max(0, Math.floor(Number(raw.buildSessionCount) || 0)),
    activeDayCount: Math.max(0, Math.floor(Number(raw.activeDayCount) || 0)),
    toolCallCount: Math.max(0, Math.floor(Number(raw.toolCallCount) || 0)),
    tokenCount: Math.max(0, Math.floor(Number(raw.tokenCount) || 0)),
  };
}

function normalizeDelta30d(value) {
  const raw = asRecord(value) || {};
  const delta = Number(raw.delta);
  return {
    metric: cleanText(raw.metric, 80) || 'buildSessions',
    current: Math.max(0, Math.floor(Number(raw.current) || 0)),
    previous: Math.max(0, Math.floor(Number(raw.previous) || 0)),
    delta: Number.isFinite(delta) ? round(delta, 3) : null,
    display: cleanText(raw.display, 40) || '',
  };
}

function normalizeWorkPattern(value) {
  const raw = asRecord(value) || {};
  const hourBuckets = Array.isArray(raw.hourBuckets)
    ? raw.hourBuckets.slice(0, 24).map((item) => Math.max(0, Math.floor(Number(item) || 0)))
    : [];
  while (hourBuckets.length < 24) hourBuckets.push(0);
  const peakHour = Number(raw.peakHour);
  return {
    timezone: cleanText(raw.timezone, 80) || 'local',
    hourBuckets,
    peakHour: Number.isInteger(peakHour) && peakHour >= 0 && peakHour <= 23 ? peakHour : null,
    activeHourCount: Math.max(0, Math.floor(Number(raw.activeHourCount) || 0)),
    nightShare: clampRatio(raw.nightShare),
    morningShare: clampRatio(raw.morningShare),
    businessHoursShare: clampRatio(raw.businessHoursShare),
    weekendShare: clampRatio(raw.weekendShare),
    durationSessionCount: Math.max(0, Math.floor(Number(raw.durationSessionCount) || 0)),
    avgSessionMinutes: round(Math.max(0, Number(raw.avgSessionMinutes) || 0), 1),
    longestSessionMinutes: round(Math.max(0, Number(raw.longestSessionMinutes) || 0), 1),
    shortSessionShare: clampRatio(raw.shortSessionShare),
    longSessionShare: clampRatio(raw.longSessionShare),
    flowSessionShare: clampRatio(raw.flowSessionShare),
  };
}

function clampRatio(value) {
  const next = Number(value);
  return Number.isFinite(next) ? round(Math.min(1, Math.max(0, next)), 3) : 0;
}

function formatDraftModelPercentage(share) {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  const percent = share * 100;
  if (percent < 0.1) return '<0.1%';
  const rounded = round(percent, 1);
  return `${Number.isInteger(rounded) ? Math.round(rounded) : rounded}%`;
}

export function selectUsageForDraft(usage) {
  if (!usage?.scanned) return undefined;
  const scanCoverage = isRecord(usage.scanCoverage) ? usage.scanCoverage : {};
  const partial = usage.partial === true || scanCoverage.partial === true;
  const stoppedReason = ['time', 'bytes', 'files'].includes(scanCoverage.stoppedReason)
    ? scanCoverage.stoppedReason
    : undefined;
  return {
    label: usage.periodLabel,
    periodId: usage.primaryPeriodId,
    totalTokens: usage.totalTokens,
    sessionCount: usage.sessionCount,
    eventCount: usage.eventCount,
    partial,
    scanCoverage: {
      partial,
      ...(stoppedReason ? { stoppedReason } : {}),
      candidateFileCount: Math.max(0, Math.floor(Number(scanCoverage.candidateFileCount) || 0)),
      scannedFileCount: Math.max(0, Math.floor(Number(scanCoverage.scannedFileCount) || 0)),
      sampledFileCount: Math.max(0, Math.floor(Number(scanCoverage.sampledFileCount) || 0)),
      oversizedJsonFileCount: Math.max(0, Math.floor(Number(scanCoverage.oversizedJsonFileCount) || 0)),
      scannedByteCount: Math.max(0, Math.floor(Number(scanCoverage.scannedByteCount) || 0)),
      periodFiltered: scanCoverage.periodFiltered === true,
    },
    periods: (Array.isArray(usage.periods) ? usage.periods : [])
      .map(normalizeDraftUsagePeriod)
      .filter((period) => period.id),
    sources: usage.sources
      .filter((source) => source.totalTokens > 0 || source.sessionCount > 0)
      .map((source) => ({
        source: source.source,
        label: source.label,
        totalTokens: source.totalTokens,
      sessionCount: source.sessionCount,
      tokenKind: source.tokenKind,
      note: source.note,
      estimatedCost: normalizeDraftEstimatedCost(source.estimatedCost || source.modelUsage?.estimatedCost),
    })),
    promptStyle: usage.promptStyle || createEmptyPromptStyleSummary(false),
    modelUsage: normalizeDraftModelUsage(usage.modelUsage),
    estimatedCost: normalizeDraftEstimatedCost(usage.estimatedCost || usage.modelUsage?.estimatedCost),
    localActivity: normalizeDraftLocalActivity(usage.localActivity),
    behaviorProfile: usage.behaviorProfile || usage.behaviorProfileV1 || createEmptyBehaviorProfile(usage.primaryPeriodId, usage.periodLabel),
    behaviorProfileV1: usage.behaviorProfileV1 || usage.behaviorProfile || createEmptyBehaviorProfile(usage.primaryPeriodId, usage.periodLabel),
    note: usage.totalTokens > 0
      ? partial
        ? 'Local usage stats are a bounded recent sample. Prompt content is not uploaded.'
        : 'Local usage stats are generated from local metadata and logs. Prompt content is not uploaded.'
      : 'No local token usage was found for the selected period.',
  };
}

function normalizeDraftUsagePeriod(period) {
  if (!isRecord(period)) return {};
  return {
    id: cleanText(period.id || period.periodId, 80) || '',
    label: cleanText(period.label || period.periodLabel, 80) || '',
    startsAt: cleanText(period.startsAt, 80) || undefined,
    endsAt: cleanText(period.endsAt, 80) || undefined,
    totalTokens: Math.max(0, Math.floor(Number(period.totalTokens) || 0)),
    sessionCount: Math.max(0, Math.floor(Number(period.sessionCount) || 0)),
    eventCount: Math.max(0, Math.floor(Number(period.eventCount) || 0)),
  };
}

function normalizeBooleanOption(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeCardVisibility(value, fallback = 'draft') {
  const normalized = normalizeChoiceToken(value || fallback);
  if (normalized === 'public') return 'public';
  if (normalized === 'unlisted' || normalized === 'sharelink' || normalized === 'link') return 'unlisted';
  return 'draft';
}

function normalizeQrTarget(value, fallback = 'stax') {
  const normalized = normalizeChoiceToken(value || fallback);
  return normalized === 'profile' ? 'profile' : 'stax';
}

function createDefaultCardSettings(input = {}) {
  const primaryAi = normalizePrimaryAiClient(input.primaryAi);
  return {
    avatarUrl: publicHttpUrl(input.avatarUrl || process.env.TAKU_CREATOR_AVATAR_URL),
    ...(primaryAi ? { primaryAi } : {}),
    qrTarget: normalizeQrTarget(input.qrTarget),
    showPersonaCode: true,
    showUsage: true,
    showCreatorPageLink: true,
    visibility: 'public',
  };
}

export function cardSettingsForDraft(draft) {
  const creator = isRecord(draft?.creator) ? draft.creator : {};
  const card = isRecord(draft?.card) ? draft.card : {};
  const name = cleanText(card.name || creator.name || creator.displayName, 120);
  const primaryAi = normalizePrimaryAiClient(card.primaryAi);
  return {
    ...(name ? { name } : {}),
    avatarUrl: publicHttpUrl(card.avatarUrl || creator.avatarUrl),
    ...(primaryAi ? { primaryAi } : {}),
    qrTarget: normalizeQrTarget(card.qrTarget),
    showPersonaCode: normalizeBooleanOption(card.showPersonaCode, true),
    showUsage: normalizeBooleanOption(card.showUsage, true),
    showCreatorPageLink: normalizeBooleanOption(card.showCreatorPageLink, true),
    visibility: normalizeCardVisibility(card.visibility, 'public'),
  };
}

export function applyCardSettingsToDraft(draft, input = {}) {
  const nextDraft = structuredClone(draft);
  const current = cardSettingsForDraft(nextDraft);
  const incoming = isRecord(input) ? input : {};
  const hasName = Object.prototype.hasOwnProperty.call(incoming, 'name')
    || Object.prototype.hasOwnProperty.call(incoming, 'displayName');
  const name = hasName
    ? cleanText(incoming.name || incoming.displayName, 120)
    : current.name;
  const avatarUrl = Object.prototype.hasOwnProperty.call(incoming, 'avatarUrl')
    ? publicHttpUrl(incoming.avatarUrl)
    : current.avatarUrl;
  const primaryAi = normalizePrimaryAiSelection(
    incoming.primaryAi,
    nextDraft.aiIdentity,
    current.primaryAi,
  );
  const settings = {
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(primaryAi ? { primaryAi } : {}),
    qrTarget: normalizeQrTarget(incoming.qrTarget, current.qrTarget),
    showPersonaCode: normalizeBooleanOption(incoming.showPersonaCode, current.showPersonaCode),
    showUsage: normalizeBooleanOption(incoming.showUsage, current.showUsage),
    showCreatorPageLink: normalizeBooleanOption(incoming.showCreatorPageLink, current.showCreatorPageLink),
    visibility: normalizeCardVisibility(incoming.visibility, current.visibility),
  };
  nextDraft.creator = {
    ...(name ? { name } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
  nextDraft.card = settings;
  return refreshBuilderProfileSnapshot(nextDraft);
}

function normalizePrimaryAiClient(value) {
  const normalized = normalizeChoiceToken(value);
  if (normalized === 'codex') return 'codex';
  if (['claude', 'claude-code', 'cc'].includes(normalized)) return 'claude-code';
  if (normalized === 'cursor') return 'cursor';
  if (normalized === 'gemini') return 'gemini';
  return '';
}

function normalizePrimaryAiSelection(value, aiIdentity, fallback = '') {
  const normalized = normalizePrimaryAiClient(value);
  const available = new Set(
    (Array.isArray(aiIdentity?.options) ? aiIdentity.options : [])
      .map((item) => normalizePrimaryAiClient(item?.id))
      .filter(Boolean),
  );
  if (normalized && (!available.size || available.has(normalized))) return normalized;
  return normalizePrimaryAiClient(fallback);
}

export function fallbackToolChoicesFromDraft(draft) {
  const tools = getDraftSectionItemsByCanonicalId(draft, 'using-tools')
    .filter((item) => normalizeCreationRole(item.role || item.relation) !== 'using' || hasCreatorToolDockSelectionMarker(item));
  const displayedTools = tools.map((tool) => ({ ...tool }));
  return {
    mode: draft.stats?.toolSelectionMode || 'custom',
    displayLimit: draft.stats?.toolDisplayLimit ?? displayedTools.length,
    displayedTools,
    hiddenTools: [],
    availableTools: displayedTools.map((tool, index) => ({
      index: index + 1,
      id: tool.id,
      name: tool.name,
      type: tool.type,
      source: tool.source,
      displayed: true,
    })),
  };
}

export function fallbackCreationChoicesFromDraft(draft) {
  const usedCreations = getDraftSectionItemsByCanonicalId(draft, 'using-tools')
    .filter((creation) => normalizeCreationRole(creation.role || creation.relation) === 'using' && !hasCreatorToolDockSelectionMarker(creation))
    .map((creation) => ({ ...creation, role: 'using', relation: 'using' }));
  const madeCreations = getDraftSectionItemsByCanonicalId(draft, 'made-items')
    .map((creation) => ({ ...creation, role: 'made', relation: 'made' }));
  const remixedCreations = getDraftSectionItemsByCanonicalId(draft, 'remixed-items')
    .map((creation) => ({ ...creation, role: 'remixed', relation: 'remixed' }));
  const confirmedCreations = [...usedCreations, ...madeCreations, ...remixedCreations];
  const creationRoles = Object.fromEntries(confirmedCreations.map((creation) => [creation.id, normalizeCreationRole(creation.role)]));
  return {
    mode: draft.stats?.creationSelectionMode || 'custom',
    displayLimit: draft.stats?.creationDisplayLimit ?? confirmedCreations.length,
    usedCreations,
    madeCreations,
    remixedCreations,
    confirmedCreations,
    displayedCreations: confirmedCreations,
    hiddenCreations: [],
    creationRoles,
    availableCreations: confirmedCreations.map((creation, index) => ({
      index: index + 1,
      id: creation.id,
      name: creation.name,
      type: creation.type,
      source: creation.source,
      ownership: creation.ownership,
      ownershipConfidence: creation.ownershipConfidence,
      role: normalizeCreationRole(creation.role),
      displayed: true,
    })),
  };
}
