import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBuilderProfileSnapshot } from './draft.mjs';

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
