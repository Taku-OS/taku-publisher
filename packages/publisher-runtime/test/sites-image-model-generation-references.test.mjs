import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { dispatch } from '../dist/cli.js';
import { loadSitesCore } from '../dist/sites/core.js';
import { SitesHttpClient } from '../dist/sites/http.js';
import { generationReferenceCatalog } from './fixtures/image-model-generation-references-catalog.mjs';

const { core } = await loadSitesCore();
const ids = Array.from({ length: 17 }, (_, index) => `min_${(index + 1).toString(16).padStart(32, '0')}`);
const executionId = '00000000-0000-4000-8000-000000000061';
const requestId = 'publisher-generation-reference-test-001';
const quoteId = 'imq_00000000-0000-4000-8000-000000000062';
const choice = { operation: 'media.image.generate', model: 'reference-generation-fixture',
  parameterSchemaVersion: 'fixture-references-v1', parameters: { num_images: 1 } };
const receipt = { schema_version: 'taku.image-model-execution.v1', execution_id: executionId,
  request_id: requestId, model: choice.model, operation: choice.operation, status: 'quoted', terminal: false,
  cancellable: true, next_action: 'submit', model_receipt: null,
  quote: { schema: 'taku.image-model-quote.v1', quoteId, model: choice.model, operation: choice.operation,
    parameterSchemaVersion: choice.parameterSchemaVersion, normalizedParameters: { num_images: 1 },
    priceVersion: 'fixture-only-price.v1', credits: '1.000000', expiresAt: '2026-10-09T23:00:00Z' } };

async function client(t, fetcher) {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-generation-reference-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  assert.equal((await dispatch({ command: 'sites-sdk-export', flags: new Map([['output', output]]), rest: [] })).status, 'sites_sdk_exported');
  const { createTakuSitesClient } = await import(pathToFileURL(output).href);
  return createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher });
}

test('immutable Publisher reads optional generation references without granting readiness; old readers refuse whole models', () => {
  const page = generationReferenceCatalog();
  assert.deepEqual(core.parseImageModelCatalog(page, choice.operation, 50, 'generation-references-v1'), page);
  for (const feature of ['size-constraints-v1', 'size-constraints-v2', 'input-contract-v1', 'input-contract-v2',
    'parameter-enum-v1', 'structured-parameters-v1', 'aspect-ratio-v1'])
    assert.throws(() => core.parseImageModelCatalog(page, choice.operation, 50, feature));
  for (const patch of [{ maximumInputs: 8 }, { maximumInputs: 17 },
    { inputContract: { ...page.models[0].inputContract, roles: ['source'] } },
    { inputContract: { ...page.models[0].inputContract, provider_url: 'https://evil.invalid' } }]) {
    const bad = generationReferenceCatalog(); Object.assign(bad.models[0], patch);
    assert.throws(() => core.parseImageModelCatalog(bad, choice.operation, 50, 'generation-references-v1'));
  }
});

test('native Publisher renews once and reads reference capacity using the fixed trusted metadata endpoint', async () => {
  const calls = [];
  const reader = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_test_references_old', async (url, init) => {
    calls.push(new Request(url, init));
    return calls.length === 1 ? Response.json({ error: 'authentication_required' }, { status: 401 })
      : Response.json(generationReferenceCatalog());
  }, false, async token => { assert.equal(token, 'taku_pub_test_references_old'); return 'taku_pub_test_references_new'; });
  assert.deepEqual(await reader.getImageModelCatalog({ operation: choice.operation, limit: 2, cursor: 'reference_cursor' }, core), generationReferenceCatalog());
  assert.deepEqual(calls.map(request => request.headers.get('Authorization')),
    ['Bearer taku_pub_test_references_old', 'Bearer taku_pub_test_references_new']);
  for (const request of calls) {
    assert.equal(request.headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
    assert.equal(new URL(request.url).pathname, '/v1/sites/capabilities/image-models');
    assert.equal(new URL(request.url).searchParams.get('cursor'), 'reference_cursor');
    assert.equal(request.method, 'GET'); assert.equal(request.redirect, 'error');
    assert.equal(request.headers.has('Cookie'), false);
  }
});

