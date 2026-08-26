import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  createCreatorPublishPlan,
  loadCreatorPublishPlan,
  nextCreatorPlanAction,
  parseCreatorSelections,
  updateCreatorPublishPlan,
} from '../dist/index.js';

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL('../../../scripts/taku-publisher.mjs', import.meta.url));

const PROJECTS = [{
  id: 'project_skill',
  name: 'Brand Guidelines',
  path: '/tmp/brand-guidelines',
  hosts: ['codex'],
  lastActiveAt: '2026-08-26T00:00:00.000Z',
  signals: ['SKILL.md'],
  routeHint: 'existing-skill',
}, {
  id: 'project_app',
  name: 'Pomodoro Timer',
  path: '/tmp/pomodoro',
  hosts: ['codex'],
  lastActiveAt: '2026-08-25T00:00:00.000Z',
  signals: ['package.json', 'dependency:react', 'dependency:vite'],
  routeHint: 'subapp-candidate',
}];

test('creator publish plan keeps Stax Card first and queues selected projects', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-creator-plan-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = { ...process.env, TAKU_PUBLISHER_HOME: root };
  const now = () => new Date('2026-08-26T12:00:00.000Z');
  const plan = await createCreatorPublishPlan(PROJECTS, [
    { projectId: 'project_skill', target: 'skill' },
    { projectId: 'project_app', target: 'subapp' },
  ], { env, now });

  assert.equal(plan.staxCard.policy, 'publish_first');
  assert.equal(plan.staxCard.waitsForProjects, false);
  assert.deepEqual(plan.projects.map((item) => [item.projectId, item.target, item.status]), [
    ['project_skill', 'skill', 'queued'],
    ['project_app', 'subapp', 'queued'],
  ]);
  assert.equal(nextCreatorPlanAction(plan).action, 'review_and_publish_stax_card');
  assert.deepEqual(await loadCreatorPublishPlan(plan.planId, env), plan);

  const afterCard = await updateCreatorPublishPlan(plan.planId, { cardStatus: 'published' }, { env, now });
  assert.equal(nextCreatorPlanAction(afterCard).action, 'inspect_and_publish_skill');
  const afterSkill = await updateCreatorPublishPlan(plan.planId, {
    projectId: 'project_skill',
    projectStatus: 'completed',
    remoteItemId: 'item_skill',
  }, { env, now });
  assert.equal(nextCreatorPlanAction(afterSkill).action, 'assess_subapp');
});

test('creator selections parse natural queue targets and reject invalid targets', () => {
  assert.deepEqual(parseCreatorSelections('project_skill=skill, project_app=subapp'), [
    { projectId: 'project_skill', target: 'skill' },
    { projectId: 'project_app', target: 'subapp' },
  ]);
  assert.throws(
    () => parseCreatorSelections('project_app=workflow'),
    (error) => error?.code === 'invalid_creator_project_target',
  );
});

test('creator plan rejects stale project selections', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-creator-plan-stale-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(
    createCreatorPublishPlan(PROJECTS, [{ projectId: 'project_missing', target: 'skill' }], {
      env: { ...process.env, TAKU_PUBLISHER_HOME: root },
    }),
    (error) => error?.code === 'stale_creator_project_selection',
  );
});

test('creator-plan CLI accepts multi-target selection flags and persists the queue', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-creator-plan-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'pomodoro');
  const codexHome = path.join(root, '.codex');
  const sessionDir = path.join(codexHome, 'sessions', '2026', '08', '26');
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
    name: 'pomodoro',
    dependencies: { react: '19.0.0', vite: '7.0.0' },
  }));
  await fs.writeFile(path.join(sessionDir, 'session.jsonl'), `${JSON.stringify({
    timestamp: '2026-08-26T12:00:00.000Z',
    payload: { cwd: workspace },
  })}\n`);
  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    TAKU_PUBLISHER_HOME: path.join(root, '.taku-publisher'),
  };
  const discovered = JSON.parse((await execFileAsync(process.execPath, [
    CLI,
    'project-discover',
    '--host', 'codex',
    '--max-projects', '1',
  ], { env })).stdout);
  const projectId = discovered.projects[0].id;
  const created = JSON.parse((await execFileAsync(process.execPath, [
    CLI,
    'creator-plan',
    '--select', `${projectId}=subapp`,
    '--host', 'codex',
    '--max-projects', '1',
  ], { env })).stdout);

  assert.equal(created.status, 'creator_publish_plan_ready');
  assert.equal(created.action_type, 'review_and_publish_stax_card');
  assert.equal(created.plan.projects[0].target, 'subapp');
  const shown = JSON.parse((await execFileAsync(process.execPath, [
    CLI,
    'creator-plan-show',
    '--plan-id', created.plan.planId,
  ], { env })).stdout);
  assert.equal(shown.plan.planId, created.plan.planId);
});
