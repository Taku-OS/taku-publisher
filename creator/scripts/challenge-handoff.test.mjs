import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { dispatch, loadState, saveState, setTreeWritable, PublisherError } from '#taku-publisher-runtime';
import { writePrivateState } from './draft-state.mjs';
import {
  challengeCandidatesFromCreationChoices, challengeCloudStudioResult, challengeHandoffPathFor, challengePublisherState,
  createChallengeHandoff, publicChallengeHandoffState, readChallengeHandoff,
  selectChallengeSkill, skipChallengeSkill, withChallengeLock, writeChallengeHandoff,
} from './challenge-handoff.mjs';
import { prepareChallengeSkill } from './challenge-publisher-job.mjs';

async function fixture(t, ids = ['one', 'two']) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-challenge-test-'));
  const previous = process.env.TAKU_PUBLISHER_HOME;
  process.env.TAKU_PUBLISHER_HOME = path.join(root, 'publisher');
  t.after(async () => {
    if (previous === undefined) delete process.env.TAKU_PUBLISHER_HOME;
    else process.env.TAKU_PUBLISHER_HOME = previous;
    await setTreeWritable(root).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });
  const draft = path.join(root, 'card.json'), inventory = [];
  await fs.writeFile(draft, JSON.stringify({ studio: 'existing-production-card' }));
  for (const id of ids) {
    const source = path.join(root, `skill-${id}`);
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'SKILL.md'), `---\nname: fixture-skill\ndescription: Formats a bounded local report.\n---\n# Report\nFormat one report.\n`);
    inventory.push({ id, name: id, type: 'skill', localPath: source, publishable: true });
  }
  await writePrivateState(draft, { items: inventory });
  const state = await createChallengeHandoff(draft, {
    candidates: inventory.map(({ id, name }) => ({ candidateId: id, name, type: 'skill' })),
    workerUrl: 'https://worker.taku.ai', siteUrl: 'https://taku.ai',
  });
  return { root, draft, state, inventory };
}

const invoke = (command, id, flags = {}) => dispatch({ command,
  flags: new Map(Object.entries({ 'draft-id': id, ...flags })), rest: [] });

async function reviewedFixture(t) {
  const f = await fixture(t);
  const selected = await selectChallengeSkill(f.draft, 'one');
  const paused = await prepareChallengeSkill(f.draft);
  assert.equal(paused.status, 'awaiting_deep_scan');
  const template = paused.publisherResult.dispositions_template_path;
  const review = JSON.parse(await fs.readFile(template, 'utf8'));
  // Only this known, documentation-only test fixture is auto-approved.
  review.full_review_completed = true;
  for (const row of review.dispositions) {
    row.decision = 'allow'; row.rationale = 'Reviewed documentation-only test fixture.';
  }
  const reviewPath = path.join(f.root, 'review.json');
  await fs.writeFile(reviewPath, JSON.stringify(review));
  await invoke('apply-review', selected.publisherDraftId, { dispositions: reviewPath });
  const packaged = await prepareChallengeSkill(f.draft);
  assert.equal(packaged.status, 'packaged');
  return { ...f, selected, packaged };
}

test('Challenge offers only unpublished Skills, with bounded IDs and no paths', () => {
  const candidates = challengeCandidatesFromCreationChoices({ displayedCreations: [
    { id: 'one', name: 'Safe', type: 'skill', localPath: '/private/source' },
    { id: 'app', name: 'App', type: 'subapp' },
    { id: 'old', name: 'Old', type: 'skill', published: true },
    { id: 'bad', name: 'Bad', type: 'skill', publishable: false },
  ], hiddenCreations: [{ id: 'one', name: 'Duplicate', type: 'skill' }], madeCreations: {} });
  assert.deepEqual(candidates, [{ candidateId: 'one', name: 'Safe', type: 'skill' }]);
});

