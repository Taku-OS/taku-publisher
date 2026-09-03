import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import {
  attemptCreatorBrowserAuthorization,
  authHasScope,
  buildLoginUrl,
  creatorAuthorizationRequired,
  creatorAuthorizationSiteUrl,
  creatorCommandMode,
  creatorWorkerUrl,
  dispatch,
  draftCreatePayload,
  extractDraftListing,
  normalizeListingMetadata,
  loginWithBrowser,
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
    expiresAt: Date.now() + 10 * 60_000,
    scopes: ['marketplace.packages.read'],
  }, env);

  const auth = await resolveAuth({ env });
  assert.equal(auth.source, 'publisher_session');
  assert.equal(auth.token, publisherToken);
  assert.equal(auth.iconToken, '');
  assert.equal(authHasScope(auth, 'marketplace.packages.read'), true);
  assert.equal(authHasScope(auth, 'publisher.drafts.write'), false);
});

test('Creator cloud auth does not silently inherit the legacy Desktop account', async (t) => {
  const root = await temporaryDirectory(t);
  const desktopPath = path.join(root, 'desktop-session.json');
  await fs.writeFile(desktopPath, JSON.stringify({
    accessToken: 'fixture-legacy-desktop-auth',
    expiresAt: Date.now() + 10 * 60_000,
    user: { email: 'old-account@example.com' },
  }));
  const env = {
    ...process.env,
    TAKU_PUBLISHER_HOME: path.join(root, 'publisher'),
    TAKU_SESSION_PATH: desktopPath,
  };

  const compatibility = await resolveAuth({ env });
  assert.equal(compatibility.source, 'session');
  const creatorCloud = await resolveAuth({ env, allowDesktopSession: false });
  assert.equal(creatorCloud.source, 'publisher_session_missing');
  assert.equal(creatorCloud.token, '');
});

test('expired Publisher auth does not fall through to a valid Desktop account for Creator cloud', async (t) => {
  const root = await temporaryDirectory(t);
  const publisherRoot = path.join(root, 'publisher');
  const desktopPath = path.join(root, 'desktop-session.json');
  await fs.mkdir(publisherRoot, { recursive: true });
  await fs.writeFile(path.join(publisherRoot, 'session.json'), JSON.stringify({
    accessToken: 'fixture-expired-publisher-auth',
    expiresAt: Date.now() - 1_000,
    scopes: ['publisher.drafts.write'],
  }));
  await fs.writeFile(desktopPath, JSON.stringify({
    accessToken: 'fixture-valid-desktop-auth',
    expiresAt: Date.now() + 60_000,
  }));
  const auth = await resolveAuth({
    env: {
      ...process.env,
      TAKU_PUBLISHER_HOME: publisherRoot,
      TAKU_SESSION_PATH: desktopPath,
    },
    allowDesktopSession: false,
  });
  assert.equal(auth.source, 'publisher_session_expired');
  assert.equal(auth.token, '');
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

test('API client uses scoped auth for GitHub connection and repository discovery', async () => {
  const requests = [];
  const transport = async (method, url, headers, body) => {
    requests.push({ method, url, headers, body });
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"data":[]}'),
    };
  };
  const token = ['taku', 'pub', 'github', 'fixture'].join('_');
  const client = new TakuPublisherClient({ token, transport });

  await client.getGitHubAuthStatus();
  await client.startGitHubAuth();
  await client.disconnectGitHub();
  await client.listGitHubRepositories('octocat', {
    limit: 25,
    includeForks: true,
    includeArchived: true,
    sort: 'created',
  });

  assert.deepEqual(requests.map(request => [request.method, new URL(request.url).pathname]), [
    ['GET', '/stax/github/auth/status'],
    ['POST', '/stax/github/auth/connect'],
    ['DELETE', '/stax/github/auth/connection'],
    ['GET', '/stax/github/repos/octocat'],
  ]);
  assert.equal(requests.every(request => request.headers.Authorization === `Bearer ${token}`), true);
  const listUrl = new URL(requests[3].url);
  assert.equal(listUrl.searchParams.get('limit'), '25');
  assert.equal(listUrl.searchParams.get('include_forks'), 'true');
  assert.equal(listUrl.searchParams.get('include_archived'), 'true');
  assert.equal(listUrl.searchParams.get('sort'), 'created');
});

