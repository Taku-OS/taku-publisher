import * as path from 'node:path';

import { getFlag, getHomeDir } from './cli.mjs';
import { readJsonFile, writeJson } from './draft-state.mjs';
import { isRecord } from './privacy.mjs';

export const LISTING_DRAFT_STORE_SCHEMA = 'taku.creator.tool-listing-draft-store.v1';

export function listingDraftStorePath(parsed) {
  const customPath = parsed ? getFlag(parsed, 'listing-store') : '';
  if (customPath) return path.resolve(customPath);
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'Taku', 'tool-listing-drafts.json');
  }
  return path.join(getHomeDir(), '.taku', 'tool-listing-drafts.json');
}

export async function readListingDraftStore(parsed) {
  const filePath = listingDraftStorePath(parsed);
  const raw = await readJsonFile(filePath);
  return {
    schemaVersion: LISTING_DRAFT_STORE_SCHEMA,
    updatedAt: isRecord(raw) && typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    listingDrafts: normalizeListingDraftMap(isRecord(raw) ? raw.listingDrafts : {}),
    path: filePath,
  };
}

export async function saveListingDraftToStore(parsed, toolId, listingDraft) {
  const store = await readListingDraftStore(parsed);
  const normalized = normalizeListingDraftEntry(listingDraft, toolId);
  if (!normalized) return store;
  const nextListingDrafts = {
    ...store.listingDrafts,
    [toolId]: normalized,
  };
  await writeListingDraftStore(parsed, nextListingDrafts);
  return {
    ...store,
    updatedAt: new Date().toISOString(),
    listingDrafts: nextListingDrafts,
  };
}

export async function removeListingDraftFromStore(parsed, toolId) {
  const id = typeof toolId === 'string' ? toolId.trim() : '';
  const store = await readListingDraftStore(parsed);
  if (!id || !store.listingDrafts[id]) return store;
  const nextListingDrafts = { ...store.listingDrafts };
  delete nextListingDrafts[id];
  await writeListingDraftStore(parsed, nextListingDrafts);
  return {
    ...store,
    updatedAt: new Date().toISOString(),
    listingDrafts: nextListingDrafts,
  };
}

export async function hydrateDraftListingDrafts(parsed, draft, toolChoices, options = {}) {
  const includeStoredDrafts = Boolean(options.includeStoredDrafts);
  const store = includeStoredDrafts || options.persist
    ? await readListingDraftStore(parsed)
    : {
        listingDrafts: {},
        path: listingDraftStorePath(parsed),
      };
  const currentDrafts = normalizeListingDraftMap(draft?.listingDrafts);
  const mergedDrafts = mergeRelevantListingDrafts(
    toolChoices,
    ...(includeStoredDrafts ? [store.listingDrafts] : []),
    currentDrafts,
  );
  const hydratedDraft = applyListingDraftsToDraft(draft, mergedDrafts);

  if (options.persist && Object.keys(mergedDrafts).length > 0) {
    await writeListingDraftStore(parsed, {
      ...store.listingDrafts,
      ...mergedDrafts,
    });
  }

  return {
    draft: hydratedDraft,
    listingDrafts: mergedDrafts,
    storePath: store.path,
  };
}

export function applyListingDraftsToDraft(draft, listingDrafts) {
  const nextDraft = structuredClone(draft);
  const normalized = normalizeListingDraftMap(listingDrafts);
  nextDraft.listingDrafts = normalized;
  nextDraft.stats = {
    ...(nextDraft.stats || {}),
    listingDraftCount: Object.keys(normalized).length,
    listingReadyCount: Object.values(normalized).filter((entry) => entry?.status === 'ready').length,
  };
  return nextDraft;
}

function writeListingDraftStore(parsed, listingDrafts) {
  return writeJson(listingDraftStorePath(parsed), {
    schemaVersion: LISTING_DRAFT_STORE_SCHEMA,
    updatedAt: new Date().toISOString(),
    listingDrafts: normalizeListingDraftMap(listingDrafts),
  });
}

