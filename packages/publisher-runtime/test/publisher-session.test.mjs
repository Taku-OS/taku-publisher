import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import * as auth from '../dist/auth.js';
import { resolveSitesAuth, SitesHttpClient } from '../dist/sites/http.js';

const scopes = ['sites.read', 'sites.preview', 'sites.publish'];
const sessionId = '73000000-0000-4000-8000-000000000001';
const refreshExpiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
const oldRefresh = `taku_refresh_${sessionId}_${'a'.repeat(64)}`;
const newRefresh = `taku_refresh_${sessionId}_${'b'.repeat(64)}`;
const response = (overrides = {}) => ({ status: 200, body: Buffer.from(JSON.stringify({
  token: 'taku_pub_next_fixture', expiresIn: 3600, usesRemaining: 256, scopes,
  sessionId, refreshToken: newRefresh, refreshExpiresAt, ...overrides,
})) });

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-refresh-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, TAKU_PUBLISHER_HOME: root, TAKU_BEARER_TOKEN: '', TAKU_PUBLISH_TOKEN: '' };
  await auth.savePublisherSession({ accessToken: 'taku_pub_old_fixture', expiresAt: Date.now() - 1000,
    intent: 'publish_site', scopes, sessionId, refreshToken: oldRefresh, refreshExpiresAt,
    workerUrl: 'https://worker.taku.ai', createdAt: 123, ...overrides }, env);
  return { env, file: auth.publisherSessionPath(env) };
}

test('expired Publisher sessions refresh once under concurrent commands and remain private on disk', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const transport = async (url, headers, body) => {
    calls++;
    assert.equal(url, 'https://worker.taku.ai/marketplace/local-auth/refresh');
    assert.equal(headers.Authorization, undefined);
    const request = JSON.parse(Buffer.from(body).toString());
    assert.equal(request.refreshToken, oldRefresh);
    assert.match(request.refreshRequestId, /^[a-f0-9-]{36}$/);
    await new Promise(resolve => setTimeout(resolve, 30));
    return response();
  };
  const results = await Promise.all(Array.from({ length: 4 }, () => auth.resolveAuth({
    env: f.env, allowDesktopSession: false, transport,
  })));
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.token === 'taku_pub_next_fixture'));
  const saved = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(saved.refreshToken, newRefresh);
  assert.equal(saved.refreshExpiresAt, refreshExpiresAt);
  assert.equal(saved.createdAt, 123);
  assert.equal((await stat(f.file)).mode & 0o777, 0o600);
  const status = await auth.authStatus({ env: f.env });
  assert.equal(status.can_refresh, true);
  assert.ok(!JSON.stringify(status).includes(newRefresh));
});

test('a lost refresh response persists its request ID and safely recovers on the next command', async (t) => {
  const f = await fixture(t);
  const requests = [];
  const transport = async (_url, _headers, body) => {
    requests.push(JSON.parse(Buffer.from(body).toString()));
    if (requests.length === 1) throw new Error('fixture connection lost after server rotation');
    return response();
  };
  await assert.rejects(auth.resolveAuth({ env: f.env, allowDesktopSession: false, transport }), { code: 'publisher_refresh_unavailable' });
  const pending = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(pending.refreshToken, oldRefresh);
  assert.equal(pending.refreshRequestId, requests[0].refreshRequestId);
  const result = await auth.resolveAuth({ env: f.env, allowDesktopSession: false, transport });
  assert.equal(result.token, 'taku_pub_next_fixture');
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).refreshRequestId, undefined);
});

test('exhausted access refreshes even before its time limit, without using Desktop or env auth', async (t) => {
  const f = await fixture(t, { expiresAt: Date.now() + 600_000, usesRemaining: 0 });
  f.env.TAKU_BEARER_TOKEN = `fixture-desktop-${randomUUID()}`;
  let calls = 0;
  const result = await resolveSitesAuth(f.env, { transport: async () => { calls++; return response(); } });
  assert.equal(result.token, 'taku_pub_next_fixture');
  assert.equal(calls, 1);
});

