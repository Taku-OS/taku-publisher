import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { dispatch } from '../dist/cli.js';

const executionId = '00000000-0000-4000-8000-000000000041';
const quoteId = 'imq_00000000-0000-4000-8000-000000000042';
const requestId = 'publisher-image-test-001';
const methods = ['quoteImageRequest', 'submitImageRequest', 'getImageExecution',
  'findImageExecution', 'cancelImageExecution', 'getImageOutputs', 'getImageOutputLink'];
const args = (command, flags = {}) => ({ command, flags: new Map(Object.entries(flags)), rest: [] });

async function exportedClient(t, fetcher) {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-image-executions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  assert.equal((await dispatch(args('sites-sdk-export', { output }))).status, 'sites_sdk_exported');
  const sdk = await import(pathToFileURL(output).href);
  return { ...sdk, client: sdk.createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher }) };
}

test('GPT budget exported SDK preserves maximum reservation and settled actual charge on original recovery', async t => {
  const operation = 'media.image.edit';
  const value = fixture(operation);
  const request = { ...value.request, model: 'gpt-image-2.5-flare',
    parameter_schema_version: 'gpt-image-2.5-flare-edit-budget-v1-2026-10-10', parameters: {} };
  const { credits: _credits, ...common } = value.execution.quote;
  const quote = { ...common, schema: 'taku.image-model-quote.v2', billingMode: 'metered_budget',
    maximumCredits: '18.000000', model: request.model, parameterSchemaVersion: request.parameter_schema_version,
    priceVersion: 'gpt25-standard-direct-edit-budget-v1-2026-10-10', normalizedParameters: {
      quality: 'low', image_size: { width: 1024, height: 1024 }, num_images: 1,
      output_format: 'png', background: 'auto', enable_safety_checker: true, sync_mode: false } };
  const quoted = { ...value.execution, model: request.model, quote };
  const receipt = { schema: 'taku.image-model-receipt.v2', billingMode: 'metered_budget',
    quoteId, selectedModel: request.model, operation, parameterSchemaVersion: request.parameter_schema_version,
    priceVersion: quote.priceVersion, maximumCredits: '18.000000', chargedCredits: '5.176800', billingStatus: 'settled' };
  const completed = { ...quoted, status: 'completed', terminal: true, cancellable: false,
    next_action: 'none', model_receipt: receipt };
  let response = quoted;
  const calls = [];
  const { client } = await exportedClient(t, async request => {
    calls.push(request); return Response.json(response);
  });
  assert.deepEqual(await client.media.quoteImageRequest(operation, request, { requestId }), quoted);
  response = completed;
  const recovered = await client.media.getImageExecution(operation, executionId);
  assert.deepEqual(recovered, completed);
  assert.equal(recovered.model_receipt.chargedCredits, '5.176800');
  assert.equal(recovered.quote.maximumCredits, '18.000000');
  assert.equal(Object.hasOwn(recovered.quote, 'credits'), false);
  assert.deepEqual(await client.media.findImageExecution(operation, requestId), completed);
  assert.deepEqual(calls.map(request => request.method), ['POST', 'GET', 'GET']);
  assert.deepEqual(await calls[0].json(), { request });
  for (const patch of [{ chargedCredits: '18.000001' }, { maximumCredits: '19.000000' },
    { selectedModel: 'nano-banana-pro' }, { quotedCredits: '18.000000' }]) {
    response = { ...completed, model_receipt: { ...receipt, ...patch } };
    await assert.rejects(client.media.getImageExecution(operation, executionId), /invalid_platform_response/);
  }
  const { billingMode: _mode, maximumCredits: _maximum, ...fixedFields } = quote;
  response = { ...quoted, quote: { ...fixedFields, schema: 'taku.image-model-quote.v1', credits: '18.000000' } };
  await assert.rejects(client.media.getImageExecution(operation, executionId), /invalid_platform_response/);
  response = { ...completed, model_receipt: { schema: 'taku.image-model-receipt.v1',
    quoteId, selectedModel: request.model, operation, parameterSchemaVersion: request.parameter_schema_version,
    priceVersion: quote.priceVersion, quotedCredits: '18.000000', chargedCredits: '5.176800', billingStatus: 'settled' } };
  await assert.rejects(client.media.getImageExecution(operation, executionId), /invalid_platform_response/);
  response = { ...quoted, quote: { ...quote, maximumCredits: '0.000000' } };
  await assert.rejects(client.media.getImageExecution(operation, executionId), /invalid_platform_response/);
});

