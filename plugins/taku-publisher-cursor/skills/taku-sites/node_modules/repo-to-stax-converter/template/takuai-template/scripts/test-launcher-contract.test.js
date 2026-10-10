const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT_DIR = path.resolve(__dirname, '..');

test('canonical test launcher exposes the converter discovery sentinel', () => {
  const testRunner = fs.readFileSync(path.join(ROOT_DIR, 'scripts/run-tests.js'), 'utf8');

  assert.match(testRunner, /^\/\/ TAKU_TS_TEST_RUNNER_CONTRACT_V1$/m);
});

test('test launcher registers tsx before the workspace ESM loader', () => {
  const { buildNodeArgs } = require('./run-tests');
  const testFile = path.join(ROOT_DIR, 'src/example.test.ts');

  assert.deepEqual(buildNodeArgs(ROOT_DIR, [testFile]), [
    '--import',
    'tsx',
    '--import',
    path.join(ROOT_DIR, 'scripts/register-test-server-only-hook.mjs'),
    '--test',
    testFile,
  ]);
});

test('test loader forces ESM only for workspace source TypeScript', async t => {
  const fixtureRoot = fs.mkdtempSync(path.join(ROOT_DIR, 'src/.test-loader-contract-'));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const sourceFile = path.join(fixtureRoot, 'owned.ts');
  const dependencyFile = path.join(fixtureRoot, 'node_modules/dependency.ts');
  const sourceSymlink = path.join(fixtureRoot, 'linked.ts');
  const sourceDirectory = path.join(fixtureRoot, 'directory.ts');
  const explicitCjsFile = path.join(fixtureRoot, 'owned.cts');
  fs.mkdirSync(path.dirname(dependencyFile), { recursive: true });
  fs.writeFileSync(sourceFile, 'export {};\n');
  fs.writeFileSync(dependencyFile, 'module.exports = {};\n');
  fs.symlinkSync(sourceFile, sourceSymlink, 'file');
  fs.mkdirSync(sourceDirectory);
  fs.writeFileSync(explicitCjsFile, 'module.exports = {};\n');

  const { load } = await import('./test-server-only-loader.mjs');
  const contextFor = url => {
    let observedContext;
    load(url, {}, (_loadedUrl, context) => {
      observedContext = context;
      return { format: context.format ?? 'commonjs', source: '' };
    });
    return observedContext;
  };

  assert.equal(contextFor(pathToFileURL(sourceFile).href).format, 'module');
  assert.equal(contextFor(pathToFileURL(dependencyFile).href).format, undefined);
  assert.equal(contextFor(pathToFileURL(sourceSymlink).href).format, undefined);
  assert.equal(contextFor(pathToFileURL(sourceDirectory).href).format, undefined);
  assert.equal(contextFor(pathToFileURL(explicitCjsFile).href).format, undefined);
  assert.equal(contextFor('data:text/javascript,export%20default%201').format, undefined);
});

if (process.env.TAKU_TEST_LAUNCHER_CONTRACT_CHILD !== '1') {
  test('canonical test command executes TypeScript smoke tests with server-only and root aliases', () => {
    const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
    const result = childProcess.spawnSync(
      process.execPath,
      [path.join(ROOT_DIR, 'scripts/run-tests.js')],
      {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        env: {
          ...childEnv,
          TAKU_TEST_LAUNCHER_CONTRACT_CHILD: '1',
        },
      }
    );
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 0, output);
    assert.match(output, /TypeScript runner resolves root @ alias/, output);
    assert.match(output, /TypeScript runner treats server-only as a CJS test-only no-op/, output);
    assert.match(output, /TypeScript runner does not intercept similar CJS specifiers/, output);
    assert.match(output, /TypeScript runner treats server-only as a test-only no-op/, output);
    assert.match(output, /TypeScript runner supports top-level await in a CommonJS package/, output);
  });
}

