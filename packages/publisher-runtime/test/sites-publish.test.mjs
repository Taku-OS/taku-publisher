import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatch } from '../dist/cli.js';
import { savePublisherSession } from '../dist/auth.js';
import { loadSitesCore } from '../dist/sites/core.js';
import { sortJson } from '../dist/util.js';

function args(command, flags = {}) {
  return { command, flags: new Map(Object.entries(flags)), rest: [] };
}

for (const scenario of ['legacy', 'permanent', 'temporary', 'reuse', 'mismatch']) test(`non-TTY ${scenario} publish preserves confirmation and verifies separate material receipts`, async (t) => {
  const withMaterials = scenario !== 'legacy';
  const retention = scenario === 'temporary' ? 'temporary' : 'permanent';
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
  if (withMaterials) {
    const sourcePath = 'dist/assets/hero.mp4';
    const source = path.join(project, sourcePath);
    await writeFile(source, Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]));
    await truncate(source, 8 * 1024 * 1024 + 24);
    const bytes = await readFile(source);
    await writeFile(path.join(project, 'taku.assets.json'), JSON.stringify({ schema: 'taku.sites.asset-manifest.v1', files: [{
      logicalPath: '/media/hero.mp4', sourcePath, contentType: 'video/mp4', size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), retention, visibility: 'public',
    }] }));
  }
  const { core } = await loadSitesCore();
  const projectId = 'prj_publisher_123';
  const requestId = '10000000-0000-4000-8000-000000000001';
  const uploadId = '20000000-0000-4000-8000-000000000001';
  const uploadToken = `taku_su_${'a'.repeat(43)}`;
  const writes = [];
  const uploaded = new Set();
  let artifact;
  let publishSelection;
  let finalized = false;
  let failFirstPut = true;
  const materialParts = new Map();
  let materialReady = scenario === 'reuse';
  let failLastMaterialPart = withMaterials && !materialReady;
  const materialReceipt = () => ({ assetId: `ast_${'b'.repeat(32)}`, state: materialReady ? 'ready' : 'uploading',
    retention, visibility: 'public', contentType: 'video/mp4', byteLength: 8 * 1024 * 1024 + 24,
    sha256: scenario === 'mismatch' ? '0'.repeat(64) : artifact?.descriptor.assetManifest?.files[0].sha256,
    expiresAt: retention === 'temporary' ? new Date(Date.now() + 2592000_000).toISOString() : null,
    createdAt: '2026-10-05T12:00:00Z', partBytes: 8 * 1024 * 1024, partCount: 2 });
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
    if (pathname.endsWith('/publish-requests') && method === 'POST') {
      publishSelection = JSON.parse(bytes.toString());
      return send(201, { ...publishSelection, publishRequestId: requestId, status: 'confirmed',
        projectId: null, releaseId: null, expiresAt: new Date(Date.now() + 1_800_000).toISOString() });
    }
    if (pathname.endsWith(`/publish-requests/${requestId}`) && method === 'GET') return send(200, {
      ...publishSelection, publishRequestId: requestId, buildId: artifact.buildId,
      contentDigest: artifact.contentDigest, manifestDigest: artifact.manifestDigest,
      status: 'uploading', projectId, releaseId: null, expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
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
    const materialBase = `/v1/sites/${projectId}/artifact-uploads/${uploadId}/assets/0`;
    if (withMaterials && pathname === materialBase && method === 'POST') {
      assert.equal(request.headers.authorization, 'Bearer taku_pub_test_site_session');
      assert.equal(bytes.length, 0, 'confirmed metadata must not be resubmitted or overridden');
      return send(materialReady ? 200 : 202, materialReceipt());
    }
    if (withMaterials && pathname.startsWith(`${materialBase}/parts/`) && method === 'PUT') {
      assert.equal(request.headers.authorization, 'Bearer taku_pub_test_site_session');
      const partNumber = Number(pathname.split('/').at(-1));
      assert.equal(bytes.length, partNumber === 1 ? 8 * 1024 * 1024 : 24);
      assert.equal(request.headers['content-length'], String(bytes.length));
      assert.equal(request.headers['x-taku-asset-part-sha256'], createHash('sha256').update(bytes).digest('hex'));
      if (partNumber === 2 && failLastMaterialPart) { failLastMaterialPart = false; return send(503, { error: 'temporary' }); }
      if (materialParts.has(partNumber)) assert.deepEqual(bytes, materialParts.get(partNumber));
      materialParts.set(partNumber, bytes);
      return send(200, { assetId: materialReceipt().assetId, partNumber, status: 'uploaded' });
    }
    if (withMaterials && pathname === `${materialBase}/complete` && method === 'POST') {
      assert.equal(bytes.length, 0);
      if (materialParts.size !== 2) return send(409, { error: 'SITE_ASSET_INCOMPLETE' });
      assert.equal(createHash('sha256').update(Buffer.concat([...materialParts.values()])).digest('hex'), artifact.descriptor.assetManifest.files[0].sha256);
      materialReady = true;
      return send(200, materialReceipt());
    }
    if (pathname.endsWith(`/${uploadId}`) && method === 'GET') return send(200, {
      uploadId, artifactDigest: artifact.artifactDigest, status: 'uploading',
      missingOrdinals: artifact.objects.map(object => object.ordinal).filter(ordinal => !uploaded.has(ordinal)),
    });
    if (pathname.endsWith(`/${uploadId}/finalize`) && method === 'POST') {
      if (withMaterials && !materialReady) return send(409, { error: 'ASSET_MANIFEST_INCOMPLETE' });
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
  if (withMaterials) {
    assert.equal(pending.material_count, 1);
    assert.equal(pending.material_bytes, 8 * 1024 * 1024 + 24);
    assert.deepEqual(pending.material_retention, { permanent: retention === 'permanent' ? 1 : 0, temporary: retention === 'temporary' ? 1 : 0, temporary_ttl_seconds: 2592000 });
  }
  await assert.rejects(dispatch(args('sites-publish', { ...flags, 'confirm-target': 'chosen-site.taku.site' })), { code: 'sites_api_error' });
  const checkpointName = (await readdir(path.join(root, 'sites/checkpoints')))[0];
  const checkpointText = await readFile(path.join(root, 'sites/checkpoints', checkpointName), 'utf8');
  assert.equal(checkpointText.includes(uploadToken), false);
  assert.equal(checkpointText.includes('taku_pub_test_site_session'), false);
  if (scenario === 'mismatch') {
    await assert.rejects(dispatch(args('sites-publish', flags)), { code: 'sites_invalid_response' });
    assert.equal(writes.filter(write => write.pathname.includes('/parts/')).length, 0);
    assert.equal(writes.filter(write => write.pathname.endsWith('/finalize')).length, 0);
    assert.equal(writes.filter(write => write.pathname.endsWith('/publish-requests')).length, 1);
    return;
  }
  if (withMaterials && scenario !== 'reuse') await assert.rejects(dispatch(args('sites-publish', flags)), { code: 'sites_api_error' });
  const result = await dispatch(args('sites-publish', flags));
  assert.equal(result.status, 'sites_published');
  assert.equal(result.ready, true);
  assert.equal(result.url, 'https://chosen-site.taku.site');
  assert.equal(uploaded.size, artifact.objects.length);
  assert.equal(writes.filter(write => write.pathname.endsWith('/publish-requests')).length, 1);
  assert.ok(writes.filter(write => write.pathname.includes('/objects/')).every(write => write.authorization === `Bearer ${uploadToken}`));
  assert.ok(writes.filter(write => write.method !== 'PUT').every(write => write.authorization === 'Bearer taku_pub_test_site_session'));
  assert.equal(JSON.stringify(result).includes(uploadToken), false);
  assert.equal(JSON.stringify(result).includes('taku_pub_test_site_session'), false);
  if (withMaterials) {
    assert.equal(materialReady, true);
    assert.equal(materialParts.size, scenario === 'reuse' ? 0 : 2);
    assert.equal(writes.filter(write => write.pathname === `${'/v1/sites'}/${projectId}/artifact-uploads`).length, 1);
    assert.equal(writes.filter(write => write.pathname.endsWith('/finalize')).length, 1);
    assert.ok(writes.filter(write => write.pathname.includes('/assets/0')).every(write => write.authorization === 'Bearer taku_pub_test_site_session'));
  }
});

async function recoveryFixture(t, { existing = false, lostCreateResponse = false, interruption = 'upload', retention } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-sites-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previousHome = process.env.TAKU_PUBLISHER_HOME;
  process.env.TAKU_PUBLISHER_HOME = root;
  t.after(() => {
    if (previousHome === undefined) delete process.env.TAKU_PUBLISHER_HOME;
    else process.env.TAKU_PUBLISHER_HOME = previousHome;
  });
  await savePublisherSession({ accessToken: 'taku_pub_test_recovery', expiresAt: Date.now() + 600_000,
    intent: 'publish_site', scopes: ['sites.read', 'sites.preview', 'sites.publish'] });
  const project = path.join(root, 'site');
  await dispatch(args('sites-init', { project }));
  if (retention) {
    const bytes = Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109]);
    await writeFile(path.join(project, 'dist/assets/clip.mp4'), bytes);
    await writeFile(path.join(project, 'taku.assets.json'), JSON.stringify({ schema: 'taku.sites.asset-manifest.v1', files: [{
      logicalPath: '/media/clip.mp4', sourcePath: 'dist/assets/clip.mp4', contentType: 'video/mp4', size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), retention, visibility: 'public',
    }] }));
  }
  const { core } = await loadSitesCore();
  const projectId = 'prj_publisher_recovery';
  const hostname = 'recovery-site.taku.site';
  const uploadId = '20000000-0000-4000-8000-000000000010';
  const requests = [];
  const confirmations = [];
  const observedArtifacts = new Map();
  const state = { userId: 'owner-1', created: existing, active: false,
    failUpload: !lostCreateResponse && interruption === 'upload', failRequestRead: false,
    failObject: interruption === 'object', failMaterial: interruption === 'material',
    loseUploadResponse: interruption === 'upload-response', failCancel: false,
    readyOnCancel: false, cancellationNotCommitted: false, failUploadRead: false,
    record: null, artifact: null, uploads: new Map() };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const method = request.method;
    const body = method === 'POST' && bytes.length ? JSON.parse(bytes.toString()) : null;
    requests.push({ method, pathname, body, key: request.headers['idempotency-key'] });
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (method === 'GET' && pathname === '/v1/sites/cli-session') return send(200, {
      userId: state.userId, source: 'publisher', productAccess: 'allowed',
      scopes: ['sites.read', 'sites.preview', 'sites.publish'],
    });
    if (method === 'GET' && pathname === '/v1/sites/publish-eligibility') return send(200, state.created
      ? { eligible: false, quotaConfigured: true, available: 0, max: 1, occupied: 1 }
      : { eligible: true, quotaConfigured: true, available: 1, max: 1, occupied: 0 });
    if (method === 'GET' && pathname === '/v1/sites/slugs/recovery-site/availability') return send(200, {
      slug: 'recovery-site', hostname, available: !state.created, reason: state.created ? 'SLUG_TAKEN' : null,
    });
    if (method === 'POST' && pathname === '/v1/sites/publish-requests') {
      confirmations.push({ ...body, key: request.headers['idempotency-key'] });
      state.record = { ...body,
        publishRequestId: `10000000-0000-4000-8000-${String(confirmations.length).padStart(12, '0')}`,
        status: 'confirmed', projectId: null, releaseId: null,
        expiresAt: new Date(Date.now() + 1_800_000).toISOString() };
      return send(201, state.record);
    }
    if (method === 'GET' && pathname.startsWith('/v1/sites/publish-requests/')) {
      if (state.failRequestRead) return send(503, { error: 'TEMPORARILY_UNAVAILABLE' });
      return pathname.endsWith(state.record.publishRequestId) ? send(200, state.record)
        : send(404, { error: 'PUBLISH_REQUEST_NOT_FOUND' });
    }
    if (method === 'POST' && pathname === '/v1/sites') {
      if (state.created) return send(403, { error: 'SITE_LIMIT_REACHED' });
      state.created = true;
      state.record.projectId = projectId;
      state.record.status = 'reserved';
      if (lostCreateResponse) return send(503, { error: 'RESPONSE_LOST_AFTER_COMMIT' });
      return send(202, { projectId, hostname, slug: 'recovery-site', status: 'provisioning' });
    }
    if (method === 'GET' && pathname === `/v1/sites/${projectId}`) return send(state.created ? 200 : 404, {
      projectId, hostname, status: state.active ? 'active' : 'provisioning',
      currentReleaseId: state.active ? state.artifact.releaseId : null,
    });
    if (method === 'POST' && pathname === `/v1/sites/${projectId}/artifact-uploads`) {
      const descriptorKey = JSON.stringify(sortJson(body.descriptor));
      if (!observedArtifacts.has(descriptorKey)) {
        const artifact = await core.buildArtifact(project, { projectId, builtAt: body.descriptor.builtAt });
        assert.deepEqual(artifact.descriptor, body.descriptor);
        observedArtifacts.set(descriptorKey, artifact);
      }
      if (state.failUpload) { state.failUpload = false; return send(503, { error: 'INTERRUPTED_BEFORE_UPLOAD' }); }
      const prior = [...state.uploads.values()].find(upload => upload.key === request.headers['idempotency-key']);
      if (prior) {
        if (JSON.stringify(sortJson(prior.descriptor)) !== descriptorKey
          || prior.publishRequestId !== body.publishRequestId) return send(409, { error: 'IDEMPOTENCY_CONFLICT' });
        return send(200, { uploadId: prior.uploadId, projectId, artifactDigest: prior.artifact.artifactDigest,
          status: prior.status, missingOrdinals: prior.artifact.objects.map(object => object.ordinal) });
      }
      if ([...state.uploads.values()].some(upload => ['initiated', 'uploading', 'finalizing'].includes(upload.status))) {
        return send(409, { error: 'UPLOAD_IN_PROGRESS' });
      }
      if (body.publishRequestId !== state.record.publishRequestId) return send(409, { error: 'PUBLISH_REQUEST_MISMATCH' });
      if (!state.record.projectId && (['expired', 'cancelled'].includes(state.record.status)
        || Date.parse(state.record.expiresAt) <= Date.now())) return send(409, { error: 'PUBLISH_REQUEST_EXPIRED' });
      state.artifact = observedArtifacts.get(descriptorKey);
      state.record.projectId = projectId;
      state.record.status = 'uploading';
      const allocatedId = state.uploads.size ? '20000000-0000-4000-8000-000000000011' : uploadId;
      state.uploads.set(allocatedId, { uploadId: allocatedId, key: request.headers['idempotency-key'],
        descriptor: body.descriptor, publishRequestId: body.publishRequestId, artifact: state.artifact, status: 'initiated' });
      if (state.loseUploadResponse) {
        state.loseUploadResponse = false;
        return send(503, { error: 'UPLOAD_RESPONSE_LOST_AFTER_COMMIT' });
      }
      return send(202, { uploadId: allocatedId, projectId, artifactDigest: state.artifact.artifactDigest,
        status: 'initiated', missingOrdinals: state.artifact.objects.map(object => object.ordinal) });
    }
    const upload = [...state.uploads.values()].find(value => pathname.includes(value.uploadId));
    if (method === 'DELETE' && upload && pathname.endsWith(upload.uploadId)) {
      if (state.readyOnCancel) upload.status = 'ready';
      if (upload.status === 'ready') return send(409, { error: 'ARTIFACT_ALREADY_READY' });
      if (!state.cancellationNotCommitted) upload.status = 'cancelled';
      if (state.failCancel) { state.failCancel = false; return send(503, { error: 'CANCEL_RESPONSE_LOST_AFTER_COMMIT' }); }
      return send(200, { status: 'cancelled' });
    }
    if (method === 'POST' && pathname.endsWith('/upload-credential')) return send(201, { token: `taku_su_${'a'.repeat(43)}` });
    if (method === 'PUT' && pathname.includes('/objects/')) {
      if (state.failObject) { state.failObject = false; return send(503, { error: 'OBJECT_INTERRUPTED' }); }
      return send(200, { status: 'uploaded' });
    }
    if (method === 'GET' && upload && pathname.endsWith(`/artifact-uploads/${upload.uploadId}`)) {
      if (state.failUploadRead) return send(503, { error: 'UPLOAD_STATE_UNAVAILABLE' });
      return send(200, {
        uploadId: upload.uploadId, projectId, artifactDigest: upload.artifact.artifactDigest, status: upload.status, missingOrdinals: [],
      });
    }
    if (retention && upload && pathname.endsWith('/assets/0') && method === 'POST') {
      const file = upload.descriptor.assetManifest.files[0];
      return send(202, { assetId: `ast_${'b'.repeat(32)}`, state: 'uploading', ...file,
        byteLength: file.size, expiresAt: retention === 'permanent' ? null : new Date(Date.now() + 2592000_000).toISOString(),
        partBytes: 8 * 1024 * 1024, partCount: 1 });
    }
    if (retention && upload && pathname.endsWith('/assets/0/parts/1') && method === 'PUT') {
      if (state.failMaterial) { state.failMaterial = false; return send(503, { error: 'MATERIAL_INTERRUPTED' }); }
      return send(200, { assetId: `ast_${'b'.repeat(32)}`, partNumber: 1, status: 'uploaded' });
    }
    if (retention && upload && pathname.endsWith('/assets/0/complete') && method === 'POST') {
      const file = upload.descriptor.assetManifest.files[0];
      return send(200, { assetId: `ast_${'b'.repeat(32)}`, state: 'ready', ...file,
        byteLength: file.size, expiresAt: retention === 'permanent' ? null : new Date(Date.now() + 2592000_000).toISOString(),
        partBytes: 8 * 1024 * 1024, partCount: 1 });
    }
    if (method === 'POST' && pathname.endsWith('/finalize')) {
      state.active = true;
      upload.status = 'ready';
      return send(200, { uploadId: upload.uploadId, status: 'ready' });
    }
    return send(404, { error: 'UNEXPECTED_RECOVERY_ROUTE' });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const flags = { project, 'worker-url': `http://127.0.0.1:${server.address().port}`, 'wait-seconds': '0',
    ...(existing ? { 'project-id': projectId } : { slug: 'recovery-site' }) };
  const publish = extra => dispatch(args('sites-publish', { ...flags, ...extra }));
  const checkpointText = async () => {
    const files = await readdir(path.join(root, 'sites/checkpoints'));
    return readFile(path.join(root, 'sites/checkpoints', files[0]), 'utf8');
  };
  await assert.rejects(publish({ 'confirm-target': existing ? projectId : hostname }), { code: 'sites_api_error' });
  return { project, projectId, hostname, publish, checkpointText, state, requests, confirmations };
}

