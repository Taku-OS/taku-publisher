import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  installAgentSkills,
  installCursor,
  installSkill,
  inventory,
  payloadPath,
} from './cursor-installer.mjs';

async function fixture(t, version = '0.3.18', host = 'cursor') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-cursor-installer-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundle = path.join(root, 'bundle');
  const homeDir = path.join(root, 'home');
  const payload = path.join(bundle, 'payload');
  await fs.mkdir(payload, { recursive: true });
  await fs.mkdir(homeDir);
  const contents = {
    'SKILL.md': '---\nname: taku-publisher\ndescription: Installer fixture\n---\n',
    'package.json': '{"type":"module"}',
    'publisher-version.json': JSON.stringify({ version, channel: 'standard' }),
    'host-adapter.json': JSON.stringify({ host }),
    'scripts/taku-publisher.mjs': '// fixture\n',
    'creator/scripts/cursor-sqlite.mjs': '// fixture\n',
    'node_modules/@taku/publisher-runtime/dist/cli.js': '// fixture\n',
  };
  for (const [relative, text] of Object.entries(contents)) {
    await fs.mkdir(path.dirname(path.join(payload, relative)), { recursive: true });
    await fs.writeFile(path.join(payload, relative), text);
  }
  const files = [];
  for (const file of await inventory(payload)) {
    files.push({ ...file, mode: 0o644 });
    await fs.rename(path.join(payload, file.path), path.join(bundle, payloadPath(file.path)));
  }
  await fs.rm(payload, { recursive: true });
  await fs.mkdir(payload);
  for (const file of files) await fs.rename(path.join(bundle, payloadPath(file.path)), path.join(payload, payloadPath(file.path)));
  const schemaVersion = host === 'cursor' ? 'taku.cursor.install.v1' : 'taku.agent-skills.install.v1';
  const indexFile = host === 'cursor' ? 'integrity.json' : 'integrity-agent-skills.json';
  const payloadDirectory = host === 'cursor' ? 'payload' : 'payload-agent-skills';
  if (payloadDirectory !== 'payload') await fs.rename(payload, path.join(bundle, payloadDirectory));
  const selectedPayload = path.join(bundle, payloadDirectory);
  const index = { schemaVersion, name: 'taku-publisher', host, version, files };
  const saveIndex = () => fs.writeFile(path.join(bundle, indexFile), JSON.stringify(index));
  await saveIndex();
  const hostHome = host === 'cursor' ? '.cursor' : '.agents';
  const target = path.join(homeDir, hostHome, 'skills/taku-publisher');
  return { root, bundle, homeDir, payload: selectedPayload, target, index, saveIndex };
}

test('installs complete runtime with Cursor marker and is idempotent', async (t) => {
  const f = await fixture(t);
  const result = await installCursor(f);
  assert.equal(result.status, 'installed');
  assert.equal(result.version, '0.3.18');
  assert.equal(await fs.readFile(path.join(f.target, 'node_modules/@taku/publisher-runtime/dist/cli.js'), 'utf8'), '// fixture\n');
  assert.equal((await installCursor(f)).status, 'already_installed');
});

test('project scope stays inside the chosen project', async (t) => {
  const f = await fixture(t);
  const result = await installCursor({ ...f, scope: 'project', project: f.root });
  assert.equal(result.target, path.join(await fs.realpath(f.root), '.cursor/skills/taku-publisher'));
  await assert.rejects(installCursor({ ...f, scope: 'project' }), /requires/);
});

test('installs the portable Skill into the standard Agent Skills directory', async (t) => {
  const f = await fixture(t, '0.3.20', 'agent-skills');
  const result = await installAgentSkills(f);
  assert.equal(result.status, 'installed');
  assert.equal(result.host, 'agent-skills');
  assert.equal(result.target, path.join(await fs.realpath(f.homeDir), '.agents/skills/taku-publisher'));
  assert.equal((await installAgentSkills(f)).status, 'already_installed');
});

test('rejects unsupported public installer hosts', async (t) => {
  const f = await fixture(t);
  await assert.rejects(installSkill({ ...f, host: 'opencode' }), /cursor or --host agent-skills/);
  await assert.rejects(installSkill({ ...f, host: '__proto__' }), /cursor or --host agent-skills/);
});

test('refuses unmanaged existing Skill and preserves its files', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.target, { recursive: true });
  await fs.writeFile(path.join(f.target, 'user.txt'), 'keep me');
  await assert.rejects(installCursor(f), /unmanaged/);
  assert.equal(await fs.readFile(path.join(f.target, 'user.txt'), 'utf8'), 'keep me');
});

