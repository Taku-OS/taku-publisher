import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  AI_CLIENTS_SCHEMA,
  detectInvokingAiClient,
  discoverAiClients,
} from './host-platform.mjs';

test('uses the packaged host adapter as the invoking Stax default', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-host-marker-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const markerPath = path.join(root, 'host-adapter.json');
  await fs.writeFile(markerPath, JSON.stringify({ host: 'claude-code' }));

  assert.equal(await detectInvokingAiClient({ markerPath, env: {} }), 'claude-code');
  await fs.writeFile(markerPath, JSON.stringify({ host: 'cursor' }));
  assert.equal(await detectInvokingAiClient({ markerPath, env: {} }), 'cursor');
  assert.equal(await detectInvokingAiClient({ markerPath, env: { TAKU_CREATOR_HOST: 'codex' } }), 'codex');
});

test('recognizes older portable Skills in Cursor paths without a host marker', async () => {
  assert.equal(await detectInvokingAiClient({
    moduleUrl: pathToFileURL(path.join(os.tmpdir(), '.cursor/skills/taku-publisher/creator/scripts/host-platform.mjs')).href,
    markerPath: path.join(os.tmpdir(), 'missing-taku-fixture-marker.json'), env: {},
  }), 'cursor');
});

test('recognizes portable Skills in OpenCode and Gemini paths', async () => {
  assert.equal(await detectInvokingAiClient({
    moduleUrl: pathToFileURL(path.join(os.tmpdir(), '.config/opencode/skills/taku-publisher/creator/scripts/host-platform.mjs')).href,
    markerPath: path.join(os.tmpdir(), 'missing-taku-opencode-marker.json'), env: {},
  }), 'opencode');
  assert.equal(await detectInvokingAiClient({
    moduleUrl: pathToFileURL(path.join(os.tmpdir(), '.gemini/skills/taku-publisher/creator/scripts/host-platform.mjs')).href,
    markerPath: path.join(os.tmpdir(), 'missing-taku-gemini-marker.json'), env: {},
  }), 'gemini');
});

test('keeps the invoking host first and exposes other locally detected clients', async (context) => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-ai-clients-'));
  context.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(homeDir, '.codex'));
  await fs.mkdir(path.join(homeDir, '.claude'));
  await fs.mkdir(path.join(homeDir, '.config', 'opencode'), { recursive: true });

  const result = await discoverAiClients({
    invokingHost: 'claude-code',
    homeDir,
    env: {},
    usageSources: [{ source: 'cursor', label: 'Cursor' }],
  });

  assert.equal(result.schemaVersion, AI_CLIENTS_SCHEMA);
  assert.equal(result.defaultClient, 'claude-code');
  assert.deepEqual(result.options.map((item) => item.id), ['claude-code', 'codex', 'cursor', 'opencode']);
  assert.deepEqual(result.options[0].detectedBy, ['invoking-host', 'local-install']);
});
