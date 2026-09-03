import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  bindDraftToDesktopAccount,
  communitySkillPublishError,
  LISTING_ICON_GENERATE_PATH,
  LOCAL_AUTH_REDEEM_PATH,
  inspectLocalPackagePath,
  pendingLocalToolListingReviews,
  prepareCommunitySkillsForPublish,
  publisherAccountFromDraft,
  publisherAccountFromProfileResult,
  publisherAccountsMismatch,
  securityHeaders,
} from './editor-server.mjs';

test('accepts the full Stax snapshot payload on the publish route', async () => {
  const source = await fs.readFile(new URL('./editor-server.mjs', import.meta.url), 'utf8');
  assert.match(
    source,
    /requestUrl\.pathname === '\/api\/publish'[\s\S]*?readRequestJson\(request, PUBLISH_REQUEST_BODY_BYTES\)/,
  );
});

test('accepts a skill directory whose definition filename uses lowercase', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-publisher-skill-dir-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const skillPath = path.join(root, 'skill.md');
  await fs.writeFile(skillPath, '# Background removal\n');

  assert.deepEqual(await inspectLocalPackagePath(root), {
    type: 'skill',
    localPath: skillPath,
  });
});

test('uses the canonical Marketplace icon generation endpoint', () => {
  assert.equal(LISTING_ICON_GENERATE_PATH, '/marketplace/icons/generate');
});

test('uses the canonical Marketplace local auth redeem endpoint', () => {
  assert.equal(LOCAL_AUTH_REDEEM_PATH, '/marketplace/local-auth/redeem');
});

test('shows Community Skill publishing preflight errors in English', () => {
  assert.equal(
    communitySkillPublishError(
      new Error('Skill package file: references/terminal_display.md may contain private data'),
    ),
    'The file references/terminal_display.md in this Skill may contain a local path or private data. Publishing was stopped. Remove the sensitive data and try again.',
  );
});

test('detects when Taku authorizes a different account than the bound draft', () => {
  const expected = publisherAccountFromDraft({
    publisherAccount: {
      username: 'jiayichimeronboard9',
      displayName: 'jiayi.chimer+onboard9',
    },
  });
  const actual = publisherAccountFromProfileResult({
    profile: { displayName: 'Commpanyproduc' },
    staxProfile: { username: 'commpanyproductt' },
  });

  assert.equal(publisherAccountsMismatch(expected, actual), true);
});

test('allows display-name changes when the stable Taku username still matches', () => {
  const expected = publisherAccountFromDraft({
    staxProfile: { handle: '@JiayiOnboard9', displayName: 'Old name' },
  });
  const actual = publisherAccountFromProfileResult({
    profile: { displayName: 'New name' },
    staxProfile: { username: 'jiayionboard9' },
  });

  assert.equal(publisherAccountsMismatch(expected, actual), false);
});

test('uses immutable Desktop user IDs before public usernames', () => {
  assert.equal(publisherAccountsMismatch(
    { userId: 'account-a', username: 'old-handle' },
    { userId: 'account-a', username: 'new-handle' },
  ), false);
  assert.equal(publisherAccountsMismatch(
    { userId: 'account-a', username: 'same-handle' },
    { userId: 'account-b', username: 'same-handle' },
  ), true);
  assert.equal(publisherAccountsMismatch(
    { userId: 'account-a' },
    { username: 'unverified-handle' },
  ), true);
});

test('sanitizes legacy unbound Desktop drafts before syncing the current account', () => {
  const bound = bindDraftToDesktopAccount({
    publisherAccount: { username: 'old-user', displayName: 'Old User' },
    creator: { name: 'Old User', avatarUrl: 'https://cdn.example.test/old.png' },
    card: { avatarUrl: 'https://cdn.example.test/old.png', theme: 'dark' },
    staxProfile: { username: 'old-user' },
    publishedStax: { published: true, username: 'old-user' },
    stats: {
      publishedStax: { published: true, username: 'old-user' },
      creatorProfileSynced: true,
      usageTokenCount: 42,
    },
    personaV2: { code: 'EMLW' },
  }, 'new-user-id');

  assert.deepEqual(bound.publisherAccount, { userId: 'new-user-id' });
  assert.equal(bound.staxProfile, undefined);
  assert.equal(bound.publishedStax, undefined);
  assert.equal(bound.creator.name, undefined);
  assert.equal(bound.creator.avatarUrl, undefined);
  assert.equal(bound.card.avatarUrl, undefined);
  assert.equal(bound.card.theme, 'dark');
  assert.equal(bound.stats.publishedStax, undefined);
  assert.equal(bound.stats.creatorProfileSynced, undefined);
  assert.equal(bound.stats.usageTokenCount, 42);
  assert.deepEqual(bound.personaV2, { code: 'EMLW' });
});