test('actual exported SDK preserves zero or ordered reference inputs and original quote/recovery IDs without submission', async t => {
  const calls = [];
  const sdk = await client(t, async request => {
    calls.push(request);
    return Response.json(new URL(request.url).pathname.endsWith('/models') ? generationReferenceCatalog() : receipt);
  });
  assert.deepEqual(await sdk.media.listImageModels({ operation: choice.operation }), generationReferenceCatalog());
  assert.equal(calls[0].headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
  for (const count of [0, 1, 9, 16]) {
    const input = { schema_version: 'taku.managed-media-request.v2', model: choice.model,
      parameter_schema_version: choice.parameterSchemaVersion, prompt: 'Keep chosen references',
      parameters: choice.parameters, input_ids: ids.slice(0, count) };
    assert.deepEqual(await sdk.media.quoteImageRequest(choice.operation, input, { requestId }), receipt);
    assert.deepEqual(await calls.at(-1).clone().json(), { request: input });
    assert.equal(calls.at(-1).headers.get('Idempotency-Key'), requestId);
  }
  assert.deepEqual(await sdk.media.getImageExecution(choice.operation, executionId), receipt);
  assert.deepEqual(await sdk.media.findImageExecution(choice.operation, requestId), receipt);
  assert.deepEqual(calls.map(request => request.method), ['GET', 'POST', 'POST', 'POST', 'POST', 'GET', 'GET']);
  const before = calls.length;
  for (const input_ids of [ids, new Array(1), [ids[0], ids[0]], ['https://evil.invalid'], [null]])
    await assert.rejects(sdk.media.quoteImageRequest(choice.operation, {
      schema_version: 'taku.managed-media-request.v2', model: choice.model,
      parameter_schema_version: choice.parameterSchemaVersion, prompt: 'Keep chosen references',
      parameters: choice.parameters, input_ids,
    }, { requestId }), /invalid_image_model_request/);
  assert.equal(calls.length, before);
  for (const request of calls) {
    for (const header of ['Authorization', 'Cookie', 'X-Taku-Media-User']) assert.equal(request.headers.has(header), false);
    assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'same-origin');
  }
});

test('actual exported SDK selects generation when creating and uploading an owned reference input', async t => {
  const calls = [];
  const inputId = `min_${'a'.repeat(32)}`;
  const token = `fixture.${'b'.repeat(64)}`;
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const sdk = await client(t, async request => {
    calls.push(request.clone());
    return request.method === 'POST'
      ? Response.json({ input_id: inputId, content_type: 'image/png', upload_path: `/__taku/media/inputs/${inputId}/content`,
          upload_token: token, expires_at: new Date(Date.now() + 300_000).toISOString() }, { status: 201 })
      : Response.json({ input_id: inputId, expires_at: new Date(Date.now() + 3600_000).toISOString() }, { status: 201 });
  });
  const permit = await sdk.media.createInput('image/png', { requestId: 'publisher-reference-upload-001', operation: 'media.image.generate' });
  assert.equal((await sdk.media.uploadInput(permit, new Blob([bytes], { type: 'image/png' }))).input_id, inputId);
  assert.deepEqual(await calls[0].json(), { content_type: 'image/png', operation: 'media.image.generate' });
  assert.deepEqual(new Uint8Array(await calls[1].arrayBuffer()), bytes);
  assert.equal(calls[1].headers.get('X-Taku-Media-Upload-Permit'), token);
  for (const request of calls) {
    assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'same-origin');
    for (const name of ['Authorization', 'Cookie', 'X-Taku-Media-User', 'X-Taku-Project-Id']) assert.equal(request.headers.has(name), false);
  }
});