test('Challenge context is private, reused, and never changes the Card', async (t) => {
  const { draft, state } = await fixture(t);
  const before = await fs.readFile(draft);
  const next = await createChallengeHandoff(draft, { candidates: [], workerUrl: 'https://other.invalid' });
  assert.deepEqual(next, JSON.parse(JSON.stringify(state)));
  assert.deepEqual(await fs.readFile(draft), before);
  if (process.platform !== 'win32') assert.equal((await fs.stat(challengeHandoffPathFor(draft))).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(publicChallengeHandoffState(state)).includes('registeredPath'), false);
  assert.equal(JSON.stringify(publicChallengeHandoffState(state)).includes('skill-one'), false);
});

test('Missing registered sources are not offered and do not request selection', async (t) => {
  const { draft } = await fixture(t, []);
  const result = publicChallengeHandoffState(await readChallengeHandoff(draft));
  assert.equal(result.status, 'no_candidates'); assert.equal(result.requires_action, false);
});

test('Challenge review preserves its exact URL and does not restart a skipped or selected Skill', async (t) => {
  const { state } = await fixture(t);
  const cloud = {
    editorUrl: 'http://localhost:3001/stax?review=1&launch=exact',
    studioUrl: 'https://worker.taku.ai/stax/studio/editor?launch=exact',
    cloudDraft: true,
  };
  assert.equal(challengeCloudStudioResult(cloud, state).action_type, 'select_local_skill_or_skip');
  for (const status of ['skipped', 'no_candidates']) {
    const result = challengeCloudStudioResult(cloud, { ...state, status });
    assert.equal(result.editorUrl, cloud.editorUrl); assert.equal(result.requires_action, false);
    assert.equal(result.primaryAction, 'open_stax_challenge_review');
  }
  const result = challengeCloudStudioResult(cloud, { ...state, status: 'selected' }, { status: 'awaiting_deep_scan' });
  assert.equal(result.action_type, 'perform_semantic_review'); assert.equal(result.editorUrl, cloud.editorUrl);
  assert.equal(result.studioUrl, cloud.studioUrl);
});

test('Only one offered Skill may be selected; repeated selection is idempotent', async (t) => {
  const { draft, inventory } = await fixture(t);
  await assert.rejects(selectChallengeSkill(draft, 'unknown'), /inventory/);
  const selected = await selectChallengeSkill(draft, 'one');
  assert.equal(selected.selectedSkill.sourcePath, await fs.realpath(inventory[0].localPath));
  assert.equal(JSON.stringify(selected).includes('skill-two'), false);
  assert.equal((await selectChallengeSkill(draft, 'one')).publisherDraftId, selected.publisherDraftId);
  await assert.rejects(selectChallengeSkill(draft, 'two'), /already/);
});

test('Prototype-like IDs do not inherit an unregistered source', async (t) => {
  const { draft } = await fixture(t, ['__proto__']);
  const result = await selectChallengeSkill(draft, '__proto__');
  assert.equal(result.selectedToolId, '__proto__');
  await assert.rejects(selectChallengeSkill(draft, 'constructor'), /inventory/);
});

test('A registered symlink cannot be retargeted after the Card inventory is pinned', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX symlink fixture');
  const { root, draft, state, inventory } = await fixture(t);
  const link = path.join(root, 'selected-link');
  await fs.symlink(inventory[0].localPath, link);
  state.sources.one.registeredPath = link;
  await writeChallengeHandoff(draft, state);
  await fs.unlink(link); await fs.symlink(inventory[1].localPath, link);
  await assert.rejects(selectChallengeSkill(draft, 'one'), /source changed/);
});

test('Skip is terminal and does not start a Publisher draft', async (t) => {
  const { draft, state } = await fixture(t);
  const result = await skipChallengeSkill(draft);
  assert.equal(result.status, 'skipped'); assert.equal(result.requires_action, false);
  assert.equal(await challengePublisherState(state), null);
  await assert.rejects(selectChallengeSkill(draft, 'one'), /active/);
});

