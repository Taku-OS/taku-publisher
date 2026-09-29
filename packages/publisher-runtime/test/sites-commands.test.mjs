import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatch } from '../dist/cli.js';
import { savePublisherSession } from '../dist/auth.js';

function args(command, flags = {}) {
  return { command, flags: new Map(Object.entries(flags)), rest: [] };
}

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
