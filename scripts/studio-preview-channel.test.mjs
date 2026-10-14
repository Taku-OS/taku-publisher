import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { configureStudioPreview, PREVIEW_WORKER, PREVIEW_SITE, PREVIEW_PLUGIN, PREVIEW_SITES_SKILL } from './studio-preview-channel.mjs';
import { buildStudioPreview } from './build-studio-preview.mjs';

test('test channel refuses production/staging endpoints and external credential arguments', () => {
  for (const args of [ ['--worker-url', 'https://worker.taku.ai'], ['--worker-url=https://taku-workers-staging.takuos.workers.dev'], ['--site-url', 'https://taku.ai'], ['--auth-site-url', 'https://auth.taku.ai'], ['--bearer-token', 'fixture'], ['--token-env', 'ANOTHER_TOKEN'] ]) {
    assert.throws(() => configureStudioPreview(args, {}, '/fixture'), /refused|another environment/);
  }
});
test('fixed test URLs and every session source are isolated without modifying HOME or existing files', () => {
  const env = { HOME: '/unchanged', TAKU_BEARER_TOKEN: 'fixture', SUPABASE_ACCESS_TOKEN: 'fixture', TAKU_HOME: '/production', TAKU_PUBLISHER_SESSION_PATH: '/production/session.json' };
  configureStudioPreview(['--worker-url', PREVIEW_WORKER, '--site-url', PREVIEW_SITE], env, '/fixture');
  assert.equal(env.HOME, '/unchanged'); assert.equal(env.TAKU_BEARER_TOKEN, undefined); assert.equal(env.SUPABASE_ACCESS_TOKEN, undefined);
  assert.equal(env.TAKU_PUBLISHER_HOME, '/fixture/.taku/studio-preview/publisher');
  assert.equal(env.TAKU_SESSION_PATH, '/fixture/.taku/studio-preview/desktop-disabled/session.json');
  assert.equal(env.TAKU_PUBLISHER_SESSION_PATH, '/fixture/.taku/studio-preview/publisher/session.json');
  assert.equal(env.TAKU_AUTH_SITE_URL, PREVIEW_SITE);
});
test('all adapters retain Sites and use distinct identities; generated test rewriting leaves base adapters intact', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-plugin-fixture-'));
  try {
    for (const [host, manifest] of [['codex', '.codex-plugin'], ['claude', '.claude-plugin'], ['cursor', '.cursor-plugin']]) {
      const plugin = path.join(root, 'dist/plugins', host, 'taku-publisher');
      const write = async (file, text) => { const target = path.join(plugin, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text); };
      await write(`${manifest}/plugin.json`, JSON.stringify({ name: 'taku-publisher', version: '0.4.0', skills: ['./skills/taku-publisher', './skills/taku-sites'] }));
      await write('host-adapter.json', '{}');
      for (const skill of ['taku-publisher', 'taku-sites']) {
        const p = `skills/${skill}/`;
        await write(`${p}SKILL.md`, `---\nname: ${skill}\ndescription: fixture\n---\n\nFixture\n`);
        await write(`${p}host-adapter.json`, '{}');
        await write(`${p}scripts/taku-publisher.mjs`, "import { main } from '@taku/publisher-runtime/cli';\n");
        await write(`${p}node_modules/@taku/publisher-runtime/dist/constants.js`, "export const DEFAULT_WORKER_URL = 'https://worker.taku.ai';\n");
        await write(`${p}node_modules/@taku/publisher-runtime/dist/browser-auth.js`, "export const DEFAULT_SITE_URL = 'https://taku.ai';\n// login: /profile?${query}\n");
        await write(`${p}node_modules/@taku/publisher-runtime/dist/auth.js`, 'if (options.allowDesktopSession === false) {}\nexport async function refreshSession(session, options = {}) {}\n');
        if (skill === 'taku-publisher') await write(`${p}creator/scripts/publish-config.mjs`, "export const DEFAULT_WORKER_URL = 'https://worker.taku.ai';\nexport const DEFAULT_SITE_URL = 'https://taku.ai';\n");
      }
    }
    const result = await buildStudioPreview({ root, commit: 'a'.repeat(40) });
    assert.equal(result.plugins.length, 3);
    for (const host of ['codex', 'claude', 'cursor']) {
      const plugin = path.join(result.output, host, 'plugins', PREVIEW_PLUGIN);
      for (const skill of [PREVIEW_PLUGIN, PREVIEW_SITES_SKILL]) {
        const base = path.join(plugin, 'skills', skill);
        assert.match(await fs.readFile(path.join(base, 'SKILL.md'), 'utf8'), new RegExp(`name: ${skill}`));
        assert.match(await fs.readFile(path.join(base, 'scripts/taku-publisher.mjs'), 'utf8'), /configureStudioPreview/);
        assert.match(await fs.readFile(path.join(base, 'node_modules/@taku/publisher-runtime/dist/auth.js'), 'utf8'), /Desktop fallback disabled/);
        assert.match(await fs.readFile(path.join(base, 'node_modules/@taku/publisher-runtime/dist/browser-auth.js'), 'utf8'), /\/stax\?\$\{query\}/);
      }
      const standard = await fs.readFile(path.join(root, 'dist/plugins', host, 'taku-publisher/skills/taku-publisher/creator/scripts/publish-config.mjs'), 'utf8');
      assert.match(standard, /https:\/\/worker.taku.ai/);
    }
    await assert.rejects(buildStudioPreview({ root, commit: 'a'.repeat(40) }), /EEXIST/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
