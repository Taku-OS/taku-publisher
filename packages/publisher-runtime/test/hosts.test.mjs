import assert from 'node:assert/strict';
import * as path from 'node:path';
import test from 'node:test';

import {
  normalizeSkillHost,
  skillHostDefinition,
  skillInstallRoot,
} from '../dist/index.js';

test('normalizes supported Agent Skill hosts and aliases', () => {
  assert.equal(normalizeSkillHost('OpenCode'), 'opencode');
  assert.equal(normalizeSkillHost('open-code'), 'opencode');
  assert.equal(normalizeSkillHost('claude'), 'claude-code');
  assert.equal(normalizeSkillHost('portable'), 'agent-skills');
  assert.equal(skillHostDefinition('opencode').supportsPluginPackage, false);
  assert.throws(
    () => normalizeSkillHost('unknown-host'),
    (error) => error?.code === 'unsupported_skill_host',
  );
});

test('resolves host-specific global Skill roots', () => {
  const homeDir = path.resolve('/tmp/taku-host-home');
  assert.equal(
    skillInstallRoot('opencode', { homeDir, env: {} }),
    path.join(homeDir, '.config', 'opencode', 'skills'),
  );
  assert.equal(
    skillInstallRoot('agent-skills', { homeDir, env: {} }),
    path.join(homeDir, '.agents', 'skills'),
  );
  assert.equal(
    skillInstallRoot('opencode', {
      homeDir,
      env: { XDG_CONFIG_HOME: path.join(homeDir, 'xdg') },
    }),
    path.join(homeDir, 'xdg', 'opencode', 'skills'),
  );
  assert.equal(
    skillInstallRoot('cursor', {
      homeDir,
      env: { CURSOR_HOME: path.join(homeDir, 'custom-cursor') },
    }),
    path.join(homeDir, 'custom-cursor', 'skills'),
  );
});

test('rejects an unsafe host home override', () => {
  assert.throws(
    () => skillInstallRoot('opencode', {
      homeDir: path.resolve('/tmp/taku-host-home'),
      env: { OPENCODE_CONFIG_DIR: path.parse(process.cwd()).root },
    }),
    (error) => error?.code === 'unsafe_install_target',
  );
});