for (const lostCreateResponse of [false, true]) test(`reset retains allocated Free first Site when create response ${lostCreateResponse ? 'is lost' : 'arrives'}`, async t => {
  const fixture = await recoveryFixture(t, { lostCreateResponse });
  const { project, projectId, publish, checkpointText, state, requests, confirmations } = fixture;
  await writeFile(path.join(project, 'dist/assets/index.html'), '<!doctype html><title>Changed build</title><main>v2</main>');
  await assert.rejects(publish({}), { code: 'sites_build_changed' });
  const originalCheckpoint = await checkpointText();
  const writesBefore = requests.filter(request => request.method !== 'GET').length;
  const pending = await publish({ reset: true });
  assert.equal(pending.status, 'needs_input');
  assert.equal(pending.confirm_target, projectId);
  assert.deepEqual(pending.target, { kind: 'existing', projectId, hostname: 'recovery-site.taku.site' });
  assert.equal(await checkpointText(), originalCheckpoint, 'read-only prompt retains reconciliation identity');
  assert.equal(requests.filter(request => request.method !== 'GET').length, writesBefore);
  const result = await publish({ reset: true, 'confirm-target': projectId });
  assert.equal(result.status, 'sites_published');
  assert.equal(result.project_id, projectId);
  assert.equal(state.active, true);
  assert.equal(requests.filter(request => request.method === 'POST' && request.pathname === '/v1/sites').length, 1);
  assert.equal(requests.filter(request => request.pathname.endsWith('/publish-eligibility')).length, 1);
  assert.equal(confirmations.length, 2);
  assert.equal(confirmations[1].draftId, confirmations[0].draftId);
  assert.deepEqual(confirmations[1].target, { kind: 'existing', projectId });
  assert.notEqual(confirmations[1].key, confirmations[0].key);
  assert.notEqual(confirmations[1].contentDigest, confirmations[0].contentDigest);
});