test('exported SDK keeps full Kling Unicode negative prompts through quote and original recovery', async t => {
  for (const negative_prompt of ['海'.repeat(2500), '🌊'.repeat(2500)]) {
    const model = 'kling-image-v3';
    const version = 'kling-image-v3-generate-v2-2026-10-08';
    const parameters = { num_images: 1, resolution: '1K', output_format: 'png',
      aspect_ratio: '16:9', sync_mode: false, negative_prompt };
    const value = fixture('media.image.generate');
    Object.assign(value.request, { model, parameter_schema_version: version, parameters });
    Object.assign(value.execution, { model });
    Object.assign(value.execution.quote, { model, parameterSchemaVersion: version,
      normalizedParameters: parameters, priceVersion: 'fal-kling-image-output-quote-v1-2026-10-08',
      credits: '10.080000' });
    const calls = [];
    const { client } = await exportedClient(t, async request => {
      calls.push(request); return Response.json(value.execution);
    });
    assert.deepEqual(await client.media.quoteImageRequest('media.image.generate', value.request, { requestId }), value.execution);
    assert.deepEqual(await client.media.getImageExecution('media.image.generate', executionId), value.execution);
    assert.deepEqual(await client.media.findImageExecution('media.image.generate', requestId), value.execution);
    assert.deepEqual(calls.map(request => request.method), ['POST', 'GET', 'GET']);
    assert.deepEqual(await calls[0].json(), { request: value.request });
    assert.equal(calls[0].headers.get('Idempotency-Key'), requestId);
    value.execution.quote.normalizedParameters = { ...parameters, negative_prompt: 'a'.repeat(2501) };
    await assert.rejects(client.media.getImageExecution('media.image.generate', executionId), /invalid_platform_response/);
    const before = calls.length;
    await assert.rejects(client.media.quoteImageRequest('media.image.generate', { ...value.request,
      parameters: { ...parameters, negative_prompt: 'a'.repeat(2501) } }, { requestId }), /invalid_image_model_request/);
    assert.equal(calls.length, before);
  }
});

for (const selected of [
  { model: 'nano-banana-pro', version: 'image-parameters.v1' },
  { model: 'gpt-image-2.5-flare-reference-mask', version: 'gpt-image-2.5-flare-reference-mask-edit-v2-2026-10-08' },
  { model: 'gpt-image-2.5-sunburst-reference-mask', version: 'gpt-image-2.5-sunburst-reference-mask-edit-v2-2026-10-08' },
]) {
  const source = 'min_00000000000000000000000000000001';
  const firstMissing = new Array(2); firstMissing[1] = source;
  const lastMissing = new Array(2); lastMissing[0] = source;
  for (const [label, input_ids] of [
    ['missing only slot', new Array(1)],
    ['missing first slot', firstMissing],
    ['missing last slot', lastMissing],
    ['undefined source', [undefined, source]],
    ['null source', [null, source]],
  ]) {
    test(`exported Site SDK rejects ${selected.model} ${label} before quote transport`, async t => {
      const calls = [];
      const { client } = await exportedClient(t, async request => {
        calls.push(request.clone());
        return Response.json({ error: 'image_model_unavailable' }, { status: 503 });
      });
      const request = { schema_version: 'taku.managed-media-request.v2', model: selected.model,
        parameter_schema_version: selected.version, prompt: 'Keep original references', input_ids,
        parameters: { num_images: 1 } };
      const rejected = await client.media.quoteImageRequest('media.image.edit', request, { requestId })
        .then(() => undefined, error => error);
      assert.equal(calls.length, 0, 'invalid source slots must not reach the actual exported SDK transport');
      assert.match(String(rejected), /invalid_image_model_request/);
      if (selected.model.endsWith('-reference-mask') && input_ids.length === 2) {
        await assert.rejects(client.media.quoteImageRequest('media.image.edit', {
          ...request, parameters: { num_images: 1, mask_input: 2 },
        }, { requestId }), /invalid_image_model_request/);
        assert.equal(calls.length, 0);
      }
    });
  }
}

