import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSitesCore } from '../dist/sites/core.js';
import { SitesHttpClient } from '../dist/sites/http.js';
import { PublisherError } from '../dist/util.js';
import { imageModelSizeCatalog } from './fixtures/image-model-size-catalog.mjs';
import { imageModelInputCatalog, imageModelReferenceMaskCatalog } from './fixtures/image-model-input-catalog.mjs';

const { core } = await loadSitesCore();
const query = { operation: 'media.image.edit', limit: 2 };
const page = { schema: 'taku.image-model-catalog.v1', catalogVersion: 'a'.repeat(64),
  observedAt: '2026-10-05T15:00:00Z', models: [], nextCursor: null };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('reference-mask v2 bundled reader preserves explicit policy and rejects old representations', () => {
  const catalog = imageModelReferenceMaskCatalog();
  for (const feature of [undefined, 'size-constraints-v1', 'size-constraints-v2', 'input-contract-v1']) {
    assert.throws(() => core.parseImageModelCatalog(catalog, 'media.image.edit', 2, feature));
  }
  const result = core.parseImageModelCatalog(catalog, 'media.image.edit', 2, 'input-contract-v2');
  assert.deepEqual(result, catalog);
  assert.deepEqual(result.models.map(model => [model.id, model.maximumInputs, model.priceVersion,
    model.availability['site-published'].status]), [
    ['gpt-image-2.5-flare-reference-mask', 17, '', 'unavailable'],
    ['gpt-image-2.5-sunburst-reference-mask', 17, '', 'unavailable'],
  ]);
  assert.equal(Object.hasOwn(result.models[0].parameters.mask_input, 'default'), false);
  assert.deepEqual(core.parseImageModelCatalog(imageModelInputCatalog(), 'media.image.edit', 4, 'input-contract-v2'),
    imageModelInputCatalog());
});

test('reference-mask v2 native metadata survives Publisher renewal without changing authority or representation', async () => {
  const seen = [];
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_old', async (url, init) => {
    seen.push({ url: String(url), method: init.method, headers: new Headers(init.headers), redirect: init.redirect });
    return seen.length === 1 ? Response.json({ error: 'authentication_required' }, { status: 401 })
      : Response.json(imageModelReferenceMaskCatalog());
  }, false, async expected => { assert.equal(expected, 'taku_pub_old'); return 'taku_pub_new'; });
  assert.deepEqual(await client.getImageModelCatalog(query, core), imageModelReferenceMaskCatalog());
  assert.deepEqual(seen.map(item => item.headers.get('X-Taku-Image-Model-Features')),
    ['generation-references-v1', 'generation-references-v1']);
  assert.deepEqual(seen.map(item => item.headers.get('Authorization')), ['Bearer taku_pub_old', 'Bearer taku_pub_new']);
  for (const item of seen) {
    assert.equal(item.url, 'https://worker.taku.ai/v1/sites/capabilities/image-models?operation=media.image.edit&limit=2');
    assert.equal(item.method, 'GET'); assert.equal(item.redirect, 'error');
    assert.equal(item.headers.has('Cookie'), false);
  }
});

test('reference-mask v2 native reader preserves provider-loss unavailable metadata with no price', async () => {
  const catalog = imageModelReferenceMaskCatalog();
  for (const model of catalog.models) {
    for (const surface of ['subapp', 'site-preview', 'site-published']) {
      model.availability[surface] = { status: 'unavailable', reason: 'provider_contract_unavailable' };
    }
  }
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => Response.json(catalog));
  assert.deepEqual(await client.getImageModelCatalog(query, core), catalog);
});

test('reference-mask v2 native reader refuses incomplete policy, inferred mask and authority fields', async () => {
  for (const defect of ['schema', 'missing', 'maximum', 'match', 'roles', 'dimensions', 'mask-default', 'count', 'generate', 'authority']) {
    const catalog = imageModelReferenceMaskCatalog();
    const model = catalog.models[0];
    if (defect === 'schema') model.inputContract.schema = 'taku.image-input-contract.v1';
    if (defect === 'missing') delete model.inputContract.referenceMask.maskParameter;
    if (defect === 'maximum') model.inputContract.referenceMask.maximumSources = 17;
    if (defect === 'match') model.inputContract.referenceMask.maskMatchesFirstSource = false;
    if (defect === 'roles') model.inputContract.roles = ['mask', 'source'];
    if (defect === 'dimensions') model.inputContract.sameDimensions = true;
    if (defect === 'mask-default') model.parameters.mask_input.default = 2;
    if (defect === 'count') model.maximumInputs = 16;
    if (defect === 'generate') model.operations = ['media.image.generate'];
    if (defect === 'authority') model.owner = 'another-user';
    const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => Response.json(catalog));
    await assert.rejects(client.getImageModelCatalog(query, core), { code: 'sites_image_model_catalog_unavailable' });
  }
});

