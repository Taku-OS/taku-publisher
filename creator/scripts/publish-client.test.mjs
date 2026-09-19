import assert from 'node:assert/strict';
import test from 'node:test';

import { TakuStaxClient } from './publish-client.mjs';

test('follows a same-origin 308 without dropping the POST body or authorization', async () => {
  const calls = [];
  const client = new TakuStaxClient({
    workerUrl: 'https://worker.taku.ai',
    token: 'test-token',
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        method: init.method,
        body: init.body,
        authorization: init.headers.get('authorization'),
      });
      if (calls.length === 1) {
        return new Response(null, {
          status: 308,
          headers: { location: '/marketplace/icons/generate' },
        });
      }
      return Response.json({ ok: true, iconUrl: 'https://cdn.taku.ai/icon.png' });
    },
  });

  const result = await client.fetchJson('/community/icons/generate', {
    method: 'POST',
    body: JSON.stringify({ title: 'Test tool' }),
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.data.ok, true);
  assert.deepEqual(calls.map((call) => call.url), [
    'https://worker.taku.ai/community/icons/generate',
    'https://worker.taku.ai/marketplace/icons/generate',
  ]);
  assert.ok(calls.every((call) => call.method === 'POST'));
  assert.ok(calls.every((call) => call.body === JSON.stringify({ title: 'Test tool' })));
  assert.ok(calls.every((call) => call.authorization === 'Bearer test-token'));
});

test('does not forward authorization across origins on a redirect', async () => {
  let callCount = 0;
  const client = new TakuStaxClient({
    workerUrl: 'https://worker.taku.ai',
    token: 'test-token',
    fetchImpl: async () => {
      callCount += 1;
      return new Response(null, {
        status: 308,
        headers: { location: 'https://unexpected.example/icons/generate' },
      });
    },
  });

  const result = await client.fetchJson('/community/icons/generate', {
    method: 'POST',
    body: '{}',
  });

  assert.equal(result.response.status, 308);
  assert.equal(callCount, 1);
});

test('reads the signed-in Stax profile through the shared client', async () => {
  const calls = [];
  const client = new TakuStaxClient({
    workerUrl: 'https://worker.taku.ai',
    token: 'test-token',
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        method: init.method,
        authorization: init.headers.get('authorization'),
      });
      return Response.json({
        ok: true,
        data: {
          handle: 'alice',
          serialNumber: 'TAKU-000417',
        },
      });
    },
  });

  const result = await client.getMyStaxProfile();

  assert.equal(result.data.handle, 'alice');
  assert.deepEqual(calls, [{
    url: 'https://worker.taku.ai/stax/profile',
    method: 'GET',
    authorization: 'Bearer test-token',
  }]);
});

test('both Creator client request paths expose legal review without reauth or writes', async () => {
  for (const method of ['fetchJson', 'requestJson']) {
    const calls = [];
    const client = new TakuStaxClient({
      workerUrl: 'https://worker.taku.ai', siteUrl: 'http://127.0.0.1:3000', token: 'fixture-auth',
      fetchImpl: async (url, init) => {
        calls.push({ url, method: init.method });
        return Response.json({ error: 'LEGAL_ACCEPTANCE_REQUIRED', documents: ['service', 'publisher'] }, { status: 428 });
      },
    });
    await assert.rejects(client[method]('/stax/studio/cards/me', { method: 'GET' }), error => {
      assert.equal(error.status, 428);
      assert.equal(error.legalAction.requires_action, true);
      assert.equal(error.legalAction.needsAuth, false);
      assert.equal(new URL(error.legalAction.review_url).origin, 'http://127.0.0.1:3000');
      return true;
    });
    assert.deepEqual(calls, [{ url: 'https://worker.taku.ai/stax/studio/cards/me', method: 'GET' }]);
  }
});