test('Concurrent operations refuse the lock instead of deleting another operation', async (t) => {
  const { draft } = await fixture(t);
  await withChallengeLock(draft, async () => {
    await assert.rejects(selectChallengeSkill(draft, 'one'), /Another operation/);
    assert.ok(await fs.stat(`${challengeHandoffPathFor(draft)}.lock`));
  });
  await assert.rejects(fs.stat(`${challengeHandoffPathFor(draft)}.lock`), { code: 'ENOENT' });
});

test('Malformed, oversized, and symbolic-link contexts fail closed', async (t) => {
  const { root, draft } = await fixture(t);
  const file = challengeHandoffPathFor(draft);
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 'old' }));
  await assert.rejects(readChallengeHandoff(draft), /Invalid/);
  await fs.writeFile(file, 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(readChallengeHandoff(draft), /Unsafe/);
  if (process.platform !== 'win32') {
    await fs.unlink(file); await fs.symlink(path.join(root, 'card.json'), file);
    await assert.rejects(readChallengeHandoff(draft), /Unsafe/);
  }
});

test('Preparation stages and scans only the selected Skill, then pauses for real review', async (t) => {
  const { draft, inventory } = await fixture(t);
  const selected = await selectChallengeSkill(draft, 'one');
  const before = await fs.readFile(path.join(inventory[0].localPath, 'SKILL.md'));
  const calls = [];
  const result = await prepareChallengeSkill(draft, { execute: (args) => {
    calls.push(args.command); return dispatch(args);
  } });
  assert.deepEqual(calls, ['init', 'stage', 'scan']);
  assert.equal(result.status, 'awaiting_deep_scan');
  assert.equal(result.action_type, 'perform_semantic_review');
  assert.equal(result.publicationStatus, 'not_verified');
  assert.equal((await invoke('status', selected.publisherDraftId)).status, 'awaiting_deep_scan');
  assert.deepEqual(await fs.readFile(path.join(inventory[0].localPath, 'SKILL.md')), before);
  await assert.rejects(skipChallengeSkill(draft), /already started/);
  await prepareChallengeSkill(draft, { execute: () => { throw new Error('Must not repeat scan'); } });
});

test('Publisher draft identity and source must belong to the exact context', async (t) => {
  const { draft, inventory } = await fixture(t);
  const selected = await selectChallengeSkill(draft, 'one');
  await invoke('init', selected.publisherDraftId, { workspace: inventory[1].localPath,
    source: inventory[1].localPath, type: 'skill', mode: 'create' });
  await assert.rejects(prepareChallengeSkill(draft), /does not belong/);
  const state = await readChallengeHandoff(draft); state.publisherDraftId = 'unrelated_draft';
  await writeChallengeHandoff(draft, state);
  await assert.rejects(prepareChallengeSkill(draft), /identity mismatch/);
});

test('Deterministic blockers cannot be packaged or uploaded by the coordinator', async (t) => {
  const { draft, inventory } = await fixture(t);
  const fixtureToken = ['sk-', 'proj-', '1234567890abcdefghijklmnop'].join('');
  await fs.writeFile(path.join(inventory[0].localPath, 'main.mjs'), `const api_key = '${fixtureToken}';\n`);
  await selectChallengeSkill(draft, 'one');
  const calls = [];
  const result = await prepareChallengeSkill(draft, { upload: true, execute: (args) => {
    calls.push(args.command); return dispatch(args);
  } });
  assert.equal(result.status, 'blocked');
  assert.equal(result.action_type, 'fix_source_and_start_new_draft');
  assert.deepEqual(calls, ['init', 'stage', 'scan']);
});

test('Reviewed preparation produces one deterministic local package and no upload', async (t) => {
  const { draft, selected, packaged } = await reviewedFixture(t);
  const first = (await loadState(selected.publisherDraftId)).state.bundle_sha256;
  assert.equal(packaged.action_type, 'confirm_private_upload');
  assert.equal(packaged.remoteDraftId, null);
  await prepareChallengeSkill(draft, { execute: () => { throw new Error('Must not repeat packaging'); } });
  assert.equal((await loadState(selected.publisherDraftId)).state.bundle_sha256, first);
});

