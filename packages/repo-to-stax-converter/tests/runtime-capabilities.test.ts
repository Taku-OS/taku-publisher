import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertRuntimeCapabilities } from '../src/lib/runtime-capabilities.js';
import { patchTakuManifest } from '../src/lib/manifest.js';

test('preserves explicit Host capability requests and never opts in by default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'capabilities-'));
  try {
    const capabilities = { protocol: 'taku.agent.run/v2', operations: [{ id: 'research.generateReport', revision: 1 }] };
    await writeFile(join(root, 'taku.manifest.json'), JSON.stringify({ actions: [], runtimeCapabilities: capabilities }));
    await patchTakuManifest({ workspaceRoot: root, name: 'report', description: 'Report' });
    assert.deepEqual(JSON.parse(await readFile(join(root, 'taku.manifest.json'), 'utf8')).runtimeCapabilities, capabilities);
    await writeFile(join(root, 'taku.manifest.json'), JSON.stringify({ actions: [] }));
    await patchTakuManifest({ workspaceRoot: root, name: 'offline', description: 'Offline' });
    assert.equal(JSON.parse(await readFile(join(root, 'taku.manifest.json'), 'utf8')).runtimeCapabilities, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects forged grants, legacy protocol, duplicate IDs and invalid revisions', () => {
  const valid = { protocol: 'taku.agent.run/v2', operations: [{ id: 'media.image.generate', revision: 1 }] };
  assert.doesNotThrow(() => assertRuntimeCapabilities(valid));
  for (const value of [null, [], { ...valid, granted: true }, { ...valid, protocol: 'taku.agent.run/v1' },
    { ...valid, operations: [{ id: 'media.image.generate', revision: 0 }] },
    { ...valid, operations: [{ id: 'media.image.generate', revision: 1, model: 'chosen' }] },
    { ...valid, operations: [valid.operations[0], { ...valid.operations[0], revision: 1 }] }]) {
    assert.throws(() => assertRuntimeCapabilities(value));
  }
});
