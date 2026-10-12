import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { dispatch } from '../dist/cli.js';
import { savePublisherSession } from '../dist/auth.js';
import ownerAssetCatalog from './fixtures/owner-assets.json' with { type: 'json' };
import { imageModelSizeCatalog } from './fixtures/image-model-size-catalog.mjs';
import { imageModelInputCatalog, imageModelReferenceMaskCatalog } from './fixtures/image-model-input-catalog.mjs';

function args(command, flags = {}) {
  return { command, flags: new Map(Object.entries(flags)), rest: [] };
}

test('reference-mask v2 actual native CLI discovers unavailable policy through authenticated HTTP', async t => {
  await withSitesSession(t);
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, auth: request.headers.authorization,
      feature: request.headers['x-taku-image-model-features'], cookie: request.headers.cookie });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(imageModelReferenceMaskCatalog()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await dispatch(args('sites-image-models', { operation: 'media.image.edit', limit: '2',
    'worker-url': `http://127.0.0.1:${server.address().port}`, 'allow-custom-worker-url': true }));
  assert.equal(result.status, 'sites_image_models'); assert.equal(result.surface, 'site-published');
  assert.deepEqual(result.catalog, imageModelReferenceMaskCatalog());
  assert.deepEqual(seen, [{ method: 'GET', url: '/v1/sites/capabilities/image-models?operation=media.image.edit&limit=2',
    auth: 'Bearer taku_pub_test_contract_session', feature: 'generation-references-v1', cookie: undefined }]);
});

test('reference-mask v2 actual exported SDK preserves policy without Publisher credentials', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-reference-mask-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  await dispatch(args('sites-sdk-export', { output }));
  const { createTakuSitesClient } = await import(pathToFileURL(output).href);
  const seen = [];
  const sdk = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
    seen.push(request); return Response.json(imageModelReferenceMaskCatalog());
  } });
  assert.deepEqual(await sdk.media.listImageModels(queryReferenceMask), imageModelReferenceMaskCatalog());
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
  assert.equal(seen[0].credentials, 'same-origin'); assert.equal(seen[0].redirect, 'error');
  assert.equal(seen[0].headers.has('Authorization'), false); assert.equal(seen[0].headers.has('Cookie'), false);
});

const queryReferenceMask = { operation: 'media.image.edit', limit: 2 };

test('actual native CLI input-contract discovery preserves masks through authenticated loopback HTTP', async t => {
  await withSitesSession(t);
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, auth: request.headers.authorization,
      feature: request.headers['x-taku-image-model-features'], cookie: request.headers.cookie });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(imageModelInputCatalog()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await dispatch(args('sites-image-models', { operation: 'media.image.edit', limit: '4',
    'worker-url': `http://127.0.0.1:${server.address().port}`, 'allow-custom-worker-url': true }));
  assert.equal(result.status, 'sites_image_models'); assert.equal(result.surface, 'site-published');
  assert.deepEqual(result.catalog, imageModelInputCatalog());
  assert.deepEqual(seen, [{ method: 'GET', url: '/v1/sites/capabilities/image-models?operation=media.image.edit&limit=4',
    auth: 'Bearer taku_pub_test_contract_session', feature: 'generation-references-v1', cookie: undefined }]);
});

test('actual exported SDK input-contract discovery preserves masks without Publisher authority', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-input-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  assert.equal((await dispatch(args('sites-sdk-export', { output }))).status, 'sites_sdk_exported');
  const { createTakuSitesClient } = await import(pathToFileURL(output).href);
  const seen = [];
  const sdk = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
    seen.push(request); return Response.json(imageModelInputCatalog());
  } });
  const result = await sdk.media.listImageModels({ operation: 'media.image.edit', limit: 4 });
  assert.deepEqual(result, imageModelInputCatalog());
  assert.equal(result.models[0].inputContract.sameDimensions, true);
  assert.deepEqual(result.models[2].inputContract.roles, ['source', 'mask']);
  assert.equal(result.models[3].parameters.image_size.sizeConstraints.widthStep, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://fixture.taku.site/__taku/media/models?operation=media.image.edit&limit=4');
  assert.equal(seen[0].headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
  assert.equal(seen[0].credentials, 'same-origin'); assert.equal(seen[0].redirect, 'error');
  assert.equal(seen[0].headers.has('Authorization'), false); assert.equal(seen[0].headers.has('Cookie'), false);
});

