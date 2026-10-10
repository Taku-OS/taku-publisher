import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatch } from '../dist/cli.js';
import { savePublisherSession } from '../dist/auth.js';
import { SitesHttpClient } from '../dist/sites/http.js';
import ownerCatalog from './fixtures/owner-assets.json' with { type: 'json' };

const assetId = `ast_${'7'.repeat(32)}`;
function metadata(bytes, contentType = 'image/png') {
  return { assetId, state: 'ready', retention: 'permanent', visibility: 'private', contentType,
    byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), expiresAt: null,
    createdAt: '2026-10-05T00:00:00.000Z', partBytes: 8388608, partCount: Math.ceil(bytes.length / 8388608) };
}
function args(flags) { return { command: 'sites-assets-download', flags: new Map(Object.entries(flags)), rest: [] }; }
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-owned-export-'));
  const previous = process.env.TAKU_PUBLISHER_HOME;
  process.env.TAKU_PUBLISHER_HOME = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.TAKU_PUBLISHER_HOME;
    else process.env.TAKU_PUBLISHER_HOME = previous;
    await rm(root, { recursive: true, force: true });
  });
  await savePublisherSession({ accessToken: 'taku_pub_test_owned_export', expiresAt: Date.now() + 600_000,
    intent: 'publish_site', scopes: ['sites.read', 'sites.preview', 'sites.publish'] });
  const bytes = Buffer.from('owned-fixture-image');
  const state = { catalog: structuredClone(ownerCatalog), asset: metadata(bytes), bytes, status: 200,
    headers: {}, contentRequests: [], ...options };
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/sites/assets/capabilities' || request.url === `/v1/sites/assets/${assetId}`) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(request.url.endsWith('capabilities') ? state.catalog : state.asset));
      return;
    }
    state.contentRequests.push({ path: request.url, auth: request.headers.authorization, range: request.headers.range });
    if (state.status !== 200 && state.status !== 206) {
      response.writeHead(state.status, { 'Content-Type': 'application/json', 'X-Request-ID': 'req_owner_export_fixture' });
      response.end(JSON.stringify({ error: 'SITE_ASSET_PROVIDER_UNAVAILABLE' }));
      return;
    }
    response.writeHead(state.status, { 'Content-Type': state.asset.contentType, 'Cache-Control': 'private, no-store', ...state.headers });
    if (state.stream) await state.stream(response);
    else response.end(state.bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const flags = { 'worker-url': `http://127.0.0.1:${server.address().port}`, 'allow-custom-worker-url': true,
    'asset-id': assetId, output: path.join(root, 'owned.png') };
  return { root, flags, state };
}

test('actual CLI streams a 70 MiB owner video to a verified no-clobber file with no provider URL or token in output', async t => {
  const chunk = Buffer.alloc(64 * 1024, 0x71), count = 1120;
  const hash = createHash('sha256');
  for (let index = 0; index < count; index++) hash.update(chunk);
  const digest = hash.digest('hex');
  const f = await fixture(t, { asset: { ...metadata(chunk, 'video/webm'), byteLength: chunk.length * count,
    sha256: digest, partCount: 9 }, stream: async response => {
    for (let index = 0; index < count; index++) {
      if (!response.write(chunk)) await once(response, 'drain');
    }
    response.end();
  } });
  const result = await dispatch(args(f.flags));
  assert.equal(result.status, 'sites_asset_downloaded');
  assert.equal(result.asset_id, assetId);
  assert.equal(result.byte_length, chunk.length * count);
  assert.equal(result.sha256, digest);
  assert.equal(result.output, f.flags.output);
  const downloaded = createHash('sha256');
  for await (const piece of createReadStream(f.flags.output)) downloaded.update(piece);
  assert.equal(downloaded.digest('hex'), digest);
  assert.deepEqual(f.state.contentRequests, [{ path: `/v1/sites/assets/${assetId}/content`,
    auth: 'Bearer taku_pub_test_owned_export', range: undefined }]);
  assert.ok(!JSON.stringify(result).includes('taku_pub_'));
  assert.ok(!JSON.stringify(result).includes('http'));
  assert.ok(!(await readdir(f.root)).some(name => name.startsWith('.taku-asset-export-')));
});

