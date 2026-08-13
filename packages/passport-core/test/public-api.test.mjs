import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  TAKU_PASSPORT_CORE_API_VERSION,
  applyPersonaOverrides,
  buildPersonaProfileV1,
  buildPassportSnapshot,
  buildPersonaIdentity,
  buildPersonaV2,
  composePersonaSignals,
  composeUsageSummary,
  containsPrivateOrSecretText,
  createPrivateInventory,
  dedupeItems,
  publicItem,
  sanitizePublishJson,
} from '../dist/index.js';
import {
  PERSONA_CODES as PUBLIC_PERSONA_CODES,
  buildPersonaProfileV1 as buildPublicPersonaProfileV1,
} from '../dist/persona-public.js';

test('passport core exposes a versioned host-independent API', () => {
  assert.equal(TAKU_PASSPORT_CORE_API_VERSION, 'taku.passport-core.v1');
  assert.equal(typeof buildPassportSnapshot, 'function');
  assert.equal(typeof sanitizePublishJson, 'function');
  assert.equal(typeof createPrivateInventory, 'function');
  assert.equal(typeof composePersonaSignals, 'function');
  assert.equal(typeof buildPersonaV2, 'function');
});

test('passport core exposes a browser-safe Persona-only entrypoint', () => {
  assert.equal(PUBLIC_PERSONA_CODES.length, 16);
  assert.equal(
    buildPublicPersonaProfileV1({ code: 'AMLW' }, { locale: 'en-US' })
      .family.id,
    'craftsman',
  );
});

