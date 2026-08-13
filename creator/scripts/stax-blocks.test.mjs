import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStaxBlocks,
  STAX_BLOCK_KEYS,
  STAX_BLOCKS_SCHEMA,
} from './stax-blocks.mjs';

function fixtureDraft() {
  return {
    creator: { username: 'ldx' },
    personaV2: {
      code: 'AILW',
      archetype: {
        title: 'Daemon Daddy',
        subtitle: '守护进程老爹',
        signature: '我的脚本，我的儿女',
      },
      traits: [
        { label: 'Token Tycoon' },
        { label: 'Flow State' },
      ],
      axes: [{ id: 'agency', label: 'Agency', letter: 'A', score: 0.8 }],
      influences: [{ axisId: 'agency', letter: 'A', impact: 'Plans before shipping.' }],
    },
    sections: [
      {
        id: 'creator-tools',
        items: [
          { id: 'tool-1', name: 'youtube-to-ebook', type: 'skill', source: 'local-upload' },
          { id: 'tool-2', name: 'draft-sync', type: 'agent', source: 'codex' },
          { id: 'tool-3', name: 'release-checker', type: 'skill', source: 'claude-code' },
        ],
      },
    ],
    staxProfile: {
      handle: 'ldx',
      serialNumber: 'TAKU-000417',
      serial: { display: 'No. 000417' },
      daysOnTaku: 12,
      platform: { publishedItemCount: 7 },
      rank: { rankGrade: { topPercent: 0.04 } },
      blocks: {
        basic: { supported: true, basicVal: '12', source: 'server.profile' },
        seal: { supported: true, label: 'No. 000417', source: 'server.profile' },
        dial: {
          supported: true,
          source: 'server.builder_score',
          score: 73,
          maxScore: 100,
          version: 'builder-score.v1',
        },
        vsavg: {
          supported: true,
          source: 'server.community.token_snapshot',
          metric: 'tokens',
          baseline: 'median',
          creatorTokens: 3460000,
          communityMedian: 1000000,
          deltaPercent: 246,
          display: '+246%',
          periodLabel: 'This Month',
        },
      },
    },
    stats: {
      usage: {
        sources: [{ source: 'codex', label: 'Codex' }],
        totalTokens: 2574342,
        periods: [
          { id: 'thisMonth', label: 'This Month', totalTokens: 2574342 },
          { id: 'allTimeLocal', label: 'All-Time Local', totalTokens: 12400000 },
        ],
        eventCount: 21077,
        estimatedCost: { totalUsd: 2147.63 },
        behaviorProfile: {
          userTurnCount: 137,
        },
        modelUsage: {
          totalTokens: 2574342,
          totalInputTokens: 1600000,
          totalOutputTokens: 974342,
          topModels: [
            { modelId: 'gpt-5', name: 'GPT-5', share: 0.7, percentage: '70%' },
            { modelId: 'claude-sonnet', name: 'Claude Sonnet', share: 0.3, percentage: '30%' },
          ],
        },
        localActivity: {
          activeDayCount: 12,
          buildSessionCount: 42,
          toolCallCount: 210,
          dailyHeatmap: [
            { date: '2026-07-21', buildSessionCount: 1, eventCount: 6, toolCallCount: 5, tokenCount: 1200 },
            { date: '2026-07-22', buildSessionCount: 2, eventCount: 8, toolCallCount: 7, tokenCount: 1800 },
          ],
          sessionSplit: {
            sessionCount: 60,
            buildSessionCount: 42,
            chatSessionCount: 18,
            buildShare: 0.7,
            chatShare: 0.3,
          },
          buildStreak: { currentDays: 4, bestDays: 9 },
          trend30d: {
            buckets: [
              { id: 'w1', label: '7/1-7/6', buildSessionCount: 3, activeDayCount: 2, tokenCount: 3000 },
              { id: 'w2', label: '7/7-7/12', buildSessionCount: 8, activeDayCount: 4, tokenCount: 7000 },
            ],
          },
          delta30d: { current: 42, previous: 21, delta: 1, display: '+100%' },
          workPattern: { peakHour: 22, hourBuckets: Array.from({ length: 24 }, (_, hour) => (hour === 22 ? 9 : 0)) },
        },
      },
    },
  };
}

function blockByKey(result, key) {
  return result.blocks.find((block) => block.key === key);
}

