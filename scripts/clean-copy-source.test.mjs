import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const gitPath = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
const tarPath = execFileSync('which', ['tar'], { encoding: 'utf8' }).trim();
const cleanEnv = {
  PATH: process.env.PATH,
  LC_ALL: 'C',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-clean-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const scratch = path.join(root, 'scratch');
  const tools = path.join(root, 'tools');
  const calls = path.join(root, 'npm-calls.jsonl');
  for (const directory of [path.join(source, 'scripts'), scratch, tools]) await mkdir(directory, { recursive: true });
  for (const name of ['clean-copy-smoke.mjs', 'repository-files.mjs', 'clean-copy-source.mjs', 'source-checksum.mjs']) {
    try { await copyFile(new URL(name, import.meta.url), path.join(source, 'scripts', name)); }
    catch (error) { if (name !== 'clean-copy-source.mjs' || error.code !== 'ENOENT') throw error; }
  }
  // Keep the actual export/install orchestration. Only downstream build commands
  // are inert fixture files: no dependencies, real provider or global install.
  for (const name of ['sites-skill-smoke.mjs', 'no-python-plugin-smoke.mjs', 'build-challenge-test.mjs', 'challenge-test-smoke.mjs',
    'build-marketplace-release.mjs', 'package-cursor-release.mjs']) {
    await writeFile(path.join(source, 'scripts', name), 'export {};\n');
  }
  await writeFile(path.join(source, 'marker.txt'), 'approved\n');
  await writeFile(path.join(source, 'exported.txt'), '$Format:%H$\n');
  await writeFile(path.join(source, 'binary.bin'), Buffer.from([0, 255, 128, 10]));
  await writeFile(path.join(source, 'line\nname.txt'), 'nul-delimited path fixture\n');
  await writeFile(path.join(source, 'executable.sh'), '#!/bin/sh\nexit 0\n');
  await chmod(path.join(source, 'executable.sh'), 0o755);
  const git = (...args) => execFileSync(gitPath, ['-C', source, ...args], {
    env: cleanEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Clean source fixture');
  git('config', 'user.email', 'clean-source@example.invalid');
  git('config', 'core.hooksPath', path.join(root, 'empty-hooks'));
  git('add', '.');
  git('commit', '--quiet', '-m', 'Approved clean source');
  const commit = git('rev-parse', 'HEAD');
  const npm = path.join(tools, 'npm');
  await writeFile(npm, `#!${process.execPath}\n` + `
const fs = require('node:fs');
const path = require('node:path');
const cwd = process.cwd();
const read = name => { try { return fs.readFileSync(path.join(cwd, name), 'utf8'); } catch { return null; } };
fs.appendFileSync(process.env.CLEAN_SOURCE_CALLS, JSON.stringify({
  args: process.argv.slice(2), marker: read('marker.txt'), exported: read('exported.txt'),
  binary: fs.readFileSync(path.join(cwd, 'binary.bin')).toString('hex'),
  oddPath: read('line\\nname.txt'),
  commit: process.env.TAKU_CONTRACT_SOURCE_COMMIT, dirty: process.env.TAKU_CONTRACT_SOURCE_DIRTY,
}) + '\\n');
if (process.env.CLEAN_SOURCE_NPM_FAIL === '1') process.exit(23);
`);
  await chmod(npm, 0o755);
  const tar = path.join(tools, 'tar');
  await writeFile(tar, `#!${process.execPath}\n` + `
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if (process.env.CLEAN_SOURCE_TAR_MODE === 'fail') process.exit(24);
const result = spawnSync(${JSON.stringify(tarPath)}, process.argv.slice(2), { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const args = process.argv.slice(2);
const output = args[args.indexOf('-C') + 1];
const mode = process.env.CLEAN_SOURCE_TAR_MODE;
if (mode === 'extra') fs.writeFileSync(path.join(output, 'unexpected.txt'), 'extra source');
if (mode === 'bytes') fs.writeFileSync(path.join(output, 'binary.bin'), Buffer.from([0, 254, 128, 10]));
if (mode === 'symlink') {
  fs.unlinkSync(path.join(output, 'marker.txt'));
  fs.symlinkSync(process.env.CLEAN_SOURCE_OUTSIDE_MARKER, path.join(output, 'marker.txt'));
}
if (mode === 'mode') fs.chmodSync(path.join(output, 'executable.sh'), 0o644);
`);
  await chmod(tar, 0o755);
  const run = (options = {}, args = []) => spawnSync(process.execPath, [path.join(source, 'scripts/clean-copy-smoke.mjs'), ...args], {
    cwd: source,
    env: {
      ...cleanEnv, PATH: `${tools}${path.delimiter}${cleanEnv.PATH}`, TMPDIR: scratch,
      CLEAN_SOURCE_CALLS: calls, CLEAN_SOURCE_OUTSIDE_MARKER: path.join(source, 'marker.txt'), ...options,
    },
    encoding: 'utf8', timeout: 20_000,
  });
  const started = async () => {
    try { return (await readFile(calls, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const cleaned = async () => assert.deepEqual(await readdir(scratch), [], 'owned source scratch must be removed');
  return { root, source, scratch, git, commit, run, started, cleaned };
}

test('clean-copy exports the exact committed bytes and ignores working-tree edits', async t => {
  const state = await fixture(t);
  await writeFile(path.join(state.source, 'marker.txt'), 'uncommitted\n');
  const result = state.run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = await state.started();
  assert.deepEqual(calls[0].args, ['ci']);
  assert.equal(calls[0].marker, 'approved\n');
  assert.equal(calls[0].exported, '$Format:%H$\n');
  assert.equal(calls[0].binary, '00ff800a');
  assert.equal(calls[0].oddPath, 'nul-delimited path fixture\n');
  assert.equal(calls[0].commit, state.commit);
  assert.equal(calls[0].dirty, 'false');
  await state.cleaned();
});

test('clean-copy cannot label Git replacement bytes with the approved commit', async t => {
  const state = await fixture(t);
  await writeFile(path.join(state.source, 'marker.txt'), 'replacement\n');
  state.git('add', 'marker.txt');
  state.git('commit', '--quiet', '-m', 'Replacement source');
  const replacement = state.git('rev-parse', 'HEAD');
  state.git('update-ref', 'HEAD', state.commit);
  state.git('replace', state.commit, replacement);
  assert.equal(state.git('show', `${state.commit}:marker.txt`), 'replacement');
  const result = state.run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = await state.started();
  assert.equal(calls[0].marker, 'approved\n');
  assert.equal(calls[0].commit, state.commit);
  await state.cleaned();
});

for (const [attribute, file] of [['export-ignore', 'marker.txt'], ['export-subst', 'exported.txt']]) {
  test(`clean-copy rejects ${attribute} source changes before npm ci`, async t => {
    const state = await fixture(t);
    await writeFile(path.join(state.source, '.git/info/attributes'), `${file} ${attribute}\n`);
    const result = state.run();
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /source.*(missing|byte|mismatch)/i);
    assert.deepEqual(await state.started(), [], 'unverified source must not start npm');
    await state.cleaned();
  });
}

test('clean-copy ignores inherited Git repository and configuration overrides', async t => {
  const state = await fixture(t);
  const decoy = path.join(state.root, 'decoy');
  await cp(state.source, decoy, { recursive: true });
  await writeFile(path.join(decoy, 'marker.txt'), 'decoy\n');
  execFileSync(gitPath, ['-C', decoy, 'add', '.'], { env: cleanEnv });
  execFileSync(gitPath, ['-C', decoy, '-c', 'user.name=Decoy', '-c', 'user.email=decoy@example.invalid', 'commit', '--quiet', '-m', 'Decoy source'], { env: cleanEnv });
  const result = state.run({
    GIT_DIR: path.join(decoy, '.git'), GIT_WORK_TREE: decoy, GIT_COMMON_DIR: path.join(decoy, '.git'),
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.attributesfile', GIT_CONFIG_VALUE_0: '/nonexistent-fixture-attributes',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = await state.started();
  assert.equal(calls[0].marker, 'approved\n');
  assert.equal(calls[0].commit, state.commit);
  await state.cleaned();
});

for (const mode of ['extra', 'bytes', 'symlink', 'mode']) {
  test(`clean-copy rejects extracted ${mode} changes before npm ci`, async t => {
    const state = await fixture(t);
    const result = state.run({ CLEAN_SOURCE_TAR_MODE: mode });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /source.*(unexpected|byte|mismatch|type|mode)/i);
    assert.deepEqual(await state.started(), [], 'unverified extraction must not start npm');
    await state.cleaned();
  });
}

test('clean-copy removes owned scratch after extraction failure without starting npm', async t => {
  const state = await fixture(t);
  const result = state.run({ CLEAN_SOURCE_TAR_MODE: 'fail' });
  assert.equal(result.status, 1);
  assert.deepEqual(await state.started(), []);
  await state.cleaned();
});

test('clean-copy does not leave scratch when the source commit cannot be resolved', async t => {
  const state = await fixture(t);
  state.git('update-ref', '-d', 'HEAD');
  const result = state.run();
  assert.equal(result.status, 1);
  assert.deepEqual(await state.started(), []);
  await state.cleaned();
});

test('clean-copy removes owned scratch after npm ci fails on verified source', async t => {
  const state = await fixture(t);
  const result = state.run({ CLEAN_SOURCE_NPM_FAIL: '1' });
  assert.equal(result.status, 1);
  const calls = await state.started();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['ci']);
  assert.equal(calls[0].marker, 'approved\n');
  assert.equal(calls[0].commit, state.commit);
  await state.cleaned();
});

test('working-tree smoke preserves its uncommitted-candidate declaration', async t => {
  const state = await fixture(t);
  await writeFile(path.join(state.source, 'marker.txt'), 'uncommitted\n');
  const result = state.run({}, ['--working-tree']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = await state.started();
  assert.equal(calls[0].marker, 'uncommitted\n');
  assert.equal(calls[0].commit, state.commit);
  assert.equal(calls[0].dirty, 'true');
  assert.match(result.stdout, /uncommitted candidate/);
  await state.cleaned();
});
