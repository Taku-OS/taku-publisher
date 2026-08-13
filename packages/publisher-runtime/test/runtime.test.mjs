import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  applyDeepScanDispositions,
  buildPublisherPackageArtifact,
  buildBundle,
  createStoredZip,
  discoverUnits,
  initializeDraft,
  installCodexSkill,
  installPreflight,
  marketplaceItems,
  preserveRemoteListing,
  readZip,
  scanStaging,
  setTreeWritable,
  stageSelected,
} from '../dist/index.js';

test('preserves Taku Web listing edits on the same remote draft before upload', async (t) => {
  const directory = await temporaryDirectory(t);
  const state = {
    draft_id: 'local-listing-sync',
    status: 'packaged',
    mode: 'create',
    source_path: directory,
    unit: { type: 'skill' },
  };
  const listing = {
    title: 'Web title',
    description: 'Description edited on Taku Web.',
    iconUrl: 'https://cdn.example.test/web-icon.png',
  };
  const calls = [];
  const client = {
    async getDraft(draftId) {
      calls.push(['get', draftId]);
      return { data: { draft: { id: draftId, listing } } };
    },
    async updateDraft(draftId, payload) {
      calls.push(['patch', draftId, payload]);
      return { draft: { id: draftId, listing: payload.listing } };
    },
  };

  const preserved = await preserveRemoteListing(client, directory, state, 'remote-draft-1');

  assert.deepEqual(preserved, listing);
  assert.deepEqual(calls, [
    ['get', 'remote-draft-1'],
    ['patch', 'remote-draft-1', { listing }],
  ]);
  assert.deepEqual(state.listing, listing);
  const savedState = JSON.parse(await fs.readFile(path.join(directory, 'state.json'), 'utf8'));
  assert.deepEqual(savedState.listing, listing);
});

test('stops upload when the Web listing icon has not been saved', async (t) => {
  const directory = await temporaryDirectory(t);
  const state = {
    draft_id: 'local-listing-incomplete',
    status: 'packaged',
    mode: 'create',
    source_path: directory,
    unit: { type: 'skill' },
  };
  const client = {
    async getDraft() {
      return {
        draft: {
          listing: { title: 'Web title', description: 'Saved description' },
          reviewUrl: 'https://taku.example.test/publish/remote-draft-1',
        },
      };
    },
    async updateDraft() {
      throw new Error('incomplete listings must not be patched');
    },
  };

  await assert.rejects(
    preserveRemoteListing(client, directory, state, 'remote-draft-1'),
    (error) => error?.code === 'remote_listing_incomplete'
      && error?.details?.missing_fields?.includes('iconUrl'),
  );
});

test('Marketplace search normalizes full community catalog items without leaking metadata', () => {
  const items = marketplaceItems({
    items: [{
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Community App',
      slug: 'community-app',
      type: 'app',
      status: 'published',
      displayKind: 'app',
      currentVersion: 3,
      installCount: 12,
      externalUrl: 'https://taku.ai/apps/community-app',
      installOffer: {
        displayKind: 'app',
        installability: 'installable',
        cta: 'open-in-taku',
        deepLink: 'taku://apps/community-app',
      },
      metadata: { private: 'must-not-leak' },
    }],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].display_kind, 'app');
  assert.equal(items[0].version, 3);
  assert.equal(items[0].install_count, 12);
  assert.equal(items[0].cta, 'open-in-taku');
  assert.equal(items[0].deep_link, 'taku://apps/community-app');
  assert.equal(items[0].codex_install_supported, false);
  assert.equal('metadata' in items[0], false);
});