test('GitHub disconnect removes the server connection for the Publisher account', async (t) => {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.method === 'DELETE' && request.url === '/stax/github/auth/connection') {
      response.end(JSON.stringify({
        data: {
          status: 'disconnected',
          connected: false,
          username: 'octocat',
          revoked: true,
          revokeAttempted: true,
          message: 'GitHub disconnected.',
        },
      }));
      return;
    }
    response.statusCode = 404;
    response.end('{"error":"not found"}');
  });
  const workerUrl = await listenOnLoopback(t, server);
  process.env.TAKU_TEST_GITHUB_TOKEN = 'fixture-scoped-github-token';
  t.after(() => { delete process.env.TAKU_TEST_GITHUB_TOKEN; });

  const result = await dispatch({
    command: 'github-disconnect',
    flags: new Map([
      ['worker-url', workerUrl],
      ['allow-custom-worker-url', true],
      ['token-env', 'TAKU_TEST_GITHUB_TOKEN'],
      ['no-browser-login', true],
    ]),
    rest: [],
  });

  assert.equal(result.status, 'github_disconnected');
  assert.equal(result.requires_action, false);
  assert.equal(result.github.connected, false);
  assert.equal(result.github.username, 'octocat');
  assert.equal(result.authorization_revoked, true);
});

test('GitHub project discovery returns browser authorization or a selectable repository list', async (t) => {
  let connected = false;
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/stax/github/auth/status') {
      response.end(JSON.stringify({
        data: connected
          ? { status: 'connected', connected: true, account: { username: 'octocat' } }
          : { status: 'disconnected', connected: false },
      }));
      return;
    }
    if (request.url === '/stax/github/auth/connect') {
      response.end(JSON.stringify({ status: 'redirect', url: 'https://github.com/login/oauth/authorize?fixture=1' }));
      return;
    }
    if (request.url?.startsWith('/stax/github/repos/octocat')) {
      response.end(JSON.stringify({
        data: [{
          id: 1,
          name: 'hello-world',
          fullName: 'octocat/hello-world',
          htmlUrl: 'https://github.com/octocat/hello-world',
          description: 'A public project',
          language: 'TypeScript',
          stars: 12,
          updatedAt: '2026-09-01T00:00:00.000Z',
          suggestedType: 'app',
          recommended: true,
        }],
      }));
      return;
    }
    response.statusCode = 404;
    response.end('{"error":"not found"}');
  });
  const workerUrl = await listenOnLoopback(t, server);
  process.env.TAKU_TEST_GITHUB_TOKEN = 'fixture-scoped-github-token';
  t.after(() => { delete process.env.TAKU_TEST_GITHUB_TOKEN; });
  const flags = new Map([
    ['worker-url', workerUrl],
    ['allow-custom-worker-url', true],
    ['token-env', 'TAKU_TEST_GITHUB_TOKEN'],
    ['no-open-browser', true],
  ]);

  const authorization = await dispatch({ command: 'github-project-discover', flags, rest: [] });
  assert.equal(authorization.status, 'github_authorization_required');
  assert.equal(authorization.requires_action, true);
  assert.equal(authorization.action_type, 'complete_github_authorization');
  assert.equal(authorization.authorization_url.startsWith('https://github.com/login/oauth/authorize'), true);

  connected = true;
  const selection = await dispatch({ command: 'github-project-discover', flags, rest: [] });
  assert.equal(selection.status, 'github_project_selection_required');
  assert.equal(selection.action_type, 'select_one_github_project');
  assert.equal(selection.projects.length, 1);
  assert.equal(selection.projects[0].full_name, 'octocat/hello-world');
  assert.equal(selection.projects[0].source, 'https://github.com/octocat/hello-world');
  assert.equal(selection.privacy.private_repositories_included, false);
});

