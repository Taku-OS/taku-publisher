import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  serializeTakuAgentHostAttestationPayload,
  type TakuAgentHostAttestationVerification,
} from '@/lib/taku-runtime';
import { OPTIONS, POST } from './route';

const CONTROL_TOKEN = 'local-test-control-token';
const RUNTIME_INSTANCE_ID = 'runtime-instance-test';
const CAPABILITIES_DIGEST = createHash('sha256').update('capabilities').digest('base64url');
const ORIGINAL_CONTROL_TOKEN = process.env.TAKU_CONTROL_TOKEN;
const ORIGINAL_INSTANCE_ID = process.env.TAKU_APPLICATION_INSTANCE_ID;

function restoreEnvironment(): void {
  if (ORIGINAL_CONTROL_TOKEN === undefined) delete process.env.TAKU_CONTROL_TOKEN;
  else process.env.TAKU_CONTROL_TOKEN = ORIGINAL_CONTROL_TOKEN;
  if (ORIGINAL_INSTANCE_ID === undefined) delete process.env.TAKU_APPLICATION_INSTANCE_ID;
  else process.env.TAKU_APPLICATION_INSTANCE_ID = ORIGINAL_INSTANCE_ID;
}

function enableVerificationEnvironment(
  controlToken = CONTROL_TOKEN,
  runtimeInstanceId = RUNTIME_INSTANCE_ID
): void {
  process.env.TAKU_CONTROL_TOKEN = controlToken;
  process.env.TAKU_APPLICATION_INSTANCE_ID = runtimeInstanceId;
}

function nonceFor(label: string): string {
  return createHash('sha256').update(label).digest('base64url');
}

