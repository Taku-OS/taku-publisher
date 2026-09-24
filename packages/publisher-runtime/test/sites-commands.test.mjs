import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatch } from '../dist/cli.js';

function args(command, flags = {}) {
  return { command, flags: new Map(Object.entries(flags)), rest: [] };
}

test('Site template validates, builds, and serves a bounded local preview', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-sites-command-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'site');
  const created = await dispatch(args('sites-init', { project }));
  assert.equal(created.status, 'sites_project_created');
  const validated = await dispatch(args('sites-validate', { project }));
  assert.equal(validated.status, 'sites_valid');
  const built = await dispatch(args('sites-build', { project }));
  assert.equal(built.status, 'sites_built');
  assert.equal(built.object_count, 2);
  assert.equal(built.artifact_digest, null);
  const preview = await dispatch(args('sites-preview', { project, 'ttl-seconds': '1' }));
  assert.equal(preview.status, 'sites_preview_ready');
  const response = await fetch(preview.url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /New Taku Site/);
  assert.equal(preview.scope, 'local_static_assets');
});
