import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { publishDraftToTaku } from './publish-flow.mjs';

function jwtForUser(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId })).toString('base64url');
  return `header.${payload}.signature`;
}

function publishContext() {
  return {
    getCardSettings: () => ({
      name: 'Avatar Builder',
      showPersonaCode: true,
      showUsage: true,
      showCreatorPageLink: true,
      visibility: 'public',
    }),
    buildBuilderProfileSnapshot: () => ({
      schemaVersion: 'taku.creator.builder-profile-snapshot.v1',
      persona: { code: 'EILW', title: 'Mad Inventor' },
      card: { displayName: 'Avatar Builder' },
      privacy: { publicSummaryOnly: true },
    }),
  };
}

test('publishes the local Persona avatar that matches the scanned Persona code', async (t) => {
  const avatarDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-persona-avatars-'));
  const loopback = ['127', '0', '0', '1'].join('.');
  t.after(() => fs.rm(avatarDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(avatarDir, 'EILW.webp'), Buffer.from('fake-webp-avatar'));

  const calls = [];
  let importedPayload = null;
  const server = createServer(async (request, response) => {
    calls.push({ method: request.method, url: request.url });
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/stax/profile') {
      response.end(JSON.stringify({
        ok: true,
        data: {
          handle: '@avatar-builder',
          username: 'avatar-builder',
          displayName: 'Avatar Builder',
        },
      }));
      return;
    }
    if (request.method === 'POST' && request.url === '/profile/avatar/signed-upload') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body);
      assert.match(parsed.path, /^user-1\/persona-eilw-\d+-[-0-9a-f]+\.webp$/);
      response.end(JSON.stringify({
        signedUrl: `http://${loopback}:${server.address().port}/avatar-upload`,
        publicUrl: 'https://cdn.taku.ai/avatar/user-1/EILW.webp',
      }));
      return;
    }
    if (request.method === 'PUT' && request.url === '/avatar-upload') {
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers['content-type'], 'image/webp');
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString('utf8'), 'fake-webp-avatar');
      response.statusCode = 200;
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method === 'GET' && request.url === '/stax/cards/me') {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/stax/studio/cards/me') {
      response.end(JSON.stringify({
        ok: true,
        data: { saveContract: 'revision-v1', draft: null },
      }));
      return;
    }
    if (request.method === 'PUT' && request.url === '/stax/studio/cards/me') {
      response.end(JSON.stringify({ ok: true, data: { draft: { revision: 1 } } }));
      return;
    }
    if (request.method === 'POST' && request.url === '/stax/cards/import-inventory') {
      let body = '';
      for await (const chunk of request) body += chunk;
      importedPayload = JSON.parse(body);
      response.end(JSON.stringify({
        ok: true,
        data: {
          published: true,
          publicUrl: 'https://taku.ai/stax/avatar-builder',
          card: { id: 'card-1', username: 'avatar-builder' },
        },
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  await new Promise((resolve) => server.listen(0, loopback, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const previousAvatarDir = process.env.TAKU_PERSONA_AVATAR_DIR;
  const previousNoProxy = process.env.NO_PROXY;
  process.env.TAKU_PERSONA_AVATAR_DIR = avatarDir;
  process.env.NO_PROXY = '127.0.0.1,localhost';

  try {
    const result = await publishDraftToTaku({
      draft: {
        personaV2: { code: 'EILW' },
        sections: [],
        stats: {},
      },
      privateInventory: { items: [] },
      workerUrl: `http://${loopback}:${server.address().port}`,
      token: jwtForUser('user-1'),
      avatarUploadToken: jwtForUser('user-1'),
      siteUrl: 'https://taku.ai',
      context: publishContext(),
    });

    assert.equal(result.ok, true);
    assert.equal(importedPayload.card.avatarUrl, 'https://cdn.taku.ai/avatar/user-1/EILW.webp');
    assert.equal(importedPayload.profileSnapshot.card.avatarUrl, 'https://cdn.taku.ai/avatar/user-1/EILW.webp');
    assert.equal(result.publishedInventory.personaAvatarApplied, true);
    assert.equal(result.publishedInventory.personaAvatarCode, 'EILW');
    assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
      'GET /stax/profile',
      'POST /profile/avatar/signed-upload',
      'PUT /avatar-upload',
      'GET /stax/cards/me',
      'GET /stax/studio/cards/me',
      'PUT /stax/studio/cards/me',
      'POST /stax/cards/import-inventory',
    ]);
  } finally {
    if (previousAvatarDir === undefined) delete process.env.TAKU_PERSONA_AVATAR_DIR;
    else process.env.TAKU_PERSONA_AVATAR_DIR = previousAvatarDir;
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
  }
});

test('publishes Stax when a local Persona avatar exists but the publisher token cannot upload it', async (t) => {
  const avatarDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-persona-avatars-'));
  const loopback = ['127', '0', '0', '1'].join('.');
  t.after(() => fs.rm(avatarDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(avatarDir, 'EILW.webp'), Buffer.from('fake-webp-avatar'));

  const calls = [];
  let importedPayload = null;
  const server = createServer(async (request, response) => {
    calls.push({ method: request.method, url: request.url });
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/stax/profile') {
      response.end(JSON.stringify({
        ok: true,
        data: {
          handle: '@avatar-builder',
          username: 'avatar-builder',
          displayName: 'Avatar Builder',
        },
      }));
      return;
    }
    if (request.method === 'GET' && request.url === '/stax/cards/me') {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/stax/studio/cards/me') {
      response.end(JSON.stringify({
        ok: true,
        data: { saveContract: 'revision-v1', draft: null },
      }));
      return;
    }
    if (request.method === 'PUT' && request.url === '/stax/studio/cards/me') {
      response.end(JSON.stringify({ ok: true, data: { draft: { revision: 1 } } }));
      return;
    }
    if (request.method === 'POST' && request.url === '/stax/cards/import-inventory') {
      let body = '';
      for await (const chunk of request) body += chunk;
      importedPayload = JSON.parse(body);
      response.end(JSON.stringify({
        ok: true,
        data: {
          published: true,
          publicUrl: 'https://taku.ai/stax/avatar-builder',
          card: { id: 'card-1', username: 'avatar-builder' },
        },
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  await new Promise((resolve) => server.listen(0, loopback, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const previousAvatarDir = process.env.TAKU_PERSONA_AVATAR_DIR;
  const previousNoProxy = process.env.NO_PROXY;
  process.env.TAKU_PERSONA_AVATAR_DIR = avatarDir;
  process.env.NO_PROXY = '127.0.0.1,localhost';

  try {
    const result = await publishDraftToTaku({
      draft: {
        personaV2: { code: 'EILW' },
        sections: [],
        stats: {},
      },
      privateInventory: { items: [] },
      workerUrl: `http://${loopback}:${server.address().port}`,
      token: 'test-publisher-token',
      avatarUploadToken: 'test-publisher-token',
      siteUrl: 'https://taku.ai',
      context: publishContext(),
    });

    assert.equal(result.ok, true);
    assert.equal(importedPayload.card.avatarUrl, undefined);
    assert.equal(result.publishedInventory.personaAvatarApplied, false);
    assert.equal(result.publishedInventory.personaAvatarCode, 'EILW');
    assert.equal(result.publishedInventory.personaAvatarSkippedReason, 'avatar_upload_requires_user_session');
    assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
      'GET /stax/profile',
      'GET /stax/cards/me',
      'GET /stax/studio/cards/me',
      'PUT /stax/studio/cards/me',
      'POST /stax/cards/import-inventory',
    ]);
  } finally {
    if (previousAvatarDir === undefined) delete process.env.TAKU_PERSONA_AVATAR_DIR;
    else process.env.TAKU_PERSONA_AVATAR_DIR = previousAvatarDir;
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
  }
});
