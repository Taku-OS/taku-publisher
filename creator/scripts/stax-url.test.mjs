import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStaxCardPageUrl,
  buildStaxCreatorPageUrl,
  buildStaxProfilePageUrl,
  buildStaxPublishedLinks,
  buildStaxStudioUrl,
} from './stax-url.mjs';

test('builds separate creator profile and Stax card URLs', () => {
  assert.equal(
    buildStaxProfilePageUrl('https://taku.ai', 'alice smith'),
    'https://taku.ai/profile/alice%20smith',
  );
  assert.equal(
    buildStaxCreatorPageUrl('https://taku.ai', 'alice smith'),
    'https://taku.ai/profile/alice%20smith',
  );
  assert.equal(
    buildStaxCardPageUrl('https://taku.ai', 'alice smith'),
    'https://taku.ai/stax/alice%20smith',
  );
});

test('adds only an opaque launch context to the Studio URL', () => {
  const launchContextId = `taku_studio_launch_${'b'.repeat(32)}`;
  const url = new URL(buildStaxStudioUrl('https://taku.ai', { launchContextId }));
  assert.equal(url.pathname, '/studio/stax-card');
  assert.equal(url.searchParams.get('launch'), launchContextId);
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(url.searchParams.has('email'), false);
});

test('publishes explicit profile and Stax links while preserving creator compatibility', () => {
  assert.deepEqual(
    buildStaxPublishedLinks('https://taku.ai/stax', { username: 'alice' }),
    {
      slug: 'alice',
      profilePageUrl: 'https://taku.ai/profile/alice',
      creatorPageUrl: 'https://taku.ai/profile/alice',
      staxCardPageUrl: 'https://taku.ai/stax/alice',
      staxCardShareUrl: 'https://taku.ai/stax/alice',
      staxCardImageUrl: 'https://taku.ai/api/og/stax/alice',
      studioUrl: 'https://taku.ai/studio/stax-card',
    },
  );
});