test('unchanged retry reconciles the lost Site-create response without creating another Site or confirmation', async t => {
  const { projectId, publish, requests, confirmations } = await recoveryFixture(t, { lostCreateResponse: true });
  const result = await publish({});
  assert.equal(result.status, 'sites_published');
  assert.equal(result.project_id, projectId);
  assert.equal(confirmations.length, 1);
  assert.equal(requests.filter(request => request.method === 'POST' && request.pathname === '/v1/sites').length, 1);
});

for (const interruption of ['object', 'upload-response', 'permanent', 'temporary']) test(`reset reconciles old live ${interruption} upload before replacing its checkpoint`, async t => {
  const retention = ['permanent', 'temporary'].includes(interruption) ? interruption : undefined;
  const { project, projectId, publish, checkpointText, state, requests, confirmations } = await recoveryFixture(t, {
    interruption: retention ? 'material' : interruption, retention,
  });
  const old = JSON.parse(await checkpointText());
  await writeFile(path.join(project, 'dist/assets/index.html'), '<!doctype html><main>next build</main>');
  const writesBefore = requests.filter(request => request.method !== 'GET').length;
  assert.equal((await publish({ reset: true })).status, 'needs_input');
  assert.equal(requests.filter(request => request.method !== 'GET').length, writesBefore);
  assert.equal((await publish({ reset: true, 'confirm-target': projectId })).status, 'sites_published');
  const uploads = [...state.uploads.values()];
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].status, 'cancelled');
  assert.equal(uploads[1].status, 'ready');
  assert.equal(confirmations.length, 2);
  const cancelIndex = requests.findIndex(request => request.method === 'DELETE');
  const secondConfirmIndex = requests.findIndex(request => request.method === 'POST' && request.pathname.endsWith('/publish-requests')
    && request.key !== confirmations[0].key);
  assert.ok(cancelIndex >= 0 && cancelIndex < secondConfirmIndex, 'settle old upload before replacing its confirmation');
  if (interruption === 'upload-response') {
    const replay = requests.filter(request => request.method === 'POST' && request.pathname.endsWith('/artifact-uploads') && request.key === old.uploadKey);
    assert.equal(replay.length, 2);
    assert.deepEqual(replay[1].body.descriptor, replay[0].body.descriptor);
  }
  assert.equal(requests.filter(request => request.method === 'POST' && request.pathname === '/v1/sites').length, 1);
});