test('shared Publisher Core builds deterministic host artifacts', () => {
  const first = buildPublisherPackageArtifact([
    { path: 'b.txt', data: Buffer.from('second') },
    { path: 'bin/run.sh', data: Buffer.from('#!/bin/sh\n') },
    { path: 'a.txt', data: Buffer.from('first') },
  ]);
  const second = buildPublisherPackageArtifact([
    { path: 'a.txt', data: Buffer.from('first') },
    { path: 'b.txt', data: Buffer.from('second') },
    { path: 'bin/run.sh', data: Buffer.from('#!/bin/sh\n') },
  ]);

  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(first.files.map((file) => file.path), [
    'a.txt',
    'b.txt',
    'bin/run.sh',
  ]);
  assert.equal(first.files[2].mode, 0o755);
  assert.throws(
    () => buildPublisherPackageArtifact([
      { path: '../private.txt', data: Buffer.from('blocked') },
    ]),
    /unsafe/i,
  );
});

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-publisher-node-'));
  t.after(async () => {
    await setTreeWritable(directory).catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('discovers only Skills and rejects unopened publish types', async (t) => {
  const root = await temporaryDirectory(t);
  const skill = path.join(root, 'sample-skill');
  await fs.mkdir(skill, { recursive: true });
  await fs.writeFile(path.join(skill, 'SKILL.md'), '# Sample Skill\n');
  const plugin = path.join(root, 'sample-plugin');
  await fs.mkdir(path.join(plugin, '.codex-plugin'), { recursive: true });
  await fs.writeFile(
    path.join(plugin, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name: 'sample-plugin', description: 'Sample plugin' }),
  );
  const action = path.join(root, 'actions', 'deploy.md');
  await fs.mkdir(path.dirname(action), { recursive: true });
  await fs.writeFile(action, '# Deploy\n');
  const agent = path.join(root, 'agents', 'reviewer.md');
  await fs.mkdir(path.dirname(agent), { recursive: true });
  await fs.writeFile(agent, '# Reviewer\n');

  const result = await discoverUnits(root);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'skill');
  assert.equal(result[0].name, 'Sample Skill');

  for (const [unitType, source] of [['action', action], ['agent', agent], ['plugin', plugin]]) {
    await assert.rejects(
      initializeDraft({ workspace: root, source, unitType, mode: 'create' }),
      (error) => error?.code === 'publish_type_not_available',
    );
  }
});

test('cannot package a legacy draft with an unopened publish type', async (t) => {
  const root = await temporaryDirectory(t);
  await assert.rejects(
    buildBundle(root, { unit: { type: 'agent' } }, path.join(root, 'blocked.zip')),
    (error) => error?.code === 'publish_type_not_available',
  );
});

test('stages, scans, reviews, and packages deterministically in Node', async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'sample-skill');
  const publisherHome = path.join(root, 'publisher-home');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'SKILL.md'), '---\nname: sample-skill\ndescription: Safe sample\n---\n# Sample\n');
  await fs.writeFile(path.join(source, '.env'), ['REAL_SECRET=', 'do-not-package', '\n'].join(''));
  await fs.writeFile(path.join(source, '.env.example'), 'SAMPLE_API_KEY=<your-api-key>\n');

  const selected = await initializeDraft({
    workspace: root,
    source,
    unitType: 'skill',
    mode: 'create',
    draftId: 'local_node_runtime_test',
    env: { ...process.env, TAKU_PUBLISHER_HOME: publisherHome },
  });
  const staged = await stageSelected(selected.directory, selected.state);
  assert.ok(staged.excluded.some((entry) => entry.path === '.env'));
  const scanned = await scanStaging(selected.directory, selected.state);
  assert.equal(scanned.report.summary.blocking, 0);
  assert.ok(scanned.requirements.secrets.some((entry) => entry.name === 'SAMPLE_API_KEY'));

  const templatePath = path.join(selected.directory, 'deep-scan-dispositions.template.json');
  const dispositions = JSON.parse(await fs.readFile(templatePath, 'utf8'));
  dispositions.full_review_completed = true;
  for (const row of dispositions.dispositions) {
    row.decision = 'allow';
    row.rationale = 'Reviewed as bounded documentation-only behavior.';
  }
  const reviewedPath = path.join(root, 'reviewed.json');
  await fs.writeFile(reviewedPath, JSON.stringify(dispositions));
  await applyDeepScanDispositions(selected.directory, selected.state, reviewedPath);
  const first = await buildBundle(selected.directory, selected.state, path.join(root, 'first.zip'));
  const second = await buildBundle(selected.directory, selected.state, path.join(root, 'second.zip'));
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(await fs.readFile(first.path), await fs.readFile(second.path));
  assert.ok(first.files.some((file) => file.path === '.taku/package.json'));
  assert.ok(first.files.some((file) => file.path === '.taku/manifest.json'));
  assert.ok(first.files.some((file) => file.path === '.taku/requirements.json'));
  const zipEntries = readZip(await fs.readFile(first.path));
  const packageEntry = zipEntries.find((entry) => entry.name === '.taku/package.json');
  assert.ok(packageEntry);
  const packageManifest = JSON.parse(Buffer.from(packageEntry.data).toString('utf8'));
  assert.equal(packageManifest.schemaVersion, 'taku.package.v1');
  assert.equal(packageManifest.channel, 'publish');
  assert.equal(packageManifest.capability.id, selected.state.unit.id);
  assert.equal(packageManifest.capability.kind, 'skill');
  assert.deepEqual(packageManifest.compatibility.hosts, ['claude-code', 'codex', 'taku']);
  assert.deepEqual(packageManifest.compatibility.platforms, ['claude-code', 'codex', 'taku']);
  assert.deepEqual(packageManifest.requiredSecrets, ['SAMPLE_API_KEY']);
  assert.ok(packageManifest.files.some((file) => file.path === '.taku/manifest.json'));
  assert.ok(packageManifest.files.some((file) => file.path === '.taku/requirements.json'));
  assert.equal(packageManifest.files.some((file) => file.path === '.taku/package.json'), false);
});

