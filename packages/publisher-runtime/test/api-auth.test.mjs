import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  authHasScope,
  buildLoginUrl,
  draftCreatePayload,
  extractDraftListing,
  normalizeListingMetadata,
  publisherDraftArtifactCompletePath,
  publisherDraftPath,
  PublisherError,
  resolveAuth,
  savePublisherSession,
  setTreeWritable,
  TakuPublisherClient,
} from '../dist/index.js';

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-publisher-api-'));
  t.after(async () => {
    await setTreeWritable(directory).catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function listenOnLoopback(t, server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('scoped Publisher session is resolved without exposing or widening scopes', async (t) => {
  const root = await temporaryDirectory(t);
  const env = { ...process.env, TAKU_PUBLISHER_HOME: root };
  const publisherToken = ['taku', 'pub', 'session', 'fixture'].join('_');
  await savePublisherSession({
    accessToken: publisherToken,
    expiresAt: Date.now() + 60_000,
    scopes: ['marketplace.packages.read'],
  }, env);

  const auth = await resolveAuth({ env });
  assert.equal(auth.source, 'publisher_session');
  assert.equal(auth.token, publisherToken);
  assert.equal(auth.iconToken, '');
  assert.equal(authHasScope(auth, 'marketplace.packages.read'), true);
  assert.equal(authHasScope(auth, 'publisher.drafts.write'), false);
});

test('API client keeps public reads unauthenticated and fails closed on writes', async () => {
  const requests = [];
  const transport = async (method, url, headers, body) => {
    requests.push({ method, url, headers, body });
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"data":[]}'),
    };
  };
  const publicClient = new TakuPublisherClient({ transport });
  await publicClient.searchMarketplace('review', 'app', 10, 12);
  assert.equal(requests[0].method, 'GET');
  assert.equal('Authorization' in requests[0].headers, false);
  const marketplaceUrl = new URL(requests[0].url);
  assert.equal(marketplaceUrl.pathname, '/marketplace/items');
  assert.equal(marketplaceUrl.searchParams.get('source'), 'all');
  assert.equal(marketplaceUrl.searchParams.get('q'), 'review');
  assert.equal(marketplaceUrl.searchParams.get('kind'), 'app');
  assert.equal(marketplaceUrl.searchParams.get('cursor'), '12');
  assert.equal(marketplaceUrl.searchParams.has('type'), false);

  await assert.rejects(
    publicClient.createDraft({ mode: 'create' }),
    (error) => error instanceof PublisherError && error.code === 'missing_auth',
  );

  const publisherToken = ['publisher', 'token', 'fixture'].join('-');
  const authenticated = new TakuPublisherClient({ token: publisherToken, transport });
  await authenticated.createDraft({ mode: 'create' });
  assert.equal(requests[1].headers.Authorization, ['Bearer', publisherToken].join(' '));
});

test('publisher uploads authorize only the Worker-owned proxy URL', async (t) => {
  const root = await temporaryDirectory(t);
  const bundle = path.join(root, 'bundle.zip');
  await fs.writeFile(bundle, Buffer.from('zip'));
  const requests = [];
  const transport = async (method, url, headers, body) => {
    requests.push({ method, url, headers, body });
    const response = url.endsWith('/artifacts/presign')
      ? {
          artifactId: 'artifact_1',
          uploadUrl: 'https://worker.example.test/stax/publisher/drafts/draft_1/artifacts/artifact_1/upload',
        }
      : { id: 'draft_1', ok: true };
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify(response)),
    };
  };
  const publisherToken = ['publisher', 'auth', 'fixture'].join('-');
  const client = new TakuPublisherClient({
    workerUrl: 'https://worker.example.test',
    token: publisherToken,
    allowCustomWorkerUrl: true,
    transport,
  });

  await client.createDraft({ mode: 'create' });
  await client.getDraft('draft_1');
  await client.updateDraft('draft_1', { title: 'Safe title' });
  await client.submitScanReport('draft_1', { summary: {} });
  const presigned = await client.presignArtifact('draft_1', 3, 'a'.repeat(64));
  await client.uploadSigned(String(presigned.uploadUrl), bundle);
  await client.uploadSigned('https://uploads.example.test/object', bundle);
  await client.completeArtifact('draft_1', 'artifact_1', 3, 'a'.repeat(64));
  await client.submitDraft('draft_1');
  await client.getStatus('draft_1');

  const apiRequests = requests.filter(({ url }) => url.includes('worker.example.test'));
  assert.equal(apiRequests.length, 9);
  assert.equal(
    apiRequests.every(({ headers }) => headers.Authorization === ['Bearer', publisherToken].join(' ')),
    true,
  );
  const uploadRequest = requests.find(({ method }) => method === 'PUT');
  assert.ok(uploadRequest);
  assert.equal(uploadRequest.headers.Authorization, ['Bearer', publisherToken].join(' '));
  assert.equal('Cookie' in uploadRequest.headers, false);
  assert.equal(uploadRequest.headers['Content-Type'], 'application/zip');
  const externalUploadRequest = requests.find(({ url }) => url.includes('uploads.example.test'));
  assert.ok(externalUploadRequest);
  assert.equal('Authorization' in externalUploadRequest.headers, false);
});

