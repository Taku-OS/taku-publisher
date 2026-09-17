#!/usr/bin/env node

import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RECORD = '.taku-publisher-install.json';
const REQUIRED = ['SKILL.md', 'package.json', 'publisher-version.json',
  'host-adapter.json', 'scripts/taku-publisher.mjs', 'creator/scripts/cursor-sqlite.mjs',
  'node_modules/@taku/publisher-runtime/dist/cli.js'];
const HOSTS = {
  cursor: {
    schemaVersion: 'taku.cursor.install.v1',
    indexFile: 'integrity.json',
    payloadDirectory: 'payload',
    homeDirectory: '.cursor',
    restartLabel: 'Cursor Agent chat',
  },
  'agent-skills': {
    schemaVersion: 'taku.agent-skills.install.v1',
    indexFile: 'integrity-agent-skills.json',
    payloadDirectory: 'payload-agent-skills',
    homeDirectory: '.agents',
    restartLabel: 'compatible Agent Skills host session',
  },
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function hostDefinition(value) {
  const host = String(value || '').trim().toLowerCase();
  if (!Object.hasOwn(HOSTS, host)) throw new Error('Specify --host cursor or --host agent-skills.');
  const definition = HOSTS[host];
  return { host, ...definition };
}

function safePath(value) {
  if (typeof value !== 'string' || value.length > 1024 || !value
      || /[\\:\x00-\x1f]/.test(value) || value.startsWith('/')
      || value.split('/').some((part) => !part || part === '.' || part === '..'
        || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('Unsafe package path.');
  }
  return value;
}

export async function inventory(root, prefix = '', budget = { files: 0, bytes: 0 }) {
  const result = [];
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Expected a real directory.');
  for (const entry of (await fs.readdir(root)).sort()) {
    const relative = prefix ? `${prefix}/${entry}` : entry;
    safePath(relative);
    const target = path.join(root, entry);
    const info = await fs.lstat(target);
    if (info.isSymbolicLink()) throw new Error('Symlinks are not supported.');
    if (info.isDirectory()) result.push(...await inventory(target, relative, budget));
    else if (info.isFile()) {
      budget.files += 1;
      budget.bytes += info.size;
      if (budget.files > 8001 || budget.bytes > 132 * 1024 * 1024 || info.size > 32 * 1024 * 1024) {
        throw new Error('Oversized package tree.');
      }
      result.push({ path: relative, size: info.size,
        sha256: hash(await fs.readFile(target)), mode: info.mode & 0o777 });
    }
    else throw new Error('Special files are not supported.');
  }
  return result;
}

async function readJson(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('Unsafe or oversized metadata.');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function exists(target) {
  try { await fs.lstat(target); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function directory(parent, name) {
  const target = path.join(parent, name);
  try { await fs.mkdir(target); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe installation directory: ${target}`);
  return target;
}

function validateIndex(index, expectedHost) {
  const definition = hostDefinition(expectedHost || index.host);
  if (index.schemaVersion !== definition.schemaVersion || index.host !== definition.host
      || index.name !== 'taku-publisher' || !/^\d+\.\d+\.\d+$/.test(index.version)
      || !Array.isArray(index.files) || !index.files.length || index.files.length > 8000) {
    throw new Error('Invalid installer metadata.');
  }
  const seen = new Set();
  let total = 0;
  for (const file of index.files) {
    safePath(file.path);
    if (file.path === RECORD || seen.has(file.path.toLowerCase())
        || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 32 * 1024 * 1024
        || !/^[a-f0-9]{64}$/.test(file.sha256) || ![0o644, 0o755].includes(file.mode)) {
      throw new Error('Invalid file integrity metadata.');
    }
    seen.add(file.path.toLowerCase());
    total += file.size;
  }
  if (total > 128 * 1024 * 1024 || REQUIRED.some((file) => !seen.has(file.toLowerCase()))) {
    throw new Error('Incomplete or oversized installer payload.');
  }
}

export function payloadPath(relative) {
  // Flatten transport names so npm cannot omit node_modules or dotfiles.
  // Logical install paths remain separately validated in integrity.json.
  return `${hash(Buffer.from(relative, 'utf8'))}.data`;
}

async function assertFiles(root, index, transported = false, installed = false) {
  const actual = await inventory(root);
  const expected = new Map(index.files.map((file) => [transported ? payloadPath(file.path) : file.path, file]));
  const files = installed ? actual.filter((file) => file.path !== RECORD) : actual;
  if (files.length !== expected.size) throw new Error('Unexpected or missing files; refusing to overwrite.');
  for (const file of files) {
    const wanted = expected.get(file.path);
    if (!wanted || file.size !== wanted.size || file.sha256 !== wanted.sha256) {
      throw new Error('Files changed or package checksum mismatch; refusing to overwrite.');
    }
  }
}

export async function installSkill(options = {}) {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or later is required.');
  const definition = hostDefinition(options.host);
  const bundle = await fs.realpath(options.bundle || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  const index = await readJson(path.join(bundle, definition.indexFile));
  validateIndex(index, definition.host);
  const payload = path.join(bundle, definition.payloadDirectory);
  await assertFiles(payload, index, true);
  const version = await readJson(path.join(payload, payloadPath('publisher-version.json')));
  const adapter = await readJson(path.join(payload, payloadPath('host-adapter.json')));
  if (version.version !== index.version || version.channel !== 'standard' || adapter.host !== definition.host) {
    throw new Error('Release version or host mismatch.');
  }
  const scope = options.scope || 'user';
  if (!['user', 'project'].includes(scope) || (scope === 'project' && !options.project)) {
    throw new Error('Project scope requires --project <existing-directory>.');
  }
  const base = await fs.realpath(scope === 'project' ? options.project : options.homeDir || os.homedir());
  const hostHome = await directory(base, definition.homeDirectory);
  const skills = await directory(hostHome, 'skills');
  const target = path.join(skills, 'taku-publisher');
  const lock = path.join(hostHome, '.taku-publisher-install.lock');
  const handle = await fs.open(lock, 'wx', 0o600).catch((error) => {
    if (error.code === 'EEXIST') throw new Error('Another installer holds the lock.');
    throw error;
  });
  let staging;
  let backup;
  try {
    if (await exists(target)) {
      const stat = await fs.lstat(target);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe existing Skill directory.');
      const record = path.join(target, RECORD);
      if (!(await exists(record))) {
        if (!options.backupExisting) throw new Error('Existing unmanaged Skill; choose a new project or explicitly use --backup-existing.');
        await inventory(target);
      } else {
        const previous = await readJson(record);
        validateIndex(previous, definition.host);
        await assertFiles(target, previous, false, true);
        if (previous.version === index.version && JSON.stringify(previous.files) === JSON.stringify(index.files)) {
          return { ok: true, status: 'already_installed', version: index.version, target };
        }
        if (!options.update) throw new Error('Existing managed install; use --update to preserve a backup and replace it.');
      }
    }
    staging = await fs.mkdtemp(path.join(hostHome, '.publisher-install-'));
    for (const file of index.files) {
      const output = path.join(staging, file.path);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.copyFile(path.join(payload, payloadPath(file.path)), output);
      await fs.chmod(output, file.mode);
    }
    await assertFiles(staging, index);
    await fs.writeFile(path.join(staging, RECORD), `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
    if (await exists(target)) {
      const backups = await directory(hostHome, 'publisher-backups');
      const backupRoot = await fs.mkdtemp(path.join(backups, 'taku-publisher-'));
      backup = path.join(backupRoot, 'skill');
      await fs.rename(target, backup);
    }
    try { await fs.rename(staging, target); staging = undefined; }
    catch (error) { if (backup) await fs.rename(backup, target); throw error; }
    return { ok: true, status: backup ? 'updated' : 'installed', version: index.version,
      host: definition.host, target, ...(backup ? { backup } : {}),
      next: `Start a new ${definition.restartLabel} and invoke Taku Publisher.` };
  } finally {
    if (staging) await fs.rm(staging, { recursive: true, force: true });
    await handle.close();
    await fs.unlink(lock);
  }
}

export function installCursor(options = {}) {
  return installSkill({ ...options, host: 'cursor' });
}

export function installAgentSkills(options = {}) {
  return installSkill({ ...options, host: 'agent-skills' });
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    console.log('taku-publisher install --host cursor|agent-skills [--scope user|project --project <dir>] [--update] [--backup-existing]\nRequires Node.js >=20; preserves existing files.');
    return;
  }
  if (args.shift() !== 'install') throw new Error('Expected install command.');
  const options = {};
  const keys = { '--bundle': 'bundle', '--home-dir': 'homeDir', '--scope': 'scope', '--project': 'project', '--host': 'host' };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--update') { options.update = true; continue; }
    if (flag === '--backup-existing') { options.backupExisting = true; continue; }
    if (!keys[flag] || !args.length || args[0].startsWith('--')) throw new Error('Unknown or incomplete installer option.');
    options[keys[flag]] = args.shift();
  }
  console.log(JSON.stringify(await installSkill(options), null, 2));
}

// npm bin symlinks and macOS /var -> /private/var aliases must still run main.
if (process.argv[1] && await fs.realpath(process.argv[1]).catch(() => '')
    === await fs.realpath(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
}
