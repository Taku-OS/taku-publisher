import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { createStudioDraftPayload, saveDraftToTakuStudio } from './publish-flow.mjs';

test('Studio draft payload removes installable package bytes', () => {
  const source = {
    card: { displayName: 'Ada' },
    sections: {
      builtItems: [{
        id: 'skill-1',
        package: { data: 'private-package' },
        marketplacePublicationIntent: 'publish',
      }],
      usingTools: [],
    },
  };
  const result = createStudioDraftPayload(source);
  assert.equal(result.sections.builtItems[0].package, undefined);
  assert.equal(result.sections.builtItems[0].marketplacePublicationIntent, undefined);
  assert.deepEqual(source.sections.builtItems[0].package, { data: 'private-package' });
});

test('saving a Studio draft uploads the Publisher renderer without publishing the card', async (t) => {
  const calls = [];
  let savedPayload;
  const server = createServer(async (request, response) => {
    calls.push(`${request.method} ${request.url}`);
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/stax/profile') {
      response.end(JSON.stringify({
        ok: true,
        data: {
          handle: '@cloud-builder',
          username: 'cloud-builder',
          displayName: 'Cloud Builder',
        },
      }));
      return;
    }
    if (request.method === 'PUT' && request.url === '/stax/studio/cards/me') {
      let body = '';
      for await (const chunk of request) body += chunk;
      savedPayload = JSON.parse(body);
      response.end(JSON.stringify({
        ok: true,
        data: {
          draft: { id: 'draft-1' },
          studioUrl: `http://${request.headers.host}/stax/studio/editor?launch=test-launch`,
          launchContext: { id: 'test-launch' },
          account: { hint: 'cl***@example.com' },
        },
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';
  t.after(() => {
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
  });
  const workerUrl = `http://127.0.0.1:${server.address().port}`;
  const result = await saveDraftToTakuStudio({
    draft: {
      personaV2: { code: 'EILW', archetype: { title: 'Mad Inventor' } },
      sections: [],
      stats: {},
    },
    privateInventory: { items: [] },
    workerUrl,
    token: 'test-publisher-token',
    siteUrl: 'https://taku.ai',
    context: {
      getCardSettings: () => ({ name: 'Cloud Builder', visibility: 'public' }),
      buildBuilderProfileSnapshot: () => ({
        schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
        persona: { code: 'EILW', title: 'Mad Inventor' },
        card: { displayName: 'Cloud Builder' },
        privacy: { publicSummaryOnly: true },
      }),
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.studioUrl, `${workerUrl}/stax/studio/editor?launch=test-launch`);
  assert.equal(result.accountHint, 'cl***@example.com');
  assert.equal(savedPayload.studioRenderer.schemaVersion, 'taku.stax.studio-renderer.v1');
  assert.equal(savedPayload.studioRenderer.renderer, 'publisher-stax-app');
  assert.equal(savedPayload.studioRenderer.model.handle, '@cloud-builder');
  assert.deepEqual(calls, ['GET /stax/profile', 'PUT /stax/studio/cards/me']);
});

test('Studio authorization failure stays retryable and does not publish', async (t) => {
  const calls = [];
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    response.statusCode = 401;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ error: 'Publisher session expired' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';
  t.after(() => {
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
  });
  const workerUrl = `http://127.0.0.1:${server.address().port}`;
  const result = await saveDraftToTakuStudio({
    draft: { personaV2: { code: 'EILW' }, sections: [], stats: {} },
    privateInventory: { items: [] },
    workerUrl,
    token: 'taku_pub_expired-test-token',
    siteUrl: 'https://taku.ai',
    context: {
      getCardSettings: () => ({ name: 'Expired Draft' }),
      buildBuilderProfileSnapshot: () => ({
        schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
        persona: { code: 'EILW' },
        privacy: { publicSummaryOnly: true },
      }),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.needsAuth, true);
  assert.deepEqual(calls, ['PUT /stax/studio/cards/me']);
});
