import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { launchBrowser } from '../dist/browser-launch.js';
import { loginWithBrowser } from '../dist/browser-auth.js';
import { dispatch } from '../dist/cli.js';
import * as http from 'node:http';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-browser-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('launcher reports nonzero exit, missing executable, timeout, and acceptance accurately', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX launcher fixture');
  const root = await fixture(t);
  const launcher = path.join(root, process.platform === 'darwin' ? 'open' : 'xdg-open');
  const env = { ...process.env, PATH: root };
  assert.equal((await launchBrowser('https://example.test', { env })).status, 'failed');
  await fs.writeFile(launcher, '#!/bin/sh\necho "private launch URL" >&2\nexit 7\n', { mode: 0o755 });
  assert.deepEqual(await launchBrowser('https://example.test', { env }), { status: 'failed', exit_code: 7 });
  await fs.writeFile(launcher, '#!/bin/sh\nexit 0\n');
  assert.deepEqual(await launchBrowser('https://example.test', { env }), { status: 'requested', exit_code: 0 });
  await fs.writeFile(launcher, '#!/bin/sh\n/bin/sleep 0.2\n');
  assert.equal((await launchBrowser('https://example.test', { env, timeoutMs: 20 })).status, 'timed_out');
});

test('manual sign-in link arrives before launcher failure and still completes PKCE exchange', async (t) => {
  const root = await fixture(t);
  const env = { ...process.env, TAKU_PUBLISHER_HOME: root };
  let redeemed;
  const worker = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    redeemed = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ token: 'test-only-token', expiresIn: 3600, scopes: ['creator.studio-draft.write'] }));
  });
  await new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => { worker.closeAllConnections(); worker.close(); });
  let output = '';
  let url;
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    output += String(chunk);
    if (String(chunk).startsWith('{')) {
      const event = JSON.parse(String(chunk));
      if (event.authorization_url) url = new URL(event.authorization_url);
    }
    return true;
  };
  try {
    const login = loginWithBrowser({
      env, workerUrl: `http://127.0.0.1:${worker.address().port}`,
      intent: 'publish_stax_card', timeoutMs: 2000,
      browserOpen: async () => {
        assert.ok(url, 'manual link must be emitted before attempting launch');
        // Simulate the user using the displayed link after the launcher fails.
        setImmediate(async () => {
          await fetch(url.searchParams.get('return_to'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: 'test-code', state: url.searchParams.get('auth_state') }),
          });
        });
        throw new Error('launcher unavailable');
      },
    });
    assert.equal((await login).authenticated, true);
  } finally { process.stderr.write = originalWrite; }
  assert.equal(redeemed.intent, 'publish_stax_card');
  assert.ok(redeemed.codeVerifier);
  assert.equal(output.includes(redeemed.codeVerifier), false);
  assert.equal(output.includes('test-only-token'), false);
  assert.match(output, /"status":"failed"/);
});

test('standalone Stax login can skip OS launch, emits link, and expires with callback closed', async (t) => {
  let output = '';
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => { output += String(chunk); return true; };
  try {
    await assert.rejects(dispatch({
      command: 'auth-login', rest: [], flags: new Map([
        ['intent', 'publish_stax_card'], ['no-open-browser', true], ['timeout', '1'], ['wait', true],
      ]),
    }), (error) => error.code === 'auth_timeout' && error.details.browser_launch.status === 'skipped');
  } finally { process.stderr.write = originalWrite; }
  const event = JSON.parse(output.split('\n')[0]);
  const url = new URL(event.authorization_url);
  assert.equal(url.searchParams.get('intent'), 'publish_stax_card');
  await assert.rejects(fetch(url.searchParams.get('return_to')));
});
