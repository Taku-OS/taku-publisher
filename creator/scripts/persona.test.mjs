import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildPersonaV2 as buildCorePersonaV2,
  composePersonaSignals,
} from '#taku-passport-core';
import { createEmptyCreatorMetrics, mergeCreatorMetrics, normalizeCreatorMetrics } from './creator-metrics.mjs';
import {
  buildPersonaSignals,
  buildPersonaV2,
  loadPersonaRules,
} from './persona.mjs';

function signals(overrides = {}) {
  return {
    usage: { sessionCount: 6, eventCount: 24, totalTokens: 0, ...(overrides.usage || {}) },
    activity: {
      activeEventCount: 24,
      nightEventCount: 0,
      dayEventCount: 24,
      nightShare: 0,
      dayShare: 1,
      medianSessionMinutes: 40,
      longestSessionMinutes: 80,
      medianGapMinutes: 120,
      snackSessionCount: 0,
      ...(overrides.activity || {}),
    },
    workspaces: {
      knownWorkspaceSessionCount: 6,
      activeWorkspaceCount: 1,
      topWorkspaceSessionShare: 1,
      topWorkspaceActiveDays: 5,
      reopenCount: 5,
      ...(overrides.workspaces || {}),
    },
    behaviorProfile: {
      observedSessionCount: 6,
      planningRatio: 0.5,
      steeringRatio: 0.2,
      steeringTurnCount: 2,
      autonomyScore: 0.5,
      topToolsMix: [{ category: 'edit', share: 1 }],
      dominantToolCategory: 'edit',
      ...(overrides.behaviorProfile || {}),
    },
    toolTypes: { classifiedCount: 4, maker: 4, infra: 0, hybrid: 0, makerShare: 1, ...(overrides.toolTypes || {}) },
    toolUsage: { usedInstalledToolCount: 6, topTools: [], ...(overrides.toolUsage || {}) },
    ecosystem: { installedToolCount: 10, activeToolCount: 6, ...(overrides.ecosystem || {}) },
    external: overrides.external || createEmptyCreatorMetrics(),
    git: overrides.git || {},
    stack: overrides.stack || {},
    promptStyle: overrides.promptStyle || { enabled: false },
    period: { id: 'thisMonth', label: 'This Month' },
  };
}

test('uses Rookie while the four-axis evidence is insufficient', () => {
  const persona = buildPersonaV2(signals({
    usage: { sessionCount: 1 },
    activity: { activeEventCount: 4, dayEventCount: 4 },
    workspaces: { knownWorkspaceSessionCount: 1 },
    behaviorProfile: { observedSessionCount: 1 },
    toolTypes: { classifiedCount: 0, maker: 0, makerShare: 0.5 },
    toolUsage: { usedInstalledToolCount: 0 },
    ecosystem: { installedToolCount: 0, activeToolCount: 0 },
  }));

  assert.equal(persona.code, 'ROOKIE');
  assert.equal(persona.stage, 'rookie');
  assert.equal(persona.rookieVariant, 'alt');
  assert.equal(persona.archetype.title, 'The Rookie');
  assert.match(persona.provisionalCode, /^[AE][MI][LO][HW]$/);
});

test('uses the default Rookie appearance when no activity has been observed', () => {
  const persona = buildPersonaV2(signals({
    usage: { sessionCount: 0 },
    activity: { activeEventCount: 0, dayEventCount: 0 },
    workspaces: { knownWorkspaceSessionCount: 0, activeWorkspaceCount: 0 },
    behaviorProfile: { observedSessionCount: 0 },
    toolTypes: { classifiedCount: 0, maker: 0, makerShare: 0.5 },
    toolUsage: { usedInstalledToolCount: 0 },
    ecosystem: { installedToolCount: 0, activeToolCount: 0 },
  }));

  assert.equal(persona.code, 'ROOKIE');
  assert.equal(persona.rookieVariant, 'default');
});

test('assigns a four-axis persona once enough evidence is available', () => {
  const persona = buildPersonaV2(signals());

  assert.match(persona.code, /^[AE][MI][LO][HW]$/);
  assert.equal(persona.stage, 'classified');
  assert.equal(persona.provisionalCode, undefined);
  assert.equal(persona.rookieVariant, undefined);
});