test('download leaves no final or temporary file on wrong hash/size/MIME/partial/encoded content and preserves server request IDs', async t => {
  const f = await fixture(t);
  const names = (await readdir(f.root)).sort();
  const original = structuredClone(f.state.asset);
  for (const patch of [
    { asset: { ...original, sha256: '0'.repeat(64) } },
    { asset: { ...original, byteLength: original.byteLength + 1 } },
    { asset: { ...original, byteLength: original.byteLength - 1 } },
    { headers: { 'Content-Type': 'text/html' } },
    { headers: { 'Content-Encoding': 'gzip' } },
    { status: 206 },
  ]) {
    Object.assign(f.state, { asset: original, headers: {}, status: 200 }, patch);
    await assert.rejects(dispatch(args(f.flags)), { code: 'sites_asset_integrity_failed' });
    assert.deepEqual((await readdir(f.root)).sort(), names);
  }
  Object.assign(f.state, { asset: original, headers: {}, status: 503 });
  await assert.rejects(dispatch(args(f.flags)), error => error.code === 'sites_api_error' &&
    error.details.server_error === 'SITE_ASSET_PROVIDER_UNAVAILABLE' && error.details.request_id === 'req_owner_export_fixture');
  assert.deepEqual((await readdir(f.root)).sort(), names);
});

test('download refuses unavailable grants, forged or expired metadata, existing and symlink outputs without fetching bytes', async t => {
  const f = await fixture(t), original = structuredClone(f.state.asset);
  f.state.catalog.operations.find(operation => operation.id === 'assets.resolve').authorized = false;
  await assert.rejects(dispatch(args(f.flags)), { code: 'sites_owner_operation_unavailable' });
  f.state.catalog = structuredClone(ownerCatalog);
  for (const patch of [{ url: 'https://must-not-be-used.invalid/content' }, { state: 'deleting' },
    { retention: 'temporary', expiresAt: '2020-01-01T00:00:00.000Z' }]) {
    f.state.asset = { ...original, ...patch };
    await assert.rejects(dispatch(args(f.flags)), error => ['sites_owner_response_invalid', 'sites_asset_not_downloadable'].includes(error.code));
  }
  f.state.asset = original;
  await writeFile(f.flags.output, 'keep existing');
  await assert.rejects(dispatch(args(f.flags)), { code: 'sites_asset_output_exists' });
  assert.equal(await readFile(f.flags.output, 'utf8'), 'keep existing');
  const link = path.join(f.root, 'symlink-output');
  await symlink(f.flags.output, link);
  await assert.rejects(dispatch(args({ ...f.flags, output: link })), { code: 'sites_asset_output_exists' });
  assert.equal(await readFile(f.flags.output, 'utf8'), 'keep existing');
  assert.deepEqual(f.state.contentRequests, []);
});

test('content reader validates an exact asset ID, never redirects credentials, and renews only a single 401 before streaming', async () => {
  let calls = 0, renewals = 0;
  const client = new SitesHttpClient('https://worker.example.invalid', 'taku_pub_test_old', async (url, init) => {
    calls++;
    assert.equal(url.pathname, `/v1/sites/assets/${assetId}/content`);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, calls === 1 ? 'Bearer taku_pub_test_old' : 'Bearer taku_pub_test_new');
    return calls === 1 ? Response.json({ error: 'invalid_client' }, { status: 401 })
      : new Response('content', { headers: { 'Content-Type': 'image/png' } });
  }, true, async () => { renewals++; return 'taku_pub_test_new'; });
  for (const invalid of ['../other', `${assetId}?url=bad`, { toString: () => assetId }]) {
    await assert.rejects(client.getMaterialContent(invalid), { code: 'sites_asset_arguments_invalid' });
  }
  assert.equal(calls, 0);
  assert.equal(await (await client.getMaterialContent(assetId)).text(), 'content');
  assert.equal(calls, 2);
  assert.equal(renewals, 1);
});

test('atomic export refuses a target created after preflight and preserves that file', async t => {
  const f = await fixture(t);
  f.state.stream = async response => {
    await writeFile(f.flags.output, 'created after preflight');
    response.end(f.state.bytes);
  };
  await assert.rejects(dispatch(args(f.flags)), { code: 'sites_asset_output_exists' });
  assert.equal(await readFile(f.flags.output, 'utf8'), 'created after preflight');
  assert.ok(!(await readdir(f.root)).some(name => name.startsWith('.taku-asset-export-')));
});

test('interrupted content does not leave a partial output and repeated 401 cannot renew forever', async t => {
  const f = await fixture(t);
  const before = (await readdir(f.root)).sort();
  f.state.stream = async response => {
    response.write(f.state.bytes.subarray(0, 3));
    setImmediate(() => response.destroy());
  };
  await assert.rejects(dispatch(args(f.flags)), error =>
    ['sites_asset_integrity_failed', 'sites_network_unavailable'].includes(error.code));
  assert.deepEqual((await readdir(f.root)).sort(), before);
  let requests = 0, renewals = 0;
  const client = new SitesHttpClient(f.flags['worker-url'], 'taku_pub_test_old', async () => {
    requests++;
    return Response.json({ error: 'invalid_client' }, { status: 401 });
  }, true, async () => { renewals++; return 'taku_pub_test_new'; });
  await assert.rejects(client.getMaterialContent(assetId), error => error.code === 'sites_api_error' && error.details.http_status === 401);
  assert.equal(requests, 2);
  assert.equal(renewals, 1);
});