test('test launcher discovers only sorted JavaScript script tests and TypeScript source tests', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-test-launcher-'));
  try {
    for (const relativePath of [
      'scripts/z-last.test.js',
      'scripts/a-first.test.js',
      'scripts/nested/ignored.test.js',
      'src/feature/z-last.spec.tsx',
      'src/feature/a-first.test.ts',
      'src/feature/ignored.js',
      'src/feature/node_modules/pkg/foreign.test.ts',
      'src/feature/upstream-source/copied.test.ts',
      'src/feature/.next/cache/generated.test.ts',
      'src/feature/.next-preview/cache/generated.test.ts',
      'src/feature/.next-edit/cache/generated.test.ts',
      'src/feature/dist/generated.test.ts',
      'src/feature/build/generated.spec.tsx',
      'src/feature/out/generated.test.ts',
      'src/feature/.stax-evidence/raw.test.ts',
      'src/feature/.taku/private.test.ts',
      'src/feature/evidence/report.test.ts',
    ]) {
      const target = path.join(rootDir, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, '');
    }

    const { collectTestFiles } = require('./run-tests');
    const canonicalRoot = fs.realpathSync(rootDir);

    assert.deepEqual(collectTestFiles(rootDir), [
      path.join(canonicalRoot, 'scripts/a-first.test.js'),
      path.join(canonicalRoot, 'scripts/z-last.test.js'),
      path.join(canonicalRoot, 'src/feature/a-first.test.ts'),
      path.join(canonicalRoot, 'src/feature/z-last.spec.tsx'),
    ]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('test launcher ignores nested directory and file symlinks', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-test-launcher-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-test-launcher-outside-'));
  try {
    const sourceDir = path.join(rootDir, 'src/feature');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'owned.test.ts'), '');
    fs.writeFileSync(path.join(outsideDir, 'foreign.test.ts'), '');
    fs.symlinkSync(outsideDir, path.join(sourceDir, 'linked-directory'), 'dir');
    fs.symlinkSync(
      path.join(outsideDir, 'foreign.test.ts'),
      path.join(sourceDir, 'linked.test.ts'),
      'file'
    );

    const { collectTestFiles } = require('./run-tests');
    const canonicalSourceDir = fs.realpathSync(sourceDir);

    assert.deepEqual(collectTestFiles(rootDir), [path.join(canonicalSourceDir, 'owned.test.ts')]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('test launcher rejects a source root symlink into same-workspace upstream source', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-test-launcher-'));
  try {
    const upstreamSource = path.join(rootDir, 'upstream-source/src');
    fs.mkdirSync(upstreamSource, { recursive: true });
    fs.writeFileSync(path.join(upstreamSource, 'foreign.test.ts'), '');
    fs.symlinkSync(upstreamSource, path.join(rootDir, 'src'), 'dir');

    const { collectTestFiles } = require('./run-tests');

    assert.throws(() => collectTestFiles(rootDir), /src.*symbolic link/i);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('test launcher rejects a scripts root symlink outside the workspace', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-test-launcher-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-test-launcher-outside-'));
  try {
    fs.writeFileSync(path.join(outsideDir, 'foreign.test.js'), '');
    fs.symlinkSync(outsideDir, path.join(rootDir, 'scripts'), 'dir');

    const { collectTestFiles } = require('./run-tests');

    assert.throws(() => collectTestFiles(rootDir), /scripts.*symbolic link/i);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('test launcher rejects a symbolic workspace root', () => {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-test-launcher-'));
  try {
    const rootDir = path.join(sandboxDir, 'workspace');
    const linkedRoot = path.join(sandboxDir, 'linked-workspace');
    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
    fs.symlinkSync(rootDir, linkedRoot, 'dir');

    const { collectTestFiles } = require('./run-tests');

    assert.throws(() => collectTestFiles(linkedRoot), /workspace root.*symbolic link/i);
  } finally {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }
});

test('empty test discovery succeeds without invoking Node default discovery', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-test-launcher-'));
  try {
    fs.mkdirSync(path.join(rootDir, 'scripts'));
    fs.mkdirSync(path.join(rootDir, 'src'));
    let spawnCalls = 0;
    const fakeChild = { once: () => fakeChild };
    const { runTests } = require('./run-tests');

    const result = runTests(rootDir, () => {
      spawnCalls += 1;
      return fakeChild;
    });

    assert.equal(result, null);
    assert.equal(spawnCalls, 0);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('test launcher relays a child exit code or signal without translating it', () => {
  const { relayChildTermination } = require('./run-tests');
  const events = [];
  const processControl = {
    exit: code => events.push(['exit', code]),
    kill: (pid, signal) => events.push(['kill', pid, signal]),
    pid: 42,
  };

  relayChildTermination({ code: 7, signal: null }, processControl);
  relayChildTermination({ code: null, signal: 'SIGTERM' }, processControl);

  assert.deepEqual(events, [
    ['exit', 7],
    ['kill', 42, 'SIGTERM'],
  ]);
});