test('reset keeps old upload identity when cancellation response is lost, then reconciles without recancelling', async t => {
  const { project, projectId, publish, checkpointText, state, requests, confirmations } = await recoveryFixture(t, { interruption: 'object' });
  await writeFile(path.join(project, 'dist/assets/index.html'), '<!doctype html><main>next build</main>');
  const original = await checkpointText();
  state.failCancel = true;
  await assert.rejects(publish({ reset: true, 'confirm-target': projectId }), { code: 'sites_api_error' });
  assert.equal(await checkpointText(), original);
  assert.equal(confirmations.length, 1);
  assert.equal([...state.uploads.values()][0].status, 'cancelled');
  assert.equal((await publish({ reset: true, 'confirm-target': projectId })).status, 'sites_published');
  assert.equal(requests.filter(request => request.method === 'DELETE').length, 1);
});

for (const status of ['ready', 'cancelled', 'expired', 'failed']) test(`reset leaves terminal ${status} upload untouched`, async t => {
  const { project, projectId, publish, state, requests } = await recoveryFixture(t, { interruption: 'object' });
  const oldUpload = [...state.uploads.values()][0];
  oldUpload.status = status;
  await writeFile(path.join(project, 'dist/assets/index.html'), '<!doctype html><main>next build</main>');
  assert.equal((await publish({ reset: true, 'confirm-target': projectId })).status, 'sites_published');
  assert.equal(oldUpload.status, status);
  assert.equal(requests.filter(request => request.method === 'DELETE').length, 0);
  assert.equal([...state.uploads.values()][1].status, 'ready');
});

