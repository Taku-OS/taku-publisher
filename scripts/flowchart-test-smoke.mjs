#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = JSON.parse(await fs.readFile(path.join(root, 'dist/flowchart-test/build.json'), 'utf8'));
const skillRoot = path.join(
  root,
  'dist/flowchart-test/codex/plugins',
  build.name,
  'skills',
  build.name,
);
const runner = path.join(skillRoot, 'scripts/taku-publisher.mjs');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-flowchart-smoke-'));
const workspace = path.join(temporaryRoot, 'workspace');
const source = path.join(workspace, 'smoke-skill');
const publisherHome = path.join(temporaryRoot, 'publisher-home');
const requests = [];
let createdPayload = null;
const graph = (title) => ({
  nodes: [
    { id: 'input', title: `${title} input` },
    { id: 'output', title: `${title} output` },
  ],
  edges: [{ from: 'input', to: 'output' }],
});
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    requests.push({
      method: request.method,
      path: request.url,
      idempotencyKey: String(request.headers['idempotency-key'] ?? ''),
      body,
    });
    response.setHeader('content-type', 'application/json');
    if (request.url === '/publisher/flowchart/generate') {
      response.end(JSON.stringify({
        flowchartIntro: graph('Default'),
        flowchartIntroI18n: {
          'en-US': graph('English'),
          'zh-CN': graph('中文'),
        },
      }));
    } else if (request.url === '/marketplace/icons/generate') {
      response.end('{"imageUrl":"https://cdn.example.test/flowchart-smoke.png"}');
    } else if (request.url === '/stax/publisher/drafts') {
      createdPayload = body;
      response.end('{"id":"mock-flowchart-private-draft","reviewUrl":"https://example.test/private-review"}');
    } else {
      response.statusCode = 404;
      response.end('{"error":"not found"}');
    }
  });
});

try {
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(path.join(source, 'SKILL.md'), [
    '---',
    'name: flowchart-smoke-skill',
    'description: Verifies automatic bilingual Marketplace Flowchart generation.',
    '---',
    '# Flowchart smoke Skill',
    '',
  ].join('\n'));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const workerUrl = `http://127.0.0.1:${address.port}`;
  const env = {
    ...process.env,
    TAKU_PUBLISHER_HOME: publisherHome,
    TAKU_FLOWCHART_SMOKE_TOKEN: ['mock', 'flowchart', 'smoke', 'token'].join('_'),
  };
  delete env.TAKU_PUBLISHER_GENERATE_FLOWCHART;

  const initialized = await run([
    'init',
    '--workspace', workspace,
    '--source', source,
    '--type', 'skill',
    '--mode', 'create',
    '--draft-id', 'flowchart-package-smoke',
  ], env);
  assert.equal(initialized.status, 'selected');

  const created = await run([
    'remote-create',
    '--draft-id', initialized.draft_id,
    '--worker-url', workerUrl,
    '--allow-custom-worker-url',
    '--token-env', 'TAKU_FLOWCHART_SMOKE_TOKEN',
    '--no-browser-login',
  ], env);
  assert.equal(created.status, 'remote_draft_created');
  assert.deepEqual(requests.map((request) => request.path), [
    '/publisher/flowchart/generate',
    '/marketplace/icons/generate',
    '/stax/publisher/drafts',
  ]);
  assert.match(
    requests[0].idempotencyKey,
    /^publisher-flowchart:v1:[a-f0-9]{24}:[a-f0-9]{64}$/,
  );
  assert.equal(createdPayload.listing.flowchartIntro.nodes.length, 2);
  assert.equal(createdPayload.listing.flowchartIntroI18n['en-US'].nodes.length, 2);
  assert.equal(createdPayload.listing.flowchartIntroI18n['zh-CN'].nodes.length, 2);
  console.log(JSON.stringify({
    ok: true,
    status: 'mock_worker_flowchart_end_to_end_passed',
    plugin: build.name,
    version: build.version,
    requests: requests.map((request) => request.path),
    remoteDraftCreated: true,
    productionCalled: false,
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(() => resolve()));
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

async function run(args, env) {
  const { stdout } = await execFileAsync(process.execPath, [runner, ...args], {
    cwd: skillRoot,
    env,
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}
