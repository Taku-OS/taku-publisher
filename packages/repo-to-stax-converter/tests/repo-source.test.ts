import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { prepareRepoSource, refreshGitCheckout } from '../src/lib/repo-source.js';
import { pathExists } from '../src/lib/fs.js';
import { makePackageTempDir } from './test-utils.js';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd });
  return result.stdout.trim();
}

async function makeRemoteRepo(): Promise<{ remote: string; seed: string }> {
  const root = await makePackageTempDir('remote-source');
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  await execFileAsync('git', ['init', '--bare', remote]);
  await execFileAsync('git', ['init', '-b', 'main', seed]);
  await git(seed, 'config', 'user.email', 'converter@example.test');
  await git(seed, 'config', 'user.name', 'Converter Test');
  await writeFile(join(seed, 'version.txt'), 'one\n');
  await git(seed, 'add', 'version.txt');
  await git(seed, 'commit', '-m', 'first');
  await git(seed, 'remote', 'add', 'origin', remote);
  await git(seed, 'push', '-u', 'origin', 'main');
  await git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  return { remote, seed };
}

test('refreshGitCheckout fetches and resets an existing cache to the latest remote commit', async () => {
  const { remote, seed } = await makeRemoteRepo();
  const checkout = join(await makePackageTempDir('checkout'), 'repo');

  const first = await refreshGitCheckout({ url: remote, target: checkout, boundaryRoot: dirname(checkout) });
  assert.equal(await readFile(join(checkout, 'version.txt'), 'utf8'), 'one\n');

  await writeFile(join(checkout, 'dirty.txt'), 'must be removed\n');
  await writeFile(join(seed, 'version.txt'), 'two\n');
  await git(seed, 'add', 'version.txt');
  await git(seed, 'commit', '-m', 'second');
  await git(seed, 'push');

  const second = await refreshGitCheckout({ url: remote, target: checkout, boundaryRoot: dirname(checkout) });
  assert.notEqual(second.commit, first.commit);
  assert.equal(second.ref, 'refs/remotes/origin/main');
  assert.equal(await readFile(join(checkout, 'version.txt'), 'utf8'), 'two\n');
  assert.equal(await pathExists(join(checkout, 'dirty.txt')), false);
});

test('refreshGitCheckout pins an explicit remote commit after the default branch advances', async () => {
  const { remote, seed } = await makeRemoteRepo();
  const checkout = join(await makePackageTempDir('pinned-checkout'), 'repo');
  const firstCommit = await git(seed, 'rev-parse', 'HEAD');

  await writeFile(join(seed, 'version.txt'), 'two\n');
  await git(seed, 'add', 'version.txt');
  await git(seed, 'commit', '-m', 'second');
  await git(seed, 'push');

  const pinned = await refreshGitCheckout({
    url: remote,
    target: checkout,
    boundaryRoot: dirname(checkout),
    ref: firstCommit,
  });

  assert.equal(pinned.commit, firstCommit);
  assert.equal(pinned.ref, firstCommit);
  assert.equal(await readFile(join(checkout, 'version.txt'), 'utf8'), 'one\n');
});

test('refreshGitCheckout initializes an explicit commit checkout with bounded history', async () => {
  const { remote, seed } = await makeRemoteRepo();
  const checkout = join(await makePackageTempDir('shallow-pinned-checkout'), 'repo');
  const firstCommit = await git(seed, 'rev-parse', 'HEAD');

  await writeFile(join(seed, 'version.txt'), 'two\n');
  await git(seed, 'add', 'version.txt');
  await git(seed, 'commit', '-m', 'second');
  await writeFile(join(seed, 'version.txt'), 'three\n');
  await git(seed, 'add', 'version.txt');
  await git(seed, 'commit', '-m', 'third');
  await git(seed, 'push');

  const pinned = await refreshGitCheckout({
    url: remote,
    target: checkout,
    boundaryRoot: dirname(checkout),
    ref: firstCommit,
  });

  assert.equal(pinned.commit, firstCommit);
  assert.equal(await readFile(join(checkout, 'version.txt'), 'utf8'), 'one\n');
  assert.equal(await git(checkout, 'rev-list', '--all', '--count'), '1');
});

test('refreshGitCheckout rejects unknown and unsafe explicit refs without default-branch fallback', async () => {
  const { remote } = await makeRemoteRepo();
  const checkout = join(await makePackageTempDir('invalid-ref-checkout'), 'repo');
  const unsafeCheckout = join(await makePackageTempDir('unsafe-ref-checkout'), 'repo');

  await assert.rejects(
    refreshGitCheckout({
      url: remote,
      target: checkout,
      boundaryRoot: dirname(checkout),
      ref: 'does-not-exist',
    }),
    /ref|fetch|resolve/i
  );
  assert.equal(await pathExists(join(checkout, 'version.txt')), false);

  await assert.rejects(
    refreshGitCheckout({
      url: remote,
      target: unsafeCheckout,
      boundaryRoot: dirname(unsafeCheckout),
      ref: '--upload-pack=evil',
    }),
    /unsafe|invalid|ref/i
  );
  assert.equal(await pathExists(unsafeCheckout), false);
});

