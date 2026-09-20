import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  openCodeStateDatabasePath,
  openCodeUsageSessionsFromRows,
  readOpenCodeStateUsage,
  resolveOpenCodeDataDir,
} from '../dist/opencode-local.js';

test('resolves OpenCode data and database paths without inspecting configuration', () => {
  const homeDir = path.join(path.sep, 'Users', 'example');
  assert.equal(
    resolveOpenCodeDataDir({ homeDir, platform: 'darwin', env: {} }),
    path.join(homeDir, '.local', 'share', 'opencode'),
  );
  assert.equal(
    resolveOpenCodeDataDir({
      homeDir,
      platform: 'linux',
      env: { XDG_DATA_HOME: path.join(path.sep, 'private', 'data') },
    }),
    path.join(path.sep, 'private', 'data', 'opencode'),
  );
  assert.equal(
    openCodeStateDatabasePath({
      homeDir,
      env: { OPENCODE_STATE_DB: path.join(path.sep, 'custom', 'opencode.db') },
    }),
    path.join(path.sep, 'custom', 'opencode.db'),
  );
});

test('uses only explicit OpenCode session counters and ignores rows without usage', () => {
  const sessions = openCodeUsageSessionsFromRows([
    {
      session_id: 'run-1',
      directory: '/work/project',
      model: JSON.stringify({ id: 'gpt-5.6-sol', providerID: 'test' }),
      time_updated: 1_789_000_000_000,
      tokens_input: 120,
      tokens_output: 30,
      tokens_reasoning: 2,
      tokens_cache_read: 10,
      tokens_cache_write: 5,
    },
    {
      session_id: 'test-session-id',
      directory: '/work/project',
      title: 'This must never become a token estimate.',
    },
  ]);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, 'run-1');
  assert.equal(sessions[0].records[0].model, 'gpt-5.6-sol');
  assert.equal(sessions[0].records[0].workspace, '/work/project');
  assert.deepEqual(sessions[0].records[0].usage, {
    input_tokens: 120,
    output_tokens: 30,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 5,
    reasoning_output_tokens: 2,
  });
});

test('reports explicit OpenCode usage through a bounded database query', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-opencode-usage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateDbPath = path.join(root, 'opencode.db');
  await fs.writeFile(stateDbPath, 'fixture');
  let requestedKind;

  const result = await readOpenCodeStateUsage({
    stateDbPath,
    maxRows: 25,
    queryDatabase: async (_databasePath, options) => {
      requestedKind = options.kind;
      return {
        rows: [{
          session_id: 'run-1',
          time_updated: '2026-09-20T10:00:00.000Z',
          tokens_input: 80,
          tokens_output: 20,
          tokens_reasoning: 0,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
        }],
        scannedByteCount: 128,
      };
    },
  });

  assert.equal(requestedKind, 'sessions');
  assert.equal(result.found, true);
  assert.equal(result.scanned, true);
  assert.equal(result.exact, true);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.scannedByteCount, 128);
});
