export const ESTIMATED_COST_SCHEMA = 'taku.creator.estimated-cost.v1';
export const PRICE_TABLE_UPDATED_AT = '2026-07-01';
const TOKENS_PER_MILLION = 1_000_000;

const PRICE_RULES = [
  // Cursor-specific pools must match before generic provider model rules.
  { id: 'cursor-auto', provider: 'Cursor', model: 'auto', patterns: [/^(cursor[-_:/\s]*)?auto$/i], input: 1.25, cacheWrite: 1.25, cacheRead: 0.25, output: 6 },
  { id: 'cursor-composer-2.5', provider: 'Cursor', model: 'composer-2.5', patterns: [/composer[\s._-]*2\.?5/i], input: 0.5, cacheWrite: 0.5, cacheRead: 0.2, output: 2.5 },
  { id: 'cursor-composer-2', provider: 'Cursor', model: 'composer-2', patterns: [/composer[\s._-]*2(?!\.?5)/i], input: 0.5, cacheWrite: 0.5, cacheRead: 0.2, output: 2.5 },
  { id: 'cursor-composer-1.5', provider: 'Cursor', model: 'composer-1.5', patterns: [/composer[\s._-]*1\.?5/i], input: 3.5, cacheWrite: 3.5, cacheRead: 0.35, output: 17.5 },
  { id: 'cursor-composer-1', provider: 'Cursor', model: 'composer-1', patterns: [/composer[\s._-]*1(?!\.?5)/i], input: 1.25, cacheWrite: 1.25, cacheRead: 0.125, output: 10 },

  { id: 'openai-gpt-5.5', provider: 'OpenAI', model: 'gpt-5.5', patterns: [/gpt[-_.\s]*5\.?5/i], input: 5, cacheRead: 0.5, output: 30 },
  { id: 'openai-gpt-5.4-mini', provider: 'OpenAI', model: 'gpt-5.4-mini', patterns: [/gpt[-_.\s]*5\.?4[-_.\s]*mini/i], input: 0.75, cacheRead: 0.075, output: 4.5 },
  { id: 'openai-gpt-5.4-nano', provider: 'OpenAI', model: 'gpt-5.4-nano', patterns: [/gpt[-_.\s]*5\.?4[-_.\s]*nano/i], input: 0.2, cacheRead: 0.02, output: 1.25 },
  { id: 'openai-gpt-5.4', provider: 'OpenAI', model: 'gpt-5.4', patterns: [/gpt[-_.\s]*5\.?4/i], input: 2.5, cacheRead: 0.25, output: 15 },
  { id: 'openai-gpt-5.3-codex', provider: 'OpenAI', model: 'gpt-5.3-codex', patterns: [/gpt[-_.\s]*5\.?3[-_.\s]*codex/i], input: 1.75, cacheRead: 0.175, output: 14 },
  { id: 'openai-gpt-5.2-codex', provider: 'OpenAI', model: 'gpt-5.2-codex', patterns: [/gpt[-_.\s]*5\.?2[-_.\s]*codex/i], input: 1.75, cacheRead: 0.175, output: 14 },
  { id: 'openai-gpt-5.2', provider: 'OpenAI', model: 'gpt-5.2', patterns: [/gpt[-_.\s]*5\.?2/i], input: 1.75, cacheRead: 0.175, output: 14 },
  { id: 'openai-gpt-5.1-codex-mini', provider: 'OpenAI', model: 'gpt-5.1-codex-mini', patterns: [/gpt[-_.\s]*5\.?1[-_.\s]*codex[-_.\s]*mini/i], input: 0.25, cacheRead: 0.025, output: 2 },
  { id: 'openai-gpt-5.1-codex', provider: 'OpenAI', model: 'gpt-5.1-codex', patterns: [/gpt[-_.\s]*5\.?1[-_.\s]*codex/i], input: 1.25, cacheRead: 0.125, output: 10 },
  { id: 'openai-gpt-5-codex', provider: 'OpenAI', model: 'gpt-5-codex', patterns: [/gpt[-_.\s]*5[-_.\s]*codex/i], input: 1.25, cacheRead: 0.125, output: 10 },
  { id: 'openai-gpt-5-mini', provider: 'OpenAI', model: 'gpt-5-mini', patterns: [/gpt[-_.\s]*5[-_.\s]*mini/i], input: 0.25, cacheRead: 0.025, output: 2 },
  { id: 'openai-gpt-5-fast', provider: 'OpenAI', model: 'gpt-5-fast', patterns: [/gpt[-_.\s]*5.*fast/i], input: 2.5, cacheRead: 0.25, output: 20 },
  { id: 'openai-gpt-5', provider: 'OpenAI', model: 'gpt-5', patterns: [/gpt[-_.\s]*5/i], input: 1.25, cacheRead: 0.125, output: 10 },
  { id: 'openai-gpt-4.1-mini', provider: 'OpenAI', model: 'gpt-4.1-mini', patterns: [/gpt[-_.\s]*4\.?1[-_.\s]*mini/i], input: 0.4, cacheRead: 0.1, output: 1.6 },
  { id: 'openai-gpt-4.1-nano', provider: 'OpenAI', model: 'gpt-4.1-nano', patterns: [/gpt[-_.\s]*4\.?1[-_.\s]*nano/i], input: 0.1, cacheRead: 0.025, output: 0.4 },
  { id: 'openai-gpt-4.1', provider: 'OpenAI', model: 'gpt-4.1', patterns: [/gpt[-_.\s]*4\.?1/i], input: 2, cacheRead: 0.5, output: 8 },
  { id: 'openai-gpt-4o-mini', provider: 'OpenAI', model: 'gpt-4o-mini', patterns: [/gpt[-_.\s]*4o[-_.\s]*mini/i], input: 0.15, cacheRead: 0.075, output: 0.6 },
  { id: 'openai-gpt-4o', provider: 'OpenAI', model: 'gpt-4o', patterns: [/gpt[-_.\s]*4o/i], input: 2.5, cacheRead: 1.25, output: 10 },
  { id: 'openai-o4-mini', provider: 'OpenAI', model: 'o4-mini', patterns: [/^o4[-_.\s]*mini/i], input: 1.1, cacheRead: 0.275, output: 4.4 },
  { id: 'openai-o3', provider: 'OpenAI', model: 'o3', patterns: [/^o3(?![-_.\s]*mini)/i], input: 2, cacheRead: 0.5, output: 8 },
  { id: 'openai-o3-mini', provider: 'OpenAI', model: 'o3-mini', patterns: [/^o3[-_.\s]*mini/i], input: 1.1, cacheRead: 0.55, output: 4.4 },

  { id: 'anthropic-claude-opus-4-8', provider: 'Anthropic', model: 'claude-opus-4.8', patterns: [/claude.*opus.*4[._-]?8|opus.*4[._-]?8/i], input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  { id: 'anthropic-claude-opus-4-7', provider: 'Anthropic', model: 'claude-opus-4.7', patterns: [/claude.*opus.*4[._-]?7|opus.*4[._-]?7/i], input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  { id: 'anthropic-claude-opus-4-6', provider: 'Anthropic', model: 'claude-opus-4.6', patterns: [/claude.*opus.*4[._-]?6|opus.*4[._-]?6/i], input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  { id: 'anthropic-claude-opus-4-5', provider: 'Anthropic', model: 'claude-opus-4.5', patterns: [/claude.*opus.*4[._-]?5|opus.*4[._-]?5/i], input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  { id: 'anthropic-claude-opus-4', provider: 'Anthropic', model: 'claude-opus-4', patterns: [/claude.*opus.*4|opus.*4/i], input: 15, cacheWrite: 18.75, cacheRead: 1.5, output: 75 },
  { id: 'anthropic-claude-sonnet-4-6', provider: 'Anthropic', model: 'claude-sonnet-4.6', patterns: [/claude.*sonnet.*4[._-]?6|sonnet.*4[._-]?6/i], input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  { id: 'anthropic-claude-sonnet-4-5', provider: 'Anthropic', model: 'claude-sonnet-4.5', patterns: [/claude.*sonnet.*4[._-]?5|sonnet.*4[._-]?5/i], input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  { id: 'anthropic-claude-sonnet-4', provider: 'Anthropic', model: 'claude-sonnet-4', patterns: [/claude.*sonnet.*4|sonnet.*4/i], input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  { id: 'anthropic-claude-haiku-4-5', provider: 'Anthropic', model: 'claude-haiku-4.5', patterns: [/claude.*haiku.*4[._-]?5|haiku.*4[._-]?5/i], input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
  { id: 'anthropic-claude-3-5-sonnet', provider: 'Anthropic', model: 'claude-3.5-sonnet', patterns: [/claude.*3[._-]?5.*sonnet|sonnet.*3[._-]?5/i], input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },

  { id: 'google-gemini-3.5-flash', provider: 'Google', model: 'gemini-3.5-flash', patterns: [/gemini.*3[._-]?5.*flash/i], input: 1.5, cacheRead: 0.15, output: 9 },
  { id: 'google-gemini-3.1-pro', provider: 'Google', model: 'gemini-3.1-pro', patterns: [/gemini.*3[._-]?1.*pro/i], input: 2, cacheRead: 0.2, output: 12 },
  { id: 'google-gemini-3-pro', provider: 'Google', model: 'gemini-3-pro', patterns: [/gemini.*3.*pro/i], input: 2, cacheRead: 0.2, output: 12 },
  { id: 'google-gemini-3-flash', provider: 'Google', model: 'gemini-3-flash', patterns: [/gemini.*3.*flash/i], input: 0.5, cacheRead: 0.05, output: 3 },
  { id: 'google-gemini-2.5-pro', provider: 'Google', model: 'gemini-2.5-pro', patterns: [/gemini.*2[._-]?5.*pro/i], input: 1.25, cacheRead: 0.125, output: 10 },
  { id: 'google-gemini-2.5-flash-lite', provider: 'Google', model: 'gemini-2.5-flash-lite', patterns: [/gemini.*2[._-]?5.*flash.*lite/i], input: 0.1, cacheRead: 0.01, output: 0.4 },
  { id: 'google-gemini-2.5-flash', provider: 'Google', model: 'gemini-2.5-flash', patterns: [/gemini.*2[._-]?5.*flash/i], input: 0.3, cacheRead: 0.03, output: 2.5 },
  { id: 'google-gemini-2.0-flash-lite', provider: 'Google', model: 'gemini-2.0-flash-lite', patterns: [/gemini.*2[._-]?0.*flash.*lite/i], input: 0.075, cacheRead: 0.01875, output: 0.3 },
  { id: 'google-gemini-2.0-flash', provider: 'Google', model: 'gemini-2.0-flash', patterns: [/gemini.*2[._-]?0.*flash/i], input: 0.1, cacheRead: 0.025, output: 0.4 },
];

export function createEmptyEstimatedCostSummary() {
  return {
    schemaVersion: ESTIMATED_COST_SCHEMA,
    currency: 'USD',
    estimated: true,
    priceTableUpdatedAt: PRICE_TABLE_UPDATED_AT,
    totalUsd: 0,
    pricedTokenCount: 0,
    unpricedTokenCount: 0,
    pricedModelCount: 0,
    unpricedModelCount: 0,
    topModels: [],
    warnings: [],
  };
}

export function estimateUsageCostForModel(modelId, numbers = {}) {
  const price = findModelPrice(modelId);
  const totalTokens = nonNegativeInteger(numbers.totalTokens);
  const inputTokens = nonNegativeInteger(numbers.inputTokens);
  const outputTokens = nonNegativeInteger(numbers.outputTokens);
  const cacheReadTokens = nonNegativeInteger(numbers.cacheReadTokens);
  const cacheCreationTokens = nonNegativeInteger(numbers.cacheCreationTokens);
  const reasoningTokens = nonNegativeInteger(numbers.reasoningTokens);
  const knownTokenCount = inputTokens + outputTokens + reasoningTokens +
    cacheTokensNotIncludedInInput(price, cacheReadTokens, cacheCreationTokens);
  const empty = {
    schemaVersion: ESTIMATED_COST_SCHEMA,
    currency: 'USD',
    estimated: true,
    priceTableUpdatedAt: PRICE_TABLE_UPDATED_AT,
    modelId: sanitizeModelId(modelId),
    priceMatched: false,
    provider: '',
    pricingModel: '',
    totalUsd: 0,
    inputUsd: 0,
    outputUsd: 0,
    cacheReadUsd: 0,
    cacheCreationUsd: 0,
    billableInputTokens: 0,
    pricedTokenCount: 0,
    unpricedTokenCount: totalTokens || knownTokenCount,
    pricePerMillionTokens: {},
  };
  if (!price) return empty;

  const billableInputTokens = billableInputTokenCount(price, inputTokens, cacheReadTokens, cacheCreationTokens);
  const pricedTokenCount = billableInputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheCreationTokens;
  const unknownTokenCount = Math.max(0, totalTokens - knownTokenCount);
  if (pricedTokenCount <= 0) return empty;
  const cacheWritePrice = finiteOrFallback(price.cacheWrite, price.input);
  const cacheReadPrice = finiteOrFallback(price.cacheRead, 0);
  const inputUsd = costForTokens(billableInputTokens, price.input);
  const outputUsd = costForTokens(outputTokens + reasoningTokens, price.output);
  const cacheReadUsd = costForTokens(cacheReadTokens, cacheReadPrice);
  const cacheCreationUsd = costForTokens(cacheCreationTokens, cacheWritePrice);
  const totalUsd = inputUsd + outputUsd + cacheReadUsd + cacheCreationUsd;
  return {
    ...empty,
    priceMatched: true,
    provider: price.provider,
    pricingModel: price.model,
    totalUsd: roundMoney(totalUsd),
    inputUsd: roundMoney(inputUsd),
    outputUsd: roundMoney(outputUsd),
    cacheReadUsd: roundMoney(cacheReadUsd),
    cacheCreationUsd: roundMoney(cacheCreationUsd),
    billableInputTokens,
    pricedTokenCount,
    unpricedTokenCount: unknownTokenCount,
    pricePerMillionTokens: {
      input: price.input,
      output: price.output,
      cacheRead: cacheReadPrice,
      cacheCreation: cacheWritePrice,
    },
  };
}

export function summarizeEstimatedCost(modelRows) {
  const summary = createEmptyEstimatedCostSummary();
  const rows = Array.isArray(modelRows) ? modelRows : [];
  for (const row of rows) {
    const cost = row?.estimatedCost || estimateUsageCostForModel(row?.modelId || row?.name, row);
    summary.totalUsd += Number(cost.totalUsd) || 0;
    summary.pricedTokenCount += nonNegativeInteger(cost.pricedTokenCount);
    summary.unpricedTokenCount += nonNegativeInteger(cost.unpricedTokenCount);
    if (cost.priceMatched) summary.pricedModelCount += 1;
    else if (nonNegativeInteger(row?.totalTokens) > 0) summary.unpricedModelCount += 1;
  }
  summary.totalUsd = roundMoney(summary.totalUsd);
  summary.topModels = rows
    .map((row) => row?.estimatedCost || estimateUsageCostForModel(row?.modelId || row?.name, row))
    .filter((cost) => cost.priceMatched && cost.totalUsd > 0)
    .sort((left, right) => right.totalUsd - left.totalUsd || String(left.modelId).localeCompare(String(right.modelId)))
    .slice(0, 4)
    .map((cost) => ({
      modelId: cost.modelId,
      provider: cost.provider,
      pricingModel: cost.pricingModel,
      totalUsd: cost.totalUsd,
    }));
  if (summary.unpricedTokenCount > 0) {
    summary.warnings.push(`${summary.unpricedTokenCount} token(s) could not be priced because the model id was missing, unrecognized, or not broken down by token type.`);
  }
  return summary;
}

export function formatEstimatedUsd(value) {
  const amount = Number(value) || 0;
  if (amount <= 0) return '$0';
  if (amount < 0.01) return '<$0.01';
  if (amount < 100) return `$${amount.toFixed(2)}`;
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

export function sanitizeModelId(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 160) return '';
  if (/^https?:\/\//i.test(text)) return '';
  if (/\s/.test(text) && text.split(/\s+/).length > 4) return '';
  return text;
}

export function findModelPrice(modelId) {
  const text = sanitizeModelId(modelId);
  if (!text) return undefined;
  return PRICE_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(text)));
}

function billableInputTokenCount(price, inputTokens, cacheReadTokens, cacheCreationTokens) {
  const includedCacheReadTokens = inputIncludesCacheRead(price) ? cacheReadTokens : 0;
  const includedCacheCreationTokens = inputIncludesCacheCreation(price) ? cacheCreationTokens : 0;
  return Math.max(0, inputTokens - includedCacheReadTokens - includedCacheCreationTokens);
}

function cacheTokensNotIncludedInInput(price, cacheReadTokens, cacheCreationTokens) {
  return (inputIncludesCacheRead(price) ? 0 : cacheReadTokens) +
    (inputIncludesCacheCreation(price) ? 0 : cacheCreationTokens);
}

function inputIncludesCacheRead(price) {
  return price ? ['OpenAI', 'Google', 'Cursor'].includes(price.provider) : false;
}

function inputIncludesCacheCreation(price) {
  return price ? ['OpenAI', 'Google', 'Cursor'].includes(price.provider) : false;
}

function costForTokens(tokens, pricePerMillion) {
  const price = Number(pricePerMillion);
  if (!Number.isFinite(price) || price <= 0) return 0;
  return (nonNegativeInteger(tokens) / TOKENS_PER_MILLION) * price;
}

function finiteOrFallback(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function nonNegativeInteger(value) {
  const next = Math.floor(Number(value) || 0);
  return next > 0 ? next : 0;
}

function roundMoney(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}
