import assert from 'node:assert/strict';
import test from 'node:test';

import { applySubAppServiceMappings } from '../dist/index.js';

test('applies a versioned explicit mapping document deterministically', () => {
  const first = applySubAppServiceMappings(requirements(), document());
  const second = applySubAppServiceMappings(requirements(), document());

  assert.equal(first.requirements[0].mapping.status, 'mapped');
  assert.equal(first.requirements[0].mapping.serviceId, 'abs');
  assert.equal(
    first.requirements[0].mapping.endpointIds[0],
    'abs_au.codelist.retrieve.v1',
  );
  assert.equal(first.review.digest, second.review.digest);
});

test('rejects unknown requirements, duplicate mappings, and extra fields', () => {
  const unknown = document();
  unknown.mappings[0].requirement_id = 'unknown';
  assert.throws(
    () => applySubAppServiceMappings(requirements(), unknown),
    (error) => error?.code === 'subapp_service_mappings_invalid',
  );

  const duplicate = document();
  duplicate.mappings.push({ ...duplicate.mappings[0] });
  assert.throws(
    () => applySubAppServiceMappings(requirements(), duplicate),
    (error) => error?.code === 'subapp_service_mappings_invalid',
  );

  const extra = document();
  extra.mappings[0].upstream_url = 'https://provider.example';
  assert.throws(
    () => applySubAppServiceMappings(requirements(), extra),
    (error) => error?.code === 'subapp_service_mappings_invalid',
  );
});

function requirements() {
  return [
    {
      id: 'statistics-code-list',
      capability: 'statistics code list',
      required: true,
      operations: ['retrieve-code-list'],
      dataClasses: ['public-statistics'],
      mutation: false,
      mapping: {
        status: 'review-required',
        reason: 'Select an exact endpoint.',
      },
    },
  ];
}

function document() {
  return {
    schema_version: 'taku.subapp-service-mappings.v1',
    mappings: [
      {
        requirement_id: 'statistics-code-list',
        service_id: 'abs',
        endpoint_ids: ['abs_au.codelist.retrieve.v1'],
      },
    ],
  };
}
