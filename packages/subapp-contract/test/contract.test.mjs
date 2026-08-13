import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  SUBAPP_ASSESSMENT_SCHEMA_VERSION,
  SUBAPP_BUILD_ARCHIVE_FILE,
  SUBAPP_CONTRACT_VERSION,
  SUBAPP_MIGRATION_SCHEMA_VERSION,
  SUBAPP_RELEASE_SCHEMA_VERSION,
  SUBAPP_SOURCE_ARCHIVE_FILE,
  SUBAPP_VALIDATION_SCHEMA_VERSION,
  assertSubAppAssessment,
  assertSubAppMigrationRecord,
  assertSubAppRelease,
  assertSubAppValidationResult,
  assertTakuSubAppRuntimeManifest,
  canonicalSubAppJson,
  createSubAppAssessment,
  hashCanonicalSubApp,
} from '../dist/index.js';

const fixture = JSON.parse(
  await readFile(
    new URL('../fixtures/canonical-v1.json', import.meta.url),
    'utf8',
  ),
);

test('projects converter analysis into a private, deterministic eligibility decision', () => {
  const assessment = createSubAppAssessment(fixture.assessmentInput);

  assert.deepEqual(assessment, fixture.assessment);
  assert.equal(assessment.schemaVersion, SUBAPP_ASSESSMENT_SCHEMA_VERSION);
  assert.equal(assessment.contractVersion, SUBAPP_CONTRACT_VERSION);
  assert.equal(assessment.eligibility, 'eligible');
  assert.equal(assessment.nextStep, 'start-conversion');
  assert.equal(assertSubAppAssessment(assessment), assessment);
});

test('requires review for uncertain apps and rejects non-SubApp routes', () => {
  const review = createSubAppAssessment({
    ...fixture.assessmentInput,
    analysis: {
      ...fixture.assessmentInput.analysis,
      score: 60,
      recommendation: 'manual-review',
      risks: ['External credentials need a managed-service mapping'],
    },
  });
  assert.equal(review.eligibility, 'review-required');
  assert.equal(review.nextStep, 'manual-review');
  assert.equal(review.findings[0].severity, 'warning');

  const native = createSubAppAssessment({
    ...fixture.assessmentInput,
    analysis: {
      ...fixture.assessmentInput.analysis,
      appType: 'workflow-skill',
      recommendation: 'convertible',
    },
    route: {
      kind: 'native-import',
      capability: 'workflow-skill',
      reason: 'A native Taku Skill was detected.',
      nextAction: 'Use native import.',
    },
  });
  assert.equal(native.eligibility, 'rejected');
  assert.equal(native.nextStep, 'native-import');
  assert.equal(native.findings.at(-1).severity, 'blocker');
});

test('makes Taku proxy service mapping part of conversion eligibility', () => {
  const review = createSubAppAssessment({
    ...fixture.assessmentInput,
    serviceRequirements: [
      {
        ...fixture.assessmentInput.serviceRequirements[0],
        mapping: {
          status: 'review-required',
          reason: 'The source operation has external write effects that need review.',
        },
      },
    ],
  });
  assert.equal(review.eligibility, 'review-required');
  assert.equal(review.nextStep, 'manual-review');

  const rejected = createSubAppAssessment({
    ...fixture.assessmentInput,
    serviceRequirements: [
      {
        ...fixture.assessmentInput.serviceRequirements[0],
        mapping: {
          status: 'unavailable',
          reason: 'No compatible Taku-managed endpoint exists.',
        },
      },
    ],
  });
  assert.equal(rejected.eligibility, 'rejected');
  assert.equal(rejected.nextStep, 'stop');
  assert.equal(
    rejected.findings.at(-1).code,
    'service.mapping-unavailable',
  );
});

test('accepts exact case-sensitive endpoint IDs from the Proxy catalog', () => {
  const assessment = createSubAppAssessment({
    ...fixture.assessmentInput,
    serviceRequirements: [
      {
        ...fixture.assessmentInput.serviceRequirements[0],
        mapping: {
          status: 'mapped',
          serviceId: 'weatherapi',
          endpointIds: ['weather.currentConditions.getJson.v1.7aca3c4a'],
        },
      },
    ],
  });

  assert.equal(assessment.eligibility, 'eligible');
  assert.equal(
    assessment.serviceRequirements[0].mapping.endpointIds[0],
    'weather.currentConditions.getJson.v1.7aca3c4a',
  );
});

test('fails closed when assessment eligibility or next step is caller-forged', () => {
  assert.throws(
    () =>
      assertSubAppAssessment({
        ...fixture.assessment,
        eligibility: 'rejected',
      }),
    /eligibility must be eligible/,
  );
  assert.throws(
    () =>
      assertSubAppAssessment({
        ...fixture.assessment,
        nextStep: 'manual-review',
      }),
    /nextStep must be start-conversion/,
  );
  assert.throws(
    () =>
      assertSubAppAssessment({
        ...fixture.assessment,
        route: {
          ...fixture.assessment.route,
          capability: 'vite-react',
        },
      }),
    /capability must match/,
  );
});

