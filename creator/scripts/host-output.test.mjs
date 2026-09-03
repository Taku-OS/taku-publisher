import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';

import {
  compactScanCommandResult,
  createCloudStudioCommandResult,
  createEditorCommandResult,
} from './host-output.mjs';

test('compact scan output removes paths and scan previews from host context', () => {
  const privatePath = path.join(
    path.sep,
    'Users',
    'example',
    '.codex',
    'skills',
    'review',
    'SKILL.md',
  );
  const result = compactScanCommandResult({
    generatedAt: '2026-07-23T00:00:00.000Z',
    privacy: { promptContentRead: false },
    usedTools: [
      {
        id: 'skill-1',
        type: 'skill',
        source: 'codex',
        name: 'Review',
        description: 'Review code.',
        localPath: privatePath,
        scanPreview: { snippet: 'private source content' },
      },
    ],
    creationCandidates: [],
    usage: {
      primaryPeriodId: 'today',
      periodLabel: 'Today',
      scannedFileCount: 10,
      sessionCount: 2,
      eventCount: 5,
      totalTokens: 100,
      localActivity: {
        activeDayCount: 2,
        buildDayCount: 1,
        buildSessionCount: 1,
        chatSessionCount: 1,
        dailyHeatmap: [
          {
            date: '2026-07-22',
            active: true,
            sessionCount: 2,
            buildSessionCount: 1,
            eventCount: 5,
            toolCallCount: 3,
            tokenCount: 100,
            buildIntensity: 2,
            privatePath,
          },
        ],
        sessionSplit: {
          sessionCount: 2,
          buildSessionCount: 1,
          chatSessionCount: 1,
          buildShare: 0.5,
          chatShare: 0.5,
        },
        buildStreak: { currentDays: 1, bestDays: 1 },
        trend30d: {
          buckets: [
            {
              id: 'w1',
              label: '7/1-7/6',
              buildSessionCount: 1,
              privatePath,
            },
          ],
        },
        delta30d: { current: 1, previous: 0, delta: null, display: 'NEW' },
        workPattern: { peakHour: 10, activeHourCount: 2, businessHoursShare: 1 },
      },
    },
    personaV2: {
      code: 'ROOKIE',
      archetype: { title: 'The Rookie', description: 'Getting started.' },
      confidence: 0.55,
    },
    summary: { usedToolCount: 1, personaCode: 'ROOKIE' },
  });
  const serialized = JSON.stringify(result);

  assert.equal(result.usedTools[0].name, 'Review');
  assert.equal(result.persona.title, 'The Rookie');
  assert.equal(result.usage.localActivity.buildSessionCount, 1);
  assert.equal(result.usage.localActivity.dailyHeatmap[0].date, '2026-07-22');
  assert.equal(result.usage.localActivity.sessionSplit.buildShare, 0.5);
  assert.equal(serialized.includes(privatePath), false);
  assert.equal(serialized.includes('scanPreview'), false);
  assert.equal(serialized.includes('private source content'), false);
});

test('editor host result returns only the actionable URL and compact summary', () => {
  const privatePath = path.join(path.sep, 'Users', 'example', 'private');
  const editorUrl = `http:${'//'}${['127', '0', '0', '1'].join('.')}:7331/?token=local-editor-token`;
  const result = createEditorCommandResult(
    {
      stats: {
        usedToolCount: 126,
        displayedToolCount: 8,
        usage: { private: 'large nested payload' },
      },
      personaV2: {
        code: 'ROOKIE',
        archetype: { title: 'The Rookie' },
        confidence: 0.55,
      },
      sections: [
        {
          items: [
            {
              localPath: privatePath,
              scanPreview: { snippet: 'private source content' },
            },
          ],
        },
      ],
    },
    editorUrl,
  );
  const serialized = JSON.stringify(result);

  assert.equal(result.primaryAction, 'open_editor');
  assert.equal(result.persona.code, 'ROOKIE');
  assert.equal(result.summary.usedToolCount, 126);
  assert.equal(serialized.includes(privatePath), false);
  assert.equal(serialized.includes('scanPreview'), false);
  assert.equal(serialized.includes('large nested payload'), false);
});

test('cloud Studio host result returns the durable Studio URL', () => {
  const studioUrl = 'https://taku.ai/studio/stax-card';
  const result = createCloudStudioCommandResult(
    {
      personaV2: { code: 'EILW', archetype: { title: 'Mad Inventor' } },
      stats: { displayedToolCount: 3 },
    },
    studioUrl,
    {
      workerUrl: 'https://worker.taku.ai',
      accountHint: 'ow***@example.com',
    },
  );

  assert.equal(result.editorUrl, studioUrl);
  assert.equal(result.primaryUrl, studioUrl);
  assert.equal(result.primaryAction, 'open_cloud_studio');
  assert.equal(result.cloudDraft, true);
  assert.equal(result.workerUrl, 'https://worker.taku.ai');
  assert.equal(result.savedToAccount, 'ow***@example.com');
  assert.equal('switchAccount' in result, false);
  assert.match(result.message, /ow\*\*\*@example\.com/);
});
