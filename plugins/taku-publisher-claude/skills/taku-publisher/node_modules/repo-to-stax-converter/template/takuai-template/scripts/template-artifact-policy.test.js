const assert = require('node:assert/strict');
const test = require('node:test');

test('generated SubApps clean local template build and install artifacts', () => {
  const payloadPolicy = require('../.taku-template.json');

  assert.deepEqual(payloadPolicy.cleanup, [
    '.taku-template',
    '.husky/_',
    'next-env.d.ts',
    'tsconfig.tsbuildinfo',
  ]);
});

test('generated SubApps exclude the template artifact policy test', () => {
  const payloadPolicy = require('../.taku-template.json');

  assert.equal(payloadPolicy.exclude.includes('scripts/template-artifact-policy.test.js'), true);
  assert.equal(payloadPolicy.exclude.includes('scripts/test-launcher-contract.test.js'), true);
});

test('generated SubApps remove template-only smoke fixtures and retain the shared runner', () => {
  const payloadPolicy = require('../.taku-template.json');
  const removedFixtures = [
    'src/lib/test-runner-alias-fixture.ts',
    'src/lib/test-runner-alias.test.ts',
    'src/lib/test-runner-server-only-cjs-fixture.ts',
    'src/lib/test-runner-server-only-cjs.test.ts',
    'src/lib/test-runner-server-only.test.ts',
    'src/lib/test-runner-top-level-await-fixture.ts',
    'src/lib/test-runner-top-level-await.test.ts',
    'src/lib/test-runner-top-level-await-types.ts',
  ];
  const retainedRuntime = [
    'scripts/run-tests.js',
    'scripts/register-test-server-only-hook.mjs',
    'scripts/test-server-only-loader.mjs',
    'scripts/test-server-only-noop.mjs',
  ];

  for (const relativePath of removedFixtures) {
    assert.equal(payloadPolicy.exclude.includes(relativePath), true, relativePath);
  }
  for (const relativePath of retainedRuntime) {
    assert.equal(payloadPolicy.exclude.includes(relativePath), false, relativePath);
  }
});
