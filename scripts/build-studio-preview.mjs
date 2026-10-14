import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inventory } from './cursor-installer.mjs';
import { PREVIEW_WORKER, PREVIEW_SITE, PREVIEW_PLUGIN, PREVIEW_SITES_SKILL, replaceExactly } from './studio-preview-channel.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const specs = [
  { host: 'codex', manifest: '.codex-plugin', marketplace: '.agents/plugins' },
  { host: 'claude', manifest: '.claude-plugin', marketplace: '.claude-plugin' },
  { host: 'cursor', manifest: '.cursor-plugin', marketplace: '.cursor-plugin' },
];

export async function buildStudioPreview({ root = repository, commit, sourceDirty = true } = {}) {
  commit ??= execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid source commit.');
  const output = path.join(root, 'dist', 'studio-preview');
  // Never overwrite an installed plugin or a previous generated test package.
  await fs.mkdir(output);
  const results = [];
  for (const spec of specs) {
    const hostRoot = path.join(output, spec.host);
    const plugin = path.join(hostRoot, 'plugins', PREVIEW_PLUGIN);
    const source = path.join(root, 'dist/plugins', spec.host, 'taku-publisher');
    await fs.cp(source, plugin, { recursive: true, errorOnExist: true, force: false });
    const manifestFile = path.join(plugin, spec.manifest, 'plugin.json');
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    if (manifest.name !== 'taku-publisher') throw new Error('Unexpected adapter identity.');
    manifest.name = PREVIEW_PLUGIN;
    manifest.version = `${manifest.version}-studio-preview.${commit.slice(0, 12)}`;
    manifest.description = 'Studio-preview testing: isolated Card and Site publishing.';
    if (Array.isArray(manifest.skills)) manifest.skills = manifest.skills.map(value => value.replace(/taku-publisher/g, PREVIEW_PLUGIN).replace(/taku-sites/g, PREVIEW_SITES_SKILL));
    if (manifest.interface) {
      manifest.interface.displayName = 'Taku Studio Preview';
      manifest.interface.shortDescription = 'Test Cards and Sites with the isolated backend.';
      manifest.interface.defaultPrompt = [`Use $${PREVIEW_PLUGIN} or $${PREVIEW_SITES_SKILL} to test publishing in studio-preview.`];
    }
    await writeJson(manifestFile, manifest);
    for (const [oldName, newName] of [['taku-publisher', PREVIEW_PLUGIN], ['taku-sites', PREVIEW_SITES_SKILL]]) {
      const skill = path.join(plugin, 'skills', newName);
      await fs.rename(path.join(plugin, 'skills', oldName), skill);
      await rewriteSkill(skill, oldName, newName, manifest.version);
    }
    const hostAdapter = path.join(plugin, 'host-adapter.json');
    const adapter = JSON.parse(await fs.readFile(hostAdapter, 'utf8'));
    adapter.skill = PREVIEW_PLUGIN;
    await writeJson(hostAdapter, adapter);
    const marketplaceDirectory = path.join(hostRoot, spec.marketplace);
    await fs.mkdir(marketplaceDirectory, { recursive: true });
    await writeJson(path.join(marketplaceDirectory, 'marketplace.json'), {
      name: 'taku-studio-preview', interface: { displayName: 'Taku Studio Preview' },
      plugins: [{ name: PREVIEW_PLUGIN, source: spec.host === 'codex'
        ? { source: 'local', path: `./plugins/${PREVIEW_PLUGIN}` } : `./plugins/${PREVIEW_PLUGIN}` }],
    });
    results.push({ host: spec.host, version: manifest.version, files: await inventory(plugin) });
  }
  await writeJson(path.join(output, 'release.json'), { channel: 'studio-preview', sourceCommit: commit, sourceDirty,
    workerUrl: PREVIEW_WORKER, siteUrl: PREVIEW_SITE, plugins: results });
  return { output, plugins: results };
}

