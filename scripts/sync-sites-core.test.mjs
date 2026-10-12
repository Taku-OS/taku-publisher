import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceScript = fileURLToPath(new URL('./sync-sites-core.mjs', import.meta.url));
const env = {
  PATH: process.env.PATH,
  LC_ALL: 'C',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  BUN_OPTIONS: '--no-env-file',
};

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-source-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publisher = path.join(root, 'publisher');
  const platform = path.join(root, 'platform');
  const target = path.join(publisher, 'packages/publisher-runtime/sites-core');
  for (const directory of [path.join(publisher, 'scripts'), target,
    path.join(platform, 'packages/site-cli-core/src'), path.join(platform, 'packages/sdk/src')]) {
    await mkdir(directory, { recursive: true });
  }
  const script = path.join(publisher, 'scripts/sync-sites-core.mjs');
  await copyFile(sourceScript, script);
  assert.deepEqual(await readFile(script), await readFile(sourceScript));
  const git = (...args) => execFileSync('git', ['-C', platform, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Source identity fixture');
  git('config', 'user.email', 'source-identity-test@example.invalid');
  git('config', 'core.hooksPath', path.join(root, 'empty-hooks'));
  await writeFile(path.join(platform, '.gitignore'), 'node_modules/\n');
  const writeSource = async (marker) => {
    await writeFile(path.join(platform, 'packages/site-cli-core/src/index.ts'),
      `export const SITE_CLI_CONTRACT_VERSION = 'taku.sites.cli.v1';\nexport const sourceMarker = '${marker}';\n`);
    await writeFile(path.join(platform, 'packages/sdk/src/index.ts'), `export const sourceMarker = '${marker}';\n`);
  };
  await writeSource('approved');
  git('add', '.');
  git('commit', '--quiet', '-m', 'Approved fixture source');
  const approvedCommit = git('rev-parse', 'HEAD');
  const acorn = path.join(platform, 'packages/site-cli-core/node_modules/acorn');
  await mkdir(acorn, { recursive: true });
  await writeFile(path.join(acorn, 'package.json'), '{"name":"acorn","version":"8.18.0"}\n');
  await writeFile(path.join(acorn, 'LICENSE'), 'Fixture license metadata; no Acorn runtime is bundled in this test.\n');
  const run = (...args) => spawnSync(process.execPath, [script, '--platform', platform, '--ref', approvedCommit, ...args], {
    cwd: publisher, env, encoding: 'utf8', timeout: 30_000,
  });
  const baseline = run();
  assert.equal(baseline.status, 0, baseline.stderr || baseline.stdout);
  const approvedFiles = {};
  for (const name of ['index.mjs', 'browser-sdk.mjs', 'provenance.json', 'ACORN-LICENSE']) {
    approvedFiles[name] = await readFile(path.join(target, name));
  }
  assert.match(approvedFiles['index.mjs'].toString(), /sourceMarker = "approved"/);
  assert.match(approvedFiles['browser-sdk.mjs'].toString(), /sourceMarker = "approved"/);
  assert.equal(JSON.parse(approvedFiles['provenance.json']).sourceCommit, approvedCommit);
  return { git, run, writeSource, platform, target, approvedFiles, approvedCommit };
}

test('fixed-ref synchronization excludes uncommitted Platform source bytes', async (t) => {
  const state = await fixture(t);
  await state.writeSource('uncommitted');
  const result = state.run('--check');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.sourceCommit, state.approvedCommit);
  assert.deepEqual(report.changed, []);
  assert.match(report.note, /only the committed ref was bundled/);
  for (const [name, bytes] of Object.entries(state.approvedFiles)) {
    assert.deepEqual(await readFile(path.join(state.target, name)), bytes);
  }
  const written = state.run();
  assert.equal(written.status, 0, written.stderr || written.stdout);
  const writeReport = JSON.parse(written.stdout);
  assert.equal(writeReport.sourceCommit, state.approvedCommit);
  assert.deepEqual(writeReport.changed, []);
  for (const [name, bytes] of Object.entries(state.approvedFiles)) {
    assert.deepEqual(await readFile(path.join(state.target, name)), bytes);
  }
});

test('fixed-ref synchronization ignores Git replacement refs and preserves the approved source identity', async (t) => {
  const state = await fixture(t);
  await state.writeSource('replacement');
  state.git('add', '.');
  state.git('commit', '--quiet', '-m', 'Replacement fixture source');
  const replacement = state.git('rev-parse', 'HEAD');
  state.git('replace', state.approvedCommit, replacement);
  assert.match(state.git('show', `${state.approvedCommit}:packages/sdk/src/index.ts`), /replacement/);
  const result = state.run('--check');
  assert.equal(result.status, 0, `Replacing a Git object must not alter a pinned build: ${result.stderr}\n${result.stdout}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.sourceCommit, state.approvedCommit);
  assert.deepEqual(report.changed, []);
  for (const [name, bytes] of Object.entries(state.approvedFiles)) {
    assert.deepEqual(await readFile(path.join(state.target, name)), bytes);
  }
  const written = state.run();
  assert.equal(written.status, 0, written.stderr || written.stdout);
  assert.equal(JSON.parse(written.stdout).sourceCommit, state.approvedCommit);
  assert.deepEqual(JSON.parse(written.stdout).changed, []);
  for (const [name, bytes] of Object.entries(state.approvedFiles)) {
    assert.deepEqual(await readFile(path.join(state.target, name)), bytes);
  }
  assert.equal(state.git('worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1);
});

test('fixed-ref synchronization rejects checkout-transformed source without changing bundled artifacts', async (t) => {
  const state = await fixture(t);
  const filter = path.join(path.dirname(state.platform), 'smudge.cjs');
  await writeFile(filter, "process.stdout.write(require('node:fs').readFileSync(0, 'utf8').replaceAll('approved', 'smudged'));\n");
  await writeFile(path.join(state.platform, '.git/info/attributes'), '*.ts filter=sourceidentity\n');
  state.git('config', 'filter.sourceidentity.smudge', `${JSON.stringify(process.execPath)} ${JSON.stringify(filter)}`);
  assert.equal(state.git('status', '--porcelain'), '', 'A clean checkout alone must not prove raw source identity');
  for (const args of [[], ['--check']]) {
    const result = state.run(...args);
    assert.equal(result.status, 1, `Transformed source must fail closed: ${result.stderr}\n${result.stdout}`);
    assert.match(result.stderr, /Committed source byte mismatch/);
    for (const [name, bytes] of Object.entries(state.approvedFiles)) {
      assert.deepEqual(await readFile(path.join(state.target, name)), bytes);
    }
    assert.equal(state.git('worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1);
  }
});
