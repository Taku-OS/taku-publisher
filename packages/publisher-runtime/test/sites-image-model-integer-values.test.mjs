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
import { imageModelIntegerValuesCatalog } from './fixtures/image-model-integer-values-catalog.mjs';
import { imageModelSizeCatalog } from './fixtures/image-model-size-catalog.mjs';
import { imageModelReferenceMaskCatalog } from './fixtures/image-model-input-catalog.mjs';

const { core } = await loadSitesCore();
const FEATURE = 'parameter-enum-v1';
const HIGHEST_FEATURE = 'generation-references-v1';
const read = page => core.parseImageModelCatalog(page, 'media.image.generate', 50, FEATURE);
const reference = new URL('../../../skills/taku-sites/references/image-models.md', import.meta.url);

test('actual bundled numeric catalog retains exact numbers, grids, copies and unavailable pricing', () => {
  const source = imageModelIntegerValuesCatalog();
  const result = read(source);
  assert.deepEqual(result.models[0].parameters.num_inference_steps,
    { type: 'integer', minimum: 1, maximum: 8, default: 4, integerValues: [1, 2, 4, 8] });
  assert.equal(result.models[0].parameters.image_size.sizeConstraints.widthStep, 32);
  assert.equal(result.models[0].priceVersion, '');
  assert.equal(result.models[0].availability['site-published'].status, 'unavailable');
  result.models[0].parameters.num_inference_steps.integerValues[0] = 3;
  assert.deepEqual(source.models[0].parameters.num_inference_steps.integerValues, [1, 2, 4, 8]);
});

test('actual bundled numeric reader rejects malformed sets and defaults rather than widening a range', () => {
  assert.equal(read(imageModelIntegerValuesCatalog()).models.length, 1);
  const sparse = [1, 2, 4]; delete sparse[1];
  for (const patch of [
    { integerValues: null }, { integerValues: [] }, { integerValues: sparse },
    { integerValues: [1, 1, 4] }, { integerValues: [4, 2, 8] }, { integerValues: [1, '2', 4] },
    { integerValues: [1, null, 4] }, { integerValues: [1, 2.5, 4] },
    { integerValues: [9007199254740992] }, { integerValues: [NaN] },
    { integerValues: Array.from({ length: 65 }, (_, i) => i), minimum: 0, maximum: 64 },
    { type: 'number' }, { type: 'string' }, { type: 'enum', values: ['4'] },
    { default: 3 }, { default: '4' }, { minimum: 2 }, { maximum: 4 }, { callerControl: true },
  ]) {
    const source = imageModelIntegerValuesCatalog();
    Object.assign(source.models[0].parameters.num_inference_steps, patch);
    assert.throws(() => read(source), /image_model_catalog_unavailable/);
  }
  const maximum = imageModelIntegerValuesCatalog();
  Object.assign(maximum.models[0].parameters.num_inference_steps,
    { minimum: 0, maximum: 63, default: 4, integerValues: Array.from({ length: 64 }, (_, i) => i) });
  assert.equal(read(maximum).models.length, 1);
});

test('explicit numeric reader inherits seventeen-input masks and grids while older readers remain strict', () => {
  assert.equal(read(imageModelIntegerValuesCatalog()).models.length, 1);
  for (const feature of ['size-constraints-v1', 'size-constraints-v2', 'input-contract-v1', 'input-contract-v2']) {
    assert.throws(() => core.parseImageModelCatalog(imageModelIntegerValuesCatalog(), 'media.image.generate', 50, feature));
  }
  assert.deepEqual(core.parseImageModelCatalog(imageModelSizeCatalog(), 'media.image.generate', 50, 'size-constraints-v2'),
    imageModelSizeCatalog());
  const models = imageModelReferenceMaskCatalog();
  assert.deepEqual(core.parseImageModelCatalog(models, 'media.image.edit', 50, FEATURE), models);
  assert.equal(models.models[0].maximumInputs, 17);
  models.models[0].inputContract.referenceMask.maximumSources = 17;
  assert.throws(() => core.parseImageModelCatalog(models, 'media.image.edit', 50, FEATURE));
  const offGrid = imageModelIntegerValuesCatalog();
  offGrid.models[0].parameters.image_size.default.width = 1025;
  assert.throws(() => read(offGrid));
});

