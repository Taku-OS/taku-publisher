import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import test from 'node:test';
const exec = promisify(execFile);
const cli = new URL('../dist/bin/taku-publisher.js', import.meta.url).pathname;
async function fixture(t, scopes = ['creator.profile.read', 'creator.studio-draft.write'], tokens = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-detached-auth-'));
  const env = { ...process.env, TAKU_PUBLISHER_HOME: root, TAKU_PUBLISHER_SESSION_PATH: path.join(root, 'session.json'), TAKU_BEARER_TOKEN: '', TAKU_PUBLISH_TOKEN: '' };
  const exchanges = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    exchanges.push(JSON.parse(body));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ token: 'private-test-token', expiresIn: 3600, scopes, accountHint: 'te***@example.test', ...tokens }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const run = async (...args) => JSON.parse((await exec(process.execPath, [cli, ...args], { env, timeout: 15_000 })).stdout);
  const start = (...args) => run('auth-start', '--intent', 'publish_stax_card', '--no-open-browser', '--worker-url', `http://127.0.0.1:${server.address().port}`, '--allow-custom-worker-url', ...args);
  t.after(async () => { await run('auth-cancel').catch(() => undefined); server.closeAllConnections(); server.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, run, start, exchanges, env, workerUrl: `http://127.0.0.1:${server.address().port}` };
}
async function confirm(result, stateOverride) {
  const url = new URL(result.authorization_url);
  return fetch(url.searchParams.get('return_to'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'one-time-test-code', state: stateOverride ?? url.searchParams.get('auth_state') }) });
}
async function completed(run, id) {
  for (let i = 0; i < 40; i++) {
    const result = await run('auth-check', '--request-id', id);
    if (result.status !== 'awaiting_authorization') return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('receiver did not finish');
}
test('caller exits, independent receiver persists login, duplicate start reuses request, continue verifies scopes', async t => {
  const { root, run, start, exchanges } = await fixture(t);
  const first = await start(); // execFile has exited, no foreground parent remains.
  assert.equal(first.status, 'awaiting_authorization');
  const second = await start();
  assert.equal(second.request_id, first.request_id);
  assert.equal(second.authorization_url, first.authorization_url);
  assert.equal((await confirm(first, 'wrong-state')).status, 401);
  assert.equal((await confirm(first)).status, 200);
  const result = await completed(run, first.request_id);
  assert.equal(result.status, 'authenticated');
  assert.equal(result.requires_action, false);
  assert.equal(exchanges.length, 1);
  const url = new URL(first.authorization_url);
  assert.equal(createHash('sha256').update(exchanges[0].codeVerifier).digest('base64url'), url.searchParams.get('code_challenge'));
  const stateText = await fs.readFile(path.join(root, 'auth-flow/state.json'), 'utf8');
  for (const secret of ['private-test-token', 'one-time-test-code', exchanges[0].codeVerifier]) {
    assert.equal(stateText.includes(secret), false);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  assert.equal((await fs.stat(path.join(root, 'session.json'))).mode & 0o777, 0o600);
  await run('auth-logout');
  assert.equal((await run('auth-check', '--request-id', first.request_id)).status, 'login_required');
});
test('logout cancels receiver before clearing credentials and old callback cannot restore session', async t => {
  const { root, run, start } = await fixture(t);
  const pending = await start();
  assert.equal((await run('auth-logout')).status, 'logged_out');
  await assert.rejects(confirm(pending));
  await assert.rejects(fs.stat(path.join(root, 'session.json')));
  assert.equal((await run('auth-check')).status, 'authorization_cancelled');
});
test('receiver expires and new start obtains a fresh request', async t => {
  const { run, start } = await fixture(t);
  const first = await start('--timeout', '1');
  assert.equal((await completed(run, first.request_id)).status, 'authorization_expired');
  const second = await start();
  assert.notEqual(first.request_id, second.request_id);
});
test('insufficient scopes are not reported as authenticated', async t => {
  const { run, start } = await fixture(t, ['publisher.drafts.write']);
  const pending = await start();
  await confirm(pending);
  const result = await completed(run, pending.request_id);
  assert.equal(result.status, 'authorization_failed');
  assert.equal(result.error_code, 'auth_scope_missing');
});
test('publish-tool authorization requires and preserves the dedicated Flowchart token', async t => {
  const { root, run, workerUrl } = await fixture(t, ['publisher.drafts.write'], {
    flowchartToken: 'private-flowchart-test-token',
    flowchartTokenExpiresIn: 3600,
  });
  const pending = await run(
    'auth-start', '--intent', 'publish_tool', '--no-open-browser',
    '--worker-url', workerUrl, '--allow-custom-worker-url',
  );
  await confirm(pending);
  assert.equal((await completed(run, pending.request_id)).status, 'authenticated');
  const session = JSON.parse(await fs.readFile(path.join(root, 'session.json'), 'utf8'));
  assert.equal(session.flowchartToken, 'private-flowchart-test-token');
});
test('business command defers before scanning, then original command resumes after verified continue', async t => {
  const { root, run, env } = await fixture(t);
  const skillRoot = path.join(root, 'skill');
  const marker = path.join(root, 'scanned');
  await fs.mkdir(path.join(skillRoot, 'creator/scripts'), { recursive: true });
  await fs.writeFile(path.join(skillRoot, 'creator/scripts/taku_creator.mjs'), `
import fs from 'node:fs';
fs.writeFileSync(${JSON.stringify(marker)}, 'yes');
console.log(JSON.stringify({ok:true,editorUrl:'https://worker.taku.ai/stax/studio/editor?launch=fixture'}));
`);
  env.TAKU_PUBLISHER_SKILL_ROOT = skillRoot;
  // Use a fresh fixture request to obtain its mock Worker origin, then cancel it.
  const pending = await (async () => {
    const server = http.createServer(async (req, res) => {
      for await (const chunk of req) { /* drain */ }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({token:'business-token',expiresIn:3600,scopes:['creator.profile.read','creator.studio-draft.write']}));
    });
    await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
    t.after(() => {server.closeAllConnections();server.close();});
    return `http://127.0.0.1:${server.address().port}`;
  })();
  const args = ['creator-draft','--json','--editor','--no-open-browser','--worker-url',pending,'--allow-custom-worker-url'];
  const first = await run(...args);
  assert.equal(first.status, 'awaiting_authorization');
  await assert.rejects(fs.stat(marker));
  await confirm(first);
  assert.equal((await completed(run,first.request_id)).status,'authenticated');
  const result = await run(...args);
  assert.equal(result.ok,true);
  assert.equal(result.next_action,'open_editor_url');
  assert.equal(await fs.readFile(marker,'utf8'),'yes');
});
