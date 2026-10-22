import test from 'node:test';
import { get } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSitesCore } from '../dist/sites/core.js';
import { startSitePreview } from '../dist/sites/preview.js';
import { SitesHttpClient } from '../dist/sites/http.js';

test('Publisher authority reaches only the two existing owner preview endpoints', async () => {
  const calls = [];
  const client = new SitesHttpClient('https://worker.fixture.invalid', 'taku_pub_fixture', async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers) }); return Response.json({});
  }, true);
  await client.post('/v1/sites-preview/sessions', {});
  await client.post('/v1/sites-preview/auth/start', {});
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer taku_pub_fixture');
  for (const endpoint of ['/v1/sites-preview/auth/exchange', '/v1/sites-preview/integrations/text/generate', '/v1/sites-preview/session'])
    await assert.rejects(client.post(endpoint, {}), error => error.code === 'sites_invalid_api_path');
  assert.equal(calls.length, 2);
});

test('private preview runs real workerd, blocks egress, binds PKCE and keeps credentials outside the Site', async t => {
  const project = await mkdtemp(path.join(tmpdir(), 'publisher-preview-test-'));
  t.after(() => rm(project, { recursive: true, force: true }));
  await mkdir(path.join(project, 'dist/assets'), { recursive: true });
  const manifest = { manifestVersion: 1, auth: { mode: 'required', scopes: ['text.generate'] },
    integrations: [{ name: 'text', operations: ['generate'], scopes: ['text.generate'] }],
    storage: { type: 'turso', migrations: false }, egress: { mode: 'platform-proxy' } };
  await writeFile(path.join(project, 'taku.site.json'), JSON.stringify({ workerEntrypoint: 'dist/worker.mjs', assetsDirectory: 'dist/assets', siteManifest: manifest }));
  await writeFile(path.join(project, 'dist/assets/index.html'), '<!doctype html><title>Preview fixture</title>');
  await writeFile(path.join(project, 'dist/worker.mjs'), `export default { async fetch(r,e) {
    if (new URL(r.url).pathname === '/probe') return fetch('http://127.0.0.1:1/__taku/session');
    const asset = await e.ASSETS.fetch(r); const response = new Response(asset.body, asset); response.headers.append('Set-Cookie','tenant=forged'); return response;
  } };`);
  const { core } = await loadSitesCore();
  const artifact = await core.buildArtifact(project, { projectId: 'prj_pending_cli', builtAt: new Date().toISOString() });
  await core.validateArtifact(project, artifact);
  const posts = []; const requests = [];
  const client = { workerUrl: 'https://worker.fixture.invalid', async post(endpoint, body) {
    posts.push({ endpoint, body });
    if (endpoint.endsWith('/sessions')) return { previewId: `pv1_${'a'.repeat(43)}`, expiresAt: Date.now() + 600_000 };
    if (endpoint.endsWith('/auth/start')) return { authorizeUrl: 'https://taku.ai/auth/sites?preview=1&request=fixture' };
    throw new Error('unexpected owner call');
  } };
  const preview = await startSitePreview({ core, artifact, client, fetcher: async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    if (String(url).endsWith('/auth/exchange')) return Response.json({ capability: `pc1_${'b'.repeat(43)}` });
    if (String(url).endsWith('/session')) return Response.json({ authenticated: true, mode: 'preview', siteUserId: 'preview-subject', scopes: ['text.generate'] });
    if (String(url).includes('/integrations/text/generate')) return Response.json({ error: 'insufficient_credits' }, { status: 402 });
    if (String(url).endsWith('/auth/revoke')) return new Response(null, { status: 204 });
    throw new Error('unexpected capability call');
  } });
  t.after(preview.stop);
  assert.equal(new URL(preview.url).hostname, '127.0.0.1');
  assert.equal((await fetch(preview.url + '/__taku/session')).status, 401);
  const page = await fetch(preview.url); assert.equal(page.status, 200);
  const cookie = page.headers.get('set-cookie').split(';')[0]; assert.match(cookie, /^taku_preview_local=/);
  assert.equal(cookie.includes('tenant'), false); assert.match(await page.text(), /Preview fixture/);
  assert.equal((await fetch(preview.url + '/probe')).status, 403);
  assert.equal(await new Promise((resolve, reject) => { get(preview.url, { headers: { Host: 'foreign.invalid' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); }), 403);
  const headers = { Cookie: cookie, Origin: preview.url, 'X-Taku-CSRF': '1', 'Content-Type': 'application/json' };
  const start = body => fetch(preview.url + '/__taku/auth/start', { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await start({ scopes: ['ungranted'] })).status, 400);
  assert.equal((await fetch(preview.url + '/__taku/auth/start', { method: 'POST', headers: { ...headers, Origin: 'https://evil.invalid' }, body: '{}' })).status, 403);
  assert.equal((await start({ scopes: ['text.generate'], returnPath: '/' })).status, 200);
  const auth = posts.find(item => item.endpoint.endsWith('/auth/start')).body;
  assert.match(auth.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await fetch(preview.url + '/__taku/auth/callback?state=wrong&code=' + 'c'.repeat(43))).status, 400);
  const callback = preview.url + '/__taku/auth/callback?state=' + auth.state + '&code=' + 'c'.repeat(43);
  assert.equal((await fetch(callback, { redirect: 'manual' })).status, 303);
  assert.equal((await fetch(callback, { redirect: 'manual' })).status, 400);
  const session = await fetch(preview.url + '/__taku/session', { headers });
  assert.equal((await session.json()).authenticated, true);
  const generated = await fetch(preview.url + '/__taku/integrations/text/generate', { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'text-request-00000001' }, body: JSON.stringify({ prompt: 'topic' }) });
  assert.equal(generated.status, 402);
  assert.equal(requests.filter(item => item.url.includes('/integrations/text/')).length, 1);
  assert.equal(requests.find(item => item.url.endsWith('/auth/exchange')).headers.has('Authorization'), false);
  assert.equal(requests.find(item => item.url.endsWith('/session')).headers.get('Authorization'), `Bearer pc1_${'b'.repeat(43)}`);
  assert.equal((await fetch(preview.url + '/__taku/storage/personal/projects', { headers })).status, 503);
  await preview.stop();
  assert.ok(requests.some(item => item.url.endsWith('/auth/revoke')));
});