test('GitHub project discovery does not silently reuse the Taku Desktop account', async (t) => {
  const root = await temporaryDirectory(t);
  const publisherPath = path.join(root, 'publisher-session.json');
  const desktopPath = path.join(root, 'desktop-session.json');
  await fs.writeFile(desktopPath, JSON.stringify({
    accessToken: 'fixture-desktop-account-token',
    expiresAt: Date.now() + 60_000,
  }));
  const previousPublisherPath = process.env.TAKU_PUBLISHER_SESSION_PATH;
  const previousDesktopPath = process.env.TAKU_SESSION_PATH;
  process.env.TAKU_PUBLISHER_SESSION_PATH = publisherPath;
  process.env.TAKU_SESSION_PATH = desktopPath;
  t.after(() => {
    if (previousPublisherPath === undefined) delete process.env.TAKU_PUBLISHER_SESSION_PATH;
    else process.env.TAKU_PUBLISHER_SESSION_PATH = previousPublisherPath;
    if (previousDesktopPath === undefined) delete process.env.TAKU_SESSION_PATH;
    else process.env.TAKU_SESSION_PATH = previousDesktopPath;
  });

  await assert.rejects(
    dispatch({
      command: 'github-project-discover',
      flags: new Map([['no-browser-login', true]]),
      rest: [],
    }),
    (error) => error instanceof PublisherError && error.code === 'missing_auth',
  );
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
    upsert: true,
    sizeBytes: 4096,
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
  assert.deepEqual(JSON.parse(requests[2].body), {
    bucket: 'app-packages',
    path: 'apps/app_test_123/versions/1/source.zip',
    upsert: true,
    sizeBytes: 4096,
  });
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
  assert.equal(url.searchParams.has('account_mode'), false);
});

test('browser callback resumes the same authorization call and saves the standalone Publisher session', async (t) => {
  const root = await temporaryDirectory(t);
  const env = { ...process.env, TAKU_PUBLISHER_HOME: root };
  const requests = [];
  const worker = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      token: 'fixture-publisher-callback-token',
      expiresIn: 3600,
      scopes: ['creator.card.write', 'publisher.drafts.write'],
      accountHint: 'te***@example.com',
    }));
  });
  const workerUrl = await listenOnLoopback(t, worker);
  let browserOpenCount = 0;
  let stderr = '';
  const stderrWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    stderr += String(chunk);
    return true;
  };

  let status;
  try {
    status = await loginWithBrowser({
      workerUrl,
      siteUrl: 'https://taku.ai',
      intent: 'publish_stax_card',
      env,
      browserOpen: async (loginUrl) => {
        browserOpenCount += 1;
        const authorization = new URL(loginUrl);
        const response = await fetch(authorization.searchParams.get('return_to'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: 'one-time-code',
            state: authorization.searchParams.get('auth_state'),
          }),
        });
        assert.equal(response.ok, true);
        return true;
      },
    });
  } finally {
    process.stderr.write = stderrWrite;
  }

  assert.equal(browserOpenCount, 1);
  assert.deepEqual(requests, ['POST /marketplace/local-auth/redeem']);
  assert.equal(status.authenticated, true);
  assert.match(stderr, /Waiting for browser confirmation/);
  assert.equal(stderr.includes('code_challenge='), false);
  const resolved = await resolveAuth({ env, allowDesktopSession: false });
  assert.equal(resolved.source, 'publisher_session');
  assert.equal(resolved.token, 'fixture-publisher-callback-token');
  worker.closeIdleConnections?.();
  worker.closeAllConnections?.();
});

