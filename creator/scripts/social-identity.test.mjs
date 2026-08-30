import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectGitHubIdentity,
  normalizeGitHubUsername,
  withGitHubSocialCandidate,
} from './social-identity.mjs';

test('detects the authenticated GitHub CLI user without reading a token', async () => {
  let received;
  const identity = await detectGitHubIdentity({
    execFile: async (command, args, options) => {
      received = { command, args, options };
      return { stdout: 'karr77\n', stderr: '' };
    },
    env: {},
  });

  assert.deepEqual(identity, {
    platform: 'github',
    username: 'karr77',
    profileUrl: 'https://github.com/karr77',
    source: 'github-cli',
    verified: true,
    requiresConfirmation: true,
  });
  assert.equal(received.command, 'gh');
  assert.deepEqual(received.args, ['api', 'user', '--jq', '.login']);
  assert.equal(received.options.env.GH_PROMPT_DISABLED, '1');
  assert.equal(received.args.includes('token'), false);
});

test('keeps GitHub detection optional and validates usernames', async () => {
  assert.equal(await detectGitHubIdentity({ execFile: async () => { throw new Error('not signed in'); } }), null);
  assert.equal(normalizeGitHubUsername('@valid-user'), 'valid-user');
  assert.equal(normalizeGitHubUsername('invalid--user'), '');
  assert.equal(normalizeGitHubUsername('not a user'), '');
});

test('adds a GitHub candidate without replacing an existing candidate', () => {
  const identity = { username: 'karr77', source: 'github-cli' };
  assert.deepEqual(withGitHubSocialCandidate({ card: {} }, identity), {
    card: {},
    socialCandidates: { github: identity },
  });
  assert.equal(
    withGitHubSocialCandidate({ socialCandidates: { github: { username: 'kept' } } }, identity)
      .socialCandidates.github.username,
    'kept',
  );
});
