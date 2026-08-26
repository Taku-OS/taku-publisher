import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStaxCardPageUrl,
  buildStaxCreatorPageUrl,
  buildStaxProfilePageUrl,
  buildStaxPublishedLinks,
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
    },
  );
});
