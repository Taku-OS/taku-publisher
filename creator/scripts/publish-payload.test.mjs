import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { stableId } from './cli.mjs';
import { applyCreatorToolChoicesToDraft } from './draft.mjs';
import {
  createStaxCreatorPublishPayload,
  getBuilderProfileSnapshotForDisplay,
} from './publish-payload.mjs';

function publishOptions() {
  return {
    getCardSettings: () => ({
      name: 'Test creator',
      showPersonaCode: true,
      showUsage: true,
      showCreatorPageLink: true,
      visibility: 'public',
    }),
    buildBuilderProfileSnapshot: () => ({
      schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
      privacy: { publicSummaryOnly: true },
    }),
  };
}

test('keeps the Rookie appearance variant in the public profile snapshot', () => {
  const snapshot = getBuilderProfileSnapshotForDisplay({
    builderProfileSnapshot: {
      schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
      persona: {
        code: 'ROOKIE',
        title: 'The Rookie',
        rookieVariant: 'alt',
        axes: [{ id: 'howYouStart', label: 'Architect ↔ Explorer', letter: 'A' }],
      },
    },
  }, publishOptions());

  assert.equal(snapshot.persona.code, 'ROOKIE');
  assert.equal(snapshot.persona.rookieVariant, 'alt');
  assert.deepEqual(snapshot.persona.axes, []);
});

test('keeps an owned local Creator Tool Dock selection under the made relation', () => {
  const localTool = {
    id: 'local-background-removal',
    name: 'background-removal',
    type: 'skill',
    source: 'local-upload',
    sourceKind: 'local_upload',
    ownership: 'owned',
  };
  const next = applyCreatorToolChoicesToDraft({ sections: [], stats: {} }, {
    displayedTools: [localTool],
    hiddenTools: [],
    availableTools: [
      {
        ...localTool,
        displayed: true,
      },
    ],
  }, ['local-background-removal']);

  const item = next.sections.find((section) => section.id === 'creator-tools')?.items[0];
  assert.equal(item?.role, 'made');
  assert.equal(item?.relation, 'made');
  assert.equal(item?.ownership, 'mine');
  assert.equal(item?.selected, true);
});

test('publishes persona description separately without projecting it into card bio', async () => {
  const payload = await createStaxCreatorPublishPayload({
    sections: [],
    builderProfileSnapshot: {
      schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
      persona: {
        code: 'AILW',
        title: 'Daemon Daddy',
        description: 'My scripts are my children.',
        signature: 'Legacy signature fallback.',
      },
    },
    card: {
      name: 'Taku Creator',
      bio: 'Legacy profile bio.',
    },
    stats: {},
  }, { items: [] }, publishOptions());

  assert.equal(payload.profileSnapshot.persona.description, 'My scripts are my children.');
  assert.equal(payload.profileSnapshot.persona.signature, 'Legacy signature fallback.');
  assert.equal(Object.prototype.hasOwnProperty.call(payload.card, 'bio'), false);
});

test('keeps top-level usage within the Worker public import contract', async () => {
  const privatePath = path.join(path.sep, 'Users', 'example', '.codex', 'sessions', 'private.jsonl');
  const payload = await createStaxCreatorPublishPayload({
    sections: [],
    stats: {
      usage: {
        label: 'This Month',
        periodId: 'thisMonth',
        totalTokens: 1000,
        sessionCount: 4,
        eventCount: 12,
        modelUsage: {
          totalTokens: 1000,
          topModels: [{ modelId: 'gpt-test', share: 1 }],
        },
        estimatedCost: {
          totalUsd: 1.25,
          pricedTokenCount: 1000,
        },
        localActivity: {
          activeDayCount: 2,
          buildDayCount: 1,
          buildSessionCount: 3,
          chatSessionCount: 1,
          dailyHeatmap: [
            {
              date: '2026-07-22',
              active: true,
              sessionCount: 4,
              buildSessionCount: 3,
              eventCount: 12,
              toolCallCount: 8,
              tokenCount: 1000,
              buildIntensity: 4,
              privatePath,
            },
          ],
          sessionSplit: { sessionCount: 4, buildSessionCount: 3, chatSessionCount: 1, buildShare: 0.75 },
          buildStreak: { currentDays: 1, bestDays: 2 },
          trend30d: { buckets: [{ id: 'w1', label: '7/1-7/6', buildSessionCount: 3, privatePath }] },
          delta30d: { current: 3, previous: 1, delta: 2, display: '+200%' },
        },
      },
    },
  }, { items: [] }, publishOptions());

  const serialized = JSON.stringify(payload);
  assert.deepEqual(payload.usage, {
    label: 'This Month',
    period: 'thisMonth',
    unit: 'tokens',
    amount: 1000,
    sessions: 4,
    events: 12,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload.usage, 'modelUsage'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.usage, 'estimatedCost'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.usage, 'localActivity'), false);
  assert.equal(serialized.includes(privatePath), false);
});

