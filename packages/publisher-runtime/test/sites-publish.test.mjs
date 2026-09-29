import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatch } from '../dist/cli.js';
import { savePublisherSession } from '../dist/auth.js';
import { loadSitesCore } from '../dist/sites/core.js';

function args(command, flags = {}) {
  return { command, flags: new Map(Object.entries(flags)), rest: [] };
}

test('non-TTY publish asks for the exact target, then resumes the same confirmed request and uploads with scoped token', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-sites-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = Object.fromEntries(['TAKU_PUBLISHER_HOME', 'TAKU_BEARER_TOKEN', 'TAKU_PUBLISH_TOKEN']
    .map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    TAKU_PUBLISHER_HOME: root,
    TAKU_BEARER_TOKEN: ['do-not-use-env', 'token'].join('-'),
    TAKU_PUBLISH_TOKEN: ['do-not-use-legacy', 'token'].join('-'),
  });
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  await savePublisherSession({ accessToken: 'taku_pub_test_site_session',
    expiresAt: Date.now() + 600_000, intent: 'publish_site',
    scopes: ['sites.read', 'sites.preview', 'sites.publish'] });
  const project = path.join(root, 'site');
  assert.equal((await dispatch(args('sites-init', { project }))).status, 'sites_project_created');
  const { core } = await loadSitesCore();
  const projectId = 'prj_publisher_123';
  const requestId = '10000000-0000-4000-8000-000000000001';
  const uploadId = '20000000-0000-4000-8000-000000000001';
  const uploadToken = `taku_su_${'a'.repeat(43)}`;
  const writes = [];
  const uploaded = new Set();
  let artifact;
  let finalized = false;
  let failFirstPut = true;
  const server = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    const bytes = Buffer.concat(body);
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const method = request.method;
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (method !== 'GET') writes.push({ method, pathname, authorization: request.headers.authorization });
    if (pathname.endsWith('/cli-session') && method === 'GET') return send(200, {
      userId: 'owner-1', source: 'publisher', scopes: ['sites.read', 'sites.preview', 'sites.publish'], productAccess: 'allowed',
    });
    if (pathname.endsWith('/publish-eligibility') && method === 'GET') return send(200, { eligible: true, available: 1 });
    if (pathname.endsWith('/slugs/chosen-site/availability') && method === 'GET') return send(200, {
      slug: 'chosen-site', hostname: 'chosen-site.taku.site', available: true,
    });
    if (pathname.endsWith('/slugs/taken-site/availability') && method === 'GET') return send(200, {
      slug: 'taken-site', hostname: 'taken-site.taku.site', available: false, reason: 'SLUG_TAKEN',
    });
    if (pathname.endsWith('/publish-requests') && method === 'POST') return send(201, {
      publishRequestId: requestId, status: 'confirmed',
    });
    if (pathname.endsWith(`/publish-requests/${requestId}`) && method === 'GET') return send(200, {
      publishRequestId: requestId, buildId: artifact.buildId,
      contentDigest: artifact.contentDigest, manifestDigest: artifact.manifestDigest,
      status: 'uploading', projectId,
    });
    if (pathname === '/v1/sites' && method === 'POST') return send(202, {
      projectId, slug: 'chosen-site', hostname: 'chosen-site.taku.site', status: 'provisioning',
    });
    if (pathname === `/v1/sites/${projectId}/artifact-uploads` && method === 'POST') {
      const envelope = JSON.parse(bytes.toString());
      artifact = await core.buildArtifact(project, { projectId, builtAt: envelope.descriptor.builtAt });
      assert.equal(envelope.contentDigest, artifact.contentDigest);
      return send(202, { uploadId, projectId, artifactDigest: artifact.artifactDigest,
        status: 'initiated', missingOrdinals: artifact.objects.map(object => object.ordinal) });
    }
    if (pathname.endsWith(`/${uploadId}/upload-credential`) && method === 'POST') {
      return send(201, { token: uploadToken, tokenType: 'Bearer', expiresAt: new Date(Date.now() + 900_000).toISOString() });
    }
    if (pathname.includes('/objects/') && method === 'PUT') {
      assert.equal(request.headers.authorization, `Bearer ${uploadToken}`);
      if (failFirstPut) { failFirstPut = false; return send(503, { error: 'temporary' }); }
      const ordinal = Number(pathname.split('/').at(-1));
      assert.equal(bytes.length, artifact.objects[ordinal].size);
      uploaded.add(ordinal);
      return send(200, { ordinal, status: 'uploaded' });
    }
    if (pathname.endsWith(`/${uploadId}`) && method === 'GET') return send(200, {
      uploadId, artifactDigest: artifact.artifactDigest, status: 'uploading',
      missingOrdinals: artifact.objects.map(object => object.ordinal).filter(ordinal => !uploaded.has(ordinal)),
    });
    if (pathname.endsWith(`/${uploadId}/finalize`) && method === 'POST') {
      finalized = true;
      return send(200, { uploadId, status: 'ready' });
    }
    if (pathname === `/v1/sites/${projectId}` && method === 'GET') return send(200, {
      projectId, hostname: 'chosen-site.taku.site', status: finalized ? 'active' : 'provisioning',
      currentReleaseId: finalized ? artifact.releaseId : null,
    });
    return send(404, { error: 'unexpected_route' });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const worker = `http://127.0.0.1:${server.address().port}`;
  const who = await dispatch(args('sites-whoami', { 'worker-url': worker }));
  assert.equal(who.status, 'sites_identity');
  assert.equal(who.identity.userId, 'owner-1');
  const flags = { project, slug: 'chosen-site', 'worker-url': worker, 'wait-seconds': '0' };
  await assert.rejects(dispatch(args('sites-publish', { ...flags, slug: 'taken-site' })), { code: 'sites_slug_unavailable' });
  assert.equal(writes.length, 0);
  const pending = await dispatch(args('sites-publish', flags));
  assert.equal(pending.status, 'needs_input');
  assert.equal(pending.confirm_target, 'chosen-site.taku.site');
  assert.equal(writes.length, 0);
  await assert.rejects(dispatch(args('sites-publish', { ...flags, 'confirm-target': 'chosen-site.taku.site' })), { code: 'sites_api_error' });
  const checkpointName = (await readdir(path.join(root, 'sites/checkpoints')))[0];
  const checkpointText = await readFile(path.join(root, 'sites/checkpoints', checkpointName), 'utf8');
  assert.equal(checkpointText.includes(uploadToken), false);
  assert.equal(checkpointText.includes('taku_pub_test_site_session'), false);
  const result = await dispatch(args('sites-publish', flags));
  assert.equal(result.status, 'sites_published');
  assert.equal(result.ready, true);
  assert.equal(result.url, 'https://chosen-site.taku.site');
  assert.equal(uploaded.size, artifact.objects.length);
  assert.equal(writes.filter(write => write.pathname.endsWith('/publish-requests')).length, 1);
  assert.ok(writes.filter(write => write.method === 'PUT').every(write => write.authorization === `Bearer ${uploadToken}`));
  assert.ok(writes.filter(write => write.method !== 'PUT').every(write => write.authorization === 'Bearer taku_pub_test_site_session'));
  assert.equal(JSON.stringify(result).includes(uploadToken), false);
  assert.equal(JSON.stringify(result).includes('taku_pub_test_site_session'), false);
});
