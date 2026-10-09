#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inventory } from './cursor-installer.mjs';
import { readZip } from '../packages/publisher-runtime/dist/zip.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const buildRoot = path.join(root, 'dist/native-publisher');
const output = path.join(buildRoot, 'marketplace-release');
const allowDirty = process.argv.includes('--allow-dirty');
if (process.argv.slice(2).some(arg => arg !== '--allow-dirty')) throw new Error('Unknown native verification option.');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const release = await readJson(path.join(output, 'release.json'));
assert.match(release.version, /^\d+\.\d+\.\d+$/);
assert.equal(release.profile, 'publisher-only');
assert.equal(release.channel, 'standard');
assert.deepEqual(release.skills, ['taku-publisher']);
assert.match(release.sourceCommit, /^[a-f0-9]{40}$/);
assert.equal(typeof release.sourceDirty, 'boolean');
if (release.sourceDirty && !allowDirty) throw new Error('Dirty source: commit and rebuild before promotion.');
const currentSource = JSON.parse(execFileSync(process.execPath, ['scripts/source-checksum.mjs'], { cwd: root, encoding: 'utf8' }));
assert.equal(release.sourceTreeChecksum, currentSource.sourceTreeChecksum, 'Source checksum mismatch');
const expectedCommit = process.env.TAKU_CONTRACT_SOURCE_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(release.sourceCommit, expectedCommit, 'Source commit mismatch');
assert.equal(release.plugins.length, 3);
let common;
for (const [index, host, marker, manifestDir, marketplaceDir] of [
  [0, 'codex', 'codex', '.codex-plugin', '.agents/plugins'],
  [1, 'claude', 'claude-code', '.claude-plugin', '.claude-plugin'],
  [2, 'cursor', 'cursor', '.cursor-plugin', '.cursor-plugin'],
]) {
  const item = release.plugins[index];
  const sourceManifest = await readJson(path.join(root, 'adapters', host, 'taku-publisher', manifestDir, 'plugin.json'));
  assert.equal(sourceManifest.version, release.version, 'Source version mismatch');
  assert.equal(item.host, marker);
  assert.equal(item.path, `plugins/taku-publisher-${host}`);
  assert.equal(item.version, release.version, 'Plugin version mismatch');
  const plugin = path.join(output, item.path);
  const actual = await inventory(plugin);
  assert.deepEqual(actual, item.files, 'Plugin integrity mismatch');
  assert.equal(item.fileCount, actual.length);
  assert.deepEqual(await fs.readdir(path.join(plugin, 'skills')), ['taku-publisher']);
  const manifest = await readJson(path.join(plugin, manifestDir, 'plugin.json'));
  const skill = path.join(plugin, 'skills/taku-publisher');
  assert.equal(manifest.name, 'taku-publisher');
  assert.equal(manifest.version, release.version, 'Manifest version mismatch');
  assert.deepEqual(manifest.skills, host === 'claude' ? ['./skills/taku-publisher'] : './skills/', 'Registered Skill mismatch');
  for (const declared of [manifest.skills].flat()) await fs.access(path.join(plugin, declared));
  assert.deepEqual(await readJson(path.join(skill, 'publisher-version.json')),
    { name: 'taku-publisher', version: release.version, channel: 'standard' });
  assert.equal((await readJson(path.join(skill, 'host-adapter.json'))).host, marker);
  const runtime = (await inventory(skill)).filter(({ path: file }) => file !== 'host-adapter.json');
  if (common) assert.deepEqual(runtime, common, 'Host runtimes differ');
  common = runtime;
  const marketplaceFile = `${marketplaceDir}/marketplace.json`;
  const marketplace = await readJson(path.join(output, marketplaceFile));
  assert.equal(marketplace.name, 'taku');
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, 'taku-publisher');
  assert.deepEqual(marketplace.plugins[0].source, host === 'codex'
    ? { source: 'local', path: `./${item.path}` } : `./${item.path}`);
  assert.equal(item.archive.name, `taku-publisher-${host}-${release.version}-native.zip`);
  const bytes = await fs.readFile(path.join(buildRoot, 'releases', item.archive.name));
  assert.equal(bytes.length, item.archive.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), item.archive.sha256, 'Archive checksum mismatch');
  const entries = readZip(bytes);
  const files = new Map(entries.map(entry => [entry.name, Buffer.from(entry.data)]));
  assert.equal(files.size, actual.length + 2, 'Archive inventory mismatch');
  assert.equal(entries.length, files.size, 'Duplicate archive entries');
  for (const file of actual) {
    assert.ok(files.get(`${item.path}/${file.path}`)?.equals(await fs.readFile(path.join(plugin, file.path))), 'Archive content mismatch');
  }
  assert.ok(files.get(marketplaceFile)?.equals(await fs.readFile(path.join(output, marketplaceFile))));
  assert.deepEqual(JSON.parse(files.get('provenance.json')), {
    version: release.version, profile: 'publisher-only', skills: ['taku-publisher'],
    sourceCommit: release.sourceCommit, sourceDirty: release.sourceDirty,
    sourceTreeChecksum: release.sourceTreeChecksum, host: marker,
  });
}
console.log(JSON.stringify({ ok: true, version: release.version, profile: release.profile,
  sourceCommit: release.sourceCommit, sourceDirty: release.sourceDirty, hosts: release.plugins.map(item => item.host),
  skills: release.skills, verified: ['inventories', 'runtime-parity', 'versions', 'marketplace-paths', 'archives', 'provenance'],
  productionLoginVerified: false, publicPublishVerified: false }));