test('accepts converter migration v2 only when converted risks are resolved', () => {
  assert.equal(
    assertSubAppMigrationRecord(fixture.migration),
    fixture.migration,
  );
  assert.equal(fixture.migration.schemaVersion, SUBAPP_MIGRATION_SCHEMA_VERSION);

  assert.throws(
    () =>
      assertSubAppMigrationRecord({
        ...fixture.migration,
        analysis: {
          ...fixture.migration.analysis,
          riskResolutions: [],
        },
      }),
    /resolve every recorded risk/,
  );
});

test('keeps validation status and summaries consistent', () => {
  assert.equal(
    assertSubAppValidationResult(fixture.validation),
    fixture.validation,
  );
  assert.equal(
    fixture.validation.schemaVersion,
    SUBAPP_VALIDATION_SCHEMA_VERSION,
  );

  assert.throws(
    () =>
      assertSubAppValidationResult({
        ...fixture.validation,
        ok: true,
        findings: [
          {
            severity: 'error',
            code: 'publish.authority-unavailable',
            message: 'Authenticated Taku publish authority is unavailable.',
          },
        ],
        errors: ['Authenticated Taku publish authority is unavailable.'],
      }),
    /ok must be false/,
  );
});

test('matches the existing Taku runtime manifest and keeps migration metadata out', () => {
  assert.equal(
    assertTakuSubAppRuntimeManifest(fixture.runtimeManifest),
    fixture.runtimeManifest,
  );

  assert.throws(
    () =>
      assertTakuSubAppRuntimeManifest({
        ...fixture.runtimeManifest,
        conversionStatus: 'converted',
      }),
    /unknown field "conversionStatus"/,
  );
  assert.throws(
    () =>
      assertTakuSubAppRuntimeManifest({
        ...fixture.runtimeManifest,
        actions: [
          fixture.runtimeManifest.actions[0],
          fixture.runtimeManifest.actions[0],
        ],
      }),
    /Duplicate SubApp Action name/,
  );
});

test('models the current dual-archive release consumed by Taku Desktop', () => {
  const release = assertSubAppRelease(fixture.release);

  assert.equal(release.schemaVersion, SUBAPP_RELEASE_SCHEMA_VERSION);
  assert.equal(release.source.fileName, SUBAPP_SOURCE_ARCHIVE_FILE);
  assert.equal(release.build.fileName, SUBAPP_BUILD_ARCHIVE_FILE);
  assert.equal(release.publishManifest.sourceHash, release.source.sha256);
  assert.equal(release.publishManifest.buildHash, release.build.sha256);
});

test('rejects private fields, local paths, secrets, and artifact drift from public releases', () => {
  assert.throws(
    () =>
      assertSubAppRelease({
        ...fixture.release,
        locator: '/tmp/private-project',
      }),
    /forbidden field locator/,
  );
  assert.throws(
    () =>
      assertSubAppRelease({
        ...fixture.release,
        publishManifest: {
          ...fixture.release.publishManifest,
          releaseNotes: [
            '',
            'Users',
            'example',
            'private-project',
          ].join('/'),
        },
      }),
    /private content/,
  );
  assert.throws(
    () =>
      assertSubAppRelease({
        ...fixture.release,
        source: {
          ...fixture.release.source,
          sha256: 'b'.repeat(64),
        },
      }),
    /sourceHash must be/,
  );
});

test('produces canonical JSON and stable fixture hashes across consumers', () => {
  assert.equal(
    canonicalSubAppJson({ b: 2, a: { d: 4, c: 3 } }),
    '{"a":{"c":3,"d":4},"b":2}',
  );
  assert.equal(
    hashCanonicalSubApp(fixture.assessment),
    fixture.expected.assessmentHash,
  );
  assert.equal(
    hashCanonicalSubApp(fixture.migration),
    fixture.expected.migrationHash,
  );
  assert.equal(
    hashCanonicalSubApp(fixture.release),
    fixture.expected.releaseHash,
  );
});

test('ships parseable schemas aligned to the runtime constants', async () => {
  for (const [relativePath, schemaVersion] of [
    [
      '../schemas/subapp-assessment.v1.schema.json',
      SUBAPP_ASSESSMENT_SCHEMA_VERSION,
    ],
    [
      '../schemas/subapp-migration.v2.schema.json',
      SUBAPP_MIGRATION_SCHEMA_VERSION,
    ],
    [
      '../schemas/subapp-validation.v1.schema.json',
      SUBAPP_VALIDATION_SCHEMA_VERSION,
    ],
    [
      '../schemas/subapp-release.v1.schema.json',
      SUBAPP_RELEASE_SCHEMA_VERSION,
    ],
  ]) {
    const schema = JSON.parse(
      await readFile(new URL(relativePath, import.meta.url), 'utf8'),
    );
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.type, 'object');
    assert.equal(schema.properties.schemaVersion.const, schemaVersion);
    if (schema.properties.contractVersion) {
      assert.equal(
        schema.properties.contractVersion.const,
        SUBAPP_CONTRACT_VERSION,
      );
    }
  }

  const runtimeSchema = JSON.parse(
    await readFile(
      new URL(
        '../schemas/subapp-runtime-manifest.v1.schema.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.equal(runtimeSchema.type, 'object');
  assert.equal(runtimeSchema.properties.schemaVersion, undefined);
});

test('keeps package metadata and runtime contract version aligned', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(packageJson.version, SUBAPP_CONTRACT_VERSION);
});