test('bundled input-contract reader preserves ordered masks and ordinary grids only in the negotiated format', () => {
  const catalog = imageModelInputCatalog();
  for (const feature of [undefined, 'size-constraints-v1', 'size-constraints-v2']) {
    assert.throws(() => core.parseImageModelCatalog(catalog, 'media.image.edit', 4, feature));
  }
  const result = core.parseImageModelCatalog(catalog, 'media.image.edit', 4, 'input-contract-v1');
  assert.deepEqual(result, catalog);
  assert.deepEqual(result.models.slice(0, 3).map(model => [model.id, model.maximumInputs, model.maximumOutputs]),
    [['ideogram-v2-inpaint', 2, 1], ['ideogram-v2-turbo-inpaint', 2, 1], ['ideogram-v3-inpaint', 2, 4]]);
  assert.deepEqual(result.models[0].inputContract.roles, ['source', 'mask']);
  assert.equal(result.models[0].inputContract.sameDimensions, true);
  assert.equal(result.models[3].parameters.image_size.sizeConstraints.widthStep, 1);
  assert.equal(Object.hasOwn(result.models[3], 'inputContract'), false);
});

test('native input-contract discovery preserves masks and format across one Publisher renewal', async () => {
  const seen = [];
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_old', async (url, init) => {
    seen.push({ url: String(url), method: init.method, headers: new Headers(init.headers), redirect: init.redirect });
    return seen.length === 1 ? Response.json({ error: 'authentication_required' }, { status: 401 })
      : Response.json(imageModelInputCatalog());
  }, false, async expected => { assert.equal(expected, 'taku_pub_old'); return 'taku_pub_new'; });
  const result = await client.getImageModelCatalog({ operation: 'media.image.edit', limit: 4 }, core);
  assert.deepEqual(result, imageModelInputCatalog());
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map(item => item.headers.get('X-Taku-Image-Model-Features')),
    ['generation-references-v1', 'generation-references-v1']);
  assert.deepEqual(seen.map(item => item.headers.get('Authorization')), ['Bearer taku_pub_old', 'Bearer taku_pub_new']);
  for (const item of seen) {
    assert.equal(item.url, 'https://worker.taku.ai/v1/sites/capabilities/image-models?operation=media.image.edit&limit=4');
    assert.equal(item.method, 'GET'); assert.equal(item.redirect, 'error');
    assert.equal(item.headers.has('Cookie'), false);
  }
});

test('native input-contract discovery rejects malformed roles, dimensions and authority fields', async () => {
  for (const defect of ['reversed', 'duplicate', 'count', 'dimensions', 'schema', 'extra', 'authority', 'generate']) {
    const catalog = imageModelInputCatalog();
    const model = catalog.models[0];
    if (defect === 'reversed') model.inputContract.roles = ['mask', 'source'];
    if (defect === 'duplicate') model.inputContract.roles = ['source', 'source'];
    if (defect === 'count') model.maximumInputs = 1;
    if (defect === 'dimensions') model.inputContract.sameDimensions = false;
    if (defect === 'schema') model.inputContract.schema = 'supplier.mask';
    if (defect === 'extra') model.inputContract.provider_url = 'https://supplier.invalid';
    if (defect === 'authority') model.payer = 'another-user';
    if (defect === 'generate') model.operations = ['media.image.generate'];
    const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => Response.json(catalog));
    await assert.rejects(client.getImageModelCatalog({ operation: 'media.image.edit', limit: 4 }, core),
      { code: 'sites_image_model_catalog_unavailable' });
  }
});

test('bundled reader retains three-argument legacy format and requires explicitly negotiated grids', () => {
  const catalog = imageModelSizeCatalog();
  const legacy = structuredClone(catalog);
  delete legacy.models[0].parameters.image_size.sizeConstraints.widthStep;
  delete legacy.models[0].parameters.image_size.sizeConstraints.heightStep;
  assert.deepEqual(core.parseImageModelCatalog(legacy, 'media.image.generate', 2), legacy);
  assert.throws(() => core.parseImageModelCatalog(catalog, 'media.image.generate', 2));
  assert.deepEqual(core.parseImageModelCatalog(catalog, 'media.image.generate', 2, 'size-constraints-v2'), catalog);
  assert.throws(() => core.parseImageModelCatalog(legacy, 'media.image.generate', 2, 'size-constraints-v2'));
});