test('native Publisher highest metadata paging survives only one renewal with fixed origin and identity', async () => {
  const seen = []; let renewals = 0;
  const client = new SitesHttpClient('https://worker.taku.ai', 'taku_pub_old', async (url, init) => {
    const headers = new Headers(init.headers);
    seen.push({ url: String(url), method: init.method, headers, redirect: init.redirect, body: init.body });
    assert.equal(headers.get('X-Taku-Image-Model-Features'), HIGHEST_FEATURE);
    if (seen.length === 1) return Response.json({ error: 'authentication_required' }, { status: 401 });
    return Response.json({ ...imageModelIntegerValuesCatalog(), nextCursor: seen.length === 2 ? 'lightning_cursor' : null });
  }, false, async token => { renewals++; assert.equal(token, 'taku_pub_old'); return 'taku_pub_new'; });
  const query = { operation: 'media.image.generate', query: 'lightning', limit: 2 };
  const first = await client.getImageModelCatalog(query, core);
  const second = await client.getImageModelCatalog({ ...query, cursor: first.nextCursor }, core);
  assert.deepEqual(second.models[0].parameters.num_inference_steps.integerValues, [1, 2, 4, 8]);
  assert.equal(second.nextCursor, null); assert.equal(renewals, 1);
  assert.deepEqual(seen.map(item => item.headers.get('Authorization')),
    ['Bearer taku_pub_old', 'Bearer taku_pub_new', 'Bearer taku_pub_new']);
  assert.deepEqual(seen.map(item => item.url), [
    'https://worker.taku.ai/v1/sites/capabilities/image-models?operation=media.image.generate&limit=2&query=lightning',
    'https://worker.taku.ai/v1/sites/capabilities/image-models?operation=media.image.generate&limit=2&query=lightning',
    'https://worker.taku.ai/v1/sites/capabilities/image-models?operation=media.image.generate&limit=2&query=lightning&cursor=lightning_cursor',
  ]);
  for (const item of seen) {
    assert.equal(item.method, 'GET'); assert.equal(item.redirect, 'error');
    assert.equal(item.body, undefined); assert.equal(item.headers.has('Cookie'), false);
  }
});

test('actual CLI-exported browser SDK reads highest numeric metadata without identity or paid requests', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-numeric-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  assert.equal((await dispatch({ command: 'sites-sdk-export', flags: new Map([['output', output]]), rest: [] })).status,
    'sites_sdk_exported');
  const { createTakuSitesClient } = await import(pathToFileURL(output).href);
  const seen = [];
  const client = createTakuSitesClient({ baseUrl: 'https://numeric.taku.site', fetcher: async request => {
    seen.push(request); return Response.json({ ...imageModelIntegerValuesCatalog(), nextCursor: seen.length === 1 ? 'numeric_cursor' : null });
  } });
  const first = await client.media.listImageModels({ operation: 'media.image.generate', limit: 2 });
  const second = await client.media.listImageModels({ operation: 'media.image.generate', limit: 2, cursor: first.nextCursor });
  assert.deepEqual(first.models[0].parameters.num_inference_steps.integerValues, [1, 2, 4, 8]);
  assert.equal(second.nextCursor, null);
  assert.equal(seen.length, 2);
  for (const request of seen) {
    assert.equal(request.method, 'GET'); assert.equal(request.headers.get('X-Taku-Image-Model-Features'), HIGHEST_FEATURE);
    assert.equal(request.headers.get('X-Taku-CSRF'), '1');
    for (const name of ['Cookie', 'Authorization', 'Idempotency-Key']) assert.equal(request.headers.has(name), false);
    assert.equal(await request.text(), ''); assert.equal(request.credentials, 'same-origin');
  }
});

