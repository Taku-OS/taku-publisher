import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_MAX_USAGE_BYTES,
  DEFAULT_MAX_USAGE_FILE_BYTES,
  DEFAULT_MAX_USAGE_FILES,
  DEFAULT_USAGE_SCAN_TIMEOUT_MS,
  scanUsage,
} from './usage.mjs';
import { selectUsageForDraft } from './draft.mjs';

test('uses a bounded default usage scan budget for host and onboarding flows', () => {
  assert.equal(DEFAULT_MAX_USAGE_FILES, 2500);
  assert.equal(DEFAULT_MAX_USAGE_BYTES, 128 * 1024 * 1024);
  assert.equal(DEFAULT_MAX_USAGE_FILE_BYTES, 160 * 1024);
  assert.equal(DEFAULT_USAGE_SCAN_TIMEOUT_MS, 15_000);
});

test('tail-samples oversized JSONL logs and returns a usable partial result', async (context) => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-usage-budget-'));
  context.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  const sessionsDir = path.join(homeDir, '.codex', 'sessions');
  await fs.mkdir(sessionsDir, { recursive: true });
  const timestamp = new Date().toISOString();
  const filler = `${JSON.stringify({ timestamp, message: { role: 'assistant', content: 'x'.repeat(180) } })}\n`;
  const usage = `${JSON.stringify({
    timestamp,
    session_id: 'test-session-id',
    usage: { input_tokens: 120, output_tokens: 30 },
  })}\n`;
  await fs.writeFile(path.join(sessionsDir, 'large.jsonl'), `${filler.repeat(20)}${usage}`, 'utf8');

  const result = await scanUsage({
    homeDir,
    maxFiles: 10,
    maxBytes: 1024,
    maxFileBytes: 1024,
    timeoutMs: 5_000,
  });

  assert.equal(result.partial, true);
  assert.equal(result.scanCoverage.sampledFileCount, 1);
  assert.equal(result.sessionCount, 1);
  assert.equal(result.totalTokens, 150);
  assert.match(result.warnings.join('\n'), /recent tails/i);
});

test('attributes sampled Codex cumulative usage to the model found near the file head', async (context) => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-usage-model-head-'));
  context.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  const sessionsDir = path.join(homeDir, '.codex', 'sessions');
  await fs.mkdir(sessionsDir, { recursive: true });
  const timestamp = new Date().toISOString();
  const model = `${JSON.stringify({
    timestamp,
    type: 'turn_context',
    payload: { model: 'gpt-5.6-sol' },
  })}\n`;
  const filler = `${JSON.stringify({ timestamp, message: { role: 'assistant', content: 'x'.repeat(180) } })}\n`;
  const usage = `${JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
        last_token_usage: { input_tokens: 16, output_tokens: 4, total_tokens: 20 },
      },
    },
  })}\n`;
  await fs.writeFile(path.join(sessionsDir, 'large.jsonl'), `${model}${filler.repeat(20)}${usage}`, 'utf8');

  const result = await scanUsage({
    homeDir,
    maxFiles: 10,
    maxBytes: 1024,
    maxFileBytes: 1024,
    timeoutMs: 5_000,
  });

  assert.equal(result.totalTokens, 150);
  assert.equal(result.modelUsage.totalTokens, 150);
  assert.equal(result.modelUsage.topModels[0]?.modelId, 'gpt-5.6-sol');
});

test('interleaves sources before consuming the file-count budget', async (context) => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-usage-fair-'));
  context.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  const timestamp = new Date().toISOString();
  const codexDir = path.join(homeDir, '.codex', 'sessions');
  const claudeDir = path.join(homeDir, '.claude', 'projects', 'sample');
  await fs.mkdir(codexDir, { recursive: true });
  await fs.mkdir(claudeDir, { recursive: true });
  for (let index = 0; index < 4; index += 1) {
    await fs.writeFile(
      path.join(codexDir, `codex-${index}.jsonl`),
      `${JSON.stringify({ timestamp, session_id: `codex-${index}`, usage: { input_tokens: 10 } })}\n`,
      'utf8',
    );
  }
  await fs.writeFile(
    path.join(claudeDir, 'claude.jsonl'),
    `${JSON.stringify({ timestamp, session_id: 'claude', usage: { input_tokens: 20 } })}\n`,
    'utf8',
  );

  const result = await scanUsage({
    homeDir,
    maxFiles: 2,
    maxBytes: 4096,
    maxFileBytes: 2048,
    timeoutMs: 5_000,
  });

  assert.equal(result.scannedFileCount, 2);
  assert.deepEqual(
    result.sources.filter((source) => source.sessionCount > 0).map((source) => source.source).sort(),
    ['claude-code', 'codex'],
  );
  assert.equal(result.partial, true);
  assert.equal(result.scanCoverage.stoppedReason, 'files');
});

test('reads Claude Code usage from CLAUDE_CONFIG_DIR', async (context) => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-usage-home-'));
  const claudeConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-claude-config-'));
  context.after(() => Promise.all([
    fs.rm(homeDir, { recursive: true, force: true }),
    fs.rm(claudeConfigDir, { recursive: true, force: true }),
  ]));
  const projectDir = path.join(claudeConfigDir, 'projects', 'sample');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'claude.jsonl'),
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      session_id: 'test-session-id',
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 80, output_tokens: 20 },
    })}\n`,
    'utf8',
  );

  const result = await scanUsage({ homeDir, claudeConfigDir, timeoutMs: 5_000 });

  assert.equal(result.totalTokens, 100);
  assert.equal(result.sources.find((source) => source.source === 'claude-code')?.sessionCount, 1);
  assert.equal(result.modelUsage.topModels[0]?.modelId, 'claude-sonnet-4-6');
});

test('uses Claude stats-cache only when detailed transcripts are unavailable', async (context) => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-usage-stats-'));
  context.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  const claudeDir = path.join(homeDir, '.claude');
  await fs.mkdir(claudeDir, { recursive: true });
  await fs.writeFile(
    path.join(claudeDir, 'stats-cache.json'),
    JSON.stringify({ model: 'claude-sonnet-4-6', total_tokens: 900 }),
    'utf8',
  );

  const fallback = await scanUsage({ homeDir, timeoutMs: 5_000 });
  assert.equal(fallback.totalTokens, 900);

  const projectDir = path.join(claudeDir, 'projects', 'sample');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    path.join(projectDir, 'claude.jsonl'),
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      session_id: 'test-session-id',
      model: 'claude-sonnet-4-6',
      usage: { input_tokens: 30, output_tokens: 10 },
    })}\n`,
    'utf8',
  );

  const detailed = await scanUsage({ homeDir, timeoutMs: 5_000 });
  assert.equal(detailed.totalTokens, 40);
});

test('keeps only public-safe bounded scan coverage in the draft', () => {
  const selected = selectUsageForDraft({
    scanned: true,
    periodLabel: 'Last 7 Days',
    primaryPeriodId: 'last7Days',
    totalTokens: 150,
    sessionCount: 1,
    eventCount: 2,
    periods: [],
    sources: [],
    partial: true,
    scanCoverage: {
      partial: true,
      stoppedReason: 'bytes',
      candidateFileCount: 100,
      scannedFileCount: 10,
      sampledFileCount: 2,
      scannedByteCount: 4096,
      localPath: '/private/session.jsonl',
    },
  });

  assert.equal(selected.partial, true);
  assert.equal(selected.scanCoverage.stoppedReason, 'bytes');
  assert.equal(selected.scanCoverage.sampledFileCount, 2);
  assert.equal('localPath' in selected.scanCoverage, false);
  assert.match(selected.note, /bounded recent sample/i);
});
