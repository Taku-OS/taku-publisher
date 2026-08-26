import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  assessProjectSource,
  checkSkillConversion,
  createSkillAgentHandoff,
  discoverRecentProjects,
  initializeDraft,
  prepareSkillCandidate,
  setTreeWritable,
  stageSelected,
} from '../dist/index.js';

test('discovers recent Codex and Claude Code workspaces from metadata only', async (t) => {
  const root = await temporaryDirectory(t);
  const home = path.join(root, 'home');
  const project = path.join(root, 'projects', 'sample-workflow');
  const codexSession = path.join(home, '.codex', 'sessions', '2026', '08', 'session.jsonl');
  const claudeSession = path.join(home, '.claude', 'projects', 'sample', 'session.jsonl');
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(path.dirname(codexSession), { recursive: true });
  await fs.mkdir(path.dirname(claudeSession), { recursive: true });
  await fs.writeFile(path.join(project, 'README.md'), '# Sample workflow\n');
  await fs.writeFile(path.join(project, 'run.py'), 'print("ok")\n');
  await fs.writeFile(
    codexSession,
    `${JSON.stringify({
      type: 'session_meta',
      payload: {
        cwd: project,
        timestamp: '2026-08-20T10:00:00.000Z',
        message: 'private prompt content must not be returned',
      },
    })}\n`,
  );
  await fs.writeFile(
    claudeSession,
    `${JSON.stringify({
      cwd: project,
      updatedAt: '2026-08-21T10:00:00.000Z',
      prompt: 'another private prompt',
    })}\n`,
  );

  const projects = await discoverRecentProjects({
    homeDir: home,
    codexHome: path.join(home, '.codex'),
    claudeConfigDir: path.join(home, '.claude'),
  });

  assert.equal(projects.length, 1);
  assert.equal(projects[0].path, await fs.realpath(project));
  assert.deepEqual(projects[0].hosts, ['claude-code', 'codex']);
  assert.equal(projects[0].routeHint, 'workflow-candidate');
  assert.equal(JSON.stringify(projects).includes('private prompt'), false);
});

test('routes existing Skills and interactive Apps without generating new content', async (t) => {
  const root = await temporaryDirectory(t);
  const skill = path.join(root, 'existing-skill');
  const app = path.join(root, 'next-app');
  await fs.mkdir(skill);
  await fs.mkdir(path.join(app, 'app'), { recursive: true });
  await fs.writeFile(
    path.join(skill, 'SKILL.md'),
    '---\nname: existing-skill\ndescription: Use this existing workflow when a fixture needs processing.\n---\n\n# Existing\n',
  );
  await fs.writeFile(
    path.join(app, 'package.json'),
    JSON.stringify({ name: 'next-app', dependencies: { next: '15.0.0' } }),
  );
  await fs.writeFile(path.join(app, 'README.md'), '# Next app\n');
  await fs.writeFile(path.join(app, 'LICENSE'), 'MIT License\n');
  await fs.writeFile(
    path.join(app, 'app', 'page.tsx'),
    'export default function Page() { return <main>App</main>; }\n',
  );

  const existing = await assessProjectSource(skill);
  const interactive = await assessProjectSource(app);

  assert.equal(existing.route, 'existing-skill');
  assert.equal(existing.eligibility, 'eligible');
  assert.equal(existing.nextCommand, 'init');
  assert.equal(interactive.route, 'subapp-migration');
  assert.equal(interactive.eligibility, 'eligible');
  assert.match(interactive.confirmationToken, /^subapp_confirm_[a-f0-9]{64}$/);
});