test('reference-mask v2 exported SDK quotes seventeen owned inputs and resumes the original IDs without submit', async t => {
  const model = 'gpt-image-2.5-sunburst-reference-mask';
  const version = `${model}-edit-v2-2026-10-08`;
  const inputs = Array.from({ length: 17 }, (_, index) => `min_${(index + 1).toString(16).padStart(32, '0')}`);
  const request = { schema_version: 'taku.managed-media-request.v2', model,
    parameter_schema_version: version, prompt: 'Keep original references',
    parameters: { num_images: 1, mask_input: 17 }, input_ids: inputs };
  const receipt = { schema_version: 'taku.image-model-execution.v1', execution_id: executionId,
    request_id: requestId, model, operation: 'media.image.edit', status: 'quoted', terminal: false,
    cancellable: true, next_action: 'submit', model_receipt: null,
    quote: { schema: 'taku.image-model-quote.v1', quoteId, model, operation: 'media.image.edit',
      parameterSchemaVersion: version, normalizedParameters: { num_images: 1, mask_input: 17 },
      priceVersion: 'fixture-only-price.v1', credits: '12.000000',
      expiresAt: new Date(Date.now() + 60000).toISOString() } };
  const seen = [];
  const { client } = await exportedClient(t, async request => {
    seen.push({ request, body: request.method === 'POST' ? await request.clone().json() : null });
    return Response.json(receipt);
  });
  assert.equal((await client.media.quoteImageRequest('media.image.edit', request, { requestId })).quote.quoteId, quoteId);
  assert.equal((await client.media.getImageExecution('media.image.edit', executionId)).execution_id, executionId);
  assert.equal((await client.media.findImageExecution('media.image.edit', requestId)).request_id, requestId);
  assert.deepEqual(seen.map(item => [item.request.method, item.request.url]), [
    ['POST', 'https://fixture.taku.site/__taku/media/images/v2/edit/quotes'],
    ['GET', `https://fixture.taku.site/__taku/media/images/v2/edit/executions/${executionId}`],
    ['GET', `https://fixture.taku.site/__taku/media/images/v2/edit/by-request/${requestId}`],
  ]);
  assert.deepEqual(seen[0].body, { request });
  assert.equal(seen[0].request.headers.get('Idempotency-Key'), requestId);
  for (const item of seen) {
    assert.equal(item.request.headers.has('Authorization'), false);
    assert.equal(item.request.headers.has('Cookie'), false);
    assert.equal(item.request.credentials, 'same-origin'); assert.equal(item.request.redirect, 'error');
  }
});

