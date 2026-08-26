import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  defaultToolRoots,
  resolveCliHomes,
  scanUsedTools,
  walkForSkillFiles,
} from './scan.mjs';

test('walkForSkillFiles stays within the configured result budget', async (t) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-skill-limit-'));
  t.after(() => fs.rm(sandbox, { force: true, recursive: true }));

  await Promise.all(['one', 'two'].map(async (name) => {
    const directory = path.join(sandbox, name);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'SKILL.md'), `# ${name}\n`);
  }));

  const files = await walkForSkillFiles(sandbox, { maxDepth: 4, maxFiles: 1 });
  assert.equal(files.length, 1);
});

test('resolves inventory roots from the actual CLI configuration', async (t) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-cli-roots-'));
  t.after(() => fs.rm(sandbox, { force: true, recursive: true }));
  const homeDir = path.join(sandbox, 'home');
  const codexHome = path.join(sandbox, 'custom-codex');
  const claudeConfigDir = path.join(sandbox, 'custom-claude');
  const env = { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeConfigDir };

  const homes = resolveCliHomes({ homeDir, env });
  assert.equal(homes.codex, codexHome);
  assert.equal(homes.claude, claudeConfigDir);

  const roots = defaultToolRoots({ homeDir, env });
  assert.equal(roots.find((root) => root.source === 'codex')?.path, path.join(codexHome, 'skills'));
  assert.equal(roots.find((root) => root.source === 'claude-code')?.path, path.join(claudeConfigDir, 'skills'));
  assert.deepEqual(
    defaultToolRoots({ homeDir, env, invokingHost: 'codex' }).map((root) => root.source),
    ['codex'],
  );
});

test('scans standalone and plugin-declared App and Skill resources from CODEX_HOME', async (t) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-codex-inventory-'));
  t.after(() => fs.rm(sandbox, { force: true, recursive: true }));
  const homeDir = path.join(sandbox, 'home');
  const codexHome = path.join(sandbox, 'custom-codex');
  const claudeConfigDir = path.join(sandbox, 'custom-claude');
  const pluginRoot = path.join(codexHome, 'plugins', 'cache', 'example', 'demo', '1.0.0');
  const stalePluginRoot = path.join(codexHome, 'plugins', 'cache', 'example', 'stale', '1.0.0');

  await fs.mkdir(path.join(homeDir, '.codex', 'skills', 'wrong-home'), { recursive: true });
  await fs.writeFile(
    path.join(homeDir, '.codex', 'skills', 'wrong-home', 'SKILL.md'),
    '---\nname: Wrong Home Skill\n---\n',
  );
  await fs.mkdir(path.join(codexHome, 'skills', 'direct'), { recursive: true });
  await fs.writeFile(
    path.join(codexHome, 'skills', 'direct', 'SKILL.md'),
    '---\nname: Direct Skill\ndescription: Directly installed.\n---\n',
  );
  await fs.mkdir(path.join(claudeConfigDir, 'skills', 'claude-only'), { recursive: true });
  await fs.writeFile(
    path.join(claudeConfigDir, 'skills', 'claude-only', 'SKILL.md'),
    '---\nname: Claude Only Skill\n---\n',
  );
  await fs.writeFile(
    path.join(codexHome, 'config.toml'),
    '[plugins."demo@example"]\nenabled = true\n\n[plugins."stale@example"]\nenabled = false\n',
  );
  await fs.mkdir(path.join(pluginRoot, '.codex-plugin'), { recursive: true });
  await fs.mkdir(path.join(pluginRoot, 'skills', 'plugin-skill'), { recursive: true });
  await fs.writeFile(
    path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name: 'demo', skills: './skills/', apps: './.app.json' }),
  );
  await fs.writeFile(
    path.join(pluginRoot, 'skills', 'plugin-skill', 'SKILL.md'),
    '---\nname: Plugin Skill\ndescription: Bundled with a plugin.\n---\n',
  );
  await fs.writeFile(
    path.join(pluginRoot, '.app.json'),
    JSON.stringify({ apps: { demo_app: { id: 'connector-demo', required: true } } }),
  );
  await fs.mkdir(path.join(stalePluginRoot, '.codex-plugin'), { recursive: true });
  await fs.writeFile(
    path.join(stalePluginRoot, '.codex-plugin', 'plugin.json'),
    JSON.stringify({ name: 'stale', apps: './.app.json' }),
  );
  await fs.writeFile(
    path.join(stalePluginRoot, '.app.json'),
    JSON.stringify({ apps: { stale_app: { id: 'connector-stale' } } }),
  );

  const result = await scanUsedTools(sandbox, {
    homeDir,
    env: { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeConfigDir },
    invokingHost: 'codex',
  });
  assert.equal(result.tools.some((item) => item.type === 'skill' && item.name === 'Direct Skill'), true);
  assert.equal(result.tools.some((item) => item.type === 'skill' && item.name === 'Plugin Skill'), true);
  assert.equal(result.tools.some((item) => item.type === 'app' && item.name === 'demo_app'), true);
  assert.equal(result.tools.some((item) => item.name === 'Wrong Home Skill'), false);
  assert.equal(result.tools.some((item) => item.name === 'Claude Only Skill'), false);
  assert.equal(result.tools.some((item) => item.name === 'stale_app'), false);
});

