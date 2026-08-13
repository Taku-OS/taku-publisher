import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { buildPublisherPackageArtifact } from '../dist/core.js';
import {
  planLocalSubAppInstall,
  requestLocalSubAppInstall,
} from '../dist/subapp-local-install.js';

test('plans a source-bound local Taku Desktop install', async t => {
  const fixture = await packageFixture(t);
  const plan = await planLocalSubAppInstall({ packageRoot: fixture.packageRoot });

  assert.match(plan.confirmationToken, /^subapp_install_confirm_[a-f0-9]{64}$/);
  assert.match(plan.packageDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(plan.registrationStarted, false);
  assert.equal(plan.publishStarted, false);
});

test('rejects stale confirmation before creating a handoff', async t => {
  const fixture = await packageFixture(t);
  const handoffRoot = path.join(fixture.root, 'handoffs');

  await assert.rejects(
    requestLocalSubAppInstall(
      { packageRoot: fixture.packageRoot, confirmationToken: 'stale' },
      { handoffRoot, openTaku: async () => true, waitForResult: false },
    ),
    error => error?.code === 'subapp_local_install_confirmation_mismatch',
  );
  assert.equal((await fs.readdir(handoffRoot).catch(() => [])).length, 0);
});

test('writes an owner-only one-time handoff and opens packaged Taku', async t => {
  const fixture = await packageFixture(t);
  const handoffRoot = path.join(fixture.root, 'handoffs');
  const plan = await planLocalSubAppInstall({ packageRoot: fixture.packageRoot });
  let openedUrl = '';

  const result = await requestLocalSubAppInstall(
    { packageRoot: fixture.packageRoot, confirmationToken: plan.confirmationToken },
    {
      handoffRoot,
      openTaku: async url => {
        openedUrl = url;
        return true;
      },
      waitForResult: false,
    },
  );

  assert.equal(result.status, 'pending');
  assert.equal(openedUrl, result.deepLink);
  assert.match(openedUrl, /^taku:\/\/subapp\/install\?handoff=[a-f0-9]{64}$/);
  const handoffPath = path.join(handoffRoot, `${result.handoffId}.json`);
  const handoff = JSON.parse(await fs.readFile(handoffPath, 'utf8'));
  const stat = await fs.stat(handoffPath);
  assert.equal(handoff.schemaVersion, 'taku.publisher.subapp-install-handoff.v1');
  assert.equal(handoff.packageRoot, fixture.packageRoot);
  assert.equal(stat.mode & 0o077, 0);
});

test('waits for Taku Desktop and returns the installed application', async t => {
  const fixture = await packageFixture(t);
  const handoffRoot = path.join(fixture.root, 'handoffs');
  const plan = await planLocalSubAppInstall({ packageRoot: fixture.packageRoot });

  const result = await requestLocalSubAppInstall(
    { packageRoot: fixture.packageRoot, confirmationToken: plan.confirmationToken },
    {
      handoffRoot,
      openTaku: async url => {
        const handoffId = new URL(url).searchParams.get('handoff');
        await fs.writeFile(
          path.join(handoffRoot, `${handoffId}.result.json`),
          `${JSON.stringify({
            schemaVersion: 'taku.subapp-install-result.v1',
            handoffId,
            ok: true,
            status: 'installed_and_opened',
            applicationId: 'local-app-1',
          })}\n`,
          { mode: 0o600 },
        );
        return true;
      },
      waitTimeoutMs: 2_000,
      pollIntervalMs: 10,
    },
  );

  assert.equal(result.status, 'installed_and_opened');
  assert.equal(result.applicationId, 'local-app-1');
});

test('rejects an install result that is writable by other local users', async t => {
  const fixture = await packageFixture(t);
  const handoffRoot = path.join(fixture.root, 'handoffs');
  const plan = await planLocalSubAppInstall({ packageRoot: fixture.packageRoot });

  await assert.rejects(
    requestLocalSubAppInstall(
      { packageRoot: fixture.packageRoot, confirmationToken: plan.confirmationToken },
      {
        handoffRoot,
        openTaku: async url => {
          const handoffId = new URL(url).searchParams.get('handoff');
          const resultPath = path.join(handoffRoot, `${handoffId}.result.json`);
          await fs.writeFile(
            resultPath,
            `${JSON.stringify({
              schemaVersion: 'taku.subapp-install-result.v1',
              handoffId,
              ok: true,
              status: 'installed_and_opened',
              applicationId: 'spoofed-app',
            })}\n`,
            { mode: 0o644 },
          );
          await fs.chmod(resultPath, 0o644);
          return true;
        },
        waitTimeoutMs: 2_000,
        pollIntervalMs: 10,
      },
    ),
    error => error?.code === 'subapp_local_install_result_invalid',
  );
});

test('rejects an invalid explicit packaged Taku app without leaving a handoff', async t => {
  if (process.platform !== 'darwin') return;
  const fixture = await packageFixture(t);
  const handoffRoot = path.join(fixture.root, 'handoffs');
  const invalidApp = path.join(fixture.root, 'Not-Taku.app');
  await fs.mkdir(invalidApp);
  const plan = await planLocalSubAppInstall({ packageRoot: fixture.packageRoot });

  await assert.rejects(
    requestLocalSubAppInstall(
      { packageRoot: fixture.packageRoot, confirmationToken: plan.confirmationToken },
      { handoffRoot, takuAppPath: invalidApp, waitForResult: false },
    ),
    error => error?.code === 'taku_desktop_path_invalid',
  );
  assert.equal((await fs.readdir(handoffRoot)).length, 0);
});

async function packageFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'taku-local-install-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, 'calculator-release');
  await fs.mkdir(packageRoot);
  const source = buildPublisherPackageArtifact([
    { path: 'package.json', data: Buffer.from('{}\n') },
    { path: 'taku.manifest.json', data: Buffer.from('{}\n') },
  ]);
  const build = buildPublisherPackageArtifact([
    { path: '.next-preview/BUILD_ID', data: Buffer.from('build\n') },
    { path: '.next-preview/prerender-manifest.json', data: Buffer.from('{}\n') },
    { path: '.next-preview/routes-manifest.json', data: Buffer.from('{}\n') },
    { path: '.next-preview/build-manifest.json', data: Buffer.from('{}\n') },
    { path: '.next-preview/required-server-files.json', data: Buffer.from('{}\n') },
  ]);
  await fs.writeFile(path.join(packageRoot, 'source.zip'), source.bytes, { mode: 0o600 });
  await fs.writeFile(path.join(packageRoot, 'build.zip'), build.bytes, { mode: 0o600 });
  await fs.writeFile(
    path.join(packageRoot, 'package-manifest.json'),
    `${JSON.stringify({
      schemaVersion: 'taku.publisher.subapp-package.v1',
      candidateDigest: `sha256:${'c'.repeat(64)}`,
      runtimeManifest: {
        name: 'Calculator',
        description: 'A local calculator.',
        version: '1.0.0',
        actions: [],
      },
      serviceAuthorizations: [],
      source: {
        fileName: 'source.zip',
        sha256: source.sha256,
        size: source.size,
        fileCount: source.fileCount,
      },
      build: {
        fileName: 'build.zip',
        sha256: build.sha256,
        size: build.size,
        fileCount: build.fileCount,
        outputDirectory: '.next-preview',
        trustedTreeDigest: `sha256:${'b'.repeat(64)}`,
      },
      installContract: {
        buildRequired: true,
        buildOutputDir: '.next-preview',
        startScriptPreview: 'start:preview',
        startScriptEdit: 'start:edit',
      },
      uploadStarted: false,
      publishStarted: false,
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { root, packageRoot };
}