test('reference-mask v2 exported SDK rejects implicit selectors before transport and retains old sixteen-input limit', async t => {
  let calls = 0;
  const { client } = await exportedClient(t, async () => { calls++; throw new Error('unexpected transport'); });
  const model = 'gpt-image-2.5-flare-reference-mask';
  const request = { schema_version: 'taku.managed-media-request.v2', model,
    parameter_schema_version: `${model}-edit-v2-2026-10-08`, prompt: 'An edit',
    parameters: { num_images: 1 }, input_ids: [`min_${'a'.repeat(32)}`, `min_${'b'.repeat(32)}`] };
  for (const selector of [0, 1, 3, 1.5, null, '2']) {
    await assert.rejects(client.media.quoteImageRequest('media.image.edit', {
      ...request, parameters: { num_images: 1, mask_input: selector },
    }, { requestId }), /invalid_image_model_request/);
  }
  const inputs = Array.from({ length: 17 }, (_, index) => `min_${(index + 1).toString(16).padStart(32, '0')}`);
  await assert.rejects(client.media.quoteImageRequest('media.image.edit', { ...request, input_ids: inputs }, { requestId }), /invalid_image_model_request/);
  await assert.rejects(client.media.quoteImageRequest('media.image.edit', { ...request, model: 'nano-banana-pro',
    parameter_schema_version: 'image-parameters.v1', input_ids: inputs }, { requestId }), /invalid_image_model_request/);
  assert.equal(calls, 0);
});

function fixture(operation) {
  const assetExpiry = new Date(Date.now() + 86400_000).toISOString();
  const request = { schema_version: 'taku.managed-media-request.v2', model: 'nano-banana-pro',
    parameter_schema_version: 'image-parameters.v1', prompt: 'A city', parameters: { num_images: 2 },
    ...(operation === 'media.image.edit' ? { input_ids: [`min_${'c'.repeat(32)}`] } : {}) };
  const execution = { schema_version: 'taku.image-model-execution.v1', execution_id: executionId,
    request_id: requestId, model: 'nano-banana-pro', operation, status: 'quoted', terminal: false,
    cancellable: true, next_action: 'submit', quote: { schema: 'taku.image-model-quote.v1', quoteId,
      model: 'nano-banana-pro', operation, parameterSchemaVersion: 'image-parameters.v1',
      normalizedParameters: { num_images: 2 }, priceVersion: 'fixture-price.v1', credits: '12.000000',
      expiresAt: new Date(Date.now() + 60_000).toISOString() }, model_receipt: null };
  const outputs = { schema_version: 'taku.image-model-outputs.v1', execution_id: executionId,
    request_id: requestId, output_count: 2, outputs: [
      { output_index: 0, state: 'ready', content_type: 'image/png', byte_length: 1024, asset_expires_at: assetExpiry },
      { output_index: 1, state: 'ready', content_type: 'image/webp', byte_length: 2048, asset_expires_at: assetExpiry },
    ] };
  const link = { schema_version: 'taku.image-model-download.v1', execution_id: executionId,
    request_id: requestId, output_index: 1, state: 'ready',
    url: `https://ai-proxy.taku.ai/media/assets/images/${executionId}/1/content?ticket=fixture.${'a'.repeat(43)}`,
    content_type: 'image/webp', byte_length: 2048,
    expires_at: new Date(Date.now() + 60_000).toISOString(), asset_expires_at: assetExpiry };
  return { request, execution, outputs, link };
}

