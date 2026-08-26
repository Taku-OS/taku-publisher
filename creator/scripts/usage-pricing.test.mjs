import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ESTIMATED_COST_BASIS,
  PRICE_TABLE_UPDATED_AT,
  clearReferencePriceCatalog,
  estimateUsageCostForModel,
  findModelPrice,
  installReferencePriceCatalog,
  summarizeEstimatedCost,
} from './usage-pricing.mjs';

test.afterEach(() => clearReferencePriceCatalog());

test('matches GPT-5.6 variants exactly at current standard API list prices', () => {
  assert.deepEqual(
    ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'].map((modelId) => {
      const price = findModelPrice(modelId);
      return [price?.model, price?.input, price?.cacheRead, price?.output];
    }),
    [
      ['gpt-5.6-sol', 5, 0.5, 30],
      ['gpt-5.6-terra', 2, 0.2, 12],
      ['gpt-5.6-luna', 0.2, 0.02, 1.2],
    ],
  );
  assert.equal(PRICE_TABLE_UPDATED_AT, '2026-07-30');
});

test('does not silently price unknown GPT-5 family variants as GPT-5', () => {
  assert.equal(findModelPrice('gpt-5.6-unknown'), undefined);
  assert.equal(findModelPrice('gpt-5.7'), undefined);
  assert.equal(findModelPrice('gpt-5'), findModelPrice('gpt-5-2025-08-07'));
});

test('prices cached GPT-5.6 client tokens as an API list-price equivalent, not actual spend', () => {
  const cost = estimateUsageCostForModel('gpt-5.6-sol', {
    inputTokens: 1_000_000,
    cacheReadTokens: 900_000,
    outputTokens: 10_000,
    totalTokens: 1_010_000,
  });
  assert.equal(cost.totalUsd, 1.25);
  assert.equal(cost.actualSpend, false);
  assert.equal(cost.pricingBasis, ESTIMATED_COST_BASIS);
});

test('reconciles pricing coverage against all observed local client tokens', () => {
  const summary = summarizeEstimatedCost([
    { modelId: 'gpt-5.6-luna', inputTokens: 100, totalTokens: 100 },
  ], 1_000);
  assert.equal(summary.pricedTokenCount, 100);
  assert.equal(summary.unpricedTokenCount, 900);
  assert.equal(summary.coverageRatio, 0.1);
  assert.equal(summary.partial, true);
});

test('uses Proxy reference prices before the bundled fallback table', () => {
  const installed = installReferencePriceCatalog({
    schema_version: 'taku.model-reference-pricing.v1',
    period: '2026-08',
    prices: [{
      model_id: 'openai/gpt-5.6-sol',
      billing_mode: 'tokens',
      source: 'openrouter',
      input_usd_per_million: 7,
      output_usd_per_million: 35,
      cache_read_usd_per_million: 0.7,
      cache_creation_usd_per_million: 8,
    }],
  });
  assert.equal(installed, 1);
  const cost = estimateUsageCostForModel('gpt-5.6-sol', {

    inputTokens: 1_100_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 100_000,
    totalTokens: 2_100_000,
  });
  assert.equal(cost.totalUsd, 42.07);
  assert.equal(cost.provider, 'OpenAI');
  assert.equal(cost.priceSource, 'openrouter');
  assert.equal(cost.priceTableUpdatedAt, '2026-08');
});