test('actual exported SDK input-contract discovery rejects malformed pair metadata', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-invalid-input-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  await dispatch(args('sites-sdk-export', { output }));
  const { createTakuSitesClient } = await import(pathToFileURL(output).href);
  for (const defect of ['reversed', 'dimensions', 'count', 'extra']) {
    const catalog = imageModelInputCatalog();
    if (defect === 'reversed') catalog.models[0].inputContract.roles = ['mask', 'source'];
    if (defect === 'dimensions') catalog.models[0].inputContract.sameDimensions = false;
    if (defect === 'count') catalog.models[0].maximumInputs = 3;
    if (defect === 'extra') catalog.models[0].inputContract.identity = 'another-user';
    const sdk = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async () => Response.json(catalog) });
    await assert.rejects(sdk.media.listImageModels({ operation: 'media.image.edit', limit: 4 }),
      error => error instanceof Error && error.message === 'invalid_platform_response');
  }
});

test('actual exported SDK size discovery preserves constraints without Publisher credentials', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-size-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  assert.equal((await dispatch(args('sites-sdk-export', { output }))).status, 'sites_sdk_exported');
  const { createTakuSitesClient } = await import(pathToFileURL(output).href);
  for (const operation of ['media.image.generate', 'media.image.edit']) {
    const catalog = imageModelSizeCatalog(operation);
    const seen = [];
    const sdk = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
      seen.push(request); return Response.json(catalog);
    } });
    assert.deepEqual(await sdk.media.listImageModels({ operation, limit: 2 }), catalog);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, `https://fixture.taku.site/__taku/media/models?operation=${operation}&limit=2`);
    assert.equal(seen[0].method, 'GET'); assert.equal(seen[0].credentials, 'same-origin');
    assert.equal(seen[0].headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
    assert.equal(seen[0].headers.has('Authorization'), false); assert.equal(seen[0].headers.has('Cookie'), false);
  }
});

test('actual exported SDK grid discovery rejects missing steps and malformed grids', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-grid-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  await dispatch(args('sites-sdk-export', { output }));
  const { createTakuSitesClient } = await import(pathToFileURL(output).href);
  for (const defect of ['missing', 'zero', 'fraction', 'off-grid']) {
    const catalog = imageModelSizeCatalog();
    const parameter = catalog.models[0].parameters.image_size;
    if (defect === 'missing') {
      delete parameter.sizeConstraints.widthStep;
      delete parameter.sizeConstraints.heightStep;
    }
    if (defect === 'zero') parameter.sizeConstraints.heightStep = 0;
    if (defect === 'fraction') parameter.sizeConstraints.widthStep = 1.5;
    if (defect === 'off-grid') parameter.default = { width: 2047, height: 2048 };
    const sdk = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site',
      fetcher: async () => Response.json(catalog) });
    await assert.rejects(sdk.media.listImageModels({ operation: 'media.image.generate', limit: 2 }),
      error => error instanceof Error && error.message === 'invalid_platform_response');
  }
});