test('reset reconciles an upload that finishes between its read and cancellation', async t => {
  const { project, projectId, publish, state, requests, confirmations } = await recoveryFixture(t, { interruption: 'object' });
  state.readyOnCancel = true;
  await writeFile(path.join(project, 'dist/assets/index.html'), '<!doctype html><main>next build</main>');
  assert.equal((await publish({ reset: true, 'confirm-target': projectId })).status, 'sites_published');
  assert.equal([...state.uploads.values()][0].status, 'ready');
  assert.equal(confirmations.length, 2);
  assert.equal(requests.filter(request => request.method === 'DELETE').length, 1);
});

for (const failure of ['uncommitted-cancellation', 'unavailable-state']) test(`reset preserves old checkpoint on ${failure}`, async t => {
  const { project, projectId, publish, checkpointText, state, requests, confirmations } = await recoveryFixture(t, { interruption: 'object' });
  const original = await checkpointText();
  state.cancellationNotCommitted = failure === 'uncommitted-cancellation';
  state.failUploadRead = failure === 'unavailable-state';
  await writeFile(path.join(project, 'dist/assets/index.html'), '<!doctype html><main>next build</main>');
  await assert.rejects(publish({ reset: true, 'confirm-target': projectId }), {
    code: failure === 'unavailable-state' ? 'sites_api_error' : 'sites_upload_recovery_required',
  });
  assert.equal(await checkpointText(), original);
  assert.equal(confirmations.length, 1);
  assert.equal(state.uploads.size, 1);
  assert.equal([...state.uploads.values()][0].status, 'initiated');
  assert.equal(requests.filter(request => request.method === 'DELETE').length, failure === 'unavailable-state' ? 0 : 1);
});

