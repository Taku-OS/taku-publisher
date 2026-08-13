import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { readZip } from '../dist/core.js';
import {
  packageSubApp,
  planSubAppPackage,
} from '../dist/subapp-package.js';
import { summarizeArtifactTree } from '../../repo-to-stax-converter/dist/runtime-cli.js';

const REQUIRED_BUILD_FILES = [
  'BUILD_ID',
  'prerender-manifest.json',
  'routes-manifest.json',
  'build-manifest.json',
  'required-server-files.json',
];

test('plans and creates deterministic Desktop-compatible SubApp archives', async t => {
  const fixture = await packageFixture(t);
  const options = fixture.options;
  const plan = await planSubAppPackage(
    { candidate: fixture.candidate, runtimeEvidence: fixture.evidenceRoot },
    options,
  );

  assert.match(plan.confirmationToken, /^subapp_package_confirm_[a-f0-9]{64}$/);
  assert.equal(plan.scriptsExecuted, false);
  assert.equal(plan.publishStarted, false);

  const firstOutput = path.join(fixture.root, 'packages-a');
  const secondOutput = path.join(fixture.root, 'packages-b');
  await fs.mkdir(firstOutput);
  await fs.mkdir(secondOutput);
  const first = await packageSubApp(
    {
      candidate: fixture.candidate,
      runtimeEvidence: fixture.evidenceRoot,
      outputRoot: firstOutput,
      confirmationToken: plan.confirmationToken,
    },
    options,
  );
  const second = await packageSubApp(
    {
      candidate: fixture.candidate,
      runtimeEvidence: fixture.evidenceRoot,
      outputRoot: secondOutput,
      confirmationToken: plan.confirmationToken,
    },
    options,
  );

  assert.equal(first.source.sha256, second.source.sha256);
  assert.equal(first.build.sha256, second.build.sha256);
  assert.equal(first.manifest.schemaVersion, 'taku.publisher.subapp-package.v1');
  assert.deepEqual(first.manifest.serviceAuthorizations, []);
  assert.equal(first.manifest.publishStarted, false);

  const sourceEntries = readZip(
    await fs.readFile(path.join(first.packageRoot, 'source.zip')),
  ).map(entry => entry.name);
  assert.ok(sourceEntries.includes('package.json'));
  assert.ok(sourceEntries.includes('taku.manifest.json'));
  assert.ok(sourceEntries.includes('src/page.tsx'));
  assert.equal(sourceEntries.some(name => name.startsWith('.taku/')), false);
  assert.equal(sourceEntries.some(name => name.startsWith('.next-preview/')), false);
  assert.equal(sourceEntries.some(name => name.startsWith('.env')), false);

  const buildEntries = readZip(
    await fs.readFile(path.join(first.packageRoot, 'build.zip')),
  ).map(entry => entry.name);
  for (const required of REQUIRED_BUILD_FILES) {
    assert.ok(buildEntries.includes(`.next-preview/${required}`));
  }
  assert.ok(buildEntries.includes('.next-preview/server/app.js'));
});

test('rejects stale confirmation before creating package output', async t => {
  const fixture = await packageFixture(t);
  const outputRoot = path.join(fixture.root, 'packages');
  await fs.mkdir(outputRoot);
  const plan = await planSubAppPackage(
    { candidate: fixture.candidate, runtimeEvidence: fixture.evidenceRoot },
    fixture.options,
  );
  const staleConfirmation = `${plan.confirmationToken}-stale`;

  await assert.rejects(
    packageSubApp(
      {
        candidate: fixture.candidate,
        runtimeEvidence: fixture.evidenceRoot,
        outputRoot,
        confirmationToken: staleConfirmation,
      },
      fixture.options,
    ),
    error => error?.code === 'subapp_package_confirmation_mismatch',
  );
  assert.deepEqual(await fs.readdir(outputRoot), []);
});