test('renewal failures preserve server status/code and never fall back to Desktop authentication', async (t) => {
  const f = await fixture(t);
  await assert.rejects(auth.resolveAuth({ env: f.env, allowDesktopSession: false,
    transport: async () => ({ status: 503,
      body: Buffer.from('{"code":"PUBLISHER_IDENTITY_UNAVAILABLE","requestId":"req_fixture"}') }),
  }), error => error.code === 'publisher_refresh_unavailable' && error.details.http_status === 503
    && error.details.server_error === 'PUBLISHER_IDENTITY_UNAVAILABLE' && error.details.request_id === 'req_fixture');
});

test('three real CLI processes share one rotation through the on-disk lock', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const server = createServer((request, res) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      calls++;
      assert.equal(request.url, '/marketplace/local-auth/refresh');
      assert.equal(JSON.parse(Buffer.concat(chunks)).refreshToken, oldRefresh);
      setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(response().body); }, 30);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const workerUrl = `http://127.0.0.1:${server.address().port}`;
  await auth.savePublisherSession({ ...JSON.parse(await readFile(f.file, 'utf8')), workerUrl }, f.env);
  const moduleUrl = new URL('../dist/auth.js', import.meta.url).href;
  const code = `const {resolveAuth} = await import(${JSON.stringify(moduleUrl)});
    const result = await resolveAuth({allowDesktopSession:false});
    if (result.token !== 'taku_pub_next_fixture') process.exit(1);
    process.stdout.write(JSON.stringify({source:result.source}));`;
  const results = await Promise.all(Array.from({ length: 3 }, () => promisify(execFile)(process.execPath,
    ['--input-type=module', '-e', code], { env: f.env, timeout: 10_000 })));
  assert.equal(calls, 1);
  assert.ok(results.every(result => JSON.parse(result.stdout).source === 'publisher_session'));
});

test('a stale 401 cannot rotate credentials another command already renewed', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const transport = async () => { calls++; return response(); };
  const next = await auth.resolveAuth({ env: f.env, allowDesktopSession: false, transport });
  const concurrent = await resolveSitesAuth(f.env, { force: true, expectedAccessToken: 'taku_pub_old_fixture', transport });
  assert.equal(concurrent.token, next.token);
  assert.equal(calls, 1);
});

test('logout clears the local credential but reports when remote revocation is unverified', async (t) => {
  const f = await fixture(t);
  const result = await auth.revokePublisherSession(f.env, { transport: async () => { throw new Error('fixture network down'); } });
  assert.deepEqual(result, { removed: true, revoked: false, revocation_error_code: 'publisher_refresh_unavailable' });
  await assert.rejects(stat(f.file), { code: 'ENOENT' });
});

test('refresh credentials never go to a changed or unapproved Worker origin', async (t) => {
  const f = await fixture(t, { workerUrl: 'https://unapproved.example' });
  let calls = 0;
  await assert.rejects(auth.resolveAuth({ env: f.env, allowDesktopSession: false,
    transport: async () => { calls++; return response(); },
  }), { code: 'custom_worker_not_allowed' });
  assert.equal(calls, 0);
  await auth.savePublisherSession({ ...JSON.parse(await readFile(f.file, 'utf8')), workerUrl: 'https://worker.taku.ai' }, f.env);
  await assert.rejects(resolveSitesAuth(f.env, { workerUrl: 'https://other.example', allowCustomWorkerUrl: true,
    transport: async () => { calls++; return response(); },
  }), { code: 'publisher_session_origin_mismatch' });
  assert.equal(calls, 0);
});

