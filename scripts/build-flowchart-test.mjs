#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inventory } from './cursor-installer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'flowchart-test');
const hostRoot = path.join(output, 'codex');
const name = 'taku-publisher-flowchart-integration-test';
const displayName = 'Taku Publisher Flowchart Integration Test';
const source = JSON.parse(execFileSync(process.execPath, ['scripts/source-checksum.mjs'], {
  cwd: root,
  encoding: 'utf8',
}));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const sourceDirty = Boolean(execFileSync('git', ['status', '--porcelain'], {
  cwd: root,
  encoding: 'utf8',
}).trim());
const candidateVersion = JSON.parse(await fs.readFile(path.join(
  root,
  'dist/skills/taku-publisher/publisher-version.json',
), 'utf8')).version;
const fingerprint = `b${source.sourceTreeChecksum.slice(0, 12)}`;
const version = `${nextPatchVersion(candidateVersion)}-flowchart.${fingerprint}`;
const marketplaceName = `taku-flowchart-test-${fingerprint}`;
const plugin = path.join(hostRoot, 'plugins', name);
const skill = path.join(plugin, 'skills', name);
const writeJson = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Invalid source commit.');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.dirname(plugin), { recursive: true });
await fs.cp(path.join(root, 'dist/plugins/codex/taku-publisher'), plugin, { recursive: true });
await fs.rename(path.join(plugin, 'skills/taku-publisher'), skill);

const manifestFile = path.join(plugin, '.codex-plugin', 'plugin.json');
const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
if (manifest.version !== candidateVersion) throw new Error('Codex plugin and portable Skill versions disagree.');
manifest.name = name;
manifest.version = version;
manifest.description = 'Isolated Codex test build for automatic bilingual Marketplace Flowchart generation.';
if (manifest.interface) {
  manifest.interface.displayName = displayName;
  manifest.interface.shortDescription = 'Test fail-closed bilingual Flowchart generation.';
  manifest.interface.defaultPrompt = [
    `Use $${name} to test one private Skill draft with automatic Marketplace Flowchart generation. Do not submit or publish it.`,
  ];
}
await writeJson(manifestFile, manifest);

const adapterFile = path.join(plugin, 'host-adapter.json');
const adapter = JSON.parse(await fs.readFile(adapterFile, 'utf8'));
adapter.skill = name;
await writeJson(adapterFile, adapter);
await writeJson(path.join(skill, 'publisher-version.json'), {
  name,
  version,
  channel: 'flowchart-integration-test',
});

const skillFile = path.join(skill, 'SKILL.md');
const skillText = await fs.readFile(skillFile, 'utf8');
if (!skillText.startsWith('---\nname: taku-publisher\n')) {
  throw new Error('Unexpected Skill frontmatter.');
}
await fs.writeFile(skillFile, skillText
  .replace('name: taku-publisher\n', `name: ${name}\n`)
  .replace(/^description: (.*)$/m, (_, description) => `description: ${JSON.stringify(
    `Isolated Codex integration test for automatic bilingual Marketplace Flowchart generation. ${description}`,
  )}`)
  .replace('# Taku Publisher\n', `# ${displayName}\n\nThis is an unpublished, isolated Codex test build. It enables automatic Marketplace\nFlowchart generation only for new Skill drafts. Updates inherit the existing listing,\nand valid creator-provided Flowcharts are preserved. Generation failures must stop\nbefore icon generation or remote draft creation. Never submit or publicly publish a\nSkill without a separate explicit request.\n`));

const runnerFile = path.join(skill, 'scripts', 'taku-publisher.mjs');
const runner = await fs.readFile(runnerFile, 'utf8');
const runnerMarker = "import { readFile } from 'node:fs/promises';\n";
if (runner.split(runnerMarker).length !== 2) throw new Error('Unexpected Publisher runner.');
await fs.writeFile(runnerFile, runner.replace(
  runnerMarker,
  `${runnerMarker}\nprocess.env.TAKU_PUBLISHER_GENERATE_FLOWCHART ??= 'true';\n`,
));

const agentFile = path.join(skill, 'agents', 'openai.yaml');
const agent = await fs.readFile(agentFile, 'utf8');
await fs.writeFile(agentFile, agent
  .replace(/display_name: .*$/m, `display_name: "${displayName}"`)
  .replace(/short_description: .*$/m, 'short_description: "Test automatic bilingual Marketplace Flowcharts."')
  .replace(/default_prompt: .*$/m, `default_prompt: "Use $${name} to test one private Skill draft with automatic Marketplace Flowchart generation; do not submit or publish it."`));

await fs.writeFile(path.join(plugin, 'README.md'), `# ${displayName}\n\nVersion: ${version}. This is an isolated acceptance build based on standard ${candidateVersion}.\nIt enables automatic Flowchart generation for new Skill drafts only. It does not\nsubmit or publicly publish Skills.\n`);

const marketplace = JSON.parse(await fs.readFile(path.join(root, 'adapters/codex/marketplace.json'), 'utf8'));
marketplace.name = marketplaceName;
if (marketplace.interface) marketplace.interface.displayName = displayName;
const entry = marketplace.plugins[0];
entry.name = name;
entry.version = version;
entry.source = { source: 'local', path: `./plugins/${name}` };
entry.description = manifest.description;
await fs.mkdir(path.join(hostRoot, '.agents', 'plugins'), { recursive: true });
await writeJson(path.join(hostRoot, '.agents', 'plugins', 'marketplace.json'), marketplace);

const files = await inventory(skill);
if (files.some(({ path: file }) => /\.(?:py|pyc|pyo|test\.mjs|js\.map)$/.test(file))) {
  throw new Error('Unexpected development files in Flowchart test Skill.');
}
const runnerCheck = await fs.readFile(runnerFile, 'utf8');
if (!runnerCheck.includes("process.env.TAKU_PUBLISHER_GENERATE_FLOWCHART ??= 'true';")) {
  throw new Error('Flowchart test build did not enable automatic generation.');
}

await writeJson(path.join(hostRoot, 'provenance.json'), {
  name,
  version,
  channel: 'flowchart-integration-test',
  baseProductionVersion: candidateVersion,
  sourceCommit,
  sourceDirty,
  source,
  host: 'codex',
  publicRelease: false,
  automaticFlowchartGeneration: true,
});
const archive = `${name}-codex-${version}.zip`;
execFileSync('zip', ['-qr', path.join(output, archive), '.'], { cwd: hostRoot });
const bytes = await fs.readFile(path.join(output, archive));
const build = {
  host: 'codex',
  directory: 'codex',
  archive,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: bytes.length,
  skillFileCount: files.length,
};
await writeJson(path.join(output, 'build.json'), {
  name,
  version,
  marketplaceName,
  sourceCommit,
  sourceDirty,
  source,
  publicRelease: false,
  builds: [build],
});
await fs.writeFile(path.join(output, 'README.md'), `# ${displayName}\n\n${version} — isolated Codex acceptance build, not the public production plugin.\n\nMarketplace root: \`codex\`\nPlugin directory: \`codex/plugins/${name}\`\nArchive: \`${archive}\`\n`);

console.log(JSON.stringify({
  ok: true,
  name,
  version,
  marketplaceName,
  output,
  plugin,
  archive: path.join(output, archive),
  build,
}, null, 2));

function nextPatchVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  if (!match) throw new Error(`Production version must be stable semver: ${value}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}