test('actual native CLI size discovery preserves live constraints through authenticated loopback HTTP', async t => {
  await withSitesSession(t);
  const seen = [];
  const server = createServer((request, response) => {
    const operation = new URL(request.url, 'http://fixture').searchParams.get('operation');
    seen.push({ method: request.method, url: request.url, auth: request.headers.authorization,
      feature: request.headers['x-taku-image-model-features'], cookie: request.headers.cookie });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(imageModelSizeCatalog(operation)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const operation of ['media.image.generate', 'media.image.edit']) {
    const result = await dispatch(args('sites-image-models', { operation, limit: '2',
      'worker-url': `http://127.0.0.1:${server.address().port}`, 'allow-custom-worker-url': true }));
    assert.equal(result.status, 'sites_image_models'); assert.equal(result.surface, 'site-published');
    assert.deepEqual(result.catalog, imageModelSizeCatalog(operation));
  }
  assert.deepEqual(seen, ['media.image.generate', 'media.image.edit'].map(operation => ({ method: 'GET',
    url: `/v1/sites/capabilities/image-models?operation=${operation}&limit=2`,
    auth: 'Bearer taku_pub_test_contract_session', feature: 'generation-references-v1', cookie: undefined })));
});

test('actual exported browser SDK discovers image models without a Platform checkout or supplier authority', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-model-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  assert.equal((await dispatch(args('sites-sdk-export', { output }))).status, 'sites_sdk_exported');
  const { createTakuSitesClient, TakuSitesRequestError } = await import(pathToFileURL(output).href);
  const seen = [];
  let reply = () => Response.json({ schema: 'taku.image-model-catalog.v1', catalogVersion: 'a'.repeat(64),
    observedAt: '2026-10-05T15:00:00Z', nextCursor: null, models: [{ id: 'flux-schnell', displayName: 'FLUX.1 [schnell]',
      operations: ['media.image.generate'], availability: { subapp: { status: 'unavailable', reason: 'runtime_bridge_unverified' },
        'site-preview': { status: 'unavailable', reason: 'runtime_bridge_unverified' },
        'site-published': { status: 'unavailable', reason: 'runtime_bridge_unverified' } },
      parameterSchemaVersion: 'image-parameters-v2-2026-10-05', priceVersion: 'image-prices-v2-2026-10-05',
      parameters: { num_images: { type: 'integer', minimum: 1, maximum: 1, default: 1 } }, maximumInputs: 0, maximumOutputs: 1 }] });
  const sdk = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => { seen.push(request); return reply(); } });
  assert.equal(typeof sdk.media.listImageModels, 'function');
  const page = await sdk.media.listImageModels({ operation: 'media.image.generate', query: '  FLUX  ', limit: 2 });
  assert.equal(page.models[0].id, 'flux-schnell');
  assert.equal(page.models[0].availability['site-published'].status, 'unavailable');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://fixture.taku.site/__taku/media/models?operation=media.image.generate&limit=2&query=flux');
  assert.equal(seen[0].method, 'GET'); assert.equal(seen[0].redirect, 'error'); assert.equal(seen[0].credentials, 'same-origin');
  assert.equal(seen[0].headers.get('X-Taku-CSRF'), '1');
  assert.equal(seen[0].headers.has('Authorization'), false); assert.equal(seen[0].headers.has('Cookie'), false);
  for (const query of [{ operation: 'media.image.generate', surface: 'subapp' }, { operation: 'media.image.generate', payer: 'other' },
    { operation: 'media.image.edit', limit: 101 }, { operation: 'media.video.generate' }])
    await assert.rejects(sdk.media.listImageModels(query), /invalid_image_model_catalog_query/);
  assert.equal(seen.length, 1);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(sdk.media.listImageModels({ operation: 'media.image.generate' }, { signal: aborted.signal }));
  assert.equal(seen.length, 1);
  reply = () => Response.json({ error: 'supplier private token' }, { status: 502, headers: { 'X-Request-Id': `req_${'b'.repeat(32)}` } });
  await assert.rejects(sdk.media.listImageModels({ operation: 'media.image.generate' }), error => error instanceof TakuSitesRequestError
    && error.status === 503 && error.code === 'image_model_catalog_unavailable' && error.requestId === `req_${'b'.repeat(32)}`);
});

test('actual Publisher validation accepts the declared model catalogue browser SDK and refuses undeclared authority', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-model-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await dispatch(args('sites-init', { project: root }));
  await dispatch(args('sites-sdk-export', { output: path.join(root, 'dist/assets/taku-sites-sdk.mjs') }));
  await writeFile(path.join(root, 'dist/assets/app.mjs'), "import { createTakuSitesClient } from './taku-sites-sdk.mjs'; const client = createTakuSitesClient(); void client.media.listImageModels({ operation: 'media.image.generate' });\n");
  await writeFile(path.join(root, 'taku.site.json'), JSON.stringify({ workerEntrypoint: 'dist/worker.mjs', assetsDirectory: 'dist/assets',
    siteManifest: { manifestVersion: 1, auth: { mode: 'required', scopes: ['media.image.generate'] },
      integrations: [{ name: 'media', operations: ['image_generate'], scopes: ['media.image.generate'] }],
      storage: { type: 'turso', migrations: false }, egress: { mode: 'platform-proxy' } } }));
  assert.equal((await dispatch(args('sites-validate', { project: root }))).status, 'sites_valid');
  assert.equal((await dispatch(args('sites-build', { project: root }))).status, 'sites_built');
  await writeFile(path.join(root, 'dist/assets/app.mjs'), "import { createTakuSitesClient } from './taku-sites-sdk.mjs'; const client = createTakuSitesClient(); void client.media.listImageModels({ operation: 'media.image.edit' });\n");
  await assert.rejects(dispatch(args('sites-validate', { project: root })));
  await assert.rejects(dispatch(args('sites-build', { project: root })));
});

