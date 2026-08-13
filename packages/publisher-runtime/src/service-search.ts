import type { SubAppServiceRequirementV1 } from '@taku/subapp-contract';

import type { JsonObject } from './types.js';
import { isRecord, PublisherError } from './util.js';
import {
  resolveTakuServiceCatalogUrl,
  type TakuServiceCatalogPriceV1,
  type TakuServiceCatalogV1,
} from './service-catalog.js';

export const TAKU_SERVICE_SEARCH_SCHEMA_VERSION =
  'taku.service-search.v1' as const;

const SERVICE_SEARCH_PATH = '/service/search';
const MAX_SERVICE_SEARCH_BYTES = 2 * 1024 * 1024;
const MAX_DISCOVERY_REQUIREMENTS = 20;
const CATALOG_ID_PATTERN = /^[a-z][A-Za-z0-9._-]{0,127}$/;
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export interface TakuServiceSearchResultV1 {
  serviceId: string;
  endpointId: string;
  serviceTitle: string;
  method: string;
  path: string;
  summary: string;
  inputSchema: string;
  score?: number;
}

export interface TakuServiceSearchResponseV1 {
  schemaVersion: typeof TAKU_SERVICE_SEARCH_SCHEMA_VERSION;
  query: string;
  results: TakuServiceSearchResultV1[];
}

export interface SubAppServiceCandidateV1 {
  serviceId: string;
  endpointId: string;
  serviceTitle: string;
  method: string;
  path: string;
  summary: string;
  inputSchema: string;
  score?: number;
  pricing: {
    billingMode: 'token' | 'invocation';
    price: TakuServiceCatalogPriceV1;
  };
}

export interface SubAppServiceDiscoveryRequirementV1 {
  requirementId: string;
  query: string;
  status: 'suggestions-ready' | 'no-matches' | 'unavailable';
  candidates: SubAppServiceCandidateV1[];
  errorCode?: string;
  message?: string;
}

export interface SubAppServiceDiscoveryV1 {
  status: 'completed' | 'partial' | 'unavailable';
  url: string;
  catalogDigest?: string;
  requirements: SubAppServiceDiscoveryRequirementV1[];
}

export type TakuServiceSearchLoader = (request: {
  url: string;
  query: string;
  limit: number;
  timeoutMs: number;
}) => Promise<TakuServiceSearchResponseV1>;

export function resolveTakuServiceSearchUrl(catalogUrl: string): string {
  let normalizedUrl = catalogUrl;
  try {
    const candidate = new URL(catalogUrl);
    if (candidate.pathname.replace(/\/+$/, '') === SERVICE_SEARCH_PATH) {
      candidate.pathname = '/service/catalog/v1';
      normalizedUrl = candidate.toString();
    }
  } catch {
    // The Catalog resolver below returns the stable Publisher URL error.
  }
  const trustedCatalogUrl = new URL(
    resolveTakuServiceCatalogUrl(normalizedUrl, {}),
  );
  trustedCatalogUrl.pathname = SERVICE_SEARCH_PATH;
  trustedCatalogUrl.search = '';
  trustedCatalogUrl.hash = '';
  return trustedCatalogUrl.toString();
}

