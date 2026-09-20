import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inventory } from './cursor-installer.mjs';
import { readZip } from '../packages/publisher-runtime/dist/zip.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await fs.readFile(path.join(root, 'dist/skills/taku-publisher/publisher-version.json'), 'utf8')).version;
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-cursor-package-smoke-'));
try {
  const extracted = path.join(temporary, 'extracted');
  const project = path.join(temporary, 'project');
  await fs.mkdir(extracted);
  await fs.mkdir(project);
  execFileSync('tar', ['-xzf', path.join(root, `dist/releases/taku-publisher-${version}.tgz`), '-C', extracted]);
  const bin = path.join(extracted, 'package/bin/taku-publisher.mjs');
  const args = [bin, 'install', '--host', 'cursor', '--scope', 'project', '--project', project];
  const result = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  if (!result.ok || result.version !== version) throw new Error('Packaged installer failed.');
  const expected = await inventory(path.join(root, 'dist/plugins/cursor/taku-publisher/skills/taku-publisher'));
  const actual = (await inventory(result.target)).filter((file) => file.path !== '.taku-publisher-install.json');
  const normalized = (files) => JSON.stringify(files.map(({ path, size, sha256 }) => ({ path, size, sha256 })));
  if (normalized(actual) !== normalized(expected)) throw new Error('Packaged installation lost runtime files.');
  const cli = path.join(result.target, 'scripts/taku-publisher.mjs');
  const reported = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim();
  if (!reported.includes(version)) throw new Error('Installed version mismatch.');
  const { detectInvokingAiClient } = await import(pathToFileURL(path.join(result.target, 'creator/scripts/host-platform.mjs')).href);
  if (await detectInvokingAiClient({ env: {} }) !== 'cursor') throw new Error('Installed default host is not Cursor.');
  const env = { ...process.env, TAKU_PUBLISHER_HOME: path.join(temporary, 'publisher-home') };
  const doctor = JSON.parse(execFileSync(process.execPath, [cli, 'creator-doctor', '--json'],
    { cwd: result.target, env, encoding: 'utf8' }));
  if (doctor.runtime !== 'node') throw new Error('Installed Node runtime failed.');
  const repeated = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
  if (repeated.status !== 'already_installed') throw new Error('Install is not idempotent.');
  const npmProject = path.join(temporary, 'npm-project');
  await fs.mkdir(npmProject);
  const npmResult = JSON.parse(execFileSync('npm', ['exec', '--yes', '--offline', '--cache', path.join(temporary, 'npm-cache'),
    '--package', path.join(root, `dist/releases/taku-publisher-${version}.tgz`), '--',
    'taku-publisher', 'install', '--host', 'cursor', '--scope', 'project', '--project', npmProject],
  { cwd: temporary, encoding: 'utf8' }));
  if (!npmResult.ok || npmResult.version !== version) throw new Error('npm one-command installation failed.');
  const agentProject = path.join(temporary, 'agent-project');
  await fs.mkdir(agentProject);
  const agentArgs = [bin, 'install', '--host', 'agent-skills', '--scope', 'project', '--project', agentProject];
  const agentResult = JSON.parse(execFileSync('npm', ['exec', '--yes', '--offline',
    '--cache', path.join(temporary, 'agent-npm-cache'),
    '--package', path.join(root, `dist/releases/taku-publisher-${version}.tgz`), '--',
    'taku-publisher', 'install', '--host', 'agent-skills', '--scope', 'project', '--project', agentProject],
  { cwd: temporary, encoding: 'utf8' }));
  if (!agentResult.ok || agentResult.version !== version || agentResult.host !== 'agent-skills') {
    throw new Error('Packaged Agent Skills installer failed.');
  }
  if (agentResult.target !== path.join(await fs.realpath(agentProject), '.agents/skills/taku-publisher')) {
    throw new Error('Agent Skills installer chose the wrong target.');
  }
  const agentAdapter = JSON.parse(await fs.readFile(path.join(agentResult.target, 'host-adapter.json'), 'utf8'));
  if (agentAdapter.host !== 'agent-skills') throw new Error('Agent Skills marker mismatch.');
  const portable = await inventory(path.join(root, 'dist/skills/taku-publisher'));
  const agentActual = (await inventory(agentResult.target)).filter((file) =>
    !['.taku-publisher-install.json', 'host-adapter.json'].includes(file.path));
  if (normalized(agentActual) !== normalized(portable)) {
    throw new Error('Agent Skills installation lost portable runtime files.');
  }
  const repeatedAgent = JSON.parse(execFileSync(process.execPath, agentArgs, { encoding: 'utf8' }));
  if (repeatedAgent.status !== 'already_installed') throw new Error('Agent Skills install is not idempotent.');
  const marketplace = path.join(root, 'dist/marketplaces/cursor/taku');
  const entries = readZip(await fs.readFile(path.join(root, `dist/releases/taku-publisher-cursor-marketplace-${version}.zip`)));
  const marketplaceFiles = await inventory(marketplace);
  if (entries.length !== marketplaceFiles.length) throw new Error('Marketplace archive incomplete.');
  const map = new Map(entries.map((entry) => [entry.name, Buffer.from(entry.data)]));
  for (const file of marketplaceFiles) {
    if (!map.get(file.path)?.equals(await fs.readFile(path.join(marketplace, file.path)))) throw new Error('Marketplace archive mismatch.');
  }
  console.log(JSON.stringify({ ok: true, status: 'cursor_package_install_smoke_passed',
    version, runtimeFiles: actual.length, marketplaceFiles: entries.length,
    defaultHost: 'cursor', agentSkillsFiles: agentActual.length,
    globalInstallationModified: false }));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