test('refuses a Desktop draft explicitly owned by another immutable account', () => {
  assert.throws(
    () => bindDraftToDesktopAccount({ publisherAccount: { userId: 'old-user-id' } }, 'new-user-id'),
    /belongs to another Taku account/,
  );
});

test('allows bundled Stax preview fonts under the editor CSP', () => {
  assert.match(securityHeaders()['Content-Security-Policy'], /font-src 'self' data:/);
});

test('requires listing copy for selected Community tools but generates the icon at publish time', () => {
  const tool = {
    id: 'local-tool-1',
    name: 'youtube-to-ebook',
    type: 'skill',
    source: 'local-upload',
    ownership: 'owned',
  };
  const state = {
    toolChoices: { displayedTools: [tool] },
    draft: {
      sections: [{ id: 'creator-tools', items: [{ ...tool, selected: true }] }],
      listingDrafts: {
        [tool.id]: {
          status: 'ready',
          listing: {
            title: 'YouTube to Ebook',
            shortDescription: 'Turn a video into an ebook.',
            category: 'writing-content',
            type: 'skill',
          },
        },
      },
    },
  };

  assert.deepEqual(pendingLocalToolListingReviews(state), []);
  state.draft.listingDrafts[tool.id].listing.shortDescription = '';
  assert.deepEqual(pendingLocalToolListingReviews(state)[0]?.missing, ['shortDescription']);
  state.draft.listingDrafts[tool.id].listing.shortDescription = 'Turn a video into an ebook.';
  state.draft.listingDrafts[tool.id].listing.coverImageUrl = 'https://cdn.taku.ai/icon.png';
  assert.deepEqual(pendingLocalToolListingReviews(state), []);

  state.draft.sections = [];
  state.draft.listingDrafts[tool.id].listing.coverImageUrl = '';
  assert.deepEqual(pendingLocalToolListingReviews(state), []);
});

test('does not block Stax Card publishing for unselected Profile tools', async () => {
  const profileTools = [
    { id: 'product-manager', name: 'product-manager', type: 'subagent' },
    { id: 'taku-qa-reviewer', name: 'taku-qa-reviewer', type: 'subagent' },
    { id: 'browser', name: 'browser', type: 'plugin' },
    { id: 'aihot', name: 'aihot', type: 'skill', publishable: true },
  ];
  const draft = {
    sections: [{ id: 'creator-tools', items: profileTools }],
    listingDrafts: {},
    stats: {
      creatorToolSelectionMode: 'default-none',
      creatorToolIds: [],
    },
  };

  assert.deepEqual(pendingLocalToolListingReviews({ draft }), []);
  assert.deepEqual(
    await prepareCommunitySkillsForPublish({ draft }),
    draft,
  );
});

test('prepares a selected Community Skill with an installable package and generated HTTPS icon', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-community-publish-preflight-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'SKILL.md'), '# Capafy publisher\n');
  await fs.mkdir(path.join(root, '.temp'));
  await fs.writeFile(
    path.join(root, '.temp', 'publish-work-state.json'),
    JSON.stringify({ sourcePath: '/tmp/private-project' }),
  );
  const tool = {
    id: 'capafy-publisher',
    name: 'capafy-publisher',
    description: 'Publish and manage Capafy Skills.',
    type: 'skill',
    source: 'codex',
    publishable: true,
  };
  const draft = {
    sections: [{ id: 'creator-tools', items: [{ ...tool, selected: true }] }],
    listingDrafts: {},
    stats: {},
  };

  const prepared = await prepareCommunitySkillsForPublish({
    draft,
    toolChoices: { displayedTools: [tool] },
    privateInventory: { items: [{ id: tool.id, localPath: root }] },
    workerUrl: 'https://worker.example.test',
    iconToken: 'icon-token',
    generateIcon: async () => ({
      response: { ok: true },
      data: { imageUrl: 'https://cdn.taku.ai/capafy-publisher.png' },
    }),
  });

  assert.equal(prepared.listingDrafts[tool.id].status, 'ready');
  assert.equal(
    prepared.listingDrafts[tool.id].listing.coverImageUrl,
    'https://cdn.taku.ai/capafy-publisher.png',
  );
});
