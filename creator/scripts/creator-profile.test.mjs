import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  fetchTakuCreatorProfile,
  normalizeTakuCreatorProfile,
} from './creator-profile.mjs';
import { buildDraft } from './draft.mjs';

test('normalizes the signed-in account name and public avatar', async () => {
  const profile = await normalizeTakuCreatorProfile({
    data: {
      creator: {
        display_name: 'Taku Builder',
        avatar_url: 'https://cdn.example.test/avatar.png',
      },
    },
  });

  assert.deepEqual(profile, {
    displayName: 'Taku Builder',
    avatarUrl: 'https://cdn.example.test/avatar.png',
  });
});

test('uses JWT public metadata when the creator endpoint omits profile fields', async () => {
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-1',
    user_metadata: {
      full_name: 'JWT Builder',
      avatar_url: 'https://cdn.example.test/jwt-avatar.png',
    },
  })).toString('base64url');
  const token = `header.${payload}.signature`;
  const previousUrl = process.env.TAKU_SUPABASE_URL;
  process.env.TAKU_SUPABASE_URL = 'not-a-url';
  try {
    const profile = await normalizeTakuCreatorProfile({}, token);
    assert.deepEqual(profile, {
      displayName: 'JWT Builder',
      avatarUrl: 'https://cdn.example.test/jwt-avatar.png',
    });
  } finally {
    if (previousUrl === undefined) delete process.env.TAKU_SUPABASE_URL;
    else process.env.TAKU_SUPABASE_URL = previousUrl;
  }
});

test('keeps a public provider avatar from the signed-in Taku account', async () => {
  const profile = await normalizeTakuCreatorProfile({
    profile: {
      displayName: 'Provider Builder',
      avatarUrl: 'https://lh3.googleusercontent.com/a/public-avatar',
    },
  });

  assert.equal(profile.avatarUrl, 'https://lh3.googleusercontent.com/a/public-avatar');
});

test('falls back to email when the signed-in account has no display name', async () => {
  const profile = await normalizeTakuCreatorProfile({
    profile: {
      email: 'builder@example.test',
    },
  });

  assert.equal(profile.displayName, 'builder@example.test');
});

test('reads signed-in Stax identity from the Stax profile endpoint', async () => {
  const calls = [];
  const server = createServer((request, response) => {
    calls.push({
      url: request.url,
      authorization: request.headers.authorization,
    });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      ok: true,
      data: {
        handle: 'alice',
        username: 'alice',
        serialNumber: 'TAKU-000417',
        serial: { display: 'No. 000417' },
      },
    }));
  });
  const loopback = ['127', '0', '0', '1'].join('.');
  await new Promise((resolve) => server.listen(0, loopback, resolve));
  const workerUrl = `http://${loopback}:${server.address().port}`;
  const previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';

  try {
    const result = await fetchTakuCreatorProfile({
      workerUrl,
      token: 'test-token',
    });

    assert.equal(result.ok, true);
    assert.equal(result.endpoint, `${workerUrl}/stax/profile`);
    assert.equal(result.profile.displayName, 'alice');
    assert.deepEqual(result.staxProfile, {
      handle: 'alice',
      username: 'alice',
      serialNumber: 'TAKU-000417',
      serial: { display: 'No. 000417' },
    });
    assert.deepEqual(calls, [{
      url: '/stax/profile',
      authorization: 'Bearer test-token',
    }]);
  } finally {
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('retries the Stax profile after creating the creator profile fallback', async () => {
  const calls = [];
  let staxProfileCalls = 0;
  const server = createServer((request, response) => {
    calls.push(request.url);
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/stax/profile') {
      staxProfileCalls += 1;
      if (staxProfileCalls === 1) {
        response.statusCode = 404;
        response.end(JSON.stringify({
          error: 'Creator profile not found. Call GET /stax/creators/me first.',
        }));
        return;
      }
      response.end(JSON.stringify({
        ok: true,
        data: {
          handle: '@retry-builder',
          username: 'retry-builder',
          serialNumber: 'TAKU-000512',
          serial: 'Nº 000512',
        },
      }));
      return;
    }
    response.statusCode = 201;
    response.end(JSON.stringify({
      data: {
        username: 'retry-builder',
        displayName: 'Retry Builder',
      },
    }));
  });
  const loopback = ['127', '0', '0', '1'].join('.');
  await new Promise((resolve) => server.listen(0, loopback, resolve));
  const workerUrl = `http://${loopback}:${server.address().port}`;
  const previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';

  try {
    const result = await fetchTakuCreatorProfile({
      workerUrl,
      token: 'test-token',
    });

    assert.equal(result.ok, true);
    assert.equal(result.endpoint, `${workerUrl}/stax/profile`);
    assert.equal(result.fallbackEndpoint, `${workerUrl}/stax/creators/me`);
    assert.deepEqual(result.staxProfile, {
      handle: '@retry-builder',
      username: 'retry-builder',
      serialNumber: 'TAKU-000512',
      serial: 'Nº 000512',
    });
    assert.deepEqual(calls, [
      '/stax/profile',
      '/stax/creators/me',
      '/stax/profile',
    ]);
  } finally {
    if (previousNoProxy === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = previousNoProxy;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('stores the account profile in the draft and builder profile snapshot', () => {
  const draft = buildDraft({
    privacy: {},
    creatorProfile: {
      displayName: 'Saved Builder',
      avatarUrl: 'https://cdn.example.test/saved.png',
    },
    staxProfile: {
      handle: 'saved',
      serialNumber: 'TAKU-000417',
      serial: { display: 'No. 000417' },
    },
    summary: {},
    ownedCreations: [],
    personaSignals: {},
    personaV2: {},
  }, {
    displayedTools: [],
    hiddenTools: [{ id: 'scanned-tool', name: 'Scanned Tool', type: 'skill', source: 'codex' }],
    availableTools: [{ id: 'scanned-tool', name: 'Scanned Tool', type: 'skill', source: 'codex' }],
    mode: 'default-none',
  }, {
    usedCreations: [],
    madeCreations: [],
    remixedCreations: [],
    confirmedCreations: [],
    hiddenCreations: [],
    creationRoles: {},
    mode: 'unconfirmed',
    displayLimit: 0,
  });

  assert.equal(draft.creator.name, 'Saved Builder');
  assert.equal(draft.creator.avatarUrl, 'https://cdn.example.test/saved.png');
  assert.equal(draft.card.avatarUrl, 'https://cdn.example.test/saved.png');
  assert.equal(draft.builderProfileSnapshot.card.displayName, 'Saved Builder');
  assert.equal(draft.builderProfileSnapshot.card.avatarUrl, 'https://cdn.example.test/saved.png');
  assert.equal(
    draft.sections.find((section) => section.id === 'creator-tools')?.items[0]?.selected,
    false,
  );
  assert.equal(
    draft.builderProfileSnapshot.persona.description,
    'Start creating first. Let your activity define you over time.',
  );
  assert.deepEqual(draft.staxProfile, {
    handle: 'saved',
    serialNumber: 'TAKU-000417',
    serial: { display: 'No. 000417' },
  });
});
