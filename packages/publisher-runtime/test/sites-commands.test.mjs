import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { dispatch } from '../dist/cli.js';
import { savePublisherSession } from '../dist/auth.js';
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
    response.writeHead(request.url === '/v1/sites/capabilities' ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(request.url === '/v1/sites/capabilities' ? catalog : { error: 'Not Found' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const workerUrl = `http://127.0.0.1:${server.address().port}`;
  const contract = await dispatch(args('sites-contract', { 'worker-url': workerUrl, 'allow-custom-worker-url': true }));
  assert.equal(contract.status, 'sites_contract');
  assert.equal(contract.contract_version, 'taku.sites.cli.v1');
  assert.deepEqual(contract.capabilities, catalog);
  assert.deepEqual(seen, [{ method: 'GET', url: '/v1/sites/capabilities', authorization: 'Bearer taku_pub_test_contract_session' }]);
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
