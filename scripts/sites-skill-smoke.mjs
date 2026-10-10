#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { imageModelSizeCatalog } from '../packages/publisher-runtime/test/fixtures/image-model-size-catalog.mjs';
import { imageModelIntegerValuesCatalog } from '../packages/publisher-runtime/test/fixtures/image-model-integer-values-catalog.mjs';
import { imageModelStructuredCatalog, structuredImagePrompt } from '../packages/publisher-runtime/test/fixtures/image-model-structured-catalog.mjs';
import { imageModelInputCatalog, imageModelReferenceMaskCatalog } from '../packages/publisher-runtime/test/fixtures/image-model-input-catalog.mjs';
import { generationReferenceCatalog } from '../packages/publisher-runtime/test/fixtures/image-model-generation-references-catalog.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  path.join('dist', 'skills', 'taku-sites'),
  ...['codex', 'claude', 'cursor'].map(host =>
    path.join('dist', 'plugins', host, 'taku-publisher', 'skills', 'taku-sites')),
];
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-sites-skill-smoke-'));

try {
  for (const target of targets) {
    const source = path.join(repositoryRoot, target);
    const skill = path.join(temporary, path.basename(path.dirname(target)), target.replaceAll(path.sep, '_'));
    await fs.cp(source, skill, { recursive: true });
    const instructions = await fs.readFile(path.join(skill, 'SKILL.md'), 'utf8');
    assert.match(instructions, /^---\nname: taku-sites\n/m);
    for (const notice of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
      await fs.access(path.join(skill, notice));
    }
    await fs.access(path.join(skill, 'node_modules', '@taku', 'publisher-runtime', 'sites-core', 'index.mjs'));
    const cli = path.join(skill, 'scripts', 'taku-publisher.mjs');
    for (const reference of ['contract.md', 'capabilities.md', 'storage.md', 'testing.md']) {
      await fs.access(path.join(skill, 'references', reference));
    }
    // The capability catalog is live-only: without a Sites session it must fail clearly, not fall back.
    const contract = run(cli, ['sites-contract', '--json'], skill, temporary, { fail: true });
    assert.equal(contract.error.code, 'sites_login_required');
    const models = run(cli, ['sites-image-models', '--operation', 'media.image.generate', '--json'], skill, temporary, { fail: true });
    assert.equal(models.error.code, 'sites_login_required');
    const invalidModels = run(cli, ['sites-image-models', '--operation', 'media.image.generate', '--surface', 'subapp', '--json'], skill, temporary, { fail: true });
    assert.equal(invalidModels.error.code, 'sites_image_model_query_invalid');
    const removed = run(cli, ['sites-preview', '--json'], skill, temporary, { fail: true });
    assert.equal(removed.error.code, 'unknown_command');
    const project = path.join(temporary, `project-${target.replaceAll(path.sep, '-')}`);
    const initialized = run(cli, ['sites-init', '--project', project, '--json'], skill, temporary);
    assert.equal(initialized.status, 'sites_project_created');
    await fs.writeFile(path.join(project, 'dist', 'assets', 'index.html'),
      '<!doctype html><html lang="en"><title>Agent-built Site</title><main><h1>Agent-built Site</h1><button id="hello">Hello</button></main><script type="module" src="/app.mjs"></script></html>');
    await fs.writeFile(path.join(project, 'dist', 'assets', 'app.mjs'),
      'document.querySelector("#hello").addEventListener("click", () => { document.querySelector("#hello").textContent = "Clicked"; });\n');
    const sdk = run(cli, ['sites-sdk-export', '--output', path.join(project, 'dist/assets/taku-sites-sdk.mjs'), '--json'], skill, temporary);
    assert.equal(sdk.status, 'sites_sdk_exported');
    const { createTakuSitesClient } = await import(pathToFileURL(path.join(project, 'dist/assets/taku-sites-sdk.mjs')).href);
    const modelRequests = [];
    const imageRequestId = 'copied-skill-image-test-001';
    const imageRequest = { schema_version: 'taku.managed-media-request.v2', model: 'nano-banana-pro',
      parameter_schema_version: 'image-parameters.v1', prompt: 'A city', parameters: { num_images: 2 } };
    const browser = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
      modelRequests.push(request);
      if (new URL(request.url).pathname === '/__taku/media/images/v2/generate/quotes') {
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.get('Idempotency-Key'), imageRequestId);
        assert.deepEqual(await request.clone().json(), { request: imageRequest });
        return Response.json({ schema_version: 'taku.image-model-execution.v1',
          execution_id: '00000000-0000-4000-8000-000000000041', request_id: imageRequestId,
          model: 'nano-banana-pro', operation: 'media.image.generate', status: 'quoted', terminal: false,
          cancellable: true, next_action: 'submit', model_receipt: null,
          quote: { schema: 'taku.image-model-quote.v1', quoteId: 'imq_00000000-0000-4000-8000-000000000042',
            model: 'nano-banana-pro', operation: 'media.image.generate', parameterSchemaVersion: 'image-parameters.v1',
            normalizedParameters: { num_images: 2 }, priceVersion: 'fixture-price.v1', credits: '12.000000',
            expiresAt: new Date(Date.now() + 60000).toISOString() } });
      }
      assert.equal(new URL(request.url).pathname, '/__taku/media/models');
      return Response.json(imageModelSizeCatalog(new URL(request.url).searchParams.get('operation')));
    } });
    const sizedCatalog = await browser.media.listImageModels({ operation: 'media.image.generate', limit: 2 });
    assert.deepEqual(sizedCatalog, imageModelSizeCatalog());
    assert.equal(sizedCatalog.models[0].availability['site-published'].status, 'unavailable');
    assert.equal(modelRequests.length, 1);
    assert.equal(modelRequests[0].url, 'https://fixture.taku.site/__taku/media/models?operation=media.image.generate&limit=2');
    assert.equal(modelRequests[0].headers.has('Authorization'), false);
    assert.equal(modelRequests[0].headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
    const editedCatalog = await browser.media.listImageModels({ operation: 'media.image.edit', limit: 2 });
    assert.deepEqual(editedCatalog, imageModelSizeCatalog('media.image.edit'));
    assert.equal(editedCatalog.models[0].parameters.image_size.sizeConstraints.widthStep, 1);
    assert.equal(modelRequests[1].url, 'https://fixture.taku.site/__taku/media/models?operation=media.image.edit&limit=2');
    assert.equal(modelRequests[1].headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
    assert.equal(modelRequests[1].headers.has('Authorization'), false);
    const maskRequests = [];
    const maskBrowser = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
      maskRequests.push(request); return Response.json(imageModelInputCatalog());
    } });
    const masks = await maskBrowser.media.listImageModels({ operation: 'media.image.edit', limit: 4 });
    assert.deepEqual(masks, imageModelInputCatalog());
    assert.deepEqual(masks.models.slice(0, 3).map(model => [model.id, model.maximumInputs, model.maximumOutputs]),
      [['ideogram-v2-inpaint', 2, 1], ['ideogram-v2-turbo-inpaint', 2, 1], ['ideogram-v3-inpaint', 2, 4]]);
    assert.deepEqual(masks.models[0].inputContract.roles, ['source', 'mask']);
    assert.equal(masks.models[0].inputContract.sameDimensions, true);
    assert.equal(masks.models[3].parameters.image_size.sizeConstraints.widthStep, 1);
    assert.equal(maskRequests.length, 1);
    assert.equal(maskRequests[0].headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
    assert.equal(maskRequests[0].headers.has('Authorization'), false);
    assert.equal(maskRequests[0].headers.has('Cookie'), false);
    const quoted = await browser.media.quoteImageRequest('media.image.generate', imageRequest, { requestId: imageRequestId });
    assert.equal(quoted.request_id, imageRequestId);
    assert.equal(quoted.model, 'nano-banana-pro');
    assert.equal(quoted.quote.credits, '12.000000');
    assert.equal(quoted.quote.normalizedParameters.num_images, 2);
    assert.equal(modelRequests.length, 3);
    assert.equal(modelRequests[2].url, 'https://fixture.taku.site/__taku/media/images/v2/generate/quotes');
    assert.equal(modelRequests[2].headers.get('X-Taku-CSRF'), '1');
    assert.equal(modelRequests[2].headers.has('Authorization'), false);
    assert.equal(modelRequests[2].headers.has('Cookie'), false);
    assert.equal(modelRequests[2].credentials, 'same-origin');
    assert.equal(modelRequests[2].redirect, 'error');
    const guidance = await fs.readFile(path.join(skill, 'references/image-models.md'), 'utf8');
    await verifyStructuredRecipe(guidance, createTakuSitesClient, quoted);
    await verifyNumericChoiceRecipe(guidance, createTakuSitesClient, quoted);
    await verifyReferenceMaskRecipe(guidance, createTakuSitesClient, quoted);
    await verifyGenerationReferenceRecipe(guidance, createTakuSitesClient, quoted);
    await verifyExplicitSourceRecipe(guidance, createTakuSitesClient, quoted);
    await verifyOwnedInputRecipe(guidance, createTakuSitesClient);
    const runnable = guidance.match(/<!-- runnable:image-model-quote:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:image-model-quote:end -->/);
    assert.ok(runnable?.[1], 'the actual distributed Skill must carry an executable model choice');
    const sandbox = { Error, structuredClone };
    runInNewContext(`${runnable[1]}\nglobalThis.quote = quoteConfiguredImage;`, sandbox);
    const chosenRequests = [];
    const chosenModel = 'flux-schnell';
    const choice = { operation: 'media.image.generate', model: chosenModel,
      parameterSchemaVersion: 'image-parameters.v1', parameters: { num_images: 2 } };
    const selectedClient = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
      chosenRequests.push(request);
      if (new URL(request.url).pathname === '/__taku/media/models') {
        return Response.json({ schema: 'taku.image-model-catalog.v1', catalogVersion: 'a'.repeat(64),
          observedAt: '2026-10-05T15:00:00Z', nextCursor: null, models: [{ id: chosenModel,
            displayName: 'FLUX.1 [schnell]', operations: ['media.image.generate'],
            parameterSchemaVersion: 'image-parameters.v1', priceVersion: 'fixture-price.v1',
            maximumInputs: 0, maximumOutputs: 2, parameters: { num_images: { type: 'integer', minimum: 1, maximum: 2 } },
            availability: { subapp: { status: 'ready' }, 'site-preview': { status: 'ready' }, 'site-published': { status: 'ready' } } }] });
      }
      assert.equal(new URL(request.url).pathname, '/__taku/media/images/v2/generate/quotes');
      assert.deepEqual(await request.clone().json(), { request: { ...imageRequest, model: chosenModel } });
      assert.equal(request.headers.get('Idempotency-Key'), imageRequestId);
      return Response.json({ ...quoted, model: chosenModel, quote: { ...quoted.quote, model: chosenModel } });
    } });
    assert.equal((await sandbox.quote(selectedClient.media, choice,
      { requestId: imageRequestId, prompt: 'A city' }, 'site-published')).model, chosenModel);
    assert.equal(chosenRequests.length, 2, 'the chosen model reaches the actual quote without generation');
    const referenceRunnable = guidance.match(/<!-- runnable:bria-reference-intent:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:bria-reference-intent:end -->/);
    assert.ok(referenceRunnable?.[1], 'the copied Skill must teach executable owned-reference configuration');
    runInNewContext(`${referenceRunnable[1]}\nglobalThis.references = createBriaReferenceIntent;`, sandbox);
    const referenceIds = [`min_${'a'.repeat(32)}`, `min_${'b'.repeat(32)}`];
    const controls = [{ input: 1, method: 'controlnet_canny', scale: 0 },
      { input: 1, method: 'controlnet_depth', scale: 0.5 },
      { input: 2, method: 'controlnet_recoloring', scale: 1 },
      { input: 2, method: 'controlnet_color_grid' }];
    const parameters = { num_images: 1,
      guidance_input_1: 1, guidance_method_1: 'controlnet_canny', guidance_scale_1: 0,
      guidance_input_2: 1, guidance_method_2: 'controlnet_depth', guidance_scale_2: 0.5,
      guidance_input_3: 2, guidance_method_3: 'controlnet_recoloring', guidance_scale_3: 1,
      guidance_input_4: 2, guidance_method_4: 'controlnet_color_grid' };
    for (const kind of ['base', 'fast', 'hd']) {
      for (const surface of ['site-preview', 'site-published']) {
        const id = `bria-guided-image-${kind}`;
        const value = briaReferenceCatalog(id);
        const intent = sandbox.references(value.models[0], referenceIds, controls);
        const originalRequestId = `copied-reference-${kind}-${surface}`;
        const referenceRequests = [];
        const referenceClient = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
          referenceRequests.push(request);
          if (new URL(request.url).pathname === '/__taku/media/models') return Response.json(value);
          assert.equal(request.url, 'https://fixture.taku.site/__taku/media/images/v2/edit/quotes');
          assert.equal(request.method, 'POST');
          assert.equal(request.headers.get('Idempotency-Key'), originalRequestId);
          assert.equal(request.headers.has('Authorization'), false);
          assert.equal(request.headers.has('Cookie'), false);
          assert.deepEqual(await request.clone().json(), { request: {
            schema_version: 'taku.managed-media-request.v2', model: id,
            parameter_schema_version: `${id}-edit-v2-2026-10-07`,
            prompt: 'Original references', input_ids: referenceIds, parameters,
          } });
          return Response.json({ ...quoted, model: id, operation: 'media.image.edit', request_id: originalRequestId,
            quote: { ...quoted.quote, model: id, operation: 'media.image.edit',
              parameterSchemaVersion: `${id}-edit-v2-2026-10-07`, normalizedParameters: parameters,
              priceVersion: 'fal-bria-guidance-quote-v1-2026-10-07' } });
        } });
        const input = { requestId: originalRequestId, prompt: 'Original references', inputIds: intent.inputIds };
        const pendingQuote = sandbox.quote(referenceClient.media, intent.choice, input, surface);
        input.inputIds.reverse();
        input.requestId = 'mutated-request';
        intent.choice.parameters.guidance_input_1 = 2;
        const result = await pendingQuote;
        assert.equal(result.request_id, originalRequestId);
        assert.equal(result.model, id);
        assert.equal(referenceRequests.length, 2, 'the copied recipe never submits inference or regenerates');
      }
    }
    const model = briaReferenceCatalog('bria-guided-image-base').models[0];
    const one = sandbox.references(model, referenceIds.slice(0, 1), [{ input: 1 }]);
    assert.deepEqual(JSON.parse(JSON.stringify(one.choice.parameters)), { num_images: 1, guidance_input_1: 1 });
    const fourIds = [...referenceIds, `min_${'c'.repeat(32)}`, `min_${'d'.repeat(32)}`];
    const four = sandbox.references(model, fourIds, [{ input: 1 }, { input: 2 }, { input: 3 }, { input: 4 }]);
    fourIds.reverse();
    assert.deepEqual(JSON.parse(JSON.stringify(four.inputIds)), [referenceIds[0], referenceIds[1], `min_${'c'.repeat(32)}`, `min_${'d'.repeat(32)}`]);
    assert.deepEqual(JSON.parse(JSON.stringify(four.choice.parameters)), { num_images: 1,
      guidance_input_1: 1, guidance_input_2: 2, guidance_input_3: 3, guidance_input_4: 4 });
    for (const [ids, control] of [[[], [{ input: 1 }]], [[...referenceIds, ...referenceIds, `min_${'e'.repeat(32)}`], [{ input: 1 }]],
      [[referenceIds[0], referenceIds[0]], [{ input: 1 }, { input: 2 }]], [referenceIds, [{ input: 1 }]],
      [[referenceIds[0]], [{ input: 1, scale: null }]], [[referenceIds[0]], [{ input: 1, method: 'automatic' }]],
      [[referenceIds[0]], [{ input: 1 }, ,]], [[referenceIds[0]], [, { input: 1 }]],
      [['https://provider.invalid/x.png'], [{ input: 1 }]]]) {
      assert.throws(() => sandbox.references(model, ids, control), /bria_reference_intent_invalid/);
    }
    assert.throws(() => sandbox.references({ ...model, parameterSchemaVersion: 'unreviewed-schema' }, referenceIds, controls),
      /bria_reference_model_unsupported/);
    await fs.writeFile(path.join(project, 'taku.site.json'), JSON.stringify({ workerEntrypoint: 'dist/worker.mjs', assetsDirectory: 'dist/assets',
      siteManifest: { manifestVersion: 1, auth: { mode: 'required', scopes: ['media.image.generate'] },
        integrations: [{ name: 'media', operations: ['image_generate'], scopes: ['media.image.generate'] }],
        storage: { type: 'turso', migrations: false }, egress: { mode: 'platform-proxy' } } }));
    const modelApp = "import { createTakuSitesClient } from './taku-sites-sdk.mjs'; const client = createTakuSitesClient(); void client.media.listImageModels({ operation: 'media.image.generate' });\n"
      + `void client.media.quoteImageRequest('media.image.generate', ${JSON.stringify(imageRequest)}, { requestId: '${imageRequestId}' });\n`;
    await fs.writeFile(path.join(project, 'dist/assets/app.mjs'), modelApp);
    const checked = run(cli, ['sites-validate', '--project', project, '--json'], skill, temporary);
    assert.equal(checked.status, 'sites_valid');
    assert.ok(checked.object_count >= 4);
    assert.equal(run(cli, ['sites-build', '--project', project, '--json'], skill, temporary).status, 'sites_built');
    await fs.writeFile(path.join(project, 'dist/assets/app.mjs'), modelApp.replaceAll('media.image.generate', 'media.image.edit'));
    const undeclared = run(cli, ['sites-validate', '--project', project, '--json'], skill, temporary, { fail: true });
    assert.match(undeclared.error.message, /SITE_SDK_CAPABILITY_UNDECLARED/);
    assert.match(run(cli, ['sites-build', '--project', project, '--json'], skill, temporary, { fail: true }).error.message,
      /SITE_SDK_CAPABILITY_UNDECLARED/);
  }
  console.log(JSON.stringify({ ok: true, targets: targets.length }));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

