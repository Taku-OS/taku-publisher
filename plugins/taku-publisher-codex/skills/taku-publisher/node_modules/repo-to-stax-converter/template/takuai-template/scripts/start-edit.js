#!/usr/bin/env node

/**
 * TakuAI Template - Edit runtime (Dev / HMR)
 *
 * 目标：
 * - 用于 Taku “编辑模式”：edit 走 Next dev（HMR）
 * - 不启动 Drizzle Studio（避免拖慢速度）
 *
 * Ready marker（Taku 解析）：
 *   [TAKUAI-READY] kind:edit,port:3000,url:http://localhost:3000
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

function log(color, tag, message) {
  console.log(`${color}%s${colors.reset}`, tag, message);
}

function getPortFromEnv() {
  const raw = process.env.DEV_PORT || process.env.PORT || '3000';
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid port: ${raw}`);
  const port = Number(raw);
  if (!Number.isFinite(port) || port < 1024 || port > 65535) throw new Error(`Invalid port: ${raw}`);
  return port;
}

function hasNodeModules() {
  return fs.existsSync(path.join(process.cwd(), 'node_modules'));
}

async function runCommand(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd || process.cwd(),
      env: opts.env || process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.stdout.on('data', (data) => process.stdout.write(data));
    child.stderr.on('data', (data) => process.stderr.write(data));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed: ${command} ${args.join(' ')} (code=${code})`));
    });
    child.on('error', reject);
  });
}

async function ensureDeps() {
  if (hasNodeModules()) return;
  log(colors.yellow, '[TAKUAI-INSTALL-START]', 'node_modules not found, installing dependencies...');
  await runCommand('node', ['scripts/install-with-status.js']);
}

async function waitForHttpReady(url, timeoutMs, childProcess) {
  const strictReady = String(process.env.TAKU_STRICT_READY ?? '0') === '1';
  const start = Date.now();
  const requiredOkCount = strictReady ? 2 : 1;
  let okCount = 0;
  while (Date.now() - start < timeoutMs) {
    // child 进程提前退出：立刻失败（避免“卡 10 分钟没 READY”）
    if (
      childProcess &&
      (childProcess.exitCode !== null || childProcess.signalCode !== null)
    ) {
      return false;
    }
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(2000),
        headers: strictReady ? { Accept: 'text/html' } : undefined,
        redirect: 'follow',
      });
      const statusOk = res.status >= 200 && res.status < 400;
      if (statusOk) {
        okCount += 1;
        if (okCount >= requiredOkCount) return true;
      } else {
        okCount = 0;
      }
    } catch {
      okCount = 0;
      // ignore
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startEdit() {
  const port = getPortFromEnv();
  const url = `http://localhost:${port}`;
  const strictReady = String(process.env.TAKU_STRICT_READY ?? '0') === '1';
  let stopRequested = false;

  log(colors.cyan, '[TAKUAI-STARTING]', `kind:edit,port:${port},url:${url}`);

  await ensureDeps();

  log(colors.blue, '[TAKUAI-SERVER-START]', `Starting dev server on port ${port}...`);

  // pnpm v10: do NOT use `--` here, otherwise it will be forwarded to `next dev` and break arg parsing.
  const child = spawn('pnpm', ['run', 'dev', '-p', String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, DEV_PORT: String(port), PORT: String(port) },
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));

  // 首次启动/首次编译可能较慢：与 Taku 主进程默认 10min 超时对齐
  const ready = await waitForHttpReady(url, 10 * 60_000, child);
  if (!ready) {
    log(colors.red, '[TAKUAI-ERROR]', `Edit server failed to become ready: ${url}`);
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
    process.exit(1);
  }

  log(colors.green, '[TAKUAI-READY]', `kind:edit,port:${port},url:${url}`);

  // READY 之后如果子进程异常退出：立刻退出（让 Taku 主进程感知 error）
  child.once('exit', (code, signal) => {
    if (stopRequested) process.exit(0);
    if ((code ?? 0) === 0 && !signal) {
      log(colors.yellow, '[TAKUAI-STOPPED]', `Edit server exited (code=0, signal=null)`);
      process.exit(0);
    }
    log(
      colors.red,
      '[TAKUAI-ERROR]',
      `Edit server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
    );
    process.exit(code ?? 1);
  });

  // strictReady：READY 后短窗口持续探测，避免“先 READY 后立即 500/崩”造成上层误判
  if (strictReady) {
    void (async () => {
      const stableMs = 8_000;
      const start = Date.now();
      while (Date.now() - start < stableMs) {
        if (stopRequested) return;
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(2000),
            headers: { Accept: 'text/html' },
            redirect: 'follow',
          });
          if (res.status >= 500) {
            log(colors.red, '[TAKUAI-ERROR]', `Edit server unstable after READY: ${url} (status=${res.status})`);
            process.exit(1);
          }
        } catch (err) {
          log(
            colors.red,
            '[TAKUAI-ERROR]',
            `Edit server unstable after READY: ${url} (${err instanceof Error ? err.message : String(err)})`
          );
          process.exit(1);
        }
        await new Promise(r => setTimeout(r, 400));
      }
    })();
  }

  const cleanup = (signal) => {
    if (stopRequested) return;
    stopRequested = true;
    log(colors.yellow, '[TAKUAI-CLEANUP]', `Received ${signal}, shutting down edit runtime...`);
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));

  // keep alive
  await new Promise(() => {});
}

startEdit().catch((err) => {
  log(colors.red, '[TAKUAI-FULL-ERROR]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

