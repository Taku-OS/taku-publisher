import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadSitesCore } from '../dist/sites/core.js';
import { resolveSitesAuth } from '../dist/sites/http.js';
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