async function verifyOwnedInputRecipe(guidance, createTakuSitesClient) {
  const runnable = guidance.match(/<!-- runnable:site-image-input:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:site-image-input:end -->/);
  assert.ok(runnable?.[1], 'copied Skill must contain the selected-operation owned-input recipe');
  const sandbox = { Error, Blob, structuredClone };
  runInNewContext(`${runnable[1]}\nglobalThis.acquire = uploadConfiguredSiteImage;`, sandbox);
  for (const operation of ['media.image.generate', 'media.image.edit']) {
    const calls = []; let checkpoint; let loseFirstUpload = true;
    const inputId = `min_${'a'.repeat(32)}`;
    const token = `fixture.${'b'.repeat(64)}`;
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const permit = { input_id: inputId, content_type: 'image/png', upload_path: `/__taku/media/inputs/${inputId}/content`,
      upload_token: token, expires_at: new Date(Date.now() + 300000).toISOString() };
    const browser = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
      calls.push(request.clone());
      if (request.method === 'POST') return Response.json(permit, { status: 201 });
      assert.ok(checkpoint, 'permit must be persisted before image bytes');
      if (loseFirstUpload) { loseFirstUpload = false; throw new Error('controlled response loss'); }
      return Response.json({ input_id: inputId, expires_at: new Date(Date.now() + 3600000).toISOString() }, { status: 201 });
    } });
    const image = new Blob([bytes], { type: 'image/png' });
    await assert.rejects(sandbox.acquire(browser.media, image,
      { operation, requestId: 'copied-input-recovery-test-001' }, async saved => { checkpoint = saved; }));
    assert.ok(checkpoint);
    assert.equal((await sandbox.acquire(browser.media, image, checkpoint, async () => {
      throw new Error('same upload must reuse its checkpoint');
    })).input_id, inputId);
    assert.deepEqual(calls.map(request => request.method), ['POST', 'PUT', 'PUT']);
    assert.deepEqual(await calls[0].json(), { content_type: 'image/png', operation });
    assert.equal(calls[0].headers.get('Idempotency-Key'), 'copied-input-recovery-test-001');
    for (const request of calls.slice(1)) {
      assert.equal(request.headers.get('X-Taku-Media-Upload-Permit'), token);
      assert.deepEqual(new Uint8Array(await request.arrayBuffer()), bytes);
    }
    for (const request of calls) {
      for (const header of ['Authorization', 'Cookie', 'X-Taku-Media-User', 'X-Taku-Project-Id']) assert.equal(request.headers.has(header), false);
      assert.equal(request.credentials, 'same-origin'); assert.equal(request.redirect, 'error');
    }
  }
}

