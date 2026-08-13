import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

test('TypeScript runner treats server-only as a CJS test-only no-op', () => {
  const fixture = require('./test-runner-server-only-cjs-fixture.ts') as {
    testRunnerServerOnlyCjsFixture: string;
  };

  assert.equal(fixture.testRunnerServerOnlyCjsFixture, 'cjs-server-only-ready');
});

test('TypeScript runner reuses the CJS server-only no-op', () => {
  const firstLoad = require('server-only');
  const secondLoad = require('server-only');

  assert.equal(firstLoad, secondLoad);
});

test('TypeScript runner does not intercept similar CJS specifiers', () => {
  assert.throws(() => require('server-only-near-match'), { code: 'MODULE_NOT_FOUND' });
});