test('uses Passport Core as the default Persona rule source', async () => {
  const result = await loadPersonaRules({ flags: new Map() });
  assert.equal(result.source, 'passport-core');
  assert.equal(result.path, undefined);
  assert.equal(result.rules.tonePacks.brainrot.archetypes.AMLW.title, 'Indie Sigma');
});

test('adds Tool Hoarder only for a large, lightly used tool collection', () => {
  const persona = buildPersonaV2(signals({
    toolUsage: { usedInstalledToolCount: 10 },
    ecosystem: { installedToolCount: 50, activeToolCount: 10 },
  }));

  assert.equal(persona.traits.some((trait) => trait.id === 'tool-hoarder'), true);

  const heavilyUsed = buildPersonaV2(signals({
    toolUsage: { usedInstalledToolCount: 30 },
    ecosystem: { installedToolCount: 50, activeToolCount: 30 },
  }));
  assert.equal(heavilyUsed.traits.some((trait) => trait.id === 'tool-hoarder'), false);
});

test('adds Beta Tester from an explicit creator metric', () => {
  const external = mergeCreatorMetrics(
    normalizeCreatorMetrics({ taku: { betaTester: true } }, { source: 'test' }),
    normalizeCreatorMetrics({ github: { publicRepoCount: 2 } }, { source: 'github' }),
  );
  const persona = buildPersonaV2(signals({ external }));

  assert.equal(persona.traits.some((trait) => trait.id === 'beta-tester'), true);
  assert.equal(persona.manualTraitCatalog.some((trait) => trait.id === 'beta-tester'), true);
});

test('uses continuous active time rather than total session span for Flow State', () => {
  const interrupted = buildPersonaV2(signals({
    activity: {
      longestSessionMinutes: 800,
      longestContinuousActiveMinutes: 120,
      continuousActivityIdleMinutes: 30,
    },
  }));
  assert.equal(interrupted.traits.some((trait) => trait.id === 'flow-state'), false);

  const continuous = buildPersonaV2(signals({
    activity: {
      longestSessionMinutes: 800,
      longestContinuousActiveMinutes: 400,
      continuousActivityIdleMinutes: 30,
    },
  }));
  const flowState = continuous.traits.find((trait) => trait.id === 'flow-state');
  assert.ok(flowState);
  assert.match(flowState.evidence, /400m longest continuous active span \(30m idle cutoff\)/);
});

test('keeps the trusted backend rank grade in creator metrics', () => {
  const external = mergeCreatorMetrics(
    normalizeCreatorMetrics({
      rankGrade: {
        grade: 'A',
        label: 'A · Top 5% creator',
        topPercent: 0.04,
        metric: 'installs',
        reason: 'Marketplace installs are in the top 5%.',
      },
    }, { source: 'worker' }),
  );

  assert.deepEqual(external.rankGrade, {
    grade: 'A',
    label: 'A · Top 5% creator',
    topPercent: 0.04,
    metric: 'installs',
    reason: 'Marketplace installs are in the top 5%.',
  });
});

test('legacy Persona host wrapper and Passport Core produce one canonical fixture', async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        '../../packages/passport-core/test/fixtures/persona-parity-input.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const coreSignals = composePersonaSignals(fixture);
  const legacySignals = await buildPersonaSignals(fixture);
  assert.deepEqual(legacySignals, coreSignals);

  const corePersona = buildCorePersonaV2(coreSignals, {
    generatedAt: fixture.generatedAt,
  });
  const legacyPersona = buildPersonaV2(legacySignals, {
    generatedAt: fixture.generatedAt,
  });
  assert.deepEqual(legacyPersona, corePersona);

  const canonicalHash = createHash('sha256')
    .update(JSON.stringify({ signals: coreSignals, persona: corePersona }))
    .digest('hex');
  assert.equal(
    canonicalHash,
    '35d60b07b15ed1010595c1886c20df4a2b4e5828ab0f473f9cf9c87c50deed4c',
  );
  assert.equal(JSON.stringify(coreSignals).includes('/Users/'), false);
  assert.equal(coreSignals.generatedAt, fixture.generatedAt);
  assert.equal(corePersona.generatedAt, fixture.generatedAt);
});
