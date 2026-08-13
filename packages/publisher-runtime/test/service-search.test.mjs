import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  assessSubAppSource,
  dispatch,
  discoverSubAppServiceCandidates,
  fetchTakuServiceSearch,
  resolveTakuServiceSearchUrl,
  setTreeWritable,
  subAppAssessmentConfirmationToken,
  TAKU_USER_JWT_KIND,
} from '../dist/index.js';

const CATALOG_DIGEST = `sha256:${'a'.repeat(64)}`;

test('derives service search only from a trusted Catalog origin', () => {
  assert.equal(
    resolveTakuServiceSearchUrl('https://ai-proxy.taku.ai/service/catalog/v1'),
    'https://ai-proxy.taku.ai/service/search',
  );
  assert.equal(
    resolveTakuServiceSearchUrl('http://127.0.0.1:7819/service/catalog/v1'),
    'http://127.0.0.1:7819/service/search',
  );
  assert.throws(
    () => resolveTakuServiceSearchUrl('https://example.com/service/catalog/v1'),
    (error) => error?.code === 'service_catalog_url_untrusted',
  );
});

test('fetches and validates versioned exact service search results', async () => {
  let requested;
  const result = await fetchTakuServiceSearch({
    url: 'http://localhost:7819/service/search',
    query: 'current weather',
    limit: 3,
    fetchImpl: async (url, init) => {
      requested = { url: String(url), init };
      return new Response(JSON.stringify(searchResponse('current weather')));
    },
  });

  const url = new URL(requested.url);
  assert.equal(url.pathname, '/service/search');
  assert.equal(url.searchParams.get('q'), 'current weather');
  assert.equal(url.searchParams.get('limit'), '3');
  assert.equal(requested.init.redirect, 'error');
  assert.equal(result.schemaVersion, 'taku.service-search.v1');
  assert.equal(result.results[0].endpointId, 'current');
});

test('cross-checks suggestions against the authoritative active Catalog', async () => {
  const catalog = proxyCatalog();
  const discovery = await discoverSubAppServiceCandidates(
    [unresolvedRequirement()],
    catalog,
    {
      url: 'http://127.0.0.1:7819/service/catalog/v1',
      limit: 5,
      loadSearch: async ({ query }) => ({
        schemaVersion: 'taku.service-search.v1',
        query,
        results: [
          searchResult('weatherapi', 'removed'),
          searchResult('weatherapi', 'current'),
          searchResult('weatherapi', 'current'),
        ],
      }),
    },
  );

  assert.equal(discovery.status, 'completed');
  assert.equal(discovery.catalogDigest, CATALOG_DIGEST);
  assert.equal(discovery.requirements[0].status, 'suggestions-ready');
  assert.deepEqual(
    discovery.requirements[0].candidates.map((candidate) => candidate.endpointId),
    ['current'],
  );
  assert.equal(
    discovery.requirements[0].candidates[0].pricing.price.unitUsd,
    0.01,
  );
});

test('assessment suggests candidates but never selects one automatically', async (t) => {
  const source = await localSource(t);
  const assessed = await assessSubAppSource(
    { source },
    {
      runConverter: async () => converterOutput(),
      loadServiceCatalog: async () => proxyCatalog(),
      loadServiceSearch: async ({ query }) => ({
        schemaVersion: 'taku.service-search.v1',
        query,
        results: [searchResult('weatherapi', 'current')],
      }),
      serviceCatalogUrl: 'http://127.0.0.1:7819',
    },
  );

  assert.equal(assessed.assessment.eligibility, 'review-required');
  assert.equal(
    assessed.assessment.serviceRequirements[0].mapping.status,
    'review-required',
  );
  assert.equal(
    assessed.serviceDiscovery.requirements[0].candidates[0].endpointId,
    'current',
  );
});

test('explicit reviewed mapping is catalog-validated and becomes confirmable', async (t) => {
  const source = await localSource(t);
  let searchCalls = 0;
  const assessed = await assessSubAppSource(
    { source },
    {
      runConverter: async () => converterOutput(),
      loadServiceCatalog: async () => proxyCatalog(),
      loadServiceSearch: async () => {
        searchCalls += 1;
        throw new Error('search must not run after all mappings are explicit');
      },
      serviceCatalogUrl: 'http://127.0.0.1:7819',
      serviceMappings: mappingDocument(),
    },
  );

  assert.equal(searchCalls, 0);
  assert.equal(assessed.assessment.eligibility, 'eligible');
  assert.equal(assessed.assessment.analysis.risks.length, 0);
  assert.equal(assessed.serviceCatalog.mappedRequirementsChecked, 1);
  assert.equal(assessed.serviceMappingReview.requirementIds[0], 'external-service-review');
  assert.match(assessed.serviceMappingReview.digest, /^sha256:[a-f0-9]{64}$/);
  assert.match(
    subAppAssessmentConfirmationToken(assessed),
    /^subapp_confirm_[a-f0-9]{64}$/,
  );
});