async function verifyGenerationReferenceRecipe(guidance, createTakuSitesClient, quoted) {
  const runnable = guidance.match(/<!-- runnable:image-model-quote:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:image-model-quote:end -->/);
  assert.ok(runnable?.[1]);
  const sandbox = { Error, structuredClone };
  runInNewContext(`${runnable[1]}\nglobalThis.quote = quoteConfiguredImage;`, sandbox);
  const ids = Array.from({ length: 10 }, (_, index) => `min_${(index + 1).toString(16).padStart(32, '0')}`);
  const choice = { operation: 'media.image.generate', model: 'reference-generation-fixture',
    parameterSchemaVersion: 'fixture-references-v1', parameters: { num_images: 1 } };
  for (const surface of ['site-preview', 'site-published']) {
    for (const count of [0, 1, 9]) {
      const calls = [];
      const requestId = `copied-generation-reference-test-${surface}-${count}`;
      const receipt = { ...quoted, model: choice.model, request_id: requestId,
        quote: { ...quoted.quote, model: choice.model, parameterSchemaVersion: choice.parameterSchemaVersion,
          normalizedParameters: { num_images: 1 } } };
      const browser = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
        calls.push(request);
        if (new URL(request.url).pathname === '/__taku/media/models') return Response.json(generationReferenceCatalog({ ready: true }));
        if (request.method === 'POST') {
          assert.equal(request.url, 'https://fixture.taku.site/__taku/media/images/v2/generate/quotes');
          assert.equal(request.headers.get('Idempotency-Key'), requestId);
          assert.deepEqual(await request.clone().json(), { request: {
            schema_version: 'taku.managed-media-request.v2', model: choice.model,
            parameter_schema_version: choice.parameterSchemaVersion, prompt: 'Keep original reference order',
            parameters: choice.parameters, input_ids: ids.slice(0, count),
          } });
        }
        return Response.json(receipt);
      } });
      const input = { requestId, prompt: 'Keep original reference order', inputIds: ids.slice(0, count) };
      const pending = sandbox.quote(browser.media, choice, input, surface);
      input.inputIds.reverse(); input.requestId = 'mutated-request';
      assert.equal((await pending).request_id, requestId);
      assert.equal((await browser.media.getImageExecution(choice.operation, receipt.execution_id)).execution_id, receipt.execution_id);
      assert.equal((await browser.media.findImageExecution(choice.operation, requestId)).quote.quoteId, receipt.quote.quoteId);
      assert.deepEqual(calls.map(request => request.method), ['GET', 'POST', 'GET', 'GET']);
      assert.equal(calls[0].headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
      for (const request of calls) {
        assert.equal(request.headers.has('Authorization'), false); assert.equal(request.headers.has('Cookie'), false);
        assert.equal(request.headers.has('X-Taku-Media-User'), false);
        assert.equal(request.credentials, 'same-origin'); assert.equal(request.redirect, 'error');
      }
    }
    for (const inputIds of [ids, new Array(1), [ids[0], ids[0]], ['https://supplier.invalid/x.png']]) {
      const calls = [];
      const browser = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
        calls.push(request); return Response.json(generationReferenceCatalog({ ready: true }));
      } });
      await assert.rejects(sandbox.quote(browser.media, choice,
        { requestId: 'copied-invalid-generation-test', prompt: 'Preserve intent', inputIds }, surface), /image_model_inputs_invalid/);
      assert.deepEqual(calls.map(request => request.method), ['GET'], 'invalid input must never reach quote or submit');
    }
  }
}