test('Only explicit private upload invokes remote operations; the actual Web URL is preserved', async (t) => {
  const { draft, selected } = await reviewedFixture(t), calls = [];
  const reviewUrl = 'https://worker.taku.ai/marketplace/review/exact?launch=private';
  const result = await prepareChallengeSkill(draft, { upload: true, execute: async (args) => {
    calls.push(args.command);
    assert.equal(args.flags.get('worker-url'), 'https://worker.taku.ai');
    assert.equal(args.flags.has('allow-custom-worker-url'), false);
    assert.equal(args.flags.has('flowchart'), false);
    const current = await loadState(selected.publisherDraftId);
    current.state.status = 'awaiting_web_confirmation'; current.state.remote_draft_id = 'fixture_remote';
    await saveState(current.directory, current.state);
    return { ok: true, status: 'awaiting_web_confirmation', remote_draft_id: 'fixture_remote', review_url: reviewUrl };
  } });
  assert.deepEqual(calls, ['remote-create']);
  assert.equal(result.reviewUrl, reviewUrl); assert.equal(result.publicationStatus, 'not_verified');
  await prepareChallengeSkill(draft, { upload: true, execute: () => { throw new Error('No duplicate remote draft'); } });
});

test('Missing-icon gate pauses; resuming reuses the existing private draft and never submits', async (t) => {
  const { draft, selected } = await reviewedFixture(t), calls = [];
  const execute = async (args) => {
    calls.push(args.command);
    const current = await loadState(selected.publisherDraftId);
    if (args.command === 'remote-create') {
      current.state.status = 'remote_draft_created'; current.state.remote_draft_id = 'fixture_remote';
      await saveState(current.directory, current.state);
      return { ok: true, status: 'remote_draft_created', remote_draft_id: 'fixture_remote',
        requires_action: true, action_type: 'generate_icon_on_taku_web_before_upload' };
    }
    if (args.command === 'remote-scan') return { ok: true, status: 'scan_report_uploaded', remote_draft_id: 'fixture_remote' };
    assert.equal(args.command, 'remote-upload');
    current.state.status = 'awaiting_web_confirmation'; await saveState(current.directory, current.state);
    return { ok: true, status: 'awaiting_web_confirmation', remote_draft_id: 'fixture_remote',
      review_url: 'https://worker.taku.ai/review/fixture_remote' };
  };
  const paused = await prepareChallengeSkill(draft, { upload: true, execute });
  assert.equal(paused.action_type, 'generate_icon_on_taku_web_before_upload');
  assert.deepEqual(calls, ['remote-create']);
  const ready = await prepareChallengeSkill(draft, { upload: true, execute });
  assert.equal(ready.status, 'awaiting_web_confirmation');
  assert.deepEqual(calls, ['remote-create', 'remote-scan', 'remote-upload']);
});

test('A failed private upload is returned, not reported as success or retried', async (t) => {
  const { draft } = await reviewedFixture(t);
  const error = { ok: false, status: 'error', error: { code: 'missing_auth' } };
  const result = await prepareChallengeSkill(draft, { upload: true, execute: async () => error });
  assert.deepEqual(result, error);
});

test('Runtime listing/auth errors retain their code and real Web recovery URL', async (t) => {
  const { draft } = await reviewedFixture(t);
  const details = { review_url: 'https://worker.taku.ai/review/fixture_remote', missing_fields: ['iconUrl'] };
  const result = await prepareChallengeSkill(draft, { upload: true, execute: async () => {
    throw new PublisherError('Save the icon before uploading.', 'remote_listing_incomplete', details);
  } });
  assert.equal(result.ok, false); assert.equal(result.error.code, 'remote_listing_incomplete');
  assert.deepEqual(result.error.details, details);
});

test('An unselected or unexpected runtime result cannot advance a Challenge', async (t) => {
  const { draft } = await fixture(t);
  await assert.rejects(prepareChallengeSkill(draft), /Select one/);
  await selectChallengeSkill(draft, 'one');
  await assert.rejects(prepareChallengeSkill(draft, { execute: async () => ({}) }), /Invalid Publisher/);
});