test('Creator cloud authorization completes before the scan process starts', async (t) => {
  if (process.platform === 'win32') return t.skip('The browser launcher fixture is POSIX-only.');
  const root = await temporaryDirectory(t);
  const skillRoot = path.join(root, 'skill');
  const binRoot = path.join(root, 'bin');
  const creatorLog = path.join(root, 'creator.log');
  const browserLog = path.join(root, 'browser.log');
  await fs.mkdir(path.join(skillRoot, 'creator', 'scripts'), { recursive: true });
  await fs.mkdir(binRoot, { recursive: true });
  await fs.writeFile(path.join(skillRoot, 'creator', 'scripts', 'taku_creator.mjs'), `
import fs from 'node:fs';
fs.appendFileSync(process.env.MOCK_CREATOR_LOG, JSON.stringify({ args: process.argv.slice(2), token: process.env.TAKU_PUBLISH_TOKEN || '' }) + '\\n');
const ok = process.env.TAKU_PUBLISH_TOKEN === 'replacement-publisher-token';
console.log(JSON.stringify(ok
  ? { ok: true, editorUrl: 'https://worker.taku.ai/stax/studio/editor?launch=test' }
  : { ok: false, needsAuth: true, status: 401, draftPath: '/private/generated-card.json' }));
`);
  const launcher = `#!/usr/bin/env node
import fs from 'node:fs';
const authorization = new URL(process.argv[2]);
fs.writeFileSync(process.env.MOCK_BROWSER_LOG, authorization.toString());
const response = await fetch(authorization.searchParams.get('return_to'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: 'replacement-code', state: authorization.searchParams.get('auth_state') }),
});
if (!response.ok) process.exitCode = 1;
`;
  for (const command of ['open', 'xdg-open']) {
    const target = path.join(binRoot, command);
    await fs.writeFile(target, launcher, { mode: 0o755 });
  }
  const worker = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'POST' && request.url === '/marketplace/local-auth/redeem') {
      response.end(JSON.stringify({
        token: 'replacement-publisher-token',
        expiresIn: 3600,
        scopes: [
          'creator.profile.read',
          'creator.studio-draft.write',
          'creator.card.write',
          'creator.stats.read',
        ],
        accountHint: 'ne***@example.com',
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  const workerUrl = await listenOnLoopback(t, worker);
  const previous = {
    PATH: process.env.PATH,
    TAKU_PUBLISHER_HOME: process.env.TAKU_PUBLISHER_HOME,
    TAKU_PUBLISHER_SKILL_ROOT: process.env.TAKU_PUBLISHER_SKILL_ROOT,
    TAKU_BEARER_TOKEN: process.env.TAKU_BEARER_TOKEN,
    TAKU_PUBLISH_TOKEN: process.env.TAKU_PUBLISH_TOKEN,
    MOCK_CREATOR_LOG: process.env.MOCK_CREATOR_LOG,
    MOCK_BROWSER_LOG: process.env.MOCK_BROWSER_LOG,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.PATH = `${binRoot}${path.delimiter}${previous.PATH || ''}`;
  process.env.TAKU_PUBLISHER_HOME = path.join(root, 'publisher');
  process.env.TAKU_PUBLISHER_SKILL_ROOT = skillRoot;
  process.env.MOCK_CREATOR_LOG = creatorLog;
  process.env.MOCK_BROWSER_LOG = browserLog;
  delete process.env.TAKU_BEARER_TOKEN;
  delete process.env.TAKU_PUBLISH_TOKEN;
  await savePublisherSession({
    accessToken: 'fixture-rejected-publisher-token',
    expiresAt: Date.now() + 10 * 60_000,
    scopes: ['creator.card.write', 'publisher.drafts.write'],
  });

  const result = await dispatch({
    command: 'creator-draft',
    flags: new Map(),
    rest: ['--json', '--editor', '--worker-url', workerUrl, '--allow-custom-worker-url'],
  });

  assert.equal(result.ok, true);
  const invocations = (await fs.readFile(creatorLog, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].token, 'replacement-publisher-token');
  assert.equal(invocations[0].args[0], 'draft');
  const authorization = new URL(await fs.readFile(browserLog, 'utf8'));
  assert.equal(authorization.searchParams.has('account_mode'), false);
  const resolved = await resolveAuth({ allowDesktopSession: false });
  assert.equal(resolved.token, 'replacement-publisher-token');
  worker.closeIdleConnections?.();
  worker.closeAllConnections?.();
});

test('Creator cloud authorization stays on stable Taku Web unless auth-site is explicitly overridden', () => {
  assert.equal(
    creatorAuthorizationSiteUrl(['--site-url', 'http://localhost:3100'], {}),
    'https://taku.ai',
  );
  assert.equal(
    creatorAuthorizationSiteUrl(['--auth-site-url', 'http://localhost:3100'], {}),
    'http://localhost:3100',
  );
  assert.equal(
    creatorAuthorizationSiteUrl([], { TAKU_AUTH_SITE_URL: 'https://auth-preview.example.test' }),
    'https://auth-preview.example.test',
  );
});

test('Creator cloud Studio uses the production Worker by default', () => {
  assert.equal(
    creatorWorkerUrl('draft', ['--json', '--editor'], {}),
    'https://worker.taku.ai',
  );
  assert.equal(
    creatorWorkerUrl('editor', ['--json', '--draft', '/private/card.json'], {}),
    'https://worker.taku.ai',
  );
  assert.equal(
    creatorWorkerUrl('publish', ['--json', '--draft', '/private/card.json'], {}),
    'https://worker.taku.ai',
  );
  assert.equal(
    creatorWorkerUrl('draft', ['--editor', '--worker-url', 'https://worker.example.test'], {}),
    'https://worker.example.test',
  );
});

test('Creator editor uses cloud Studio by default and keeps local editor explicit', () => {
  assert.deepEqual(creatorCommandMode('draft', ['--editor']), {
    localEditor: false,
    cloudStudio: true,
    requiresAuth: true,
  });
  assert.deepEqual(creatorCommandMode('editor', []), {
    localEditor: false,
    cloudStudio: true,
    requiresAuth: true,
  });
  assert.deepEqual(creatorCommandMode('draft', ['--editor', '--local-editor']), {
    localEditor: true,
    cloudStudio: false,
    requiresAuth: false,
  });
  assert.deepEqual(creatorCommandMode('editor', ['--local-editor']), {
    localEditor: true,
    cloudStudio: false,
    requiresAuth: false,
  });
  assert.deepEqual(creatorCommandMode('scan', []), {
    localEditor: false,
    cloudStudio: false,
    requiresAuth: false,
  });
});

test('valid Publisher session is reused while missing, expired, or insufficient auth needs one browser grant', () => {
  const valid = {
    token: 'fixture-publisher-session-token',
    source: 'publisher_session',
    iconToken: '',
    scopes: [
      'creator.profile.read',
      'creator.studio-draft.write',
      'creator.card.write',
      'creator.stats.read',
    ],
    refreshed: false,
  };
  const missing = { ...valid, token: '', source: 'publisher_session_missing', scopes: [] };
  const expired = { ...valid, token: '', source: 'publisher_session_expired', scopes: [] };
  const requiredScopes = ['creator.profile.read', 'creator.studio-draft.write'];

  assert.equal(creatorAuthorizationRequired(valid, requiredScopes), false);
  assert.equal(creatorAuthorizationRequired(missing, requiredScopes), true);
  assert.equal(creatorAuthorizationRequired(expired, requiredScopes), true);
  assert.equal(
    creatorAuthorizationRequired({ ...valid, scopes: ['creator.profile.read'] }, requiredScopes),
    true,
  );
});

test('Creator authorization is bounded to one attempt and has no account-mode branch', async () => {
  const state = { attempts: 0 };
  let authorizationCalls = 0;
  const authorize = async () => { authorizationCalls += 1; };

  assert.equal(await attemptCreatorBrowserAuthorization(state, authorize), true);
  assert.equal(await attemptCreatorBrowserAuthorization(state, authorize), false);
  assert.equal(state.attempts, 1);
  assert.equal(authorizationCalls, 1);
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
