import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { buildPublisherPackageArtifact } from '../dist/core.js';
import {
  planSubAppRegistration,
  registerSubAppDraft,
} from '../dist/subapp-registration.js';

test('plans a private SubApp registration without remote operations', async t => {
  const fixture = await registrationFixture(t);
  const plan = await planSubAppRegistration({
    packageRoot: fixture.packageRoot,
    metadata: fixture.metadata,
    mode: 'create',
  });

  assert.match(plan.confirmationToken, /^subapp_register_confirm_[a-f0-9]{64}$/);
  assert.match(plan.packageDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(plan.remoteOperations.length, 5);
  assert.equal(plan.uploadStarted, false);
  assert.equal(plan.registrationStarted, false);
  assert.equal(plan.publishStarted, false);
  assert.equal(plan.metadata.catalog.iconUrl, 'https://cdn.example.test/calculator.png');
});

test('uploads both archives and registers only a private App draft version', async t => {
  const fixture = await registrationFixture(t);
  const plan = await planSubAppRegistration({
    packageRoot: fixture.packageRoot,
    metadata: fixture.metadata,
    mode: 'create',
  });
  const calls = [];
  const client = fakeRegistrationClient(calls);

  const result = await registerSubAppDraft(
    {
      packageRoot: fixture.packageRoot,
      metadata: fixture.metadata,
      mode: 'create',
      confirmationToken: plan.confirmationToken,
    },
    client,
  );

  assert.equal(result.status, 'private_draft_registered');
  assert.equal(result.appId, 'app_test_123');
  assert.equal(result.versionNumber, 4);
  assert.equal(result.publishStarted, false);
  assert.equal(result.reviewPath, '/publish/apps/app_test_123/versions/4');
  assert.equal(
    result.reviewUrl,
    'https://taku.example.test/publish/apps/app_test_123/versions/4',
  );
  assert.deepEqual(calls.map(call => call.kind), [
    'catalog',
    'next-version',
    'presign',
    'upload',
    'presign',
    'upload',
    'version',
  ]);
  assert.equal(calls[0].payload.status, 'draft');
  assert.equal(calls[0].payload.appId, undefined);
  assert.equal(calls[2].payload.path, 'apps/app_test_123/versions/4/source.zip');
  assert.equal(calls[4].payload.path, 'apps/app_test_123/versions/4/build.zip');
  assert.equal(calls[2].payload.sizeBytes, fixture.sourceSize);
  assert.equal(calls[4].payload.sizeBytes, fixture.buildSize);
  assert.equal(calls[3].headers['x-upsert'], 'true');
  assert.equal(calls[6].payload.publishManifest.buildOutputDir, '.next-preview');
  assert.deepEqual(calls[6].payload.publishManifest.serviceAuthorizations, [{
    serviceId: 'weatherapi',
    endpointIds: ['weather_api.current.retrieve.v1.eb62c855'],
  }]);
  assert.equal(calls[6].payload.publishManifest.publishStarted, undefined);
  assert.equal(calls[6].payload.buildRequired, true);

  const [receipt, state] = await Promise.all([
    readJsonFile(path.join(fixture.packageRoot, 'registration-receipt.json')),
    readJsonFile(path.join(fixture.packageRoot, 'registration-state.json')),
  ]);
  assert.equal(receipt.status, 'private_draft_registered');
  assert.equal(receipt.publicDownloadAvailable, false);
  assert.equal(receipt.publishStarted, false);
  assert.equal(receipt.reviewUrl, result.reviewUrl);
  assert.equal(state.status, 'completed');
});

test('rejects stale confirmation before any remote operation', async t => {
  const fixture = await registrationFixture(t);
  const plan = await planSubAppRegistration({
    packageRoot: fixture.packageRoot,
    metadata: fixture.metadata,
    mode: 'create',
  });
  const calls = [];
  const mismatchedConfirmation = `${plan.confirmationToken}-changed`;

  await assert.rejects(
    registerSubAppDraft(
      {
        packageRoot: fixture.packageRoot,
        metadata: fixture.metadata,
        mode: 'create',
        confirmationToken: mismatchedConfirmation,
      },
      fakeRegistrationClient(calls),
    ),
    error => error?.code === 'subapp_registration_confirmation_mismatch',
  );
  assert.deepEqual(calls, []);
  await assert.rejects(
    fs.access(path.join(fixture.packageRoot, 'registration-state.json')),
    error => error?.code === 'ENOENT',
  );
});

test('rejects changed archives and invalid update identity before remote operations', async t => {
  const fixture = await registrationFixture(t);
  await fs.appendFile(path.join(fixture.packageRoot, 'source.zip'), 'changed');
  await assert.rejects(
    planSubAppRegistration({
      packageRoot: fixture.packageRoot,
      metadata: fixture.metadata,
      mode: 'create',
    }),
    error => error?.code === 'subapp_registration_archive_changed',
  );

  const second = await registrationFixture(t);
  await assert.rejects(
    planSubAppRegistration({
      packageRoot: second.packageRoot,
      metadata: second.metadata,
      mode: 'update',
    }),
    error => error?.code === 'subapp_registration_app_id_required',
  );
});

test('rejects incomplete source rights and duplicate registration state', async t => {
  const fixture = await registrationFixture(t);
  const incomplete = structuredClone(fixture.metadata);
  incomplete.sourceRights.license = '';
  await assert.rejects(
    planSubAppRegistration({
      packageRoot: fixture.packageRoot,
      metadata: incomplete,
      mode: 'create',
    }),
    error => error?.code === 'subapp_registration_source_rights_invalid',
  );

  await persistFixtures([[
    path.join(fixture.packageRoot, 'registration-state.json'),
    '{"status":"unknown"}\n',
  ]]);
  await assert.rejects(
    planSubAppRegistration({
      packageRoot: fixture.packageRoot,
      metadata: fixture.metadata,
      mode: 'create',
    }),
    error => error?.code === 'subapp_registration_state_exists',
  );
});

test('resumes an interrupted build upload without re-uploading source or allocating a duplicate version', async t => {
  const fixture = await registrationFixture(t);
  const initialPlan = await planSubAppRegistration({
    packageRoot: fixture.packageRoot,
    metadata: fixture.metadata,
    mode: 'create',
  });
  const firstCalls = [];
  const interruptedClient = fakeRegistrationClient(firstCalls);
  let uploadCount = 0;
  interruptedClient.uploadSigned = async (uploadUrl, file, headers) => {
    firstCalls.push({ kind: 'upload', uploadUrl, file, headers });
    uploadCount += 1;
    if (uploadCount === 2) throw new Error('fixture upload interruption');
  };

  await assert.rejects(
    registerSubAppDraft(
      {
        packageRoot: fixture.packageRoot,
        metadata: fixture.metadata,
        mode: 'create',
        confirmationToken: initialPlan.confirmationToken,
      },
      interruptedClient,
    ),
    /fixture upload interruption/,
  );
  const interruptedState = await readJsonFile(
    path.join(fixture.packageRoot, 'registration-state.json'),
  );
  assert.equal(interruptedState.status, 'source-uploaded');
  assert.equal(interruptedState.appId, 'app_test_123');
  assert.equal(interruptedState.versionNumber, 4);

  const resumePlan = await planSubAppRegistration({
    packageRoot: fixture.packageRoot,
    metadata: fixture.metadata,
    mode: 'create',
  });
  assert.equal(resumePlan.confirmationToken, initialPlan.confirmationToken);
  assert.equal(resumePlan.resumeState.status, 'source-uploaded');
  assert.equal(resumePlan.uploadStarted, true);
  assert.equal(resumePlan.registrationStarted, true);
  assert.deepEqual(resumePlan.remoteOperations, [
    'upload-build-archive',
    'register-private-app-version',
  ]);

  const resumedCalls = [];
  const resumedClient = fakeRegistrationClient(resumedCalls);
  resumedClient.upsertAppCatalog = async () => {
    throw new Error('resume must not create another catalog row');
  };
  resumedClient.getNextAppVersionNumber = async () => {
    throw new Error('resume must not allocate another version number');
  };
  const result = await registerSubAppDraft(
    {
      packageRoot: fixture.packageRoot,
      metadata: fixture.metadata,
      mode: 'create',
      confirmationToken: resumePlan.confirmationToken,
    },
    resumedClient,
  );

  assert.equal(result.appId, 'app_test_123');
  assert.equal(result.versionNumber, 4);
  assert.deepEqual(resumedCalls.map(call => call.kind), [
    'presign',
    'upload',
    'version',
  ]);
});

test('records presign-pending truthfully and resumes without duplicating the catalog draft', async t => {
  const fixture = await registrationFixture(t);
  const initialPlan = await planSubAppRegistration({
    packageRoot: fixture.packageRoot,
    metadata: fixture.metadata,
    mode: 'create',
  });
  const firstCalls = [];
  const interruptedClient = fakeRegistrationClient(firstCalls);
  interruptedClient.createAppSignedUpload = async payload => {
    firstCalls.push({ kind: 'presign', payload });
    throw new Error('fixture presign rejection');
  };

  await assert.rejects(
    registerSubAppDraft(
      {
        packageRoot: fixture.packageRoot,
        metadata: fixture.metadata,
        mode: 'create',
        confirmationToken: initialPlan.confirmationToken,
      },
      interruptedClient,
    ),
    /fixture presign rejection/,
  );
  assert.deepEqual(firstCalls.map(call => call.kind), ['catalog', 'next-version', 'presign']);
  assert.equal(firstCalls[2].payload.sizeBytes, fixture.sourceSize);
  const interruptedState = await readJsonFile(
    path.join(fixture.packageRoot, 'registration-state.json'),
  );
  assert.equal(interruptedState.status, 'presign-pending');

  const resumePlan = await planSubAppRegistration({
    packageRoot: fixture.packageRoot,
    metadata: fixture.metadata,
    mode: 'create',
  });
  assert.equal(resumePlan.resumeState.status, 'presign-pending');
  assert.equal(resumePlan.uploadStarted, false);
  const resumedCalls = [];
  const resumedClient = fakeRegistrationClient(resumedCalls);
  resumedClient.upsertAppCatalog = async () => {
    throw new Error('resume must not create another catalog row');
  };
  resumedClient.getNextAppVersionNumber = async () => {
    throw new Error('resume must not allocate another version number');
  };
  await registerSubAppDraft(
    {
      packageRoot: fixture.packageRoot,
      metadata: fixture.metadata,
      mode: 'create',
      confirmationToken: resumePlan.confirmationToken,
    },
    resumedClient,
  );
  assert.deepEqual(resumedCalls.map(call => call.kind), [
    'presign',
    'upload',
    'presign',
    'upload',
    'version',
  ]);
});

test('rejects an archive above the App Store limit before mutating remote state', async t => {
  const fixture = await registrationFixture(t);
  const manifestPath = path.join(fixture.packageRoot, 'package-manifest.json');
  const manifest = await readJsonFile(manifestPath);
  manifest.source.size = (20 * 1024 * 1024) + 1;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const calls = [];

  await assert.rejects(
    registerSubAppDraft(
      {
        packageRoot: fixture.packageRoot,
        metadata: fixture.metadata,
        mode: 'create',
        confirmationToken: 'test-not-reached',
      },
      fakeRegistrationClient(calls),
    ),
    error => error?.code === 'subapp_registration_package_too_large',
  );
  assert.deepEqual(calls, []);
});

test('rejects resume when package metadata no longer matches the interrupted upload', async t => {
  const fixture = await registrationFixture(t);
  const plan = await planSubAppRegistration({
    packageRoot: fixture.packageRoot,
    metadata: fixture.metadata,
    mode: 'create',
  });
  await persistFixtures([[
    path.join(fixture.packageRoot, 'registration-state.json'),
    `${JSON.stringify({
      schemaVersion: 'taku.publisher.subapp-registration-state.v1',
      status: 'draft-created',
      packageDigest: plan.packageDigest,
      confirmationToken: plan.confirmationToken,
      mode: 'create',
      appId: 'app_test_123',
      publishStarted: false,
    })}\n`,
  ]]);
  const changedMetadata = structuredClone(fixture.metadata);
  changedMetadata.releaseNotes = 'Changed after the remote draft was created.';

  await assert.rejects(
    planSubAppRegistration({
      packageRoot: fixture.packageRoot,
      metadata: changedMetadata,
      mode: 'create',
    }),
    error => error?.code === 'subapp_registration_resume_mismatch',
  );
});

test('fails closed when Taku does not confirm the registered version identity', async t => {
  const fixture = await registrationFixture(t);
  const plan = await planSubAppRegistration({
    packageRoot: fixture.packageRoot,
    metadata: fixture.metadata,
    mode: 'create',
  });
  const client = fakeRegistrationClient([]);
  client.createAppVersion = async () => ({ ok: true });

  await assert.rejects(
    registerSubAppDraft(
      {
        packageRoot: fixture.packageRoot,
        metadata: fixture.metadata,
        mode: 'create',
        confirmationToken: plan.confirmationToken,
      },
      client,
    ),
    error => error?.code === 'subapp_registration_api_response_invalid',
  );
});

function fakeRegistrationClient(calls) {
  return {
    async upsertAppCatalog(payload) {
      calls.push({ kind: 'catalog', payload });
      return { appId: 'app_test_123' };
    },
    async getNextAppVersionNumber(appId) {
      calls.push({ kind: 'next-version', appId });
      return { versionNumber: 4 };
    },
    async createAppSignedUpload(payload) {
      calls.push({ kind: 'presign', payload });
      return {
        signedUrl: `https://uploads.example.test/${path.basename(payload.path)}`,
        path: payload.path,
      };
    },
    async uploadSigned(uploadUrl, file, headers) {
      calls.push({ kind: 'upload', uploadUrl, file, headers });
      await fs.access(file);
    },
    async createAppVersion(payload) {
      calls.push({ kind: 'version', payload });
      return {
        version: {
          app_id: payload.appId,
          version_number: payload.versionNumber,
        },
        reviewPath: `/publish/apps/${payload.appId}/versions/${payload.versionNumber}`,
        reviewUrl: `https://taku.example.test/publish/apps/${payload.appId}/versions/${payload.versionNumber}`,
      };
    },
  };
}

async function registrationFixture(t) {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'taku-subapp-registration-test-')),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, 'calculator-release');
  await fs.mkdir(packageRoot);
  const source = buildPublisherPackageArtifact([
    { path: 'package.json', data: Buffer.from('{"name":"calculator"}\n') },
    { path: 'taku.manifest.json', data: Buffer.from('{"name":"Calculator"}\n') },
  ]);
  const build = buildPublisherPackageArtifact([
    { path: '.next-preview/BUILD_ID', data: Buffer.from('build-id\n') },
  ]);
  await persistFixtures([
    [path.join(packageRoot, 'source.zip'), source.bytes],
    [path.join(packageRoot, 'build.zip'), build.bytes],
    [path.join(packageRoot, 'package-manifest.json'), `${JSON.stringify({
      schemaVersion: 'taku.publisher.subapp-package.v1',
      candidateDigest: `sha256:${'c'.repeat(64)}`,
      runtimeManifest: {
        name: 'Calculator',
        description: 'A four-function calculator.',
        version: '1.0.0',
        actions: [],
      },
      serviceAuthorizations: [{
        serviceId: 'weatherapi',
        endpointIds: ['weather_api.current.retrieve.v1.eb62c855'],
      }],
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
    }, null, 2)}\n`],
  ]);
  return {
    root,
    packageRoot,
    sourceSize: source.size,
    buildSize: build.size,
    metadata: {
      catalog: {
        name: 'Calculator',
        author: 'Example Creator',
        shortDescription: 'A safe calculator.',
        description: 'A converted four-function calculator for Taku.',
        categories: ['productivity'],
        tags: ['calculator'],
        iconUrl: 'https://cdn.example.test/calculator.png',
        repoUrl: 'https://github.com/example/calculator',
      },
      releaseNotes: 'Initial converted release.',
      sourceRights: {
        authorshipKind: 'derived',
        rightsBasis: 'open_source_license',
        sourceUrl: 'https://github.com/example/calculator',
        sourceAuthor: 'Example Maintainer',
        license: 'MIT',
        sourceNotes: 'Converted into the Taku SubApp runtime.',
      },
    },
  };
}

async function readJsonFile(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function persistFixtures(entries) {
  await Promise.all(entries.map(([file, data]) => fs.writeFile(file, data)));
}