test('executable reference recipe preserves generation references and rejects excess or legacy inputs before quote', async () => {
  const guidance = await readFile(new URL('../../../skills/taku-sites/references/image-models.md', import.meta.url), 'utf8');
  const runnable = guidance.match(/<!-- runnable:image-model-quote:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:image-model-quote:end -->/);
  assert.ok(runnable?.[1]);
  const sandbox = { Error, structuredClone };
  runInNewContext(`${runnable[1]}\nglobalThis.quote = quoteConfiguredImage;`, sandbox);
  const page = generationReferenceCatalog({ ready: true });
  const quotes = [];
  const api = { listImageModels: async () => page, quoteImageRequest: async (...args) => { quotes.push(args); return receipt; } };
  for (const count of [0, 1, 9]) {
    const input = { requestId, prompt: 'Keep chosen references', inputIds: ids.slice(0, count) };
    const pending = sandbox.quote(api, choice, input, 'site-published');
    input.inputIds.reverse(); input.requestId = 'mutated-request';
    assert.deepEqual(await pending, receipt);
    const actual = JSON.parse(JSON.stringify(quotes.at(-1)));
    assert.deepEqual(actual, [choice.operation, { schema_version: 'taku.managed-media-request.v2',
      model: choice.model, parameter_schema_version: choice.parameterSchemaVersion,
      prompt: 'Keep chosen references', parameters: choice.parameters, input_ids: ids.slice(0, count) }, { requestId }]);
  }
  const before = quotes.length;
  for (const inputIds of [ids.slice(0, 10), new Array(1), [ids[0], ids[0]], ['https://evil.invalid'], [null]])
    await assert.rejects(sandbox.quote(api, choice, { requestId, prompt: 'Keep chosen references', inputIds }, 'site-published'), /image_model_inputs_invalid/);
  assert.equal(quotes.length, before);
  delete page.models[0].inputContract; page.models[0].maximumInputs = 0;
  await assert.rejects(sandbox.quote(api, choice, { requestId, prompt: 'Keep chosen references', inputIds: [ids[0]] }, 'site-published'), /image_model_inputs_invalid/);
  assert.equal(quotes.length, before);
});

async function siteInputRecipe() {
  const guidance = await readFile(new URL('../../../skills/taku-sites/references/image-models.md', import.meta.url), 'utf8');
  const runnable = guidance.match(/<!-- runnable:site-image-input:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:site-image-input:end -->/);
  assert.ok(runnable?.[1], 'public input guidance must carry an executable selected-operation upload');
  const sandbox = { Error, Blob, structuredClone };
  runInNewContext(`${runnable[1]}\nglobalThis.acquire = uploadConfiguredSiteImage;`, sandbox);
  assert.equal(typeof sandbox.acquire, 'function');
  return sandbox.acquire;
}

async function sourceQuoteRecipe() {
  const guidance = await readFile(new URL('../../../skills/taku-sites/references/image-models.md', import.meta.url), 'utf8');
  const runnable = guidance.match(/<!-- runnable:image-model-quote:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:image-model-quote:end -->/);
  assert.ok(runnable?.[1]);
  const sandbox = { Error, structuredClone };
  runInNewContext(`${runnable[1]}\nglobalThis.quote = quoteConfiguredImage;`, sandbox);
  return sandbox.quote;
}

function sourcePage() {
  const page = generationReferenceCatalog({ ready: true }), model = page.models[0];
  model.id = 'luma-uni-1'; model.operations = ['media.image.edit'];
  model.parameterSchemaVersion = 'luma-uni-1-edit-v2-2026-10-09';
  model.maximumInputs = 9; model.maximumOutputs = 1; delete model.inputContract;
  model.parameters = { num_images: { type: 'integer', minimum: 1, maximum: 1, default: 1 },
    source_input: { type: 'integer', minimum: 1, maximum: 9, default: 1 } };
  return page;
}

