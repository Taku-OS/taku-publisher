import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { dispatch } from '../dist/cli.js';
import { loadSitesCore } from '../dist/sites/core.js';
import { SitesHttpClient } from '../dist/sites/http.js';
import { imageModelStructuredCatalog } from './fixtures/image-model-structured-catalog.mjs';

const { core } = await loadSitesCore();
function catalog(edit = false) {
  const page = imageModelStructuredCatalog();
  Object.assign(page.models[0], { id: 'ratio-fixture', operations: [edit ? 'media.image.edit' : 'media.image.generate'], maximumInputs: edit ? 1 : 0 });
  page.models[0].parameters.aspect_ratio = { type: 'aspect-ratio', minimum: 0.0625, maximum: 16, default: '1920:1200' };
  return page;
}

test('immutable Publisher core reads exact custom ratio while old explicit formats refuse it', () => {
  assert.deepEqual(core.parseImageModelCatalog(catalog(), 'media.image.generate', 50, 'aspect-ratio-v1'), catalog());
  for (const feature of ['size-constraints-v1', 'size-constraints-v2', 'input-contract-v1', 'input-contract-v2', 'parameter-enum-v1', 'structured-parameters-v1'])
    assert.throws(() => core.parseImageModelCatalog(catalog(), 'media.image.generate', 50, feature));
  for (const bad of ['1:17', '01:1', '1:1\n', null]) {
    const page = catalog(); page.models[0].parameters.aspect_ratio.default = bad;
    assert.throws(() => core.parseImageModelCatalog(page, 'media.image.generate', 50, 'aspect-ratio-v1'));
  }
});

test('actual Publisher HTTP and immutable core discover full native Muse output count', async () => {
  for (const operation of ['media.image.generate', 'media.image.edit']) {
    const page = catalog(operation === 'media.image.edit');
    Object.assign(page.models[0], { id: 'muse-image', maximumOutputs: 10,
      maximumInputs: operation === 'media.image.edit' ? 10 : 0,
      parameterSchemaVersion: `muse-image-${operation === 'media.image.edit' ? 'edit' : 'generate'}-v2-2026-10-09` });
    page.models[0].parameters.num_images = { type: 'integer', minimum: 1, maximum: 10, default: 1 };
    const reader = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_test_muse', async () => Response.json(page));
    assert.deepEqual(await reader.getImageModelCatalog({ operation, limit: 50 }, core), page);
  }
});

test('actual exported Publisher SDK quotes ten Muse outputs and recovers without publishing credentials or resubmission', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-muse-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  assert.equal((await dispatch({ command: 'sites-sdk-export', flags: new Map([['output', output]]), rest: [] })).status, 'sites_sdk_exported');
  const { createTakuSitesClient } = await import(pathToFileURL(output).href);
  for (const operation of ['media.image.generate', 'media.image.edit']) {
    const schema = `muse-image-${operation === 'media.image.edit' ? 'edit' : 'generate'}-v2-2026-10-09`;
    const parameters = { num_images: 10, aspect_ratio: '1920:1200', output_format: 'webp', sync_mode: false };
    const input = { schema_version: 'taku.managed-media-request.v2', model: 'muse-image',
      parameter_schema_version: schema, prompt: 'Preserve ten outputs', parameters,
      ...(operation === 'media.image.edit' ? { input_ids: [`min_${'a'.repeat(32)}`] } : {}) };
    const executionId = 'imx_00000000000040008000000000000004';
    const execution = { schema_version: 'taku.image-model-execution.v1', execution_id: executionId,
      request_id: 'req_muse_original', model: 'muse-image', operation, status: 'quoted', terminal: false,
      cancellable: true, next_action: 'submit', model_receipt: null,
      quote: { schema: 'taku.image-model-quote.v1', quoteId: 'imq_00000000-0000-4000-8000-000000000005',
        model: 'muse-image', operation, parameterSchemaVersion: schema, normalizedParameters: parameters,
        priceVersion: 'fal-muse-image-output-quote-v1-2026-10-09', credits: '36.000000', expiresAt: '2026-10-09T16:00:00Z' } };
    const calls = [];
    const sdk = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => { calls.push(request); return Response.json(execution); } });
    assert.deepEqual(await sdk.media.quoteImageRequest(operation, input, { requestId: 'req_muse_original' }), execution);
    assert.deepEqual(await sdk.media.getImageExecution(operation, executionId), execution);
    assert.deepEqual(await sdk.media.findImageExecution(operation, 'req_muse_original'), execution);
    assert.deepEqual(calls.map(request => request.method), ['POST', 'GET', 'GET']);
    assert.deepEqual(await calls[0].json(), { request: input });
    assert.equal(calls[0].headers.get('Idempotency-Key'), 'req_muse_original');
    for (const name of ['Authorization', 'Cookie', 'X-Taku-Media-User']) assert.equal(calls[0].headers.has(name), false);
  }
});

test('native Publisher renews once and preserves ratio negotiation, query and identity for both operations', async () => {
  for (const operation of ['media.image.generate', 'media.image.edit']) {
    const seen = [];
    const page = catalog(operation === 'media.image.edit');
    const reader = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_test_ratio_old', async (url, init) => {
      seen.push(new Request(url, init));
      return seen.length === 1 ? Response.json({ error: 'authentication_required' }, { status: 401 }) : Response.json(page);
    }, false, async token => { assert.equal(token, 'taku_pub_test_ratio_old'); return 'taku_pub_test_ratio_new'; });
    assert.deepEqual(await reader.getImageModelCatalog({ operation, limit: 2, cursor: 'ratio_cursor' }, core), page);
    assert.deepEqual(seen.map(request => request.headers.get('Authorization')), ['Bearer taku_pub_test_ratio_old', 'Bearer taku_pub_test_ratio_new']);
    for (const request of seen) {
      assert.equal(request.headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
      assert.equal(new URL(request.url).pathname, '/v1/sites/capabilities/image-models');
      assert.equal(new URL(request.url).searchParams.get('cursor'), 'ratio_cursor');
      assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'error');
      assert.equal(request.headers.has('Cookie'), false);
    }
  }
});

test('actual CLI exported browser SDK discovers ratios without Publisher credentials', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-ratio-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  assert.equal((await dispatch({ command: 'sites-sdk-export', flags: new Map([['output', output]]), rest: [] })).status, 'sites_sdk_exported');
  const { createTakuSitesClient } = await import(pathToFileURL(output).href);
  const seen = [];
  const client = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => { seen.push(request); return Response.json(catalog()); } });
  assert.deepEqual(await client.media.listImageModels({ operation: 'media.image.generate' }), catalog());
  assert.equal(seen.length, 1); assert.equal(seen[0].headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
  for (const name of ['Authorization', 'Cookie', 'X-Taku-Media-User']) assert.equal(seen[0].headers.has(name), false);
});
