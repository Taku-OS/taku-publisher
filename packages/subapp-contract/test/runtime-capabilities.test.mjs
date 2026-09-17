import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertTakuSubAppRuntimeManifest, assertRuntimeCapabilities } from '../dist/index.js';

test('standalone Converter and public contract share capability validation semantics', async () => {
  assert.equal(await readFile(new URL('../src/runtime-capabilities.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../../repo-to-stax-converter/src/lib/runtime-capabilities.ts', import.meta.url), 'utf8'));
  const fixture = JSON.parse(await readFile(new URL('../../repo-to-stax-converter/template/takuai-template/src/lib/taku-runtime/fixtures/agent-runtime-qa.manifest.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => assertTakuSubAppRuntimeManifest(fixture));
  assert.doesNotThrow(() => assertTakuSubAppRuntimeManifest({ name: 'offline' }));
  for (const value of [null, [], { protocol: 'taku.agent.run/v1', operations: [] },
    { ...fixture.runtimeCapabilities, grant: true },
    { protocol: 'taku.agent.run/v2', operations: [{ id: 'agent.execute', revision: -1 }] },
    { protocol: 'taku.agent.run/v2', operations: [{ id: 'agent.execute', revision: 1 }, { id: 'agent.execute', revision: 1 }] }]) {
    assert.throws(() => assertRuntimeCapabilities(value));
    assert.throws(() => assertTakuSubAppRuntimeManifest({ name: 'bad', runtimeCapabilities: value }));
  }
});

test('capability limits permit distinct revisions and reject overflow', () => {
  const capabilities = operations => ({ protocol: 'taku.agent.run/v2', operations });
  assert.doesNotThrow(() => assertRuntimeCapabilities(capabilities([
    { id: 'agent.execute', revision: 1 }, { id: 'agent.execute', revision: 2 },
  ])));
  const operations = Array.from({ length: 64 }, (_, index) => ({ id: `custom.operation${index}`, revision: 1 }));
  assert.doesNotThrow(() => assertRuntimeCapabilities(capabilities(operations)));
  assert.throws(() => assertRuntimeCapabilities(capabilities([...operations, { id: 'custom.overflow', revision: 1 }])));
  assert.throws(() => assertRuntimeCapabilities(capabilities([{ id: 'agent.execute', revision: Number.MAX_SAFE_INTEGER + 1 }])));
});