test('legacy unknown upload with changed files keeps recovery evidence instead of guessing its descriptor', async t => {
  const { project, projectId, publish, checkpointText, requests, confirmations } = await recoveryFixture(t, { interruption: 'upload-response' });
  const checkpointDirectory = path.join(path.dirname(project), 'sites/checkpoints');
  const checkpointFile = path.join(checkpointDirectory, (await readdir(checkpointDirectory))[0]);
  const legacy = JSON.parse(await checkpointText());
  delete legacy.uploadDescriptor;
  await writeFile(checkpointFile, JSON.stringify(legacy));
  await writeFile(path.join(project, 'dist/assets/index.html'), '<!doctype html><main>next build</main>');
  const original = await checkpointText();
  const writesBefore = requests.filter(request => request.method !== 'GET').length;
  await assert.rejects(publish({ reset: true, 'confirm-target': projectId }), { code: 'sites_upload_recovery_required' });
  assert.equal(await checkpointText(), original);
  assert.equal(confirmations.length, 1);
  assert.equal(requests.filter(request => request.method !== 'GET').length, writesBefore);
});

test('legacy unknown upload can be reconciled when its original files are unchanged', async t => {
  const { project, projectId, publish, checkpointText, state, requests } = await recoveryFixture(t, { interruption: 'upload-response' });
  const directory = path.join(path.dirname(project), 'sites/checkpoints');
  const checkpointFile = path.join(directory, (await readdir(directory))[0]);
  const legacy = JSON.parse(await checkpointText());
  delete legacy.uploadDescriptor;
  await writeFile(checkpointFile, JSON.stringify(legacy));
  assert.equal((await publish({ reset: true, 'confirm-target': projectId })).status, 'sites_published');
  assert.equal([...state.uploads.values()][0].status, 'cancelled');
  const replay = requests.filter(request => request.method === 'POST' && request.pathname.endsWith('/artifact-uploads') && request.key === legacy.uploadKey);
  assert.equal(replay.length, 2);
  assert.deepEqual(replay[1].body, replay[0].body);
  assert.equal(requests.filter(request => request.method === 'POST' && request.pathname === '/v1/sites').length, 1);
});

