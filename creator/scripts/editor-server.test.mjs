import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  bindDraftToDesktopAccount,
  LISTING_ICON_GENERATE_PATH,
  inspectLocalPackagePath,
  pendingLocalToolListingReviews,
  publisherAccountFromDraft,
  publisherAccountFromProfileResult,
  publisherAccountsMismatch,
  securityHeaders,
} from './editor-server.mjs';

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

test('blocks profile publishing until each local tool listing has an icon and required fields', () => {
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
      sections: [],
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

  assert.deepEqual(pendingLocalToolListingReviews(state)[0]?.missing, ['coverImageUrl']);
  state.draft.listingDrafts[tool.id].listing.coverImageUrl = 'https://cdn.taku.ai/icon.png';
  assert.deepEqual(pendingLocalToolListingReviews(state), []);
});