test('public source recipe preserves all nine IDs and explicit original through the actual exported SDK', async t => {
  const quote = await sourceQuoteRecipe(), calls = [], page = sourcePage();
  const selected = { operation: 'media.image.edit', model: 'luma-uni-1',
    parameterSchemaVersion: 'luma-uni-1-edit-v2-2026-10-09', parameters: { num_images: 1, source_input: 5 } };
  const sdk = await client(t, async request => {
    calls.push(request.clone());
    if (new URL(request.url).pathname.endsWith('/models')) return Response.json(page);
    const response = structuredClone(receipt); response.model = selected.model; response.operation = selected.operation;
    Object.assign(response.quote, { model: selected.model, operation: selected.operation,
      parameterSchemaVersion: selected.parameterSchemaVersion, normalizedParameters: { num_images: 1, source_input: 5 } });
    return Response.json(response);
  });
  await quote(sdk.media, selected, { requestId, prompt: 'Use the fifth original', inputIds: ids.slice(0, 9) }, 'site-published');
  assert.deepEqual(await calls[1].json(), { request: { schema_version: 'taku.managed-media-request.v2',
    model: 'luma-uni-1', parameter_schema_version: 'luma-uni-1-edit-v2-2026-10-09',
    prompt: 'Use the fifth original', parameters: { num_images: 1, source_input: 5 }, input_ids: ids.slice(0, 9) } });
  assert.equal(calls[1].headers.get('Idempotency-Key'), requestId);
  assert.deepEqual(selected.parameters, { num_images: 1, source_input: 5 });
});

test('public source recipe rejects ambiguous or impossible original slots before the quote transport', async t => {
  const quote = await sourceQuoteRecipe(), page = sourcePage();
  for (const source of [0, 3, 10, 1.5, '1', null, undefined]) {
    const calls = [], selected = { operation: 'media.image.edit', model: 'luma-uni-1',
      parameterSchemaVersion: 'luma-uni-1-edit-v2-2026-10-09',
      parameters: source === undefined ? { num_images: 1 } : { num_images: 1, source_input: source } };
    const sdk = await client(t, async request => {
      calls.push(request.clone());
      if (new URL(request.url).pathname.endsWith('/models')) return Response.json(page);
      const body = await request.clone().json();
      const response = structuredClone(receipt); response.model = selected.model; response.operation = selected.operation;
      Object.assign(response.quote, { model: selected.model, operation: selected.operation,
        parameterSchemaVersion: selected.parameterSchemaVersion, normalizedParameters: body.request.parameters });
      return Response.json(response);
    });
    await assert.rejects(quote(sdk.media, selected, { requestId, prompt: 'Choose an original', inputIds: ids.slice(0, 2) },
      'site-published'), /image_model_source_selection_required|image_model_inputs_invalid/);
    assert.deepEqual(calls.map(request => request.method), ['GET']);
  }
  for (const inputIds of [[], [ids[0], ids[0]], ['https://evil.invalid'], new Array(1), ids.slice(0, 10)]) {
    const calls = [], sdk = await client(t, async request => {
      calls.push(request.clone()); return Response.json(page);
    });
    const selected = { operation: 'media.image.edit', model: 'luma-uni-1',
      parameterSchemaVersion: 'luma-uni-1-edit-v2-2026-10-09', parameters: { num_images: 1, source_input: 1 } };
    await assert.rejects(quote(sdk.media, selected, { requestId, prompt: 'Choose an original', inputIds },
      'site-published'), /image_model_inputs_invalid/);
    assert.deepEqual(calls.map(request => request.method), ['GET']);
  }
});

test('public source recipe uses a live single-image default without inserting unselected controls', async t => {
  const quote = await sourceQuoteRecipe(), page = sourcePage(), calls = [];
  const selected = { operation: 'media.image.edit', model: 'luma-uni-1',
    parameterSchemaVersion: 'luma-uni-1-edit-v2-2026-10-09', parameters: { num_images: 1 } };
  const sdk = await client(t, async request => {
    calls.push(request.clone());
    if (new URL(request.url).pathname.endsWith('/models')) return Response.json(page);
    const response = structuredClone(receipt); response.model = selected.model; response.operation = selected.operation;
    Object.assign(response.quote, { model: selected.model, operation: selected.operation,
      parameterSchemaVersion: selected.parameterSchemaVersion, normalizedParameters: { num_images: 1 } });
    return Response.json(response);
  });
  await quote(sdk.media, selected, { requestId, prompt: 'One original', inputIds: [ids[0]] }, 'site-preview');
  assert.deepEqual(await calls[1].json(), { request: { schema_version: 'taku.managed-media-request.v2',
    model: 'luma-uni-1', parameter_schema_version: 'luma-uni-1-edit-v2-2026-10-09', prompt: 'One original',
    parameters: { num_images: 1 }, input_ids: [ids[0]] } });
  assert.deepEqual(selected.parameters, { num_images: 1 });
});