for (const reason of ['expired', 'cancelled', 'elapsed']) test(`existing Site ${reason} confirmation requires a new explicit confirmation without losing its project`, async t => {
  const { projectId, publish, checkpointText, state, requests, confirmations } = await recoveryFixture(t, { existing: true });
  state.record.status = reason === 'elapsed' ? 'confirmed' : reason;
  state.record.expiresAt = new Date(Date.now() - 1000).toISOString();
  const originalCheckpoint = await checkpointText();
  const writesBefore = requests.filter(request => request.method !== 'GET').length;
  const pending = await publish({});
  assert.equal(pending.status, 'needs_input');
  assert.equal(pending.confirm_target, projectId);
  assert.equal(await checkpointText(), originalCheckpoint);
  assert.equal(requests.filter(request => request.method !== 'GET').length, writesBefore);
  const result = await publish({ 'confirm-target': projectId });
  assert.equal(result.status, 'sites_published');
  assert.equal(confirmations.length, 2);
  assert.notEqual(confirmations[1].key, confirmations[0].key);
  assert.equal(confirmations[1].draftId, confirmations[0].draftId);
  assert.equal(confirmations[1].contentDigest, confirmations[0].contentDigest);
  assert.equal(requests.filter(request => request.method === 'POST' && request.pathname === '/v1/sites').length, 0);
});

