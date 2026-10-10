#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = path.join(root, 'dist/challenge-test');
const build = JSON.parse(await fs.readFile(path.join(buildRoot, 'build.json'), 'utf8'));
const production = JSON.parse(await fs.readFile(path.join(root,
  'dist/skills/taku-publisher/publisher-version.json'), 'utf8')).version;
const stable = /^(\d+)\.(\d+)\.(\d+)$/.exec(production);
assert.ok(stable, 'Standard build must have a stable semver version.');
const nextPatch = `${stable[1]}.${stable[2]}.${Number(stable[3]) + 1}`;
assert.equal(build.version, `${nextPatch}-stax-challenge.b${build.source.sourceTreeChecksum.slice(0, 12)}`);
assert.match(build.source.sourceTreeChecksum, /^[a-f0-9]{64}$/);
const sourceMetadata = JSON.parse(execFileSync(process.execPath, ['scripts/source-checksum.mjs'],
  { cwd: root, encoding: 'utf8' }));
assert.equal(build.source.sourceTreeChecksum, sourceMetadata.sourceTreeChecksum);
for (const item of build.builds) {
  const skill = path.join(buildRoot, item.directory, 'plugins', build.name, 'skills', build.name);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-challenge-plugin-'));
  const { setTreeWritable } = await import(pathToFileURL(path.join(skill,
    'node_modules/@taku/publisher-runtime/dist/index.js')));
  try {
    const source = path.join(temporary, 'fixture-skill');
    const draft = path.join(temporary, 'card.json');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'SKILL.md'), '---\nname: sample-report\ndescription: Format a local report.\n---\n# Report\nFormat a report.\n');
    await fs.writeFile(draft, '{}');
    const { writePrivateState } = await import(pathToFileURL(path.join(skill, 'creator/scripts/draft-state.mjs')));
    const { createChallengeHandoff } = await import(pathToFileURL(path.join(skill, 'creator/scripts/challenge-handoff.mjs')));
    const { AI_BURN_PERIOD } = await import(pathToFileURL(path.join(skill, 'creator/scripts/activity-periods.mjs')));
    const { buildStaxChallengeReviewUrl } = await import(pathToFileURL(path.join(skill, 'creator/scripts/stax-url.mjs')));
    assert.deepEqual(AI_BURN_PERIOD, {
      id: 'aiBurn', label: 'Sep 22 - Oct 30, 2026',
      startsAt: '2026-09-21T16:00:00.000Z', endsAt: '2026-10-30T15:59:59.999Z',
      usageSchema: 'taku.creator.ai-burn-usage.v3',
    });
    assert.equal(buildStaxChallengeReviewUrl('http://localhost:3001', { launchContextId: 'opaque' }),
      'http://localhost:3001/stax?review=1&launch=opaque');
    const creatorConfig = await fs.readFile(path.join(skill, 'creator/scripts/publish-config.mjs'), 'utf8');
    const runtimeConstants = await fs.readFile(path.join(skill,
      'node_modules/@taku/publisher-runtime/dist/constants.js'), 'utf8');
    assert.match(creatorConfig, /DEFAULT_SITE_URL = 'http:\/\/localhost:3001'/);
    assert.match(creatorConfig, /DEFAULT_WORKER_URL = 'https:\/\/worker\.taku\.ai'/);
    assert.match(runtimeConstants, /DEFAULT_WORKER_URL = 'https:\/\/worker\.taku\.ai'/);
    const provenance = JSON.parse(await fs.readFile(path.join(buildRoot, item.directory, 'provenance.json'), 'utf8'));
    assert.equal(provenance.baseProductionVersion, production);
    assert.equal(provenance.testBaseVersion, nextPatch);
    assert.equal(provenance.version, build.version);
    assert.equal(provenance.sourceCommit, build.sourceCommit);
    assert.deepEqual(provenance.source, build.source);
    assert.deepEqual(provenance.endpoints, {
      siteUrl: 'http://localhost:3001', workerUrl: 'https://worker.taku.ai',
    });
    await writePrivateState(draft, { items: [{ id: 'fixture', name: 'Fixture', type: 'skill', localPath: source }] });
    await createChallengeHandoff(draft, { candidates: [{ candidateId: 'fixture', name: 'Fixture', type: 'skill' }],
      workerUrl: 'https://worker.taku.ai', siteUrl: 'https://taku.ai' });
    const cli = path.join(skill, 'scripts/taku-publisher.mjs');
    const env = { ...process.env, TAKU_PUBLISHER_HOME: path.join(temporary, 'publisher'),
      TAKU_PUBLISHER_SKILL_ROOT: skill };
    const run = (args) => execFileSync(process.execPath, [cli, ...args], { cwd: skill, env, encoding: 'utf8' });
    assert.equal(run(['--version']).trim(), `${build.name} ${build.version} (stax-challenge-test)`);
    const doctor = JSON.parse(run(['creator-doctor', '--json']));
    assert.equal(doctor.commands.includes('challenge-prepare'), true);
    assert.equal(JSON.parse(await fs.readFile(path.join(skill, 'host-adapter.json'), 'utf8')).host, item.host);
    assert.throws(() => run(['creator-challenge-select', '--json', '--draft', draft, '--candidate-id', 'unoffered']), (error) => {
      const result = JSON.parse(String(error.stdout));
      assert.equal(result.ok, false); assert.equal(result.error.code, 'challenge_error');
      return true;
    });
    const selected = JSON.parse(run(['creator-challenge-select', '--json', '--draft', draft, '--candidate-id', 'fixture']));
    assert.equal(selected.selectedSkill.sourcePath, await fs.realpath(source));
    const paused = JSON.parse(run(['creator-challenge-prepare', '--json', '--draft', draft]));
    assert.equal(paused.status, 'awaiting_deep_scan');
    const review = JSON.parse(await fs.readFile(paused.publisherResult.dispositions_template_path, 'utf8'));
    review.full_review_completed = true;
    for (const row of review.dispositions) { row.decision = 'allow'; row.rationale = 'Known documentation-only smoke fixture.'; }
    const reviewed = path.join(temporary, 'review.json');
    await fs.writeFile(reviewed, JSON.stringify(review));
    const applied = JSON.parse(run(['apply-review', '--draft-id', selected.publisherDraftId, '--dispositions', reviewed]));
    assert.equal(applied.status, 'ready_to_package');
    const packaged = JSON.parse(run(['creator-challenge-prepare', '--json', '--draft', draft]));
    assert.equal(packaged.status, 'packaged'); assert.equal(packaged.remoteDraftId, null);
    const status = JSON.parse(run(['creator-challenge-status', '--json', '--draft', draft]));
    assert.equal(status.publisherDraftId, selected.publisherDraftId);
    assert.equal(status.publicationStatus, 'not_verified');
    console.log(JSON.stringify({ ok: true, host: item.host, version: build.version,
      stages: ['select', 'scan', 'review', 'package', 'status'], remoteWrites: 0 }));
  } finally {
    await setTreeWritable(temporary).catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