for (const [operation, kind] of [['media.image.generate', 'generate'], ['media.image.edit', 'edit']]) {
  test(`exported ${kind} SDK preserves model and original task IDs through all seven v2 operations`, async t => {
    const value = fixture(operation);
    const seen = [];
    const { client } = await exportedClient(t, async request => {
      seen.push({ request, body: request.body ? await request.clone().json() : null });
      const route = new URL(request.url).pathname;
      if (route.endsWith('/assets')) return Response.json(value.outputs);
      if (route.endsWith('/assets/1/link')) return Response.json(value.link);
      if (route.endsWith('/cancel')) return Response.json({ ...value.execution, status: 'cancel_requested', next_action: 'poll' });
      if (route.endsWith('/submit')) return Response.json({ ...value.execution, status: 'submission_requested', next_action: 'poll' });
      return Response.json(value.execution);
    });
    const quoted = await client.media.quoteImageRequest(operation, value.request, { requestId });
    assert.equal(quoted.execution_id, executionId);
    assert.equal(quoted.request_id, requestId);
    assert.equal(quoted.model, 'nano-banana-pro');
    assert.equal(quoted.quote.credits, '12.000000');
    assert.equal(quoted.quote.normalizedParameters.num_images, 2);
    const submitted = await client.media.submitImageRequest(operation, executionId, quoteId);
    assert.equal(submitted.execution_id, executionId);
    assert.equal(submitted.quote.quoteId, quoteId);
    assert.equal((await client.media.getImageExecution(operation, executionId)).request_id, requestId);
    assert.equal((await client.media.findImageExecution(operation, requestId)).execution_id, executionId);
    assert.equal((await client.media.cancelImageExecution(operation, executionId)).next_action, 'poll');
    const outputs = await client.media.getImageOutputs(operation, executionId);
    assert.equal(outputs.output_count, 2);
    assert.deepEqual(outputs.outputs.map(output => [output.output_index, output.content_type, output.byte_length]),
      [[0, 'image/png', 1024], [1, 'image/webp', 2048]]);
    const link = await client.media.getImageOutputLink(operation, executionId, 1);
    assert.equal(link.url, `https://ai-proxy.taku.ai/media/assets/images/${executionId}/1/content?ticket=fixture.${'a'.repeat(43)}`);
    assert.equal(link.output_index, 1);
    assert.equal(link.asset_expires_at, value.link.asset_expires_at);
    const base = `https://fixture.taku.site/__taku/media/images/v2/${kind}`;
    assert.deepEqual(seen.map(({ request }) => [request.method, request.url]), [
      ['POST', `${base}/quotes`], ['POST', `${base}/executions/${executionId}/submit`],
      ['GET', `${base}/executions/${executionId}`], ['GET', `${base}/by-request/${requestId}`],
      ['POST', `${base}/executions/${executionId}/cancel`], ['GET', `${base}/executions/${executionId}/assets`],
      ['GET', `${base}/executions/${executionId}/assets/1/link`],
    ]);
    assert.deepEqual(seen.map(item => item.body), [{ request: value.request }, { quoteId }, null, null, {}, null, null]);
    assert.equal(seen[0].request.headers.get('Idempotency-Key'), requestId);
    for (const { request } of seen) {
      assert.equal(request.redirect, 'error');
      assert.equal(request.credentials, 'same-origin');
      assert.equal(request.cache, 'no-store');
      assert.equal(request.headers.get('X-Taku-CSRF'), '1');
      assert.equal(request.headers.has('Authorization'), false);
      assert.equal(request.headers.has('Cookie'), false);
    }
    assert.equal(seen.length, 7, 'link retrieval must not fetch image bytes or retry inference');
    value.execution = { ...value.execution, status: 'completed', terminal: true,
      cancellable: false, next_action: 'none', model_receipt: {
        schema: 'taku.image-model-receipt.v1', quoteId, selectedModel: value.execution.model,
        operation, parameterSchemaVersion: value.execution.quote.parameterSchemaVersion,
        priceVersion: value.execution.quote.priceVersion, quotedCredits: '12.000000',
        chargedCredits: '12.000000', billingStatus: 'settled',
      } };
    const settled = await client.media.getImageExecution(operation, executionId);
    assert.deepEqual(settled, value.execution);
    assert.equal(settled.model_receipt.quotedCredits, '12.000000');
    assert.equal(settled.model_receipt.chargedCredits, '12.000000');
    assert.deepEqual(await client.media.findImageExecution(operation, requestId), settled);
  });
}

