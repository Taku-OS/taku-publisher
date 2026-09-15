#!/usr/bin/env node

import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inventory, payloadPath } from './cursor-installer.mjs';
import { createStoredZip } from '../packages/publisher-runtime/dist/zip.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = path.join(root, 'dist/plugins/cursor/taku-publisher/skills/taku-publisher');
const release = JSON.parse(await fs.readFile(path.join(skill, 'publisher-version.json'), 'utf8'));
const output = path.join(root, 'dist/installers/cursor');
const releases = path.join(root, 'dist/releases');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, 'bin'), { recursive: true });
await fs.mkdir(releases, { recursive: true });
await fs.copyFile(path.join(root, 'scripts/cursor-installer.mjs'), path.join(output, 'bin/taku-publisher.mjs'));
await fs.chmod(path.join(output, 'bin/taku-publisher.mjs'), 0o755);
const files = (await inventory(skill)).map((file) => ({ ...file, mode: file.mode & 0o111 ? 0o755 : 0o644 }));
await fs.mkdir(path.join(output, 'payload'));
for (const file of files) {
  await fs.copyFile(path.join(skill, file.path), path.join(output, 'payload', payloadPath(file.path)));
}
for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'TRADEMARKS.md']) {
  await fs.copyFile(path.join(root, name), path.join(output, name));
}
await fs.copyFile(path.join(root, 'docs/cursor-release.md'), path.join(output, 'README.md'));
await fs.writeFile(path.join(output, 'integrity.json'), `${JSON.stringify({
  schemaVersion: 'taku.cursor.install.v1', name: release.name, host: 'cursor', version: release.version, files,
}, null, 2)}\n`);
await fs.writeFile(path.join(output, 'package.json'), `${JSON.stringify({
  name: '@taku/publisher', version: release.version, type: 'module', license: 'Apache-2.0',
  description: 'Install the bundled Taku Publisher Skill for Cursor.',
  bin: { 'taku-publisher': './bin/taku-publisher.mjs' }, engines: { node: '>=20' },
  files: ['bin', 'payload', 'integrity.json', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'TRADEMARKS.md', 'README.md'],
}, null, 2)}\n`);
const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', releases],
  { cwd: output, encoding: 'utf8' }))[0];
const packedFiles = new Set(packed.files.map((file) => file.path));
for (const file of await inventory(output)) {
  if (!packedFiles.has(file.path)) throw new Error(`npm omitted required payload: ${file.path}`);
}
const marketplace = path.join(root, 'dist/marketplaces/cursor/taku');
const zipName = `taku-publisher-cursor-marketplace-${release.version}.zip`;
const entries = await Promise.all((await inventory(marketplace)).map(async (file) => ({
  name: file.path, mode: file.mode, data: await fs.readFile(path.join(marketplace, file.path)),
})));
await fs.writeFile(path.join(releases, zipName), createStoredZip(entries));
const artifacts = await Promise.all([packed.filename, zipName].map(async (name) => ({
  name, sha256: createHash('sha256').update(await fs.readFile(path.join(releases, name))).digest('hex'),
})));
const commit = process.env.TAKU_CONTRACT_SOURCE_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const sourceDirty = ['true', 'false'].includes(process.env.TAKU_CONTRACT_SOURCE_DIRTY)
  ? process.env.TAKU_CONTRACT_SOURCE_DIRTY === 'true'
  : Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
const source = JSON.parse(execFileSync(process.execPath, ['scripts/source-checksum.mjs'], { cwd: root, encoding: 'utf8' }));
await fs.writeFile(path.join(releases, `cursor-${release.version}-checksums.json`), `${JSON.stringify({
  version: release.version, channel: release.channel, npmPublished: false, sourceCommit: commit, sourceDirty,
  sourceSnapshot: sourceDirty ? 'uncommitted source snapshot' : 'reviewed source commit',
  sourceTreeChecksum: source.sourceTreeChecksum,
  artifacts,
}, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, version: release.version, published: false,
  installer: path.relative(root, output), artifacts }, null, 2));
