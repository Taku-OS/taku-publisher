import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  assessSubAppSource,
  dispatch,
  prepareSubAppCandidate,
  projectConverterAssessment,
  runRepoToStaxAssessment,
  setTreeWritable,
  subAppAssessmentConfirmationToken,
  subAppAssessmentReviewTemplate,
  validateSubAppAssessmentReview,
} from '../dist/index.js';

test('assesses one absolute local project without creating a candidate workspace', async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'sample-app');
  await fs.mkdir(source);
  await fs.writeFile(
    path.join(source, 'package.json'),
    JSON.stringify({ name: 'sample-app', dependencies: { next: '15.0.0' } }),
  );
  const canonicalSource = await fs.realpath(source);
  let converterWorkRoot = '';
  const result = await assessSubAppSource(
    { source },
    {
      runConverter: async (request) => {
        converterWorkRoot = request.workRoot;
        assert.equal(request.source, canonicalSource);
        assert.equal(request.sourceRef, undefined);
        assert.equal((await fs.stat(request.workRoot)).isDirectory(), true);
        return converterOutput();
      },
    },
  );

  assert.equal(result.assessment.privacy.localOnly, true);
  assert.equal(result.assessment.source.locator, canonicalSource);
  assert.equal(result.assessment.eligibility, 'eligible');
  assert.equal(result.assessment.nextStep, 'start-conversion');
  assert.equal(result.converter.protocol, 'repo-to-stax.analyze.v1');
  await assert.rejects(fs.access(converterWorkRoot), /ENOENT/);
});

test('normalizes a GitHub URL and forwards an explicit safe ref', async () => {
  let received;
  const result = await assessSubAppSource(
    {
      source: 'https://github.com/example/sample-app.git/',
      sourceRef: 'refs/tags/v1.2.3',
    },
    {
      runConverter: async (request) => {
        received = request;
        return converterOutput();
      },
    },
  );

  assert.equal(received.source, 'https://github.com/example/sample-app');
  assert.equal(received.sourceRef, 'refs/tags/v1.2.3');
  assert.equal(
    result.assessment.source.locator,
    'https://github.com/example/sample-app',
  );
  assert.equal(result.assessment.source.kind, 'github');
});

test('requires review when Converter detects an unresolved external service', () => {
  const result = projectConverterAssessment(
    converterOutput({
      risks: [
        'Credential/API key handling must be server-side or explicit BYOK',
      ],
      score: 82,
    }),
    {
      kind: 'github',
      locator: 'https://github.com/example/sample-app',
    },
  );

  assert.equal(result.eligibility, 'review-required');
  assert.equal(result.nextStep, 'manual-review');
  assert.equal(result.serviceRequirements.length, 1);
  assert.equal(
    result.serviceRequirements[0].mapping.status,
    'review-required',
  );
  assert.equal(
    result.findings.some(
      (finding) => finding.code === 'service.mapping-review-required',
    ),
    true,
  );
});

test('rejects non-SubApp capabilities and preserves the alternate route', () => {
  const result = projectConverterAssessment(
    converterOutput({
      appType: 'workflow-skill',
      recommendation: 'manual-review',
      route: 'native-import',
      score: 54,
      risks: ['Workflow repo needs a new UI wrapper'],
    }),
    {
      kind: 'github',
      locator: 'https://github.com/example/sample-skill',
    },
  );

  assert.equal(result.eligibility, 'rejected');
  assert.equal(result.route.kind, 'native-import');
  assert.equal(result.nextStep, 'native-import');
});