async function verifyExplicitSourceRecipe(guidance, createTakuSitesClient, quoted) {
  const runnable = guidance.match(/<!-- runnable:image-model-quote:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:image-model-quote:end -->/);
  assert.ok(runnable?.[1]);
  const sandbox = { Error, structuredClone };
  runInNewContext(`${runnable[1]}\nglobalThis.quote = quoteConfiguredImage;`, sandbox);
  const ids = Array.from({ length: 9 }, (_, i) => `min_${(i + 1).toString(16).padStart(32, '0')}`);
  for (const id of ['luma-uni-1', 'luma-uni-1-max']) {
    for (const surface of ['site-preview', 'site-published']) {
      const catalog = generationReferenceCatalog({ ready: true }), model = catalog.models[0];
      model.id = id; model.operations = ['media.image.edit']; model.maximumInputs = 9; model.maximumOutputs = 1;
      delete model.inputContract; model.parameterSchemaVersion = `${id}-edit-v2-2026-10-09`;
      model.parameters = { num_images: { type: 'integer', minimum: 1, maximum: 1, default: 1 },
        source_input: { type: 'integer', minimum: 1, maximum: 9, default: 1 } };
      const requestId = `copied-source-test-${id}-${surface}`, calls = [];
      const receipt = { ...quoted, model: id, operation: 'media.image.edit', request_id: requestId,
        quote: { ...quoted.quote, model: id, operation: 'media.image.edit',
          parameterSchemaVersion: model.parameterSchemaVersion, normalizedParameters: { num_images: 1, source_input: 5 } } };
      const browser = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
        calls.push(request.clone());
        if (new URL(request.url).pathname === '/__taku/media/models') return Response.json(catalog);
        if (request.method === 'POST') assert.deepEqual(await request.clone().json(), { request: {
          schema_version: 'taku.managed-media-request.v2', model: id, parameter_schema_version: model.parameterSchemaVersion,
          prompt: 'Use the chosen source', parameters: { num_images: 1, source_input: 5 }, input_ids: ids,
        } });
        return Response.json(receipt);
      } });
      const choice = { operation: 'media.image.edit', model: id, parameterSchemaVersion: model.parameterSchemaVersion,
        parameters: { num_images: 1, source_input: 5 } };
      const input = { requestId, prompt: 'Use the chosen source', inputIds: [...ids] };
      const pending = sandbox.quote(browser.media, choice, input, surface);
      input.inputIds.reverse(); choice.parameters.source_input = 1; input.requestId = 'mutated-request';
      assert.equal((await pending).request_id, requestId);
      assert.equal((await browser.media.getImageExecution('media.image.edit', receipt.execution_id)).quote.quoteId, receipt.quote.quoteId);
      assert.equal((await browser.media.findImageExecution('media.image.edit', requestId)).request_id, requestId);
      assert.deepEqual(calls.map(request => request.method), ['GET', 'POST', 'GET', 'GET']);
      assert.equal(calls[1].headers.get('Idempotency-Key'), requestId);
      for (const source of [0, 3, 10, 1.5, '1', null, undefined]) {
        const seen = [], parameters = source === undefined ? { num_images: 1 } : { num_images: 1, source_input: source };
        const refused = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
          seen.push(request.clone());
          return Response.json(new URL(request.url).pathname === '/__taku/media/models' ? catalog
            : { ...receipt, quote: { ...receipt.quote, normalizedParameters: parameters } });
        } });
        await assert.rejects(sandbox.quote(refused.media, { ...choice, parameters },
          { requestId, prompt: 'Choose the source', inputIds: ids.slice(0, 2) }, surface),
        /image_model_source_selection_required|image_model_inputs_invalid/);
        assert.deepEqual(seen.map(request => request.method), ['GET']);
      }
      for (const request of calls) {
        for (const header of ['Authorization', 'Cookie', 'X-Taku-Media-User']) assert.equal(request.headers.has(header), false);
        assert.equal(request.credentials, 'same-origin'); assert.equal(request.redirect, 'error');
      }
    }
  }
}