test('publishes sanitized Stax block support data in the public profile snapshot', async () => {
  const privatePath = path.join(path.sep, 'Users', 'example', '.codex', 'sessions', 'private.jsonl');
  const payload = await createStaxCreatorPublishPayload({
    sections: [],
    builderProfileSnapshot: {
      schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
      privacy: { publicSummaryOnly: true },
      staxBlocks: {
        schemaVersion: 'taku.stax.blocks.v1',
        blocks: [
          {
            key: 'hero',
            status: 'supported',
            source: 'publisher.persona',
            value: {
              n1: 'Daemon Daddy',
              privatePath,
            },
          },
          {
            key: 'ctxring',
            status: 'partial',
            source: 'publisher.local_usage',
            quality: {
              kind: 'local_logs',
              label: '本地日志',
              reason: 'Average input tokens per observed local request.',
            },
            value: {
              avgInputTokens: 66000,
              requestCount: 24,
              display: '66K',
            },
          },
          {
            key: 'cgauge',
            status: 'unsupported',
            source: 'unavailable',
            reason: 'monthly quota and reset date are not available yet',
          },
        ],
      },
    },
    stats: {},
  }, { items: [] }, publishOptions());

  assert.equal(payload.profileSnapshot.staxBlocks.schemaVersion, 'taku.stax.blocks.v1');
  assert.deepEqual(
    payload.profileSnapshot.staxBlocks.blocks.map((block) => block.key),
    ['hero', 'cgauge', 'ctxring'],
  );
  assert.equal(payload.profileSnapshot.staxBlocks.summary.supported, 1);
  assert.equal(payload.profileSnapshot.staxBlocks.summary.partial, 1);
  assert.equal(payload.profileSnapshot.staxBlocks.summary.unsupported, 1);
  const ctxring = payload.profileSnapshot.staxBlocks.blocks.find((block) => block.key === 'ctxring');
  assert.notEqual(ctxring.estimated, true);
  assert.equal(ctxring.quality.label, '本地日志');
  assert.equal(JSON.stringify(payload).includes(privatePath), false);
});

test('does not silently publish an explicitly local installable without a package', async () => {
  const draft = {
    sections: [
      {
        id: 'using-tools',
        items: [
          {
            id: 'missing-local-package',
            name: 'missing-local-package',
            type: 'skill',
            source: 'local-upload',
            sourceKind: 'local_upload',
            installPolicy: 'installable',
            selected: true,
          },
        ],
      },
    ],
    stats: {},
  };

  await assert.rejects(
    createStaxCreatorPublishPayload(draft, { items: [] }, {
      getCardSettings: () => ({
        name: 'Test creator',
        showPersonaCode: true,
        showUsage: true,
        showCreatorPageLink: true,
        visibility: 'public',
      }),
      buildBuilderProfileSnapshot: () => ({
        schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
        privacy: {
          publicSummaryOnly: true,
          excludesPromptContent: true,
          excludesCommandArguments: true,
          excludesRawLogs: true,
          excludesSourceContent: true,
          excludesLocalPaths: true,
          excludesWorkspaceHashes: true,
          excludesRawSignals: true,
        },
      }),
    }),
    /without an install package/
  );
});

test('does not publish scanned or legacy candidate items without explicit selection', async () => {
  const payload = await createStaxCreatorPublishPayload({
    sections: [
      {
        id: 'using-tools',
        items: [{ id: 'scanned-tool', name: 'Scanned Tool', type: 'skill' }],
      },
      {
        id: 'used-candidates',
        items: [{ id: 'candidate-tool', name: 'Candidate Tool', type: 'skill', selected: true }],
      },
    ],
    stats: {},
  }, { items: [] }, publishOptions());

  assert.equal(payload.sections.usingTools.length, 0);
  assert.equal(payload.sections.builtItems.length, 0);
});

