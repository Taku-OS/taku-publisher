import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  prepareCandidateForPublisher,
  REPO_TO_STAX_PREPARE_PROTOCOL,
} from '../src/prepare-cli.js';
import {
  checkAgentConversion,
  createAgentHandoff,
  REPO_TO_STAX_AGENT_HANDOFF_PROTOCOL,
  REPO_TO_STAX_CONVERSION_CHECK_PROTOCOL,
} from '../src/agent-cli.js';
import { computeTreeDigest } from '../src/lib/tree-digest.js';

test('prepares a validated candidate from the bundled pinned template', async () => {
  const root = await mkdtemp(join(tmpdir(), 'repo-to-stax-prepare-cli-'));
  try {
    const source = join(root, 'source');
    const outputRoot = join(root, 'candidates');
    const workRoot = join(root, 'work');
    await mkdir(join(source, 'app'), { recursive: true });
    await mkdir(outputRoot);
    await mkdir(workRoot);
    await writeFile(
      join(source, 'package.json'),
      JSON.stringify({ name: 'candidate-fixture', dependencies: { next: '15.0.0' } }),
    );
    await writeFile(join(source, 'README.md'), '# Candidate fixture\n');
    await writeFile(join(source, 'LICENSE'), 'MIT License\n');
    await writeFile(
      join(source, 'app', 'page.tsx'),
      'export const calculate = (value: string) => eval(value);\nexport default function Page() {}\n',
    );

    const sourceDigest = await computeTreeDigest(source);
    const result = await prepareCandidateForPublisher({
      input: source,
      outputRoot,
      workRoot,
      expectedSourceDigest: sourceDigest,
      name: 'prepared-candidate',
    }) as Record<string, unknown>;

    assert.equal(result.protocol, REPO_TO_STAX_PREPARE_PROTOCOL);
    assert.equal(result.sourceDigest, sourceDigest);
    assert.equal((result.workspaceValidation as Record<string, unknown>).ok, true);
    assert.equal((result.template as Record<string, unknown>).version, '0.3.2');
    const workspaceRoot = String(result.workspaceRoot);
    assert.match(await readFile(join(workspaceRoot, 'STAX_CONVERSION_PLAN.md'), 'utf8'), /One-Shot Agent Checklist/);
    assert.match(await readFile(join(workspaceRoot, '.taku', 'migration.json'), 'utf8'), /taku\.subapp-migration\.v2/);

    const handoff = await createAgentHandoff(workspaceRoot) as Record<string, unknown>;
    assert.equal(handoff.protocol, REPO_TO_STAX_AGENT_HANDOFF_PROTOCOL);
    assert.equal(handoff.scriptsExecuted, false);
    assert.equal((handoff.validation as Record<string, unknown>).ok, true);
    const initialCheck = await checkAgentConversion(workspaceRoot) as Record<string, unknown>;
    assert.equal(initialCheck.protocol, REPO_TO_STAX_CONVERSION_CHECK_PROTOCOL);
    assert.equal((initialCheck.validation as Record<string, unknown>).ok, false);

    await writeFile(
      join(workspaceRoot, 'src', 'app', 'page.tsx'),
      'export default function Page() { return <main>Converted workflow</main>; }\n',
    );
    await writeFile(
      join(workspaceRoot, 'src', 'converted-workflow.test.ts'),
      "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('converted workflow', () => assert.equal(2 + 2, 4));\n",
    );
    const migrationPath = join(workspaceRoot, '.taku', 'migration.json');
    const migration = JSON.parse(await readFile(migrationPath, 'utf8')) as Record<string, unknown>;
    migration.status = 'converted';
    await writeFile(migrationPath, `${JSON.stringify(migration, null, 2)}\n`);
    const unresolvedCheck = await checkAgentConversion(workspaceRoot) as Record<string, unknown>;
    assert.equal((unresolvedCheck.validation as Record<string, unknown>).ok, false);
    assert.equal(
      ((unresolvedCheck.validation as Record<string, unknown>).findings as Array<Record<string, unknown>>)
        .some(finding => finding.code === 'conversion.risk-unresolved'),
      true,
    );
    const analysis = migration.analysis as Record<string, unknown>;
    const risk = (analysis.risks as string[])[0];
    analysis.riskResolutions = [{
      risk,
      status: 'resolved',
      evidence: 'src/app/page.tsx replaces the upstream dynamic evaluation with bounded product logic.',
    }];
    await writeFile(migrationPath, `${JSON.stringify(migration, null, 2)}\n`);
    const convertedCheck = await checkAgentConversion(workspaceRoot) as Record<string, unknown>;
    assert.equal((convertedCheck.validation as Record<string, unknown>).ok, true);
    assert.equal(convertedCheck.scriptsExecuted, false);

    await writeFile(join(workspaceRoot, 'KEEP.txt'), 'existing candidate must survive\n');
    await assert.rejects(
      prepareCandidateForPublisher({
        input: source,
        outputRoot,
        workRoot,
        expectedSourceDigest: sourceDigest,
        name: 'prepared-candidate',
      }),
      /already exists/,
    );
    assert.equal(await readFile(join(workspaceRoot, 'KEEP.txt'), 'utf8'), 'existing candidate must survive\n');
    assert.deepEqual(await readdir(outputRoot), ['prepared-candidate']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