function run(cli, args, cwd, home, { fail = false } = {}) {
  const completed = spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, TAKU_PUBLISHER_HOME: path.join(home, 'publisher-home') },
  });
  if ((completed.status !== 0) !== fail) {
    throw new Error(`${args[0]} failed in ${cwd}: ${completed.stdout}\n${completed.stderr}`);
  }
  return JSON.parse(completed.stdout);
}

function briaReferenceCatalog(id) {
  const parameters = { num_images: { type: 'integer', minimum: 1, maximum: 1, default: 1 } };
  for (const slot of [1, 2, 3, 4]) {
    parameters[`guidance_input_${slot}`] = { type: 'integer', minimum: 1, maximum: 4,
      ...(slot === 1 ? { default: 1 } : {}) };
    parameters[`guidance_method_${slot}`] = { type: 'enum', values: [
      'controlnet_canny', 'controlnet_depth', 'controlnet_recoloring', 'controlnet_color_grid',
    ] };
    parameters[`guidance_scale_${slot}`] = { type: 'number', minimum: 0, maximum: 1 };
  }
  return { schema: 'taku.image-model-catalog.v1', catalogVersion: 'a'.repeat(64),
    observedAt: '2026-10-07T13:00:00Z', nextCursor: null, models: [{ id,
      displayName: 'Reviewed reference image fixture', operations: ['media.image.edit'],
      parameterSchemaVersion: `${id}-edit-v2-2026-10-07`,
      priceVersion: 'fal-bria-guidance-quote-v1-2026-10-07',
      maximumInputs: 4, maximumOutputs: 1, parameters,
      availability: { subapp: { status: 'ready' }, 'site-preview': { status: 'ready' }, 'site-published': { status: 'ready' } } }] };
}