test('publishes an owned Creator Tool Dock skill as a made installable item', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-publisher-owned-skill-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'skill.md'), '# YouTube to ebook\n\nCreate ebook articles.\n');

  const item = {
    id: 'local-youtube-to-ebook',
    name: 'youtube-to-ebook',
    type: 'skill',
    source: 'local-upload',
    sourceKind: 'local_upload',
    installPolicy: 'installable',
    ownership: 'mine',
    role: 'made',
    relation: 'made',
    ownershipReasons: ['Selected in Creator Tool Dock'],
    selected: true,
  };
  const draft = {
    sections: [{ id: 'creator-tools', items: [item] }],
    listingDrafts: {
      [item.id]: {
        sourceItemId: item.id,
        status: 'ready',
        listing: {
          title: 'YouTube to Ebook',
          shortDescription: 'Transform videos into structured ebook articles.',
          description: 'Transform videos into structured ebook articles.',
          category: 'writing-content',
          additionalCategories: ['media-audio', 'education'],
          type: 'skill',
          tags: ['youtube', 'ebook'],
          coverImageUrl: 'https://cdn.taku.ai/youtube-to-ebook.png',
          visibility: 'public',
        },
      },
    },
    stats: {
      creatorToolSelectionMode: 'custom',
      creatorToolIds: [item.id],
    },
  };

  const payload = await createStaxCreatorPublishPayload(draft, {
    items: [{ id: item.id, localPath: root }],
  }, {
    getCardSettings: () => ({
      name: 'Test creator',
      showPersonaCode: true,
      showUsage: true,
      showCreatorPageLink: true,
      visibility: 'public',
    }),
    buildBuilderProfileSnapshot: () => ({
      schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
      privacy: { publicSummaryOnly: true },
    }),
  });

  assert.equal(payload.sections.usingTools.length, 0);
  assert.equal(payload.sections.madeItems.length, 1);
  assert.equal(payload.sections.builtItems.length, 1);
  assert.equal(payload.sections.madeItems[0].ownership, 'mine');
  assert.equal(payload.sections.madeItems[0].installability, 'installable');
  assert.equal(payload.sections.madeItems[0].marketplacePublicationIntent, 'publish');
  assert.equal(payload.sections.madeItems[0].package.kind, 'skill');
  assert.ok(payload.sections.madeItems[0].package.files.includes('SKILL.md'));
  assert.equal(payload.sections.madeItems[0].name, 'YouTube to Ebook');
  assert.equal(payload.sections.madeItems[0].category, 'writing-content');
  assert.deepEqual(payload.sections.madeItems[0].categories, ['writing-content', 'media-audio', 'education']);
  assert.deepEqual(payload.sections.madeItems[0].tags, ['youtube', 'ebook']);
  assert.equal(payload.sections.madeItems[0].coverImageUrl, 'https://cdn.taku.ai/youtube-to-ebook.png');
});

test('publishes a third-party GitHub workflow as reference-only without reading local install paths', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-publisher-github-workflow-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const registryPath = path.join(root, 'registry.json');
  const source = 'taku-workflow';
  const upstreamId = 'https://github.com/whyujjwal/claude-marketing';
  const itemId = stableId(source, 'workflow', upstreamId, registryPath);
  const exampleRoot = path.join(path.sep, 'Users', 'example', '.taku', 'workflows');
  await fs.writeFile(registryPath, JSON.stringify({
    entries: [{
      id: upstreamId,
      kind: 'workflow',
      name: 'Claude Marketing',
      source: 'github-reference',
      storagePath: 'github:whyujjwal/claude-marketing@main',
      installPath: path.join(exampleRoot, 'claude-marketing'),
      entryPath: path.join(exampleRoot, 'claude-marketing', 'install.json'),
      registryPath: path.join(exampleRoot, 'registry.json'),
      definition: {
        type: 'action',
        commands: [{ commandName: 'marketing', title: 'marketing' }],
      },
    }],
  }, null, 2));

  const payload = await createStaxCreatorPublishPayload({
    sections: [{
      id: 'using-tools',
      items: [{
        id: itemId,
        name: 'Claude Marketing',
        type: 'workflow',
        source,
        role: 'using',
        selected: true,
      }],
    }],
    stats: {},
  }, {
    items: [{
      id: itemId,
      name: 'Claude Marketing',
      type: 'workflow',
      source,
      localPath: registryPath,
    }],
  }, publishOptions());

  const published = payload.sections.usingTools[0];
  assert.equal(published.name, 'Claude Marketing');
  assert.equal(published.installability, 'reference-only');
  assert.equal(published.github_reference.fullName, 'whyujjwal/claude-marketing');
  assert.equal(published.metadata.skillPackage, undefined);
  assert.equal(JSON.stringify(published).includes(path.join(path.sep, 'Users', 'example')), false);
});
