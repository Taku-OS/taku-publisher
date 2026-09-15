import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTestRunnerTopLevelAwaitValue } from '@/lib/test-runner-top-level-await-fixture';

const resolvedAtModuleEvaluation =
  await resolveTestRunnerTopLevelAwaitValue('top-level-await-ready');

test('TypeScript runner supports top-level await in a CommonJS package', () => {
  assert.equal(resolvedAtModuleEvaluation, 'top-level-await-ready');
});