test('native Publisher model discovery reads only the bounded authenticated live catalogue with strict flags', async t => {
  await withSitesSession(t);
  const seen = [];
  let body = { schema: 'taku.image-model-catalog.v1', catalogVersion: 'a'.repeat(64),
    observedAt: '2026-10-05T15:00:00Z', models: [], nextCursor: null };
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, auth: request.headers.authorization, cookie: request.headers.cookie });
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const flags = { 'worker-url': `http://127.0.0.1:${server.address().port}`, 'allow-custom-worker-url': true,
    operation: 'media.image.generate', query: '  FLUX  ', limit: '2' };
  const result = await dispatch(args('sites-image-models', flags));
  assert.equal(result.status, 'sites_image_models');
  assert.equal(result.operation, 'media.image.generate'); assert.equal(result.surface, 'site-published');
  assert.deepEqual(result.catalog, body);
  assert.deepEqual(seen, [{ method: 'GET', url: '/v1/sites/capabilities/image-models?operation=media.image.generate&limit=2&query=flux',
    auth: 'Bearer taku_pub_test_contract_session', cookie: undefined }]);
  for (const patch of [{ surface: 'subapp' }, { payer: 'other' }, { operation: 'media.video.generate' }, { limit: '101' },
    { cursor: '../private' }, { query: '界'.repeat(50) }, { operation: true }, { query: true }, { cursor: true },
    { limit: '0' }, { limit: '01' }, { limit: true }, { 'provider-url': 'https://supplier.invalid' }])
    await assert.rejects(dispatch(args('sites-image-models', { ...flags, ...patch })), { code: 'sites_image_model_query_invalid' });
  assert.equal(seen.length, 1);
  body = { ...body, provider_key: 'private' };
  await assert.rejects(dispatch(args('sites-image-models', flags)), { code: 'sites_image_model_catalog_unavailable' });
  body = { ...body, provider_key: 'x'.repeat(524289) };
  await assert.rejects(dispatch(args('sites-image-models', flags)), { code: 'sites_image_model_catalog_unavailable' });
});