test('exported v2 SDK rejects forged authority, input IDs and task identifiers before transport', async t => {
  let calls = 0;
  const { client } = await exportedClient(t, async () => { calls++; throw new Error('unexpected transport'); });
  const { request } = fixture('media.image.generate');
  for (const patch of [{ payer: 'other' }, { provider: 'fal' }, { model: 'fal-ai/private-model' },
    { parameters: { api_key: 'fixture' } }, { parameters: { num_images: 5 } },
    { input_ids: ['https://supplier.invalid/reference.png'] }]) {
    await assert.rejects(client.media.quoteImageRequest('media.image.generate', { ...request, ...patch }, { requestId }), /invalid_image_model_request/);
  }
  await assert.rejects(client.media.quoteImageRequest('media.image.edit', request, { requestId }), /invalid_image_model_request/);
  await assert.rejects(client.media.quoteImageRequest('media.image.generate', request, { requestId: '../bad' }), /invalid_request_id/);
  await assert.rejects(client.media.findImageExecution('media.image.generate', '../bad'), /invalid_request_id/);
  await assert.rejects(client.media.getImageExecution('media.image.generate', '../bad'), /invalid_image_execution_id/);
  await assert.rejects(client.media.submitImageRequest('media.image.generate', executionId, 'bad'), /invalid_image_quote_id/);
  await assert.rejects(client.media.getImageOutputLink('media.image.generate', executionId, 16), /invalid_image_output_index/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.media.quoteImageRequest('media.image.generate', request, { requestId, signal: controller.signal }));
  assert.equal(calls, 0);
});

