import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { dispatch } from '../dist/cli.js';
import { savePublisherSession } from '../dist/auth.js';
import { loadSitesCore } from '../dist/sites/core.js';
import { SitesHttpClient } from '../dist/sites/http.js';
import { imageModelStructuredCatalog, structuredImagePrompt } from './fixtures/image-model-structured-catalog.mjs';
import { imageModelReferenceMaskCatalog } from './fixtures/image-model-input-catalog.mjs';

const FEATURE = 'structured-parameters-v1';
const SDK_FEATURE = 'generation-references-v1';
const { core } = await loadSitesCore();
const read = page => core.parseImageModelCatalog(page, 'media.image.generate', 50, FEATURE);
const args = (command, flags = {}) => ({ command, flags: new Map(Object.entries(flags)), rest: [] });

test('actual bundled structured reader retains closed schemas, native values, numeric choices and detached copies', () => {
  const page = imageModelStructuredCatalog();
  const result = read(page);
  assert.deepEqual(result, page);
  assert.deepEqual(result.models[0].parameters.num_inference_steps.integerValues, [1, 2, 4, 8]);
  assert.equal(result.models[0].parameters.image_size.sizeConstraints.widthStep, 32);
  assert.equal(result.models[0].availability['site-published'].status, 'unavailable');
  result.models[0].parameters.structured_prompt.structuredSchema.properties.scene.maxBytes = 10;
  result.models[0].parameters.structured_prompt.default.objects[0].count = 3;
  assert.equal(page.models[0].parameters.structured_prompt.structuredSchema.properties.scene.maxBytes, 128);
  assert.equal(page.models[0].parameters.structured_prompt.default.objects[0].count, 2);
  const masks = imageModelReferenceMaskCatalog();
  assert.deepEqual(core.parseImageModelCatalog(masks, 'media.image.edit', 50, FEATURE), masks);
  assert.equal(masks.models[0].maximumInputs, 17);
});

test('actual bundled structured reader rejects open schemas, bad defaults and unacknowledged representations', () => {
  assert.deepEqual(read(imageModelStructuredCatalog()), imageModelStructuredCatalog());
  for (const feature of ['size-constraints-v1', 'size-constraints-v2', 'input-contract-v1', 'input-contract-v2', 'parameter-enum-v1']) {
    assert.throws(() => core.parseImageModelCatalog(imageModelStructuredCatalog(), 'media.image.generate', 50, feature));
  }
  for (const patch of [{ nullable: true }, { additionalProperties: true }, { required: ['absent'] },
    { required: ['scene', 'scene'] }, { properties: {} },
    { properties: { source_url: { type: 'string', maxBytes: 64 } } },
    { properties: { scene: { type: 'string', maxBytes: 4097 } } },
    { properties: { scene: { type: 'integer', minimum: 0.5, maximum: 8 } } }]) {
    const page = imageModelStructuredCatalog();
    Object.assign(page.models[0].parameters.structured_prompt.structuredSchema, patch);
    assert.throws(() => read(page), /image_model_catalog_unavailable/);
  }
  const invalid = imageModelStructuredCatalog();
  invalid.models[0].parameters.structured_prompt.default = { scene: 'missing objects' };
  assert.throws(() => read(invalid), /image_model_catalog_unavailable/);
});

test('actual native structured discovery preserves representation, origin and identity through one renewal and pagination', async () => {
  const seen = []; let renewals = 0;
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_test_structured_old', async (url, init) => {
    seen.push({ url: String(url), method: init.method, headers: new Headers(init.headers), body: init.body, redirect: init.redirect });
    if (seen.length === 1) return Response.json({ error: 'authentication_required' }, { status: 401 });
    return Response.json({ ...imageModelStructuredCatalog(), nextCursor: seen.length === 2 ? 'structured_cursor' : null });
  }, false, async expected => {
    assert.equal(expected, 'taku_pub_test_structured_old'); renewals++; return 'taku_pub_test_structured_new';
  });
  const query = { operation: 'media.image.generate', query: 'structured', limit: 2 };
  const first = await client.getImageModelCatalog(query, core);
  const second = await client.getImageModelCatalog({ ...query, cursor: first.nextCursor }, core);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(second.models, imageModelStructuredCatalog().models);
  assert.equal(renewals, 1);
  assert.deepEqual(seen.map(item => item.headers.get('Authorization')), [
    'Bearer taku_pub_test_structured_old', 'Bearer taku_pub_test_structured_new', 'Bearer taku_pub_test_structured_new',
  ]);
  assert.deepEqual(seen.map(item => item.url), [
    'https://worker.taku.ai/v1/sites/capabilities/image-models?operation=media.image.generate&limit=2&query=structured',
    'https://worker.taku.ai/v1/sites/capabilities/image-models?operation=media.image.generate&limit=2&query=structured',
    'https://worker.taku.ai/v1/sites/capabilities/image-models?operation=media.image.generate&limit=2&query=structured&cursor=structured_cursor',
  ]);
  for (const item of seen) {
    assert.equal(item.headers.get('X-Taku-Image-Model-Features'), SDK_FEATURE);
    assert.equal(item.method, 'GET'); assert.equal(item.redirect, 'error');
    assert.equal(item.headers.has('Cookie'), false); assert.equal(item.body, undefined);
  }
});

