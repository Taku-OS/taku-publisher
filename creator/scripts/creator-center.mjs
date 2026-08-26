import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getFlag, readNumberFlag } from './cli.mjs';
import {
  buildTakuLoginUrl,
  readAuthorizedTakuToken,
  resolveSiteUrl,
  resolveWorkerUrl,
} from './publish-config.mjs';
import { createTakuStaxClient } from './publish-client.mjs';
import { buildStaxProfilePageUrl } from './stax-url.mjs';

export const CREATOR_CENTER_SCHEMA = 'taku.creator.center.v1';

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function string(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableString(value) {
  return string(value) || null;
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function unwrapData(payload) {
  const envelope = record(payload);
  return envelope.data ?? payload;
}

function requiredScopeFor(command) {
  if (command === 'creator-center-unpublish') return 'creator.items.unpublish';
  if (command === 'creator-center-update') return 'creator.items.write';
  if (command === 'creator-center-stats') return 'creator.stats.read';
  return 'creator.items.read';
}

function authRequired(parsed, command, scope) {
  return {
    ok: false,
    schemaVersion: CREATOR_CENTER_SCHEMA,
    command,
    needsAuth: true,
    requiredScope: scope,
    message: 'Sign in to Taku to manage your Creator Center.',
    loginUrl: buildTakuLoginUrl(parsed, {
      intent: command === 'creator-center-unpublish'
        ? 'creator_center_unpublish'
        : 'creator_center',
    }),
  };
}

function createContext(parsed, command, options = {}) {
  const requiredScope = requiredScopeFor(command);
  const token = Object.hasOwn(options, 'token')
    ? string(options.token)
    : readAuthorizedTakuToken(parsed, requiredScope);
  const workerUrl = options.workerUrl || resolveWorkerUrl(parsed);
  const siteUrl = options.siteUrl || resolveSiteUrl(parsed);
  const client = options.client || (token ? createTakuStaxClient({ workerUrl, token }) : null);
  return { requiredScope, token, workerUrl, siteUrl, client };
}

function creatorCenterFilters(parsed) {
  const filters = {};
  for (const key of ['type', 'status', 'search']) {
    const value = getFlag(parsed, key);
    if (value) filters[key] = value;
  }
  filters.limit = Math.min(readNumberFlag(parsed, 'limit', 50) || 50, 100);
  filters.offset = readNumberFlag(parsed, 'offset', 0);
  return filters;
}

function publicUrls(item, siteUrl, profile) {
  const username = string(item.creatorUsername || item.creator_username || profile.username);
  const slug = string(item.slug);
  if (!username) return { creatorPageUrl: null, publicItemUrl: null };
  const creatorPageUrl = buildStaxProfilePageUrl(siteUrl, username);
  const publicItemBaseUrl = `${siteUrl}/stax/${encodeURIComponent(username)}`;
  return {
    creatorPageUrl,
    publicItemUrl:
      item.status === 'published' && slug
        ? `${publicItemBaseUrl}/${encodeURIComponent(slug)}`
        : null,
  };
}

export function normalizeCreatorCenterItem(value, { siteUrl, profile = {} } = {}) {
  const item = record(value);
  const status = string(item.status) || 'unknown';
  const urls = publicUrls(item, String(siteUrl || '').replace(/\/+$/, ''), record(profile));
  return {
    itemId: string(item.id || item.itemId || item.item_id),
    name: string(item.name) || 'Untitled',
    slug: nullableString(item.slug),
    type: string(item.type) || 'tool',
    status,
    currentVersion: integer(item.currentVersion ?? item.current_version, 1),
    shortDescription: nullableString(item.shortDescription ?? item.short_description),
    description: nullableString(item.description),
    tags: array(item.tags).map(string).filter(Boolean),
    categories: array(item.categories).map(string).filter(Boolean),
    installCount: integer(item.liveInstallCount ?? item.installCount ?? item.install_count),
    viewCount: integer(item.viewCount ?? item.view_count),
    ratingAverage: Number(item.ratingAvg ?? item.rating_avg ?? 0) || 0,
    ratingCount: integer(item.ratingCount ?? item.rating_count),
    updatedAt: nullableString(item.updatedAt ?? item.updated_at),
    publishedAt: nullableString(item.publishedAt ?? item.published_at),
    canEditMetadata: item.canEditMetadata === true || status === 'draft',
    canUnpublish: item.canUnpublish === true || status === 'published',
    updateRequiresPublisher: item.updateRequiresPublisher === true || status === 'published',
    nextAction:
      status === 'published'
        ? 'update_via_publisher'
        : status === 'draft'
          ? 'edit_or_publish'
          : 'review_status',
    ...urls,
  };
}

export async function runCreatorCenterList(parsed, options = {}) {
  const command = 'creator-center-list';
  const context = createContext(parsed, command, options);
  if (!context.token || !context.client) {
    return authRequired(parsed, command, context.requiredScope);
  }
  const filters = creatorCenterFilters(parsed);
  const [itemsPayload, staxProfilePayload, statsPayload] = await Promise.all([
    context.client.getMyCreatorItems(filters),
    getOptionalMyStaxProfile(context.client),
    context.client.getMyCreatorStats(),
  ]);
  const profilePayload = staxProfilePayload || await context.client.getMyProfile();
  const profile = record(unwrapData(profilePayload));
  const stats = staxProfilePayload
    ? creatorCenterStatsFromStaxProfile(profile, statsPayload)
    : record(unwrapData(statsPayload));
  const items = array(unwrapData(itemsPayload)).map((item) =>
    normalizeCreatorCenterItem(item, { siteUrl: context.siteUrl, profile }),
  );
  return {
    ok: true,
    schemaVersion: CREATOR_CENTER_SCHEMA,
    command,
    filters,
    account: {
      username: nullableString(profile.username),
      displayName: nullableString(profile.displayName ?? profile.display_name),
      creatorPageUrl: profile.username
        ? buildStaxProfilePageUrl(context.siteUrl, profile.username)
        : null,
    },
    summary: {
      returnedItemCount: items.length,
      editableDraftCount: items.filter((item) => item.canEditMetadata).length,
      publishedItemCount: items.filter((item) => item.status === 'published').length,
    },
    stats,
    items,
  };
}

function creatorItemId(parsed) {
  return getFlag(parsed, 'item-id') || parsed.positionals[1] || '';
}

export async function runCreatorCenterShow(parsed, options = {}) {
  const command = 'creator-center-show';
  const context = createContext(parsed, command, options);
  if (!context.token || !context.client) {
    return authRequired(parsed, command, context.requiredScope);
  }
  const itemId = creatorItemId(parsed);
  if (!itemId) throw new Error('Missing --item-id <id>.');
  const [itemPayload, profilePayload] = await Promise.all([
    context.client.getCreatorItemManagement(itemId),
    context.client.getMyProfile(),
  ]);
  const profile = record(unwrapData(profilePayload));
  return {
    ok: true,
    schemaVersion: CREATOR_CENTER_SCHEMA,
    command,
    item: normalizeCreatorCenterItem(unwrapData(itemPayload), {
      siteUrl: context.siteUrl,
      profile,
    }),
  };
}

export async function runCreatorCenterStats(parsed, options = {}) {
  const command = 'creator-center-stats';
  const context = createContext(parsed, command, options);
  if (!context.token || !context.client) {
    return authRequired(parsed, command, context.requiredScope);
  }
  const [staxProfilePayload, statsPayload] = await Promise.all([
    getOptionalMyStaxProfile(context.client),
    context.client.getMyCreatorStats(),
  ]);
  const profilePayload = staxProfilePayload || await context.client.getMyProfile();
  const profile = record(unwrapData(profilePayload));
  return {
    ok: true,
    schemaVersion: CREATOR_CENTER_SCHEMA,
    command,
    account: {
      username: nullableString(profile.username),
      displayName: nullableString(profile.displayName ?? profile.display_name),
    },
    stats: staxProfilePayload
      ? creatorCenterStatsFromStaxProfile(profile, statsPayload)
      : record(unwrapData(statsPayload)),
  };
}

async function getOptionalMyStaxProfile(client) {
  if (typeof client?.getMyStaxProfile !== 'function') return null;
  return await client.getMyStaxProfile().catch(() => null);
}

function creatorCenterStatsFromStaxProfile(staxProfile, fallbackStatsPayload) {
  const profile = record(staxProfile);
  const platform = record(profile.platform);
  const rank = record(profile.rank);
  const fallback = record(unwrapData(fallbackStatsPayload));
  return {
    ...fallback,
    ...platform,
    ...(rank.rankGrade ? { rankGrade: rank.rankGrade } : {}),
    ...(rank.percentiles ? { percentiles: rank.percentiles } : {}),
    ...(rank.topPercentiles ? { topPercentiles: rank.topPercentiles } : {}),
    ...(profile.daysOnTaku !== undefined ? { daysOnTaku: profile.daysOnTaku } : {}),
    ...(profile.serialNumber ? { serialNumber: profile.serialNumber } : {}),
  };
}

function commaList(value) {
  return string(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function readUpdatePatch(parsed) {
  let input = {};
  const metadataPath = getFlag(parsed, 'metadata');
  if (metadataPath) {
    const payload = JSON.parse(await fs.readFile(path.resolve(metadataPath), 'utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Creator Center metadata must be a JSON object.');
    }
    input = payload;
  }

  const patch = {};
  for (const [flag, field] of [
    ['name', 'name'],
    ['short-description', 'short_description'],
    ['description', 'description'],
  ]) {
    const value = getFlag(parsed, flag);
    if (value !== undefined) patch[field] = value;
    else if (Object.hasOwn(input, field)) patch[field] = input[field];
  }
  for (const field of ['tags', 'categories']) {
    const value = getFlag(parsed, field);
    if (value !== undefined) patch[field] = commaList(value);
    else if (Object.hasOwn(input, field)) patch[field] = input[field];
  }
  if (Object.keys(patch).length === 0) {
    throw new Error(
      'Provide at least one of --name, --short-description, --description, --tags, --categories, or --metadata <json>.',
    );
  }
  return patch;
}

export async function runCreatorCenterUpdate(parsed, options = {}) {
  const command = 'creator-center-update';
  const context = createContext(parsed, command, options);
  if (!context.token || !context.client) {
    return authRequired(parsed, command, context.requiredScope);
  }
  const itemId = creatorItemId(parsed);
  if (!itemId) throw new Error('Missing --item-id <id>.');
  const patch = await readUpdatePatch(parsed);
  const result = await context.client.updateCreatorItemManagement(itemId, patch);
  if (!result.parsedJson || !result.response.ok) {
    const data = record(result.data);
    return {
      ok: false,
      schemaVersion: CREATOR_CENTER_SCHEMA,
      command,
      status: result.response.status,
      error: string(data.error || data.message) || `HTTP ${result.response.status}`,
      code: nullableString(data.code),
      updateRequiresPublisher:
        data.updateRequiresPublisher === true || data.code === 'publisher_required',
      nextAction:
        data.code === 'publisher_required'
          ? 'start_publisher_update'
          : 'review_item_status',
    };
  }
  return {
    ok: true,
    schemaVersion: CREATOR_CENTER_SCHEMA,
    command,
    item: normalizeCreatorCenterItem(unwrapData(result.data), {
      siteUrl: context.siteUrl,
    }),
  };
}

export async function runCreatorCenterUnpublish(parsed, options = {}) {
  const command = 'creator-center-unpublish';
  const context = createContext(parsed, command, options);
  if (!context.token || !context.client) {
    return authRequired(parsed, command, context.requiredScope);
  }
  const itemId = creatorItemId(parsed);
  if (!itemId) throw new Error('Missing --item-id <id>.');

  const itemPayload = await context.client.getCreatorItemManagement(itemId);
  const item = normalizeCreatorCenterItem(unwrapData(itemPayload), {
    siteUrl: context.siteUrl,
  });
  const confirmedItemId = getFlag(parsed, 'confirm-item-id');
  if (!confirmedItemId) {
    return {
      ok: true,
      schemaVersion: CREATOR_CENTER_SCHEMA,
      command,
      status: 'confirmation_required',
      requiresAction: true,
      actionType: 'confirm_unpublish',
      message:
        'Unpublishing hides this item from the Marketplace but preserves its versions, package, installs, and private draft.',
      item,
    };
  }
  if (confirmedItemId !== item.itemId) {
    return {
      ok: false,
      schemaVersion: CREATOR_CENTER_SCHEMA,
      command,
      status: 'confirmation_mismatch',
      code: 'confirmation_item_mismatch',
      error: 'The confirmed item ID does not match the owned item selected for unpublishing.',
      item,
    };
  }
  if (item.status !== 'published') {
    return {
      ok: true,
      schemaVersion: CREATOR_CENTER_SCHEMA,
      command,
      status: 'already_unpublished',
      alreadyUnpublished: true,
      item,
    };
  }

  const result = await context.client.unpublishCreatorItem(itemId);
  if (!result.parsedJson || !result.response.ok) {
    const data = record(result.data);
    return {
      ok: false,
      schemaVersion: CREATOR_CENTER_SCHEMA,
      command,
      status: result.response.status,
      code: nullableString(data.code),
      error: string(data.error || data.message) || `HTTP ${result.response.status}`,
    };
  }
  const data = record(result.data);
  return {
    ok: true,
    schemaVersion: CREATOR_CENTER_SCHEMA,
    command,
    status: 'unpublished',
    alreadyUnpublished: data.alreadyUnpublished === true,
    preserved: {
      item: true,
      versions: true,
      package: true,
      installRecords: true,
    },
    item: normalizeCreatorCenterItem(unwrapData(data), {
      siteUrl: context.siteUrl,
    }),
  };
}