async function quoteRecipe() {
  const guidance = await readFile(reference, 'utf8');
  const runnable = guidance.match(/<!-- runnable:image-model-quote:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:image-model-quote:end -->/);
  assert.ok(runnable?.[1]);
  const sandbox = { Error, structuredClone };
  runInNewContext(`${runnable[1]}\nglobalThis.quote = quoteConfiguredImage;`, sandbox);
  return sandbox.quote;
}

function readyRecipeBoundary() {
  const catalog = imageModelIntegerValuesCatalog();
  // Complete controlled fixture for the runnable recipe only; never production readiness.
  catalog.models[0].availability['site-published'] = { status: 'ready' };
  catalog.models[0].priceVersion = 'fixture-only-price.v1';
  const quoted = [];
  return { catalog, quoted, api: {
    listImageModels: async () => catalog,
    quoteImageRequest: async (...args) => { quoted.push(args); return { request_id: args[2].requestId }; },
  } };
}

for (const [label, values] of [
  ['outside-set integers', [3, 5, 6, 7, 0, 9, 9007199254740992]],
  ['coercible or noninteger values', ['4', null, undefined, 4.2, NaN, Infinity]],
]) test(`actual runnable quote recipe rejects ${label} before quote transport`, async () => {
  const quote = await quoteRecipe();
  for (const value of values) {
    const boundary = readyRecipeBoundary();
    const choice = { operation: 'media.image.generate', model: 'sdxl-lightning',
      parameterSchemaVersion: 'sdxl-lightning-generate-v2-2026-10-08', parameters: { num_inference_steps: value } };
    const error = await quote(boundary.api, choice, { requestId: 'numeric-choice-test-001', prompt: 'A city' }, 'site-published')
      .then(() => undefined, error => error);
    assert.equal(boundary.quoted.length, 0, `${String(value)} must not enter the quote boundary`);
    assert.match(String(error), /image_model_parameters_invalid/);
  }
});

test('actual quote recipe preserves every legal number and original snapshot without default substitution', async () => {
  const quote = await quoteRecipe();
  for (const value of [1, 2, 4, 8]) {
    const boundary = readyRecipeBoundary();
    const choice = { operation: 'media.image.generate', model: 'sdxl-lightning',
      parameterSchemaVersion: 'sdxl-lightning-generate-v2-2026-10-08', parameters: { num_inference_steps: value } };
    const input = { requestId: 'numeric-choice-test-001', prompt: 'A city' };
    const pending = quote(boundary.api, choice, input, 'site-published');
    choice.parameters.num_inference_steps = 3; input.requestId = 'changed-after-call';
    const result = await pending;
    assert.equal(result.request_id, 'numeric-choice-test-001');
    assert.equal(boundary.quoted.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(boundary.quoted[0])), ['media.image.generate', {
      schema_version: 'taku.managed-media-request.v2', model: 'sdxl-lightning',
      parameter_schema_version: 'sdxl-lightning-generate-v2-2026-10-08', prompt: 'A city',
      parameters: { num_inference_steps: value },
    }, { requestId: 'numeric-choice-test-001' }]);
    assert.equal(boundary.quoted[0][2].signal, undefined);
  }
});

test('actual quote recipe preserves omitted parameter and refuses unavailable rather than inferring ready', async () => {
  const quote = await quoteRecipe();
  const boundary = readyRecipeBoundary();
  const choice = { operation: 'media.image.generate', model: 'sdxl-lightning',
    parameterSchemaVersion: 'sdxl-lightning-generate-v2-2026-10-08', parameters: {} };
  await quote(boundary.api, choice, { requestId: 'numeric-choice-test-001', prompt: 'A city' }, 'site-published');
  assert.deepEqual(boundary.quoted[0][1].parameters, {});
  const unavailable = { ...boundary.api, listImageModels: async () => imageModelIntegerValuesCatalog() };
  await assert.rejects(quote(unavailable, choice, { requestId: 'numeric-choice-test-002', prompt: 'A city' }, 'site-published'),
    /image_model_unavailable/);
  assert.equal(boundary.quoted.length, 1);
});