test('default upload transport streams the archive from disk', async t => {
  const root = await temporaryDirectory(t);
  const bundle = path.join(root, 'large-bundle.zip');
  const bytes = Buffer.alloc(2 * 1024 * 1024, 0x5a);
  await fs.writeFile(bundle, bytes);
  const received = {
    bytes: 0,
    chunks: 0,
    digest: '',
    contentLength: '',
    authorization: '',
  };
  const server = http.createServer((request, response) => {
    const hash = createHash('sha256');
    received.contentLength = String(request.headers['content-length'] ?? '');
    received.authorization = String(request.headers.authorization ?? '');
    request.on('data', chunk => {
      received.bytes += chunk.length;
      received.chunks += 1;
      hash.update(chunk);
    });
    request.on('end', () => {
      received.digest = hash.digest('hex');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
  });
  const origin = await listenOnLoopback(t, server);
  const token = ['publisher', 'stream', 'fixture'].join('-');
  const client = new TakuPublisherClient({
    workerUrl: origin,
    token,
    allowCustomWorkerUrl: true,
    timeoutMs: 2_000,
  });

  await client.uploadSigned(`${origin}/upload`, bundle);

  assert.equal(received.bytes, bytes.length);
  assert.ok(received.chunks > 1);
  assert.equal(received.digest, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(received.contentLength, String(bytes.length));
  assert.equal(received.authorization, `Bearer ${token}`);
});

test('streaming upload fails closed on timeout and rejected responses', async t => {
  const root = await temporaryDirectory(t);
  const bundle = path.join(root, 'bundle.zip');
  await fs.writeFile(bundle, Buffer.from('zip'));
  const timeoutServer = http.createServer(request => request.resume());
  const timeoutOrigin = await listenOnLoopback(t, timeoutServer);
  const timeoutClient = new TakuPublisherClient({
    workerUrl: timeoutOrigin,
    token: 'publisher-timeout-fixture',
    allowCustomWorkerUrl: true,
    uploadTimeoutMs: 50,
  });

  await assert.rejects(
    timeoutClient.uploadSigned(`${timeoutOrigin}/upload`, bundle),
    error => error instanceof PublisherError
      && error.code === 'network_error'
      && error.details.streamed_upload === true,
  );

  const rejectedServer = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end('{"error":"signature rejected"}');
    });
  });
  const rejectedOrigin = await listenOnLoopback(t, rejectedServer);
  const rejectedClient = new TakuPublisherClient({
    workerUrl: rejectedOrigin,
    token: 'publisher-rejected-fixture',
    allowCustomWorkerUrl: true,
  });

  await assert.rejects(
    rejectedClient.uploadSigned(`${rejectedOrigin}/upload`, bundle),
    error => error instanceof PublisherError && error.code === 'artifact_upload_failed',
  );
});

test('SubApp registration client uses the App Store draft/version routes', async () => {
  const requests = [];
  const transport = async (method, url, headers, body) => {
    requests.push({ method, url, headers, body });
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"ok":true}'),
    };
  };
  const publisherToken = ['publisher', 'subapp', 'fixture'].join('-');
  const client = new TakuPublisherClient({
    workerUrl: 'https://worker.example.test',
    token: publisherToken,
    allowCustomWorkerUrl: true,
    transport,
  });

  await client.upsertAppCatalog({ name: 'Calculator', status: 'draft' });
  await client.getNextAppVersionNumber('app_test_123');
  await client.createAppSignedUpload({
    bucket: 'app-packages',
    path: 'apps/app_test_123/versions/1/source.zip',
  });
  await client.createAppVersion({ appId: 'app_test_123', versionNumber: 1 });
  await client.getAppDownload('app_test_123', 1);

  assert.deepEqual(requests.map(request => [
    request.method,
    new URL(request.url).pathname,
  ]), [
    ['POST', '/app-store/catalog/upsert'],
    ['GET', '/app-store/catalog/app_test_123/next-version'],
    ['POST', '/app-store/storage/signed-upload'],
    ['POST', '/app-store/versions'],
    ['GET', '/app-store/apps/app_test_123/download'],
  ]);
  assert.equal(
    requests.slice(0, 4).every(
      request => request.headers.Authorization === ['Bearer', publisherToken].join(' '),
    ),
    true,
  );
  assert.equal('Authorization' in requests[4].headers, false);
  assert.equal(new URL(requests[4].url).searchParams.get('versionNumber'), '1');
});