test('a widened scope or changed family expiry is not saved', async (t) => {
  const f = await fixture(t);
  for (const bad of [{ scopes: [...scopes, 'creator.items.write'] },
    { refreshExpiresAt: new Date(Date.now() + 31 * 86400_000).toISOString() }, { sessionId: 'other' }]) {
    await assert.rejects(auth.resolveAuth({ env: f.env, allowDesktopSession: false, transport: async () => response(bad) }),
      { code: 'publisher_refresh_invalid_response' });
    assert.equal(JSON.parse(await readFile(f.file, 'utf8')).refreshToken, oldRefresh);
  }
});

test('older expired sessions without refresh credentials request login, without attempting a refresh', async (t) => {
  const f = await fixture(t, { refreshToken: undefined });
  let calls = 0;
  await assert.rejects(resolveSitesAuth(f.env, { transport: async () => { calls++; return response(); } }), { code: 'sites_login_required' });
  assert.equal(calls, 0);
});

test('logout revokes the remote family before removing the local session', async (t) => {
  const f = await fixture(t);
  assert.equal(typeof auth.revokePublisherSession, 'function');
  const result = await auth.revokePublisherSession(f.env, { transport: async (url, _headers, body) => {
    assert.equal(url, 'https://worker.taku.ai/marketplace/local-auth/revoke');
    assert.equal(JSON.parse(Buffer.from(body).toString()).refreshToken, oldRefresh);
    assert.ok(await stat(f.file));
    return { status: 200, body: Buffer.from('{"ok":true}') };
  } });
  assert.deepEqual(result, { removed: true, revoked: true });
  await assert.rejects(stat(f.file), { code: 'ENOENT' });
});

test('a 401 refreshes and replays one POST with exactly the same body and idempotency key', async () => {
  const requests = [];
  let renewals = 0;
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_old', async (_url, options) => {
    requests.push(options);
    return requests.length === 1 ? new Response('{"error":"Unauthorized"}', { status: 401 }) : Response.json({ ok: true });
  }, false, async old => { renewals++; assert.equal(old, 'taku_pub_old'); return 'taku_pub_next'; });
  assert.deepEqual(await client.post('/v1/sites/publish-requests', { buildId: 'build_same' }, 'same-idempotency'), { ok: true });
  assert.equal(renewals, 1);
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  assert.deepEqual(requests[0].body, requests[1].body);
  assert.equal(requests[1].headers.Authorization, 'Bearer taku_pub_next');
});

test('persistent 401 stops after one renewal; 403/404/500 and upload credentials never renew', async () => {
  for (const status of [401, 403, 404, 500]) {
    let renewals = 0;
    let requests = 0;
    const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_old', async () => {
      requests++; return new Response('{}', { status });
    }, false, async () => { renewals++; return 'taku_pub_next'; });
    await assert.rejects(client.get('/v1/sites'), { code: 'sites_api_error' });
    assert.equal(renewals, status === 401 ? 1 : 0);
    assert.equal(requests, status === 401 ? 2 : 1);
  }
  let renewals = 0;
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_old', async () => new Response('{}', { status: 401 }),
    false, async () => { renewals++; return 'taku_pub_next'; });
  await assert.rejects(client.putObject('/v1/sites/prj_fixture/artifact-uploads/fixture/objects/0', Buffer.from('bytes'), 'taku_su_fixture'));
  assert.equal(renewals, 0);
});

test('plain or HTML errors preserve status/request ID and bounded sanitized context', async () => {
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_secret_fixture', async () => new Response(
    '<html><title>Request Header Fields Too Large</title><body>Bearer taku_pub_secret_fixture</body></html>',
    { status: 431, headers: { 'x-request-id': 'req_header_fixture', 'content-type': 'text/html' } },
  ));
  await assert.rejects(client.get('/v1/sites'), error => {
    assert.equal(error.details.http_status, 431);
    assert.equal(error.details.request_id, 'req_header_fixture');
    assert.match(error.details.response_summary, /Request Header Fields Too Large/);
    assert.ok(error.details.response_summary.length <= 512);
    assert.ok(!JSON.stringify(error.details).includes('taku_pub_secret_fixture'));
    return true;
  });
});
