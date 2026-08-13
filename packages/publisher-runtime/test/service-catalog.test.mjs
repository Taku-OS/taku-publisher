import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  assessSubAppSource,
  fetchTakuServiceCatalog,
  PublisherError,
  resolveTakuServiceCatalogUrl,
  setTreeWritable,
  subAppAssessmentConfirmationToken,
  TAKU_USER_JWT_KIND,
  validateSubAppServiceMappings,
} from '../dist/index.js';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

test('accepts production and loopback catalog URLs but rejects arbitrary origins', () => {
  assert.equal(
    resolveTakuServiceCatalogUrl(undefined, {}),
    'https://ai-proxy.taku.ai/service/catalog/v1',
  );
  assert.equal(
    resolveTakuServiceCatalogUrl('http://127.0.0.1:7819'),
    'http://127.0.0.1:7819/service/catalog/v1',
  );
  assert.equal(
    resolveTakuServiceCatalogUrl(undefined, {
      TAKU_AI_PROXY_BASE_URL: 'http://localhost:7819/service',
    }),
    'http://localhost:7819/service/catalog/v1',
  );
  assert.throws(
    () => resolveTakuServiceCatalogUrl('https://example.com/service/catalog/v1'),
    (error) => error?.code === 'service_catalog_url_untrusted',
  );
});

test('fetches and validates the Proxy catalog contract and ETag', async () => {
  const raw = proxyCatalog(DIGEST_A);
  let requested;
  const catalog = await fetchTakuServiceCatalog({
    url: 'http://127.0.0.1:7819/service/catalog/v1',
    fetchImpl: async (url, init) => {
      requested = { url, init };
      return new Response(JSON.stringify(raw), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          etag: `"${DIGEST_A}"`,
        },
      });
    },
  });

  assert.equal(requested.url, 'http://127.0.0.1:7819/service/catalog/v1');
  assert.equal(requested.init.redirect, 'error');
  assert.equal(catalog.schemaVersion, 'taku.service-catalog.v1');
  assert.equal(catalog.digest, DIGEST_A);
  assert.equal(catalog.services[0].id, 'weatherapi');
  assert.equal(catalog.services[0].endpoints[0].id, 'current');
  assert.equal(catalog.services[0].endpoints[0].pricing.price.unitUsd, 0.01);
});

test('rejects malformed catalogs and digest drift', async () => {
  await assert.rejects(
    fetchTakuServiceCatalog({
      url: 'http://localhost:7819/service/catalog/v1',
      fetchImpl: async () => new Response(
        JSON.stringify(proxyCatalog(DIGEST_A)),
        { status: 200, headers: { etag: `"${DIGEST_B}"` } },
      ),
    }),
    (error) => error?.code === 'service_catalog_digest_mismatch',
  );

  const malformed = proxyCatalog(DIGEST_A);
  malformed.services[0].endpoints[0].path = 'https://upstream.example/current';
  await assert.rejects(
    fetchTakuServiceCatalog({
      url: 'http://localhost:7819/service/catalog/v1',
      fetchImpl: async () => new Response(JSON.stringify(malformed)),
    }),
    (error) => error?.code === 'service_catalog_invalid',
  );
});

test('accepts the endpoint ID format already used by the live Proxy catalog', async () => {
  const raw = proxyCatalog(DIGEST_A);
  raw.services[0].endpoints[0].id =
    'weather.currentConditions.getJson.v1.7aca3c4a';
  const catalog = await fetchTakuServiceCatalog({
    url: 'http://127.0.0.1:7819/service/catalog/v1',
    fetchImpl: async () => new Response(JSON.stringify(raw)),
  });

  assert.equal(
    catalog.services[0].endpoints[0].id,
    'weather.currentConditions.getJson.v1.7aca3c4a',
  );
});

test('validates exact mapped service and endpoint IDs', async () => {
  const catalog = await parsedCatalog(DIGEST_A);
  const requirement = mappedWeatherRequirement();
  const accepted = validateSubAppServiceMappings([requirement], catalog);
  assert.equal(accepted.mappedRequirementsChecked, 1);
  assert.equal(accepted.requirements[0].mapping.status, 'mapped');

  const missing = validateSubAppServiceMappings([
    {
      ...requirement,
      mapping: {
        status: 'mapped',
        serviceId: 'weatherapi',
        endpointIds: ['missing'],
      },
    },
  ], catalog);
  assert.equal(missing.requirements[0].mapping.status, 'unavailable');
  assert.match(missing.requirements[0].mapping.reason, /missing/);
});