test('native size discovery preserves generate and edit constraints with fixed format negotiation', async () => {
  for (const operation of ['media.image.generate', 'media.image.edit']) {
    const catalog = imageModelSizeCatalog(operation);
    const seen = [];
    const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async (url, init) => {
      seen.push({ url: String(url), method: init.method, headers: new Headers(init.headers), redirect: init.redirect });
      return Response.json(catalog);
    });
    const result = await client.getImageModelCatalog({ operation, limit: 2 }, core);
    assert.deepEqual(result, catalog);
    assert.equal(result.models[0].availability['site-published'].status, 'unavailable');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, `https://worker.taku.ai/v1/sites/capabilities/image-models?operation=${operation}&limit=2`);
    assert.equal(seen[0].method, 'GET'); assert.equal(seen[0].redirect, 'error');
    assert.equal(seen[0].headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
    assert.equal(seen[0].headers.get('Authorization'), 'Bearer taku_pub_fixture');
    assert.equal(seen[0].headers.has('Cookie'), false);
  }
});

test('native size discovery retains nonempty legacy catalog and unknown parameter metadata', async () => {
  for (const unknown of [false, true]) {
    const catalog = imageModelSizeCatalog();
    delete catalog.models[0].parameters.image_size.sizeConstraints;
    if (unknown) catalog.models[0].parameters = null;
    const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => Response.json(catalog));
    assert.deepEqual(await client.getImageModelCatalog({ operation: 'media.image.generate', limit: 2 }, core), catalog);
  }
});

test('native size discovery refuses invalid dimensions area aspect and defaults', async () => {
  for (const defect of ['dimensions', 'area', 'aspect', 'default']) {
    const catalog = imageModelSizeCatalog();
    const parameter = catalog.models[0].parameters.image_size;
    if (defect === 'dimensions') parameter.sizeConstraints.minWidth = 4097;
    if (defect === 'area') parameter.sizeConstraints.minPixels = 4194305;
    if (defect === 'aspect') parameter.sizeConstraints.minAspectRatio = 17;
    if (defect === 'default') parameter.default = { width: 512, height: 512 };
    const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => Response.json(catalog));
    await assert.rejects(client.getImageModelCatalog({ operation: 'media.image.generate', limit: 2 }, core),
      { code: 'sites_image_model_catalog_unavailable' });
  }
});

test('native grid discovery refuses missing steps, invalid steps and off-grid defaults', async () => {
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
    const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture',
      async () => Response.json(catalog));
    await assert.rejects(client.getImageModelCatalog({ operation: 'media.image.generate', limit: 2 }, core),
      { code: 'sites_image_model_catalog_unavailable' });
  }
});

test('native model reader preserves fixed origin, exact pagination and Publisher-only authorization', async () => {
  const seen = [];
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async (url, init) => {
    seen.push({ url: String(url), method: init.method, headers: init.headers, redirect: init.redirect });
    return Response.json(page);
  });
  assert.deepEqual(await client.getImageModelCatalog({ ...query, query: 'nano', cursor: 'YWJj' }, core), page);
  assert.deepEqual(seen, [{ url: 'https://worker.taku.ai/v1/sites/capabilities/image-models?operation=media.image.edit&limit=2&query=nano&cursor=YWJj',
    method: 'GET', headers: { Authorization: 'Bearer taku_pub_fixture', Accept: 'application/json',
      'X-Taku-Image-Model-Features': 'generation-references-v1' }, redirect: 'error' }]);
});

test('native model reader sanitizes HTTP failures and refuses noncanonical request IDs or excessive retries', async () => {
  for (const [status, code] of [[400, 'invalid_image_model_catalog_query'], [401, 'authentication_required'],
    [403, 'insufficient_scope'], [423, 'site_frozen'], [429, 'site_media_rate_limited'], [502, 'image_model_catalog_unavailable']]) {
    const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => Response.json({ error: 'provider private token' }, {
      status, headers: { 'X-Request-Id': `REQ_${'B'.repeat(32)}`, 'Retry-After': '3601' },
    }));
    await assert.rejects(client.getImageModelCatalog(query, core), error => {
      assert.equal(error.code, 'sites_api_error');
      assert.deepEqual(error.details, { http_status: status, server_error: code, request_id: null });
      assert.doesNotMatch(error.message, /private|token/);
      return true;
    });
  }
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => Response.json({ error: 'site_media_rate_limited' }, {
    status: 429, headers: { 'X-Request-Id': `req_${'c'.repeat(32)}`, 'Retry-After': '12' },
  }));
  await assert.rejects(client.getImageModelCatalog(query, core), error => {
    assert.deepEqual(error.details, { http_status: 429, server_error: 'site_media_rate_limited',
      request_id: `req_${'c'.repeat(32)}`, retry_after_seconds: 12 });
    return true;
  });
});