test('rejects unsafe or unsupported assessment inputs before invoking Converter', async (t) => {
  const root = await temporaryDirectory(t);
  const file = path.join(root, 'not-a-project.txt');
  await fs.writeFile(file, 'text');
  let calls = 0;
  const options = {
    runConverter: async () => {
      calls += 1;
      return converterOutput();
    },
  };

  await assert.rejects(
    assessSubAppSource({ source: 'relative/project' }, options),
    (error) => error?.code === 'subapp_source_not_absolute',
  );
  await assert.rejects(
    assessSubAppSource({ source: file }, options),
    (error) => error?.code === 'subapp_source_not_directory',
  );
  await assert.rejects(
    assessSubAppSource(
      { source: 'http://github.com/example/project' },
      options,
    ),
    (error) => error?.code === 'subapp_repository_url_unsupported',
  );
  await assert.rejects(
    assessSubAppSource(
      { source: 'https://github.com/example/project/issues' },
      options,
    ),
    (error) => error?.code === 'subapp_repository_url_invalid',
  );
  await assert.rejects(
    assessSubAppSource(
      {
        source: 'https://github.com/example/project',
        sourceRef: '--upload-pack=bad',
      },
      options,
    ),
    (error) => error?.code === 'subapp_source_ref_invalid',
  );
  assert.equal(calls, 0);
});

test('runs an explicit Converter entry without a shell and parses its JSON', async (t) => {
  const root = await temporaryDirectory(t);
  const script = path.join(root, 'fake-converter.mjs');
  await fs.writeFile(
    script,
    [
      "const args = process.argv.slice(2);",
      "if (args[0] !== 'analyze') process.exit(2);",
      `process.stdout.write(${JSON.stringify(JSON.stringify(converterOutput()))});`,
    ].join('\n'),
  );

  const output = await runRepoToStaxAssessment({
    source: 'https://github.com/example/sample-app',
    sourceRef: 'main',
    workRoot: root,
    converterBin: script,
    timeoutMs: 5_000,
  });
  assert.equal(output.analysis.appType, 'nextjs');
  assert.equal(output.route.kind, 'subapp-migration');
});

test('returns a stable CLI envelope for assessment-only flow', async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'sample-app');
  const script = path.join(root, 'fake-converter.mjs');
  await fs.mkdir(source);
  await fs.writeFile(
    script,
    `process.stdout.write(${JSON.stringify(JSON.stringify(converterOutput()))});\n`,
  );

  const output = await dispatch({
    command: 'subapp-assess',
    flags: new Map([
      ['source', source],
      ['converter-bin', script],
    ]),
    rest: [],
  });

  assert.equal(output.status, 'subapp_conversion_eligible');
  assert.equal(output.conversion_can_start, true);
  assert.equal(output.phase_boundary, 'assessment_only');
  assert.equal(output.candidate_preparation_available, true);
  assert.match(output.confirmation_token, /^subapp_confirm_[a-f0-9]{64}$/);
  assert.equal(output.action_type, 'confirm_subapp_conversion');
});

test('accepts an exact bound manual review and includes it in confirmation', async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'sample-app');
  await fs.mkdir(source);
  const converter = converterOutput({
    risks: ['Potential command execution requires security review before conversion'],
    score: 84,
  });
  const assessed = await assessSubAppSource(
    { source },
    { runConverter: async () => converter },
  );
  assert.equal(assessed.assessment.eligibility, 'review-required');

  const template = subAppAssessmentReviewTemplate(assessed);
  assert.equal(template.schema_version, 'taku.subapp-assessment-review.v1');
  assert.equal(template.dispositions.length, 1);
  const reviewInput = structuredClone(template);
  reviewInput.dispositions[0].decision = 'accepted_with_remediation';
  reviewInput.dispositions[0].rationale =
    'The dynamic evaluation is confined to the upstream calculator workflow.';
  reviewInput.dispositions[0].remediation =
    'Replace eval with an explicit arithmetic parser in the converted candidate.';
  const review = validateSubAppAssessmentReview(assessed, reviewInput);
  assert.match(
    subAppAssessmentConfirmationToken(assessed, review),
    /^subapp_confirm_[a-f0-9]{64}$/,
  );
  assert.notEqual(
    subAppAssessmentConfirmationToken(assessed, review),
    subAppAssessmentConfirmationToken(assessed),
  );

  const tampered = structuredClone(reviewInput);
  tampered.source_digest = `sha256:${'b'.repeat(64)}`;
  assert.throws(
    () => validateSubAppAssessmentReview(assessed, tampered),
    (error) => error?.code === 'subapp_assessment_review_mismatch',
  );
});