for (const status of ['confirmed', 'reserved']) test(`valid or allocated ${status} request keeps original confirmation on retry`, async t => {
  const { projectId, publish, state, confirmations } = await recoveryFixture(t, { existing: true });
  if (status === 'reserved') {
    state.record.status = 'reserved'; state.record.projectId = projectId;
    state.record.expiresAt = new Date(Date.now() - 1000).toISOString();
  }
  assert.equal((await publish({})).status, 'sites_published');
  assert.equal(confirmations.length, 1);
});

for (const conflict of ['account', 'binding', 'read-failure']) test(`reset retains checkpoint on ${conflict} instead of discarding recovery evidence`, async t => {
  const { publish, checkpointText, state, requests } = await recoveryFixture(t);
  const originalCheckpoint = await checkpointText();
  const writesBefore = requests.filter(request => request.method !== 'GET').length;
  if (conflict === 'account') state.userId = 'owner-2';
  if (conflict === 'binding') state.record.projectId = 'prj_different_project';
  if (conflict === 'read-failure') state.failRequestRead = true;
  await assert.rejects(publish({ reset: true }), { code: conflict === 'account' ? 'sites_checkpoint_mismatch'
    : conflict === 'binding' ? 'sites_request_mismatch' : 'sites_api_error' });
  assert.equal(await checkpointText(), originalCheckpoint);
  assert.equal(requests.filter(request => request.method !== 'GET').length, writesBefore);
});
