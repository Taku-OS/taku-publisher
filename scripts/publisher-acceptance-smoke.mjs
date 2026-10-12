#!/usr/bin/env node
// Only loopback fixtures and temporary configuration. No production login or release.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const releaseRoot = path.join(root, 'dist/native-publisher/marketplace-release');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const release = await readJson(path.join(releaseRoot, 'release.json'));
const reports = [];
for (const [host, marker] of [['codex', 'codex'], ['claude', 'claude-code'], ['cursor', 'cursor']]) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-native-acceptance-'));
  const skill = path.join(temporary, 'plugin/skills/taku-publisher');
  const cli = path.join(skill, 'scripts/taku-publisher.mjs');
  const fixtureHome = path.join(temporary, 'home');
  const source = path.join(temporary, 'workspace/fixture-skill');
  const draft = path.join(temporary, 'card.json');
  let writable;
  let server;
  try {
    await fs.cp(path.join(releaseRoot, `plugins/taku-publisher-${host}`), path.join(temporary, 'plugin'), { recursive: true });
    ({ setTreeWritable: writable } = await import(pathToFileURL(path.join(skill, 'node_modules/@taku/publisher-runtime/dist/index.js'))));
    await fs.mkdir(fixtureHome);
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, 'SKILL.md'), '---\nname: fixture-report\ndescription: Format one bounded local report.\n---\n# Fixture Report\nFormat one report; no network calls or scripts.\n');
    const requests = [];
    const remoteId = 'acceptance_draft';
    const listing = { title: 'Fixture report', description: 'A bounded local report.', iconUrl: 'https://example.test/fixture-icon.png' };
    let uploaded = false, publicConfirmed = false, expectedArtifact;
    server = createServer(async (request, response) => {
      try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        requests.push(`${request.method} ${request.url}`);
        response.setHeader('Content-Type', 'application/json');
        const route = request.url;
        const base = `/stax/publisher/drafts/${remoteId}`;
        const reviewUrl = `http://${request.headers.host}/publish/${remoteId}`;
        let data;
        if (route === '/stax/profile') data = { data: { displayName: 'Fixture Builder', username: 'fixture', handle: '@fixture', avatarUrl: null } };
        else if (route === '/stax/studio/cards/me' && request.method === 'GET') data = { data: { draft: { revision: 1 }, saveContract: 'revision-v1' } };
        else if (route === '/stax/studio/cards/me' && request.method === 'PUT') {
          const card = JSON.parse(body);
          assert.equal(card.expectedRevision, 1);
          assert.equal(card.issueLaunchContext, true);
          assert.equal(card.content.studioRenderer.schemaVersion, 'taku.stax.studio-renderer.v1');
          data = { data: { draft: { id: 'fixture_card' }, studioUrl: `http://${request.headers.host}/stax/studio/editor?launch=taku_studio_launch_${'a'.repeat(32)}`, launchContext: { id: `taku_studio_launch_${'a'.repeat(32)}` } } };
        } else if (route === '/stax/publisher/drafts' && request.method === 'POST') {
          assert.equal(JSON.parse(body).toolType, 'skill');
          data = { draftId: remoteId, reviewUrl, listing };
        } else if (route === base && ['GET', 'PATCH'].includes(request.method)) data = { draft: { id: remoteId, listing }, reviewUrl };
        else if (route === `${base}/scan-report`) data = { accepted: true };
        else if (route === `${base}/artifacts/presign`) {
          expectedArtifact = JSON.parse(body);
          data = { artifactId: 'fixture_artifact', uploadUrl: `http://${request.headers.host}${base}/artifacts/fixture_artifact/upload` };
        } else if (route === `${base}/artifacts/fixture_artifact/upload` && request.method === 'PUT') {
          assert.equal(body.length, expectedArtifact.size);
          assert.equal(createHash('sha256').update(body).digest('hex'), expectedArtifact.sha256);
          uploaded = true; data = { ok: true };
        } else if (route === `${base}/artifacts/fixture_artifact/complete`) {
          assert.ok(uploaded); data = { artifactId: 'fixture_artifact', reviewUrl };
        } else if (route === `${base}/status`) data = { status: publicConfirmed ? 'published' : 'draft', draftId: remoteId };
        else { response.statusCode = 404; data = { error: 'Unexpected fixture endpoint' }; }
        response.end(JSON.stringify(data));
      } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.message })); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const workerUrl = `http://127.0.0.1:${server.address().port}`;
    const runtimeBin = path.join(temporary, 'bin');
    await fs.mkdir(runtimeBin);
    await fs.symlink(process.execPath, path.join(runtimeBin, process.platform === 'win32' ? 'node.exe' : 'node'));
    const env = { PATH: runtimeBin, TMPDIR: os.tmpdir(), HOME: fixtureHome, TAKU_PUBLISHER_HOME: path.join(temporary, 'publisher'),
      TAKU_PUBLISHER_SESSION_PATH: path.join(temporary, 'fixture-session.json'), TAKU_SESSION_PATH: path.join(temporary, 'missing-desktop-session.json'),
      TAKU_BEARER_TOKEN: 'test-acceptance-token', TAKU_PUBLISH_TOKEN: 'test-acceptance-token',
      TAKU_PUBLISHER_GENERATE_FLOWCHART: 'false', NO_PROXY: '127.0.0.1,localhost',
      TAKU_WORKER_URL: workerUrl, TAKU_SITE_URL: workerUrl, TAKU_AUTH_SITE_URL: workerUrl };
    // The minimal environment excludes GitHub CLI and all user credentials.
    const run = async (...args) => {
      const { stdout } = await execute(process.execPath, [cli, ...args], { cwd: skill, env, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
      const result = JSON.parse(stdout); assert.notEqual(result.ok, false, JSON.stringify(result)); return result;
    };
    const discovered = await run('project-discover', '--host', 'other', '--project', path.dirname(source));
    assert.equal(discovered.project_count, 1);
    const card = await run('creator-draft', '--json', '--workspace', path.dirname(source), '--output', draft,
      '--local-only', '--no-usage', '--editor', '--challenge-handoff', '--no-open-browser',
      '--worker-url', workerUrl, '--site-url', workerUrl, '--allow-custom-worker-url');
    assert.equal(card.status, 'waiting_for_selection');
    assert.ok(card.challengeSkills.length >= 1);
    assert.equal(card.publicReleaseAttempted, false);
    assert.ok(card.editorUrl.startsWith(`${workerUrl}/stax?review=1&launch=`));
    await assert.rejects(run('creator-challenge-select', '--draft', draft, '--candidate-id', 'unoffered'));
    const selected = await run('creator-challenge-select', '--draft', draft, '--candidate-id', card.challengeSkills[0].candidateId);
    const paused = await run('creator-challenge-prepare', '--draft', draft);
    assert.equal(paused.status, 'awaiting_deep_scan');
    const review = await readJson(paused.publisherResult.dispositions_template_path);
    review.full_review_completed = true;
    for (const row of review.dispositions) { row.decision = 'allow'; row.rationale = 'Known documentation-only fixture reviewed by this smoke.'; }
    const reviewed = path.join(temporary, 'review.json'); await fs.writeFile(reviewed, JSON.stringify(review));
    await run('apply-review', '--draft-id', selected.publisherDraftId, '--dispositions', reviewed);
    const packaged = await run('creator-challenge-prepare', '--draft', draft);
    assert.equal(packaged.status, 'packaged');
    assert.equal(packaged.remoteDraftId, null);
    const metadata = path.join(temporary, 'listing.json'); await fs.writeFile(metadata, JSON.stringify(listing));
    const remoteArgs = ['--draft-id', selected.publisherDraftId, '--worker-url', workerUrl, '--site-url', workerUrl, '--allow-custom-worker-url', '--no-browser-login'];
    const created = await run('remote-create', ...remoteArgs, '--metadata', metadata);
    assert.equal(created.status, 'awaiting_web_confirmation');
    assert.equal(created.requires_action, true);
    assert.equal(created.action_type, 'review_and_submit_on_taku_web');
    assert.equal(created.review_url, `${workerUrl}/publish/${remoteId}`);
    assert.equal((await run('creator-challenge-status', '--draft', draft)).publicationStatus, 'not_verified');
    assert.equal((await run('remote-status', ...remoteArgs)).remote_status.status, 'draft');
    // Simulate a separate Web actor completing confirmation; the CLI never submits it.
    publicConfirmed = true;
    assert.equal((await run('remote-status', ...remoteArgs)).remote_status.status, 'published');
    assert.ok(!requests.some(value => /submit|icons\/generate|flowchart|publish$/.test(value)));
    assert.ok(uploaded);
    reports.push({ host: marker, version: release.version, stages: ['discover', 'card', 'candidates', 'select', 'scan', 'review', 'package', 'private-draft', 'upload', 'web-confirmation-gate', 'status'],
      localFixtureRequests: requests.length, productionRequests: 0, publicReleaseAttempted: false });
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (writable) await writable(temporary).catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ ok: true, reports, productionLoginVerified: false, publicPublishVerified: false, hostUiInstallVerified: false }, null, 2));
