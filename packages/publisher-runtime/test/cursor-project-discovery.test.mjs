import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  discoverRecentProjects,
  normalizeProjectHost,
  resolveCursorUserDir,
} from '../dist/project-discovery.js';

test('discovers Cursor workspaceStorage projects without reading project source', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-cursor-projects-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'cursor-project');
  const cursorUserDir = path.join(root, 'Cursor', 'User');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.join(cursorUserDir, 'workspaceStorage', 'abc'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'cursor-project',
    dependencies: { vite: '7.0.0', react: '19.0.0' },
  }));
  await fs.writeFile(path.join(cursorUserDir, 'workspaceStorage', 'abc', 'workspace.json'), JSON.stringify({
    folder: `file://${workspace}`,
    lastUpdatedAt: '2026-09-10T10:00:00.000Z',
  }));

  const projects = await discoverRecentProjects({
    host: 'cursor',
    homeDir: root,
    cursorUserDir,
    maxProjects: 5,
  });

  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'cursor-project');
  assert.equal(projects[0].hosts[0], 'cursor');
  assert.equal(projects[0].routeHint, 'subapp-candidate');
  assert.equal(projects[0].path, await fs.realpath(workspace));
});

test('supports explicit projects and platform-specific Cursor paths', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-explicit-project-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'manual');
  await fs.mkdir(workspace, { recursive: true });
  assert.equal(normalizeProjectHost('CURSOR'), 'cursor');
  assert.equal(
    resolveCursorUserDir(root, 'darwin', {}),
    path.join(root, 'Library', 'Application Support', 'Cursor', 'User'),
  );
  const projects = await discoverRecentProjects({
    host: 'other',
    homeDir: root,
    explicitProjects: [workspace],
  });
  assert.equal(projects.length, 1);
  assert.deepEqual(projects[0].hosts, ['other']);
});