test('public input recipe binds both image operations and reuses a saved permit after upload response loss', async t => {
  const acquire = await siteInputRecipe();
  for (const operation of ['media.image.generate', 'media.image.edit']) {
    const calls = []; let saved; let loseFirstUpload = true;
    const inputId = ids[0], token = `fixture.${'b'.repeat(64)}`;
    const permit = { input_id: inputId, content_type: 'image/png', upload_path: `/__taku/media/inputs/${inputId}/content`,
      upload_token: token, expires_at: new Date(Date.now() + 300000).toISOString() };
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const sdk = await client(t, async request => {
      calls.push(request.clone());
      if (request.method === 'POST') return Response.json(permit, { status: 201 });
      assert.ok(saved, 'checkpoint must be saved before bytes');
      if (loseFirstUpload) { loseFirstUpload = false; throw new Error('controlled upload response loss'); }
      return Response.json({ input_id: inputId, expires_at: new Date(Date.now() + 3600000).toISOString() }, { status: 201 });
    });
    const image = new Blob([bytes], { type: 'image/png' });
    await assert.rejects(acquire(sdk.media, image, { operation, requestId: 'publisher-reference-input-001' }, async value => { saved = value; }));
    assert.ok(saved);
    assert.equal((await acquire(sdk.media, image, saved, async () => { throw new Error('must reuse permit'); })).input_id, inputId);
    assert.deepEqual(calls.map(request => request.method), ['POST', 'PUT', 'PUT']);
    assert.deepEqual(await calls[0].json(), { content_type: 'image/png', operation });
    assert.equal(calls[0].headers.get('Idempotency-Key'), 'publisher-reference-input-001');
    for (const request of calls.slice(1)) {
      assert.equal(request.headers.get('X-Taku-Media-Upload-Permit'), token);
      assert.deepEqual(new Uint8Array(await request.arrayBuffer()), bytes);
    }
    for (const request of calls) for (const header of ['Authorization', 'Cookie', 'X-Taku-Media-User', 'X-Taku-Project-Id']) assert.equal(request.headers.has(header), false);
  }
});

test('public input recipe stops before bytes on persistence failure and before permit on invalid image', async t => {
  const acquire = await siteInputRecipe(); const calls = [];
  const sdk = await client(t, async request => {
    calls.push(request.clone()); return Response.json({ input_id: ids[0], content_type: 'image/png',
      upload_path: `/__taku/media/inputs/${ids[0]}/content`, upload_token: `fixture.${'d'.repeat(64)}`,
      expires_at: new Date(Date.now() + 300000).toISOString() }, { status: 201 });
  });
  const checkpoint = { operation: 'media.image.generate', requestId: 'publisher-reference-input-002' };
  await assert.rejects(acquire(sdk.media, new Blob(['image'], { type: 'image/png' }), checkpoint,
    async () => { throw new Error('checkpoint_not_saved'); }), /checkpoint_not_saved/);
  assert.deepEqual(calls.map(request => request.method), ['POST']);
  for (const image of [new Blob([], { type: 'image/png' }), new Blob(['image'], { type: 'video/mp4' }),
    new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'image/png' })]) {
    await assert.rejects(acquire(sdk.media, image, checkpoint, async () => {}), /image_model_input_invalid/);
  }
  assert.equal(calls.length, 1, 'invalid files do not reserve upload inputs');
});
