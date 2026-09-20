#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inventory } from './cursor-installer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist/challenge-test');
const name = 'taku-publisher-challenge-integration-test';
const displayName = 'Taku Publisher Challenge Integration Test';
const testSiteUrl = 'http://localhost:3001';
const testWorkerUrl = 'https://worker.taku.ai';
const specs = [
  { host: 'codex', marker: 'codex', manifest: '.codex-plugin', marketplace: '.agents/plugins' },
  { host: 'claude', marker: 'claude-code', manifest: '.claude-plugin', marketplace: '.claude-plugin' },
  { host: 'cursor', marker: 'cursor', manifest: '.cursor-plugin', marketplace: '.cursor-plugin' },
];
const source = JSON.parse(execFileSync(process.execPath, ['scripts/source-checksum.mjs'],
  { cwd: root, encoding: 'utf8' }));
const sourceCommit = process.env.TAKU_CONTRACT_SOURCE_COMMIT || execFileSync('git',
  ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceDirty = ['true', 'false'].includes(process.env.TAKU_CONTRACT_SOURCE_DIRTY)
  ? process.env.TAKU_CONTRACT_SOURCE_DIRTY === 'true'
  : Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim());
const candidateVersion = JSON.parse(await fs.readFile(path.join(root,
  'dist/skills/taku-publisher/publisher-version.json'), 'utf8')).version;
