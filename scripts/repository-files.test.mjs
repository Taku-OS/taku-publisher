import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { repositoryRoot } from './repository-files.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-source-checksum-'));
  await fs.mkdir(path.join(root, 'scripts'));
  for (const name of ['repository-files.mjs', 'source-checksum.mjs']) {
    await fs.copyFile(path.join(repositoryRoot, 'scripts', name), path.join(root, 'scripts', name));
  }
  await fs.copyFile(path.join(repositoryRoot, '.gitignore'), path.join(root, '.gitignore'));
  await fs.mkdir(path.join(root, 'packages/repo-to-stax-converter'), { recursive: true });
  await fs.copyFile(path.join(repositoryRoot, 'packages/repo-to-stax-converter/.gitignore'),
    path.join(root, 'packages/repo-to-stax-converter/.gitignore'));
  await write(root, 'tests/fixtures/tmp/input.txt', 'Source fixture, not generated output\n');
  return root;
}
async function write(root, relative, text) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}
const checksum = root => JSON.parse(execFileSync(process.execPath, ['scripts/source-checksum.mjs'], {
  cwd: root, encoding: 'utf8',
}));

test('exported source checksum stays stable after converter test fixtures are generated', async () => {
  const root = await fixture();
  try {
    const before = checksum(root);
    await write(root, 'packages/repo-to-stax-converter/tmp/tests/analyzer-123/src/app/page.tsx', 'Generated test workspace\n');
    await write(root, 'tmp/smoke/output.json', '{"generated":true}\n');
    assert.deepEqual(checksum(root), before);
    // A source fixture named tmp still belongs to the audited source tree.
    await write(root, 'tests/fixtures/tmp/input.txt', 'Changed source fixture\n');
    assert.notEqual(checksum(root).sourceTreeChecksum, before.sourceTreeChecksum);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Git and exported source report the same files and checksum with test output present', async () => {
  const root = await fixture();
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    await write(root, 'packages/repo-to-stax-converter/tmp/tests/analyzer-456/README.md', 'Generated fixture\n');
    await write(root, 'tmp/smoke/result.json', '{}\n');
    await write(root, 'new-source.txt', 'Untracked source is included\n');
    const withGit = checksum(root);
    await fs.rm(path.join(root, '.git'), { recursive: true });
    assert.deepEqual(checksum(root), withGit);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
