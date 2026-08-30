import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCardSettingsToDraft,
  cardSettingsForDraft,
} from './draft.mjs';
import { buildStaxBlocks } from './stax-blocks.mjs';

function draftFixture() {
  return {
    schemaVersion: 'taku.creator.draft.v1',
    card: {},
    creator: { name: 'Builder' },
    staxProfile: { handle: '@builder' },
    socialCandidates: {
      github: {
        username: 'karr77',
        source: 'github-cli',
        verified: true,
        requiresConfirmation: true,
      },
    },
    stats: { usage: {} },
    personaSignals: {},
    personaV2: { code: 'EILH', archetype: { title: 'Mad Scientist' } },
    sections: [],
  };
}

function socialBlock(draft) {
  return buildStaxBlocks(draft).blocks.find((block) => block.key === 'social');
}

test('keeps a detected GitHub account locked until the user confirms it', () => {
  const social = socialBlock(draftFixture());

  assert.equal(social.status, 'unsupported');
  assert.equal(social.source, 'publisher.github_candidate');
  assert.equal(social.lockLabel, 'ADD GITHUB');
  assert.match(social.lockReason, /@karr77/);
});

test('persists a confirmed GitHub account and enables Social', () => {
  const draft = applyCardSettingsToDraft(draftFixture(), {
    confirmedSocial: { github: '@karr77' },
  });
  const social = socialBlock(draft);

  assert.deepEqual(cardSettingsForDraft(draft).confirmedSocial, { github: 'karr77' });
  assert.equal(social.status, 'supported');
  assert.equal(social.source, 'publisher.confirmed_social');
  assert.deepEqual(social.value, { github: 'karr77' });
});

test('rejects an invalid GitHub account from card settings', () => {
  const draft = applyCardSettingsToDraft(draftFixture(), {
    confirmedSocial: { github: 'not a github user' },
  });

  assert.equal(cardSettingsForDraft(draft).confirmedSocial, undefined);
});