test('refreshGitCheckout follows a changed remote default branch', async () => {
  const { remote, seed } = await makeRemoteRepo();
  const checkout = join(await makePackageTempDir('default-branch-checkout'), 'repo');
  await refreshGitCheckout({ url: remote, target: checkout, boundaryRoot: dirname(checkout) });

  await git(seed, 'checkout', '-b', 'trunk');
  await writeFile(join(seed, 'default-branch.txt'), 'trunk\n');
  await git(seed, 'add', 'default-branch.txt');
  await git(seed, 'commit', '-m', 'trunk default');
  await git(seed, 'push', '-u', 'origin', 'trunk');
  await git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/trunk');

  const refreshed = await refreshGitCheckout({ url: remote, target: checkout, boundaryRoot: dirname(checkout) });
  assert.equal(refreshed.ref, 'refs/remotes/origin/trunk');
  assert.equal(await readFile(join(checkout, 'default-branch.txt'), 'utf8'), 'trunk\n');
});

test('refreshGitCheckout fails closed when the remote default branch cannot be resolved', async () => {
  const { remote } = await makeRemoteRepo();
  const checkout = join(await makePackageTempDir('invalid-default-branch'), 'repo');
  await refreshGitCheckout({ url: remote, target: checkout, boundaryRoot: dirname(checkout) });
  await git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/missing');

  await assert.rejects(
    refreshGitCheckout({ url: remote, target: checkout, boundaryRoot: dirname(checkout) }),
    /set-head|remote HEAD|cannot determine/i
  );
});

test('refreshGitCheckout refuses an existing checkout without a converter ownership sentinel', async () => {
  const { remote } = await makeRemoteRepo();
  const target = join(await makePackageTempDir('unowned-cache'), 'repo');
  await execFileAsync('git', ['clone', remote, target]);
  await writeFile(join(target, 'owner-data.txt'), 'preserve me\n');

  await assert.rejects(
    refreshGitCheckout({ url: remote, target, boundaryRoot: dirname(target) }),
    /ownership sentinel/i
  );
  assert.equal(await readFile(join(target, 'owner-data.txt'), 'utf8'), 'preserve me\n');
});

test('refreshGitCheckout refuses a symlink-swapped owned cache before reset or clean', async () => {
  const { remote } = await makeRemoteRepo();
  const cacheRoot = await makePackageTempDir('symlink-cache');
  const target = join(cacheRoot, 'repo');
  await refreshGitCheckout({ url: remote, target, boundaryRoot: dirname(target) });
  const victim = join(cacheRoot, 'victim');
  await rename(target, victim);
  await writeFile(join(victim, 'owner-data.txt'), 'preserve me\n');
  await symlink(victim, target, 'dir');

  await assert.rejects(
    refreshGitCheckout({ url: remote, target, boundaryRoot: dirname(target) }),
    /symbolic link/i
  );
  assert.equal(await readFile(join(victim, 'owner-data.txt'), 'utf8'), 'preserve me\n');
});

test('refreshGitCheckout refuses a symlinked cache namespace outside the trusted work root', async () => {
  const { remote } = await makeRemoteRepo();
  const workRoot = await makePackageTempDir('ancestor-symlink-work');
  const external = await makePackageTempDir('ancestor-symlink-external');
  await symlink(external, join(workRoot, '.repo-source-cache'), 'dir');
  const target = join(workRoot, '.repo-source-cache', 'example-repo', 'repo');

  await assert.rejects(
    refreshGitCheckout({ url: remote, target, boundaryRoot: workRoot }),
    /trusted work root|symbolic link/i
  );
  assert.equal(await pathExists(join(external, 'example-repo')), false);
});

test('prepareRepoSource records commit and ref for a local Git checkout', async () => {
  const { seed } = await makeRemoteRepo();
  const prepared = await prepareRepoSource(seed, await makePackageTempDir('work-root'));

  assert.equal(prepared.sourceKind, 'local');
  assert.equal(prepared.sourceCommit, await git(seed, 'rev-parse', 'HEAD'));
  assert.equal(prepared.sourceRef, 'main');
  assert.equal(prepared.sourceDirty, false);
  assert.match(prepared.sourceUrl, /remote\.git$/);

  await writeFile(join(seed, 'uncommitted.txt'), 'dirty\n');
  const dirty = await prepareRepoSource(seed, await makePackageTempDir('dirty-work-root'));
  assert.equal(dirty.sourceDirty, true);
});

test('prepareRepoSource accepts only a local ref that resolves to current HEAD', async () => {
  const { seed } = await makeRemoteRepo();
  const currentCommit = await git(seed, 'rev-parse', 'HEAD');
  const prepared = await prepareRepoSource(seed, await makePackageTempDir('local-ref-work-root'), {
    ref: currentCommit,
  });
  assert.equal(prepared.sourceCommit, currentCommit);
  assert.equal(prepared.sourceRef, currentCommit);

  await writeFile(join(seed, 'version.txt'), 'two\n');
  await git(seed, 'add', 'version.txt');
  await git(seed, 'commit', '-m', 'second');
  const headBeforeReject = await git(seed, 'rev-parse', 'HEAD');

  await assert.rejects(
    prepareRepoSource(seed, await makePackageTempDir('different-local-ref-work-root'), { ref: currentCommit }),
    /current HEAD|ref/i
  );
  assert.equal(await git(seed, 'rev-parse', 'HEAD'), headBeforeReject);
});