test('prepares and validates an isolated Skill candidate for a local workflow', async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'source-workflow');
  const outputRoot = path.join(root, 'candidates');
  await fs.mkdir(source);
  await fs.mkdir(outputRoot);
  await fs.writeFile(
    path.join(source, 'README.md'),
    '# Report formatter\n\nFormats a local JSON report into a stable Markdown summary.\n',
  );
  await fs.writeFile(
    path.join(source, 'format_report.py'),
    'import json\n\ndef format_report(value):\n    return "# Report\\n" + str(value)\n',
  );

  const assessment = await assessProjectSource(source);
  assert.equal(assessment.route, 'skill-generation');
  assert.equal(assessment.eligibility, 'eligible');
  assert.match(assessment.confirmationToken, /^skill_confirm_[a-f0-9]{64}$/);

  const prepared = await prepareSkillCandidate({
    source,
    outputRoot,
    confirmationToken: assessment.confirmationToken,
    name: 'report-formatter',
  });
  assert.equal(await fs.realpath(source), assessment.source.path);
  assert.equal(path.dirname(prepared.candidateRoot), await fs.realpath(outputRoot));
  assert.match(
    await fs.readFile(path.join(prepared.candidateRoot, 'SKILL.md'), 'utf8'),
    /TAKU_SKILL_CONVERSION_PLACEHOLDER/,
  );

  const handoff = await createSkillAgentHandoff(prepared.candidateRoot);
  assert.equal(handoff.sourceRoot, assessment.source.path);
  assert.ok(handoff.readOnlyPaths.includes(assessment.source.path));
  assert.ok(handoff.editableScope.includes(path.join(prepared.candidateRoot, 'SKILL.md')));
  const initial = await checkSkillConversion(prepared.candidateRoot);
  assert.equal(initial.converted, false);
  assert.ok(initial.findings.some((finding) => finding.code === 'skill.placeholder'));

  await fs.mkdir(path.join(prepared.candidateRoot, 'scripts'));
  await fs.writeFile(
    path.join(prepared.candidateRoot, 'scripts', 'format_report.py'),
    'import json\n\ndef format_report(value):\n    return "# Report\\n" + str(value)\n',
  );
  await fs.writeFile(
    path.join(prepared.candidateRoot, 'SKILL.md'),
    `---
name: report-formatter
description: Use when a user needs to turn a local JSON report into a deterministic Markdown summary.
---

# Report Formatter

Use this Skill for an explicitly selected JSON input file. Read only that file, validate that it contains a JSON object, and run the bundled formatter script without network access.

## Workflow

1. Confirm the exact input file and desired output location.
2. Inspect the JSON shape and reject secrets or credential-bearing fields.
3. Run \`scripts/format_report.py\` with the selected input.
4. Review the generated Markdown and report validation failures without overwriting unrelated files.

## Safety

Do not scan other directories, access the network, or accept credentials. Ask before replacing an existing output file.
`,
  );
  const checked = await checkSkillConversion(prepared.candidateRoot);
  assert.equal(checked.converted, true);
  assert.deepEqual(checked.findings, []);

  const draft = await initializeDraft({
    workspace: prepared.candidateRoot,
    source: prepared.candidateRoot,
    unitType: 'skill',
    mode: 'create',
    env: { TAKU_PUBLISHER_HOME: path.join(root, 'publisher-state') },
  });
  const staged = await stageSelected(draft.directory, draft.state);
  assert.ok(staged.excluded.some((entry) =>
    entry.path === '.taku/skill-conversion.json' &&
    entry.reason === 'local_skill_conversion_record',
  ));
  const manifest = JSON.parse(await fs.readFile(path.join(draft.directory, 'file-list.json'), 'utf8'));
  assert.equal(manifest.files.some((file) => file.path === '.taku/skill-conversion.json'), false);
});

test('rejects stale Skill confirmation after the source project changes', async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'source-workflow');
  const outputRoot = path.join(root, 'candidates');
  await fs.mkdir(source);
  await fs.mkdir(outputRoot);
  await fs.writeFile(path.join(source, 'README.md'), '# Workflow\n');
  await fs.writeFile(path.join(source, 'run.py'), 'print("first")\n');
  const assessment = await assessProjectSource(source);
  await fs.writeFile(path.join(source, 'run.py'), 'print("changed")\n');

  await assert.rejects(
    prepareSkillCandidate({
      source,
      outputRoot,
      confirmationToken: assessment.confirmationToken,
    }),
    (error) => error?.code === 'skill_confirmation_mismatch',
  );
  assert.deepEqual(await fs.readdir(outputRoot), []);
});

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-project-import-test-'));
  t.after(async () => {
    await setTreeWritable(directory).catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}
