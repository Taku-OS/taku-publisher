#!/usr/bin/env node

/**
 * TakuAI Template - Preview runtime (Prod)
 *
 * 目标：
 * - 用于 Taku “快速打开应用”：preview 走 production server（next start）
 * - 缺 build 则 build（无 fallback）
 * - 不启动 Drizzle Studio（避免拖慢速度）
 *
 * Ready marker（Taku 解析）：
 *   [TAKUAI-READY] kind:preview,port:3000,url:http://localhost:3000
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

function hasProdBuildOutput() {
  const requiredFiles = [
    'BUILD_ID',
    'prerender-manifest.json',
    'routes-manifest.json',
    'build-manifest.json',
    'required-server-files.json',
  ];
  const distDir = detectPreviewDistDir();
  return requiredFiles.every((f) => fs.existsSync(path.join(process.cwd(), distDir, f)));
}

function detectPreviewDistDir() {
  // 与 next.config.ts 对齐：当 TAKU_RUNTIME_KIND=preview 且启用了 distDir 隔离时，prod build 在 .next-preview
  if (process.env.TAKU_RUNTIME_KIND !== 'preview') return '.next';

  const candidates = ['next.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.cjs'];
  for (const file of candidates) {
    try {
      const abs = path.join(process.cwd(), file);
      if (!fs.existsSync(abs)) continue;
      const raw = fs.readFileSync(abs, 'utf-8');
      if (raw.includes('.next-preview')) return '.next-preview';
    } catch {
      // ignore
    }
  }

  // fallback：旧项目未启用 distDir 隔离，仍使用 .next
  return '.next';
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

async function ensureBuild() {
  if (hasProdBuildOutput()) return;
  log(
    colors.cyan,
    '[TAKUAI-BUILD-START]',
    'Missing or incomplete .next production build output, running build...'
  );
  await runCommand('pnpm', ['run', 'build']);
  log(colors.green, '[TAKUAI-BUILD-SUCCESS]', 'Build completed');
}

async function waitForHttpReady(url, timeoutMs, childProcess) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // child 进程提前退出：立刻失败（避免“卡 10 分钟没 READY”）
    if (
      childProcess &&
      (childProcess.exitCode !== null || childProcess.signalCode !== null)
    ) {
      return false;
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startPreview() {
  const port = getPortFromEnv();
  const url = `http://localhost:${port}`;
  let stopRequested = false;

  log(colors.cyan, '[TAKUAI-STARTING]', `kind:preview,port:${port},url:${url}`);

  await ensureDeps();
  await ensureBuild();

  log(colors.blue, '[TAKUAI-SERVER-START]', `Starting prod server on port ${port}...`);

  // pnpm v10: do NOT use `--` here, otherwise it will be forwarded to `next start` and break arg parsing.
  const child = spawn('pnpm', ['run', 'start', '-p', String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));

  // 首次启动/首次 build 后可能较慢：与 Taku 主进程默认 10min 超时对齐
  const ready = await waitForHttpReady(url, 10 * 60_000, child);
  if (!ready) {
    log(colors.red, '[TAKUAI-ERROR]', `Preview server failed to become ready: ${url}`);
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
    process.exit(1);
  }

  log(colors.green, '[TAKUAI-READY]', `kind:preview,port:${port},url:${url}`);

  // READY 之后如果子进程异常退出：立刻退出（让 Taku 主进程感知 error）
  child.once('exit', (code, signal) => {
    if (stopRequested) process.exit(0);
    if ((code ?? 0) === 0 && !signal) {
      log(colors.yellow, '[TAKUAI-STOPPED]', `Preview server exited (code=0, signal=null)`);
      process.exit(0);
    }
    log(
      colors.red,
      '[TAKUAI-ERROR]',
      `Preview server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
    );
    process.exit(code ?? 1);
  });

  const cleanup = (signal) => {
    if (stopRequested) return;
    stopRequested = true;
    log(colors.yellow, '[TAKUAI-CLEANUP]', `Received ${signal}, shutting down preview...`);
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

startPreview().catch((err) => {
  log(colors.red, '[TAKUAI-FULL-ERROR]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

