#!/usr/bin/env node

/**
 * TakuAI Template - unattended pnpm install wrapper.
 * The Desktop host normally owns installation; this remains a safe standalone fallback.
 */

const { spawn } = require('node:child_process');

const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
};

const FROZEN_INSTALL_ARGS = ['install', '--frozen-lockfile'];
const REPAIR_LOCKFILE_ARGS = ['install', '--no-frozen-lockfile'];
const ERROR_TAIL_LIMIT = 12_000;

function log(color, tag, message) {
  console.log(`${color}%s${colors.reset}`, tag, message);
}

function createUnattendedInstallEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    CI: 'true',
  };
}

function isOutdatedLockfileError(error) {
  const lower = String(error && error.message ? error.message : error || '').toLowerCase();
  if (lower.includes('err_pnpm_outdated_lockfile')) return true;
  if (lower.includes('frozen-lockfile') && lower.includes('pnpm-lock')) return true;
  if (lower.includes('pnpm-lock.yaml') && lower.includes('not up to date')) return true;
  return false;
}

function appendTail(current, chunk) {
  const next = `${current}${chunk}`;
  return next.length <= ERROR_TAIL_LIMIT ? next : next.slice(-ERROR_TAIL_LIMIT);
}

function runPnpmInstall(args, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const cwd = options.cwd || process.cwd();
  const env = createUnattendedInstallEnv(options.env || process.env);

  return new Promise((resolve, reject) => {
    const child = spawnImpl('pnpm', args, {
      cwd,
      env,
      // pnpm must never wait for terminal confirmation in a background/packaged flow.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let outputTail = '';
    let settled = false;
    const forward = (stream, chunk) => {
      const text = chunk.toString();
      outputTail = appendTail(outputTail, text);
      stream.write(text);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      if (error) reject(error);
      else resolve();
    };
    const onSigint = () => child.kill('SIGINT');
    const onSigterm = () => child.kill('SIGTERM');

    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    child.stdout.on('data', chunk => forward(process.stdout, chunk));
    child.stderr.on('data', chunk => forward(process.stderr, chunk));
    child.once('error', finish);
    child.once('close', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }

      const detail = outputTail.trim() ? `\n\n----- Tail Logs -----\n${outputTail.trim()}` : '';
      finish(
        new Error(
          `pnpm ${args.join(' ')} failed (code=${code ?? 'null'}, signal=${
            signal ?? 'null'
          })${detail}`
        )
      );
    });
  });
}

async function installWithStatus(options = {}) {
  const startedAt = Date.now();
  const writeStatus = options.log || log;
  const runInstall = options.runInstall || (args => runPnpmInstall(args, options));

  writeStatus(colors.yellow, '[TAKUAI-INSTALL-START]', 'Installing dependencies...');

  try {
    await runInstall([...FROZEN_INSTALL_ARGS]);
  } catch (error) {
    if (!isOutdatedLockfileError(error)) {
      const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
      writeStatus(
        colors.red,
        '[TAKUAI-INSTALL-ERROR]',
        `Dependencies installation failed after ${duration}s`
      );
      throw error;
    }

    writeStatus(
      colors.yellow,
      '[TAKUAI-INSTALL-REPAIR]',
      'Lockfile is outdated; synchronizing it once...'
    );
    try {
      await runInstall([...REPAIR_LOCKFILE_ARGS]);
    } catch (repairError) {
      const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
      writeStatus(
        colors.red,
        '[TAKUAI-INSTALL-ERROR]',
        `Dependencies installation failed after ${duration}s`
      );
      throw repairError;
    }
  }

  const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
  writeStatus(
    colors.green,
    '[TAKUAI-INSTALL-SUCCESS]',
    `Dependencies installed successfully in ${duration}s`
  );
}

if (require.main === module) {
  installWithStatus().catch(error => {
    console.error('Installation failed:', error.message);
    process.exit(1);
  });
}

module.exports = {
  createUnattendedInstallEnv,
  installWithStatus,
  isOutdatedLockfileError,
  runPnpmInstall,
};
