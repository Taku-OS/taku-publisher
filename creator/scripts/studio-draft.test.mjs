import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createStudioDraftPayload, saveDraftToTakuStudio } from './publish-flow.mjs';
import { buildStaxStudioUrl } from './stax-url.mjs';

test('Studio draft payload removes installable package bytes', () => {
  const source = {
    card: { displayName: 'Ada' },
    sections: {
      builtItems: [{ id: 'skill-1', package: { data: 'private-package' }, marketplacePublicationIntent: 'publish' }],
      usingTools: [],
    },
  };

  const result = createStudioDraftPayload(source);
  assert.equal(result.sections.builtItems[0].package, undefined);
  assert.equal(result.sections.builtItems[0].marketplacePublicationIntent, undefined);
  assert.deepEqual(source.sections.builtItems[0].package, { data: 'private-package' });
});

test('Studio URL is stable for the configured Taku site', () => {
  assert.equal(buildStaxStudioUrl('https://taku.ai'), 'https://taku.ai/studio/stax-card');
  assert.equal(buildStaxStudioUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000/studio/stax-card');
});

test('saving a Studio draft uploads the exact Publisher renderer without publishing the card', async (t) => {
  const loopback = '127.0.0.1';
  const previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';
  t.after(() => {
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
  });
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
    if (request.method === 'GET' && request.url === '/stax/studio/cards/me') {
      response.end(JSON.stringify({
        ok: true,
        data: { draft: { revision: 7 }, saveContract: 'revision-v1' },
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
          studioUrl: `http://${request.headers.host}/stax/studio/editor?launch=taku_studio_launch_${'a'.repeat(32)}`,
          launchContext: { id: `taku_studio_launch_${'a'.repeat(32)}` },
          account: { hint: 'cl***@example.com' },
        },
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  await new Promise((resolve) => server.listen(0, loopback, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await saveDraftToTakuStudio({
    draft: {
      personaV2: {
        code: 'EILW',
        archetype: { title: 'Mad Inventor' },
      },
      sections: [],
      stats: {},
    },
    privateInventory: { items: [] },
    workerUrl: `http://${loopback}:${server.address().port}`,
    token: 'test-publisher-token',
    siteUrl: 'https://taku.ai',
    context: {
      getCardSettings: () => ({
        name: 'Cloud Builder',
        visibility: 'public',
      }),
      buildBuilderProfileSnapshot: () => ({
        schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
        persona: { code: 'EILW', title: 'Mad Inventor' },
        card: { displayName: 'Cloud Builder' },
        privacy: { publicSummaryOnly: true },
      }),
    },
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(
    result.studioUrl,
    `${result.workerUrl}/stax/studio/editor?launch=taku_studio_launch_${'a'.repeat(32)}`,
  );
  assert.equal(result.accountHint, 'cl***@example.com');
  assert.equal(savedPayload.expectedRevision, 7);
  assert.equal(savedPayload.issueLaunchContext, true);
  assert.equal(savedPayload.content.studioRenderer.schemaVersion, 'taku.stax.studio-renderer.v1');
  assert.equal(savedPayload.content.studioRenderer.renderer, 'publisher-stax-app');
  assert.equal(savedPayload.content.studioRenderer.model.handle, '@cloud-builder');
  assert.deepEqual(calls, [
    'GET /stax/profile',
    'GET /stax/studio/cards/me',
    'PUT /stax/studio/cards/me',
  ]);
});

test('a narrow draft token tries canonical identity before saving cloud Studio', async (t) => {
  const loopback = '127.0.0.1';
  const previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';
  t.after(() => {
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
  });
  const calls = [];
  const server = createServer(async (request, response) => {
    calls.push(`${request.method} ${request.url}`);
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/stax/studio/cards/me') {
      response.end(JSON.stringify({
        ok: true,
        data: { draft: null, saveContract: 'revision-v1' },
      }));
      return;
    }
    if (request.method === 'PUT' && request.url === '/stax/studio/cards/me') {
      response.end(JSON.stringify({ ok: true, data: { draft: { id: 'draft-2' } } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  await new Promise((resolve) => server.listen(0, loopback, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await saveDraftToTakuStudio({
    draft: { personaV2: { code: 'EILW' }, sections: [], stats: {} },
    privateInventory: { items: [] },
    workerUrl: `http://${loopback}:${server.address().port}`,
    token: 'taku_pub_narrow-test-token',
    siteUrl: 'https://taku.ai',
    context: {
      getCardSettings: () => ({ name: 'Narrow Draft' }),
      buildBuilderProfileSnapshot: () => ({
        schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
        persona: { code: 'EILW' },
        privacy: { publicSummaryOnly: true },
      }),
    },
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(calls, [
    'GET /stax/profile',
    'GET /stax/creators/me',
    'GET /stax/studio/cards/me',
    'PUT /stax/studio/cards/me',
  ]);
});

test('Studio save refuses to overwrite a newer cloud revision', async (t) => {
  const loopback = '127.0.0.1';
  const previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';
  t.after(() => {
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
  });
  let savedPayload;
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/stax/studio/cards/me') {
      response.end(JSON.stringify({
        data: {
          draft: { id: 'draft-1', revision: 4 },
          saveContract: 'revision-v1',
        },
      }));
      return;
    }
    if (request.method === 'PUT' && request.url === '/stax/studio/cards/me') {
      let body = '';
      for await (const chunk of request) body += chunk;
      savedPayload = JSON.parse(body);
      response.statusCode = 409;
      response.end(JSON.stringify({
        error: 'This Studio draft changed in another session.',
        code: 'STUDIO_DRAFT_REVISION_CONFLICT',
        data: { draft: { id: 'draft-1', revision: 5 } },
      }));
      return;
    }
    response.statusCode = 403;
    response.end(JSON.stringify({ error: 'Forbidden' }));
  });
  await new Promise((resolve) => server.listen(0, loopback, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await saveDraftToTakuStudio({
    draft: { personaV2: { code: 'EILW' }, sections: [], stats: {} },
    privateInventory: { items: [] },
    workerUrl: `http://${loopback}:${server.address().port}`,
    token: 'taku_pub_conflict-test-token',
    siteUrl: 'https://taku.ai',
    context: {
      getCardSettings: () => ({ name: 'Conflict Draft' }),
      buildBuilderProfileSnapshot: () => ({
        schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
        persona: { code: 'EILW' },
        privacy: { publicSummaryOnly: true },
      }),
    },
  });

  assert.equal(savedPayload.expectedRevision, 4);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.error, /changed in another session/i);
});

test('new Publisher keeps the raw save body until Worker advertises revision-v1', async (t) => {
  const loopback = '127.0.0.1';
  const previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';
  t.after(() => {
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
  });
  let savedPayload;
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/stax/studio/cards/me') {
      response.end(JSON.stringify({ data: { draft: null } }));
      return;
    }
    if (request.method === 'PUT' && request.url === '/stax/studio/cards/me') {
      let body = '';
      for await (const chunk of request) body += chunk;
      savedPayload = JSON.parse(body);
      response.end(JSON.stringify({ data: { draft: { id: 'draft-1' } } }));
      return;
    }
    response.statusCode = 403;
    response.end(JSON.stringify({ error: 'Forbidden' }));
  });
  await new Promise((resolve) => server.listen(0, loopback, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await saveDraftToTakuStudio({
    draft: { personaV2: { code: 'EILW' }, sections: [], stats: {} },
    privateInventory: { items: [] },
    workerUrl: `http://${loopback}:${server.address().port}`,
    token: 'taku_pub_old-worker-test-token',
    siteUrl: 'https://taku.ai',
    context: {
      getCardSettings: () => ({ name: 'Old Worker' }),
      buildBuilderProfileSnapshot: () => ({
        schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
        persona: { code: 'EILW' },
        privacy: { publicSummaryOnly: true },
      }),
    },
  });

  assert.equal(result.ok, true);
  assert.equal(savedPayload.schemaVersion, undefined);
  assert.equal(savedPayload.content, undefined);
  assert.equal(savedPayload.card.displayName, 'Old Worker');
});

test('new Publisher falls back to a raw PUT when an old Worker has no draft GET route', async (t) => {
  const loopback = '127.0.0.1';
  const previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';
  t.after(() => {
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
  });
  const calls = [];
  let savedPayload;
  const server = createServer(async (request, response) => {
    calls.push(`${request.method} ${request.url}`);
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/stax/studio/cards/me') {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    if (request.method === 'PUT' && request.url === '/stax/studio/cards/me') {
      let body = '';
      for await (const chunk of request) body += chunk;
      savedPayload = JSON.parse(body);
      response.end(JSON.stringify({ data: { draft: { id: 'draft-1' } } }));
      return;
    }
    response.statusCode = 403;
    response.end(JSON.stringify({ error: 'Forbidden' }));
  });
  await new Promise((resolve) => server.listen(0, loopback, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await saveDraftToTakuStudio({
    draft: { personaV2: { code: 'EILW' }, sections: [], stats: {} },
    privateInventory: { items: [] },
    workerUrl: `http://${loopback}:${server.address().port}`,
    token: 'taku_pub_legacy-worker-test-token',
    siteUrl: 'https://taku.ai',
    context: {
      getCardSettings: () => ({ name: 'Legacy Worker' }),
      buildBuilderProfileSnapshot: () => ({
        schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
        persona: { code: 'EILW' },
        privacy: { publicSummaryOnly: true },
      }),
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    'GET /stax/profile',
    'GET /stax/creators/me',
    'GET /stax/studio/cards/me',
    'PUT /stax/studio/cards/me',
  ]);
  assert.equal(savedPayload.content, undefined);
  assert.equal(savedPayload.card.displayName, 'Legacy Worker');
});

test('Studio save preserves an authorization failure so the Publisher can retry once', async (t) => {
  const loopback = '127.0.0.1';
  const previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';
  t.after(() => {
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
  });
  const server = createServer((request, response) => {
    response.statusCode = 401;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ error: 'Publisher session expired' }));
  });
  await new Promise((resolve) => server.listen(0, loopback, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const result = await saveDraftToTakuStudio({
    draft: { personaV2: { code: 'EILW' }, sections: [], stats: {} },
    privateInventory: { items: [] },
    workerUrl: `http://${loopback}:${server.address().port}`,
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
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
});
