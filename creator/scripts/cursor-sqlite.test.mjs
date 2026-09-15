import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  cursorStateDatabasePath,
  cursorUsageSessionsFromRows,
  readCursorStateUsage,
} from './cursor-sqlite.mjs';

test('resolves Cursor state database paths for supported desktop platforms', () => {
  const macHome = path.join(path.sep, 'Users', 'example');
  const linuxHome = path.join(path.sep, 'home', 'example');
  const configRoot = path.join(path.sep, 'config');
  const customDatabase = path.join(path.sep, 'custom', 'state.vscdb');
  assert.equal(
    cursorStateDatabasePath({ homeDir: macHome, platform: 'darwin', env: {} }),
    path.join(macHome, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
  );
  assert.equal(
    cursorStateDatabasePath({ homeDir: linuxHome, platform: 'linux', env: { XDG_CONFIG_HOME: configRoot } }),
    path.join(configRoot, 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
  );
  assert.equal(
    cursorStateDatabasePath({ homeDir: linuxHome, platform: 'linux', env: { CURSOR_STATE_DB: customDatabase } }),
    path.resolve(customDatabase),
  );
});

test('uses only explicit Cursor tokenCount values and never estimates from text', () => {
  const sessions = cursorUsageSessionsFromRows([
    {
      key: 'bubbleId:composer-1:bubble-1',
      value: JSON.stringify({
        bubbleId: 'bubble-1',
        usageUuid: 'usage-1',
        model: 'cursor-model',
        tokenCount: {
          inputTokens: 120,
          outputTokens: 30,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
          reasoningTokens: 2,
        },
      }),
    },
    {
      key: 'bubbleId:composer-1:bubble-without-usage',
      value: JSON.stringify({ text: 'This must not become an estimate.' }),
    },
    {
      key: 'bubbleId:composer-1:bubble-1-copy',
      value: JSON.stringify({
        bubbleId: 'bubble-1-copy',
        usageUuid: 'usage-1',
        tokenCount: { inputTokens: 120, outputTokens: 30 },
      }),
    },
  ], [
    {
      key: 'composerData:composer-1',
      value: JSON.stringify({ lastUpdatedAt: '2026-09-10T10:00:00.000Z' }),
    },
  ]);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].records.length, 1);
  assert.deepEqual(sessions[0].records[0].usage, {
    input_tokens: 120,
    output_tokens: 30,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 5,
    reasoning_output_tokens: 2,
  });
  assert.equal(sessions[0].records[0].timestamp, '2026-09-10T10:00:00.000Z');
});

test('reports a present database without explicit token counts as unavailable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-cursor-sqlite-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDbPath = path.join(root, 'state.vscdb');
  await fs.writeFile(stateDbPath, 'fixture');

  const result = await readCursorStateUsage({
    stateDbPath,
    queryDatabase: async () => ({
      bubbles: [{
        key: 'bubbleId:composer-1:bubble-1',
        value: JSON.stringify({ text: 'No explicit tokenCount here.' }),
      }],
      composers: [],
      scannedByteCount: 42,
    }),
  });

  assert.equal(result.found, true);
  assert.equal(result.scanned, true);
  assert.equal(result.exact, false);
  assert.equal(result.sessions.length, 0);
  assert.match(result.warning, /not estimated/i);
});