test('passport core composes the canonical private capability snapshot', () => {
  const snapshot = buildPassportSnapshot({
    generatedAt: '2026-07-21T00:00:00.000Z',
    usedTools: [
      {
        id: 'skill-1',
        type: 'skill',
        source: 'codex',
        name: 'Review',
        description: 'Review code.',
      },
      {
        id: 'agent-1',
        type: 'subagent',
        source: 'codex-subagent',
        name: 'Reviewer',
        description: 'Read only.',
      },
      {
        id: 'mcp-1',
        type: 'mcp-server',
        source: 'cursor-mcp',
        name: 'context7',
      },
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
  assert.equal(
    snapshot.items.find((item) => item.id === 'agent-1').sourceFormat,
    'codex-toml',
  );
  assert.equal(
    snapshot.items.find((item) => item.id === 'mcp-1').policy.publish
      .eligibility,
    'blocked',
  );
  assert.equal(snapshot.privacy.uploads, false);
});

test('passport core keeps locators private and public projection stable', () => {
  const inventory = createPrivateInventory([
    {
      id: 'skill-1',
      type: 'skill',
      source: 'codex',
      name: 'Review',
      localPath: '/tmp/skills/review/SKILL.md',
      ownership: 'owned',
      ownershipConfidence: 0.95,
    },
  ], {
    generatedAt: '2026-07-21T00:00:00.000Z',
  });
  const visible = publicItem({
    ...inventory.items[0],
    description: 'Review code.',
  }, 'used');

  assert.equal(inventory.items[0].localPath, '/tmp/skills/review/SKILL.md');
  assert.equal('localPath' in visible, false);
  assert.equal(visible.publishable, true);
});

test('passport core privacy filtering and dedupe remain deterministic', () => {
  const first = { id: 'first', type: 'skill', name: 'Review' };
  const second = { id: 'second', type: 'SKILL', name: 'review' };
  assert.deepEqual(dedupeItems([first, second]), [first]);

  assert.deepEqual(sanitizePublishJson({
    name: 'Demo Skill',
    localPath: 'private-workspace/.codex/skills/demo',
    description: 'A safe description.',
  }), {
    name: 'Demo Skill',
    description: 'A safe description.',
  });
  assert.equal(containsPrivateOrSecretText('token=secret-value'), true);
});

test('passport core applies persona identity overrides deterministically', () => {
  const persona = {
    code: 'AMLH',
    tone: 'brainrot',
    availableTones: [{ id: 'brainrot', label: 'Brainrot' }],
    archetype: {
      title: 'UI Maxxer',
      subtitle: '界面狂魔',
    },
    autoTraits: [{
      id: 'polisher',
      label: 'Polisher',
      category: 'Output Style',
      evidence: 'UI-heavy file share',
      confidence: 0.6,
    }],
    traits: [{
      id: 'polisher',
      label: 'Polisher',
      category: 'Output Style',
      evidence: 'UI-heavy file share',
      confidence: 0.6,
    }],
    manualTraitCatalog: [{
      id: 'beta-tester',
      label: 'Beta Tester',
      category: 'Personality',
      description: 'Confirmed beta participant.',
    }],
    hiddenCandidates: [{
      id: 'architect',
      title: 'The Architect',
      confidence: 0.95,
    }],
  };
  const updated = applyPersonaOverrides(persona, {
    lockedCode: 'AMLH',
    hiddenTraitIds: ['polisher'],
    addedTraitIds: ['beta-tester'],
    selectedHiddenId: 'architect',
  });
  const identity = buildPersonaIdentity(updated);

  assert.equal(updated.locked, true);
  assert.equal(updated.traits.length, 1);
  assert.equal(updated.traits[0].id, 'beta-tester');
  assert.equal(identity.basePersona.signature, '像素级抛光，绝不容忍 aliasing');
  assert.equal(identity.hidden.featured.id, 'architect');
  assert.equal(identity.hidden.featuredSource, 'selected');
});

test('passport core composes and scores Persona records from collected host inputs', () => {
  const generatedAt = '2026-07-24T00:00:00.000Z';
  const signals = composePersonaSignals({
    generatedAt,
    usage: {
      primaryPeriodId: 'thisMonth',
      periodLabel: 'This Month',
      sessionCount: 0,
      eventCount: 0,
      totalTokens: 0,
    },
    projectMetadata: {
      projects: {},
      git: {},
      stack: {},
      github: {},
    },
  });
  const persona = buildPersonaV2(signals, { generatedAt });

  assert.equal(signals.generatedAt, generatedAt);
  assert.equal(persona.generatedAt, generatedAt);
  assert.equal(persona.code, 'ROOKIE');
  assert.equal(persona.stage, 'rookie');
});

test('passport core projects one bilingual persona profile without emoji', () => {
  const persona = {
    code: 'AMLW',
    archetype: {
      title: 'Indie Sigma',
      subtitle: '独立σ',
      signature: '我的栈不带任何人的污染',
    },
    identity: {
      badges: [
        {
          id: 'token-tycoon',
          label: 'Token Tycoon',
          category: 'Achievement',
          evidence: 'private local evidence',
        },
        {
          id: 'flow-state',
          label: 'Flow State',
          category: 'Work Pattern',
        },
      ],
      hidden: {
        featured: {
          id: 'insomniac-daywalker',
          title: 'Insomniac Daywalker',
          subtitle: '不眠行者',
          description: '凌晨在线，早上也在线。',
        },
        unlocked: [],
      },
    },
  };
  const english = buildPersonaProfileV1(persona, { locale: 'en-US' });
  const chinese = buildPersonaProfileV1(persona, { locale: 'zh-CN' });

  assert.equal(english.schemaVersion, 'taku.persona-profile.v1');
  assert.equal(english.family.label, 'Craftsman');
  assert.equal(english.basePersona.description, 'My stack stays uncontaminated by anyone else’s choices.');
  assert.equal(chinese.basePersona.description, '我的栈不带任何人的污染');
  assert.deepEqual(
    english.axisTags.map((tag) => tag.label),
    ['Plans first', 'Maker', 'Early bird', 'Lone wolf'],
  );
  assert.equal(english.basePersona.avatarKey, 'persona.base.AMLW');
  assert.equal(english.badges[0].avatarKey, 'persona.trait.token-tycoon');
  assert.equal('avatarKey' in english.badges[1], false);
  assert.equal(JSON.stringify(english).includes('emoji'), false);
  assert.equal(JSON.stringify(english).includes('private local evidence'), false);
});

test('passport core composes usage output without exposing workspace keys', () => {
  const usage = composeUsageSummary({
    primary: {
      id: 'thisMonth',
      label: 'This Month',
      scannedFileCount: 2,
      sessionCount: 3,
      eventCount: 8,
      totalInputTokens: 10,
      totalOutputTokens: 20,
      totalCacheReadTokens: 30,
      totalCacheCreationTokens: 40,
      totalReasoningTokens: 50,
      totalTokens: 150,
      sources: ['codex'],
      modelUsage: { modelCount: 1 },
      estimatedCost: { total: 1.5 },
    },
    periods: [{ id: 'thisMonth' }],
    personaUsage: {
      activity: { activeEventCount: 8 },
      workspaces: { activeWorkspaceCount: 1 },
      toolUsage: { toolCallCount: 4 },
      localActivity: { buildSessionCount: 2 },
      behaviorProfile: { schemaVersion: 'taku.creator.behavior.v1' },
      promptStyle: { rawPromptStored: false },
    },
    warnings: ['once', 'once'],
    privateWorkspaceKeys: ['workspace-a', 'workspace-a'],
  });

  assert.equal(usage.totalTokens, 150);
  assert.deepEqual(usage.warnings, ['once']);
  assert.equal(usage.localActivity.buildSessionCount, 2);
  assert.equal(usage.behaviorProfile, usage.behaviorProfileV1);
  assert.equal(Object.keys(usage).includes('__privateWorkspaceKeys'), false);
  assert.deepEqual(usage.__privateWorkspaceKeys, ['workspace-a']);
});

test('passport core runtime sources do not import compatibility or host layers', async () => {
  const sources = await Promise.all([
    readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/inventory.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/persona-engine.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/persona.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/privacy.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/snapshot.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/usage.ts', import.meta.url), 'utf8'),
  ]);
  const runtimeSource = sources.join('\n');
  for (const forbidden of [
    'creator/scripts',
    'publish-client',
    'taku-workers',
    'node:child_process',
    'node:fs',
    'node:path',
  ]) {
    assert.equal(runtimeSource.includes(forbidden), false, forbidden);
  }
  assert.equal(
    /(?:from|import)\s*['"]electron(?:\/[^'"]*)?['"]/.test(runtimeSource),
    false,
    'electron runtime import',
  );
});