test('CLI returns a review template and accepts the completed bound review', async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'sample-app');
  const script = path.join(root, 'fake-converter.mjs');
  const reviewPath = path.join(root, 'assessment-review.json');
  await fs.mkdir(source);
  await fs.writeFile(
    script,
    `process.stdout.write(${JSON.stringify(JSON.stringify(converterOutput({
      risks: ['Potential command execution requires security review before conversion'],
      score: 84,
    })))});\n`,
  );

  const initial = await dispatch({
    command: 'subapp-assess',
    flags: new Map([
      ['source', source],
      ['converter-bin', script],
    ]),
    rest: [],
  });
  assert.equal(initial.status, 'subapp_conversion_review_required');
  assert.equal(initial.confirmation_token, null);
  assert.equal(initial.candidate_preparation_available, false);
  const review = structuredClone(initial.assessment_review_template);
  review.dispositions[0].decision = 'accepted_with_remediation';
  review.dispositions[0].rationale =
    'The risky primitive belongs to the bounded upstream calculator workflow.';
  review.dispositions[0].remediation =
    'Replace it with a non-evaluating arithmetic implementation during migration.';
  await fs.writeFile(reviewPath, JSON.stringify(review));

  const reviewed = await dispatch({
    command: 'subapp-assess',
    flags: new Map([
      ['source', source],
      ['converter-bin', script],
      ['assessment-review', reviewPath],
    ]),
    rest: [],
  });
  assert.equal(reviewed.status, 'subapp_conversion_review_accepted');
  assert.equal(reviewed.conversion_can_start, true);
  assert.equal(reviewed.candidate_preparation_available, true);
  assert.match(reviewed.confirmation_token, /^subapp_confirm_[a-f0-9]{64}$/);
});

test('candidate preparation requires and revalidates the same bound review', async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'sample-app');
  const outputRoot = path.join(root, 'candidates');
  await fs.mkdir(source);
  await fs.mkdir(outputRoot);
  const converter = converterOutput({
    risks: ['Potential command execution requires security review before conversion'],
    score: 84,
  });
  const assessed = await assessSubAppSource(
    { source },
    { runConverter: async () => converter },
  );
  const reviewInput = subAppAssessmentReviewTemplate(assessed);
  reviewInput.dispositions[0].decision = 'accepted_with_remediation';
  reviewInput.dispositions[0].rationale =
    'The risky primitive belongs to the bounded upstream calculator workflow.';
  reviewInput.dispositions[0].remediation =
    'Replace it with a non-evaluating arithmetic implementation during migration.';
  const review = validateSubAppAssessmentReview(assessed, reviewInput);
  const confirmationToken = subAppAssessmentConfirmationToken(assessed, review);
  let prepareCalls = 0;

  await assert.rejects(
    prepareSubAppCandidate(
      { source, outputRoot, confirmationToken },
      { runConverter: async () => converter },
    ),
    (error) => error?.code === 'subapp_assessment_review_required',
  );
  await assert.rejects(
    prepareSubAppCandidate(
      { source, outputRoot, confirmationToken },
      {
        assessmentReview: review,
        runConverter: async () => converter,
        runPrepare: async () => {
          prepareCalls += 1;
          throw new Error('review gate passed');
        },
      },
    ),
    /review gate passed/,
  );
  assert.equal(prepareCalls, 1);
});

test('requires an exact eligible assessment confirmation before candidate preparation', async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'sample-app');
  const outputRoot = path.join(root, 'candidates');
  await fs.mkdir(source);
  await fs.mkdir(outputRoot);
  let prepareCalls = 0;

  await assert.rejects(
    prepareSubAppCandidate(
      {
        source,
        outputRoot,
        confirmationToken: 'fake-subapp-confirmation-for-test',
      },
      {
        runConverter: async () => converterOutput(),
        runPrepare: async () => {
          prepareCalls += 1;
          return {};
        },
      },
    ),
    (error) => error?.code === 'subapp_confirmation_mismatch',
  );
  assert.equal(prepareCalls, 0);
  assert.deepEqual(await fs.readdir(outputRoot), []);
});

