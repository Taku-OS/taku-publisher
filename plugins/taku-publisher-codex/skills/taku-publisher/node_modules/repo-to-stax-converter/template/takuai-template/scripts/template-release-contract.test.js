const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '..');

function createReleaseFixture(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-template-release-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  for (const relativePath of [
    '.nvmrc',
    '.taku-template.json',
    'package.json',
    'taku.manifest.json',
    'scripts/check-agent-payload.js',
    'scripts/check-template-release-channel.js',
    'scripts/register-test-server-only-hook.mjs',
    'scripts/run-tests.js',
    'scripts/test-server-only-loader.mjs',
    'scripts/test-server-only-noop.mjs',
  ]) {
    const source = path.join(ROOT_DIR, relativePath);
    const destination = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  fs.cpSync(
    path.join(ROOT_DIR, '.taku-template', 'payload'),
    path.join(rootDir, '.taku-template', 'payload'),
    { recursive: true }
  );
  return rootDir;
}

function runReleaseCheck(rootDir) {
  return childProcess.spawnSync(
    process.execPath,
    [
      path.join(rootDir, 'scripts/check-template-release-channel.js'),
      '--channel=taku3',
      '--tag=taku-3.0.2-template',
    ],
    { cwd: rootDir, encoding: 'utf8' }
  );
}

test('Taku 3 template release contract is pinned to 0.3.2 and Node 20', () => {
  const packageJson = require('../package.json');
  const manifest = require('../taku.manifest.json');
  const nodeVersionFile = fs.readFileSync(path.join(ROOT_DIR, '.nvmrc'));

  assert.equal(packageJson.version, '0.3.2');
  assert.equal(manifest.version, '0.3.2');
  assert.equal(packageJson.packageManager, 'pnpm@10.15.1');
  assert.match(packageJson.scripts['release:check'], /taku-3\.0\.2-template/);
  assert.deepEqual(nodeVersionFile, Buffer.from('20.20.2\n'));
});

test('template production build uses standard Next while Turbopack stays development-only', () => {
  const packageJson = require('../package.json');

  assert.equal(packageJson.scripts.build, 'next build');
  assert.equal(packageJson.scripts['dev:turbo'], 'next dev --turbopack');
});

test('template test contract uses the canonical TypeScript launcher and pinned runtime', () => {
  const packageJson = require('../package.json');
  const testRunner = fs.readFileSync(path.join(ROOT_DIR, 'scripts/run-tests.js'), 'utf8');

  assert.equal(packageJson.scripts.test, 'node scripts/run-tests.js');
  assert.equal(packageJson.devDependencies.tsx, '4.23.0');
  assert.match(testRunner, /^\/\/ TAKU_TS_TEST_RUNNER_CONTRACT_V1$/m);
});

test('RPC contract remains valid after generated apps remove the demo Action', () => {
  const routeTest = fs.readFileSync(
    path.join(ROOT_DIR, 'src/app/api/taku/rpc/route.test.ts'),
    'utf8'
  );

  assert.match(routeTest, /__taku_internal:set-service-api-auth/);
  assert.doesNotMatch(routeTest, /authenticated POST must register business Actions/);
  assert.doesNotMatch(routeTest, /rpcRequest\('host-control-token', 'greet'/);
});

test('release check rejects a template whose exact Node 20 runtime pin drifts', t => {
  const fixtureRoot = createReleaseFixture(t);
  fs.writeFileSync(path.join(fixtureRoot, '.nvmrc'), '20.20.3\n');

  const result = runReleaseCheck(fixtureRoot);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /\.nvmrc 必须逐字节等于 Node\.js 20\.20\.2 契约/);
});

test('release check rejects a template whose pnpm package manager pin drifts', t => {
  const fixtureRoot = createReleaseFixture(t);
  const packageFile = path.join(fixtureRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  packageJson.packageManager = 'pnpm@10.15.2';
  fs.writeFileSync(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`);

  const result = runReleaseCheck(fixtureRoot);

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /packageManager 必须精确锁定 pnpm@10\.15\.1/);
});

test('release check validates the .nvmrc contract byte for byte', async t => {
  const invalidContents = [
    ['missing LF', '20.20.2'],
    ['leading space', ' 20.20.2\n'],
    ['trailing space', '20.20.2 \n'],
    ['CRLF', '20.20.2\r\n'],
    ['extra line', '20.20.2\n\n'],
  ];

  for (const [label, content] of invalidContents) {
    await t.test(label, fixtureTest => {
      const fixtureRoot = createReleaseFixture(fixtureTest);
      fs.writeFileSync(path.join(fixtureRoot, '.nvmrc'), content);

      const result = runReleaseCheck(fixtureRoot);

      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /\.nvmrc 必须逐字节等于 Node\.js 20\.20\.2 契约/);
    });
  }
});

test('release check rejects destructive payload policy drift', async t => {
  const mutations = [
    [
      'missing template artifact policy exclusion',
      policy => {
        policy.exclude = policy.exclude.filter(
          entry => entry !== 'scripts/template-artifact-policy.test.js'
        );
      },
    ],
    [
      'extra source exclusion',
      policy => {
        policy.exclude.push('src');
      },
    ],
    [
      'extra public cleanup',
      policy => {
        policy.cleanup.push('public');
      },
    ],
    [
      'extra build script removal',
      policy => {
        policy.packageJson.removeScripts.push('build');
      },
    ],
  ];

  for (const [label, mutate] of mutations) {
    await t.test(label, fixtureTest => {
      const fixtureRoot = createReleaseFixture(fixtureTest);
      const policyFile = path.join(fixtureRoot, '.taku-template.json');
      const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
      mutate(policy);
      fs.writeFileSync(policyFile, `${JSON.stringify(policy, null, 2)}\n`);

      const result = runReleaseCheck(fixtureRoot);

      assert.notEqual(result.status, 0, result.stdout);
      assert.match(result.stderr, /\.taku-template\.json 必须精确匹配 canonical payload policy/);
    });
  }
});
