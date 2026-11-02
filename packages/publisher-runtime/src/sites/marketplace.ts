import type { JsonObject } from '../types.js';
import { isRecord, PublisherError } from '../util.js';
import type { SitesHttpClient } from './http.js';

export type MarketplaceChoice = 'public' | 'private';
type Directory = {
  version: number;
  listingIntent: 'listed' | 'unlisted';
  effectiveVisibility: 'listed' | 'unlisted';
  canList: boolean;
};

export function marketplaceChoice(value: unknown): MarketplaceChoice | undefined {
  if (value === undefined) return undefined;
  if (value === 'public' || value === 'private') return value;
  throw new PublisherError('Use --listing public or --listing private after asking the user about Marketplace discovery.', 'sites_listing_invalid');
}

function directoryView(value: unknown): Directory {
  if (!isRecord(value) || !Number.isSafeInteger(value.version) || Number(value.version) < 0 || Number(value.version) >= 2147483647 ||
    (value.listingIntent !== 'listed' && value.listingIntent !== 'unlisted') ||
    (value.effectiveVisibility !== 'listed' && value.effectiveVisibility !== 'unlisted') || typeof value.canList !== 'boolean') {
    throw new PublisherError('Marketplace directory state is unavailable. Check the Site in Console → Sites.', 'sites_directory_unavailable');
  }
  return value as Directory;
}

/** Reconcile writes by reading; never replay a stale version over another owner's session. */
export async function updateMarketplaceListing(
  client: Pick<SitesHttpClient, 'get' | 'patch'>, projectId: string, choice: MarketplaceChoice,
  site?: Record<string, unknown>,
): Promise<JsonObject> {
  if (!/^prj_[a-z0-9][a-z0-9_]{2,62}$/.test(projectId)) {
    throw new PublisherError('Use an exact owned Site project ID.', 'sites_project_id_invalid');
  }
  const endpoint = `/v1/sites/${projectId}`;
  const before = directoryView((site ?? await client.get(endpoint)).directory);
  const intent = choice === 'public' ? 'listed' : 'unlisted';
  if (before.listingIntent === intent) return listingResult(choice, before);
  try {
    const response = await client.patch(`${endpoint}/directory`, { expectedVersion: before.version, listingIntent: intent });
    const after = directoryView(response.directory);
    if (after.listingIntent !== intent) throw new PublisherError('Marketplace response did not confirm the requested listing.', 'sites_listing_not_confirmed');
    return listingResult(choice, after);
  } catch (error) {
    // A lost response or CAS conflict may already have committed the same intent.
    const fresh = await client.get(endpoint).then(value => directoryView(value.directory)).catch(() => null);
    if (fresh?.listingIntent === intent) return listingResult(choice, fresh);
    throw error;
  }
}

function listingResult(choice: MarketplaceChoice, directory: Directory): JsonObject {
  return { choice, status: directory.effectiveVisibility, listing_intent: directory.listingIntent,
    effective_visibility: directory.effectiveVisibility };
}

export function marketplaceFailure(choice: MarketplaceChoice, error: unknown): JsonObject {
  const details = error instanceof PublisherError ? error.details : {};
  return { choice, status: 'failed', error: { code: error instanceof PublisherError ? error.code : 'sites_listing_failed',
    ...(typeof details.http_status === 'number' ? { http_status: details.http_status } : {}),
    ...(typeof details.server_error === 'string' ? { server_error: details.server_error } : {}),
    ...(typeof details.request_id === 'string' ? { request_id: details.request_id } : {}) } };
}
