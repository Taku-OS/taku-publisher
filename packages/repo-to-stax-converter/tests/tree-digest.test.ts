import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { computeTreeDigest } from '../src/lib/tree-digest.js';

test('source digest ignores generated temporary directories', async t => {
  const root = await mkdtemp(join(tmpdir(), 'taku-tree-digest-'));
  const external = await mkdtemp(join(tmpdir(), 'taku-tree-digest-external-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  });

  await writeFile(join(root, 'README.md'), '# Source\n');
  const before = await computeTreeDigest(root);

  await mkdir(join(root, 'tmp'));
  await symlink(external, join(root, 'tmp', '.repo-source-cache'), 'dir');

  assert.equal(await computeTreeDigest(root), before);
});

test('source digest still rejects symlinks outside ignored directories', async t => {
  const root = await mkdtemp(join(tmpdir(), 'taku-tree-digest-'));
  const external = await mkdtemp(join(tmpdir(), 'taku-tree-digest-external-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  });

  await symlink(external, join(root, 'linked-source'), 'dir');

  await assert.rejects(
    computeTreeDigest(root),
    /Refusing symlink while hashing tree: linked-source/,
  );
});
