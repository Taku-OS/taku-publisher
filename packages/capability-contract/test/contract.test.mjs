import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CAPABILITY_CONTRACT_VERSION,
  CAPABILITY_PACKAGE_SCHEMA_VERSION,
  CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
  LEGACY_AI_SETUP_SCHEMA_VERSION,
  assertCapabilityPackageManifest,
  assertCapabilitySnapshot,
  canonicalCapabilityJson,
  createCapabilityPackageManifest,
  createCapabilitySnapshot,
  hashCanonicalCapability,
  readCapabilitySnapshot,
  stableCapabilityId,
} from '../dist/index.js';

const fixture = JSON.parse(
  await readFile(
    new URL('../fixtures/canonical-v1.json', import.meta.url),
    'utf8',
  ),
);

test('normalizes all supported capability kinds into one private snapshot', () => {
  const snapshot = createCapabilitySnapshot(fixture.snapshotInput);

  assert.equal(CAPABILITY_CONTRACT_VERSION, '0.2.0');
  assert.equal(snapshot.schemaVersion, CAPABILITY_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(snapshot.summary.totalCount, 4);
  assert.equal(snapshot.items.length, 4);
  assert.equal(
    snapshot.items.find((item) => item.id === 'mcp-context7').policy.publish
      .eligibility,
    'blocked',
  );
  assert.equal(
    snapshot.items.find((item) => item.id === 'rule-agents').policy.publish
      .reason,
    'rule-publishing-disabled',
  );
  assert.equal(
    snapshot.items.find((item) => item.id === 'mcp-context7').locator.value,
    '/tmp/taku-fixture/.cursor/mcp.json',
  );
  assert.equal(assertCapabilitySnapshot(snapshot), snapshot);
});

test('builds stable IDs from kind, canonical host, and private locator', () => {
  const first = stableCapabilityId({
    kind: 'skill',
    source: 'codex-config',
    locator: '/tmp/TAKU-FIXTURE/.codex/skills/review/',
  });
  const second = stableCapabilityId({
    kind: 'skills',
    source: 'codex',
    locator: '\\tmp\\TAKU-FIXTURE\\.codex\\skills\\review',
  });

  assert.equal(first, second);
  assert.match(first, /^cap_[a-f0-9]{32}$/);
});

test('projects workflow to action only for publish packages', () => {
  const published = createCapabilityPackageManifest(fixture.packageInput);
  const imported = createCapabilityPackageManifest({
    ...fixture.packageInput,
    channel: 'import',
  });

  assert.equal(published.schemaVersion, CAPABILITY_PACKAGE_SCHEMA_VERSION);
  assert.equal(published.capability.sourceKind, 'workflow');
  assert.equal(published.capability.kind, 'action');
  assert.equal(imported.capability.kind, 'workflow');
  assert.equal(assertCapabilityPackageManifest(published), published);
});

test('blocks Rule and MCP publishing', () => {
  const common = {
    channel: 'publish',
    contentHash: 'a'.repeat(64),
  };

  assert.throws(
    () =>
      createCapabilityPackageManifest({
        ...common,
        capability: { id: 'mcp-1', kind: 'mcp', name: 'context7' },
      }),
    /not publishable/,
  );
  assert.throws(
    () =>
      createCapabilityPackageManifest({
        ...common,
        capability: { id: 'rule-1', kind: 'rule', name: 'AGENTS.md' },
      }),
    /not publishable/,
  );
});

test('requires plugin permission review to cover every permission', () => {
  const input = {
    channel: 'publish',
    contentHash: 'a'.repeat(64),
    capability: { id: 'plugin-1', kind: 'plugin', name: 'Review plugin' },
    permissions: ['filesystem:read', 'network:taku.ai'],
  };

  assert.throws(
    () => createCapabilityPackageManifest(input),
    /approved permission review/,
  );
  assert.throws(
    () =>
      createCapabilityPackageManifest({
        ...input,
        permissionReview: {
          status: 'approved',
          reviewedPermissions: ['filesystem:read'],
        },
      }),
    /cover every requested permission/,
  );
  assert.doesNotThrow(() =>
    createCapabilityPackageManifest({
      ...input,
      permissionReview: {
        status: 'approved',
        reviewedPermissions: ['network:taku.ai', 'filesystem:read'],
        reviewer: 'security-review',
      },
    }),
  );
});

test('rejects private fields and secret-like values from public manifests', () => {
  const manifest = createCapabilityPackageManifest(fixture.packageInput);

  assert.throws(
    () =>
      assertCapabilityPackageManifest({
        ...manifest,
        undocumented: true,
      }),
    /unknown field "undocumented"/,
  );
  assert.throws(
    () =>
      assertCapabilityPackageManifest({
        ...manifest,
        locator: {
          type: 'local-path',
          value: '/tmp/taku-fixture/.codex/skills/review',
        },
      }),
    /forbidden field locator/,
  );
  assert.throws(
    () =>
      assertCapabilityPackageManifest({
        ...manifest,
        capability: {
          ...manifest.capability,
          description: [
            'Read file:',
            '',
            '',
            'Users',
            'example',
            'private',
            'prompt.md',
          ].join('/'),
        },
      }),
    /private content/,
  );
  assert.throws(
    () =>
      assertCapabilityPackageManifest({
        ...manifest,
        token: 'not-allowed-even-when-placeholder',
      }),
    /forbidden field token/,
  );
});

test('reads legacy taku.ai-setup.v1 without generating it', () => {
  const upgraded = readCapabilitySnapshot({
    schemaVersion: LEGACY_AI_SETUP_SCHEMA_VERSION,
    generatedAt: '2026-07-24T00:00:00.000Z',
    items: [
      {
        id: 'legacy-skill',
        type: 'skill',
        source: 'codex',
        name: 'Legacy skill',
      },
    ],
  });

  assert.equal(upgraded.schemaVersion, CAPABILITY_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(upgraded.contractVersion, CAPABILITY_CONTRACT_VERSION);
  assert.equal(upgraded.items[0].id, 'legacy-skill');
});

test('produces canonical JSON and fixture hashes across consumers', () => {
  const snapshot = createCapabilitySnapshot(fixture.snapshotInput);
  const manifest = createCapabilityPackageManifest(fixture.packageInput);

  assert.equal(
    canonicalCapabilityJson({ b: 2, a: { d: 4, c: 3 } }),
    '{"a":{"c":3,"d":4},"b":2}',
  );
  assert.equal(
    hashCanonicalCapability(snapshot),
    fixture.expected.snapshotHash,
  );
  assert.equal(
    hashCanonicalCapability(manifest),
    fixture.expected.packageHash,
  );
});

test('ships parseable JSON Schemas with the package', async () => {
  for (const [relativePath, schemaVersion] of [
    [
      '../schemas/capability-snapshot.v1.schema.json',
      CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    ],
    [
      '../schemas/capability-package.v1.schema.json',
      CAPABILITY_PACKAGE_SCHEMA_VERSION,
    ],
  ]) {
    const schema = JSON.parse(
      await readFile(new URL(relativePath, import.meta.url), 'utf8'),
    );
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.type, 'object');
    assert.equal(schema.properties.schemaVersion.const, schemaVersion);
    assert.equal(
      schema.properties.contractVersion.const,
      CAPABILITY_CONTRACT_VERSION,
    );
  }
});

test('keeps package metadata and runtime contract version aligned', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(packageJson.version, CAPABILITY_CONTRACT_VERSION);
});
