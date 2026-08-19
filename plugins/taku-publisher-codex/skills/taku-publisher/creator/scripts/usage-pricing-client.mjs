import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { installReferencePriceCatalog } from './usage-pricing.mjs';

export const REFERENCE_PRICING_SCHEMA = 'taku.model-reference-pricing.v1';
export const DEFAULT_REFERENCE_PRICING_URL = 'https://ai-proxy.taku.ai/pricing/models/v1';
const CACHE_SCHEMA = 'taku.publisher.reference-pricing-cache.v1';
const DEFAULT_TIMEOUT_MS = 5_000;

export function referencePricingCachePath(homeDir) {
  return path.join(path.resolve(homeDir), '.taku', 'publisher', 'model-reference-pricing.json');
}

export function resolveReferencePricingUrl(parsed) {
  const explicit = parsed?.flags?.get?.('model-pricing-url');
  const direct = String(
    (typeof explicit === 'string' ? explicit : '')
    || process.env.TAKU_MODEL_PRICING_URL
    || ''
  ).trim();
  if (direct) return normalizePricingUrl(direct);
  const proxyBase = String(process.env.TAKU_AI_PROXY_BASE_URL || '').trim();
  if (proxyBase) return `${proxyBase.replace(/\/+$/, '')}/pricing/models/v1`;
  return DEFAULT_REFERENCE_PRICING_URL;
}

export async function loadReferencePricing(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const expectedPeriod = now.toISOString().slice(0, 7);
  const cachePath = path.resolve(options.cachePath || referencePricingCachePath(options.homeDir));
  const cached = await readPricingCache(cachePath);
  if (validCatalog(cached?.catalog) && cached.catalog.period === expectedPeriod) {
    const installedCount = installReferencePriceCatalog(cached.catalog);
    return { source: 'cache', installedCount, period: cached.catalog.period, cachePath };
  }

  if (!options.localOnly) {
    try {
      const catalog = await fetchReferencePricing({
        url: options.url || DEFAULT_REFERENCE_PRICING_URL,
        fetchImpl: options.fetchImpl || fetch,
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      });
      await writePricingCache(cachePath, catalog, now);
      const installedCount = installReferencePriceCatalog(catalog);
      return { source: 'network', installedCount, period: catalog.period, cachePath };
    } catch (error) {
      if (validCatalog(cached?.catalog)) {
        const installedCount = installReferencePriceCatalog(cached.catalog);
        return {
          source: 'stale-cache',
          installedCount,
          period: cached.catalog.period,
          cachePath,
          warning: `Model reference pricing refresh failed; using cached ${cached.catalog.period} prices.`,
        };
      }
      return {
        source: 'bundled',
        installedCount: 0,
        cachePath,
        warning: `Model reference pricing is unavailable; using bundled fallback prices (${safeErrorMessage(error)}).`,
      };
    }
  }

  if (validCatalog(cached?.catalog)) {
    const installedCount = installReferencePriceCatalog(cached.catalog);
    return { source: 'stale-cache', installedCount, period: cached.catalog.period, cachePath };
  }
  return { source: 'bundled', installedCount: 0, cachePath };
}

export async function fetchReferencePricing(options = {}) {
  const response = await options.fetchImpl(options.url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs || DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const catalog = await response.json();
  if (!validCatalog(catalog)) throw new Error('invalid pricing response');
  return catalog;
}

function validCatalog(value) {
  return value?.schema_version === REFERENCE_PRICING_SCHEMA
    && value?.currency === 'USD'
    && /^\d{4}-\d{2}$/.test(String(value?.period || ''))
    && Array.isArray(value?.prices);
}

async function readPricingCache(cachePath) {
  try {
    const value = JSON.parse(await fs.readFile(cachePath, 'utf8'));
    return value?.schemaVersion === CACHE_SCHEMA ? value : null;
  } catch {
    return null;
  }
}

async function writePricingCache(cachePath, catalog, now) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, `${JSON.stringify({
    schemaVersion: CACHE_SCHEMA,
    fetchedAt: now.toISOString(),
    catalog,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.chmod(cachePath, 0o600);
}

function normalizePricingUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  return trimmed.endsWith('/pricing/models/v1') ? trimmed : `${trimmed}/pricing/models/v1`;
}

function safeErrorMessage(error) {
  return String(error?.message || error || 'unknown error').slice(0, 160);
}