async function verifyStructuredRecipe(guidance, createTakuSitesClient, quoted) {
  const runnable = guidance.match(/<!-- runnable:image-model-quote:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:image-model-quote:end -->/);
  assert.ok(runnable?.[1]);
  const sandbox = { Error, structuredClone };
  runInNewContext(`${runnable[1]}\nglobalThis.quote = quoteConfiguredImage;`, sandbox);
  for (const surface of ['site-preview', 'site-published']) {
    const catalog = imageModelStructuredCatalog();
    // Controlled protocol fixture only; this is not a production model or ready receipt.
    catalog.models[0].availability[surface] = { status: 'ready' };
    catalog.models[0].priceVersion = 'fixture-only-price.v1';
    const model = catalog.models[0];
    const requestId = `copied-structured-${surface}`;
    const parameters = { num_inference_steps: 2, structured_prompt: structuredImagePrompt() };
    const choice = { operation: 'media.image.generate', model: model.id,
      parameterSchemaVersion: model.parameterSchemaVersion, parameters: structuredClone(parameters) };
    const input = { requestId, prompt: 'Keep nested intent' };
    const receipt = { ...quoted, model: model.id, request_id: requestId,
      quote: { ...quoted.quote, model: model.id, parameterSchemaVersion: model.parameterSchemaVersion,
        normalizedParameters: structuredClone(parameters), priceVersion: 'fixture-only-price.v1' } };
    const seen = [];
    const browser = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
      seen.push(request);
      if (new URL(request.url).pathname === '/__taku/media/models') {
        assert.equal(request.headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
        return Response.json(catalog);
      }
      if (request.method === 'POST') {
        assert.equal(request.headers.get('Idempotency-Key'), requestId);
        assert.deepEqual(await request.clone().json(), { request: {
          schema_version: 'taku.managed-media-request.v2', model: model.id,
          parameter_schema_version: model.parameterSchemaVersion, prompt: 'Keep nested intent', parameters,
        } });
      }
      return Response.json(receipt);
    } });
    const pending = sandbox.quote(browser.media, choice, input, surface);
    choice.parameters.structured_prompt.scene = 'mutated scene';
    choice.parameters.structured_prompt.objects[0].count = 8;
    input.requestId = 'mutated-id';
    assert.equal((await pending).request_id, requestId);
    assert.equal((await browser.media.getImageExecution('media.image.generate', receipt.execution_id)).quote.quoteId,
      receipt.quote.quoteId);
    assert.equal((await browser.media.findImageExecution('media.image.generate', requestId)).request_id, requestId);
    assert.deepEqual(seen.map(request => [request.method, new URL(request.url).pathname]), [
      ['GET', '/__taku/media/models'], ['POST', '/__taku/media/images/v2/generate/quotes'],
      ['GET', `/__taku/media/images/v2/generate/executions/${receipt.execution_id}`],
      ['GET', `/__taku/media/images/v2/generate/by-request/${requestId}`],
    ]);
    for (const request of seen) {
      assert.equal(request.headers.has('Authorization'), false); assert.equal(request.headers.has('Cookie'), false);
      assert.equal(request.credentials, 'same-origin'); assert.equal(request.redirect, 'error');
    }
    const changedChoice = { ...choice, parameters };
    receipt.quote.normalizedParameters.structured_prompt.background = '';
    await assert.rejects(sandbox.quote(browser.media, changedChoice, { requestId, prompt: input.prompt }, surface),
      /invalid_platform_response/);
    const before = seen.length;
    const unavailable = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
      assert.equal(request.method, 'GET'); return Response.json(imageModelStructuredCatalog());
    } });
    await assert.rejects(sandbox.quote(unavailable.media, changedChoice,
      { requestId, prompt: input.prompt }, surface), /image_model_unavailable/);
    assert.equal(seen.length, before);
  }
}