test('reassesses and prepares an isolated candidate without starting an Agent', async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'sample-app');
  const outputRoot = path.join(root, 'candidates');
  await fs.mkdir(path.join(source, 'app'), { recursive: true });
  await fs.mkdir(outputRoot);
  await fs.writeFile(
    path.join(source, 'package.json'),
    JSON.stringify({ name: 'sample-app', dependencies: { next: '15.0.0' } }),
  );
  await fs.writeFile(path.join(source, 'README.md'), '# Sample App\n');
  await fs.writeFile(path.join(source, 'LICENSE'), 'MIT License\n');
  await fs.writeFile(
    path.join(source, 'app', 'page.tsx'),
    'export default function Page() { return <main>Sample</main>; }\n',
  );

  const assessed = await dispatch({
    command: 'subapp-assess',
    flags: new Map([['source', source]]),
    rest: [],
  });
  const prepared = await dispatch({
    command: 'subapp-prepare',
    flags: new Map([
      ['source', source],
      ['output-root', outputRoot],
      ['confirm-assessment', assessed.confirmation_token],
      ['name', 'confirmed-candidate'],
    ]),
    rest: [],
  });

  assert.equal(prepared.status, 'subapp_candidate_prepared');
  assert.equal(prepared.phase_boundary, 'candidate_only');
  assert.equal(prepared.agent_started, false);
  assert.equal(prepared.publish_started, false);
  assert.equal(path.dirname(prepared.workspace_root), await fs.realpath(outputRoot));
  assert.match(
    await fs.readFile(path.join(prepared.workspace_root, '.taku', 'migration.json'), 'utf8'),
    /taku\.subapp-migration\.v2/,
  );
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(prepared.workspace_root, '.taku', 'service-authorizations.json'),
        'utf8',
      ),
    ),
    {
      schemaVersion: 'taku.subapp-service-authorizations.v1',
      catalogDigest: 'catalog:not-required',
      services: [],
    },
  );
  assert.deepEqual(await fs.readdir(outputRoot), ['confirmed-candidate']);

  const handoff = await dispatch({
    command: 'subapp-convert',
    flags: new Map([['candidate', prepared.workspace_root]]),
    rest: [],
  });
  assert.equal(handoff.status, 'subapp_agent_handoff_ready');
  assert.equal(handoff.agent_started, false);
  assert.equal(handoff.scripts_executed, false);
  assert.equal(handoff.action_type, 'perform_subapp_agent_migration');

  const initialCheck = await dispatch({
    command: 'subapp-conversion-check',
    flags: new Map([['candidate', prepared.workspace_root]]),
    rest: [],
  });
  assert.equal(initialCheck.status, 'subapp_conversion_needs_work');
  assert.equal(initialCheck.scripts_executed, false);

  await fs.writeFile(
    path.join(prepared.workspace_root, 'src', 'app', 'page.tsx'),
    'export default function Page() { return <main>Converted workflow</main>; }\n',
  );
  await fs.writeFile(
    path.join(prepared.workspace_root, 'src', 'converted-workflow.test.ts'),
    "import assert from 'node:assert/strict';\nimport test from 'node:test';\ntest('converted workflow', () => assert.equal(2 + 2, 4));\n",
  );
  const migrationPath = path.join(prepared.workspace_root, '.taku', 'migration.json');
  const migration = JSON.parse(await fs.readFile(migrationPath, 'utf8'));
  migration.status = 'converted';
  await fs.writeFile(migrationPath, `${JSON.stringify(migration, null, 2)}\n`);
  const convertedCheck = await dispatch({
    command: 'subapp-conversion-check',
    flags: new Map([['candidate', prepared.workspace_root]]),
    rest: [],
  });
  assert.equal(convertedCheck.status, 'subapp_conversion_static_gate_passed');
  assert.equal(convertedCheck.action_type, 'continue_to_trusted_runtime_validation');
  assert.equal(convertedCheck.publish_started, false);
});

