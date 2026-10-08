#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

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
    for (const reference of ['contract.md', 'capabilities.md', 'storage.md', 'testing.md', 'image-edit.md']) {
      await fs.access(path.join(skill, 'references', reference));
    }
    // The capability catalog is live-only: without a Sites session it must fail clearly, not fall back.
    const contract = run(cli, ['sites-contract', '--json'], skill, temporary, { fail: true });
    assert.equal(contract.error.code, 'sites_login_required');
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
    const checked = run(cli, ['sites-validate', '--project', project, '--json'], skill, temporary);
    assert.equal(checked.status, 'sites_valid');
    assert.ok(checked.object_count >= 4);
    // Exercise the SDK actually exported by each isolated install, not a source checkout.
    await imageEditSmoke(path.join(project, 'dist/assets/taku-sites-sdk.mjs'));
    const configPath = path.join(project, 'taku.site.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.siteManifest.auth = { mode: 'required', scopes: ['media.image.edit'] };
    config.siteManifest.integrations = [{ name: 'media', operations: ['image_edit'], scopes: ['media.image.edit'] }];
    await fs.writeFile(configPath, JSON.stringify(config));
    // Bundle the SDK into the application so the core's static call analysis can follow it.
    const exportedSdk = await fs.readFile(path.join(project, 'dist/assets/taku-sites-sdk.mjs'), 'utf8');
    await fs.writeFile(path.join(project, 'dist/assets/app.mjs'), exportedSdk +
      "\nexport async function edit(file, prompt, requestId) { const permit = await taku.media.createInput(file.type); await taku.media.uploadInput(permit, file); return taku.media.editImage(permit.input_id, prompt, { requestId }); }\n");
    assert.equal(run(cli, ['sites-validate', '--project', project, '--json'], skill, temporary).status, 'sites_valid');
    config.siteManifest.auth.scopes = [];
    config.siteManifest.integrations = [];
    await fs.writeFile(configPath, JSON.stringify(config));
    const undeclared = run(cli, ['sites-validate', '--project', project, '--json'], skill, temporary, { fail: true });
    assert.match(JSON.stringify(undeclared), /SITE_SDK_CAPABILITY_UNDECLARED/);
  }
  console.log(JSON.stringify({ ok: true, targets: targets.length }));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

async function imageEditSmoke(sdkPath) {
  const { createTakuSitesClient, TakuSitesRequestError } = await import(pathToFileURL(sdkPath).href);
  const inputId = `min_${'1'.repeat(32)}`, jobId = `med_${'2'.repeat(32)}`;
  const expires = new Date(Date.now() + 60_000).toISOString();
  const calls = [];
  let polls = 0;
  const image = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const client = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
    calls.push(request.clone());
    assert.equal(request.credentials, 'same-origin');
    assert.equal(request.headers.get('X-Taku-CSRF'), '1');
    const route = new URL(request.url).pathname;
    if (route.endsWith('/inputs/permit')) return Response.json({ input_id: inputId, content_type: 'image/png',
      upload_path: `/__taku/media/inputs/${inputId}/content`, upload_token: `fixture.${'a'.repeat(64)}`, expires_at: expires });
    if (route.includes('/inputs/')) {
      assert.equal(request.method, 'PUT');
      assert.deepEqual(new Uint8Array(await request.arrayBuffer()), new Uint8Array(await image.arrayBuffer()));
      return Response.json({ input_id: inputId, expires_at: expires });
    }
    if (route.endsWith('/edits')) {
      assert.deepEqual(await request.json(), { input_ids: [inputId], prompt: 'Keep the subject; warm the colours',
        aspect_ratio: 'auto', resolution: '1K', output_format: 'png' });
      return Response.json({ schema_version: 'taku.site-media-job.v1', job_id: jobId, status: 'queued', terminal: false });
    }
    if (route.endsWith('/assets/0/content')) return new Response(image, { headers: { 'Content-Type': image.type, 'Content-Length': String(image.size) } });
    if (route.endsWith(`/jobs/${jobId}`)) {
      polls++;
      return Response.json({ schema_version: 'taku.site-media-job.v1', job_id: jobId,
        status: polls === 1 ? 'running' : 'completed', terminal: polls > 1,
        ...(polls > 1 ? { asset_content: `/__taku/media/jobs/${jobId}/assets/0/content`, expires_at: expires } : { poll_after_ms: 1000 }) });
    }
    throw new Error(`Unexpected SDK route: ${route}`);
  } });
  const permit = await client.media.createInput('image/png');
  await client.media.uploadInput(permit, image);
  const options = { requestId: 'looks-edit-fixture-1', aspectRatio: 'auto', resolution: '1K', outputFormat: 'png' };
  await client.media.editImage(inputId, 'Keep the subject; warm the colours', options);
  await client.media.editImage(inputId, 'Keep the subject; warm the colours', options);
  assert.deepEqual(calls.filter(r => r.url.endsWith('/edits')).map(r => r.headers.get('Idempotency-Key')),
    [options.requestId, options.requestId]);
  assert.equal((await client.media.getJob(jobId)).terminal, false);
  assert.equal((await client.media.getJob(jobId)).status, 'completed');
  const result = await client.media.getAsset(jobId);
  assert.equal(result.type, image.type);
  assert.equal(result.size, image.size);
  for (const [status, code] of [[401, 'authentication_required'], [402, 'insufficient_credits'],
    [403, 'SITE_CAPABILITY_INTERNAL_ONLY'], [429, 'rate_limited'], [503, 'platform_unavailable']]) {
    const failing = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async () =>
      Response.json({ error: code }, { status, headers: { 'Retry-After': '5' } }) });
    await assert.rejects(failing.media.editImage(inputId, 'Edit this image', options), error =>
      error instanceof TakuSitesRequestError && error.status === status && error.code === code
      && error.retryAfter === 5 && error.internalOnly === (status === 403));
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
