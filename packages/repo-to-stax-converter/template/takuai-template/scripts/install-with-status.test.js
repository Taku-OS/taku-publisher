const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const { installWithStatus } = require('./install-with-status');

test(
  'standalone install is non-interactive and repairs only a stale lockfile',
  async () => {
    const attempts = [];
    const spawnImpl = (command, args, options) => {
      attempts.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => true;

      queueMicrotask(() => {
        if (attempts.length === 1) {
          child.stderr.write('ERR_PNPM_OUTDATED_LOCKFILE pnpm-lock.yaml is not up to date');
          child.stderr.end();
          child.stdout.end();
          child.emit('close', 1, null);
          return;
        }
        child.stderr.end();
        child.stdout.end();
        child.emit('close', 0, null);
      });
      return child;
    };

    await installWithStatus({
      cwd: '/workspace',
      env: { ...process.env, CI: 'false' },
      spawnImpl,
      log: () => {},
    });

    assert.deepEqual(
      attempts.map(({ command, args, options }) => ({
        command,
        args,
        cwd: options.cwd,
        ci: options.env.CI,
        stdio: options.stdio,
      })),
      [
        {
          command: 'pnpm',
          args: ['install', '--frozen-lockfile'],
          cwd: '/workspace',
          ci: 'true',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
        {
          command: 'pnpm',
          args: ['install', '--no-frozen-lockfile'],
          cwd: '/workspace',
          ci: 'true',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ]
    );
  }
);

test('standalone install preserves unrelated failures without a repair retry', async () => {
  const expected = new Error('ERR_PNPM_FETCH_503 registry unavailable');
  let attempts = 0;

  await assert.rejects(
    installWithStatus({
      runInstall: async () => {
        attempts += 1;
        throw expected;
      },
      log: () => {},
    }),
    error => error === expected
  );
  assert.equal(attempts, 1);
});
