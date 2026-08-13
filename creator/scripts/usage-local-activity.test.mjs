import assert from 'node:assert/strict';
import test from 'node:test';

import {
  longestContinuousActiveMinutes,
  summarizeLocalActivity,
} from './usage.mjs';

function usageRecord({
  id,
  startedAt,
  lastActivityAt,
  timestamps = [startedAt, lastActivityAt].filter(Boolean),
  eventCount = timestamps.length || 1,
  toolCallCount = 0,
  totalTokens = 0,
}) {
  return {
    source: 'codex',
    label: 'Codex',
    sourceFileId: `${id}.jsonl`,
    file: {
      sessionId: id,
      startedAt,
      lastActivityAt,
      activityTimestamps: timestamps,
      eventCount,
      toolCallCount,
      buildSignal: toolCallCount > 0,
      totals: { totalTokens },
    },
  };
}

test('summarizes local activity from local usage records', () => {
  const now = new Date('2026-07-30T12:00:00.000Z');
  const period = {
    id: 'last30Days',
    label: 'Last 30 Days',
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: now.toISOString(),
  };
  const summary = summarizeLocalActivity(
    [
      usageRecord({
        id: 'build-today',
        startedAt: '2026-07-30T09:00:00.000Z',
        lastActivityAt: '2026-07-30T09:45:00.000Z',
        toolCallCount: 4,
        totalTokens: 1200,
      }),
      usageRecord({
        id: 'chat-yesterday',
        startedAt: '2026-07-29T10:00:00.000Z',
        lastActivityAt: '2026-07-29T10:10:00.000Z',
        toolCallCount: 0,
        totalTokens: 500,
      }),
      usageRecord({
        id: 'build-yesterday',
        startedAt: '2026-07-29T14:00:00.000Z',
        lastActivityAt: '2026-07-29T15:00:00.000Z',
        toolCallCount: 2,
        totalTokens: 800,
      }),
      usageRecord({
        id: 'previous-window-build',
        startedAt: '2026-06-20T14:00:00.000Z',
        lastActivityAt: '2026-06-20T14:20:00.000Z',
        toolCallCount: 1,
        totalTokens: 300,
      }),
    ],
    period,
    now,
  );

  assert.equal(summary.activeDayCount, 2);
  assert.equal(summary.buildDayCount, 2);
  assert.equal(summary.buildSessionCount, 2);
  assert.equal(summary.chatSessionCount, 1);
  assert.equal(summary.sessionSplit.sessionCount, 3);
  assert.equal(summary.sessionSplit.buildSessionCount, 2);
  assert.equal(summary.sessionSplit.chatSessionCount, 1);
  assert.equal(summary.sessionSplit.buildShare, 0.667);
  assert.equal(summary.buildStreak.currentDays, 2);
  assert.equal(summary.buildStreak.bestDays, 2);
  assert.deepEqual(
    summary.dailyHeatmap.map((row) => ({
      date: row.date,
      sessionCount: row.sessionCount,
      buildSessionCount: row.buildSessionCount,
      toolCallCount: row.toolCallCount,
    })),
    [
      { date: '2026-07-29', sessionCount: 2, buildSessionCount: 1, toolCallCount: 2 },
      { date: '2026-07-30', sessionCount: 1, buildSessionCount: 1, toolCallCount: 4 },
    ],
  );
  assert.equal(summary.trend30d.buckets.length, 5);
  assert.equal(
    summary.trend30d.buckets.reduce((sum, bucket) => sum + bucket.buildSessionCount, 0),
    2,
  );
  assert.equal(summary.delta30d.current, 2);
  assert.equal(summary.delta30d.previous, 1);
  assert.equal(summary.delta30d.delta, 1);
  assert.equal(summary.delta30d.display, '+100%');
  assert.equal(Number.isInteger(summary.workPattern.peakHour), true);
  assert.equal(summary.workPattern.activeHourCount >= 3, true);
});

test('uses only the longest continuous active span across idle breaks', () => {
  const longest = longestContinuousActiveMinutes([
    '2026-07-30T09:00:00.000Z',
    '2026-07-30T09:10:00.000Z',
    '2026-07-30T09:25:00.000Z',
    '2026-07-30T11:00:00.000Z',
    '2026-07-30T11:20:00.000Z',
    '2026-07-30T11:40:00.000Z',
    '2026-07-30T12:05:00.000Z',
  ]);

  assert.equal(longest, 65);
});