async function rewriteSkill(skill, oldName, newName, version) {
  const skillFile = path.join(skill, 'SKILL.md');
  let text = await fs.readFile(skillFile, 'utf8');
  text = replaceExactly(text, `name: ${oldName}\n`, `name: ${newName}\n`);
  text = text.replace(/\$taku-publisher\b/g, `$${PREVIEW_PLUGIN}`).replace(/\$taku-sites\b/g, `$${PREVIEW_SITES_SKILL}`);
  const frontmatterEnd = text.indexOf('\n---', 4);
  if (frontmatterEnd < 0) throw new Error('Invalid Skill frontmatter.');
  text = text.slice(0, frontmatterEnd + 4) + `\n\nThis is the studio-preview test channel. Always use this Skill's bundled\n\`scripts/taku-publisher.mjs\`; its backend and login are isolated. The test\nwebsite is ${PREVIEW_SITE}. Sign in with a confirmed test account through\n${PREVIEW_SITE}/studio-preview/login, then repeat the original command.\n` + text.slice(frontmatterEnd + 4);
  await fs.writeFile(skillFile, text);
  await writeJson(path.join(skill, 'publisher-version.json'), { name: newName, version, channel: 'studio-preview' });
  try {
    const agentFile = path.join(skill, 'agents/openai.yaml');
    const agent = await fs.readFile(agentFile, 'utf8');
    await fs.writeFile(agentFile, agent.replace(/\$taku-publisher\b/g, `$${PREVIEW_PLUGIN}`).replace(/\$taku-sites\b/g, `$${PREVIEW_SITES_SKILL}`)
      .replace(/display_name: .*$/m, 'display_name: "Taku Studio Preview"'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.copyFile(new URL('./studio-preview-channel.mjs', import.meta.url), path.join(skill, 'scripts/studio-preview-channel.mjs'));
  const entry = path.join(skill, 'scripts/taku-publisher.mjs');
  await fs.writeFile(entry, replaceExactly(await fs.readFile(entry, 'utf8'),
    "import { main } from '@taku/publisher-runtime/cli';",
    "import { configureStudioPreview } from './studio-preview-channel.mjs';\nconfigureStudioPreview(process.argv.slice(2), process.env);\nconst { main } = await import('@taku/publisher-runtime/cli');"));
  const edits = [
    ['node_modules/@taku/publisher-runtime/dist/constants.js', "export const DEFAULT_WORKER_URL = 'https://worker.taku.ai';", `export const DEFAULT_WORKER_URL = '${PREVIEW_WORKER}';`],
    ['node_modules/@taku/publisher-runtime/dist/browser-auth.js', "export const DEFAULT_SITE_URL = 'https://taku.ai';", `export const DEFAULT_SITE_URL = '${PREVIEW_SITE}';`],
    ['node_modules/@taku/publisher-runtime/dist/browser-auth.js', '/profile?${query}', '/stax?${query}'],
    // Test Publisher sessions never consume or renew the production Desktop identity.
    ['node_modules/@taku/publisher-runtime/dist/auth.js', 'if (options.allowDesktopSession === false)', 'if (true /* studio-preview: Desktop fallback disabled */)'],
    ['node_modules/@taku/publisher-runtime/dist/auth.js', 'export async function refreshSession(session, options = {}) {', 'export async function refreshSession(session, options = {}) {\n    return null; /* studio-preview: Desktop refresh disabled */'],
  ];
  if (oldName === 'taku-publisher') edits.push(
    ['creator/scripts/publish-config.mjs', "export const DEFAULT_WORKER_URL = 'https://worker.taku.ai';", `export const DEFAULT_WORKER_URL = '${PREVIEW_WORKER}';`],
    ['creator/scripts/publish-config.mjs', "export const DEFAULT_SITE_URL = 'https://taku.ai';", `export const DEFAULT_SITE_URL = '${PREVIEW_SITE}';`],
  );
  for (const [file, expected, replacement] of edits) {
    const target = path.join(skill, file);
    await fs.writeFile(target, replaceExactly(await fs.readFile(target, 'utf8'), expected, replacement));
  }
  if (oldName === 'taku-publisher') {
    const creatorConfig = path.join(skill, 'creator/scripts/publish-config.mjs');
    await fs.writeFile(creatorConfig, "import { configureStudioPreview } from '../../scripts/studio-preview-channel.mjs';\nconfigureStudioPreview(process.argv.slice(2), process.env);\n" + await fs.readFile(creatorConfig, 'utf8'));
  }
  const markerFile = path.join(skill, 'host-adapter.json');
  const marker = JSON.parse(await fs.readFile(markerFile, 'utf8'));
  if (marker.skill) marker.skill = newName;
  await writeJson(markerFile, marker);
}

async function writeJson(file, value) { await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/codex/stax-site-preview-plugin') {
    throw new Error('Only the studio-preview test branch CI can generate release artifacts.');
  }
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim() !== process.env.GITHUB_SHA) {
    throw new Error('CI source commit mismatch.');
  }
  if (execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim()) throw new Error('CI source must be clean.');
  const result = await buildStudioPreview({ commit: process.env.GITHUB_SHA, sourceDirty: false });
  console.log(JSON.stringify({ output: result.output, hosts: result.plugins.map(plugin => plugin.host), sourceCommit: process.env.GITHUB_SHA }));
}