test('draft payload keeps canonical create fields and update listing inheritance', async () => {
  const createPayload = await draftCreatePayload({
    draft_id: '',
    status: 'local',
    mode: 'create',
    source_path: '',
    unit: {
      id: 'skill-demo',
      type: 'skill',
      name: 'Demo Skill',
      description: 'A useful local skill.',
      children: [],
    },
  });
  assert.equal(createPayload.toolType, 'skill');
  assert.equal(createPayload.listing.title, 'Demo Skill');
  assert.equal(createPayload.listing.sourceKind, 'local_upload');
  assert.equal(createPayload.listing.authorshipKind, 'original');
  assert.equal(createPayload.listing.rightsBasis, 'self_owned');
  assert.deepEqual(createPayload.listing.categories, ['writing-content']);
  assert.deepEqual(createPayload.listing.platforms, ['taku', 'codex', 'claude-code']);

  const itemId = '11111111-1111-4111-8111-111111111111';
  const updatePayload = await draftCreatePayload({
    draft_id: '',
    status: 'local',
    mode: 'update',
    source_path: '',
    item_id: itemId,
    unit: {
      id: 'local-skill-demo',
      type: 'skill',
      name: 'Local renamed copy',
      description: 'Local metadata must not replace the listing by default.',
      children: [],
    },
  });
  assert.equal(updatePayload.itemId, itemId);
  assert.equal(updatePayload.inheritListing, true);
  assert.deepEqual(updatePayload.listing, {});
});

test('draft payload infers source and support fields from package metadata', async (t) => {
  const root = await temporaryDirectory(t);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    repository: { url: 'git+https://github.com/taku-ai/demo-skill.git' },
    bugs: {
      url: 'https://github.com/taku-ai/demo-skill/issues',
      email: 'support@taku.ai',
    },
    privacyPolicyUrl: 'https://taku.ai/privacy',
    license: 'Apache-2.0',
  }));

  const payload = await draftCreatePayload({
    draft_id: '',
    status: 'local',
    mode: 'create',
    source_path: root,
    unit: {
      id: 'skill-demo',
      type: 'skill',
      name: 'Demo Skill',
      description: 'A useful local skill.',
      children: [],
    },
  });

  assert.equal(payload.listing.sourceUrl, 'https://github.com/taku-ai/demo-skill');
  assert.equal(payload.listing.supportEmail, 'support@taku.ai');
  assert.equal(payload.listing.privacyPolicyUrl, 'https://taku.ai/privacy');
  assert.equal(payload.listing.license, 'Apache-2.0');
});

test('listing metadata normalizes to Worker field names', () => {
  const metadata = normalizeListingMetadata({
    source_url: 'https://example.com/source',
    rights_basis: 'explicit_permission',
    source_author: ['Original', 'Author'].join(' '),
    support_email: 'support@example.com',
    privacy_policy: 'https://example.com/privacy',
  });

  assert.equal(metadata.sourceUrl, 'https://example.com/source');
  assert.equal(metadata.rightsBasis, 'explicit_permission');
  assert.equal(metadata.sourceAuthor, 'Original Author');
  assert.equal(metadata.supportEmail, 'support@example.com');
  assert.equal(metadata.privacyPolicyUrl, 'https://example.com/privacy');
});

test('draft listing is read from the Worker response envelope', () => {
  assert.deepEqual(extractDraftListing({
    data: {
      draft: {
        listing: {
          title: 'Web title',
          description: 'Edited on Taku Web.',
          icon_url: 'https://cdn.example.test/web-icon.png',
        },
      },
    },
  }), {
    title: 'Web title',
    description: 'Edited on Taku Web.',
    iconUrl: 'https://cdn.example.test/web-icon.png',
  });
  assert.equal(extractDraftListing({ draft: { id: 'draft-without-listing' } }), null);
});

test('browser authorization URL binds PKCE state and loopback callback', () => {
  const callbackUrl = ['http', '://', '127.0.0.1', ':43210/callback'].join('');
  const url = new URL(buildLoginUrl({
    siteUrl: 'https://taku.ai',
    returnTo: callbackUrl,
    intent: 'publish_tool',
    workerUrl: 'https://worker.taku.ai',
    state: 'state-fixture',
    codeChallenge: 'challenge-fixture',
  }));
  assert.equal(url.origin, 'https://taku.ai');
  assert.equal(url.searchParams.get('auth_flow'), 'local_code');
  assert.equal(url.searchParams.get('auth_state'), 'state-fixture');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-fixture');
  assert.equal(url.searchParams.get('return_to'), callbackUrl);
});

test('Publisher contract encodes host-provided draft and artifact IDs', () => {
  assert.equal(
    publisherDraftPath('draft/with space'),
    '/stax/publisher/drafts/draft%2Fwith%20space',
  );
  assert.equal(
    publisherDraftArtifactCompletePath('draft/1', 'artifact/1'),
    '/stax/publisher/drafts/draft%2F1/artifacts/artifact%2F1/complete',
  );
  assert.throws(() => publisherDraftPath(''), /required/i);
});
