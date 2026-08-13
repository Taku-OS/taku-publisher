import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { computeRuntimeStableTreeDigest } from '../src/runtime-cli.js';

test('runtime source digest ignores only exact framework-generated files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'taku-runtime-digest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'page.tsx'), 'export default 1;\n');
  const before = await computeRuntimeStableTreeDigest(root);

  await writeFile(join(root, 'next-env.d.ts'), 'generated\n');
  await writeFile(join(root, 'tsconfig.tsbuildinfo'), 'generated\n');
  assert.equal(await computeRuntimeStableTreeDigest(root), before);

  await writeFile(join(root, 'src', 'page.tsx'), 'export default 2;\n');
  assert.notEqual(await computeRuntimeStableTreeDigest(root), before);
});
