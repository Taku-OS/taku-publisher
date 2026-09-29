#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  path.join('dist', 'skills', 'taku-sites'),
  ...['codex', 'claude', 'cursor'].map(host =>
    path.join('dist', 'plugins', host, 'taku-publisher', 'skills', 'taku-sites')),
];
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-sites-skill-smoke-'));

try {
  for (const target of targets) {
    const source = path.join(repositoryRoot, target);
    const skill = path.join(temporary, path.basename(path.dirname(target)), target.replaceAll(path.sep, '_'));
    await fs.cp(source, skill, { recursive: true });
    const instructions = await fs.readFile(path.join(skill, 'SKILL.md'), 'utf8');
    assert.match(instructions, /^---\nname: taku-sites\n/m);
    for (const notice of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
      await fs.access(path.join(skill, notice));
    }
    await fs.access(path.join(skill, 'node_modules', '@taku', 'publisher-runtime', 'sites-core', 'index.mjs'));
    const cli = path.join(skill, 'scripts', 'taku-publisher.mjs');
    for (const reference of ['contract.md', 'capabilities.md', 'storage.md', 'testing.md']) {
      await fs.access(path.join(skill, 'references', reference));
    }
    // The capability catalog is live-only: without a Sites session it must fail clearly, not fall back.
    const contract = run(cli, ['sites-contract', '--json'], skill, temporary, { fail: true });
    assert.equal(contract.error.code, 'sites_login_required');
    const removed = run(cli, ['sites-preview', '--json'], skill, temporary, { fail: true });
    assert.equal(removed.error.code, 'unknown_command');
    const project = path.join(temporary, `project-${target.replaceAll(path.sep, '-')}`);
    const initialized = run(cli, ['sites-init', '--project', project, '--json'], skill, temporary);
    assert.equal(initialized.status, 'sites_project_created');
    await fs.writeFile(path.join(project, 'dist', 'assets', 'index.html'),
      '<!doctype html><html lang="en"><title>Agent-built Site</title><main><h1>Agent-built Site</h1><button id="hello">Hello</button></main><script type="module" src="/app.mjs"></script></html>');
    await fs.writeFile(path.join(project, 'dist', 'assets', 'app.mjs'),
      'document.querySelector("#hello").addEventListener("click", () => { document.querySelector("#hello").textContent = "Clicked"; });\n');
    const sdk = run(cli, ['sites-sdk-export', '--output', path.join(project, 'dist/assets/taku-sites-sdk.mjs'), '--json'], skill, temporary);
    assert.equal(sdk.status, 'sites_sdk_exported');
    const checked = run(cli, ['sites-validate', '--project', project, '--json'], skill, temporary);
    assert.equal(checked.status, 'sites_valid');
    assert.ok(checked.object_count >= 4);
  }
  console.log(JSON.stringify({ ok: true, targets: targets.length }));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}

function run(cli, args, cwd, home, { fail = false } = {}) {
  const completed = spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, TAKU_PUBLISHER_HOME: path.join(home, 'publisher-home') },
  });
  if ((completed.status !== 0) !== fail) {
    throw new Error(`${args[0]} failed in ${cwd}: ${completed.stdout}\n${completed.stderr}`);
  }
  return JSON.parse(completed.stdout);
}