test('native model reader renews Publisher authorization once without changing operation or deadline', async () => {
  const tokens = [];
  const features = [];
  let renewals = 0;
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_old', async (_url, init) => {
    tokens.push(init.headers.Authorization);
    features.push(new Headers(init.headers).get('X-Taku-Image-Model-Features'));
    return tokens.length === 1 ? Response.json({ error: 'authentication_required' }, { status: 401 }) : Response.json(page);
  }, false, async expected => { assert.equal(expected, 'taku_pub_old'); renewals++; return 'taku_pub_new'; });
  assert.deepEqual(await client.getImageModelCatalog(query, core), page);
  assert.deepEqual(tokens, ['Bearer taku_pub_old', 'Bearer taku_pub_new']);
  assert.deepEqual(features, ['generation-references-v1', 'generation-references-v1']);
  assert.equal(renewals, 1);
  let attempts = 0;
  const denied = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_old', async () => {
    attempts++; return Response.json({ error: 'authentication_required' }, { status: 401 });
  }, false, async () => 'taku_pub_new');
  await assert.rejects(denied.getImageModelCatalog(query, core), error => error.details.server_error === 'authentication_required');
  assert.equal(attempts, 2);
});

test('native model reader does not passthrough provider-like transport or renewal exceptions', async () => {
  const privateError = () => new PublisherError('provider private token', 'sites_api_error', { secret: 'private' });
  const transport = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => { throw privateError(); });
  const renewal = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () =>
    Response.json({ error: 'authentication_required' }, { status: 401 }), false, async () => { throw privateError(); });
  for (const [client, code] of [[transport, 'sites_image_model_catalog_unavailable'], [renewal, 'sites_login_required']]) {
    await assert.rejects(client.getImageModelCatalog(query, core), error => {
      assert.equal(error.code, code);
      assert.doesNotMatch(JSON.stringify(error.details) + error.message, /private|secret/);
      return true;
    });
  }
});

test('native model reader bounds actual streamed bytes independently of Content-Length and cancels overflow', async () => {
  let cancelled = false;
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(8192)); }, cancel() { cancelled = true; },
  }), { headers: { 'Content-Type': 'application/json', 'Content-Length': '1' } }));
  await assert.rejects(client.getImageModelCatalog(query, core), { code: 'sites_image_model_catalog_unavailable' });
  assert.equal(cancelled, true);
});

test('native model reader rejects forged catalog metadata and malformed content without returning provider fields', async () => {
  for (const body of [{ ...page, provider_key: 'private' }, { ...page, schema: 'supplier.catalog' }]) {
    const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => Response.json(body));
    await assert.rejects(client.getImageModelCatalog(query, core), { code: 'sites_image_model_catalog_unavailable' });
  }
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => new Response('provider private token', {
    headers: { 'Content-Type': 'text/html' },
  }));
  await assert.rejects(client.getImageModelCatalog(query, core), error => error.code === 'sites_image_model_catalog_unavailable'
    && !/private|token/.test(error.message));
});

test('native model reader cancels a stalled body and never sends a pre-aborted read', async () => {
  let calls = 0, cancelled = false;
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', async () => {
    calls++; return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/json' } });
  });
  const controller = new AbortController();
  const pending = client.getImageModelCatalog(query, core, controller.signal);
  const rejected = assert.rejects(pending, { code: 'sites_image_model_catalog_unavailable' });
  await tick(); controller.abort(); await rejected;
  assert.equal(cancelled, true);
  await assert.rejects(client.getImageModelCatalog(query, core, controller.signal), { code: 'sites_image_model_catalog_unavailable' });
  assert.equal(calls, 1);
});

test('native model reader prevents a late renewal from sending another request after cancellation', async () => {
  let calls = 0, finishRenewal;
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_old', async () => {
    calls++; return Response.json({ error: 'authentication_required' }, { status: 401 });
  }, false, () => new Promise(resolve => { finishRenewal = resolve; }));
  const controller = new AbortController();
  const rejected = assert.rejects(client.getImageModelCatalog(query, core, controller.signal), { code: 'sites_image_model_catalog_unavailable' });
  await tick(); assert.equal(typeof finishRenewal, 'function'); controller.abort(); await rejected;
  finishRenewal('taku_pub_new'); await tick(); assert.equal(calls, 1);
});

test('native model reader bounds stalled transport to ten seconds and closes a late response', async () => {
  let finishFetch, signal, cancelled = false;
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_fixture', (_url, init) => {
    signal = init.signal; return new Promise(resolve => { finishFetch = resolve; });
  });
  const started = performance.now();
  await assert.rejects(client.getImageModelCatalog(query, core), { code: 'sites_image_model_catalog_unavailable' });
  assert.ok(performance.now() - started >= 9500 && performance.now() - started < 20000);
  assert.equal(signal.aborted, true);
  finishFetch(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/json' } }));
  await tick(); assert.equal(cancelled, true);
});