function sessionIdFor(label: string): string {
  return createHash('sha256')
    .update(`session-${label}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

function signedInput(
  label: string,
  overrides: Partial<TakuAgentHostAttestationVerification> = {},
  controlToken = CONTROL_TOKEN
): TakuAgentHostAttestationVerification {
  const now = Date.now();
  const payload = {
    protocol: 'taku.agent.run/v2' as const,
    requestId: `hello-${label}`,
    clientNonce: nonceFor(`nonce-${label}`),
    frameEpoch: `frame-${label}`,
    runtimeInstanceId: RUNTIME_INSTANCE_ID,
    sessionId: sessionIdFor(label),
    capabilitiesDigest: CAPABILITIES_DIGEST,
    proofExpiresAt: now + 5_000,
    sessionExpiresAt: now + 10 * 60_000,
    ...overrides,
  };
  return {
    ...payload,
    proof:
      overrides.proof ??
      createHmac('sha256', controlToken)
        .update(serializeTakuAgentHostAttestationPayload(payload))
        .digest('base64url'),
  };
}

function requestFor(
  body: TakuAgentHostAttestationVerification | Record<string, unknown>,
  headerOverrides: Record<string, string | undefined> = {},
  url = 'http://127.0.0.1:31337/__taku/host-attestation/verify'
): Request {
  const parsedUrl = new URL(url);
  const headers = new Headers({
    'content-type': 'application/json',
    host: parsedUrl.host,
    origin: parsedUrl.origin,
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'x-taku-agent-session': String(body.sessionId ?? ''),
  });
  for (const [name, value] of Object.entries(headerOverrides)) {
    if (value === undefined) headers.delete(name);
    else headers.set(name, value);
  }
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

test.after(restoreEnvironment);

test('attestation uses the frozen v2 transcript and only the two runtime secrets', () => {
  const input = signedInput('canonical');
  assert.equal(
    serializeTakuAgentHostAttestationPayload(input),
    JSON.stringify([
      'taku.agent.attestation/v2',
      input.protocol,
      input.requestId,
      input.clientNonce,
      input.frameEpoch,
      input.runtimeInstanceId,
      input.sessionId,
      input.capabilitiesDigest,
      input.proofExpiresAt,
      input.sessionExpiresAt,
    ])
  );

  const source = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
  const environmentReads = [...source.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(environmentReads, ['TAKU_CONTROL_TOKEN', 'TAKU_APPLICATION_INSTANCE_ID']);
});

test('frozen proof and HKDF vectors are reproduced by the route', async (t) => {
  t.mock.method(Date, 'now', () => 1_788_955_200_000);
  enableVerificationEnvironment(
    'fixture-control-token-32-bytes!!',
    'runtime-instance-fixture-0001'
  );
  const input: TakuAgentHostAttestationVerification = {
    protocol: 'taku.agent.run/v2',
    requestId: 'hello-fixture-0001',
    clientNonce: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    frameEpoch: 'frame-epoch-fixture-0001',
    runtimeInstanceId: 'runtime-instance-fixture-0001',
    sessionId: 'ICEiIyQlJicoKSorLC0uLw',
    capabilitiesDigest: 'jiGNzXdnygiNSd8FUTPx8h0dOTmlX345O-0Gs9mBU7g',
    proofExpiresAt: 1_788_955_215_000,
    sessionExpiresAt: 1_788_955_800_000,
    proof: 'w-wkJizxmsU1H5K5c9OACOO4BD7ZgaOVo-mF4LdWM4g',
  };
  const response = await POST(requestFor(input));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    verified: true,
    sessionId: 'ICEiIyQlJicoKSorLC0uLw',
    sessionExpiresAt: 1_788_955_800_000,
    c2hKey: 'm4nkQVjbQseySPCAzbbMK3nPXyh5BUNP3T8-TVaC6dY',
    h2cKey: '9YLUTDFaJyOXS-ibdC3ijh0W7uGmB2SD-sNuOsMjpfU',
  });
});

test('a valid proof is accepted once with strict uncacheable non-CORS output', async () => {
  enableVerificationEnvironment();
  const input = signedInput('valid-once');
  const response = await POST(requestFor(input));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(Object.keys((await response.clone().json()) as object).sort(), [
    'c2hKey',
    'h2cKey',
    'sessionExpiresAt',
    'sessionId',
    'verified',
  ]);
  assert.equal((await POST(requestFor(input))).status, 401);
});

test('proof and nonce are atomically consumed once', async () => {
  enableVerificationEnvironment();
  const nonce = nonceFor('shared-nonce');
  const firstNonceUse = signedInput('nonce-first', { clientNonce: nonce });
  const secondNonceUse = signedInput('nonce-second', { clientNonce: nonce });
  assert.equal((await POST(requestFor(firstNonceUse))).status, 200);
  assert.equal((await POST(requestFor(secondNonceUse))).status, 401);

  const raced = signedInput('parallel-replay');
  const statuses = await Promise.all([
    POST(requestFor(raced)).then((response) => response.status),
    POST(requestFor(raced)).then((response) => response.status),
  ]);
  assert.deepEqual(statuses.sort(), [200, 401]);
});

test('field tampering, expiry, excessive TTL, and extra fields fail closed', async () => {
  enableVerificationEnvironment();
  const mutations: Array<[string, (input: Record<string, unknown>) => void]> = [
    [
      'requestId',
      (input) => {
        input.requestId = 'hello-tampered';
      },
    ],
    [
      'clientNonce',
      (input) => {
        input.clientNonce = nonceFor('tampered');
      },
    ],
    [
      'frameEpoch',
      (input) => {
        input.frameEpoch = 'frame-tampered';
      },
    ],
    [
      'runtimeInstanceId',
      (input) => {
        input.runtimeInstanceId = 'wrong-instance';
      },
    ],
    [
      'sessionId',
      (input) => {
        input.sessionId = sessionIdFor('tampered');
      },
    ],
    [
      'capabilitiesDigest',
      (input) => {
        input.capabilitiesDigest = nonceFor('tampered-caps');
      },
    ],
    [
      'proofExpiresAt',
      (input) => {
        input.proofExpiresAt = Date.now() + 6_000;
      },
    ],
    [
      'sessionExpiresAt',
      (input) => {
        input.sessionExpiresAt = Date.now() + 300_000;
      },
    ],
    [
      'proof',
      (input) => {
        input.proof = `${String(input.proof).slice(0, -1)}${String(input.proof).endsWith('A') ? 'Q' : 'A'}`;
      },
    ],
    [
      'extra',
      (input) => {
        input.hostVerificationUrl = 'https://evil.example/verify';
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    const input = signedInput(`tamper-${name}`) as unknown as Record<string, unknown>;
    mutate(input);
    const response = await POST(requestFor(input));
    assert.equal(response.status, 401, name);
    assert.deepEqual(await response.json(), { verified: false }, name);
  }

  const expiredProof = signedInput('expired', { proofExpiresAt: Date.now() - 1 });
  const longProof = signedInput('long-proof', { proofExpiresAt: Date.now() + 60_000 });
  const longSession = signedInput('long-session', {
    sessionExpiresAt: Date.now() + 10 * 60_000 + 1_000,
  });
  assert.equal((await POST(requestFor(expiredProof))).status, 401);
  assert.equal((await POST(requestFor(longProof))).status, 401);
  assert.equal((await POST(requestFor(longSession))).status, 401);
});

test('same-origin fetch metadata, JSON, and exact session header are mandatory', async () => {
  enableVerificationEnvironment();
  const nextAdapterInput = signedInput('next-adapter-origin');
  const nextAdapterRequest = requestFor(
    nextAdapterInput,
    {
      host: '127.0.0.1:31337',
      origin: 'http://127.0.0.1:31337',
    },
    'http://localhost:31337/__taku/host-attestation/verify'
  );
  assert.equal((await POST(nextAdapterRequest)).status, 200);

  for (const [name, headers] of [
    ['origin', { origin: 'https://evil.example' }],
    ['host-origin-mismatch', { host: '127.0.0.1:31337', origin: 'http://localhost:31337' }],
    ['missing-host', { host: undefined }],
    ['localhost-origin', { host: 'localhost:31337', origin: 'http://localhost:31337' }],
    ['other-loopback', { host: '127.0.0.2:31337', origin: 'http://127.0.0.2:31337' }],
    ['non-loopback', { host: '192.0.2.1:31337', origin: 'http://192.0.2.1:31337' }],
    ['wrong-port', { host: '127.0.0.1:31338', origin: 'http://127.0.0.1:31338' }],
    ['site', { 'sec-fetch-site': 'cross-site' }],
    ['mode', { 'sec-fetch-mode': 'navigate' }],
    ['dest', { 'sec-fetch-dest': 'document' }],
    ['session', { 'x-taku-agent-session': sessionIdFor('wrong') }],
    ['content-type', { 'content-type': 'text/plain' }],
  ] as const) {
    const response = await POST(requestFor(signedInput(`metadata-${name}`), headers));
    assert.equal(response.status, 401, name);
    assert.equal(response.headers.get('access-control-allow-origin'), null, name);
  }
  const options = OPTIONS();
  assert.equal(options.status, 405);
  assert.equal(options.headers.get('cache-control'), 'no-store');
  assert.equal(options.headers.get('access-control-allow-origin'), null);
});

test('missing runtime secrets and malformed bodies reveal no sensitive detail', async () => {
  delete process.env.TAKU_CONTROL_TOKEN;
  delete process.env.TAKU_APPLICATION_INSTANCE_ID;
  const unavailable = await POST(requestFor(signedInput('missing-env')));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { verified: false });

  enableVerificationEnvironment();
  const malformed = await POST(
    new Request('http://127.0.0.1:31337/__taku/host-attestation/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: '127.0.0.1:31337',
        origin: 'http://127.0.0.1:31337',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'x-taku-agent-session': sessionIdFor('malformed'),
      },
      body: '{not-json',
    })
  );
  assert.equal(malformed.status, 401);
  const body = JSON.stringify(await malformed.json());
  assert.equal(body.includes(CONTROL_TOKEN), false);
  assert.equal(body.includes(RUNTIME_INSTANCE_ID), false);
});
