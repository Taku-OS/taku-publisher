import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { renameSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { savePublisherSession } from '../dist/auth.js';
import { authFlowPaths, checkAuthFlow } from '../dist/auth-flow.js';

const scopes = ['sites.read', 'sites.preview', 'sites.publish'];
const createdAt = '2026-10-07T00:00:00.000Z';
const requestId = 'auth-state-race-fixture';
const receiverPid = 2_147_483_000;

async function fixture(t, { sessionScopes = scopes, missingSession = false, staleHeartbeat = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-auth-state-race-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = { ...process.env, TAKU_PUBLISHER_HOME: root,
    TAKU_PUBLISHER_SESSION_PATH: path.join(root, 'session.json'), TAKU_BEARER_TOKEN: '', TAKU_PUBLISH_TOKEN: '' };
  const paths = authFlowPaths(env);
  await fs.mkdir(paths.root, { recursive: true });
  if (!missingSession) {
    await savePublisherSession({ accessToken: 'taku_pub_auth_state_non_authorizing_fixture',
      intent: 'publish_site', scopes: sessionScopes, createdAt, expiresAt: Date.now() + 3600_000 }, env);
  }
  const active = { request_id: requestId, status: 'redeeming_authorization', pid: receiverPid,
    intent: 'publish_site', required_scopes: scopes, heartbeat_at: Date.now() - (staleHeartbeat ? 60_000 : 0),
    expires_at: new Date(Date.now() + 300_000).toISOString() };
  await fs.writeFile(paths.state, JSON.stringify(active));
  return { env, paths, active, terminal: { ...active, status: 'authenticated', session_created_at: createdAt } };
}

function receiverFinishesDuringProbe(t, paths, terminal, alive = false) {
  // Only the OS liveness boundary is controlled. State/session reads stay real.
  t.mock.method(process, 'kill', (pid, signal) => {
    assert.equal(pid, receiverPid);
    assert.equal(signal, 0);
    const temporary = `${paths.state}.fixture-next`;
    writeFileSync(temporary, JSON.stringify(terminal));
    renameSync(temporary, paths.state);
    if (!alive) throw Object.assign(new Error('fixture receiver exited'), { code: 'ESRCH' });
    return true;
  });
}

test('auth-check rereads a terminal state saved between its state read and receiver exit probe', async t => {
  const f = await fixture(t);
  receiverFinishesDuringProbe(t, f.paths, f.terminal);
  const result = await checkAuthFlow(requestId, f.env);
  assert.equal(result.status, 'authenticated');
  assert.equal(result.request_id, requestId);
  assert.equal(result.requires_action, false);
});

test('auth-check rereads terminal completion after observing a stale heartbeat', async t => {
  const f = await fixture(t, { staleHeartbeat: true });
  receiverFinishesDuringProbe(t, f.paths, f.terminal, true);
  assert.equal((await checkAuthFlow(requestId, f.env)).status, 'authenticated');
});

for (const [name, options] of [['missing session', { missingSession: true }],
  ['missing required scope', { sessionScopes: ['sites.read'] }]]) {
  test(`terminal reread still requires verified credentials: ${name}`, async t => {
    const f = await fixture(t, options);
    receiverFinishesDuringProbe(t, f.paths, f.terminal);
    assert.equal((await checkAuthFlow(requestId, f.env)).status, 'login_required');
  });
}

test('terminal reread cannot follow a replacement authorization request', async t => {
  const f = await fixture(t);
  receiverFinishesDuringProbe(t, f.paths, { ...f.terminal, request_id: 'other-auth-state-fixture' });
  assert.equal((await checkAuthFlow(requestId, f.env)).status, 'login_required');
});

test('receiver exit without a persisted terminal state remains interrupted', async t => {
  const f = await fixture(t);
  receiverFinishesDuringProbe(t, f.paths, f.active);
  const result = await checkAuthFlow(requestId, f.env);
  assert.equal(result.status, 'authorization_interrupted');
  assert.equal(result.requires_action, true);
});
