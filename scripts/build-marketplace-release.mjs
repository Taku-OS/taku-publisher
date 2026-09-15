#!/usr/bin/env node

import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inventory } from './cursor-installer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist/marketplace-release');
const specs = [
  { host: 'codex', marker: 'codex', manifest: '.codex-plugin', marketplace: '.agents/plugins' },
  { host: 'claude', marker: 'claude-code', manifest: '.claude-plugin', marketplace: '.claude-plugin' },
  { host: 'cursor', marker: 'cursor', manifest: '.cursor-plugin', marketplace: '.cursor-plugin' },
];
const version = JSON.parse(await fs.readFile(path.join(root,
  'dist/skills/taku-publisher/publisher-version.json'), 'utf8')).version;
const sourceCommit = process.env.TAKU_CONTRACT_SOURCE_COMMIT || execFileSync('git',
  ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceDirty = ['true', 'false'].includes(process.env.TAKU_CONTRACT_SOURCE_DIRTY)
  ? process.env.TAKU_CONTRACT_SOURCE_DIRTY === 'true'
  : Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Invalid source commit.');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
const plugins = [];
for (const spec of specs) {
  const source = path.join(root, 'dist/plugins', spec.host, 'taku-publisher');
  const files = await inventory(source);
  // Keep the existing production Codex/Claude paths stable when adding Cursor.
  const destination = `plugins/taku-publisher-${spec.host}`;
  await fs.cp(source, path.join(output, destination), { recursive: true });
  const copied = await inventory(path.join(output, destination));
  if (JSON.stringify(copied) !== JSON.stringify(files)) throw new Error('Marketplace copy mismatch.');
  const plugin = JSON.parse(await fs.readFile(path.join(source, spec.manifest, 'plugin.json'), 'utf8'));
  const marker = JSON.parse(await fs.readFile(path.join(source,
    'skills/taku-publisher/host-adapter.json'), 'utf8'));
  if (plugin.name !== 'taku-publisher' || plugin.version !== version || marker.host !== spec.marker) {
    throw new Error(`Host or version mismatch: ${spec.host}`);
  }
  if (files.some(({ path: file }) => /(?:^|\/)(?:challenge-handoff|challenge-publisher-job)\.mjs$/.test(file)
      || /\.(?:py|pyc|pyo|test\.mjs|js\.map)$/.test(file))) {
    throw new Error(`Unexpected test or development runtime: ${spec.host}`);
  }
  const marketplace = JSON.parse(await fs.readFile(path.join(root,
    'adapters', spec.host, 'marketplace.json'), 'utf8'));
  if (marketplace.name !== 'taku' || marketplace.plugins.length !== 1
      || marketplace.plugins[0].name !== plugin.name) throw new Error('Invalid marketplace identity.');
  marketplace.plugins[0].source = spec.host === 'codex'
    ? { source: 'local', path: `./${destination}` }
    : `./${destination}`;
  await fs.mkdir(path.join(output, spec.marketplace), { recursive: true });
  await fs.writeFile(path.join(output, spec.marketplace, 'marketplace.json'),
    `${JSON.stringify(marketplace, null, 2)}\n`);
  plugins.push({ host: spec.marker, path: destination, version, fileCount: files.length });
}
await fs.writeFile(path.join(output, 'release.json'), `${JSON.stringify({
  version, channel: 'standard', sourceCommit, sourceDirty, plugins,
}, null, 2)}\n`);
await fs.writeFile(path.join(output, 'README.md'), `# Taku Publisher Marketplace

Current release: **${version}** — production Publisher with Cursor integration.
Stax Challenge Test is not included. All three hosts share the same Node.js runtime.

## Codex

\`\`\`sh
codex plugin marketplace add Taku-OS/taku-publisher --ref marketplace
codex plugin add taku-publisher@taku
\`\`\`

## Claude Code

\`\`\`sh
claude plugin marketplace add Taku-OS/taku-publisher@marketplace
claude plugin install taku-publisher@taku
\`\`\`

## Cursor

The root \`.cursor-plugin/marketplace.json\` describes the complete Cursor Agent
plugin at \`plugins/taku-publisher-cursor\`. For GitHub import, choose this
\`marketplace\` branch, not the source-only \`main\` branch.

Alternatively download \`taku-publisher-${version}.tgz\` from the
[GitHub release](https://github.com/Taku-OS/taku-publisher/releases/tag/v${version})
and run this command from the download directory (Node.js 20+):

\`\`\`sh
npx --yes --package ./taku-publisher-${version}.tgz taku-publisher install --host cursor
\`\`\`

This installs the bundled Skill into \`~/.cursor/skills/taku-publisher\`.
The package is not published to npm and is not listed in the official Cursor store.
Existing unmanaged or edited installations are protected; see the
[installation guide](https://github.com/Taku-OS/taku-publisher/blob/main/docs/cursor-release.md).

Start a new Agent chat/session after installation, then ask:

\`\`\`text
生成私有 Stax Card，返回可编辑 Studio 地址，同时列出候选 Skill；不要公开发布。
\`\`\`

First-use browser sign-in is required; after authorization the same command
continues. Public Skill release requires confirmation in Taku Web. Public SubApp
release remains unsupported; Marketplace buyer Skill installation targets Codex only.

Source, security policy and licenses are maintained on \`main\`.
\`release.json\` records the exact reviewed source commit for this bundle.
`);
console.log(JSON.stringify({ ok: true, version, sourceCommit, sourceDirty,
  output: path.relative(root, output), plugins }, null, 2));