test('maps publisher profile data into the full Stax block contract', () => {
  const result = buildStaxBlocks(fixtureDraft());

  assert.equal(result.schemaVersion, STAX_BLOCKS_SCHEMA);
  assert.equal(result.blocks.length, STAX_BLOCK_KEYS.length);
  assert.deepEqual(result.blocks.map((block) => block.key), STAX_BLOCK_KEYS);
  assert.equal(blockByKey(result, 'hero').status, 'supported');
  assert.equal(blockByKey(result, 'basic').source, 'server.profile');
  assert.equal(blockByKey(result, 'heat').status, 'partial');
  assert.equal(blockByKey(result, 'heat').quality.label, '部分样本');
  assert.deepEqual(blockByKey(result, 'heat').value.days, [
    { date: '2026-07-21', observed: true, builds: 1 },
    { date: '2026-07-22', observed: true, builds: 2 },
  ]);
  assert.equal(blockByKey(result, 'heat').value.observedDayCount, 2);
  assert.equal(blockByKey(result, 'heat').value.currentStreak, 4);
  assert.deepEqual(blockByKey(result, 'heat').value.coverage, {
    startsOn: '2026-07-21',
    endsOn: '2026-07-22',
    observedDayCount: 2,
    complete90Days: false,
  });
  assert.equal(blockByKey(result, 'clock').value.peakH, 22);
  assert.equal(blockByKey(result, 'clock').value.peakLabel, 'PEAK 22:00');
  assert.equal(blockByKey(result, 'clock').value.bird, 'OWL');
  assert.equal(blockByKey(result, 'clock').value.hourBuckets.length, 24);
  assert.equal(blockByKey(result, 'clock').value.hourBuckets[22], 9);
  assert.equal(blockByKey(result, 'ctxring').status, 'partial');
  assert.equal(blockByKey(result, 'ctxring').source, 'publisher.local_usage');
  assert.equal(blockByKey(result, 'ctxring').value.display, '76');
  assert.equal(blockByKey(result, 'ctxring').value.avgInputTokens, 76);
  assert.equal(blockByKey(result, 'ctxring').value.requestCount, 21077);
  assert.equal(blockByKey(result, 'ctxring').value.estimate, false);
  assert.notEqual(blockByKey(result, 'ctxring').estimated, true);
  assert.equal(blockByKey(result, 'ctxring').quality.label, '本地日志');
  assert.equal(blockByKey(result, 'trend').status, 'partial');
  assert.equal(blockByKey(result, 'trend').source, 'publisher.local_activity');
  assert.equal(blockByKey(result, 'trend').value.display, '+167%');
  assert.equal(blockByKey(result, 'trend').value.currentBuilds, 8);
  assert.equal(blockByKey(result, 'trend').value.previousBuilds, 3);
  assert.equal(blockByKey(result, 'trend').value.comparison, '8 VS 3');
  assert.equal(blockByKey(result, 'trend').quality.label, '本地日志');
  assert.equal(blockByKey(result, 'dots').status, 'partial');
  assert.equal(blockByKey(result, 'dots').source, 'publisher.local_activity.tool_calls');
  assert.notEqual(blockByKey(result, 'dots').estimated, true);
  assert.equal(blockByKey(result, 'dots').quality.label, '本地日志');
  assert.equal(blockByKey(result, 'dots').value.toolCallCount, 210);
  assert.equal(blockByKey(result, 'dots').value.display, '210');
  assert.equal(blockByKey(result, 'dots').value.periodLabel, 'This Month');
  assert.deepEqual(blockByKey(result, 'dots').value.dailyToolCalls, [
    { date: '2026-07-21', count: 5 },
    { date: '2026-07-22', count: 7 },
  ]);
  assert.equal(blockByKey(result, 'bracket').value.label, 'EST. SPEND');
  assert.equal(blockByKey(result, 'bracket').value.periodId, 'thisMonth');
  assert.equal(blockByKey(result, 'bracket').value.periodLabel, 'This Month');
  assert.equal(blockByKey(result, 'bracket').estimated, true);
  assert.equal(blockByKey(result, 'bracket').quality.label, '估算');
  assert.equal(blockByKey(result, 'pie').quality.label, '本地日志');
  assert.equal(blockByKey(result, 'rings').quality.label, '本地推导 + Taku');
  assert.equal(blockByKey(result, 'rings').estimated, true);
  assert.equal(blockByKey(result, 'rings').value.metrics[0].count, 137);
  assert.equal(blockByKey(result, 'rings').value.metrics[0].periodLabel, 'This Month');
  assert.equal(blockByKey(result, 'rings').value.metrics[1].count, 42);
  assert.equal(blockByKey(result, 'rings').value.metrics[2].count, 7);
  assert.equal(blockByKey(result, 'rings').value.metrics[2].periodLabel, 'All Time');
  assert.equal(blockByKey(result, 'rings').value.metrics[2].verified, true);
  assert.equal(blockByKey(result, 'rings').value.rings, undefined);
  assert.equal(blockByKey(result, 'tally').status, 'supported');
  assert.equal(blockByKey(result, 'tally').source, 'server.creator_stats');
  assert.equal(blockByKey(result, 'tally').value.shipped, 7);
  assert.equal(blockByKey(result, 'dial').status, 'supported');
  assert.equal(blockByKey(result, 'dial').source, 'server.builder_score');
  assert.equal(blockByKey(result, 'dial').value.score, 73);
  assert.equal(blockByKey(result, 'vsavg').status, 'supported');
  assert.equal(blockByKey(result, 'vsavg').source, 'server.community.token_snapshot');
  assert.equal(blockByKey(result, 'vsavg').value.communityMedian, 1000000);
  assert.equal(blockByKey(result, 'vsavg').value.display, '+246%');
  assert.equal(blockByKey(result, 'tools').status, 'partial');
  assert.equal(blockByKey(result, 'tools').quality.label, '待用户选择');
  assert.equal(blockByKey(result, 'node').status, 'partial');
  assert.equal(blockByKey(result, 'node').source, 'publisher.inventory');
  assert.equal(blockByKey(result, 'node').quality.label, '本地扫描');
  assert.equal(blockByKey(result, 'node').value.totalCount, 3);
  assert.deepEqual(blockByKey(result, 'node').value.categories, [
    { id: 'skill', label: 'SKILLS', count: 2 },
    { id: 'agent', label: 'AGENTS', count: 1 },
  ]);
  assert.equal(blockByKey(result, 'node').value.otherCount, 0);
  assert.equal(blockByKey(result, 'splitring').status, 'partial');
  assert.equal(blockByKey(result, 'splitring').estimated, true);
  assert.equal(blockByKey(result, 'splitring').value.sessionCount, 60);
  assert.equal(blockByKey(result, 'splitring').value.chatSessionCount, 18);
  assert.equal(blockByKey(result, 'splitring').value.buildSessionCount, 42);
  assert.equal(blockByKey(result, 'splitring').value.periodId, 'thisMonth');
  assert.equal(blockByKey(result, 'splitring').value.periodLabel, 'This Month');
  assert.equal(blockByKey(result, 'wave').status, 'partial');
  assert.deepEqual(blockByKey(result, 'wave').value.waves, [
    {
      id: 'w1',
      label: '7/1-7/6',
      buildSessionCount: 3,
      activeDayCount: 2,
      tokenCount: 3000,
    },
    {
      id: 'w2',
      label: '7/7-7/12',
      buildSessionCount: 8,
      activeDayCount: 4,
      tokenCount: 7000,
    },
  ]);
  assert.equal(blockByKey(result, 'wave').value.totalBuildSessions, 11);
  assert.equal(blockByKey(result, 'wave').value.observedDayCount, 6);
  assert.equal('sprints' in blockByKey(result, 'wave').value, false);
  assert.deepEqual(blockByKey(result, 'peaks').value, {
    bestDay: '1.8K',
    date: '2026-07-22',
    metric: 'tokens',
    observedDayCount: 2,
    peakShape: [1200, 1800],
    peakDates: ['2026-07-21', '2026-07-22'],
  });
  assert.deepEqual(blockByKey(result, 'ratio').value, {
    tokensIn: '1.6M',
    tokensOut: '974.3K',
    tokensInValue: 1600000,
    tokensOutValue: 974342,
    inShare: 0.622,
    periodId: 'thisMonth',
    periodLabel: 'This Month',
  });
  assert.deepEqual(blockByKey(result, 'bars90').value.tokens90d, [
    0.667,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  assert.deepEqual(blockByKey(result, 'bars90').value.visualBuckets, [
    0.3,
    0.45,
    0.4,
    0.6,
    0.5,
    0.75,
    0.62,
    0.85,
    0.7,
    0.95,
    0.8,
    1,
  ]);
  assert.equal(blockByKey(result, 'bars90').value.observedBucketCount, 2);
  assert.equal(blockByKey(result, 'bars90').value.isPartialSample, true);
  assert.deepEqual(blockByKey(result, 'stadium').value, {
    tokensAllTime: '12.4M',
    tokensTotal: '12.4M',
    allTimeTokens: 12400000,
    totalTokens: 12400000,
    periodId: 'allTimeLocal',
    periodLabel: 'All Time',
  });
});

test('labels bounded usage as an observed sample instead of a complete total', () => {
  const draft = fixtureDraft();
  draft.stats.usage.periodId = 'last90Days';
  draft.stats.usage.label = 'Last 90 Days';
  draft.stats.usage.partial = true;
  draft.stats.usage.scanCoverage = { partial: true, stoppedReason: 'files' };
  draft.stats.usage.sources = [
    { source: 'claude-code', label: 'Claude', totalTokens: 935618, sessionCount: 6 },
    { source: 'codex', label: 'Codex', totalTokens: 13002594454, sessionCount: 1039 },
  ];

  const result = buildStaxBlocks(draft);
  const bars = blockByKey(result, 'bars90');
  const stadium = blockByKey(result, 'stadium');

  assert.equal(bars.status, 'partial');
  assert.equal(bars.value.periodLabel, 'Observed Sample');
  assert.equal(stadium.source, 'publisher.local_usage.sample');
  assert.equal(stadium.value.periodId, 'last90Days');
  assert.equal(stadium.value.periodLabel, 'Observed Sample');
  assert.equal(stadium.value.totalTokens, draft.stats.usage.totalTokens);
  assert.equal(blockByKey(result, 'team').value.team[0], 'CODEX');
});

test('keeps community rank and provider quota dimensions unsupported until trusted inputs exist', () => {
  const draft = fixtureDraft();
  delete draft.staxProfile.rank;
  const result = buildStaxBlocks(draft);
  const unsupported = result.blocks
    .filter((block) => block.status === 'unsupported')
    .map((block) => block.key);

  assert.deepEqual(unsupported, ['tier1', 'aura', 'cgauge', 'water', 'tier4']);
  assert.equal(result.summary.unsupported, 5);
  assert.equal(blockByKey(result, 'tier1').lockLabel, 'GROW ON TAKU');
  assert.match(blockByKey(result, 'tier1').reason, /Publish a tool or gain subscribers/);
  assert.match(blockByKey(result, 'cgauge').reason, /monthly quota/);
  assert.equal(blockByKey(result, 'vsavg').source, 'server.community.token_snapshot');
  assert.equal(blockByKey(result, 'dial').value.version, 'builder-score.v1');
});

test('uses trusted Worker quota data for the monthly quota gauge', () => {
  const draft = fixtureDraft();
  draft.staxProfile.blocks.cgauge = {
    supported: true,
    source: 'server.billing_quota',
    usedCredits: 720,
    totalCredits: 1000,
    resetAt: '2026-08-01',
    periodId: '2026-08',
  };

  const result = buildStaxBlocks(draft);
  const block = blockByKey(result, 'cgauge');

  assert.equal(block.status, 'supported');
  assert.equal(block.source, 'server.billing_quota');
  assert.deepEqual(block.value, {
    usedPercent: 72,
    usedCredits: 720,
    totalCredits: 1000,
    resetAt: '2026-08-01',
    periodId: '2026-08',
  });
});

test('keeps trusted cohort progress on a locked server rank block', () => {
  const draft = fixtureDraft();
  draft.staxProfile.blocks.water = {
    supported: false,
    source: 'server',
    topPercent: 0.0189,
    metric: 'installs',
    cohortSize: 53,
    minimumCohortSize: 100,
    environment: 'staging',
    publicRankReady: false,
    testOnly: true,
    lockLabel: 'RANK SOON',
    reason: 'Test ranking is calibrating. Check back soon.',
  };

  const water = blockByKey(buildStaxBlocks(draft), 'water');

  assert.equal(water.status, 'unsupported');
  assert.equal(water.lockLabel, 'RANK SOON');
  assert.equal(water.value.cohortSize, 53);
  assert.equal(water.value.minimumCohortSize, 100);
  assert.equal(water.value.environment, 'staging');
});

test('does not substitute legacy skillCount for a verified published item count', () => {
  const draft = fixtureDraft();
  delete draft.staxProfile.platform.publishedItemCount;
  draft.staxProfile.platform.skillCount = 99;

  const ships = blockByKey(buildStaxBlocks(draft), 'rings').value.metrics[2];

  assert.equal(ships.count, null);
  assert.equal(ships.display, '—');
  assert.equal(ships.available, false);
  assert.equal(ships.verified, false);
});

test('keeps the shipped Stax tally locked without a trusted Taku count', () => {
  const draft = fixtureDraft();
  delete draft.staxProfile.platform.publishedItemCount;
  draft.sections.push({
    id: 'made-items',
    items: [{ id: 'local-draft', name: 'Local draft', type: 'stax' }],
  });

  const tally = blockByKey(buildStaxBlocks(draft), 'tally');

  assert.equal(tally.status, 'unsupported');
  assert.equal(tally.source, 'unavailable');
  assert.match(tally.reason, /not available from Taku/);
});