const fingerprint = `b${source.sourceTreeChecksum.slice(0, 12)}`;
const testBaseVersion = nextPatchVersion(candidateVersion);
const version = `${testBaseVersion}-stax-challenge.${fingerprint}`;
const marketplaceName = `taku-stax-challenge-${fingerprint}`;
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Invalid source commit.');
const writeJson = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
// Only replace this script's dedicated, reproducible build output.
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
const builds = [];
let commonRuntime;
for (const spec of specs) {
  const hostRoot = path.join(output, spec.host);
  const plugin = path.join(hostRoot, 'plugins', name);
  const baseline = path.join(root, 'dist/plugins', spec.host, 'taku-publisher');
  await fs.cp(baseline, plugin, { recursive: true });
  await fs.rename(path.join(plugin, 'skills/taku-publisher'), path.join(plugin, 'skills', name));
  const skill = path.join(plugin, 'skills', name);
  await rewriteTestDefaults(skill);
  const manifestFile = path.join(plugin, spec.manifest, 'plugin.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  if (manifest.version !== candidateVersion) throw new Error('Host versions disagree.');
  manifest.name = name; manifest.version = version;
  manifest.description = 'Isolated Stax Challenge test: Card in Studio, one Skill reviewed in the current Agent, explicit Web release.';
  if (manifest.interface) {
    manifest.interface.displayName = displayName;
    manifest.interface.shortDescription = 'Test Card-to-Skill publishing in the current Agent.';
    manifest.interface.defaultPrompt = [`Use $${name} to create a private Stax Card, open its Stax Challenge Review page and list candidate Skills; do not choose, upload or publicly publish without my confirmation.`];
  }
  await writeJson(manifestFile, manifest);
  const adapter = JSON.parse(await fs.readFile(path.join(plugin, 'host-adapter.json'), 'utf8'));
  adapter.skill = name;
  await writeJson(path.join(plugin, 'host-adapter.json'), adapter);
  await writeJson(path.join(skill, 'publisher-version.json'), { name, version, channel: 'stax-challenge-test' });
  const skillText = await fs.readFile(path.join(skill, 'SKILL.md'), 'utf8');
  if (!skillText.startsWith('---\nname: taku-publisher\n')) throw new Error('Unexpected Skill frontmatter.');
  await fs.writeFile(path.join(skill, 'SKILL.md'), skillText
    .replace('name: taku-publisher\n', `name: ${name}\n`)
    .replace(/^description: (.*)$/m, (_, description) => `description: ${JSON.stringify(
      'Isolated Stax Challenge test for Codex, Claude Code and Cursor: generate a private Card and offer one local Skill for review. Also supports ordinary Publisher requests: ' + description)}`)
    .replace('# Taku Publisher\n', `# ${displayName}\n\nThis is an unpublished, isolated test build, not the production plugin. On an\ninvocation to create or generate a Stax Card, run \`creator-draft --json --editor\n--challenge-handoff --worker-url ${testWorkerUrl} --site-url ${testSiteUrl}\n--auth-site-url ${testSiteUrl}\`, open the exact returned Stax Challenge Review\nURL (or return it if opening is unavailable), and list candidate Skills. Skill\nselection stays in the current Agent: never choose for the creator. Do not upload\nor publicly publish without separate explicit confirmation. Explicit Profile,\nStudio, App or Creator Center requests keep their normal routes. Always invoke\nthe CLI from this test Skill directory.\n`));
  const agentFile = path.join(skill, 'agents/openai.yaml');
  const agent = await fs.readFile(agentFile, 'utf8');
  await fs.writeFile(agentFile, agent
    .replace(/display_name: .*$/m, `display_name: "${displayName}"`)
    .replace(/short_description: .*$/m, 'short_description: "Test private Card and one reviewed Skill workflow."')
    .replace(/default_prompt: .*$/m, `default_prompt: "Use $${name} to create a private Card, open its Stax Challenge Review page and list candidate Skills; do not choose, upload or publicly publish without my confirmation."`));
  await fs.writeFile(path.join(plugin, 'README.md'), `# ${displayName}\n\nVersion: ${version}. Isolated acceptance build based on standard ${candidateVersion}.\nRun commands from \`skills/${name}\`; do not use an old cached Publisher.\nThe test LP is ${testSiteUrl}; the Worker remains ${testWorkerUrl}.\nSkill selection and confirmation stay in the current Agent. No browser-to-local\nbridge is included.\n`);
  const marker = JSON.parse(await fs.readFile(path.join(skill, 'host-adapter.json'), 'utf8'));
  if (marker.host !== spec.marker) throw new Error('Invalid host marker.');
  const files = await inventory(skill);
  if (files.some(({ path: file }) => /\.(?:py|pyc|pyo|test\.mjs|js\.map)$/.test(file))) throw new Error('Unexpected development files.');
  const common = files.filter(({ path: file }) => file !== 'host-adapter.json');
  if (commonRuntime && JSON.stringify(commonRuntime) !== JSON.stringify(common)) throw new Error('Host business runtimes differ.');
  commonRuntime = common;
  await assertTestDefaults(skill);
  const marketplace = JSON.parse(await fs.readFile(path.join(root, 'adapters', spec.host, 'marketplace.json'), 'utf8'));
  marketplace.name = marketplaceName;
  if (marketplace.interface) marketplace.interface.displayName = displayName;
  const entry = marketplace.plugins[0];
  entry.name = name; entry.version = version;
  entry.source = spec.host === 'codex' ? { source: 'local', path: `./plugins/${name}` } : `./plugins/${name}`;
  if (entry.description) entry.description = manifest.description;
  await fs.mkdir(path.join(hostRoot, spec.marketplace), { recursive: true });
  await writeJson(path.join(hostRoot, spec.marketplace, 'marketplace.json'), marketplace);
  await writeJson(path.join(hostRoot, 'provenance.json'), { name, version, channel: 'stax-challenge-test',
    baseProductionVersion: candidateVersion, testBaseVersion, sourceCommit, sourceDirty, source,
    host: spec.marker, publicRelease: false,
    endpoints: { siteUrl: testSiteUrl, workerUrl: testWorkerUrl } });
  const archive = `${name}-${spec.host}-${version}.zip`;
  execFileSync('zip', ['-qr', path.join(output, archive), '.'], { cwd: hostRoot });
  const bytes = await fs.readFile(path.join(output, archive));
  builds.push({ host: spec.marker, directory: spec.host, archive,
    sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, skillFileCount: files.length });
}
await writeJson(path.join(output, 'build.json'), { name, version, marketplaceName, sourceCommit,
  sourceDirty, source, publicRelease: false, builds });
await fs.writeFile(path.join(output, 'README.md'), `# ${displayName}\n\n${version} — isolated acceptance build, not the public production plugin.\nThree self-contained host packages: codex, claude, cursor.\n\nSee \`docs/challenge-integration-test.md\` in the source checkout for acceptance prompts.\nUse standard ${candidateVersion} for production installation. No npm or official Cursor store publication was performed.\n`);
console.log(JSON.stringify({ ok: true, name, version, marketplaceName, output, builds }, null, 2));

function nextPatchVersion(versionValue) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(versionValue));
  if (!match) throw new Error(`Production version must be stable semver: ${versionValue}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

async function rewriteTestDefaults(skill) {
  await replaceExact(
    path.join(skill, 'creator/scripts/publish-config.mjs'),
    "export const DEFAULT_SITE_URL = 'https://taku.ai';",
    `export const DEFAULT_SITE_URL = '${testSiteUrl}';`,
  );
  await replaceExact(
    path.join(skill, 'node_modules/@taku/publisher-runtime/dist/browser-auth.js'),
    "export const DEFAULT_SITE_URL = 'https://taku.ai';",
    `export const DEFAULT_SITE_URL = '${testSiteUrl}';`,
  );
}

async function replaceExact(file, expected, replacement) {
  const sourceText = await fs.readFile(file, 'utf8');
  if (sourceText.split(expected).length !== 2) {
    throw new Error(`Expected exactly one test-build replacement in ${path.relative(root, file)}.`);
  }
  await fs.writeFile(file, sourceText.replace(expected, replacement));
}

async function assertTestDefaults(skill) {
  const creatorConfig = await fs.readFile(path.join(skill, 'creator/scripts/publish-config.mjs'), 'utf8');
  const browserAuth = await fs.readFile(path.join(skill,
    'node_modules/@taku/publisher-runtime/dist/browser-auth.js'), 'utf8');
  const runtimeConstants = await fs.readFile(path.join(skill,
    'node_modules/@taku/publisher-runtime/dist/constants.js'), 'utf8');
  if (!creatorConfig.includes(`export const DEFAULT_SITE_URL = '${testSiteUrl}';`)
      || !browserAuth.includes(`export const DEFAULT_SITE_URL = '${testSiteUrl}';`)) {
    throw new Error('Challenge build must use the local test LP.');
  }
  if (!creatorConfig.includes(`export const DEFAULT_WORKER_URL = '${testWorkerUrl}';`)
      || !runtimeConstants.includes(`export const DEFAULT_WORKER_URL = '${testWorkerUrl}';`)) {
    throw new Error('Challenge build must keep the production Worker.');
  }
}
