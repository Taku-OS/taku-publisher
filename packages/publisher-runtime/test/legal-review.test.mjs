import assert from 'node:assert/strict';
import test from 'node:test';
import { legalReviewAction, publisherErrorOutput, TakuPublisherClient } from '../dist/index.js';

for (const code of ['REGISTRATION_REQUIRED', 'LEGAL_ACCEPTANCE_REQUIRED', 'PUBLISHER_LEGAL_REVIEW_REQUIRED']) {
  test(`${code} stops at a review handoff without accepting or retrying`, async () => {
    const calls = [];
    const token = 'fixture-private-credential';
    let blocked = true;
    const client = new TakuPublisherClient({
      token,
      transport: async (method, url, headers, body) => {
        calls.push({ method, url, body: JSON.parse(Buffer.from(body || '{}').toString()) });
        return { status: blocked ? 428 : 200, headers: {}, body: Buffer.from(JSON.stringify(blocked ? {
          error: code, documents: ['publisher', 'service', 'publisher', 'untrusted'],
          message: token, acceptancePath: `https://untrusted.invalid/?token=${token}`,
          reviewUrl: 'https://untrusted.invalid',
        } : { ok: true })) };
      },
    });
    let output;
    await assert.rejects(client.submitDraft('draft-123'), error => {
      assert.equal(error.code, 'legal_review_required');
      output = publisherErrorOutput(error);
      return true;
    });
    assert.equal(output.ok, false);
    assert.equal(output.requires_action, true);
    assert.equal(output.action_type, 'review_legal_terms');
    assert.equal(output.needsAuth, false);
    const url = new URL(output.review_url);
    assert.equal(url.origin, 'https://taku.ai');
    assert.equal(url.pathname, code === 'PUBLISHER_LEGAL_REVIEW_REQUIRED' ? '/publish/draft-123' : '/legal/accept');
    assert.equal(JSON.stringify(output).includes(token), false);
    assert.equal(JSON.stringify(output).includes('untrusted'), false);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, {});
    blocked = false;
    assert.deepEqual(await client.submitDraft('draft-123'), { ok: true });
    assert.equal(calls[1].url, calls[0].url);
    assert.deepEqual(calls[1].body, {});
    assert.ok(calls.every(call => !call.url.includes('/legal/accept')));
  });
}

test('non-legal errors retain the API error contract', async () => {
  for (const [status, error] of [[428, 'OTHER_PRECONDITION'], [401, 'LEGAL_ACCEPTANCE_REQUIRED'], [503, 'LEGAL_STATUS_UNAVAILABLE']]) {
    const client = new TakuPublisherClient({ token: 'fixture-auth', transport: async () => ({
      status, headers: {}, body: Buffer.from(JSON.stringify({ error })),
    }) });
    await assert.rejects(client.getDraft('draft-123'), failure => {
      const result = publisherErrorOutput(failure);
      assert.equal(result.status, 'error');
      assert.equal(result.requires_action, false);
      assert.equal(result.error.code, 'api_error');
      assert.equal(result.error.details.status, status);
      return true;
    });
  }
});

test('review links use only the configured site origin and allowlisted terms', () => {
  const action = legalReviewAction(428, {
    error: 'LEGAL_ACCEPTANCE_REQUIRED', documents: ['marketplace', 'service', 'service', '../redirect'],
    acceptancePath: '//untrusted.invalid',
  }, '/stax/items', 'http://127.0.0.1:3000/ignored?token=not-forwarded');
  assert.equal(action.review_url, 'http://127.0.0.1:3000/legal/accept?documents=service%2Cmarketplace');
  for (const url of ['javascript:alert(1)', 'https://user:secret@example.test', 'http://example.test']) {
    assert.throws(() => legalReviewAction(428, { error: 'REGISTRATION_REQUIRED' }, '', url));
  }
  assert.equal(legalReviewAction(428, '<html>error</html>'), null);
});

test('the packaged CLI emits an actionable JSON error and nonzero exit for a legal gate', async (t) => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(428, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'LEGAL_ACCEPTANCE_REQUIRED', documents: ['marketplace'] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const workerUrl = `http://127.0.0.1:${server.address().port}`;
  const child = spawn(process.execPath, ['scripts/taku-publisher.mjs', 'marketplace-search',
    '--query', 'fixture', '--worker-url', workerUrl, '--site-url', 'http://127.0.0.1:3000'], {
    cwd: new URL('../../../', import.meta.url),
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 1, stderr);
  const output = JSON.parse(stdout);
  assert.equal(output.requires_action, true);
  assert.equal(output.action_type, 'review_legal_terms');
  assert.equal(output.review_url, 'http://127.0.0.1:3000/legal/accept?documents=marketplace');
  assert.equal(requests.length, 1);
});

test('Creator Center returns the legal action on stdout without an authorization retry', async (t) => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(428, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'REGISTRATION_REQUIRED' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const child = spawn(process.execPath, ['scripts/taku-publisher.mjs', 'creator-center-list', '--json',
    '--worker-url', `http://127.0.0.1:${server.address().port}`, '--site-url', 'http://127.0.0.1:3000'], {
    cwd: new URL('../../../', import.meta.url),
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost',
      TAKU_BEARER_TOKEN: 'fixture-cli-auth', TAKU_PUBLISH_TOKEN: 'fixture-cli-auth', SUPABASE_ACCESS_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 1, stderr);
  const result = JSON.parse(stdout);
  assert.equal(result.status, 'legal_review_required');
  assert.equal(result.needsAuth, false);
  assert.equal(result.action_type, 'review_legal_terms');
  assert.equal(result.review_url, 'http://127.0.0.1:3000/legal/accept');
  assert.ok(requests.length > 0);
  assert.ok(requests.every(request => request.startsWith('GET /stax/')));
});
