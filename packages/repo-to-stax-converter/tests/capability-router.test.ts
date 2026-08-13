import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { analyzeRepo } from '../src/lib/analyzer.js';
import { routeRepoCapability } from '../src/lib/capability-router.js';

const FIXTURES = resolve(process.cwd(), 'tests', 'fixtures');

for (const [fixture, appType] of [
  ['nextjs', 'nextjs'],
  ['vite-react', 'vite-react'],
  ['fastapi-next', 'fastapi-next'],
  ['streamlit', 'streamlit'],
] as const) {
  test(`${fixture} routes to the SubApp migration workspace`, async () => {
    const analysis = await analyzeRepo({ repoRoot: resolve(FIXTURES, fixture) });
    const route = routeRepoCapability(analysis);
    assert.equal(analysis.appType, appType);
    assert.equal(route.kind, 'subapp-migration');
  });
}

test('skill repos route to native Stax import instead of SubApp conversion', async () => {
  const analysis = await analyzeRepo({ repoRoot: resolve(FIXTURES, 'skill') });
  const route = routeRepoCapability(analysis);
  assert.equal(analysis.appType, 'workflow-skill');
  assert.equal(route.kind, 'native-import');
  assert.match(route.nextAction, /Stax.*skill/i);
});

test('browser extensions and external connectors remain reference-only', async () => {
  for (const [fixture, appType] of [
    ['browser-extension', 'browser-extension'],
    ['external-connector', 'external-connector'],
  ] as const) {
    const analysis = await analyzeRepo({ repoRoot: resolve(FIXTURES, fixture) });
    const route = routeRepoCapability(analysis);
    assert.equal(analysis.appType, appType);
    assert.equal(route.kind, 'reference-only');
  }
});