test('keeps structured tools and MCP servers scoped to the invoking CLI', async (t) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-invoking-cli-inventory-'));
  t.after(() => fs.rm(sandbox, { force: true, recursive: true }));
  const homeDir = path.join(sandbox, 'home');
  const codexHome = path.join(sandbox, 'codex-home');
  const claudeHome = path.join(sandbox, 'claude-home');
  const takuHome = path.join(sandbox, 'taku-home');
  const cursorHome = path.join(sandbox, 'cursor-home');

  await fs.mkdir(path.join(codexHome, 'agents'), { recursive: true });
  await fs.mkdir(path.join(codexHome, 'commands'), { recursive: true });
  await fs.mkdir(path.join(claudeHome, 'agents'), { recursive: true });
  await fs.mkdir(path.join(claudeHome, 'commands'), { recursive: true });
  await fs.mkdir(path.join(takuHome, 'workflows'), { recursive: true });
  await fs.mkdir(cursorHome, { recursive: true });
  await fs.mkdir(path.join(sandbox, '.codex', 'commands'), { recursive: true });
  await fs.mkdir(path.join(sandbox, '.claude', 'commands'), { recursive: true });
  await fs.writeFile(path.join(codexHome, 'agents', 'codex-agent.toml'), 'name = "Codex Agent"\n');
  await fs.writeFile(path.join(codexHome, 'commands', 'codex-command.md'), '# Codex Command\n');
  await fs.writeFile(path.join(codexHome, 'config.toml'), '[mcp_servers.codex_server]\ncommand = "example"\n');
  await fs.writeFile(path.join(claudeHome, 'agents', 'claude-agent.md'), '# Claude Agent\n');
  await fs.writeFile(path.join(claudeHome, 'commands', 'claude-command.md'), '# Claude Command\n');
  await fs.writeFile(
    path.join(claudeHome, 'settings.json'),
    JSON.stringify({ mcpServers: { claude_server: { command: 'example' } } }),
  );
  await fs.writeFile(path.join(takuHome, 'workflows', 'taku-workflow.md'), '# Taku Workflow\n');
  await fs.writeFile(path.join(sandbox, '.codex', 'commands', 'workspace-codex.md'), '# Workspace Codex\n');
  await fs.writeFile(path.join(sandbox, '.claude', 'commands', 'workspace-claude.md'), '# Workspace Claude\n');
  await fs.writeFile(
    path.join(cursorHome, 'mcp.json'),
    JSON.stringify({ mcpServers: { cursor_server: { command: 'example' } } }),
  );

  const result = await scanUsedTools(sandbox, {
    homeDir,
    env: {
      CODEX_HOME: codexHome,
      CLAUDE_CONFIG_DIR: claudeHome,
      TAKU_HOME: takuHome,
      CURSOR_HOME: cursorHome,
    },
    invokingHost: 'codex',
  });

  assert.equal(result.tools.some((item) => item.name === 'Codex Agent'), true);
  assert.equal(result.tools.some((item) => item.name === 'Codex Command'), true);
  assert.equal(result.tools.some((item) => item.name === 'codex_server'), true);
  assert.equal(result.tools.some((item) => item.name === 'Workspace Codex'), true);
  assert.equal(result.tools.some((item) => item.name === 'Claude Agent'), false);
  assert.equal(result.tools.some((item) => item.name === 'Claude Command'), false);
  assert.equal(result.tools.some((item) => item.name === 'Workspace Claude'), false);
  assert.equal(result.tools.some((item) => item.name === 'claude_server'), false);
  assert.equal(result.tools.some((item) => item.name === 'Taku Workflow'), false);
  assert.equal(result.tools.some((item) => item.name === 'cursor_server'), false);
  assert.equal(result.roots.some((root) => /^claude-|^taku-|^cursor-/.test(root.source)), false);
});
