import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TAKU_CREATOR_CORE_API_VERSION,
  TAKU_PASSPORT_CORE_API_VERSION,
  buildAiSetupSnapshot,
  containsPrivateOrSecretText,
  sanitizePublishJson,
} from '../src/index.mjs';

test('creator core remains a compatibility alias for passport core', () => {
  assert.equal(TAKU_CREATOR_CORE_API_VERSION, 'taku.creator-core.v1');
  assert.equal(TAKU_PASSPORT_CORE_API_VERSION, 'taku.passport-core.v1');
  assert.equal(typeof buildAiSetupSnapshot, 'function');
  assert.equal(typeof sanitizePublishJson, 'function');
});

test('creator core builds a private local capability setup snapshot', () => {
  const snapshot = buildAiSetupSnapshot({
    generatedAt: '2026-07-21T00:00:00.000Z',
    usedTools: [
      { id: 'skill-1', type: 'skill', source: 'codex', name: 'Review', description: 'Review code.' },
      { id: 'agent-1', type: 'subagent', source: 'codex-subagent', name: 'Reviewer', description: 'Read only.' },
      { id: 'mcp-1', type: 'mcp-server', source: 'cursor-mcp', name: 'context7' },
    ],
    badges: [],
  }, {
    items: [
      { id: 'skill-1', localPath: '/tmp/skills/review/SKILL.md' },
      { id: 'agent-1', localPath: '/tmp/agents/reviewer.toml' },
      { id: 'mcp-1', localPath: '/tmp/cursor/mcp.json' },
    ],
  });

  assert.equal(snapshot.schemaVersion, 'taku.capability-snapshot.v1');
  assert.equal(snapshot.summary.skillCount, 1);
  assert.equal(snapshot.summary.agentCount, 1);
  assert.equal(snapshot.summary.mcpCount, 1);
  assert.equal(snapshot.items.find((item) => item.id === 'agent-1').sourceFormat, 'codex-toml');
  assert.equal(snapshot.items.find((item) => item.id === 'mcp-1').policy.publish.eligibility, 'blocked');
  assert.equal(snapshot.privacy.uploads, false);
});

test('creator core public privacy facade removes private fields', () => {
  const sanitized = sanitizePublishJson({
    name: 'Demo Skill',
    localPath: 'private-workspace/.codex/skills/demo',
    description: 'A safe description.',
  });

  assert.deepEqual(sanitized, {
    name: 'Demo Skill',
    description: 'A safe description.',
  });
  assert.equal(containsPrivateOrSecretText('token=secret-value'), true);
});