test('rejects changed trusted build evidence', async t => {
  const fixture = await packageFixture(t);
  await fs.writeFile(
    path.join(fixture.evidenceRoot, 'build-output', '.next-preview', 'BUILD_ID'),
    'changed\n',
  );

  await assert.rejects(
    planSubAppPackage(
      { candidate: fixture.candidate, runtimeEvidence: fixture.evidenceRoot },
      fixture.options,
    ),
    error => error?.code === 'subapp_package_build_artifact_changed',
  );
});

test('rejects package output that overlaps the candidate', async t => {
  const fixture = await packageFixture(t);
  const plan = await planSubAppPackage(
    { candidate: fixture.candidate, runtimeEvidence: fixture.evidenceRoot },
    fixture.options,
  );

  await assert.rejects(
    packageSubApp(
      {
        candidate: fixture.candidate,
        runtimeEvidence: fixture.evidenceRoot,
        outputRoot: fixture.candidate,
        confirmationToken: plan.confirmationToken,
      },
      fixture.options,
    ),
    error => error?.code === 'subapp_package_output_overlaps_input',
  );
});

async function packageFixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'taku-subapp-package-test-')),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidate = path.join(root, 'candidate');
  const stateRoot = path.join(root, 'state');
  const evidenceRoot = path.join(stateRoot, 'evidence', 'runtime-test');
  const buildRoot = path.join(evidenceRoot, 'build-output', '.next-preview');
  await fs.mkdir(path.join(candidate, 'src'), { recursive: true });
  await fs.mkdir(path.join(candidate, '.taku'), { recursive: true });
  await fs.mkdir(path.join(candidate, '.next-preview'), { recursive: true });
  await fs.mkdir(path.join(buildRoot, 'server'), { recursive: true });
  await fs.writeFile(
    path.join(candidate, 'package.json'),
    `${JSON.stringify({
      name: 'calculator-app',
      scripts: {
        'start:preview': 'node scripts/start-preview.js',
        'start:edit': 'node scripts/start-edit.js',
      },
    })}\n`,
  );
  await fs.writeFile(
    path.join(candidate, 'taku.manifest.json'),
    `${JSON.stringify({
      name: 'Calculator App',
      description: 'A calculator.',
      version: '1.0.0',
      actions: [],
    })}\n`,
  );
  await fs.writeFile(path.join(candidate, 'src', 'page.tsx'), 'export default 1;\n');
  await fs.writeFile(path.join(candidate, '.env'), 'SHOULD_NOT_SHIP=1\n');
  await fs.writeFile(path.join(candidate, '.taku', 'migration.json'), '{}\n');
  await fs.writeFile(path.join(candidate, '.next-preview', 'ignored'), 'ignored\n');
  for (const file of REQUIRED_BUILD_FILES) {
    await fs.writeFile(path.join(buildRoot, file), `${file}\n`);
  }
  await fs.writeFile(path.join(buildRoot, 'server', 'app.js'), 'server build\n');
  const buildArtifact = {
    schemaVersion: 'taku.subapp-runtime-build.v1',
    buildOutputDir: '.next-preview',
    evidenceRelativePath: 'build-output/.next-preview',
    ...(await summarizeArtifactTree(buildRoot)),
  };
  const candidateDigest = `sha256:${'c'.repeat(64)}`;
  await fs.writeFile(
    path.join(evidenceRoot, 'runtime-receipt.json'),
    `${JSON.stringify({
      schemaVersion: 'taku.publisher.subapp-runtime-receipt.v1',
      ok: true,
      candidateDigest,
      toolchain: { nodeVersion: '20.20.2', pnpmVersion: '10.15.1' },
      qualificationDigest: `sha256:${'q'.repeat(64)}`,
      buildArtifact,
      publishStarted: false,
    }, null, 2)}\n`,
  );
  const options = {
    stateRoot,
    checkConversion: async () => ({
      workspaceRoot: candidate,
      candidateDigest,
      migration: { status: 'converted' },
      validation: { ok: true },
      converted: true,
    }),
  };
  return { root, candidate, stateRoot, evidenceRoot, options };
}