test('native Publisher model discovery preserves stable policy/status/request ID without provider error text', async t => {
  await withSitesSession(t);
  const server = createServer((_request, response) => {
    response.writeHead(403, { 'Content-Type': 'application/json', 'X-Request-Id': `req_${'c'.repeat(32)}` });
    response.end(JSON.stringify({ error_code: 'SITE_CAPABILITY_INTERNAL_ONLY', secret: 'provider private token' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(dispatch(args('sites-image-models', { operation: 'media.image.edit',
    'worker-url': `http://127.0.0.1:${server.address().port}`, 'allow-custom-worker-url': true })), error => {
    assert.equal(error.code, 'sites_api_error'); assert.equal(error.details.http_status, 403);
    assert.equal(error.details.server_error, 'SITE_CAPABILITY_INTERNAL_ONLY');
    assert.equal(error.details.request_id, `req_${'c'.repeat(32)}`);
    assert.doesNotMatch(JSON.stringify(error.details) + error.message, /provider private|secret/);
    return true;
  });
});

test('actual CLI Free second-Site preflight preserves the build and resumes to fresh confirmation after an upgrade, without cloud writes', async t => {
  const root = await withSitesSession(t);
  const project = path.join(root, 'draft');
  await dispatch(args('sites-init', { project }));
  const before = await dispatch(args('sites-validate', { project }));
  let upgraded = false, policyAvailable = true, writes = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'GET') writes++;
    const value = request.url === '/v1/sites/cli-session' ? { userId: 'owner-fixture', productAccess: 'allowed' }
      : request.url === '/v1/sites/publish-eligibility' ? { eligible: upgraded && policyAvailable,
        max: upgraded ? 3 : 1, occupied: 1, available: upgraded ? 2 : 0, quotaConfigured: policyAvailable }
      : request.url === '/v1/sites/slugs/chosen-site/availability' ? { slug: 'chosen-site', hostname: 'chosen-site.taku.site', available: true }
      : null;
    response.writeHead(value ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value ?? { error: 'unexpected_route' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const flags = { project, slug: 'chosen-site', 'worker-url': `http://127.0.0.1:${server.address().port}`, 'allow-custom-worker-url': true };
  await assert.rejects(dispatch(args('sites-publish', flags)), error => {
    assert.equal(error.code, 'sites_not_eligible');
    assert.equal(error.details.eligibility_reason, 'SITE_LIMIT_REACHED');
    assert.equal(error.details.upgrade_url, 'https://taku.ai/pricing');
    assert.equal(error.details.project_preserved, true);
    assert.equal(error.details.http_status, undefined, 'a successful preflight is not an HTTP 403');
    return true;
  });
  policyAvailable = false;
  await assert.rejects(dispatch(args('sites-publish', flags)), error => {
    assert.equal(error.details.upgrade_url, undefined, 'a policy outage is not a paid plan requirement');
    return true;
  });
  policyAvailable = true; upgraded = true;
  const resumed = await dispatch(args('sites-publish', flags));
  assert.equal(resumed.status, 'needs_input');
  assert.equal(resumed.confirm_target, 'chosen-site.taku.site');
  assert.equal(writes, 0);
  assert.equal((await dispatch(args('sites-validate', { project }))).content_digest, before.content_digest);
});

async function withSitesSession(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-sites-command-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.TAKU_PUBLISHER_HOME;
  process.env.TAKU_PUBLISHER_HOME = root;
  t.after(() => {
    if (previous === undefined) delete process.env.TAKU_PUBLISHER_HOME;
    else process.env.TAKU_PUBLISHER_HOME = previous;
  });
  await savePublisherSession({ accessToken: 'taku_pub_test_contract_session',
    expiresAt: Date.now() + 600_000, intent: 'publish_site',
    scopes: ['sites.read', 'sites.preview', 'sites.publish'] });
  return root;
}

test('Site template validates and builds locally; Publisher no longer offers a preview command', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-sites-command-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'site');
  const created = await dispatch(args('sites-init', { project }));
  assert.equal(created.status, 'sites_project_created');
  const validated = await dispatch(args('sites-validate', { project }));
  assert.equal(validated.status, 'sites_valid');
  const built = await dispatch(args('sites-build', { project }));
  assert.equal(built.status, 'sites_built');
  assert.equal(built.object_count, 2);
  assert.equal(built.artifact_digest, null);
  await assert.rejects(dispatch(args('sites-preview', { project })), (error) => error.code === 'unknown_command');
});

test('local validate/build reports quota-managed material choices without cloud identity', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-sites-material-summary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await dispatch(args('sites-init', { project: root }));
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
  await writeFile(path.join(root, 'dist/assets/logo.png'), png);
  await writeFile(path.join(root, 'taku.assets.json'), JSON.stringify({ schema: 'taku.sites.asset-manifest.v1', files: [{
    logicalPath: '/media/logo.png', sourcePath: 'dist/assets/logo.png', contentType: 'image/png', size: png.length,
    sha256: createHash('sha256').update(png).digest('hex'), retention: 'temporary', visibility: 'public',
  }] }));
  for (const command of ['sites-build', 'sites-validate']) {
    const result = await dispatch(args(command, { project: root }));
    assert.equal(result.project_id, null);
    assert.equal(result.artifact_digest, null);
    assert.equal(result.object_count, 2);
    assert.equal(result.material_count, 1);
    assert.equal(result.material_bytes, 24);
    assert.deepEqual(result.material_retention, { permanent: 0, temporary: 1, temporary_ttl_seconds: 2592000 });
  }
});

test('sites-contract passes the live server capability catalog through unchanged', async (t) => {
  await withSitesSession(t);
  const catalog = {
    version: 1,
    capabilities: [{
      apiId: 'airbnb', name: 'airbnb', operations: ['autocomplete', 'search', 'detail', 'price'],
      scopes: ['integration.airbnb.read'], status: 'ready', source: 'taku_managed',
      billing: 'taku_credits', inputKind: 'json', outputKind: 'json', preview: true, published: true,
      futureField: { kept: true },
    }],
  };
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
    const body = request.url === '/v1/sites/capabilities' ? catalog
      : request.url === '/v1/sites/assets/capabilities' ? ownerAssetCatalog : null;
    response.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body ?? { error: 'Not Found' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const workerUrl = `http://127.0.0.1:${server.address().port}`;
  const contract = await dispatch(args('sites-contract', { 'worker-url': workerUrl, 'allow-custom-worker-url': true }));
  assert.equal(contract.status, 'sites_contract');
  assert.equal(contract.contract_version, 'taku.sites.cli.v1');
  assert.deepEqual(contract.capabilities, catalog);
  assert.deepEqual(contract.owner_assets, ownerAssetCatalog);
  assert.equal(contract.owner_assets.visitorSdk, false);
  assert.equal(contract.owner_assets.policy.limitBytes, 100_000_000);
  assert.deepEqual(contract.image_models, {
    schema: 'taku.image-model-catalog.v1',
    command: 'sites-image-models --operation <media.image.generate|media.image.edit> [--query <text>] [--cursor <cursor>] [--limit 1..100]',
    operations: ['media.image.generate', 'media.image.edit'],
    surface: 'site-published', discovery_scope: 'sites.read',
    default_limit: 50, maximum_limit: 100, maximum_response_bytes: 524288, deadline_ms: 10000,
    inference: false, runtime_permission_required: true,
  });
  assert.deepEqual(seen, ['/v1/sites/capabilities', '/v1/sites/assets/capabilities'].map(url =>
    ({ method: 'GET', url, authorization: 'Bearer taku_pub_test_contract_session' })));
});

test('sites-contract rejects missing or forged owner capacity rather than exposing a local unlimited fallback', async t => {
  await withSitesSession(t);
  let ownerBody = null;
  let ownerStatus = 200;
  const server = createServer((request, response) => {
    const owner = request.url === '/v1/sites/assets/capabilities';
    response.writeHead(owner ? ownerStatus : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(owner ? ownerBody : { version: 1, capabilities: [] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const flags = { 'worker-url': `http://127.0.0.1:${server.address().port}`, 'allow-custom-worker-url': true };
  for (const patch of [
    { policy: { ...ownerAssetCatalog.policy, limitBytes: null } },
    { visitorSdk: true },
    { operations: ownerAssetCatalog.operations.map(item => ({ ...item, reason: { toString: 'provider_unavailable' } })) },
    { ownerEmail: 'must-not-be-in-contract@example.invalid' },
  ]) {
    ownerBody = { ...ownerAssetCatalog, ...patch };
    await assert.rejects(dispatch(args('sites-contract', flags)), { code: 'sites_owner_contract_invalid' });
  }
  ownerStatus = 503;
  ownerBody = { error: 'SITE_STORAGE_POLICY_UNAVAILABLE' };
  await assert.rejects(dispatch(args('sites-contract', flags)), error =>
    error.code === 'sites_api_error' && error.details.server_error === 'SITE_STORAGE_POLICY_UNAVAILABLE');
});

test('sites-contract fails clearly when the catalog is unreachable or the user is signed out', async (t) => {
  const root = await withSitesSession(t);
  await assert.rejects(
    dispatch(args('sites-contract', { 'worker-url': 'http://127.0.0.1:9', 'allow-custom-worker-url': true })),
    (error) => error.code === 'sites_network_unavailable',
  );
  await rm(root, { recursive: true, force: true });
  await assert.rejects(dispatch(args('sites-contract')), (error) => ['sites_login_required', 'sites_scope_required'].includes(error.code));
});

test('sites-status distinguishes failed updates from an active old release and rejects another target', async t => {
  await withSitesSession(t);
  let boundProject = 'prj_test';
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(request.url === '/v1/sites/cli-session' ? { userId: 'fixture' }
      : request.url === '/v1/sites/prj_test' ? { projectId: 'prj_test', status: 'active', currentReleaseId: 'rel_old' }
      : { publishRequestId: 'req_test', projectId: boundProject, status: 'failed', releaseId: 'rel_new' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const flags = { 'project-id': 'prj_test', 'publish-request-id': 'req_test',
    'worker-url': `http://127.0.0.1:${server.address().port}`, 'allow-custom-worker-url': true };
  const result = await dispatch(args('sites-status', flags));
  assert.equal(result.site.currentReleaseId, 'rel_old');
  assert.deepEqual(result.publication, { publish_request_id: 'req_test', status: 'failed', release_id: 'rel_new' });
  boundProject = 'prj_other';
  await assert.rejects(dispatch(args('sites-status', flags)), { code: 'sites_target_changed' });
});

test('owner material CLI uses bounded authenticated library operations, exact delete confirmation and live permissions', async t => {
  await withSitesSession(t);
  const asset = { assetId: `ast_${'a'.repeat(32)}`, state: 'ready', retention: 'permanent', visibility: 'private',
    contentType: 'image/png', byteLength: 24, sha256: 'b'.repeat(64), expiresAt: null,
    createdAt: '2026-10-05T00:00:00.000Z', partBytes: 8388608, partCount: 1 };
  let catalog = structuredClone(ownerAssetCatalog);
  let item = asset;
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push({ method: request.method, path: request.url, auth: request.headers.authorization });
    let payload = request.url === '/v1/sites/assets/capabilities' ? catalog
      : request.url === '/v1/sites/assets/policy' ? catalog.policy
      : request.url.startsWith('/v1/sites/assets?') ? { assets: [item], next: null }
      : request.url === `/v1/sites/assets/${asset.assetId}` ? { ...item, ...(request.method === 'DELETE' ? { state: 'deleted' } : {}) } : null;
    if (request.method === 'DELETE') {
      const bytes = [];
      for await (const chunk of request) bytes.push(chunk);
      assert.equal(Buffer.concat(bytes).length, 0);
    }
    response.writeHead(payload ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(payload ?? { error: 'SITE_ASSET_NOT_FOUND' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const flags = { 'worker-url': `http://127.0.0.1:${server.address().port}`, 'allow-custom-worker-url': true };
  const policy = await dispatch(args('sites-assets-policy', flags));
  assert.deepEqual(policy.policy, catalog.policy);
  const list = await dispatch(args('sites-assets-list', { ...flags, limit: '1', after: `ast_${'0'.repeat(32)}` }));
  assert.deepEqual(list.assets, [asset]);
  assert.equal(requests.at(-1).path, `/v1/sites/assets?limit=1&after=ast_${'0'.repeat(32)}`);
  const resolved = await dispatch(args('sites-assets-resolve', { ...flags, 'asset-id': asset.assetId }));
  assert.deepEqual(resolved.asset, asset);
  assert.equal(resolved.content_fetched, false);
  assert.equal(resolved.download_command, `sites-assets-download --asset-id ${asset.assetId} --output <new-local-file>`);
  const count = requests.length;
  for (const patch of [{}, { 'confirm-asset-id': `ast_${'c'.repeat(32)}` }]) {
    await assert.rejects(dispatch(args('sites-assets-delete', { ...flags, 'asset-id': asset.assetId, ...patch })),
      { code: 'sites_asset_delete_confirmation_required' });
  }
  assert.equal(requests.length, count);
  const deleted = await dispatch(args('sites-assets-delete', { ...flags, 'asset-id': asset.assetId, 'confirm-asset-id': asset.assetId }));
  assert.equal(deleted.asset.state, 'deleted');
  assert.equal(deleted.status, 'sites_asset_deleted');
  assert.ok(requests.every(request => request.auth === 'Bearer taku_pub_test_contract_session'));
  catalog.operations = catalog.operations.map(operation => ({ ...operation, authorized: false }));
  const before = requests.filter(request => request.method === 'DELETE').length;
  await assert.rejects(dispatch(args('sites-assets-delete', { ...flags, 'asset-id': asset.assetId, 'confirm-asset-id': asset.assetId })),
    { code: 'sites_owner_operation_unavailable' });
  assert.equal(requests.filter(request => request.method === 'DELETE').length, before);
  catalog = structuredClone(ownerAssetCatalog);
  item = { ...asset, objectKey: 'must-not-be-exposed' };
  await assert.rejects(dispatch(args('sites-assets-resolve', { ...flags, 'asset-id': asset.assetId })),
    { code: 'sites_owner_response_invalid' });
  for (const [command, patch] of [['sites-assets-list', { limit: '101' }],
    ['sites-assets-resolve', { 'asset-id': '../another-owner' }]]) {
    await assert.rejects(dispatch(args(command, { ...flags, ...patch })), { code: 'sites_asset_arguments_invalid' });
  }
});
