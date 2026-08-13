import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  planSubAppRuntimeValidation,
  runSubAppRuntimeValidation,
} from '../dist/index.js';

test('plans a confirmed trusted-runtime phase without executing candidate scripts', async t => {
  const candidate = await candidateFixture(t);
  let checks = 0;
  const plan = await planSubAppRuntimeValidation(candidate, {
    checkConversion: async () => {
      checks += 1;
      return converted(candidate, `sha256:${'a'.repeat(64)}`);
    },
  });

  assert.equal(checks, 1);
  assert.equal(plan.nodeVersion, '20.20.2');
  assert.equal(plan.pnpmVersion, '10.15.1');
  assert.match(plan.confirmationToken, /^subapp_runtime_confirm_[a-f0-9]{64}$/);
  assert.equal(plan.scriptsExecuted, false);
  assert.equal(plan.publishStarted, false);
});

test('rejects stale runtime confirmation before toolchain setup or execution', async t => {
  const candidate = await candidateFixture(t);
  let toolchainCalls = 0;
  let runtimeCalls = 0;
  let digest = `sha256:${'a'.repeat(64)}`;
  const options = {
    checkConversion: async () => converted(candidate, digest),
    ensureToolchain: async () => {
      toolchainCalls += 1;
      return { nodeExecutable: '/managed/node', pnpmCli: '/managed/pnpm.cjs' };
    },
    runRuntime: async () => {
      runtimeCalls += 1;
      return {};
    },
  };
  const plan = await planSubAppRuntimeValidation(candidate, options);
  digest = `sha256:${'b'.repeat(64)}`;

  await assert.rejects(
    runSubAppRuntimeValidation(
      { candidate, confirmationToken: plan.confirmationToken },
      options,
    ),
    error => error?.code === 'subapp_runtime_confirmation_mismatch',
  );
  assert.equal(toolchainCalls, 0);
  assert.equal(runtimeCalls, 0);
});

test('runs a confirmed phase with the pinned toolchain and validates its envelope', async t => {
  const candidate = await candidateFixture(t);
  const candidateDigest = `sha256:${'c'.repeat(64)}`;
  const options = {
    checkConversion: async () => converted(candidate, candidateDigest),
    ensureToolchain: async requirements => {
      assert.deepEqual(requirements, { nodeVersion: '20.20.2', pnpmVersion: '10.15.1' });
      return { nodeExecutable: '/managed/node', pnpmCli: '/managed/pnpm.cjs' };
    },
    runRuntime: async request => ({
      protocol: 'repo-to-stax.trusted-runtime.v1',
      converterVersion: '0.2.0',
      workspaceRoot: await fs.realpath(candidate),
      candidateDigest,
      toolchain: { nodeVersion: '20.20.2', pnpmVersion: '10.15.1' },
      qualification: { qualified: true, profileDigest: `sha256:${'d'.repeat(64)}` },
      dependencyPrefetch: { ok: true },
      commands: [
        'install', 'test', 'check:slots', 'type-check', 'ci:check', 'build',
      ].map(id => ({ id, exitCode: 0, signal: null, timedOut: false })),
      originalCandidateUnchanged: true,
      disposableWorkspaceRemoved: true,
      scriptsExecutedInDisposableWorkspace: true,
      buildArtifact: {
        schemaVersion: 'taku.subapp-runtime-build.v1',
        buildOutputDir: '.next-preview',
        evidenceRelativePath: 'build-output/.next-preview',
        treeDigest: `sha256:${'e'.repeat(64)}`,
        fileCount: 5,
        sizeBytes: 1024,
      },
      publishStarted: false,
      evidenceRoot: request.evidenceRoot,
    }),
  };
  const plan = await planSubAppRuntimeValidation(candidate, options);
  const result = await runSubAppRuntimeValidation(
    { candidate, confirmationToken: plan.confirmationToken },
    options,
  );

  assert.equal(result.ok, true);
  assert.equal(result.commands.length, 6);
  assert.equal(result.publishStarted, false);
  assert.equal(result.originalCandidateUnchanged, true);
});

async function candidateFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-subapp-runtime-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, '.nvmrc'), '20.20.2\n');
  await fs.writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({ packageManager: 'pnpm@10.15.1' })}\n`,
  );
  return fs.realpath(root);
}

function converted(candidate, candidateDigest) {
  return {
    workspaceRoot: path.resolve(candidate),
    candidateDigest,
    migration: { status: 'converted' },
    validation: { ok: true },
    converted: true,
  };
}
