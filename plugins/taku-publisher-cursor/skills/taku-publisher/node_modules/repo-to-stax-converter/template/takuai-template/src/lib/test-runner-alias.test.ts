import assert from 'node:assert/strict';
import test from 'node:test';
import { testRunnerAliasFixture } from '@/lib/test-runner-alias-fixture';

test('TypeScript runner resolves root @ alias', () => {
  assert.equal(testRunnerAliasFixture, 'root-alias-resolved');
});