test('binds a verified catalog digest into SubApp assessment confirmation', async (t) => {
  const source = await localSource(t);
  const first = await assessSubAppSource(
    { source },
    {
      runConverter: async () => converterOutput([mappedWeatherRequirement()]),
      serviceCatalogUrl: 'http://127.0.0.1:7819',
      loadServiceCatalog: async () => parsedCatalog(DIGEST_A),
    },
  );
  const second = await assessSubAppSource(
    { source },
    {
      runConverter: async () => converterOutput([mappedWeatherRequirement()]),
      serviceCatalogUrl: 'http://127.0.0.1:7819',
      loadServiceCatalog: async () => parsedCatalog(DIGEST_B),
    },
  );

  assert.equal(first.assessment.eligibility, 'eligible');
  assert.equal(first.serviceCatalog.status, 'validated');
  assert.equal(first.serviceCatalog.digest, DIGEST_A);
  assert.notEqual(
    subAppAssessmentConfirmationToken(first),
    subAppAssessmentConfirmationToken(second),
  );
});

test('fails closed when a mapped service cannot be checked', async (t) => {
  const source = await localSource(t);
  const result = await assessSubAppSource(
    { source },
    {
      runConverter: async () => converterOutput([mappedWeatherRequirement()]),
      serviceCatalogUrl: 'http://127.0.0.1:7819',
      loadServiceCatalog: async () => {
        throw new PublisherError(
          'Local Proxy is unavailable.',
          'service_catalog_unavailable',
        );
      },
    },
  );

  assert.equal(result.serviceCatalog.status, 'unavailable');
  assert.equal(result.assessment.eligibility, 'review-required');
  assert.equal(
    result.assessment.serviceRequirements[0].mapping.status,
    'review-required',
  );
  assert.equal(result.assessment.nextStep, 'manual-review');
});

test('rejects a mapped endpoint absent from the current catalog', async (t) => {
  const source = await localSource(t);
  const requirement = mappedWeatherRequirement();
  requirement.mapping.endpointIds = ['removed_endpoint'];
  const result = await assessSubAppSource(
    { source },
    {
      runConverter: async () => converterOutput([requirement]),
      serviceCatalogUrl: 'http://127.0.0.1:7819',
      loadServiceCatalog: async () => parsedCatalog(DIGEST_A),
    },
  );

  assert.equal(result.serviceCatalog.status, 'validated');
  assert.equal(result.assessment.eligibility, 'rejected');
  assert.equal(
    result.assessment.serviceRequirements[0].mapping.status,
    'unavailable',
  );
  assert.equal(result.assessment.nextStep, 'stop');
});

async function parsedCatalog(digest) {
  return await fetchTakuServiceCatalog({
    url: 'http://127.0.0.1:7819/service/catalog/v1',
    fetchImpl: async () => new Response(
      JSON.stringify(proxyCatalog(digest)),
      { status: 200, headers: { etag: `"${digest}"` } },
    ),
  });
}

function proxyCatalog(digest) {
  return {
    schema_version: 'taku.service-catalog.v1',
    digest,
    service_count: 1,
    endpoint_count: 1,
    authentication: {
      required: true,
      scheme: 'bearer',
      credential: TAKU_USER_JWT_KIND,
    },
    services: [
      {
        id: 'weatherapi',
        title: 'Weather API',
        description: 'Current weather data.',
        base_path: '/service/weatherapi',
        docs_path: '/service/docs/weatherapi.md',
        status: 'active',
        endpoints: [
          {
            id: 'current',
            method: 'GET',
            path: '/service/weatherapi/current',
            summary: 'Get current weather.',
            input_schema: '- **`q`** (`string`, _required_): Location',
            status: 'active',
            pricing: {
              billing_mode: 'invocation',
              price: { unit_usd: 0.01 },
            },
          },
        ],
      },
    ],
  };
}

function mappedWeatherRequirement() {
  return {
    id: 'current-weather',
    capability: 'current weather lookup',
    required: true,
    detectedProvider: 'WeatherAPI',
    operations: ['current-weather'],
    dataClasses: ['location'],
    mutation: false,
    mapping: {
      status: 'mapped',
      serviceId: 'weatherapi',
      endpointIds: ['current'],
    },
  };
}

function converterOutput(serviceRequirements) {
  return {
    protocol: 'repo-to-stax.analyze.v1',
    converterVersion: '0.2.0',
    sourceDigest: `sha256:${'c'.repeat(64)}`,
    serviceRequirements,
    analysis: {
      source: { kind: 'local' },
      packageName: 'weather-app',
      description: 'Weather application.',
      appType: 'nextjs',
      score: 90,
      recommendation: 'convertible',
      strategy: 'direct-nextjs-subapp-adaptation',
      license: 'MIT',
      hasReadme: true,
      hasUi: true,
      reasons: ['Fixture project detected'],
      risks: [],
    },
    route: {
      kind: 'subapp-migration',
      capability: 'nextjs',
      reason: 'An interactive application runtime was detected.',
      nextAction: 'Create a versioned Taku SubApp migration workspace.',
    },
  };
}

async function localSource(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-service-catalog-test-'));
  const source = path.join(root, 'app');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'package.json'), '{"name":"weather-app"}\n');
  t.after(async () => {
    await setTreeWritable(root).catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  });
  return source;
}