async function verifyNumericChoiceRecipe(guidance, createTakuSitesClient, quoted) {
  const runnable = guidance.match(/<!-- runnable:image-model-quote:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:image-model-quote:end -->/);
  assert.ok(runnable?.[1]);
  const sandbox = { Error, structuredClone };
  runInNewContext(`${runnable[1]}\nglobalThis.quote = quoteConfiguredImage;`, sandbox);
  for (const surface of ['site-preview', 'site-published']) {
    for (const [tag, steps, valid] of [
      ['one', 1, true], ['two', 2, true], ['four', 4, true], ['eight', 8, true],
      ['three', 3, false], ['string-four', '4', false], ['null', null, false], ['fraction', 4.2, false],
    ]) {
      const catalog = imageModelIntegerValuesCatalog();
      // Controlled actual quote fixture only, not production ready or price.
      catalog.models[0].availability[surface] = { status: 'ready' };
      catalog.models[0].priceVersion = 'fixture-only-price.v1';
      const model = catalog.models[0];
      const requestId = `copied-enum-${surface}-${tag}`;
      const choice = { operation: 'media.image.generate', model: model.id,
        parameterSchemaVersion: model.parameterSchemaVersion, parameters: { num_inference_steps: steps } };
      const receipt = { ...quoted, model: model.id, request_id: requestId,
        quote: { ...quoted.quote, model: model.id, parameterSchemaVersion: model.parameterSchemaVersion,
          normalizedParameters: { num_inference_steps: steps }, priceVersion: 'fixture-only-price.v1' } };
      const seen = [];
      const browser = createTakuSitesClient({ baseUrl: 'https://numeric.taku.site', fetcher: async request => {
        seen.push(request);
        if (request.method === 'GET') {
          assert.equal(new URL(request.url).pathname, '/__taku/media/models');
          assert.equal(request.headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
          return Response.json(catalog);
        }
        assert.equal(request.url, 'https://numeric.taku.site/__taku/media/images/v2/generate/quotes');
        assert.equal(request.headers.get('Idempotency-Key'), requestId);
        assert.deepEqual(await request.clone().json(), { request: {
          schema_version: 'taku.managed-media-request.v2', model: model.id,
          parameter_schema_version: model.parameterSchemaVersion, prompt: 'Keep numeric selection',
          parameters: { num_inference_steps: steps },
        } });
        return Response.json(receipt);
      } });
      const pending = sandbox.quote(browser.media, choice,
        { requestId, prompt: 'Keep numeric selection' }, surface);
      choice.parameters.num_inference_steps = 3;
      if (valid) {
        const result = await pending;
        assert.equal(result.request_id, requestId);
        assert.equal(result.quote.normalizedParameters.num_inference_steps, steps);
        assert.deepEqual(seen.map(request => request.method), ['GET', 'POST']);
      } else {
        const error = await pending.then(() => undefined, error => error);
        assert.deepEqual(seen.map(request => request.method), ['GET'], 'invalid numeric choices never quote or submit');
        assert.match(String(error), /image_model_parameters_invalid/);
      }
      for (const request of seen) {
        assert.equal(request.headers.has('Authorization'), false);
        assert.equal(request.headers.has('Cookie'), false);
        assert.equal(request.credentials, 'same-origin'); assert.equal(request.redirect, 'error');
      }
    }
  }
}

async function verifyReferenceMaskRecipe(guidance, createTakuSitesClient, quoted) {
  const runnable = guidance.match(/<!-- runnable:gpt-reference-mask-intent:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:gpt-reference-mask-intent:end -->/);
  assert.ok(runnable?.[1], 'the copied Skill must teach an executable explicit reference-mask intent');
  const sandbox = { Error, structuredClone };
  runInNewContext(`${runnable[1]}\nglobalThis.references = createGptReferenceMaskIntent;`, sandbox);
  const quoteRunnable = guidance.match(/<!-- runnable:image-model-quote:start -->\s*```js\n([\s\S]*?)\n```\s*<!-- runnable:image-model-quote:end -->/);
  assert.ok(quoteRunnable?.[1]);
  runInNewContext(`${quoteRunnable[1]}\nglobalThis.quote = quoteConfiguredImage;`, sandbox);
  const sources = Array.from({ length: 16 }, (_, index) => `min_${(index + 1).toString(16).padStart(32, '0')}`);
  const mask = `min_${'f'.repeat(32)}`;
  const leadingGap = [...sources];
  delete leadingGap[0];
  const trailingGap = new Array(2);
  trailingGap[0] = sources[0];
  for (const model of imageModelReferenceMaskCatalog().models) {
    for (const ids of [new Array(1), leadingGap, trailingGap]) {
      for (const maskId of [undefined, mask]) {
        assert.throws(() => sandbox.references(model, ids, maskId), /gpt_reference_mask_intent_invalid/);
      }
    }
    const unmasked = sandbox.references(model, sources);
    assert.deepEqual(JSON.parse(JSON.stringify(unmasked)), { choice: {
      operation: 'media.image.edit', model: model.id, parameterSchemaVersion: model.parameterSchemaVersion,
      parameters: { num_images: 1 } }, inputIds: sources });
    for (const surface of ['site-preview', 'site-published']) {
      for (const masked of [false, true]) {
        const intent = sandbox.references(model, sources, masked ? mask : undefined);
        const parameters = { num_images: 1, ...(masked ? { mask_input: 17 } : {}) };
        const orderedInputs = [...sources, ...(masked ? [mask] : [])];
        const requestId = `copied-gpt-${model.id}-${surface}-${masked}`;
        const value = imageModelReferenceMaskCatalog();
        value.models = [structuredClone(model)];
        // Controlled quote fixture only; never a model registration or real ready proof.
        value.models[0].availability[surface] = { status: 'ready' };
        value.models[0].priceVersion = 'fixture-only-price.v1';
        const receipt = { ...quoted, model: model.id, operation: 'media.image.edit', request_id: requestId,
          quote: { ...quoted.quote, model: model.id, operation: 'media.image.edit',
            parameterSchemaVersion: model.parameterSchemaVersion, normalizedParameters: parameters,
            priceVersion: 'fixture-only-price.v1' } };
        const seen = [];
        const browser = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
          seen.push(request);
          if (new URL(request.url).pathname === '/__taku/media/models') {
            assert.equal(request.headers.get('X-Taku-Image-Model-Features'), 'generation-references-v1');
            return Response.json(value);
          }
          if (request.method === 'POST') {
            assert.equal(request.url, 'https://fixture.taku.site/__taku/media/images/v2/edit/quotes');
            assert.equal(request.headers.get('Idempotency-Key'), requestId);
            assert.deepEqual(await request.clone().json(), { request: { schema_version: 'taku.managed-media-request.v2',
              model: model.id, parameter_schema_version: model.parameterSchemaVersion, prompt: 'Preserve references',
              parameters, input_ids: orderedInputs } });
          }
          return Response.json(receipt);
        } });
        const input = { requestId, prompt: 'Preserve references', inputIds: intent.inputIds };
        const pending = sandbox.quote(browser.media, intent.choice, input, surface);
        input.inputIds.reverse(); input.requestId = 'mutated-id';
        if (masked) intent.choice.parameters.mask_input = 2;
        assert.equal((await pending).request_id, requestId);
        assert.equal((await browser.media.getImageExecution('media.image.edit', receipt.execution_id)).execution_id, receipt.execution_id);
        assert.equal((await browser.media.findImageExecution('media.image.edit', requestId)).quote.quoteId, receipt.quote.quoteId);
        assert.deepEqual(seen.map(request => [request.method, new URL(request.url).pathname]), [
          ['GET', '/__taku/media/models'], ['POST', '/__taku/media/images/v2/edit/quotes'],
          ['GET', `/__taku/media/images/v2/edit/executions/${receipt.execution_id}`],
          ['GET', `/__taku/media/images/v2/edit/by-request/${requestId}`],
        ]);
        for (const request of seen) {
          assert.equal(request.headers.has('Authorization'), false); assert.equal(request.headers.has('Cookie'), false);
          assert.equal(request.credentials, 'same-origin'); assert.equal(request.redirect, 'error');
        }
      }
    }
    const one = sandbox.references(model, [sources[0]], mask);
    assert.deepEqual(JSON.parse(JSON.stringify(one.choice.parameters)), { num_images: 1, mask_input: 2 });
    for (const [ids, maskId] of [[[], undefined], [[...sources, mask], undefined],
      [[sources[0], sources[0]], undefined], [[sources[0]], sources[0]],
      [[sources[0]], null], [['https://supplier.invalid/x.png'], undefined], [[sources[0]], 'https://supplier.invalid/mask.png']]) {
      assert.throws(() => sandbox.references(model, ids, maskId), /gpt_reference_mask_intent_invalid/);
    }
    assert.throws(() => sandbox.references({ ...model, parameterSchemaVersion: 'unreviewed' }, sources), /gpt_reference_mask_model_unsupported/);
    const unavailableClient = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
      assert.equal(request.method, 'GET');
      return Response.json(imageModelReferenceMaskCatalog());
    } });
    await assert.rejects(sandbox.quote(unavailableClient.media, unmasked.choice,
      { requestId: 'unavailable-gpt-model', prompt: 'An edit', inputIds: unmasked.inputIds }, 'site-published'), /image_model_unavailable/);
  }
}