test('CLI exposes suggestions and accepts the same explicit mapping file', async (t) => {
  const source = await localSource(t);
  const root = path.dirname(source);
  const converter = path.join(root, 'fake-converter.mjs');
  const mappings = path.join(root, 'service-mappings.json');
  await fs.writeFile(
    converter,
    `process.stdout.write(${JSON.stringify(JSON.stringify(converterOutput()))});\n`,
  );
  await fs.writeFile(mappings, JSON.stringify(mappingDocument()));
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url?.startsWith('/service/catalog/v1')) {
      response.end(JSON.stringify(rawProxyCatalog()));
      return;
    }
    if (request.url?.startsWith('/service/search')) {
      const query = new URL(request.url, 'http://localhost').searchParams.get('q');
      response.end(JSON.stringify(searchResponse(query)));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const proxyUrl = `http://127.0.0.1:${address.port}`;

  const suggested = await dispatch({
    command: 'subapp-assess',
    flags: new Map([
      ['source', source],
      ['converter-bin', converter],
      ['service-catalog-url', proxyUrl],
    ]),
    rest: [],
  });
  assert.equal(suggested.status, 'subapp_conversion_review_required');
  assert.equal(suggested.action_type, 'confirm_subapp_service_mapping');
  assert.equal(
    suggested.service_discovery.requirements[0].candidates[0].endpointId,
    'current',
  );

  const confirmed = await dispatch({
    command: 'subapp-assess',
    flags: new Map([
      ['source', source],
      ['converter-bin', converter],
      ['service-catalog-url', proxyUrl],
      ['service-mappings', mappings],
    ]),
    rest: [],
  });
  assert.equal(confirmed.status, 'subapp_conversion_eligible');
  assert.equal(confirmed.action_type, 'confirm_subapp_conversion');
  assert.equal(confirmed.service_mapping_review.requirementIds[0], 'external-service-review');
});

function proxyCatalog() {
  return {
    schemaVersion: 'taku.service-catalog.v1',
    digest: CATALOG_DIGEST,
    authentication: {
      required: true,
      scheme: 'bearer',
      credential: TAKU_USER_JWT_KIND,
    },
    services: [
      {
        id: 'weatherapi',
        title: 'Weather API',
        description: 'Weather data.',
        basePath: '/service/weatherapi',
        docsPath: '/service/docs/weatherapi.md',
        status: 'active',
        endpoints: [
          {
            id: 'current',
            method: 'GET',
            path: '/service/weatherapi/current',
            summary: 'Current weather.',
            inputSchema: 'q string',
            status: 'active',
            pricing: {
              billingMode: 'invocation',
              price: { unitUsd: 0.01 },
            },
          },
        ],
      },
    ],
  };
}

function rawProxyCatalog() {
  return {
    schema_version: 'taku.service-catalog.v1',
    digest: CATALOG_DIGEST,
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
        description: 'Weather data.',
        base_path: '/service/weatherapi',
        docs_path: '/service/docs/weatherapi.md',
        status: 'active',
        endpoints: [
          {
            id: 'current',
            method: 'GET',
            path: '/service/weatherapi/current',
            summary: 'Current weather.',
            input_schema: 'q string',
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

function searchResponse(query) {
  return {
    schema_version: 'taku.service-search.v1',
    query,
    count: 1,
    results: [
      {
        id: 'weatherapi:current',
        service_id: 'weatherapi',
        endpoint_id: 'current',
        service_title: 'Weather API',
        method: 'GET',
        path: '/service/weatherapi/current',
        summary: 'Current weather.',
        input_schema: 'q string',
        score: 0.95,
      },
    ],
  };
}

function searchResult(serviceId, endpointId) {
  return {
    serviceId,
    endpointId,
    serviceTitle: 'Search copy',
    method: 'GET',
    path: `/service/${serviceId}/${endpointId}`,
    summary: 'Search copy.',
    inputSchema: '',
    score: 0.9,
  };
}

function unresolvedRequirement() {
  return {
    id: 'current-weather',
    capability: 'current weather lookup',
    required: true,
    detectedProvider: 'WeatherAPI',
    operations: ['current-weather'],
    dataClasses: ['location'],
    mutation: false,
    mapping: {
      status: 'review-required',
      reason: 'Select an exact Taku endpoint.',
    },
  };
}

function converterOutput() {
  return {
    protocol: 'repo-to-stax.analyze.v1',
    converterVersion: '0.2.0',
    sourceDigest: `sha256:${'c'.repeat(64)}`,
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
      risks: [
        'Credential/API key handling must be server-side or explicit BYOK',
      ],
    },
    route: {
      kind: 'subapp-migration',
      capability: 'nextjs',
      reason: 'An interactive application runtime was detected.',
      nextAction: 'Create a versioned Taku SubApp migration workspace.',
    },
  };
}

function mappingDocument() {
  return {
    schema_version: 'taku.subapp-service-mappings.v1',
    mappings: [
      {
        requirement_id: 'external-service-review',
        service_id: 'weatherapi',
        endpoint_ids: ['current'],
      },
    ],
  };
}

async function localSource(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-service-search-test-'));
  const source = path.join(root, 'app');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'package.json'), '{"name":"weather-app"}\n');
  t.after(async () => {
    await setTreeWritable(root).catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  });
  return source;
}