function mergeRelevantListingDrafts(toolChoices, ...draftMaps) {
  const relevantIds = toolChoiceIds(toolChoices);
  const merged = {};
  for (const draftMap of draftMaps) {
    const normalized = normalizeListingDraftMap(draftMap);
    for (const [id, entry] of Object.entries(normalized)) {
      if (!relevantIds.has(id)) continue;
      merged[id] = choosePreferredListingDraft(merged[id], entry);
    }
  }
  return merged;
}

function choosePreferredListingDraft(current, incoming) {
  if (!current) return incoming;
  const currentTime = Date.parse(current.updatedAt || '');
  const incomingTime = Date.parse(incoming.updatedAt || '');
  if (!Number.isFinite(currentTime) && Number.isFinite(incomingTime)) return incoming;
  if (Number.isFinite(currentTime) && Number.isFinite(incomingTime)) {
    return incomingTime >= currentTime ? incoming : current;
  }
  if (incoming.status === 'ready' && current.status !== 'ready') return incoming;
  return current;
}

function toolChoiceIds(toolChoices) {
  const ids = new Set();
  for (const item of [
    ...(toolChoices?.availableTools || []),
    ...(toolChoices?.displayedTools || []),
    ...(toolChoices?.hiddenTools || []),
  ]) {
    if (typeof item?.id === 'string' && item.id.trim()) ids.add(item.id);
  }
  return ids;
}

function normalizeListingDraftMap(value) {
  if (!isRecord(value)) return {};
  const output = {};
  for (const [id, entry] of Object.entries(value)) {
    if (typeof id !== 'string' || !id.trim()) continue;
    const normalized = normalizeListingDraftEntry(entry, id);
    if (normalized) output[id] = normalized;
  }
  return output;
}

function normalizeListingDraftEntry(value, fallbackId) {
  if (!isRecord(value)) return null;
  const listing = normalizeListing(value.listing);
  const status = normalizeStatus(value.status, listing);
  return {
    schemaVersion: 'taku.creator.tool-listing-draft.v1',
    sourceItemId: cleanString(value.sourceItemId, 120) || fallbackId,
    updatedAt: cleanString(value.updatedAt, 80) || new Date().toISOString(),
    status,
    listing,
    technical: normalizeTechnical(value.technical),
  };
}

function normalizeListing(value) {
  const input = isRecord(value) ? value : {};
  return {
    title: cleanString(input.title, 120),
    shortDescription: cleanString(input.shortDescription, 220),
    description: cleanString(input.description, 1200),
    coverImageUrl: cleanString(input.coverImageUrl, 600),
    category: cleanString(input.category, 80),
    additionalCategories: cleanStringList(input.additionalCategories, 3, 80),
    type: cleanString(input.type, 80),
    tags: cleanStringList(input.tags, 12, 40),
    examples: cleanStringList(input.examples, 8, 220),
    visibility: ['draft', 'public', 'unlisted'].includes(input.visibility) ? input.visibility : 'draft',
  };
}

function normalizeTechnical(value) {
  const input = isRecord(value) ? value : {};
  return {
    name: cleanString(input.name, 160),
    type: cleanString(input.type, 80),
    source: cleanString(input.source, 80),
    detectedFrom: cleanString(input.detectedFrom, 180),
  };
}

function normalizeStatus(value, listing) {
  const status = cleanString(value, 40);
  const inferred = listing.title && listing.shortDescription && listing.category && listing.type
    ? 'ready'
    : listing.title || listing.shortDescription || listing.description || listing.category || listing.type
      ? 'draft'
      : 'unedited';
  if (status === 'published') return 'published';
  if (status === 'ready') return inferred === 'ready' ? 'ready' : inferred;
  if (status === 'draft') return inferred === 'unedited' ? 'unedited' : 'draft';
  if (status === 'unedited') return inferred;
  return inferred;
}

function cleanString(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function cleanStringList(value, maxItems, maxChars) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => cleanString(entry, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}