test('scanner reviews loopback URLs while retaining private-network blockers', async (t) => {
  const privateUrl = ['http:/', '/192.168.1.24:8080'].join('');
  const scanned = await scanFixture(t, [
    "const local = 'http://127.0.0.1:7819';",
    `const privateUrl = '${privateUrl}';`,
    "const token = 'publisher-timeout-fixture';",
    '',
  ].join('\n'), 'network-url-scan');
  const severities = Object.fromEntries(
    scanned.report.findings.map((item) => [item.category, item.severity]),
  );
  assert.equal(severities.loopback_url, 'review');
  assert.equal(severities.private_network_url, 'block');
  assert.equal('credential_literal' in severities, false);
});

test('scanner finding limit retains deterministic blockers without blocking on review volume', async (t) => {
  const fakeToken = ['sk-', 'proj-', '1234567890abcdefghijklmnop'].join('');
  const scanned = await scanFixture(
    t,
    `${"open('review-me');\n".repeat(510)}const api_key = '${fakeToken}';\n`,
    'bounded-scan',
  );
  assert.equal(scanned.report.findings.length, 500);
  assert.ok(scanned.report.findings.some(
    (item) => item.category === 'known_token' && item.severity === 'block',
  ));
  assert.equal(
    scanned.report.findings.find((item) => item.category === 'finding_limit')?.severity,
    'review',
  );
});

async function scanFixture(t, sourceText, draftId) {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'sample-skill');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'SKILL.md'), '# Scanner fixture\n');
  await fs.writeFile(path.join(source, 'main.mjs'), sourceText);
  const selected = await initializeDraft({
    workspace: root,
    source,
    unitType: 'skill',
    mode: 'create',
    draftId,
    env: { ...process.env, TAKU_PUBLISHER_HOME: path.join(root, 'publisher-home') },
  });
  await stageSelected(selected.directory, selected.state);
  return scanStaging(selected.directory, selected.state);
}

test('Marketplace install requires exact confirmation and extracts atomically', async (t) => {
  const root = await temporaryDirectory(t);
  const itemId = '123e4567-e89b-12d3-a456-426614174000';
  const packageBytes = createStoredZip([
    { name: 'SKILL.md', data: Buffer.from('---\nname: installed-skill\n---\n'), mode: 0o644 },
    { name: 'scripts/run.mjs', data: Buffer.from('export const ok = true;\n'), mode: 0o644 },
  ]);
  const digest = createHash('sha256').update(packageBytes).digest('hex');
  const response = {
    data: {
      item: {
        id: itemId,
        name: 'Installed Skill',
        slug: 'installed-skill',
        type: 'skill',
        status: 'published',
      },
      latestVersion: { versionNumber: 2 },
      access: { allowed: true },
      package: {
        versionNumber: 2,
        contentHash: digest,
        fileSizeBytes: packageBytes.length,
      },
      downloadUrl: 'https://packages.example.test/installed-skill.zip',
    },
  };
  const preflight = installPreflight(response, itemId, root);
  assert.equal(preflight.target_dir, path.join(root, 'installed-skill'));

  const client = {
    async downloadPublicPackage() { return packageBytes; },
    async recordMarketplaceInstall() { return { ok: true }; },
  };
  await assert.rejects(
    installCodexSkill(client, response, { itemId, confirmItemId: 'wrong', installRoot: root }),
    (error) => error.code === 'install_confirmation_mismatch',
  );
  const installed = await installCodexSkill(client, response, { itemId, confirmItemId: itemId, installRoot: root });
  assert.equal(installed.status, 'installed');
  assert.equal(await fs.readFile(path.join(root, 'installed-skill', 'SKILL.md'), 'utf8'), '---\nname: installed-skill\n---\n');
});
