#!/usr/bin/env node

import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inventory } from './cursor-installer.mjs';
import { createHash } from 'node:crypto';
import { createStoredZip } from '../packages/publisher-runtime/dist/zip.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publisherOnly = process.argv.includes('--publisher-only');
if (process.argv.slice(2).some(arg => arg !== '--publisher-only')) throw new Error('Unknown marketplace build option.');
const buildRoot = path.join(root, 'dist', ...(publisherOnly ? ['native-publisher'] : []));
const output = path.join(buildRoot, 'marketplace-release');
const specs = [
  { host: 'codex', marker: 'codex', manifest: '.codex-plugin', marketplace: '.agents/plugins' },
  { host: 'claude', marker: 'claude-code', manifest: '.claude-plugin', marketplace: '.claude-plugin' },
  { host: 'cursor', marker: 'cursor', manifest: '.cursor-plugin', marketplace: '.cursor-plugin' },
];
const version = JSON.parse(await fs.readFile(path.join(root,
  path.relative(root, buildRoot), 'skills/taku-publisher/publisher-version.json'), 'utf8')).version;
const source = JSON.parse(execFileSync(process.execPath, ['scripts/source-checksum.mjs'],
  { cwd: root, encoding: 'utf8' }));
const sourceCommit = process.env.TAKU_CONTRACT_SOURCE_COMMIT || execFileSync('git',
  ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceDirty = ['true', 'false'].includes(process.env.TAKU_CONTRACT_SOURCE_DIRTY)
  ? process.env.TAKU_CONTRACT_SOURCE_DIRTY === 'true'
  : Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Invalid source commit.');
if (publisherOnly) {
  const provenance = JSON.parse(await fs.readFile(path.join(buildRoot, 'build-provenance.json'), 'utf8'));
  if (provenance.sourceCommit !== sourceCommit || provenance.sourceTreeChecksum !== source.sourceTreeChecksum) {
    throw new Error('Adapter source provenance mismatch: rebuild native adapters.');
  }
}
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
const plugins = [];
for (const spec of specs) {
  const pluginSource = path.join(buildRoot, 'plugins', spec.host, 'taku-publisher');
  const files = await inventory(pluginSource);
  // Keep the existing production Codex/Claude paths stable when adding Cursor.
  const destination = `plugins/taku-publisher-${spec.host}`;
  await fs.cp(pluginSource, path.join(output, destination), { recursive: true });
  const copied = await inventory(path.join(output, destination));
  if (JSON.stringify(copied) !== JSON.stringify(files)) throw new Error('Marketplace copy mismatch.');
  const plugin = JSON.parse(await fs.readFile(path.join(pluginSource, spec.manifest, 'plugin.json'), 'utf8'));
  const marker = JSON.parse(await fs.readFile(path.join(pluginSource,
    'skills/taku-publisher/host-adapter.json'), 'utf8'));
  if (plugin.name !== 'taku-publisher' || plugin.version !== version || marker.host !== spec.marker) {
    throw new Error(`Host or version mismatch: ${spec.host}`);
  }
  if (files.some(({ path: file }) => /\.(?:py|pyc|pyo|test\.mjs|js\.map)$/.test(file))) {
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
  const item = { host: spec.marker, path: destination, version, fileCount: files.length };
  if (publisherOnly) {
    item.files = files;
    const metadata = { version, profile: 'publisher-only', skills: ['taku-publisher'],
      sourceCommit, sourceDirty, sourceTreeChecksum: source.sourceTreeChecksum, host: spec.marker };
    const marketplaceFile = `${spec.marketplace}/marketplace.json`;
    const entries = await Promise.all(files.map(async file => ({
      name: `${destination}/${file.path}`, mode: file.mode,
      data: await fs.readFile(path.join(pluginSource, file.path)),
    })));
    entries.push({ name: marketplaceFile, mode: 0o644,
      data: await fs.readFile(path.join(output, marketplaceFile)) });
    entries.push({ name: 'provenance.json', mode: 0o644, data: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`) });
    const bytes = createStoredZip(entries);
    const name = `taku-publisher-${spec.host}-${version}-native.zip`;
    await fs.mkdir(path.join(buildRoot, 'releases'), { recursive: true });
    await fs.writeFile(path.join(buildRoot, 'releases', name), bytes);
    item.archive = { name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  plugins.push(item);
}
await fs.writeFile(path.join(output, 'release.json'), `${JSON.stringify({
  version, channel: 'standard', sourceCommit, sourceDirty, plugins,
  ...(publisherOnly ? { profile: 'publisher-only', skills: ['taku-publisher'],
    sourceTreeChecksum: source.sourceTreeChecksum } : {}),
}, null, 2)}\n`);
await fs.writeFile(path.join(output, 'README.md'), `# Taku Publisher Marketplace

${sourceDirty ? 'Unpublished source candidate' : 'Release bundle'}: **${version}** — Publisher with Cursor integration.
All three hosts share the same Node.js runtime. Stax Challenge is an explicit
optional workflow; ordinary Card, Skill and SubApp entry behavior is preserved.

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
使用 Taku Publisher 开始 Stax Challenge，生成私有 Stax Card，返回可编辑 Studio 地址，同时列出候选 Skill，让我选择一个或跳过；先不要上传或公开发布。
\`\`\`

First-use browser sign-in is required; after authorization the same command
continues. Public Skill release requires confirmation in Taku Web. Public SubApp
release remains unsupported; Marketplace buyer Skill installation targets Codex only.

Source, security policy and licenses are maintained on \`main\`.
\`release.json\` records the exact reviewed source commit for this bundle.
`);
if (publisherOnly) {
  await fs.writeFile(path.join(output, 'README.md'), `# Taku Publisher native marketplace candidate\n\nVersion **${version}**, Publisher-only profile. Source: \`${sourceCommit}\`; dirty: ${sourceDirty}.\n\nThree native plugins support the existing Card → candidate Skill → scan/review/package → private draft → Taku Web confirmation flow. Only \`taku-publisher\` is registered as a Skill. The shared runtime is retained from main for compatibility; Sites eligibility remains restricted by the server. This update does not enable Sites GA or include the Sites Skill.\n\nInstall from the \`marketplace\` branch after its separately reviewed promotion:\n\n- Codex: \`codex plugin marketplace add Taku-OS/taku-publisher --ref marketplace\`, then \`codex plugin add taku-publisher@taku\`.\n- Claude Code: \`claude plugin marketplace add Taku-OS/taku-publisher@marketplace\`, then \`claude plugin install taku-publisher@taku\`.\n- Cursor: import this branch using \`.cursor-plugin/marketplace.json\`.\n\nStart a new Agent session after a user-approved install/update. First-use production browser login and public Skill release require acceptance; local simulations do not verify them. Final public release requires confirmation on Taku Web.\n\n\`release.json\` records each file and host archive SHA-256. Source release notes and the Kristen acceptance checklist live in \`docs/release-0.3.30-native.md\` on the reviewed source branch. Retain the previous marketplace commit and host archive for rollback; do not describe old Sites credentials as a verified rollback.\n`);
}
console.log(JSON.stringify({ ok: true, version, sourceCommit, sourceDirty,
  output: path.relative(root, output), plugins }, null, 2));
