import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
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
});

test('keeps the invoking host first and exposes other locally detected clients', async (context) => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-ai-clients-'));
  context.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(homeDir, '.codex'));
  await fs.mkdir(path.join(homeDir, '.claude'));

  const result = await discoverAiClients({
    invokingHost: 'claude-code',
    homeDir,
    usageSources: [{ source: 'cursor', label: 'Cursor' }],
  });

  assert.equal(result.schemaVersion, AI_CLIENTS_SCHEMA);
  assert.equal(result.defaultClient, 'claude-code');
  assert.deepEqual(result.options.map((item) => item.id), ['claude-code', 'codex', 'cursor']);
  assert.deepEqual(result.options[0].detectedBy, ['invoking-host', 'local-install']);
});