export async function fetchTakuServiceSearch(
  request: {
    url: string;
    query: string;
    limit?: number;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<TakuServiceSearchResponseV1> {
  const baseUrl = resolveTakuServiceSearchUrl(request.url);
  const query = normalizeSearchQuery(request.query);
  const limit = normalizeSearchLimit(request.limit);
  const timeoutMs = normalizeSearchTimeout(request.timeoutMs);
  const url = new URL(baseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('semantic_weight', '0.8');
  url.searchParams.set('input_enrichment', 'true');
  url.searchParams.set('reranking', 'true');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await (request.fetchImpl || fetch)(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (error) {
    throw new PublisherError(
      controller.signal.aborted
        ? 'Taku service search request timed out.'
        : 'Taku service search is unavailable.',
      controller.signal.aborted
        ? 'service_search_timeout'
        : 'service_search_unavailable',
      { error: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new PublisherError(
      `Taku service search failed with HTTP ${response.status}.`,
      'service_search_unavailable',
      { status: response.status },
    );
  }
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_SERVICE_SEARCH_BYTES) {
    throw new PublisherError(
      'Taku service search response is too large.',
      'service_search_too_large',
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_SERVICE_SEARCH_BYTES) {
    throw new PublisherError(
      'Taku service search response is too large.',
      'service_search_too_large',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw invalidSearch('Taku service search returned invalid JSON.');
  }
  return parseTakuServiceSearch(parsed, query, limit);
}

export async function discoverSubAppServiceCandidates(
  requirements: SubAppServiceRequirementV1[],
  catalog: TakuServiceCatalogV1,
  request: {
    url: string;
    limit?: number;
    timeoutMs?: number;
    loadSearch?: TakuServiceSearchLoader;
  },
): Promise<SubAppServiceDiscoveryV1> {
  const unresolved = requirements.filter(
    (requirement) => requirement.mapping.status !== 'mapped',
  );
  const searchUrl = resolveTakuServiceSearchUrl(request.url);
  const limit = normalizeSearchLimit(request.limit);
  const timeoutMs = normalizeSearchTimeout(request.timeoutMs);
  const loader = request.loadSearch || ((input) => fetchTakuServiceSearch(input));
  const requirementsToSearch = unresolved.slice(0, MAX_DISCOVERY_REQUIREMENTS);
  const discovered = await Promise.all(
    requirementsToSearch.map(async (requirement) => {
      const query = searchQueryForRequirement(requirement);
      try {
        const response = await loader({
          url: searchUrl,
          query,
          limit,
          timeoutMs,
        });
        const candidates = candidatesFromCatalog(response.results, catalog, limit);
        return {
          requirementId: requirement.id,
          query,
          status: candidates.length > 0 ? 'suggestions-ready' : 'no-matches',
          candidates,
        } satisfies SubAppServiceDiscoveryRequirementV1;
      } catch (error) {
        const publisherError = error instanceof PublisherError
          ? error
          : new PublisherError(
              'Taku service search is unavailable.',
              'service_search_unavailable',
            );
        return {
          requirementId: requirement.id,
          query,
          status: 'unavailable',
          candidates: [],
          errorCode: publisherError.code,
          message: publisherError.message,
        } satisfies SubAppServiceDiscoveryRequirementV1;
      }
    }),
  );
  for (const requirement of unresolved.slice(MAX_DISCOVERY_REQUIREMENTS)) {
    discovered.push({
      requirementId: requirement.id,
      query: searchQueryForRequirement(requirement),
      status: 'unavailable',
      candidates: [],
      errorCode: 'service_search_requirement_limit',
      message: `Only ${MAX_DISCOVERY_REQUIREMENTS} unresolved service requirements can be searched in one assessment.`,
    });
  }
  const unavailable = discovered.filter(
    (requirement) => requirement.status === 'unavailable',
  ).length;
  return {
    status: unavailable === 0
      ? 'completed'
      : unavailable === discovered.length
        ? 'unavailable'
        : 'partial',
    url: searchUrl,
    catalogDigest: catalog.digest,
    requirements: discovered,
  };
}

function candidatesFromCatalog(
  results: TakuServiceSearchResultV1[],
  catalog: TakuServiceCatalogV1,
  limit: number,
): SubAppServiceCandidateV1[] {
  const services = new Map(catalog.services.map((service) => [service.id, service]));
  const seen = new Set<string>();
  const candidates: SubAppServiceCandidateV1[] = [];
  for (const result of results) {
    const service = services.get(result.serviceId);
    const endpoint = service?.endpoints.find(
      (candidate) => candidate.id === result.endpointId,
    );
    if (!service || service.status !== 'active' || !endpoint || endpoint.status !== 'active') {
      continue;
    }
    const key = `${service.id}\0${endpoint.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      serviceId: service.id,
      endpointId: endpoint.id,
      serviceTitle: service.title,
      method: endpoint.method,
      path: endpoint.path,
      summary: endpoint.summary,
      inputSchema: endpoint.inputSchema,
      ...(result.score === undefined ? {} : { score: result.score }),
      pricing: {
        billingMode: endpoint.pricing.billingMode,
        price: { ...endpoint.pricing.price },
      },
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

function parseTakuServiceSearch(
  value: unknown,
  expectedQuery: string,
  limit: number,
): TakuServiceSearchResponseV1 {
  const root = record(value, 'service search');
  if (root.schema_version !== TAKU_SERVICE_SEARCH_SCHEMA_VERSION) {
    throw invalidSearch('Unsupported Taku service search schema version.');
  }
  if (text(root.query, 'service search query') !== expectedQuery) {
    throw invalidSearch('Taku service search query does not match the request.');
  }
  if (!Array.isArray(root.results) || root.results.length > limit) {
    throw invalidSearch('Taku service search results are invalid.');
  }
  if (root.count !== root.results.length) {
    throw invalidSearch('Taku service search count does not match its results.');
  }
  const results = root.results.map((rawResult) => {
    const result = record(rawResult, 'service search result');
    const serviceId = catalogId(result.service_id, 'search service_id');
    const endpointId = catalogId(result.endpoint_id, 'search endpoint_id');
    const method = text(result.method, 'search method').toUpperCase();
    if (!HTTP_METHODS.has(method)) {
      throw invalidSearch(`Unsupported search method for ${serviceId}.${endpointId}.`);
    }
    const publicPath = text(result.path, 'search path');
    if (!publicPath.startsWith('/service/')) {
      throw invalidSearch(`Unsafe search path for ${serviceId}.${endpointId}.`);
    }
    const score = result.score;
    if (
      score !== undefined &&
      (typeof score !== 'number' || !Number.isFinite(score) || score < 0)
    ) {
      throw invalidSearch(`Invalid search score for ${serviceId}.${endpointId}.`);
    }
    return {
      serviceId,
      endpointId,
      serviceTitle: optionalText(result.service_title),
      method,
      path: publicPath,
      summary: optionalText(result.summary),
      inputSchema: optionalText(result.input_schema),
      ...(score === undefined ? {} : { score }),
    } satisfies TakuServiceSearchResultV1;
  });
  return {
    schemaVersion: TAKU_SERVICE_SEARCH_SCHEMA_VERSION,
    query: expectedQuery,
    results,
  };
}

function searchQueryForRequirement(
  requirement: SubAppServiceRequirementV1,
): string {
  return normalizeSearchQuery(
    [
      requirement.capability,
      ...requirement.operations,
      requirement.detectedProvider || '',
    ].join(' '),
  );
}

function normalizeSearchQuery(value: string): string {
  const query = String(value || '')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 300);
  if (!query) {
    throw new PublisherError(
      'Taku service search query is empty.',
      'service_search_query_invalid',
    );
  }
  return query;
}

function normalizeSearchLimit(value: number | undefined): number {
  const limit = value === undefined ? 5 : Math.trunc(value);
  if (!Number.isFinite(limit) || limit < 1 || limit > 10) {
    throw new PublisherError(
      'Taku service search limit must be between 1 and 10.',
      'service_search_limit_invalid',
    );
  }
  return limit;
}

function normalizeSearchTimeout(value: number | undefined): number {
  const timeoutMs = value === undefined ? 15_000 : Math.trunc(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new PublisherError(
      'Taku service search timeout must be between 1 and 60 seconds.',
      'service_search_timeout_invalid',
    );
  }
  return timeoutMs;
}

function catalogId(value: unknown, label: string): string {
  const id = text(value, label);
  if (!CATALOG_ID_PATTERN.test(id)) {
    throw invalidSearch(`${label} is invalid.`);
  }
  return id;
}

function record(value: unknown, label: string): JsonObject {
  if (!isRecord(value)) throw invalidSearch(`${label} must be an object.`);
  return value;
}

function text(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw invalidSearch(`${label} is required.`);
  return normalized;
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function invalidSearch(message: string): PublisherError {
  return new PublisherError(message, 'service_search_invalid');
}
