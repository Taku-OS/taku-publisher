import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildDependencyPrefetchEvidence,
  computeRuntimeStableTreeDigest,
  runDependencyPrefetchAttempts,
  type ProcessResult,
} from '../src/runtime-cli.js';

test('runtime source digest ignores only exact framework-generated files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'taku-runtime-digest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'page.tsx'), 'export default 1;\n');
  const before = await computeRuntimeStableTreeDigest(root);

  await writeFile(join(root, 'next-env.d.ts'), 'generated\n');
  await writeFile(join(root, 'tsconfig.tsbuildinfo'), 'generated\n');
  assert.equal(await computeRuntimeStableTreeDigest(root), before);

  await writeFile(join(root, 'src', 'page.tsx'), 'export default 2;\n');
  assert.notEqual(await computeRuntimeStableTreeDigest(root), before);
});

test('dependency prefetch retries one timeout and keeps the successful result', async () => {
  const results = [
    processResult({
      timedOut: true,
      stdout: 'timed out while downloading token=secret-value',
    }),
    processResult({ exitCode: 0, stdout: 'downloaded' }),
  ];
  const attempts = await runDependencyPrefetchAttempts(
    async attempt => results[attempt - 1]!,
    { maxAttempts: 2, retryDelayMs: 0 },
  );

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.timedOut, true);
  assert.equal(attempts[1]?.exitCode, 0);

  const evidence = buildDependencyPrefetchEvidence(attempts);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.attemptCount, 2);
  assert.equal(evidence.retried, true);
  assert.match(evidence.attempts[0]?.diagnostic ?? '', /timed out while downloading/);
  assert.doesNotMatch(evidence.attempts[0]?.diagnostic ?? '', /secret-value/);
});

test('dependency prefetch does not retry a completed pnpm failure', async () => {
  let calls = 0;
  const attempts = await runDependencyPrefetchAttempts(
    async () => {
      calls += 1;
      return processResult({ exitCode: 1, stderr: 'lockfile failure' });
    },
    { maxAttempts: 2, retryDelayMs: 0 },
  );

  assert.equal(calls, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.exitCode, 1);
});

test('dependency prefetch stops after the configured timeout retry limit', async () => {
  let calls = 0;
  const attempts = await runDependencyPrefetchAttempts(
    async () => {
      calls += 1;
      return processResult({ timedOut: true });
    },
    { maxAttempts: 2, retryDelayMs: 0 },
  );

  assert.equal(calls, 2);
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every(attempt => attempt.timedOut));
});

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    ...overrides,
  };
}
