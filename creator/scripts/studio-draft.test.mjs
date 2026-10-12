import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { mergeRegeneratedStudioDraftContent, createStudioDraftPayload, saveDraftToTakuStudio } from './publish-flow.mjs';
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

test('a legal gate at profile lookup keeps the draft and stops before Studio upload', async (t) => {
  const previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';
  t.after(() => {
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
  });
  const calls = [];
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    response.writeHead(428, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'REGISTRATION_REQUIRED' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const draft = { personaV2: { code: 'EILW' }, sections: [], stats: {} };
  const before = structuredClone(draft);
  const result = await saveDraftToTakuStudio({
    draft, privateInventory: { items: [] }, token: 'fixture-auth',
    workerUrl: `http://127.0.0.1:${server.address().port}`, siteUrl: 'http://127.0.0.1:3000',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'legal_review_required');
  assert.equal(result.needsAuth, false);
  assert.equal(result.review_url, 'http://127.0.0.1:3000/legal/accept');
  assert.deepEqual(draft, before);
  assert.deepEqual(calls, ['GET /stax/profile']);
});

test('regeneration keeps the published card identity, layout, and unlocked blocks while refreshing scan data', () => {
  const currentDraft = {
    status: 'published',
    revision: 8,
    lastPublishedRevision: 8,
    content: {
      schemaVersion: 'taku.stax.studio-draft.v1',
      card: {
        displayName: 'Ada',
        primaryAi: 'claude-code',
        qrTarget: 'stax',
        githubUrl: 'https://github.com/ada',
      },
      sections: [],
      studioLayout: {
        schemaVersion: 'taku.stax.studio-layout.v1',
        blocks: [
          { key: 'hero', cx: 0, cy: 0, cw: 4, ch: 2 },
          { key: 'seal', cx: 4, cy: 0, cw: 2, ch: 2 },
        ],
      },
      studioRenderer: {
        schemaVersion: 'taku.stax.studio-renderer.v1',
        renderer: 'publisher-stax-app',
        model: {
          handle: '@ada',
          cardHandle: '@ada',
          serial: 'Nº 000005',
          cardSerial: 'Nº 000005',
          selectedKeys: ['hero', 'seal'],
          team: 'CLAUDE',
          teamIcon: 'claude-code',
          teamOptions: [{ id: 'claude-code', selected: true }],
          qrTarget: 'stax',
          qrOptions: [{ id: 'stax', url: 'https://preview.example/stax/ada' }],
          publishedStax: {
            published: true,
            staxCardPageUrl: 'https://preview.example/stax/ada',
          },
          blocks: [
            { key: 'hero', status: 'supported', value: { title: 'Old persona' } },
            { key: 'seal', status: 'supported', value: { serial: 'Nº 000005' } },
            { key: 'team', status: 'supported', value: { team: 'CLAUDE' } },
            { key: 'social', status: 'supported', value: { github: 'ada' } },
          ],
        },
      },
    },
  };
  const incoming = {
    schemaVersion: 'taku.stax.studio-draft.v1',
    card: { displayName: 'Ada refreshed' },
    sections: [{ type: 'installed-tools', items: [{ name: 'New Tool' }] }],
    studioLayout: {
      schemaVersion: 'taku.stax.studio-layout.v1',
      blocks: [{ key: 'hero', cx: 2, cy: 2, cw: 4, ch: 2 }],
    },
    studioRenderer: {
      schemaVersion: 'taku.stax.studio-renderer.v1',
      renderer: 'publisher-stax-app',
      model: {
        handle: '@ada',
        cardHandle: 'SYNCING TAKU',
        serial: 'UNMINTED',
        cardSerial: 'UNMINTED',
        selectedKeys: ['hero'],
        blocks: [
          { key: 'hero', status: 'supported', value: { title: 'New persona' } },
          { key: 'seal', status: 'unsupported', display: 'LOCKED' },
          { key: 'team', status: 'supported', value: { team: 'CODEX' } },
          { key: 'social', status: 'unsupported', display: 'LOCKED' },
        ],
      },
    },
  };

  const merged = mergeRegeneratedStudioDraftContent(incoming, currentDraft);
  assert.equal(merged.card.displayName, 'Ada refreshed');
  assert.equal(merged.card.primaryAi, 'claude-code');
  assert.equal(merged.card.qrTarget, 'stax');
  assert.equal(merged.card.githubUrl, 'https://github.com/ada');
  assert.deepEqual(merged.sections, incoming.sections);
  assert.deepEqual(merged.studioLayout, currentDraft.content.studioLayout);
  assert.equal(merged.studioRenderer.model.cardHandle, '@ada');
  assert.equal(merged.studioRenderer.model.cardSerial, 'Nº 000005');
  assert.deepEqual(merged.studioRenderer.model.selectedKeys, ['hero', 'seal']);
  assert.deepEqual(
    merged.studioRenderer.model.blocks.find((block) => block.key === 'hero').value,
    { title: 'New persona' },
  );
  assert.deepEqual(
    merged.studioRenderer.model.blocks.find((block) => block.key === 'seal').value,
    { serial: 'Nº 000005' },
  );
  assert.deepEqual(
    merged.studioRenderer.model.blocks.find((block) => block.key === 'team').value,
    { team: 'CLAUDE' },
  );
  assert.deepEqual(
    merged.studioRenderer.model.blocks.find((block) => block.key === 'social').value,
    { github: 'ada' },
  );
});

test('editor regeneration fills an old layout and saves matching renderer selection', () => {
  const positions = {
    hero: [2, 1, 4, 2], type: [6, 1, 2, 2], seal: [0, 0, 2, 2],
    pie: [0, 2, 2, 2], modelcost: [2, 3, 2, 2], heat: [6, 3, 2, 2],
    team: [2, 0, 2, 1], bars90: [4, 0, 2, 1], basic: [6, 0, 1, 1],
    ctxring: [7, 0, 1, 1], trend: [0, 4, 1, 1],
  };
  const oldLayout = {
    schemaVersion: 'taku.stax.studio-layout.v1',
    blocks: Object.entries(positions).map(([key, [cx, cy, cw, ch]]) => ({ key, cx, cy, cw, ch })),
  };
  const incomingModel = {
    selectedKeys: [...Object.keys(positions), 'clock', 'tools'],
    blocks: [...Object.keys(positions), 'clock', 'tools'].map((key) => ({ key, status: 'supported' })),
  };
  incomingModel.blocks.push({ key: 'social', status: 'unsupported' });
  const currentDraft = { content: { studioLayout: oldLayout } };
  const incoming = { studioRenderer: { model: incomingModel } };
  const merged = mergeRegeneratedStudioDraftContent(incoming, currentDraft, { fillLayout: true });
  const cells = new Set();
  for (const block of merged.studioLayout.blocks) {
    assert.ok(block.cx >= 0 && block.cy >= 0 && block.cx + block.cw <= 8 && block.cy + block.ch <= 5);
    for (let x = block.cx; x < block.cx + block.cw; x += 1) {
      for (let y = block.cy; y < block.cy + block.ch; y += 1) {
        const cell = `${x},${y}`;
        assert.equal(cells.has(cell), false);
        cells.add(cell);
      }
    }
  }
  assert.equal(cells.size, 40);
  assert.equal(merged.studioLayout.blocks.length, 13);
  assert.deepEqual(merged.studioRenderer.model.studioLayout, merged.studioLayout);
  assert.deepEqual(merged.studioRenderer.model.selectedKeys, merged.studioLayout.blocks.map((block) => block.key));
  assert.ok(merged.studioRenderer.model.selectedKeys.includes('clock'));
  assert.ok(merged.studioRenderer.model.selectedKeys.includes('tools'));
  assert.ok(!merged.studioRenderer.model.selectedKeys.includes('social'));
  const cost = merged.studioLayout.blocks.find((block) => block.key === 'modelcost');
  assert.deepEqual([cost.cw, cost.ch], [1, 1]);
  assert.equal(oldLayout.blocks.find((block) => block.key === 'modelcost').cw, 2);
});

test('editor regeneration preserves an explicitly cleared card', () => {
  const emptyLayout = { schemaVersion: 'taku.stax.studio-layout.v1', blocks: [] };
  const incoming = {
    studioRenderer: {
      model: { selectedKeys: ['hero'], blocks: [{ key: 'hero', status: 'supported' }] },
    },
  };
  const merged = mergeRegeneratedStudioDraftContent(incoming, { content: { studioLayout: emptyLayout } }, { fillLayout: true });
  assert.deepEqual(merged.studioLayout, emptyLayout);
  assert.deepEqual(merged.studioRenderer.model.studioLayout, emptyLayout);
  assert.deepEqual(merged.studioRenderer.model.selectedKeys, []);
});

test('ordinary publication retains an empty layout and available saved components without filling', () => {
  const emptyLayout = { schemaVersion: 'taku.stax.studio-layout.v1', blocks: [] };
  const incoming = { studioRenderer: { model: { selectedKeys: ['hero'], blocks: [{ key: 'hero', status: 'supported' }] } } };
  const current = { content: { studioLayout: emptyLayout, studioRenderer: { model: { selectedKeys: ['hero'] } } } };
  const merged = mergeRegeneratedStudioDraftContent(incoming, current);
  assert.deepEqual(merged.studioRenderer.model.selectedKeys, []);
  assert.deepEqual(merged.studioRenderer.model.studioLayout, emptyLayout);
  const layout = { ...emptyLayout, blocks: [{ key: 'seal', cx: 0, cy: 0, cw: 2, ch: 2 }] };
  current.content.studioLayout = layout;
  current.content.studioRenderer.model.blocks = [{ key: 'seal', status: 'supported', value: { serial: 'Nº 000005' } }];
  const preserved = mergeRegeneratedStudioDraftContent(incoming, current);
  assert.deepEqual(preserved.studioLayout, layout);
  assert.deepEqual(preserved.studioRenderer.model.selectedKeys, ['seal']);
  assert.equal(preserved.studioRenderer.model.blocks.find(block => block.key === 'seal').value.serial, 'Nº 000005');
});

test('regeneration keeps a published handle when the fresh scan has no trusted profile', () => {
  const current = { status: 'published', content: { studioRenderer: { model: { handle: '@real-builder', cardHandle: '@real-builder', cardSerial: 'Nº 000005' } } } };
  const incoming = { studioRenderer: { model: { handle: '@builder', cardHandle: 'SIGNED IN DRAFT', cardSerial: 'UNMINTED' } } };
  const merged = mergeRegeneratedStudioDraftContent(incoming, current);
  assert.equal(merged.studioRenderer.model.handle, '@real-builder');
  assert.equal(merged.studioRenderer.model.cardHandle, '@real-builder');
  assert.equal(merged.studioRenderer.model.cardSerial, 'Nº 000005');
});
