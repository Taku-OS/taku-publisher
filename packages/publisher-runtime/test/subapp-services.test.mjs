import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  buildSubAppServiceAuthorizationDocument,
  readSubAppServiceAuthorizations,
} from '../dist/subapp-services.js';

test('projects confirmed service mappings into a minimal versioned authorization document', async () => {
  const document = buildSubAppServiceAuthorizationDocument([
    {
      id: 'weather',
      capability: 'current weather',
      required: true,
      operations: ['read'],
      dataClasses: ['public'],
      mutation: false,
      mapping: {
        status: 'mapped',
        serviceId: 'weatherapi',
        endpointIds: [
          'weather_api.current.retrieve.v1.eb62c855',
          'weather_api.current.retrieve.v1.eb62c855',
        ],
      },
    },
  ], 'sha256:catalog');

  assert.deepEqual(document, {
    schemaVersion: 'taku.subapp-service-authorizations.v1',
    catalogDigest: 'sha256:catalog',
    services: [{
      serviceId: 'weatherapi',
      endpointIds: ['weather_api.current.retrieve.v1.eb62c855'],
    }],
  });
});

test('reads the exact generated document and rejects malformed declarations', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'subapp-services-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.taku'));
  await fs.writeFile(path.join(root, '.taku', 'service-authorizations.json'), JSON.stringify({
    schemaVersion: 'taku.subapp-service-authorizations.v1',
    catalogDigest: 'sha256:catalog',
    services: [{ serviceId: 'weatherapi', endpointIds: ['weather.current'] }],
  }));
  assert.deepEqual(await readSubAppServiceAuthorizations(root), [
    { serviceId: 'weatherapi', endpointIds: ['weather.current'] },
  ]);

  await fs.writeFile(path.join(root, '.taku', 'service-authorizations.json'), '{"services":[]}');
  await assert.rejects(
    readSubAppServiceAuthorizations(root),
    error => error?.code === 'subapp_service_authorizations_invalid',
  );
});
