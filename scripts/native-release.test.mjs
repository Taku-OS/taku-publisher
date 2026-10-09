import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inventory } from './cursor-installer.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const native = path.join(root, 'dist/native-publisher');
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const run = (script, ...args) => execFileSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
before(() => run('scripts/build-adapters.mjs'));

// Removing the profile flag or shipping Sites in this channel breaks this test.
test('native Publisher profile is isolated and shares one host runtime', async () => {
  const standard = await inventory(path.join(root, 'dist/plugins'));
  run('scripts/build-adapters.mjs', '--publisher-only');
  let common;
  for (const [host, marker, manifestDir] of [
    ['codex', 'codex', '.codex-plugin'], ['claude', 'claude-code', '.claude-plugin'], ['cursor', 'cursor', '.cursor-plugin'],
  ]) {
    const plugin = path.join(native, 'plugins', host, 'taku-publisher');
    assert.deepEqual(await fs.readdir(path.join(plugin, 'skills')), ['taku-publisher']);
    const manifest = await readJson(path.join(plugin, manifestDir, 'plugin.json'));
    const skill = path.join(plugin, 'skills/taku-publisher');
    assert.equal(manifest.version, '0.3.30');
    assert.doesNotMatch(manifest.description, /Sites/);
    assert.ok(!manifest.keywords.includes('sites'));
    assert.deepEqual(await readJson(path.join(skill, 'publisher-version.json')),
      { name: 'taku-publisher', version: manifest.version, channel: 'standard' });
    assert.equal((await readJson(path.join(skill, 'host-adapter.json'))).host, marker);
    const files = (await inventory(skill)).filter(({ path: file }) => file !== 'host-adapter.json');
    if (common) assert.deepEqual(files, common);
    common = files;
    assert.match(run(path.join(skill, 'scripts/taku-publisher.mjs'), '--version'), /^taku-publisher 0\.3\.30 \(standard\)/);
  }
  assert.deepEqual(await inventory(path.join(root, 'dist/plugins')), standard);
  await assert.rejects(fs.stat(path.join(native, 'skills/taku-sites')), { code: 'ENOENT' });
});

// Old marketplace generation lacks profile isolation and integrity provenance.
test('native marketplace carries complete verifiable host artifacts', async () => {
  run('scripts/build-marketplace-release.mjs', '--publisher-only');
  const releaseRoot = path.join(native, 'marketplace-release');
  const release = await readJson(path.join(releaseRoot, 'release.json'));
  assert.equal(release.version, '0.3.30');
  assert.equal(release.profile, 'publisher-only');
  assert.deepEqual(release.skills, ['taku-publisher']);
  assert.match(release.sourceTreeChecksum, /^[a-f0-9]{64}$/);
  assert.equal(release.plugins.length, 3);
  for (const item of release.plugins) {
    assert.equal(item.files.length, item.fileCount);
    assert.deepEqual(await inventory(path.join(releaseRoot, item.path)), item.files);
    assert.match(item.archive.sha256, /^[a-f0-9]{64}$/);
    await fs.access(path.join(native, 'releases', item.archive.name));
  }
});

test('native verification rejects dirty provenance and modified plugin bytes', async () => {
  run('scripts/native-release-smoke.mjs', '--allow-dirty');
  const releaseFile = path.join(native, 'marketplace-release/release.json');
  const releaseBytes = await fs.readFile(releaseFile);
  try {
    const release = JSON.parse(releaseBytes);
    release.sourceDirty = true;
    await fs.writeFile(releaseFile, JSON.stringify(release));
    assert.throws(() => run('scripts/native-release-smoke.mjs'), /Dirty source/);
  } finally { await fs.writeFile(releaseFile, releaseBytes); }
  const file = path.join(native, 'marketplace-release/plugins/taku-publisher-codex/skills/taku-publisher/SKILL.md');
  const bytes = await fs.readFile(file);
  try {
    await fs.appendFile(file, '\nUnexpected modification\n');
    assert.throws(() => run('scripts/native-release-smoke.mjs', '--allow-dirty'), /integrity mismatch/);
  } finally { await fs.writeFile(file, bytes); }
  try {
    const release = JSON.parse(releaseBytes);
    release.plugins[0].version = '0.0.1';
    await fs.writeFile(releaseFile, JSON.stringify(release));
    assert.throws(() => run('scripts/native-release-smoke.mjs', '--allow-dirty'), /version mismatch/);
  } finally { await fs.writeFile(releaseFile, releaseBytes); }
  const release = JSON.parse(releaseBytes);
  const archiveFile = path.join(native, 'releases', release.plugins[0].archive.name);
  const archiveBytes = await fs.readFile(archiveFile);
  try {
    const corrupt = Buffer.from(archiveBytes); corrupt[100] ^= 1;
    await fs.writeFile(archiveFile, corrupt);
    assert.throws(() => run('scripts/native-release-smoke.mjs', '--allow-dirty'), /Archive checksum mismatch/);
  } finally { await fs.writeFile(archiveFile, archiveBytes); }
});

test('marketplace builder refuses stale adapter source provenance', async () => {
  const file = path.join(native, 'build-provenance.json');
  const bytes = await fs.readFile(file);
  try {
    const provenance = JSON.parse(bytes); provenance.sourceTreeChecksum = '0'.repeat(64);
    await fs.writeFile(file, JSON.stringify(provenance));
    assert.throws(() => run('scripts/build-marketplace-release.mjs', '--publisher-only'), /Adapter source provenance mismatch/);
  } finally { await fs.writeFile(file, bytes); }
});