test('rejects a stale confirmation when local source changes after assessment', async (t) => {
  const root = await temporaryDirectory(t);
  const source = path.join(root, 'sample-app');
  const outputRoot = path.join(root, 'candidates');
  await fs.mkdir(path.join(source, 'app'), { recursive: true });
  await fs.mkdir(outputRoot);
  await fs.writeFile(
    path.join(source, 'package.json'),
    JSON.stringify({ name: 'sample-app', dependencies: { next: '15.0.0' } }),
  );
  await fs.writeFile(path.join(source, 'README.md'), '# Sample App\n');
  await fs.writeFile(path.join(source, 'LICENSE'), 'MIT License\n');
  await fs.writeFile(path.join(source, 'app', 'page.tsx'), 'export default function Page() {}\n');
  const assessed = await dispatch({
    command: 'subapp-assess',
    flags: new Map([['source', source]]),
    rest: [],
  });
  await fs.writeFile(path.join(source, 'app', 'new-page.tsx'), 'export default function NewPage() {}\n');

  await assert.rejects(
    dispatch({
      command: 'subapp-prepare',
      flags: new Map([
        ['source', source],
        ['output-root', outputRoot],
        ['confirm-assessment', assessed.confirmation_token],
      ]),
      rest: [],
    }),
    (error) => error?.code === 'subapp_confirmation_mismatch',
  );
  assert.deepEqual(await fs.readdir(outputRoot), []);
});

test('fails closed on mismatched Converter routes and malformed output', () => {
  assert.throws(
    () =>
      projectConverterAssessment(
        converterOutput({ converterVersion: '0.3.0' }),
        {
          kind: 'github',
          locator: 'https://github.com/example/sample-app',
        },
      ),
    (error) => error?.code === 'subapp_converter_version_incompatible',
  );
  assert.throws(
    () =>
      projectConverterAssessment(
        converterOutput({ routeCapability: 'vite-react' }),
        {
          kind: 'github',
          locator: 'https://github.com/example/sample-app',
        },
      ),
    (error) => error?.code === 'subapp_converter_contract_mismatch',
  );
  assert.throws(
    () =>
      projectConverterAssessment(
        {
          protocol: 'repo-to-stax.analyze.v1',
          converterVersion: '0.2.0',
          analysis: {},
          route: {},
        },
        {
          kind: 'github',
          locator: 'https://github.com/example/sample-app',
        },
      ),
    (error) => error?.code === 'subapp_converter_contract_mismatch',
  );
});

function converterOutput(options = {}) {
  const appType = options.appType ?? 'nextjs';
  const route = options.route ?? 'subapp-migration';
  return {
    protocol: options.protocol ?? 'repo-to-stax.analyze.v1',
    converterVersion: options.converterVersion ?? '0.2.0',
    sourceDigest: options.sourceDigest ?? `sha256:${'a'.repeat(64)}`,
    analysis: {
      repoRoot: '/temporary/converter-cache/repo',
      source: {
        kind: 'github',
        path: '/temporary/converter-cache/repo',
        url: 'https://github.com/example/sample-app',
        repo: 'example/sample-app',
      },
      sourceUrl: 'https://github.com/example/sample-app',
      packageName: 'sample-app',
      description: 'A sample application.',
      appType,
      score: options.score ?? 90,
      recommendation: options.recommendation ?? 'convertible',
      strategy: appType === 'nextjs'
        ? 'direct-nextjs-subapp-adaptation'
        : 'native-stax-skill-import',
      license: 'MIT',
      hasReadme: true,
      hasUi: appType !== 'workflow-skill',
      reasons: ['Fixture project detected'],
      risks: options.risks ?? [],
    },
    route: {
      kind: route,
      capability: options.routeCapability ?? appType,
      reason: route === 'subapp-migration'
        ? 'An interactive application runtime was detected.'
        : 'A native capability was detected.',
      nextAction: route === 'subapp-migration'
        ? 'Create a versioned Taku SubApp migration workspace.'
        : 'Use native import.',
    },
  };
}

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'taku-subapp-assessment-test-'),
  );
  t.after(async () => {
    await setTreeWritable(directory).catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}