test('requires explicit update and retains previous managed install as backup', async (t) => {
  const f = await fixture(t, '0.3.17');
  await installCursor(f);
  const next = await fixture(t);
  await assert.rejects(installCursor({ ...next, homeDir: f.homeDir }), /--update/);
  const result = await installCursor({ ...next, homeDir: f.homeDir, update: true });
  assert.equal(result.status, 'updated');
  assert.equal(JSON.parse(await fs.readFile(path.join(result.backup, 'publisher-version.json'), 'utf8')).version, '0.3.17');
  assert.ok(!result.backup.includes('/skills/'));
});

test('explicit unmanaged migration backs up all old files outside Skill discovery', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.target, { recursive: true });
  await fs.writeFile(path.join(f.target, 'user.txt'), 'keep me');
  const result = await installCursor({ ...f, backupExisting: true });
  assert.equal(result.status, 'updated');
  assert.equal(await fs.readFile(path.join(result.backup, 'user.txt'), 'utf8'), 'keep me');
  assert.ok(!result.backup.includes('/skills/'));
});

test('refuses update of modified installed files', async (t) => {
  const f = await fixture(t);
  await installCursor(f);
  await fs.appendFile(path.join(f.target, 'SKILL.md'), '\nuser edit\n');
  await assert.rejects(installCursor({ ...f, update: true }), /changed/);
  assert.match(await fs.readFile(path.join(f.target, 'SKILL.md'), 'utf8'), /user edit/);
});

test('refuses added installed files rather than losing user data', async (t) => {
  const f = await fixture(t);
  await installCursor(f);
  await fs.writeFile(path.join(f.target, 'notes.txt'), 'keep');
  await assert.rejects(installCursor({ ...f, update: true }), /Unexpected/);
});

test('rejects tampered payload before modifying Cursor settings', async (t) => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.payload, payloadPath('SKILL.md')), 'tampered');
  await assert.rejects(installCursor(f), /checksum mismatch/);
  await assert.rejects(fs.stat(path.join(f.homeDir, '.cursor')), { code: 'ENOENT' });
});

test('rejects unindexed payload file', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.payload, 'extra.txt'), 'extra');
  await assert.rejects(installCursor(f), /Unexpected/);
});

test('rejects traversal, absolute, case-colliding and reserved paths', async (t) => {
  for (const bad of ['../escape', '/escape', 'a\\escape', 'CON.txt', 'trailing.']) {
    const f = await fixture(t);
    f.index.files[0].path = bad;
    await f.saveIndex();
    await assert.rejects(installCursor(f), /Unsafe/);
  }
  const f = await fixture(t);
  f.index.files.push({ ...f.index.files[0], path: f.index.files[0].path.toUpperCase() });
  await f.saveIndex();
  await assert.rejects(installCursor(f), /Invalid file/);
});

test('rejects payload and target directory symlinks', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  await fs.symlink(f.homeDir, path.join(f.payload, 'linked'));
  await assert.rejects(installCursor(f), /Symlinks/);
  const other = await fixture(t);
  await fs.symlink(other.root, path.join(other.homeDir, '.cursor'));
  await assert.rejects(installCursor(other), /Unsafe installation/);
});

test('rejects incomplete or oversized manifests', async (t) => {
  const f = await fixture(t);
  f.index.files.pop();
  await f.saveIndex();
  await assert.rejects(installCursor(f), /Incomplete/);
  const other = await fixture(t);
  other.index.files[0].size = 33 * 1024 * 1024;
  await other.saveIndex();
  await assert.rejects(installCursor(other), /Invalid file/);
});

test('refuses competing installer lock without removing it', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.homeDir, '.cursor'));
  const lock = path.join(f.homeDir, '.cursor/.taku-publisher-install.lock');
  await fs.writeFile(lock, 'other installer');
  await assert.rejects(installCursor(f), /holds the lock/);
  assert.equal(await fs.readFile(lock, 'utf8'), 'other installer');
});

test('rejects release or host metadata mismatch', async (t) => {
  const f = await fixture(t);
  f.index.version = '0.3.19';
  await f.saveIndex();
  await assert.rejects(installCursor(f), /mismatch/);
});

test('npm-style bin symlink invokes the installer CLI', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'taku-publisher');
  await fs.symlink(fileURLToPath(new URL('./cursor-installer.mjs', import.meta.url)), alias);
  assert.match(execFileSync(process.execPath, [alias, '--help'], { encoding: 'utf8' }), /install --host cursor/);
});
