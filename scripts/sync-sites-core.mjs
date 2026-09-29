#!/usr/bin/env node
// Rebuilds packages/publisher-runtime/sites-core from a committed taku-sites-platform revision.
//
//   npm run sync:sites-core -- --platform /path/to/taku-sites-platform [--ref <commit|branch>] [--check]
//
// The bundle is built from a clean detached worktree of the ref (default HEAD), so
// uncommitted platform edits are never shipped. --check rebuilds and fails if the
// bundled files differ, without writing. Requires git and bun, and an installed
// platform checkout (its node_modules are reused).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'packages/publisher-runtime/sites-core');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : undefined;
};
const platform = path.resolve(option('--platform') ?? process.env.TAKU_SITES_PLATFORM_DIR ?? '');
const ref = option('--ref') ?? 'HEAD';
const check = args.includes('--check');
if (!option('--platform') && !process.env.TAKU_SITES_PLATFORM_DIR) {
  throw new Error('Pass --platform <taku-sites-platform checkout> or set TAKU_SITES_PLATFORM_DIR.');
}

const git = (...parameters) => execFileSync('git', ['-C', platform, ...parameters], { encoding: 'utf8' }).trim();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const commit = git('rev-parse', '--verify', `${ref}^{commit}`);
const dirty = Boolean(git('status', '--porcelain', '--untracked-files=no'));
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-sites-core-sync-'));
const snapshot = path.join(scratch, 'platform');
const output = path.join(scratch, 'out');
await fs.mkdir(output);
git('worktree', 'add', '--detach', snapshot, commit);
try {
  // Reuse the checkout's installed dependencies; sources come only from the snapshot.
  for (const relative of ['node_modules', 'packages/site-cli-core/node_modules', 'packages/contracts/node_modules', 'packages/sdk/node_modules']) {
    const source = path.join(platform, relative);
    if (await fs.stat(source).then(() => true, () => false)) {
      await fs.rm(path.join(snapshot, relative), { recursive: true, force: true });
      await fs.symlink(source, path.join(snapshot, relative));
    }
  }
  const bun = (cwd, ...parameters) => execFileSync('bun', ['build', ...parameters], { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
  bun(path.join(snapshot, 'packages/site-cli-core'), './src/index.ts', '--target=node', '--outfile', path.join(output, 'index.mjs'));
  bun(snapshot, 'packages/sdk/src/index.ts', '--target=browser', '--outfile', path.join(output, 'browser-sdk.mjs'));
  // Bun comments resolved dependency paths; keep them checkout-independent.
  const core = (await fs.readFile(path.join(output, 'index.mjs'), 'utf8'))
    .replace(/^\/\/ (?:\.\.\/)*[^\n]*?\/node_modules\/\.bun\//gm, '// ../../node_modules/.bun/');
  await fs.writeFile(path.join(output, 'index.mjs'), core);
  const acornRoot = await fs.realpath(path.join(snapshot, 'packages/site-cli-core/node_modules/acorn'));
  const acorn = JSON.parse(await fs.readFile(path.join(acornRoot, 'package.json'), 'utf8'));
  await fs.copyFile(path.join(acornRoot, 'LICENSE'), path.join(output, 'ACORN-LICENSE'));
  const { SITE_CLI_CONTRACT_VERSION } = await import(pathToFileURL(path.join(output, 'index.mjs')).href);
  if (typeof SITE_CLI_CONTRACT_VERSION !== 'string') throw new Error('Built core lacks SITE_CLI_CONTRACT_VERSION.');
  const provenance = {
    sourceRepository: 'Taku-OS/taku-sites-platform',
    sourceCommit: commit,
    entrypoint: 'index.mjs',
    sha256: sha256(await fs.readFile(path.join(output, 'index.mjs'))),
    contractVersion: SITE_CLI_CONTRACT_VERSION,
    thirdParty: [`acorn@${acorn.version}`],
    browserSdkSha256: sha256(await fs.readFile(path.join(output, 'browser-sdk.mjs'))),
  };
  await fs.writeFile(path.join(output, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  const files = ['ACORN-LICENSE', 'browser-sdk.mjs', 'index.mjs', 'provenance.json'];
  const changed = [];
  for (const file of files) {
    const next = await fs.readFile(path.join(output, file));
    const current = await fs.readFile(path.join(target, file)).catch(() => null);
    if (!current || !current.equals(next)) changed.push(file);
  }
  if (!check) for (const file of changed) await fs.copyFile(path.join(output, file), path.join(target, file));
  console.log(JSON.stringify({
    ok: !check || changed.length === 0, mode: check ? 'check' : 'write', sourceCommit: commit,
    contractVersion: provenance.contractVersion, changed,
    ...(dirty ? { note: 'Platform checkout has uncommitted changes; only the committed ref was bundled.' } : {}),
  }, null, 2));
  if (check && changed.length) process.exitCode = 1;
} finally {
  git('worktree', 'remove', '--force', snapshot);
  await fs.rm(scratch, { recursive: true, force: true });
}