test('actual native CLI structured catalog stays metadata-only over authenticated loopback HTTP', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-structured-session-'));
  const originalHome = process.env.TAKU_PUBLISHER_HOME;
  process.env.TAKU_PUBLISHER_HOME = root;
  t.after(async () => {
    if (originalHome === undefined) delete process.env.TAKU_PUBLISHER_HOME;
    else process.env.TAKU_PUBLISHER_HOME = originalHome;
    await rm(root, { recursive: true, force: true });
  });
  await savePublisherSession({ accessToken: 'taku_pub_structured_fixture',
    expiresAt: Date.now() + 600_000, intent: 'publish_site', scopes: ['sites.read', 'sites.preview', 'sites.publish'] });
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, auth: request.headers.authorization,
      feature: request.headers['x-taku-image-model-features'], cookie: request.headers.cookie });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(imageModelStructuredCatalog()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await dispatch(args('sites-image-models', { operation: 'media.image.generate', limit: '2',
    'worker-url': `http://127.0.0.1:${server.address().port}`, 'allow-custom-worker-url': true }));
  assert.equal(result.status, 'sites_image_models'); assert.equal(result.surface, 'site-published');
  assert.deepEqual(result.catalog, imageModelStructuredCatalog());
  assert.deepEqual(seen, [{ method: 'GET', url: '/v1/sites/capabilities/image-models?operation=media.image.generate&limit=2',
    auth: 'Bearer taku_pub_structured_fixture', feature: SDK_FEATURE, cookie: undefined }]);
});

test('actual CLI-exported SDK preserves structured discovery, nested quote identity and recovery without privileged headers', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-structured-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  assert.equal((await dispatch(args('sites-sdk-export', { output }))).status, 'sites_sdk_exported');
  const { createTakuSitesClient } = await import(pathToFileURL(output).href);
  const executionId = '00000000-0000-4000-8000-000000000071';
  const requestId = 'structured-publisher-original-001';
  const parameters = { num_images: 1, structured_prompt: structuredImagePrompt() };
  const input = { schema_version: 'taku.managed-media-request.v2', model: 'test-structured-image',
    parameter_schema_version: 'fixture-structured-v1', prompt: 'Describe the scene', parameters };
  const execution = { schema_version: 'taku.image-model-execution.v1', execution_id: executionId,
    request_id: requestId, model: input.model, operation: 'media.image.generate', status: 'quoted',
    terminal: false, cancellable: true, next_action: 'submit', model_receipt: null,
    quote: { schema: 'taku.image-model-quote.v1', quoteId: `imq_${executionId}`, model: input.model,
      operation: 'media.image.generate', parameterSchemaVersion: input.parameter_schema_version,
      normalizedParameters: structuredClone(parameters), priceVersion: 'fixture-only-price.v1',
      credits: '1.000000', expiresAt: new Date(Date.now() + 60000).toISOString() } };
  const seen = [];
  const client = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
    seen.push(request.clone());
    return Response.json(new URL(request.url).pathname === '/__taku/media/models' ? imageModelStructuredCatalog() : execution);
  } });
  assert.deepEqual(await client.media.listImageModels({ operation: 'media.image.generate' }), imageModelStructuredCatalog());
  assert.deepEqual(await client.media.quoteImageRequest('media.image.generate', input, { requestId }), execution);
  assert.deepEqual(await client.media.getImageExecution('media.image.generate', executionId), execution);
  assert.deepEqual(await client.media.findImageExecution('media.image.generate', requestId), execution);
  assert.deepEqual(seen.map(request => [request.method, new URL(request.url).pathname]), [
    ['GET', '/__taku/media/models'], ['POST', '/__taku/media/images/v2/generate/quotes'],
    ['GET', `/__taku/media/images/v2/generate/executions/${executionId}`],
    ['GET', `/__taku/media/images/v2/generate/by-request/${requestId}`],
  ]);
  assert.equal(seen[0].headers.get('X-Taku-Image-Model-Features'), SDK_FEATURE);
  assert.deepEqual(await seen[1].json(), { request: input });
  assert.equal(seen[1].headers.get('Idempotency-Key'), requestId);
  for (const request of seen) {
    assert.equal(request.headers.has('Authorization'), false); assert.equal(request.headers.has('Cookie'), false);
    assert.equal(request.credentials, 'same-origin'); assert.equal(request.redirect, 'error');
  }
  for (const changed of [{ ...structuredImagePrompt(), scene: 'another scene' },
    { ...structuredImagePrompt(), background: '' }, { ...structuredImagePrompt(), objects: [] }]) {
    execution.quote.normalizedParameters = { ...parameters, structured_prompt: changed };
    await assert.rejects(client.media.quoteImageRequest('media.image.generate', input, { requestId }), /invalid_platform_response/);
  }
  const before = seen.length;
  await assert.rejects(client.media.quoteImageRequest('media.image.generate', {
    ...input, parameters: { ...parameters, structured_prompt: { source_url: 'https://foreign.invalid' } },
  }, { requestId }), /invalid_image_model_request/);
  assert.equal(seen.length, before);
});