test('exported SDK leaves exact generation model capacity to the server without retrying a denied quote', async t => {
  const calls = [];
  const { client } = await exportedClient(t, async request => {
    calls.push(request);
    return Response.json({ error: 'invalid_image_model_request' }, { status: 422 });
  });
  const { request } = fixture('media.image.generate');
  const input = { ...request, input_ids: [`min_${'c'.repeat(32)}`] };
  await assert.rejects(client.media.quoteImageRequest('media.image.generate', input, { requestId }), /invalid_image_model_request/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://fixture.taku.site/__taku/media/images/v2/generate/quotes');
  assert.deepEqual(await calls[0].clone().json(), { request: input });
  for (const header of ['Authorization', 'Cookie', 'X-Taku-Media-User']) assert.equal(calls[0].headers.has(header), false);
});

test('exported v2 SDK refuses mismatched quote bindings and ambiguous or oversized JSON', async t => {
  const value = fixture('media.image.generate');
  let reply = () => Response.json(value.execution);
  const { client } = await exportedClient(t, async () => reply());
  for (const patch of [{ request_id: 'another-request-id' }, { model: 'another-model' },
    { quote: { ...value.execution.quote, normalizedParameters: { num_images: 1 } } },
    { provider_url: 'https://supplier.invalid' }]) {
    reply = () => Response.json({ ...value.execution, ...patch });
    await assert.rejects(client.media.quoteImageRequest('media.image.generate', value.request, { requestId }), /invalid_platform_response/);
  }
  reply = () => new Response('{"model":"nano-banana-pro","model":"other"}', { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(client.media.getImageExecution('media.image.generate', executionId), /invalid_platform_response/);
  reply = () => new Response(' '.repeat(131073) + '{}', { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(client.media.getImageExecution('media.image.generate', executionId), /invalid_platform_response/);
  reply = () => Response.json({ ...value.link, output_index: 0 });
  await assert.rejects(client.media.getImageOutputLink('media.image.generate', executionId, 1), /invalid_platform_response/);
  reply = () => Response.json({ ...value.link, url: 'https://supplier.invalid/raw.png' });
  await assert.rejects(client.media.getImageOutputLink('media.image.generate', executionId, 1), /invalid_platform_response/);
});

test('exported v2 SDK reports safe policy evidence without retry or provider error leakage', async t => {
  let calls = 0;
  let status = 402, code = 'insufficient_credits';
  const { client, TakuSitesRequestError } = await exportedClient(t, async () => {
    calls++;
    return Response.json({ error: code, provider_message: 'fixture-private-provider-error' },
      { status, headers: { 'X-Request-Id': `req_${'b'.repeat(32)}` } });
  });
  const value = fixture('media.image.generate');
  await assert.rejects(client.media.submitImageRequest('media.image.generate', executionId, quoteId), error => {
    assert.ok(error instanceof TakuSitesRequestError);
    assert.equal(error.status, 402); assert.equal(error.code, 'insufficient_credits');
    assert.equal(error.requestId, `req_${'b'.repeat(32)}`);
    assert.doesNotMatch(error.message, /private-provider/);
    return true;
  });
  assert.equal(calls, 1);
  status = 502; code = 'fixture-private-provider-error';
  await assert.rejects(client.media.quoteImageRequest('media.image.generate', value.request, { requestId }), error => {
    assert.ok(error instanceof TakuSitesRequestError);
    assert.equal(error.status, 503); assert.equal(error.code, 'image_model_unavailable');
    assert.equal(error.requestId, `req_${'b'.repeat(32)}`);
    return true;
  });
  assert.equal(calls, 2);
});

for (const operation of ['media.image.generate', 'media.image.edit']) {
  test(`actual Publisher builds all declared ${operation} v2 methods and rejects undeclared authority`, async t => {
    const root = await mkdtemp(path.join(tmpdir(), 'publisher-image-execution-build-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await dispatch(args('sites-init', { project: root }));
    await dispatch(args('sites-sdk-export', { output: path.join(root, 'dist/assets/taku-sites-sdk.mjs') }));
    const entry = path.join(root, 'dist/assets/app.mjs');
    const first = `import { createTakuSitesClient } from './taku-sites-sdk.mjs'; const client = createTakuSitesClient();\n`;
    const input = JSON.stringify(fixture(operation).request);
    const calls = { quoteImageRequest: `${input}, { requestId: '${requestId}' }`,
      submitImageRequest: `'${executionId}', '${quoteId}'`, getImageExecution: `'${executionId}'`,
      findImageExecution: `'${requestId}'`, cancelImageExecution: `'${executionId}'`,
      getImageOutputs: `'${executionId}'`, getImageOutputLink: `'${executionId}', 1` };
    const source = first + methods.map(method => `void client.media.${method}('${operation}', ${calls[method]});`).join('\n') + '\n';
    await writeFile(entry, source);
    const scope = operation;
    const manifest = { manifestVersion: 1, auth: { mode: 'required', scopes: [scope] },
      integrations: [{ name: 'media', operations: [operation === 'media.image.generate' ? 'image_generate' : 'image_edit'], scopes: [scope] }],
      storage: { type: 'turso', migrations: false }, egress: { mode: 'platform-proxy' } };
    const config = { workerEntrypoint: 'dist/worker.mjs', assetsDirectory: 'dist/assets', siteManifest: manifest };
    await writeFile(path.join(root, 'taku.site.json'), JSON.stringify(config));
    assert.equal((await dispatch(args('sites-validate', { project: root }))).status, 'sites_valid');
    assert.equal((await dispatch(args('sites-build', { project: root }))).status, 'sites_built');
    const denied = operation === 'media.image.generate' ? 'media.image.edit' : 'media.image.generate';
    for (const method of methods) {
      await writeFile(entry, first + `void client.media.${method}('${denied}', ${calls[method]});\n`);
      await assert.rejects(dispatch(args('sites-validate', { project: root })), /SITE_SDK_CAPABILITY_UNDECLARED/);
      await assert.rejects(dispatch(args('sites-build', { project: root })), /SITE_SDK_CAPABILITY_UNDECLARED/);
    }
    await writeFile(entry, source);
    config.siteManifest.auth.scopes = [];
    config.siteManifest.integrations[0].scopes = [];
    await writeFile(path.join(root, 'taku.site.json'), JSON.stringify(config));
    await assert.rejects(dispatch(args('sites-validate', { project: root })));
    await assert.rejects(dispatch(args('sites-build', { project: root })));
  });
}
