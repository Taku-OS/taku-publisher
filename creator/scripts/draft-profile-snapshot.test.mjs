import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { buildBuilderProfileSnapshot, selectUsageForDraft } from './draft.mjs';
import { createStaxCreatorPublishPayload } from './publish-payload.mjs';

test('keeps AI Burn source and period metrics in the builder profile snapshot', () => {
  const source = {
    source: 'codex',
    label: 'Codex',
    totalTokens: 1200,
    sessionCount: 3,
    estimatedCost: { totalUsd: 4.25 },
  };
  const snapshot = buildBuilderProfileSnapshot({
    stats: {
      usage: {
        label: 'Today',
        periodId: 'today',
        totalTokens: 1200,
        sessionCount: 3,
        eventCount: 8,
        sources: [source],
        periods: [
          {
            id: 'today',
            label: 'Today',
            totalTokens: 1200,
            sessionCount: 3,
            eventCount: 8,
            sources: [source],
          },
        ],
      },
    },
  });

  assert.equal(snapshot.usage.sources[0].source, 'codex');
  assert.equal(snapshot.usage.sources[0].totalTokens, 1200);
  assert.equal(snapshot.usage.sources[0].estimatedCost.totalUsd, 4.25);
  assert.equal(snapshot.usage.periods[0].id, 'today');
  assert.equal(snapshot.usage.periods[0].sources[0].source, 'codex');
  assert.equal(snapshot.usage.periods[0].sources[0].totalTokens, 1200);
  assert.equal(snapshot.usage.periods[0].sources[0].estimatedCost.totalUsd, 4.25);
});

test('preserves scanned AI Burn model usage through draft normalization and publish payload', async () => {
  const privatePath = path.join(path.sep, 'Users', 'example', '.codex', 'sessions', 'private.jsonl');
  const scannedPeriod = {
    id: 'last90Days',
    label: 'Last 90 Days',
    startsAt: '2026-06-19T00:00:00.000Z',
    endsAt: '2026-09-17T00:00:00.000Z',
    usageSchema: 'taku.creator.ai-burn-usage.v3',
    totalInputTokens: 200,
    totalOutputTokens: 100,
    totalCacheReadTokens: 40,
    totalCacheCreationTokens: 20,
    totalReasoningTokens: 10,
    totalTokens: 310,
    sessionCount: 3,
    eventCount: 8,
    privatePath,
    modelUsage: {
      totalTokens: 310,
      models: [
        {
          modelId: 'gpt-5',
          inputTokens: 200,
          outputTokens: 100,
          cacheReadTokens: 40,
          cacheCreationTokens: 20,
          reasoningTokens: 10,
          totalTokens: 310,
        },
      ],
    },
    sources: [
      {
        source: 'codex',
        label: 'Codex',
        totalInputTokens: 200,
        totalOutputTokens: 100,
        totalCacheReadTokens: 40,
        totalCacheCreationTokens: 20,
        totalReasoningTokens: 10,
        totalTokens: 310,
        sessionCount: 3,
        privatePath,
        modelUsage: {
          totalTokens: 310,
          models: [
            {
              modelId: 'gpt-5',
              inputTokens: 200,
              outputTokens: 100,
              cacheReadTokens: 40,
              cacheCreationTokens: 20,
              reasoningTokens: 10,
              totalTokens: 310,
            },
          ],
        },
        estimatedCost: { totalUsd: 0.004 },
      },
    ],
  };
  const draft = {
    sections: [],
    stats: {
      usage: selectUsageForDraft({
        scanned: true,
        periodLabel: 'Last 90 Days',
        primaryPeriodId: 'last90Days',
        totalTokens: 310,
        sessionCount: 3,
        eventCount: 8,
        periods: [scannedPeriod],
        sources: scannedPeriod.sources,
      }),
    },
  };

  const snapshot = buildBuilderProfileSnapshot(draft);
  const normalizedPeriod = snapshot.usage.periods[0];
  const normalizedSource = normalizedPeriod.sources[0];
  assert.equal(normalizedPeriod.usageSchema, 'taku.creator.ai-burn-usage.v3');
  assert.equal(normalizedPeriod.totalInputTokens, 200);
  assert.equal(normalizedPeriod.totalOutputTokens, 100);
  assert.equal(normalizedPeriod.totalCacheReadTokens, 40);
  assert.equal(normalizedPeriod.totalCacheCreationTokens, 20);
  assert.equal(normalizedPeriod.totalReasoningTokens, 10);
  assert.equal(normalizedPeriod.modelUsage.models[0].modelId, 'gpt-5');
  assert.equal(normalizedSource.totalInputTokens, 200);
  assert.equal(normalizedSource.totalOutputTokens, 100);
  assert.equal(normalizedSource.totalCacheReadTokens, 40);
  assert.equal(normalizedSource.totalCacheCreationTokens, 20);
  assert.equal(normalizedSource.totalReasoningTokens, 10);
  assert.equal(normalizedSource.modelUsage.models[0].modelId, 'gpt-5');

  const payload = await createStaxCreatorPublishPayload({
    ...draft,
    builderProfileSnapshot: snapshot,
  }, { items: [] }, {
    getCardSettings: () => ({
      name: 'Test creator',
      showPersonaCode: true,
      showUsage: true,
      showCreatorPageLink: true,
      visibility: 'public',
    }),
  });
  const publishedPeriod = payload.profileSnapshot.usage.periods[0];
  assert.equal(publishedPeriod.usageSchema, 'taku.creator.ai-burn-usage.v3');
  assert.deepEqual(publishedPeriod.sources[0].modelUsage.models[0], {
    modelId: 'gpt-5',
    inputTokens: 200,
    outputTokens: 100,
    cacheReadTokens: 40,
    cacheCreationTokens: 20,
    reasoningTokens: 10,
    totalTokens: 310,
  });
  assert.equal(JSON.stringify(payload).includes(privatePath), false);
});

test('keeps more than four models for the AI Burn period', () => {
  const models = Array.from({ length: 6 }, (_, index) => ({
    modelId: `model-${index + 1}`,
    inputTokens: 10 - index,
    totalTokens: 10 - index,
  }));
  const totalTokens = models.reduce((sum, model) => sum + model.totalTokens, 0);
  const snapshot = buildBuilderProfileSnapshot({
    stats: {
      usage: {
        periods: [
          {
            id: 'last90Days',
            usageSchema: 'taku.creator.ai-burn-usage.v3',
            totalTokens,
            sources: [
              {
                source: 'codex',
                totalTokens,
                modelUsage: { totalTokens, topModels: models.slice(0, 4), models },
              },
            ],
          },
        ],
      },
    },
  });

  assert.equal(snapshot.usage.periods[0].sources[0].modelUsage.models.length, 6);
});
