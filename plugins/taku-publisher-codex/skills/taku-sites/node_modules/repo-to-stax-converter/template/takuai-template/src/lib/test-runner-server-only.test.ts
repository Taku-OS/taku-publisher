import assert from 'node:assert/strict';
import test from 'node:test';

test('TypeScript runner treats server-only as a test-only no-op', async () => {
  await import('server-only');
  assert.ok(true);
});
