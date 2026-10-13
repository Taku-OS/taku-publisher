import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStaxCardPageUrl,
  buildStaxChallengeReviewUrl,
  buildStaxCreatorPageUrl,
  buildStaxProfilePageUrl,
  buildStaxPublishedLinks,
  buildStaxStudioUrl,
  resolveStaxStudioUrl,
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

test('builds the Stax Challenge Review URL on the configured LP', () => {
  const launchContextId = `taku_studio_launch_${'c'.repeat(32)}`;
  const url = new URL(buildStaxChallengeReviewUrl('http://localhost:3001', {
    launchContextId,
  }));
  assert.equal(url.origin, 'http://localhost:3001');
  assert.equal(url.pathname, '/stax');
  assert.equal(url.searchParams.get('review'), '1');
  assert.equal(url.searchParams.get('launch'), launchContextId);
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

test('keeps local Studio on the configured loopback origin and carries the Worker launch ID', () => {
  const launchContextId = `taku_studio_launch_${'d'.repeat(32)}`;
  const workerStudioUrl = `https://worker.taku.ai/stax/studio/editor?launch=${launchContextId}&token=do-not-copy#private-fragment`;
  for (const origin of ['http://localhost:3001', 'http://127.0.0.1:3003', 'http://[::1]:3001']) {
    assert.equal(
      resolveStaxStudioUrl(origin, workerStudioUrl),
      `${origin}/studio/stax-card?launch=${launchContextId}`,
    );
  }
});

test('prefers the returned launch context for local Studio and keeps production Worker URLs', () => {
  const launchContextId = `taku_studio_launch_${'e'.repeat(32)}`;
  const workerStudioUrl = 'https://worker.taku.ai/stax/studio/editor?launch=previous';
  assert.equal(
    resolveStaxStudioUrl('http://localhost:3001', workerStudioUrl, { launchContextId }),
    `http://localhost:3001/studio/stax-card?launch=${launchContextId}`,
  );
  for (const siteUrl of ['https://taku.ai', 'https://localhost.example.com']) {
    assert.equal(resolveStaxStudioUrl(siteUrl, workerStudioUrl), workerStudioUrl);
  }
});

test('keeps the Studio link local in published results', () => {
  const launchContextId = `taku_studio_launch_${'f'.repeat(32)}`;
  const links = buildStaxPublishedLinks('http://localhost:3001', {
    username: 'alice',
    studioUrl: `https://worker.taku.ai/stax/studio/editor?launch=${launchContextId}`,
  });
  assert.equal(links.studioUrl, `http://localhost:3001/studio/stax-card?launch=${launchContextId}`);
});
