import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadSitesCore } from '../dist/sites/core.js';
import { resolveSitesAuth, SitesHttpClient } from '../dist/sites/http.js';

test('quota paywalls preserve canonical HTTP/code/request ID, offer only a fixed Taku upgrade URL, and do not imply login or start checkout', async () => {
  for (const [status, code] of [[403, 'SITE_LIMIT_REACHED'], [409, 'SITE_STORAGE_LIMIT_REACHED']]) {
    const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => Response.json({ error: code,
      upgrade_url: 'https://evil.invalid/checkout' }, { status, headers: { 'X-Taku-Sites-Request-Id': `req_${'a'.repeat(32)}` } }));
    await assert.rejects(client.post('/v1/sites/publish-requests', {}), error => {
      assert.equal(error.code, 'sites_api_error');
      assert.equal(error.details.http_status, status);
      assert.equal(error.details.server_error, code);
      assert.equal(error.details.request_id, `req_${'a'.repeat(32)}`);
      assert.equal(error.details.upgrade_url, 'https://taku.ai/pricing');
      assert.equal(error.details.project_preserved, true);
      assert.match(error.message, /same.*project|project.*retained/i);
      assert.doesNotMatch(error.message, /sites-login|evil\.invalid/);
      return true;
    });
  }
  const unavailable = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => Response.json(
    { error: 'SITE_STORAGE_POLICY_UNAVAILABLE' }, { status: 503 }));
  await assert.rejects(unavailable.get('/v1/sites/assets/policy'), error => {
    assert.equal(error.details.upgrade_url, undefined);
    return true;
  });
});
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { savePublisherSession } from '../dist/auth.js';

test('bundled Sites core builds the pinned artifact without a Platform checkout', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-sites-core-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'dist/assets'), { recursive: true });
  await writeFile(path.join(root, 'dist/worker.mjs'), 'export default { fetch() { return new Response("ok") } };');
  await writeFile(path.join(root, 'dist/assets/index.html'), '<main>Site</main>');
  await writeFile(path.join(root, 'taku.site.json'), JSON.stringify({
    workerEntrypoint: 'dist/worker.mjs', assetsDirectory: 'dist/assets',
    siteManifest: { manifestVersion: 1, auth: { mode: 'none', scopes: [] }, integrations: [],
      storage: { type: 'turso', migrations: true }, egress: { mode: 'platform-proxy' } },
  }));
  const { core, provenance } = await loadSitesCore();
  assert.equal(provenance.contractVersion, 'taku.sites.cli.v1');
  const artifact = await core.buildArtifact(root, { projectId: 'prj_fixture_123', builtAt: '2026-09-24T00:00:00.000Z' });
  assert.match(artifact.contentDigest, /^[a-f0-9]{64}$/);
  assert.equal(artifact.objects.length, 2);
  await core.validateArtifact(root, artifact);
});

test('Sites auth accepts only the dedicated Publisher session, ignoring env and Desktop tokens', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-sites-auth-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, TAKU_PUBLISHER_HOME: root,
    TAKU_BEARER_TOKEN: 'desktop-env-fixture', TAKU_PUBLISH_TOKEN: 'legacy-env-fixture' };
  await assert.rejects(resolveSitesAuth(env), { code: 'sites_login_required' });
  await savePublisherSession({ accessToken: 'taku_pub_fixture', expiresAt: Date.now() + 600_000,
    intent: 'publish_tool', scopes: ['sites.read', 'sites.preview', 'sites.publish'] }, env);
  await assert.rejects(resolveSitesAuth(env), { code: 'sites_scope_required' });
  await savePublisherSession({ accessToken: 'taku_pub_fixture', expiresAt: Date.now() + 600_000,
    intent: 'publish_site', scopes: ['sites.read', 'sites.preview', 'sites.publish'] }, env);
  const auth = await resolveSitesAuth(env);
  assert.equal(auth.source, 'publisher_session');
  assert.equal(auth.intent, 'publish_site');
  assert.equal(auth.token, 'taku_pub_fixture');
});

test('material part renewal preserves bounded bytes/hash and never substitutes an upload credential', async t => {
  const seen = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    seen.push({ body: Buffer.concat(chunks), headers: request.headers, method: request.method });
    response.writeHead(seen.length === 1 ? 401 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(seen.length === 1 ? { error: 'expired' } : { ok: true }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = new SitesHttpClient(`http://127.0.0.1:${server.address().port}`, 'taku_pub_fixture_old', fetch, false,
    async expected => { assert.equal(expected, 'taku_pub_fixture_old'); return 'taku_pub_fixture_renewed'; });
  const part = Buffer.from('bounded-material');
  const base = '/v1/sites/prj_fixture_123/artifact-uploads/20000000-0000-4000-8000-000000000001/assets/0';
  assert.deepEqual(await client.putMaterialPart(`${base}/parts/1`, part), { ok: true });
  assert.equal(seen.length, 2);
  for (const [index, request] of seen.entries()) {
    assert.equal(request.method, 'PUT');
    assert.deepEqual(request.body, part);
    assert.equal(request.headers.authorization, index === 0 ? 'Bearer taku_pub_fixture_old' : 'Bearer taku_pub_fixture_renewed');
    assert.equal(request.headers['x-taku-asset-part-sha256'], createHash('sha256').update(part).digest('hex'));
  }
  await assert.rejects(client.putMaterialPart(`${base}/parts/1`, Buffer.alloc(0)), { code: 'sites_material_part_invalid' });
  await assert.rejects(client.putMaterialPart(`${base}/parts/1`, Buffer.alloc(8 * 1024 * 1024 + 1)), { code: 'sites_material_part_invalid' });
  assert.equal(seen.length, 2);
  await client.postEmpty(`${base}/complete`);
  assert.equal(seen[2].body.length, 0);
  assert.equal(seen[2].headers['content-type'], undefined);
  assert.equal(seen[2].headers.authorization, 'Bearer taku_pub_fixture_renewed');
});

test('404 diagnostics preserve request evidence without assuming an internal-only product', async () => {
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => Response.json(
    { error: 'SITE_NOT_FOUND' }, { status: 404, headers: { 'x-request-id': 'req_fixture_not_found' } },
  ));
  await assert.rejects(client.get('/v1/sites/prj_fixture'), error => {
    assert.equal(error.details.http_status, 404);
    assert.equal(error.details.request_id, 'req_fixture_not_found');
    assert.equal(error.details.server_error, 'SITE_NOT_FOUND');
    assert.doesNotMatch(error.message, /internal access/i);
    assert.match(error.message, /account access and the CLI version/i);
    return true;
  });
});

test('owner deletion has no body and never retries an ambiguous network or server failure', async () => {
  for (const status of [null, 503]) {
    let attempts = 0;
    const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async (_url, options) => {
      attempts++;
      assert.equal(options.method, 'DELETE');
      assert.equal(options.body, undefined);
      assert.equal(options.headers['Content-Type'], undefined);
      if (status === null) throw new Error('connection interrupted');
      return Response.json({ error: 'SITE_STORAGE_UNAVAILABLE' }, { status });
    });
    await assert.rejects(client.delete(`/v1/sites/assets/ast_${'a'.repeat(32)}`));
    assert.equal(attempts, 1);
  }
});
