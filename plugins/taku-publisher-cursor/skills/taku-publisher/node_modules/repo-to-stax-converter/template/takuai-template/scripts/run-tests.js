// TAKU_TS_TEST_RUNNER_CONTRACT_V1
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SCRIPT_TEST_PATTERN = /^[^/]+\.test\.js$/;
const SOURCE_TEST_PATTERN = /\.(?:test|spec)\.tsx?$/;
const FORBIDDEN_SOURCE_DIRECTORIES = new Set([
  '.stax-evidence',
  '.taku',
  'build',
  'dist',
  'evidence',
  'node_modules',
  'out',
  'upstream-source',
]);

function isWithinRoot(rootDir, filePath) {
  const relativePath = path.relative(rootDir, filePath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== '..' &&
      !path.isAbsolute(relativePath))
  );
}

function resolveSearchRoot(directory, label, workspaceRoot) {
  if (!fs.existsSync(directory)) return null;
  const metadata = fs.lstatSync(directory);
  if (metadata.isSymbolicLink()) {
    throw new Error(`[test-runner] ${label} must not be a symbolic link: ${directory}`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`[test-runner] ${label} must be a directory: ${directory}`);
  }
  const canonicalDirectory = fs.realpathSync(directory);
  if (workspaceRoot && !isWithinRoot(workspaceRoot, canonicalDirectory)) {
    throw new Error(`[test-runner] ${label} escapes the workspace: ${directory}`);
  }
  return canonicalDirectory;
}

function isSafeRegularFile(filePath, workspaceRoot, searchRoot) {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
  const canonicalFile = fs.realpathSync(filePath);
  return isWithinRoot(workspaceRoot, canonicalFile) && isWithinRoot(searchRoot, canonicalFile);
}

function listScriptTests(scriptsDir, workspaceRoot) {
  if (!scriptsDir) return [];

  return fs
    .readdirSync(scriptsDir, { withFileTypes: true })
    .filter(
      entry =>
        entry.isFile() &&
        SCRIPT_TEST_PATTERN.test(entry.name) &&
        isSafeRegularFile(path.join(scriptsDir, entry.name), workspaceRoot, scriptsDir)
    )
    .map(entry => path.join(scriptsDir, entry.name));
}

function isForbiddenSourceDirectory(name) {
  return (
    FORBIDDEN_SOURCE_DIRECTORIES.has(name) || name === '.next' || name.startsWith('.next-')
  );
}

function listSourceTests(directory, workspaceRoot, sourceRoot) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (isForbiddenSourceDirectory(entry.name)) return [];
      const metadata = fs.lstatSync(filePath);
      if (metadata.isSymbolicLink()) return [];
      const canonicalDirectory = fs.realpathSync(filePath);
      if (
        !isWithinRoot(workspaceRoot, canonicalDirectory) ||
        !isWithinRoot(sourceRoot, canonicalDirectory)
      ) {
        throw new Error(`[test-runner] source directory escapes the workspace: ${filePath}`);
      }
      return listSourceTests(canonicalDirectory, workspaceRoot, sourceRoot);
    }
    return entry.isFile() &&
      SOURCE_TEST_PATTERN.test(entry.name) &&
      isSafeRegularFile(filePath, workspaceRoot, sourceRoot)
      ? [filePath]
      : [];
  });
}

function collectTestFiles(rootDir = ROOT_DIR) {
  const workspaceRoot = resolveSearchRoot(path.resolve(rootDir), 'workspace root');
  const scriptsDir = resolveSearchRoot(
    path.join(workspaceRoot, 'scripts'),
    'scripts root',
    workspaceRoot
  );
  const sourceRoot = resolveSearchRoot(path.join(workspaceRoot, 'src'), 'src root', workspaceRoot);

  return [
    ...listScriptTests(scriptsDir, workspaceRoot),
    ...(sourceRoot ? listSourceTests(sourceRoot, workspaceRoot, sourceRoot) : []),
  ].sort();
}

function buildNodeArgs(rootDir, testFiles) {
  return [
    '--import',
    'tsx',
    '--import',
    path.join(rootDir, 'scripts/register-test-server-only-hook.mjs'),
    '--test',
    ...testFiles,
  ];
}

function relayChildTermination({ code, signal }, processControl = process) {
  if (signal) {
    processControl.kill(processControl.pid, signal);
    return;
  }
  processControl.exit(typeof code === 'number' ? code : 1);
}

function runTests(rootDir = ROOT_DIR, spawnChild = childProcess.spawn) {
  const testFiles = collectTestFiles(rootDir);
  if (testFiles.length === 0) {
    console.log('[test-runner] no tests discovered; skipping node --test');
    return null;
  }
  const child = spawnChild(process.execPath, buildNodeArgs(rootDir, testFiles), {
    cwd: rootDir,
    env: process.env,
    shell: false,
    stdio: 'inherit',
  });

  child.once('error', error => {
    console.error(`[test-runner] failed to start Node test process: ${error.message}`);
    process.exit(1);
  });
  child.once('exit', (code, signal) => relayChildTermination({ code, signal }));
  return child;
}

if (require.main === module) {
  runTests();
}

module.exports = {
  buildNodeArgs,
  collectTestFiles,
  relayChildTermination,
  runTests,
};
