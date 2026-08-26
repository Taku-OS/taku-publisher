import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  clearReferencePriceCatalog,
  estimateUsageCostForModel,
} from './usage-pricing.mjs';
import {
  loadReferencePricing,
  referencePricingCachePath,
  resolveReferencePricingUrl,
} from './usage-pricing-client.mjs';

test.afterEach(() => clearReferencePriceCatalog());

test('loads a monthly Proxy reference catalog and reuses its private local cache', async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-pricing-'));
  const catalog = {
    schema_version: 'taku.model-reference-pricing.v1',
    currency: 'USD',
    basis: 'monthly-market-api-price-equivalent',
    period: '2026-08',
    prices: [{
      model_id: 'example/model-a',
      billing_mode: 'tokens',
      source: 'uniapi',
      input_usd_per_million: 2,
      output_usd_per_million: 8,
    }],
  };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return Response.json(catalog);
  };
  try {
    const first = await loadReferencePricing({
      homeDir,
      now: new Date('2026-08-17T00:00:00Z'),
      url: 'https://example.test/pricing/models/v1',
      fetchImpl,
    });
    assert.equal(first.source, 'network');
    assert.equal(first.installedCount, 1);
    assert.equal(calls, 1);
    assert.equal((await fs.stat(referencePricingCachePath(homeDir))).mode & 0o777, 0o600);

    clearReferencePriceCatalog();
    const second = await loadReferencePricing({
      homeDir,
      now: new Date('2026-08-25T00:00:00Z'),
      url: 'https://example.test/pricing/models/v1',
      fetchImpl,
    });
    assert.equal(second.source, 'cache');
    assert.equal(calls, 1);
    const cost = estimateUsageCostForModel('model-a', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      totalTokens: 2_000_000,
    });
    assert.equal(cost.totalUsd, 10);
    assert.equal(cost.priceSource, 'uniapi');
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('uses bundled prices without a network request in local-only mode', async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-pricing-local-'));
  try {
    const result = await loadReferencePricing({
      homeDir,
      localOnly: true,
      fetchImpl: async () => {
        throw new Error('network should not be called');
      },
    });
    assert.equal(result.source, 'bundled');
    assert.equal(result.installedCount, 0);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('resolves a custom Proxy base or full pricing endpoint', () => {
  const previous = process.env.TAKU_AI_PROXY_BASE_URL;
  try {
    process.env.TAKU_AI_PROXY_BASE_URL = 'http://127.0.0.1:7819/';
    assert.equal(resolveReferencePricingUrl({ flags: new Map() }), 'http://127.0.0.1:7819/pricing/models/v1');
    assert.equal(
      resolveReferencePricingUrl({ flags: new Map([['model-pricing-url', 'https://proxy.test/pricing/models/v1']]) }),
      'https://proxy.test/pricing/models/v1',
    );
  } finally {
    if (previous === undefined) delete process.env.TAKU_AI_PROXY_BASE_URL;
    else process.env.TAKU_AI_PROXY_BASE_URL = previous;
  }
});
