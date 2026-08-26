import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  discoverRecentProjects,
  initializeCreator,
} from '../dist/index.js';

test('creator-init returns projects and login guidance without requiring a Web session', async () => {
  const projects = [{
    id: 'project_1',
    name: 'Pomodoro Timer',
    path: '/tmp/pomodoro',
    hosts: ['codex'],
    lastActiveAt: '2026-08-26T00:00:00.000Z',
    signals: ['package.json'],
    routeHint: 'subapp-candidate',
  }];
  const result = await initializeCreator({ siteUrl: 'https://taku.example.test/' }, {
    getAuthStatus: async () => ({ authenticated: false, source: 'missing' }),
    discoverProjects: async () => projects,
    createEditor: async () => ({
      editorUrl: 'http://127.0.0.1:7331/?token=<local-editor-token>',
    }),
  });

  assert.equal(result.authenticated, false);
  assert.equal(result.auth.source, 'missing');
  assert.equal('session_path' in result.auth, false);
  assert.equal(result.projectCount, 1);
  assert.deepEqual(result.projects, projects);
  assert.deepEqual(result.projectChoices, [{
    id: 'project_1',
    name: 'Pomodoro Timer',
    routeHint: 'subapp-candidate',
    recommendedTarget: 'subapp',
    targetOptions: ['skill', 'subapp'],
    eligibilityValidatedAfterSelection: true,
  }]);
  assert.equal(result.publishPlan.multipleSelection, true);
  assert.equal(result.publishPlan.staxCardPolicy, 'publish_first');
  assert.equal(result.publishPlan.subAppsDoNotBlockStaxCard, true);
  assert.equal(result.staxCard.editorUrl, 'http://127.0.0.1:7331/?token=<local-editor-token>');
  assert.equal(result.staxCard.editorReady, true);
  assert.equal(result.staxCard.webEditorUrl, 'https://taku.example.test/profile?source=taku_creator&intent=publish_stax_card');
  assert.equal(result.staxCard.publicUrl, null);
  assert.equal(result.creatorProfile.needsLogin, true);
  assert.equal(result.creatorProfile.url, null);
  assert.equal(result.creatorProfile.loginUrl, 'https://taku.example.test/profile?source=taku_creator&intent=creator_init');
});

test('creator-init returns separate Creator Profile and Stax Card URLs after login', async () => {
  const result = await initializeCreator({ siteUrl: 'https://taku.example.test' }, {
    getAuthStatus: async () => ({ authenticated: true, source: 'publisher_session' }),
    getAuth: async () => ({
      token: '<publisher-token>',
      source: 'publisher_session',
      iconToken: '',
      scopes: ['creator.card.write'],
      refreshed: false,
    }),
    discoverProjects: async () => [],
    fetchProfile: async () => ({ data: { profile: { username: '@alice' } } }),
  });

  assert.equal(result.authenticated, true);
  assert.equal(result.staxCard.publicUrl, 'https://taku.example.test/stax/alice');
  assert.equal(result.creatorProfile.url, 'https://taku.example.test/profile/alice');
  assert.equal(result.creatorProfile.needsLogin, false);
  assert.equal(result.creatorProfile.loginUrl, null);
});

test('project discovery reads recent Codex workspace metadata without reading source files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-creator-init-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'pomodoro');
  const codexHome = path.join(root, '.codex');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '26');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'pomodoro-timer',
    dependencies: { react: '19.0.0', vite: '7.0.0' },
  }));
  await fs.writeFile(path.join(sessionDir, 'session.jsonl'), [
    JSON.stringify({ timestamp: '2026-08-26T12:00:00.000Z', payload: { cwd: workspace } }),
    JSON.stringify({ type: 'message', content: 'not inspected as project source' }),
    '',
  ].join('\n'));

  const projects = await discoverRecentProjects({
    host: 'codex',
    homeDir: root,
    codexHome,
    maxProjects: 5,
  });
  const realWorkspace = await fs.realpath(workspace);

  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'pomodoro-timer');
  assert.equal(projects[0].path, realWorkspace);
  assert.equal(projects[0].routeHint, 'subapp-candidate');
  assert.deepEqual(projects[0].hosts, ['codex']);
});
