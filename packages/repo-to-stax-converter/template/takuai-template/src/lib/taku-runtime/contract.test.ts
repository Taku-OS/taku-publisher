import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getTakuAgentPostMessageTargetOrigin, verifyTakuAgentHostAttestation } from './browser';
import {
  TakuAgentClient,
  TakuAgentError,
  type TakuAgentMessageTransport,
  type TakuAgentTransportEvent,
} from './client';
import {
  createTakuAgentIdempotencyKey,
  getTakuAgentUtf8ByteLength,
  isTakuAgentClientNonce,
  parseTakuAgentAssetOpenResult,
  parseTakuAgentCapabilities,
  parseTakuAgentContentReadResult,
  parseTakuAgentContentRef,
  parseTakuAgentError,
  parseTakuAgentHostMessage,
  parseTakuAgentRunCursor,
  parseTakuAgentSecureClientBody,
  parseTakuAgentSecureEnvelope,
  parseTakuAgentSecureHostBody,
  serializeTakuAgentCapabilities,
  serializeTakuAgentCapabilitiesForDigest,
  serializeTakuAgentHostAttestationPayload,
  TAKU_AGENT_MAX_SECURE_ENVELOPE_BYTES,
  validateTakuAgentStartInput,
} from './contract';
import {
  computeTakuAgentCapabilitiesDigest,
  createTakuAgentSecureClientEnvelope,
  importTakuAgentSessionAuthenticator,
  type TakuAgentSessionAuthenticator,
} from './crypto';
import {
  TAKU_AGENT_CLIENT_FEATURES,
  TAKU_AGENT_CONTRACT_REVISION,
  TAKU_AGENT_EXECUTE_OPERATION,
  TAKU_AGENT_IMAGE_OPERATION,
  TAKU_AGENT_MESSAGE_TYPES,
  TAKU_AGENT_METHODS,
  TAKU_AGENT_OPERATION,
  TAKU_AGENT_OPERATION_CATALOG_VERSION,
  TAKU_AGENT_PROTOCOL,
  TAKU_AGENT_VIDEO_OPERATION,
  type TakuAgentCapabilities,
  type TakuAgentClientMessage,
  type TakuAgentContentRef,
  type TakuAgentEventMessage,
  type TakuAgentHelloResultMessage,
  type TakuAgentHostAttestationVerification,
  type TakuAgentRequestMessage,
  type TakuAgentRunCursor,
  type TakuAgentSecureClientBody,
  type TakuAgentSecureEnvelope,
  type TakuAgentSubscribeResult,
} from './types';

const GOLDEN = JSON.parse(
  readFileSync(new URL('./fixtures/contract-v2.json', import.meta.url), 'utf8')
) as Record<string, unknown>;
const REAL_DATE_NOW = Date.now;
const GOLDEN_SESSION = (GOLDEN.helloSuccess as TakuAgentHelloResultMessage).attestation;
const GOLDEN_TEST_NOW = GOLDEN_SESSION.proofExpiresAt - 1_000;
const RECOVERY_SCOPE = (GOLDEN.helloSuccess as TakuAgentHelloResultMessage).capabilities
  .recoveryScope;

// The cryptographic fixture freezes timestamps as part of its signed transcript.
// Run behavioral tests just before that proof expires so the golden stays stable
// instead of becoming invalid when wall-clock time passes the fixture date.
Date.now = () => GOLDEN_TEST_NOW;
test.after(() => {
  Date.now = REAL_DATE_NOW;
});
const HOST_ORIGIN = 'taku://desktop';
const CLIENT_MAC = Buffer.alloc(32, 1).toString('base64url');
const HOST_MAC = Buffer.alloc(32, 2).toString('base64url');
const TEST_NONCES = [
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCA',
  'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDA',
] as const;

class FakeTransport implements TakuAgentMessageTransport {
  readonly available = true;
  readonly sent: Array<TakuAgentClientMessage | TakuAgentSecureClientBody> = [];
  readonly wireSent: TakuAgentClientMessage[] = [];
  boundOrigin: string | null = null;
  nextPostError: Error | null = null;
  readonly verificationInputs: TakuAgentHostAttestationVerification[] = [];
  verifier: (input: TakuAgentHostAttestationVerification, signal: AbortSignal) => Promise<boolean> =
    async () => true;
  hostMessageVerifier: (envelope: TakuAgentSecureEnvelope) => Promise<boolean> = async (envelope) =>
    envelope.mac === HOST_MAC;
  readonly requestSequences = new Map<string, string>();
  private listener: ((event: TakuAgentTransportEvent) => void) | null = null;

  post(message: TakuAgentClientMessage): void {
    if (this.nextPostError) {
      const error = this.nextPostError;
      this.nextPostError = null;
      throw error;
    }
    this.wireSent.push(structuredClone(message));
    if (message.type === TAKU_AGENT_MESSAGE_TYPES.hello) {
      this.sent.push(structuredClone(message));
      return;
    }
    const body = parseTakuAgentSecureClientBody(message.body);
    if (!body) throw new Error('client sent an invalid secure body');
    this.sent.push(structuredClone(body));
    if (body.type === TAKU_AGENT_MESSAGE_TYPES.request) {
      this.requestSequences.set(body.requestId, message.sequence);
    }
  }

  listen(listener: (event: TakuAgentTransportEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  bindHostOrigin(origin: string | null): void {
    this.boundOrigin = origin;
  }

  async verifyHostAttestation(
    input: TakuAgentHostAttestationVerification,
    signal: AbortSignal
  ): Promise<TakuAgentSessionAuthenticator | null> {
    this.verificationInputs.push(structuredClone(input));
    if (!(await this.verifier(input, signal))) return null;
    return {
      sessionId: input.sessionId,
      sessionExpiresAt: input.sessionExpiresAt,
      signClientMessage: async () => CLIENT_MAC,
      verifyHostMessage: (envelope) => this.hostMessageVerifier(envelope),
    };
  }

  emit(data: unknown, origin = HOST_ORIGIN): void {
    this.listener?.({ data: structuredClone(this.wrapHostBody(data)), origin });
  }

  emitWire(data: unknown, origin = HOST_ORIGIN): void {
    this.listener?.({ data: structuredClone(data), origin });
  }

  private wrapHostBody(data: unknown): unknown {
    if (!isRecord(data)) return data;
    if (
      data.type === TAKU_AGENT_MESSAGE_TYPES.helloResult ||
      data.type === TAKU_AGENT_MESSAGE_TYPES.secure
    ) {
      return data;
    }
    if (data.protocol !== TAKU_AGENT_PROTOCOL || typeof data.type !== 'string') return data;
    let sequence: string | undefined;
    let lane: 'rpc' | 'event';
    if (data.type === TAKU_AGENT_MESSAGE_TYPES.sessionReady) {
      sequence = '1';
      lane = 'rpc';
    } else if (
      data.type === TAKU_AGENT_MESSAGE_TYPES.response &&
      typeof data.requestId === 'string'
    ) {
      sequence = this.requestSequences.get(data.requestId);
      lane = 'rpc';
    } else if (
      data.type === TAKU_AGENT_MESSAGE_TYPES.event &&
      Number.isSafeInteger(data.sequence)
    ) {
      sequence = String(data.sequence);
      lane = 'event';
    } else {
      return data;
    }
    if (!sequence) return data;
    const hello = this.verificationInputs.at(-1);
    if (!hello) return data;
    return {
      __taku: true,
      protocol: TAKU_AGENT_PROTOCOL,
      type: TAKU_AGENT_MESSAGE_TYPES.secure,
      sessionId: hello.sessionId,
      direction: 'h2c',
      lane,
      sequence,
      body: JSON.stringify(data),
      mac: HOST_MAC,
    } satisfies TakuAgentSecureEnvelope;
  }
}

function idFactory(ids: string[]): () => string {
  return () => {
    const id = ids.shift();
    if (!id) throw new Error('test requestId fixture exhausted');
    return id;
  };
}

function nonceFactory(): () => string {
  let index = 0;
  return () => TEST_NONCES[index++] ?? 'EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE';
}

function makeClient(transport: FakeTransport, ids: string[]): TakuAgentClient {
  return new TakuAgentClient(transport, {
    requestIdFactory: idFactory(ids),
    clientNonceFactory: nonceFactory(),
    helloRetryDelaysMs: [0],
    helloResponseGraceMs: 40,
  });
}

async function emitTrustedHello(
  transport: FakeTransport,
  message: unknown = GOLDEN.helloSuccess,
  origin = HOST_ORIGIN,
  recomputeCapabilitiesDigest = true
): Promise<void> {
  const usesDefaultFixture = message === GOLDEN.helloSuccess;
  const previousConfirmCount = transport.sent.filter(
    (item) => item.type === TAKU_AGENT_MESSAGE_TYPES.sessionConfirm
  ).length;
  const latestHello = [...transport.sent]
    .reverse()
    .find((item) => item.type === TAKU_AGENT_MESSAGE_TYPES.hello);
  if (!latestHello || latestHello.type !== TAKU_AGENT_MESSAGE_TYPES.hello) {
    throw new Error('client hello was not sent');
  }
  const raw = structuredClone(message) as Record<string, unknown>;
  raw.requestId = latestHello.requestId;
  if (usesDefaultFixture) raw.frameEpoch = 'frame-epoch-1';
  if (recomputeCapabilitiesDigest && isRecord(raw.capabilities)) {
    const capabilities = parseTakuAgentCapabilities(raw.capabilities);
    if (capabilities)
      raw.capabilitiesDigest = await computeTakuAgentCapabilitiesDigest(capabilities);
  }
  transport.emit(raw, origin);
  await waitFor(
    () =>
      transport.sent.filter((item) => item.type === TAKU_AGENT_MESSAGE_TYPES.sessionConfirm)
        .length > previousConfirmCount
  );
  const confirm = [...transport.sent]
    .reverse()
    .find((item) => item.type === TAKU_AGENT_MESSAGE_TYPES.sessionConfirm);
  if (!confirm || confirm.type !== TAKU_AGENT_MESSAGE_TYPES.sessionConfirm) {
    throw new Error('session.confirm was not sent');
  }
  const helloResult = raw as unknown as TakuAgentHelloResultMessage;
  transport.emit(
    {
      __taku: true,
      protocol: TAKU_AGENT_PROTOCOL,
      type: TAKU_AGENT_MESSAGE_TYPES.sessionReady,
      requestId: confirm.requestId,
      frameEpoch: confirm.frameEpoch,
      sessionExpiresAt: helloResult.attestation.sessionExpiresAt,
    },
    origin
  );
  await nextTask();
}

function futureCapabilitiesDigest(capabilities: {
  recoveryScope: string;
  methods: string[];
  operations: Array<{ id: string; revision: number }>;
  limits: Record<string, number>;
}): string {
  const operations = capabilities.operations
    .map(({ id, revision }) => [id, revision] as const)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] - right[1]));
  const methods = [...new Set(capabilities.methods)];
  const { limits } = capabilities;
  const transcript = JSON.stringify([
    'taku.agent.capabilities/v2',
    capabilities.recoveryScope,
    operations,
    methods,
    [
      limits.maxConcurrentRuns,
      limits.maxInputBytes,
      limits.maxBufferedEvents,
      limits.maxEventBytes,
      limits.eventRetention,
      limits.maxSubscribersPerRun,
    ],
  ]);
  return createHash('sha256').update(transcript).digest('base64url');
}

async function waitForRequest(
  transport: FakeTransport,
  requestId: string
): Promise<TakuAgentRequestMessage> {
  await waitFor(() =>
    transport.sent.some(
      (item) => item.type === TAKU_AGENT_MESSAGE_TYPES.request && item.requestId === requestId
    )
  );
  const request = [...transport.sent]
    .reverse()
    .find((item) => item.type === TAKU_AGENT_MESSAGE_TYPES.request && item.requestId === requestId);
  if (!request || request.type !== TAKU_AGENT_MESSAGE_TYPES.request) {
    throw new Error(`request ${requestId} was not sent`);
  }
  return request;
}

async function waitForHello(transport: FakeTransport, requestId: string): Promise<void> {
  await waitFor(() =>
    transport.sent.some(
      (item) => item.type === TAKU_AGENT_MESSAGE_TYPES.hello && item.requestId === requestId
    )
  );
}

function wireEnvelopeForRequest(
  transport: FakeTransport,
  requestId: string
): TakuAgentSecureEnvelope {
  const envelope = transport.wireSent.find((message) => {
    if (message.type !== TAKU_AGENT_MESSAGE_TYPES.secure) return false;
    const body = parseTakuAgentSecureClientBody(message.body);
    return body?.type === TAKU_AGENT_MESSAGE_TYPES.request && body.requestId === requestId;
  });
  if (!envelope || envelope.type !== TAKU_AGENT_MESSAGE_TYPES.secure) {
    throw new Error(`secure request ${requestId} was not sent`);
  }
  return envelope;
}

function hostEnvelopeForResponse(
  request: TakuAgentRequestMessage,
  sequence: string,
  result: unknown,
  overrides: Partial<TakuAgentSecureEnvelope> = {}
): TakuAgentSecureEnvelope {
  return {
    __taku: true,
    protocol: TAKU_AGENT_PROTOCOL,
    type: TAKU_AGENT_MESSAGE_TYPES.secure,
    sessionId: 'ICEiIyQlJicoKSorLC0uLw',
    direction: 'h2c',
    lane: 'rpc',
    sequence,
    body: JSON.stringify(successResponse(request, result)),
    mac: HOST_MAC,
    ...overrides,
  };
}

function successResponse(
  request: TakuAgentRequestMessage,
  result: unknown
): Record<string, unknown> {
  return {
    __taku: true,
    type: TAKU_AGENT_MESSAGE_TYPES.response,
    protocol: TAKU_AGENT_PROTOCOL,
    frameEpoch: request.frameEpoch,
    requestId: request.requestId,
    ok: true,
    result,
  };
}

function failureResponse(
  request: TakuAgentRequestMessage,
  code: 'stale_frame' | 'capability_not_granted'
): Record<string, unknown> {
  return {
    __taku: true,
    type: TAKU_AGENT_MESSAGE_TYPES.response,
    protocol: TAKU_AGENT_PROTOCOL,
    frameEpoch: request.frameEpoch,
    requestId: request.requestId,
    ok: false,
    error: {
      code,
      message: code === 'stale_frame' ? 'The frame has navigated' : 'Capability is not granted',
      retryable: code === 'stale_frame',
    },
  };
}

function snapshot(state: TakuAgentRunCursor['snapshot']['state'] = 'running') {
  return {
    runId: 'run-1',
    operation: TAKU_AGENT_OPERATION,
    operationRevision: 1 as const,
    state,
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:01.000Z',
  };
}

function emptySubscriptionResult(subscriptionId = 'subscription-1'): TakuAgentSubscribeResult {
  return {
    subscriptionId,
    snapshot: snapshot(),
    lastSequence: 0,
    oldestRetainedSequence: 1,
    replayedEvents: [],
  };
}

function contentRefCapabilities(): TakuAgentCapabilities {
  const base = parseTakuAgentCapabilities(GOLDEN.capabilities);
  if (!base) throw new Error('golden capabilities must parse');
  return {
    ...base,
    methods: [...base.methods, 'content.read'],
    features: ['content-ref-v1'],
  };
}

function assetOpenCapabilities(): TakuAgentCapabilities {
  const base = parseTakuAgentCapabilities(GOLDEN.capabilities);
  if (!base) throw new Error('golden capabilities must parse');
  return {
    ...base,
    methods: [...base.methods, 'asset.open'],
    operations: [
      ...base.operations,
      { id: TAKU_AGENT_IMAGE_OPERATION, revision: 1 },
      { id: TAKU_AGENT_VIDEO_OPERATION, revision: 1 },
    ],
    features: ['asset-open-v1'],
  };
}

function desktopCatalogCapabilities(): Record<string, unknown> {
  const base = parseTakuAgentCapabilities(GOLDEN.capabilities);
  if (!base) throw new Error('golden capabilities must parse');
  return {
    ...base,
    methods: [...TAKU_AGENT_METHODS],
    operations: [
      { id: TAKU_AGENT_EXECUTE_OPERATION, revision: 1 },
      { id: TAKU_AGENT_OPERATION, revision: 1 },
      { id: TAKU_AGENT_IMAGE_OPERATION, revision: 1 },
      { id: TAKU_AGENT_VIDEO_OPERATION, revision: 1 },
    ],
    features: [...TAKU_AGENT_CLIENT_FEATURES],
    catalog: {
      catalogVersion: 'taku.agent.operation-catalog/v1',
      operations: [
        {
          id: TAKU_AGENT_EXECUTE_OPERATION,
          revision: 1,
          title: 'Run an agent task',
          description: 'Complete a general application task with Host-managed tools.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['instruction'],
            properties: {
              instruction: { type: 'string', minLength: 1, maxLength: 8_000 },
            },
          },
          outputSchema: { type: 'object' },
          outputKinds: ['text', 'markdown', 'json'],
        },
        {
          id: TAKU_AGENT_OPERATION,
          revision: 1,
          title: 'Generate a research report',
          description: 'Research a topic and return a structured markdown report.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['topic'],
            properties: { topic: { type: 'string', minLength: 1, maxLength: 500 } },
          },
          outputSchema: { type: 'object' },
          outputKinds: ['report'],
        },
        {
          id: TAKU_AGENT_IMAGE_OPERATION,
          revision: 1,
          title: 'Generate images',
          description: 'Generate images and import them into application-owned Host assets.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['prompt'],
            properties: {
              prompt: { type: 'string', minLength: 1, maxLength: 4_000 },
              aspectRatio: {
                type: 'string',
                enum: ['16:9', '9:16', '4:3', '3:4', '1:1'],
                default: '1:1',
              },
            },
          },
          outputSchema: { type: 'object' },
          outputKinds: ['images'],
          fixedBehavior: [
            'Routing and fallback are managed by Taku AI Proxy.',
            'One generated asset is requested per operation; start another operation for another variant.',
          ],
        },
        {
          id: TAKU_AGENT_VIDEO_OPERATION,
          revision: 1,
          title: 'Generate video',
          description: 'Generate a video and import it into application-owned Host assets.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['prompt'],
            properties: {
              prompt: { type: 'string', minLength: 1, maxLength: 4_000 },
              aspectRatio: { type: 'string', enum: ['16:9', '9:16'], default: '16:9' },
              durationSeconds: { type: 'integer', enum: [4, 6, 8], default: 4 },
            },
          },
          outputSchema: { type: 'object' },
          outputKinds: ['videos'],
          fixedBehavior: ['Routing and fallback are managed by Taku AI Proxy.'],
        },
      ],
    },
  };
}

async function nextTask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await nextTask();
  }
  throw new Error('test condition timed out');
}

async function waitForAsyncWork(predicate: () => boolean, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('async test condition timed out');
}

async function assertSameSessionGet(
  transport: FakeTransport,
  client: TakuAgentClient,
  requestId: string
): Promise<void> {
  const helloCount = transport.sent.filter(
    (message) => message.type === TAKU_AGENT_MESSAGE_TYPES.hello
  ).length;
  const pending = client.get('run-1');
  const request = await waitForRequest(transport, requestId);
  transport.emit(successResponse(request, { snapshot: snapshot(), lastSequence: 0 }));
  assert.deepEqual(await pending, { snapshot: snapshot(), lastSequence: 0 });
  assert.equal(
    transport.sent.filter((message) => message.type === TAKU_AGENT_MESSAGE_TYPES.hello).length,
    helloCount
  );
}

async function assertCleanupResponsePreservesSession(
  transport: FakeTransport,
  client: TakuAgentClient,
  cleanupRequest: TakuAgentRequestMessage,
  getRequestId: string
): Promise<void> {
  transport.emit(successResponse(cleanupRequest, { unsubscribed: true }));
  await nextTask();
  await assertSameSessionGet(transport, client, getRequestId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

test('canonical v2 golden messages parse and only the QA fixture opts in', async () => {
  assert.equal(GOLDEN.contractRevision, TAKU_AGENT_CONTRACT_REVISION);
  assert.deepEqual(parseTakuAgentHostMessage(GOLDEN.helloSuccess), GOLDEN.helloSuccess);
  assert.deepEqual(parseTakuAgentHostMessage(GOLDEN.helloFailure), GOLDEN.helloFailure);
  const capabilities = parseTakuAgentCapabilities(GOLDEN.capabilities);
  if (!capabilities) assert.fail('golden capabilities must parse');
  assert.equal(await computeTakuAgentCapabilitiesDigest(capabilities), GOLDEN.capabilitiesDigest);
  for (const name of ['sessionConfirm', 'sessionReady', 'start', 'response', 'event']) {
    const envelope = parseTakuAgentSecureEnvelope(GOLDEN[name]);
    if (!envelope) assert.fail(`${name} must parse as a secure envelope`);
    const body =
      envelope.direction === 'c2h'
        ? parseTakuAgentSecureClientBody(envelope.body)
        : parseTakuAgentSecureHostBody(envelope.body);
    assert.ok(body, `${name} body`);
  }
  const serializedGolden = JSON.stringify(GOLDEN);
  for (const forbidden of [
    'applicationId',
    'userId',
    'provider',
    'model',
    'apiKey',
    'controlToken',
    'workingDir',
    'mcpServers',
    'proxyUrl',
  ]) {
    assert.equal(serializedGolden.includes(`"${forbidden}"`), false);
  }

  const defaultManifest = JSON.parse(
    readFileSync(new URL('../../../taku.manifest.json', import.meta.url), 'utf8')
  ) as Record<string, unknown>;
  const qaManifest = JSON.parse(
    readFileSync(new URL('./fixtures/agent-runtime-qa.manifest.json', import.meta.url), 'utf8')
  ) as Record<string, unknown>;
  assert.equal('runtimeCapabilities' in defaultManifest, false);
  assert.deepEqual(qaManifest.runtimeCapabilities, {
    protocol: TAKU_AGENT_PROTOCOL,
    operations: [
      { id: TAKU_AGENT_EXECUTE_OPERATION, revision: 1 },
      { id: TAKU_AGENT_OPERATION, revision: 1 },
      { id: TAKU_AGENT_IMAGE_OPERATION, revision: 1 },
      { id: TAKU_AGENT_VIDEO_OPERATION, revision: 1 },
    ],
  });
});

test('client nonce accepts only canonical base64url encodings of exactly 32 bytes', () => {
  const zeroBytes = Buffer.alloc(32).toString('base64url');
  const fullBytes = Buffer.alloc(32, 0xff).toString('base64url');
  assert.equal(zeroBytes.length, 43);
  assert.equal(fullBytes.length, 43);
  assert.equal(isTakuAgentClientNonce(zeroBytes), true);
  assert.equal(isTakuAgentClientNonce(fullBytes), true);

  assert.equal(isTakuAgentClientNonce(Buffer.alloc(31).toString('base64url')), false);
  assert.equal(isTakuAgentClientNonce(Buffer.alloc(33).toString('base64url')), false);
  assert.equal(isTakuAgentClientNonce(`${zeroBytes}=`), false);
  assert.equal(isTakuAgentClientNonce(`+${zeroBytes.slice(1)}`), false);

  const nonCanonicalTrailingBits = `${zeroBytes.slice(0, -1)}B`;
  assert.equal(Buffer.from(nonCanonicalTrailingBits, 'base64url').byteLength, 32);
  assert.equal(isTakuAgentClientNonce(nonCanonicalTrailingBits), false);
});

test('v2 canonical transcripts reproduce the frozen cross-runtime golden vectors', async () => {
  const hello = GOLDEN.hello as TakuAgentHelloResultMessage & {
    clientNonce: string;
  };
  const success = GOLDEN.helloSuccess as TakuAgentHelloResultMessage;
  const attestationInput = {
    protocol: TAKU_AGENT_PROTOCOL,
    requestId: (GOLDEN.hello as { requestId: string }).requestId,
    clientNonce: (GOLDEN.hello as { clientNonce: string }).clientNonce,
    frameEpoch: success.frameEpoch,
    runtimeInstanceId: success.attestation.runtimeInstanceId,
    sessionId: success.attestation.sessionId,
    capabilitiesDigest: success.capabilitiesDigest,
    proofExpiresAt: success.attestation.proofExpiresAt,
    sessionExpiresAt: success.attestation.sessionExpiresAt,
  };
  assert.equal(
    createHmac('sha256', 'fixture-control-token-32-bytes!!')
      .update(serializeTakuAgentHostAttestationPayload(attestationInput))
      .digest('base64url'),
    success.attestation.proof
  );

  const material = {
    verified: true,
    sessionId: success.attestation.sessionId,
    sessionExpiresAt: success.attestation.sessionExpiresAt,
    c2hKey: 'm4nkQVjbQseySPCAzbbMK3nPXyh5BUNP3T8-TVaC6dY',
    h2cKey: '9YLUTDFaJyOXS-ibdC3ijh0W7uGmB2SD-sNuOsMjpfU',
  } as const;
  const authenticator = await importTakuAgentSessionAuthenticator(material);
  const confirm = parseTakuAgentSecureEnvelope(GOLDEN.sessionConfirm);
  const ready = parseTakuAgentSecureEnvelope(GOLDEN.sessionReady);
  if (!confirm || !ready) assert.fail('golden secure envelopes must parse');
  assert.equal(
    await authenticator.signClientMessage(confirm.lane, confirm.sequence, confirm.body),
    confirm.mac
  );
  assert.equal(await authenticator.verifyHostMessage(ready), true);
  assert.deepEqual(Object.keys(authenticator).sort(), [
    'sessionExpiresAt',
    'sessionId',
    'signClientMessage',
    'verifyHostMessage',
  ]);
  assert.equal(JSON.stringify(authenticator).includes('m4nkQV'), false);
  assert.equal(JSON.stringify(authenticator).includes('9YLUTD'), false);
  const mutableMaterial = material as {
    sessionId: string;
    sessionExpiresAt: number;
    c2hKey: string;
    h2cKey: string;
  };
  mutableMaterial.sessionId = 'AAAAAAAAAAAAAAAAAAAAAA';
  mutableMaterial.c2hKey = CLIENT_MAC;
  assert.equal(
    await authenticator.signClientMessage(confirm.lane, confirm.sequence, confirm.body),
    confirm.mac
  );
  void hello;
});

test('secure envelopes enforce the 64 KiB outer boundary and reject empty bodies', async () => {
  const baseEnvelope: TakuAgentSecureEnvelope = {
    __taku: true,
    protocol: TAKU_AGENT_PROTOCOL,
    type: TAKU_AGENT_MESSAGE_TYPES.secure,
    sessionId: 'ICEiIyQlJicoKSorLC0uLw',
    direction: 'h2c',
    lane: 'rpc',
    sequence: '2',
    body: '',
    mac: HOST_MAC,
  };
  const envelopeOverhead = getTakuAgentUtf8ByteLength(JSON.stringify(baseEnvelope));
  const exact = {
    ...baseEnvelope,
    body: 'x'.repeat(TAKU_AGENT_MAX_SECURE_ENVELOPE_BYTES - envelopeOverhead),
  };
  assert.equal(
    getTakuAgentUtf8ByteLength(JSON.stringify(exact)),
    TAKU_AGENT_MAX_SECURE_ENVELOPE_BYTES
  );
  assert.deepEqual(parseTakuAgentSecureEnvelope(exact), exact);
  assert.equal(parseTakuAgentSecureEnvelope({ ...exact, body: `${exact.body}x` }), null);
  assert.equal(parseTakuAgentSecureEnvelope(baseEnvelope), null);

  const authenticator: TakuAgentSessionAuthenticator = {
    sessionId: baseEnvelope.sessionId,
    sessionExpiresAt: Date.now() + 1_000,
    signClientMessage: async () => CLIENT_MAC,
    verifyHostMessage: async () => true,
  };
  await assert.rejects(
    createTakuAgentSecureClientEnvelope({
      authenticator,
      lane: 'rpc',
      sequence: '2',
      body: `${exact.body}x`,
    }),
    /secure envelope exceeds/
  );
});

test('capability canonicalization is order-independent and rejects duplicate operations', async () => {
  const canonical = parseTakuAgentCapabilities(GOLDEN.capabilities);
  if (!canonical) assert.fail('canonical capabilities must parse');
  const shuffled = {
    recoveryScope: canonical.recoveryScope,
    methods: [
      'agent.result',
      'agent.start',
      'runtime.capabilities',
      'agent.start',
      'agent.cancel',
      'agent.unsubscribe',
      'agent.get',
      'agent.subscribe',
    ],
    operations: [{ revision: 1, id: TAKU_AGENT_OPERATION }],
    limits: { ...canonical.limits },
  };
  const normalized = parseTakuAgentCapabilities(shuffled);
  if (!normalized) assert.fail('shuffled capabilities must normalize');
  assert.equal(
    serializeTakuAgentCapabilities(normalized),
    serializeTakuAgentCapabilities(canonical)
  );
  assert.equal(await computeTakuAgentCapabilitiesDigest(normalized), GOLDEN.capabilitiesDigest);
  const differentRecoveryScope = parseTakuAgentCapabilities({
    ...shuffled,
    recoveryScope: 'fixture-recovery-scope-0002',
  });
  if (!differentRecoveryScope) assert.fail('alternate recovery scope must parse');
  assert.notEqual(
    await computeTakuAgentCapabilitiesDigest(differentRecoveryScope),
    GOLDEN.capabilitiesDigest
  );
  assert.equal(
    parseTakuAgentCapabilities({
      ...shuffled,
      operations: [
        { id: TAKU_AGENT_OPERATION, revision: 1 },
        { id: TAKU_AGENT_OPERATION, revision: 1 },
      ],
    }),
    null
  );
  assert.deepEqual(
    parseTakuAgentCapabilities({
      ...shuffled,
      methods: ['agent.start', 'agent.start', 'runtime.capabilities'],
    })?.methods,
    ['runtime.capabilities', 'agent.start']
  );
  assert.equal(parseTakuAgentCapabilities({ ...shuffled, recoveryScope: '' }), null);
  const paddedScope = parseTakuAgentCapabilities({
    ...shuffled,
    recoveryScope: `\u2003${RECOVERY_SCOPE}\u2003`,
  });
  assert.equal(paddedScope?.recoveryScope, RECOVERY_SCOPE);
  assert.equal(
    serializeTakuAgentCapabilities({ ...canonical, recoveryScope: ` ${RECOVERY_SCOPE} ` }),
    serializeTakuAgentCapabilities(canonical)
  );
  const { recoveryScope: _recoveryScope, ...missingRecoveryScope } = shuffled;
  assert.equal(parseTakuAgentCapabilities(missingRecoveryScope), null);
  assert.equal(parseTakuAgentCapabilities({ ...shuffled, recoveryScope: 'x'.repeat(129) }), null);
});

test('capability parsing projects future Host extensions onto the SDK-known intersection', () => {
  const canonical = parseTakuAgentCapabilities(GOLDEN.capabilities);
  if (!canonical) assert.fail('canonical capabilities must parse');
  const futureCapabilities = {
    ...structuredClone(GOLDEN.capabilities as Record<string, unknown>),
    recoveryScope: canonical.recoveryScope,
    futureTopLevel: { opaque: true },
    methods: [...canonical.methods, 'agent.pause'],
    operations: [
      ...canonical.operations,
      { id: 'agent.compose', revision: 1, futureOperationMetadata: true },
      { id: TAKU_AGENT_OPERATION, revision: 2 },
      { id: 'media.audio.generate', revision: 1 },
    ],
    limits: { ...canonical.limits, maxMediaAssets: 4 },
  };

  assert.deepEqual(parseTakuAgentCapabilities(futureCapabilities), canonical);
  assert.equal(
    parseTakuAgentCapabilities({ ...futureCapabilities, methods: [...canonical.methods, 42] }),
    null
  );
  assert.equal(
    parseTakuAgentCapabilities({
      ...futureCapabilities,
      operations: [...canonical.operations, { id: 42, revision: 1 }],
    }),
    null
  );
  assert.equal(
    parseTakuAgentCapabilities({
      ...futureCapabilities,
      limits: { ...canonical.limits, maxEventBytes: '32768' },
    }),
    null
  );
});

test('unknown Host error codes become bounded generic retryable errors', () => {
  assert.deepEqual(
    parseTakuAgentError({
      code: 'future_capacity_rebalancing',
      message: 'The Host is moving this run; try again shortly.',
      retryable: false,
      retryAfterMs: 750,
      futureMetadata: { opaque: true },
    }),
    {
      code: 'internal_error',
      message: 'The Host is moving this run; try again shortly.',
      retryable: true,
      retryAfterMs: 750,
    }
  );
  assert.equal(parseTakuAgentError({ code: 'future_error', message: 'x'.repeat(4_001) }), null);
  assert.equal(
    parseTakuAgentError({ code: 'future_error', message: 'safe', retryable: 'yes' }),
    null
  );
});

test('future handshake extensions stay authenticated while only known capabilities are exposed', async (t) => {
  const canonical = parseTakuAgentCapabilities(GOLDEN.capabilities);
  if (!canonical) assert.fail('canonical capabilities must parse');
  const futureCapabilities = {
    ...structuredClone(GOLDEN.capabilities as Record<string, unknown>),
    recoveryScope: canonical.recoveryScope,
    futureTopLevel: 'ignored after transcript validation',
    methods: [...canonical.methods, 'agent.pause'],
    operations: [
      ...canonical.operations,
      { id: 'agent.compose', revision: 1 },
      { id: 'media.audio.generate', revision: 1 },
    ],
    limits: { ...canonical.limits, maxMediaAssets: 4 },
  };
  const capabilitiesDigest = futureCapabilitiesDigest(futureCapabilities);
  assert.notEqual(capabilitiesDigest, await computeTakuAgentCapabilitiesDigest(canonical));
  const futureHello = {
    ...(structuredClone(GOLDEN.helloSuccess) as Record<string, unknown>),
    capabilities: futureCapabilities,
    capabilitiesDigest,
    futureHandshakeMetadata: { opaque: true },
  };
  const parsedHello = parseTakuAgentHostMessage(futureHello);
  assert.equal(parsedHello?.type, TAKU_AGENT_MESSAGE_TYPES.helloResult);
  assert.equal(parsedHello?.ok, true);
  if (!parsedHello?.ok) assert.fail('future hello must parse as a success');
  assert.deepEqual(parsedHello.capabilities, canonical);

  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'capabilities-1']);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport, futureHello, HOST_ORIGIN, false);
  assert.equal(transport.verificationInputs[0]?.capabilitiesDigest, capabilitiesDigest);

  const pendingCapabilities = client.capabilities();
  const request = await waitForRequest(transport, 'capabilities-1');
  transport.emit(successResponse(request, futureCapabilities));
  assert.deepEqual(await pendingCapabilities, canonical);

  const mismatchedTransport = new FakeTransport();
  const mismatchedClient = makeClient(mismatchedTransport, ['hello-1', 'get-1']);
  t.after(() => mismatchedClient.close());
  await nextTask();
  const pending = mismatchedClient.get('run-1');
  const assertion = assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_host_untrusted'
  );
  const mismatchedHello = structuredClone(futureHello) as Record<string, unknown>;
  mismatchedHello.requestId = 'hello-1';
  mismatchedHello.capabilitiesDigest = Buffer.alloc(32, 9).toString('base64url');
  mismatchedTransport.emit(mismatchedHello);
  await assertion;
  assert.equal(mismatchedTransport.verificationInputs.length, 0);
});

test('unknown hello failure codes remain actionable instead of invalidating the handshake parser', async (t) => {
  const failure = {
    __taku: true,
    type: TAKU_AGENT_MESSAGE_TYPES.helloResult,
    protocol: TAKU_AGENT_PROTOCOL,
    requestId: 'hello-1',
    ok: false,
    error: {
      code: 'future_host_warming_up',
      message: 'The Host is warming up; retry shortly.',
      retryable: false,
    },
    futureHandshakeMetadata: true,
  };
  assert.deepEqual(parseTakuAgentHostMessage(failure), {
    __taku: true,
    type: TAKU_AGENT_MESSAGE_TYPES.helloResult,
    protocol: TAKU_AGENT_PROTOCOL,
    requestId: 'hello-1',
    ok: false,
    error: {
      code: 'internal_error',
      message: 'The Host is warming up; retry shortly.',
      retryable: true,
    },
  });

  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'get-1']);
  t.after(() => client.close());
  const pending = client.get('run-1');
  await waitForHello(transport, 'hello-1');
  transport.emit(failure);
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof TakuAgentError &&
      error.code === 'internal_error' &&
      error.retryable === true &&
      error.message === 'The Host is warming up; retry shortly.'
  );
});

test('browser transport only pins postMessage to valid web origins', () => {
  assert.equal(getTakuAgentPostMessageTargetOrigin('https://host.taku.ai'), 'https://host.taku.ai');
  assert.equal(
    getTakuAgentPostMessageTargetOrigin('http://localhost:3000'),
    'http://localhost:3000'
  );
  assert.equal(getTakuAgentPostMessageTargetOrigin('file://'), '*');
  assert.equal(
    getTakuAgentPostMessageTargetOrigin('file:///Applications/Taku.app/index.html'),
    '*'
  );
  assert.equal(getTakuAgentPostMessageTargetOrigin('null'), '*');
  assert.equal(getTakuAgentPostMessageTargetOrigin(null), '*');
});

test('browser attestation verifier always uses the fixed same-origin route', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestedUrl: string | URL | Request | undefined;
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requestedUrl = url;
    requestedInit = init;
    const result = GOLDEN.helloSuccess as TakuAgentHelloResultMessage;
    return new Response(
      JSON.stringify({
        verified: true,
        sessionId: result.attestation.sessionId,
        sessionExpiresAt: result.attestation.sessionExpiresAt,
        c2hKey: 'm4nkQVjbQseySPCAzbbMK3nPXyh5BUNP3T8-TVaC6dY',
        h2cKey: '9YLUTDFaJyOXS-ibdC3ijh0W7uGmB2SD-sNuOsMjpfU',
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }
    );
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const hello = GOLDEN.hello as { clientNonce: string; requestId: string };
  const result = GOLDEN.helloSuccess as TakuAgentHelloResultMessage;
  const input: TakuAgentHostAttestationVerification = {
    protocol: TAKU_AGENT_PROTOCOL,
    requestId: hello.requestId,
    clientNonce: hello.clientNonce,
    frameEpoch: result.frameEpoch,
    capabilitiesDigest: result.capabilitiesDigest,
    ...result.attestation,
  };
  const authenticator = await verifyTakuAgentHostAttestation(input, new AbortController().signal);
  assert.equal(authenticator?.sessionId, result.attestation.sessionId);
  assert.equal(requestedUrl, '/__taku/host-attestation/verify');
  assert.equal(requestedInit?.method, 'POST');
  assert.equal(requestedInit?.credentials, 'same-origin');
  assert.equal(requestedInit?.cache, 'no-store');
  assert.equal(requestedInit?.redirect, 'error');
  assert.equal(
    (requestedInit?.headers as Record<string, string>)['x-taku-agent-session'],
    result.attestation.sessionId
  );
  assert.equal('origin' in (requestedInit?.headers as Record<string, string>), false);
  assert.equal('sec-fetch-site' in (requestedInit?.headers as Record<string, string>), false);
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), input);
});

test('start requires caller-visible idempotency and authenticated recovery identities', () => {
  assert.throws(
    () =>
      validateTakuAgentStartInput({
        operation: TAKU_AGENT_OPERATION,
        expectedRecoveryScope: RECOVERY_SCOPE,
        input: { topic: 'Missing recovery identity' },
      } as never),
    /Invalid research\.generateReport input/
  );
  assert.throws(
    () =>
      validateTakuAgentStartInput({
        operation: TAKU_AGENT_OPERATION,
        input: { topic: 'Missing scope fence' },
        idempotencyKey: 'has-idempotency-key',
      } as never),
    /Invalid research\.generateReport input/
  );
  const key = createTakuAgentIdempotencyKey();
  assert.ok(key.startsWith('subapp-'));
  assert.ok(key.length <= 128);

  assert.deepEqual(
    validateTakuAgentStartInput({
      operation: TAKU_AGENT_OPERATION,
      expectedRecoveryScope: `\u2003${RECOVERY_SCOPE}\u2003`,
      input: {
        topic: '  Unicode normalization  ',
        instructions: '\u2003Keep the canonical wire stable\u2003',
        language: ' en ',
      },
      idempotencyKey: ' padded-idempotency-key ',
    }),
    {
      operation: TAKU_AGENT_OPERATION,
      operationRevision: 1,
      expectedRecoveryScope: RECOVERY_SCOPE,
      input: {
        topic: 'Unicode normalization',
        instructions: 'Keep the canonical wire stable',
        language: 'en',
      },
      idempotencyKey: 'padded-idempotency-key',
    }
  );
});

test('client actively sends hello and accepts the final retry response before its deadline', async (t) => {
  const transport = new FakeTransport();
  const client = new TakuAgentClient(transport, {
    requestIdFactory: idFactory(['hello-1', 'confirm-1', 'capabilities-1']),
    clientNonceFactory: nonceFactory(),
    helloRetryDelaysMs: [0, 5],
    helloResponseGraceMs: 500,
  });
  t.after(() => client.close());

  await waitFor(() => transport.sent.length === 2, 100);
  assert.equal(transport.sent.length, 2);
  assert.deepEqual(transport.sent[0], transport.sent[1]);
  assert.equal(transport.sent[0]?.type, TAKU_AGENT_MESSAGE_TYPES.hello);
  if (transport.sent[0]?.type !== TAKU_AGENT_MESSAGE_TYPES.hello) {
    assert.fail('first outbound message must be hello');
  }
  assert.deepEqual(transport.sent[0].clientFeatures, [...TAKU_AGENT_CLIENT_FEATURES]);

  await emitTrustedHello(transport);
  assert.equal(transport.boundOrigin, HOST_ORIGIN);
  const pendingCapabilities = client.capabilities();
  await nextTask();
  const request = transport.sent.at(-1) as TakuAgentRequestMessage;
  transport.emit(
    successResponse(request, (GOLDEN.helloSuccess as TakuAgentHelloResultMessage).capabilities)
  );
  assert.deepEqual(
    await pendingCapabilities,
    (GOLDEN.helloSuccess as TakuAgentHelloResultMessage).capabilities
  );
});

test('client binds and sends business input only after trusted Host verification succeeds', async (t) => {
  const transport = new FakeTransport();
  let finishVerification: ((verified: boolean) => void) | undefined;
  transport.verifier = async () =>
    new Promise<boolean>((resolve) => {
      finishVerification = resolve;
    });
  const client = makeClient(transport, ['hello-1', 'start-1', 'confirm-1']);
  t.after(() => client.close());
  await nextTask();

  const pending = client.start({
    operation: TAKU_AGENT_OPERATION,
    expectedRecoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Do not disclose before trust' },
    idempotencyKey: 'attestation-gate-1',
  });
  const helloSuccess = structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage;
  helloSuccess.requestId = 'hello-1';
  helloSuccess.frameEpoch = 'frame-epoch-1';
  transport.emit(helloSuccess);
  await waitFor(() => transport.verificationInputs.length === 1);
  assert.equal(transport.boundOrigin, null);
  assert.equal(
    transport.sent.some((message) => message.type === 'request'),
    false
  );
  assert.deepEqual(transport.verificationInputs, [
    {
      protocol: TAKU_AGENT_PROTOCOL,
      requestId: 'hello-1',
      clientNonce: TEST_NONCES[0],
      frameEpoch: 'frame-epoch-1',
      capabilitiesDigest: helloSuccess.capabilitiesDigest,
      ...(GOLDEN.helloSuccess as TakuAgentHelloResultMessage).attestation,
    },
  ]);

  finishVerification?.(true);
  await waitFor(() =>
    transport.sent.some(
      (message) =>
        message.type === TAKU_AGENT_MESSAGE_TYPES.sessionConfirm &&
        message.requestId === 'confirm-1'
    )
  );
  assert.equal(transport.boundOrigin, HOST_ORIGIN);
  assert.equal(
    transport.sent.some((message) => message.type === TAKU_AGENT_MESSAGE_TYPES.request),
    false
  );
  transport.emit({
    __taku: true,
    protocol: TAKU_AGENT_PROTOCOL,
    type: TAKU_AGENT_MESSAGE_TYPES.sessionReady,
    requestId: 'confirm-1',
    frameEpoch: 'frame-epoch-1',
    sessionExpiresAt: helloSuccess.attestation.sessionExpiresAt,
  });
  const request = await waitForRequest(transport, 'start-1');
  assert.equal(request.method, 'agent.start');
  transport.emit(successResponse(request, { snapshot: snapshot(), lastSequence: 0 }));
  await pending;
});

test('untrusted parents fail closed while a later explicit call can retry a transient timeout', async (t) => {
  const rejectedTransport = new FakeTransport();
  rejectedTransport.verifier = async () => false;
  const rejectedClient = makeClient(rejectedTransport, ['hello-1', 'start-1']);
  t.after(() => rejectedClient.close());
  await nextTask();
  const rejected = rejectedClient.start({
    operation: TAKU_AGENT_OPERATION,
    expectedRecoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Secret input must stay local' },
    idempotencyKey: 'evil-parent-1',
  });
  const rejectedAssertion = assert.rejects(
    rejected,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_host_untrusted'
  );
  const rejectedHello = structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage;
  rejectedHello.requestId = 'hello-1';
  rejectedTransport.emit(rejectedHello, 'https://evil.example');
  await rejectedAssertion;
  assert.equal(
    rejectedTransport.sent.some((message) => message.type === 'request'),
    false
  );

  const malformedTransport = new FakeTransport();
  const malformedClient = makeClient(malformedTransport, ['hello-1', 'start-1']);
  t.after(() => malformedClient.close());
  await nextTask();
  const malformedPending = malformedClient.start({
    operation: TAKU_AGENT_OPERATION,
    expectedRecoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Malformed proof' },
    idempotencyKey: 'malformed-proof-1',
  });
  const malformedAssertion = assert.rejects(
    malformedPending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_host_untrusted'
  );
  const malformedHello = structuredClone(GOLDEN.helloSuccess) as Record<string, unknown>;
  malformedHello.requestId = 'hello-1';
  delete malformedHello.attestation;
  malformedTransport.emit(malformedHello);
  await malformedAssertion;
  assert.equal(
    malformedTransport.sent.some((message) => message.type === 'request'),
    false
  );

  const mismatchedTransport = new FakeTransport();
  const mismatchedClient = makeClient(mismatchedTransport, ['hello-1', 'start-1']);
  t.after(() => mismatchedClient.close());
  await nextTask();
  const mismatchedPending = mismatchedClient.start({
    operation: TAKU_AGENT_OPERATION,
    expectedRecoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Mismatched request identity' },
    idempotencyKey: 'mismatched-request-1',
  });
  const mismatchedAssertion = assert.rejects(
    mismatchedPending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'host_unavailable'
  );
  const mismatchedHello = structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage;
  mismatchedHello.requestId = 'another-hello';
  mismatchedTransport.emit(mismatchedHello);
  await mismatchedAssertion;
  assert.equal(
    mismatchedTransport.sent.some((message) => message.type === 'request'),
    false
  );

  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeoutTransport = new FakeTransport();
  let lateSuccess: ((verified: boolean) => void) | undefined;
  let verificationAttempts = 0;
  timeoutTransport.verifier = async () => {
    verificationAttempts += 1;
    if (verificationAttempts > 1) return true;
    return new Promise<boolean>((resolve) => {
      lateSuccess = resolve;
    });
  };
  const timeoutClient = new TakuAgentClient(timeoutTransport, {
    requestIdFactory: idFactory(['hello-1', 'start-1', 'start-2', 'hello-2', 'confirm-2']),
    clientNonceFactory: nonceFactory(),
    helloRetryDelaysMs: [0],
    helloResponseGraceMs: 40,
    hostAttestationTimeoutMs: 5,
  });
  try {
    t.mock.timers.tick(0);
    const timedOut = timeoutClient.start({
      operation: TAKU_AGENT_OPERATION,
      expectedRecoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Late proof' },
      idempotencyKey: 'late-proof-1',
    });
    const timeoutAssertion = assert.rejects(
      timedOut,
      (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_host_untrusted'
    );
    const firstHelloResult = structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage;
    firstHelloResult.requestId = 'hello-1';
    timeoutTransport.emit(firstHelloResult);
    await waitForAsyncWork(() => verificationAttempts === 1 && lateSuccess !== undefined);
    t.mock.timers.tick(5);
    await timeoutAssertion;
    lateSuccess?.(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(timeoutTransport.boundOrigin, null);
    assert.equal(
      timeoutTransport.sent.some((message) => message.type === 'request'),
      false
    );

    const retried = timeoutClient.start({
      operation: TAKU_AGENT_OPERATION,
      expectedRecoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Fresh explicit retry' },
      idempotencyKey: 'fresh-retry-1',
    });
    t.mock.timers.tick(0);
    const retryHello = timeoutTransport.sent.at(-1);
    assert.equal(retryHello?.type, 'hello');
    assert.equal(retryHello?.requestId, 'hello-2');
    if (retryHello?.type !== 'hello') assert.fail('retry must begin with a fresh hello');
    assert.notEqual(retryHello.clientNonce, (GOLDEN.hello as { clientNonce: string }).clientNonce);

    timeoutTransport.emit(firstHelloResult);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(verificationAttempts, 1);
    assert.equal(timeoutTransport.boundOrigin, null);
    assert.equal(
      timeoutTransport.sent.some((message) => message.type === 'request'),
      false
    );

    const retryHelloResult = structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage;
    retryHelloResult.requestId = 'hello-2';
    retryHelloResult.frameEpoch = 'frame-epoch-2';
    timeoutTransport.emit(retryHelloResult);
    await waitForAsyncWork(() =>
      timeoutTransport.sent.some(
        (message) =>
          message.type === TAKU_AGENT_MESSAGE_TYPES.sessionConfirm &&
          message.requestId === 'confirm-2'
      )
    );
    const confirm = timeoutTransport.sent.at(-1);
    if (!confirm || confirm.type !== TAKU_AGENT_MESSAGE_TYPES.sessionConfirm) {
      assert.fail('retry must authenticate with a fresh session.confirm');
    }
    timeoutTransport.emit({
      __taku: true,
      protocol: TAKU_AGENT_PROTOCOL,
      type: TAKU_AGENT_MESSAGE_TYPES.sessionReady,
      requestId: confirm.requestId,
      frameEpoch: confirm.frameEpoch,
      sessionExpiresAt: retryHelloResult.attestation.sessionExpiresAt,
    });
    await waitForAsyncWork(() =>
      timeoutTransport.sent.some(
        (message) =>
          message.type === TAKU_AGENT_MESSAGE_TYPES.request && message.requestId === 'start-2'
      )
    );
    const retriedRequest = timeoutTransport.sent.find(
      (message) =>
        message.type === TAKU_AGENT_MESSAGE_TYPES.request && message.requestId === 'start-2'
    );
    if (!retriedRequest || retriedRequest.type !== TAKU_AGENT_MESSAGE_TYPES.request) {
      assert.fail('retry request was not sent after session.ready');
    }
    assert.equal(retriedRequest.method, 'agent.start');
    assert.equal(retriedRequest.frameEpoch, 'frame-epoch-2');
    assert.equal(timeoutTransport.sent.filter((message) => message.type === 'request').length, 1);
    timeoutTransport.emit(
      successResponse(retriedRequest, { snapshot: snapshot(), lastSequence: 0 })
    );
    await retried;
  } finally {
    timeoutClient.close();
    t.mock.timers.reset();
  }
});

test('hello failure surfaces any canonical Host error without waiting for request timeout', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'get-1']);
  t.after(() => client.close());
  await nextTask();

  const waiting = client.get('run-1');
  await waitForHello(transport, 'hello-1');
  const failure = structuredClone(GOLDEN.helloFailure) as Record<string, unknown>;
  failure.requestId = 'hello-1';
  failure.frameEpoch = 'frame-epoch-1';
  failure.error = {
    code: 'auth_required',
    message: 'Sign in to use the managed runtime',
    retryable: false,
  };
  transport.emit(failure);

  await assert.rejects(
    waiting,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'auth_required'
  );
});

test('one bounded hello round fails fast when an older Host does not support the runtime', async (t) => {
  const transport = new FakeTransport();
  const client = new TakuAgentClient(transport, {
    requestIdFactory: idFactory(['hello-1', 'get-1']),
    clientNonceFactory: nonceFactory(),
    helloRetryDelaysMs: [0, 5],
    helloResponseGraceMs: 5,
  });
  t.after(() => client.close());

  await assert.rejects(
    client.get('run-1', { timeoutMs: 1_000 }),
    (error: unknown) => error instanceof TakuAgentError && error.code === 'host_unavailable'
  );
  assert.equal(transport.sent.filter((message) => message.type === 'hello').length, 2);
});

test('start fills the fixed operation revision and preserves caller idempotency', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'start-1']);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const pending = client.start({
    operation: TAKU_AGENT_OPERATION,
    expectedRecoveryScope: RECOVERY_SCOPE,
    input: { topic: 'How teams use local-first AI', language: 'en' },
    idempotencyKey: 'report-example-1',
  });
  const request = await waitForRequest(transport, 'start-1');
  assert.deepEqual(request.params, {
    operation: TAKU_AGENT_OPERATION,
    operationRevision: 1,
    expectedRecoveryScope: RECOVERY_SCOPE,
    input: { topic: 'How teams use local-first AI', language: 'en' },
    idempotencyKey: 'report-example-1',
  });
  transport.emit(successResponse(request, { snapshot: snapshot(), lastSequence: 0 }));
  assert.deepEqual(await pending, { snapshot: snapshot(), lastSequence: 0 });
});

test('default start waits beyond ten seconds and preserves a later Host consent rejection', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'start-1']);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const pending = client.start({
    operation: TAKU_AGENT_OPERATION,
    expectedRecoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Read the consent dialog first' },
    idempotencyKey: 'consent-wait-1',
  });
  const rejected = assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'capability_not_granted'
  );
  await waitForAsyncWork(() => transport.requestSequences.has('start-1'));
  t.mock.timers.tick(15_000);
  const request = await waitForRequest(transport, 'start-1');
  transport.emit(failureResponse(request, 'capability_not_granted'));
  await rejected;
});

test('only start receives the bounded 120-second default; read calls retain ten seconds', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'start-1',
    'capabilities-1',
    'get-1',
    'result-1',
  ]);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);
  t.mock.timers.enable({ apis: ['setTimeout'] });

  let startSettled = false;
  const pending = client.start({
    operation: TAKU_AGENT_OPERATION,
    expectedRecoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Bounded consent wait' },
    idempotencyKey: 'bounded-consent-1',
  });
  const startTimedOut = assert.rejects(pending, (error: unknown) => {
    startSettled = true;
    return error instanceof TakuAgentError && error.code === 'sdk_timeout';
  });
  const readsTimedOut = [client.capabilities(), client.get('run-1'), client.result('run-1')].map(
    (read) =>
      assert.rejects(
        read,
        (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_timeout'
      )
  );
  await waitForAsyncWork(() => transport.requestSequences.has('result-1'));
  t.mock.timers.tick(10_000);
  await Promise.all(readsTimedOut);
  assert.equal(startSettled, false);
  t.mock.timers.tick(109_999);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(startSettled, false);
  t.mock.timers.tick(1);
  await startTimedOut;
  assert.equal(
    transport.sent.some(
      (message) =>
        message.type === TAKU_AGENT_MESSAGE_TYPES.request && message.method === 'agent.cancel'
    ),
    false
  );
});

test('sent start timeout and abort late responses preserve the authenticated session', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'start-timeout-1',
    'start-timeout-retry-1',
    'get-after-timeout',
    'start-abort-1',
    'get-after-abort',
    'unexpected-hello',
  ]);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const timedOut = client.start(
    {
      operation: TAKU_AGENT_OPERATION,
      expectedRecoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Unknown delivery after timeout' },
      idempotencyKey: 'timeout-unknown-delivery-1',
    },
    { timeoutMs: 10 }
  );
  const timedOutRequest = await waitForRequest(transport, 'start-timeout-1');
  await assert.rejects(
    timedOut,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_timeout'
  );
  const retried = client.start({
    operation: TAKU_AGENT_OPERATION,
    expectedRecoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Unknown delivery after timeout' },
    idempotencyKey: 'timeout-unknown-delivery-1',
  });
  const retriedRequest = await waitForRequest(transport, 'start-timeout-retry-1');
  transport.emit(successResponse(timedOutRequest, { snapshot: snapshot(), lastSequence: 0 }));
  transport.emit(successResponse(retriedRequest, { snapshot: snapshot(), lastSequence: 0 }));
  assert.deepEqual(await retried, { snapshot: snapshot(), lastSequence: 0 });
  await nextTask();
  await assertSameSessionGet(transport, client, 'get-after-timeout');

  const abortController = new AbortController();
  const aborted = client.start(
    {
      operation: TAKU_AGENT_OPERATION,
      expectedRecoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Unknown delivery after abort' },
      idempotencyKey: 'abort-unknown-delivery-1',
    },
    { signal: abortController.signal }
  );
  const abortedRequest = await waitForRequest(transport, 'start-abort-1');
  abortController.abort();
  await assert.rejects(
    aborted,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_aborted'
  );
  transport.emit(successResponse(abortedRequest, { snapshot: snapshot(), lastSequence: 0 }));
  await nextTask();
  await assertSameSessionGet(transport, client, 'get-after-abort');
});

test('tombstoned responses remain fail-closed on request, frame, sequence, or result mismatch', async (t) => {
  const cases: Array<{
    name: string;
    emit: (transport: FakeTransport, request: TakuAgentRequestMessage, sequence: string) => void;
  }> = [
    {
      name: 'requestId',
      emit: (transport, request, sequence) =>
        transport.emitWire(
          hostEnvelopeForResponse({ ...request, requestId: 'forged-request-id' }, sequence, {
            snapshot: snapshot(),
            lastSequence: 0,
          })
        ),
    },
    {
      name: 'frameEpoch',
      emit: (transport, request, sequence) =>
        transport.emitWire({
          ...hostEnvelopeForResponse(request, sequence, {
            snapshot: snapshot(),
            lastSequence: 0,
          }),
          body: JSON.stringify({
            ...successResponse(request, { snapshot: snapshot(), lastSequence: 0 }),
            frameEpoch: 'forged-frame-epoch',
          }),
        }),
    },
    {
      name: 'secure sequence',
      emit: (transport, request, sequence) =>
        transport.emitWire(
          hostEnvelopeForResponse(request, String(Number(sequence) + 1), {
            snapshot: snapshot(),
            lastSequence: 0,
          })
        ),
    },
    {
      name: 'result shape',
      emit: (transport, request, sequence) =>
        transport.emitWire(hostEnvelopeForResponse(request, sequence, { invalid: true })),
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const transport = new FakeTransport();
      const client = makeClient(transport, ['hello-1', 'confirm-1', 'start-1']);
      await nextTask();
      await emitTrustedHello(transport);

      const abortController = new AbortController();
      const pending = client.start(
        {
          operation: TAKU_AGENT_OPERATION,
          expectedRecoveryScope: RECOVERY_SCOPE,
          input: { topic: `Reject forged ${testCase.name}` },
          idempotencyKey: `reject-forged-${testCase.name.replaceAll(' ', '-')}`,
        },
        { signal: abortController.signal }
      );
      const request = await waitForRequest(transport, 'start-1');
      const sequence = wireEnvelopeForRequest(transport, 'start-1').sequence;
      abortController.abort();
      await assert.rejects(
        pending,
        (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_aborted'
      );

      testCase.emit(transport, request, sequence);
      await waitFor(() => transport.boundOrigin === null);
      client.close();
    });
  }
});

test('response tombstone capacity overflow invalidates the authenticated session', async () => {
  const transport = new FakeTransport();
  const requestIds = Array.from({ length: 33 }, (_, index) => `get-${index + 1}`);
  const client = makeClient(transport, ['hello-1', 'confirm-1', ...requestIds]);
  await nextTask();
  await emitTrustedHello(transport);

  const controllers = requestIds.map(() => new AbortController());
  const pending = requestIds.map((_, index) =>
    client.get('run-1', { signal: controllers[index]?.signal })
  );
  await waitForRequest(transport, requestIds.at(-1) as string);
  for (const controller of controllers) controller.abort();
  const outcomes = await Promise.allSettled(pending);

  assert.equal(
    outcomes.every(
      (outcome) =>
        outcome.status === 'rejected' &&
        outcome.reason instanceof TakuAgentError &&
        outcome.reason.code === 'sdk_aborted'
    ),
    true
  );
  await waitFor(() => transport.boundOrigin === null);
  client.close();
});

test('start refuses a stale expected recovery scope before sending business input', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'capabilities-1']);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const pending = client.start({
    operation: TAKU_AGENT_OPERATION,
    expectedRecoveryScope: 'stale-account-scope',
    input: { topic: 'Must not cross the account boundary' },
    idempotencyKey: 'stale-scope-1',
  });
  const refresh = await waitForRequest(transport, 'capabilities-1');
  assert.equal(refresh.method, 'runtime.capabilities');
  transport.emit(
    successResponse(refresh, (GOLDEN.helloSuccess as TakuAgentHelloResultMessage).capabilities)
  );
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'account_changed'
  );
  assert.equal(
    transport.sent.some(
      (message) =>
        message.type === TAKU_AGENT_MESSAGE_TYPES.request && message.method === 'agent.start'
    ),
    false
  );
});

test('cancel serializes only the run identity and preserves the cancelling state', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'cancel-1']);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const pending = client.cancel('run-1');
  const request = await waitForRequest(transport, 'cancel-1');
  assert.deepEqual(request.params, { runId: 'run-1' });
  transport.emit(successResponse(request, { snapshot: snapshot('cancelling'), lastSequence: 2 }));
  assert.deepEqual(await pending, {
    snapshot: snapshot('cancelling'),
    lastSequence: 2,
  });
});

test('concurrent RPCs receive strict sequences and a signed response is accepted only once', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'get-1', 'get-2']);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const first = client.get('run-1');
  const second = client.get('run-2');
  const firstRequest = await waitForRequest(transport, 'get-1');
  const secondRequest = await waitForRequest(transport, 'get-2');
  const firstEnvelope = wireEnvelopeForRequest(transport, 'get-1');
  const secondEnvelope = wireEnvelopeForRequest(transport, 'get-2');
  assert.equal(firstEnvelope.sequence, '2');
  assert.equal(secondEnvelope.sequence, '3');

  transport.emitWire(
    hostEnvelopeForResponse(secondRequest, '3', {
      snapshot: { ...snapshot(), runId: 'run-2' },
      lastSequence: 0,
    })
  );
  transport.emitWire(
    hostEnvelopeForResponse(firstRequest, '2', {
      snapshot: snapshot(),
      lastSequence: 0,
    })
  );
  assert.equal((await first).snapshot.runId, 'run-1');
  assert.equal((await second).snapshot.runId, 'run-2');

  transport.emitWire(
    hostEnvelopeForResponse(firstRequest, '2', {
      snapshot: snapshot(),
      lastSequence: 0,
    })
  );
  await waitFor(() => transport.boundOrigin === null);
});

test('current-session direction or MAC tampering fails closed while another session is ignored', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'get-1',
    'get-2',
    'hello-2',
    'confirm-2',
  ]);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const directionPending = client.get('run-1');
  const directionAssertion = assert.rejects(
    directionPending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_host_untrusted'
  );
  const firstRequest = await waitForRequest(transport, 'get-1');
  const firstSequence = wireEnvelopeForRequest(transport, 'get-1').sequence;
  const response = hostEnvelopeForResponse(
    firstRequest,
    firstSequence,
    { snapshot: snapshot(), lastSequence: 0 },
    { direction: 'c2h' }
  );
  transport.emitWire({ ...response, sessionId: 'AAAAAAAAAAAAAAAAAAAAAA' });
  await nextTask();
  assert.equal(transport.boundOrigin, HOST_ORIGIN);
  transport.emitWire(response);
  await directionAssertion;
  assert.equal(transport.boundOrigin, null);

  const macPending = client.get('run-1');
  const macAssertion = assert.rejects(
    macPending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_host_untrusted'
  );
  await waitForHello(transport, 'hello-2');
  const helloResult = structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage;
  helloResult.requestId = 'hello-2';
  helloResult.frameEpoch = 'frame-epoch-2';
  await emitTrustedHello(transport, helloResult);
  const secondRequest = await waitForRequest(transport, 'get-2');
  const secondSequence = wireEnvelopeForRequest(transport, 'get-2').sequence;
  transport.emitWire(
    hostEnvelopeForResponse(
      secondRequest,
      secondSequence,
      { snapshot: snapshot(), lastSequence: 0 },
      { mac: CLIENT_MAC }
    )
  );
  await macAssertion;
  assert.equal(transport.boundOrigin, null);
});

test('an expired absolute session never sends business data and the explicit call starts a new hello', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'get-1', 'hello-2']);
  t.after(() => client.close());
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  await nextTask();
  const helloResult = structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage;
  helloResult.attestation.proofExpiresAt = now + 50;
  helloResult.attestation.sessionExpiresAt = now + 100;
  await emitTrustedHello(transport, helloResult);

  now += 101;
  const pending = client.get('run-1');
  const assertion = assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_closed'
  );
  await waitForHello(transport, 'hello-2');
  assert.equal(
    transport.sent.some(
      (message) =>
        message.type === TAKU_AGENT_MESSAGE_TYPES.request && message.requestId === 'get-1'
    ),
    false
  );
  client.close();
  await assertion;
});

test('a cached empty grant refreshes and can become usable without reloading the app', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'capabilities-1', 'start-1']);
  t.after(() => client.close());
  await nextTask();
  const hello = structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage;
  hello.capabilities.methods = ['runtime.capabilities'];
  hello.capabilities.operations = [];
  await emitTrustedHello(transport, hello);

  const pending = client.start({
    operation: TAKU_AGENT_OPERATION,
    expectedRecoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Grant changed' },
    idempotencyKey: 'grant-refresh-1',
  });
  const refreshRequest = await waitForRequest(transport, 'capabilities-1');
  assert.equal(refreshRequest.method, 'runtime.capabilities');
  const granted = (GOLDEN.helloSuccess as TakuAgentHelloResultMessage).capabilities;
  transport.emit(successResponse(refreshRequest, granted));
  await nextTask();

  const startRequest = await waitForRequest(transport, 'start-1');
  assert.equal(startRequest.method, 'agent.start');
  transport.emit(successResponse(startRequest, { snapshot: snapshot(), lastSequence: 0 }));
  assert.deepEqual(await pending, { snapshot: snapshot(), lastSequence: 0 });
});

test('default start shares its 120-second budget with capability refresh', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'capabilities-1', 'start-1']);
  t.after(() => client.close());
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  await nextTask();
  const hello = structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage;
  hello.capabilities.methods = ['runtime.capabilities'];
  hello.capabilities.operations = [];
  await emitTrustedHello(transport, hello);
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const pending = client.start({
    operation: TAKU_AGENT_OPERATION,
    expectedRecoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Refresh is part of the consent wait budget' },
    idempotencyKey: 'default-total-deadline-1',
  });
  let settled = false;
  const timedOut = assert.rejects(pending, (error: unknown) => {
    settled = true;
    return error instanceof TakuAgentError && error.code === 'sdk_timeout';
  });
  await waitForAsyncWork(() => transport.requestSequences.has('capabilities-1'));
  const refresh = await waitForRequest(transport, 'capabilities-1');
  now += 2_000;
  t.mock.timers.tick(2_000);
  transport.emit(
    successResponse(refresh, (GOLDEN.helloSuccess as TakuAgentHelloResultMessage).capabilities)
  );
  await waitForAsyncWork(() => transport.requestSequences.has('start-1'));
  now += 117_999;
  t.mock.timers.tick(117_999);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  now += 1;
  t.mock.timers.tick(1);
  await timedOut;
});

test('one public call timeout budget covers capability refresh and the final request', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'capabilities-1']);
  t.after(() => client.close());
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  await nextTask();
  const hello = structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage;
  hello.capabilities.methods = ['runtime.capabilities'];
  hello.capabilities.operations = [];
  await emitTrustedHello(transport, hello);

  const pending = client.start(
    {
      operation: TAKU_AGENT_OPERATION,
      expectedRecoveryScope: RECOVERY_SCOPE,
      input: { topic: 'One total deadline' },
      idempotencyKey: 'one-total-deadline-1',
    },
    { timeoutMs: 50 }
  );
  const refreshRequest = await waitForRequest(transport, 'capabilities-1');
  assert.equal(refreshRequest.method, 'runtime.capabilities');

  now += 51;
  transport.emit(
    successResponse(
      refreshRequest,
      (GOLDEN.helloSuccess as TakuAgentHelloResultMessage).capabilities
    )
  );
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_timeout'
  );
  assert.equal(
    transport.sent.some(
      (message) =>
        message.type === TAKU_AGENT_MESSAGE_TYPES.request && message.method === 'agent.start'
    ),
    false
  );
});

test('stale_frame invalidates the handshake and a later request uses a fresh epoch', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'get-1',
    'get-2',
    'hello-2',
    'confirm-2',
  ]);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const stale = client.get('run-1');
  const staleRequest = await waitForRequest(transport, 'get-1');
  transport.emit(failureResponse(staleRequest, 'stale_frame'));
  await assert.rejects(
    stale,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'stale_frame'
  );
  assert.equal(transport.boundOrigin, null);

  const recovered = client.get('run-1');
  await waitForHello(transport, 'hello-2');
  const helloResult = structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage;
  helloResult.requestId = 'hello-2';
  helloResult.frameEpoch = 'frame-epoch-2';
  await emitTrustedHello(transport, helloResult);

  const recoveredRequest = await waitForRequest(transport, 'get-2');
  assert.equal(recoveredRequest.frameEpoch, 'frame-epoch-2');
  transport.emit(successResponse(recoveredRequest, { snapshot: snapshot(), lastSequence: 0 }));
  assert.deepEqual(await recovered, { snapshot: snapshot(), lastSequence: 0 });
});

test('subscribe merges replay and bounded pre-ack live events without losing sequence', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'subscribe-1',
    'gap-unsubscribe-1',
    'get-after-gap-cleanup',
    'unexpected-hello-after-gap-cleanup',
  ]);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const seen: number[] = [];
  const errors: TakuAgentError[] = [];
  const pending = client.subscribe('run-1', (event) => seen.push(event.sequence), {
    onError: (error) => errors.push(error),
  });
  const request = await waitForRequest(transport, 'subscribe-1');
  assert.deepEqual(request.params, { runId: 'run-1', afterSequence: 0 });

  transport.emit({
    __taku: true,
    type: 'event',
    protocol: TAKU_AGENT_PROTOCOL,
    frameEpoch: 'frame-epoch-1',
    subscriptionId: 'subscription-1',
    runId: 'run-1',
    sequence: 2,
    occurredAt: '2026-09-09T00:00:02.000Z',
    event: { type: 'output.delta', delta: 'part one' },
  } satisfies TakuAgentEventMessage);
  transport.emit(
    successResponse(request, {
      subscriptionId: 'subscription-1',
      snapshot: snapshot(),
      lastSequence: 1,
      oldestRetainedSequence: 1,
      replayedEvents: [
        {
          runId: 'run-1',
          sequence: 1,
          occurredAt: '2026-09-09T00:00:01.000Z',
          event: { type: 'run.state', status: 'running' },
        },
      ],
    })
  );
  transport.emit({
    __taku: true,
    type: 'event',
    protocol: TAKU_AGENT_PROTOCOL,
    frameEpoch: 'frame-epoch-1',
    subscriptionId: 'subscription-1',
    runId: 'run-1',
    sequence: 3,
    occurredAt: '2026-09-09T00:00:03.000Z',
    event: { type: 'output.delta', delta: 'after ack, before promise continuation' },
  } satisfies TakuAgentEventMessage);

  const subscription = await pending;
  await waitFor(() => seen.includes(3));
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(subscription.getLastSequence(), 3);

  transport.emit({
    __taku: true,
    type: 'event',
    protocol: TAKU_AGENT_PROTOCOL,
    frameEpoch: 'frame-epoch-1',
    subscriptionId: 'subscription-1',
    runId: 'run-1',
    sequence: 4,
    occurredAt: '2026-09-09T00:00:04.000Z',
    event: { type: 'future.event', ignoredField: 'safe to ignore' },
  });
  await waitFor(() => subscription.getLastSequence() === 4);
  assert.equal(subscription.getLastSequence(), 4);
  assert.deepEqual(seen, [1, 2, 3]);

  transport.emit({
    __taku: true,
    type: 'event',
    protocol: TAKU_AGENT_PROTOCOL,
    frameEpoch: 'frame-epoch-1',
    subscriptionId: 'subscription-1',
    runId: 'run-1',
    sequence: 6,
    occurredAt: '2026-09-09T00:00:06.000Z',
    event: { type: 'run.state', status: 'running' },
  });
  await waitFor(() => errors.length === 1);
  assert.equal(errors[0]?.code, 'sdk_event_gap');
  const cleanup = await waitForRequest(transport, 'gap-unsubscribe-1');
  assert.equal(cleanup.method, 'agent.unsubscribe');
  await assertCleanupResponsePreservesSession(transport, client, cleanup, 'get-after-gap-cleanup');
});

test('subscribe sorts and deduplicates replay while advancing across unknown events once', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'subscribe-1',
    'close-unsubscribe-1',
  ]);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const seen: number[] = [];
  const pending = client.subscribe('run-1', (event) => seen.push(event.sequence), {
    afterSequence: 1,
  });
  const request = await waitForRequest(transport, 'subscribe-1');
  transport.emit(
    successResponse(request, {
      subscriptionId: 'subscription-1',
      snapshot: snapshot(),
      lastSequence: 3,
      oldestRetainedSequence: 1,
      replayedEvents: [
        {
          runId: 'run-1',
          sequence: 3,
          occurredAt: '2026-09-09T00:00:03.000Z',
          event: { type: 'future.event' },
        },
        {
          runId: 'run-1',
          sequence: 1,
          occurredAt: '2026-09-09T00:00:01.000Z',
          event: { type: 'run.state', status: 'running' },
        },
        {
          runId: 'run-1',
          sequence: 2,
          occurredAt: '2026-09-09T00:00:02.000Z',
          event: { type: 'output.delta', delta: 'canonical' },
        },
        {
          runId: 'run-1',
          sequence: 2,
          occurredAt: '2026-09-09T00:00:02.000Z',
          event: { type: 'output.delta', delta: 'duplicate' },
        },
      ],
    })
  );

  const subscription = await pending;
  assert.deepEqual(seen, [2]);
  assert.equal(subscription.getLastSequence(), 3);

  transport.emit({
    __taku: true,
    type: 'event',
    protocol: TAKU_AGENT_PROTOCOL,
    frameEpoch: 'frame-epoch-1',
    subscriptionId: 'subscription-1',
    runId: 'run-1',
    sequence: 4,
    occurredAt: '2026-09-09T00:00:04.000Z',
    event: { type: 'run.state', status: 'running' },
  });
  await waitFor(() => seen.includes(4));
  assert.deepEqual(seen, [2, 4]);
  assert.equal(subscription.getLastSequence(), 4);
});

test('subscribe rejects replay beyond the v2 retention ceiling and precisely unsubscribes', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'subscribe-1',
    'oversized-replay-unsubscribe-1',
    'get-after-oversized-cleanup',
    'unexpected-hello-after-oversized-cleanup',
  ]);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const seen: number[] = [];
  const pending = client.subscribe('run-1', (event) => seen.push(event.sequence));
  const request = await waitForRequest(transport, 'subscribe-1');
  transport.emit(
    successResponse(request, {
      subscriptionId: 'subscription-oversized-replay',
      snapshot: snapshot(),
      lastSequence: 257,
      oldestRetainedSequence: 1,
      replayedEvents: Array.from({ length: 257 }, (_, index) => ({
        runId: 'run-1',
        sequence: index + 1,
        occurredAt: '2026-09-09T00:00:01.000Z',
        event: { type: 'run.state', status: 'running' },
      })),
    })
  );

  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_limit_exceeded'
  );
  assert.deepEqual(seen, []);
  const cleanup = await waitForRequest(transport, 'oversized-replay-unsubscribe-1');
  assert.equal(cleanup.method, 'agent.unsubscribe');
  assert.deepEqual(cleanup.params, {
    subscriptionId: 'subscription-oversized-replay',
    runId: 'run-1',
  });
  await assertCleanupResponsePreservesSession(
    transport,
    client,
    cleanup,
    'get-after-oversized-cleanup'
  );
});

test('subscribe measures replay event payloads as UTF-8 JSON bytes and fails closed', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'subscribe-1',
    'oversized-event-unsubscribe-1',
  ]);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const pending = client.subscribe('run-1', () => {});
  const request = await waitForRequest(transport, 'subscribe-1');
  transport.emit(
    successResponse(request, {
      subscriptionId: 'subscription-oversized-event',
      snapshot: snapshot(),
      lastSequence: 1,
      oldestRetainedSequence: 1,
      replayedEvents: [
        {
          runId: 'run-1',
          sequence: 1,
          occurredAt: '2026-09-09T00:00:01.000Z',
          // 11,000 CJK characters are 33,000 UTF-8 bytes before JSON overhead.
          event: { type: 'output.delta', delta: '界'.repeat(11_000) },
        },
      ],
    })
  );

  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof TakuAgentError &&
      error.code === 'sdk_limit_exceeded' &&
      error.message.includes('UTF-8 JSON bytes')
  );
  const cleanup = await waitForRequest(transport, 'oversized-event-unsubscribe-1');
  assert.equal(cleanup.method, 'agent.unsubscribe');
  assert.deepEqual(cleanup.params, {
    subscriptionId: 'subscription-oversized-event',
    runId: 'run-1',
  });
});

test('an oversized live event terminates the local subscription before delivery', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'subscribe-1',
    'oversized-live-unsubscribe-1',
  ]);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const seen: number[] = [];
  const errors: TakuAgentError[] = [];
  const pending = client.subscribe('run-1', (event) => seen.push(event.sequence), {
    onError: (error) => errors.push(error),
  });
  const subscribeRequest = await waitForRequest(transport, 'subscribe-1');
  transport.emit(successResponse(subscribeRequest, emptySubscriptionResult()));
  const subscription = await pending;

  transport.emit({
    __taku: true,
    type: 'event',
    protocol: TAKU_AGENT_PROTOCOL,
    frameEpoch: 'frame-epoch-1',
    subscriptionId: 'subscription-1',
    runId: 'run-1',
    sequence: 1,
    occurredAt: '2026-09-09T00:00:01.000Z',
    event: { type: 'output.delta', delta: '界'.repeat(11_000) },
  });

  await waitFor(() => errors.length === 1);
  assert.deepEqual(seen, []);
  assert.equal(subscription.getLastSequence(), 0);
  assert.equal(errors[0]?.code, 'sdk_limit_exceeded');
  const cleanup = await waitForRequest(transport, 'oversized-live-unsubscribe-1');
  assert.equal(cleanup.method, 'agent.unsubscribe');
  assert.deepEqual(cleanup.params, { subscriptionId: 'subscription-1', runId: 'run-1' });
});

test('unsubscribe mutes locally immediately and remains retryable after an aborted attempt', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'subscribe-1', 'unsubscribe-1']);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const seen: number[] = [];
  const pending = client.subscribe('run-1', (event) => seen.push(event.sequence));
  const subscribeRequest = await waitForRequest(transport, 'subscribe-1');
  transport.emit(successResponse(subscribeRequest, emptySubscriptionResult()));
  const subscription = await pending;

  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    subscription.unsubscribe({ signal: aborted.signal }),
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_aborted'
  );
  await assert.rejects(
    client.subscribe('run-1', () => {}),
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_already_subscribed'
  );
  transport.emit({
    __taku: true,
    type: 'event',
    protocol: TAKU_AGENT_PROTOCOL,
    frameEpoch: 'frame-epoch-1',
    subscriptionId: 'subscription-1',
    runId: 'run-1',
    sequence: 1,
    occurredAt: '2026-09-09T00:00:01.000Z',
    event: { type: 'run.state', status: 'running' },
  });
  assert.deepEqual(seen, []);

  const retried = subscription.unsubscribe();
  const unsubscribeRequest = await waitForRequest(transport, 'unsubscribe-1');
  assert.equal(unsubscribeRequest.requestId, 'unsubscribe-1');
  assert.equal(unsubscribeRequest.method, 'agent.unsubscribe');
  transport.emit(successResponse(unsubscribeRequest, { unsubscribed: true }));
  await retried;
});

test('unsubscribe transport failure invalidates the session and a later explicit retry re-handshakes', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'subscribe-1',
    'transport-unsubscribe-1',
    'unsubscribe-1',
    'hello-2',
    'confirm-2',
  ]);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const pending = client.subscribe('run-1', () => {});
  const subscribeRequest = await waitForRequest(transport, 'subscribe-1');
  transport.emit(successResponse(subscribeRequest, emptySubscriptionResult()));
  const subscription = await pending;

  transport.nextPostError = new Error('transport unavailable');
  await assert.rejects(
    subscription.unsubscribe(),
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_transport_failed'
  );
  assert.equal(transport.boundOrigin, null);

  const retried = subscription.unsubscribe();
  await waitForHello(transport, 'hello-2');
  const helloResult = structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage;
  helloResult.requestId = 'hello-2';
  helloResult.frameEpoch = 'frame-epoch-2';
  await emitTrustedHello(transport, helloResult);
  const unsubscribeRequest = await waitForRequest(transport, 'unsubscribe-1');
  assert.equal(unsubscribeRequest.requestId, 'unsubscribe-1');
  transport.emit(successResponse(unsubscribeRequest, { unsubscribed: true }));
  await retried;
});

test('close still best-effort unsubscribes a locally muted subscription after abort', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'subscribe-1',
    'close-unsubscribe-1',
  ]);
  await nextTask();
  await emitTrustedHello(transport);

  const pending = client.subscribe('run-1', () => {});
  const subscribeRequest = await waitForRequest(transport, 'subscribe-1');
  transport.emit(successResponse(subscribeRequest, emptySubscriptionResult()));
  const subscription = await pending;
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(subscription.unsubscribe({ signal: aborted.signal }));

  client.close();
  const cleanup = await waitForRequest(transport, 'close-unsubscribe-1');
  assert.equal(cleanup.requestId, 'close-unsubscribe-1');
  assert.equal(cleanup.method, 'agent.unsubscribe');
  assert.deepEqual(cleanup.params, { subscriptionId: 'subscription-1', runId: 'run-1' });
});

test('a best-effort unsubscribe post failure consumes the attempt and tears down the session', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'subscribe-1',
    'close-unsubscribe-1',
  ]);
  await nextTask();
  await emitTrustedHello(transport);
  const pending = client.subscribe('run-1', () => {});
  const subscribeRequest = await waitForRequest(transport, 'subscribe-1');
  transport.emit(successResponse(subscribeRequest, emptySubscriptionResult()));
  await pending;

  transport.nextPostError = new Error('cleanup transport unavailable');
  client.close();
  await waitFor(() => transport.nextPostError === null && transport.boundOrigin === null);
  assert.equal(
    transport.sent.some(
      (message) =>
        message.type === TAKU_AGENT_MESSAGE_TYPES.request &&
        message.requestId === 'close-unsubscribe-1'
    ),
    false
  );
});

test('an aborted subscribe late success is precisely unsubscribed from its tombstone', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'subscribe-1',
    'late-unsubscribe-1',
    'get-after-late-cleanup',
    'unexpected-hello-after-late-cleanup',
  ]);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const abortController = new AbortController();
  const pending = client.subscribe('run-1', () => {}, { signal: abortController.signal });
  const subscribeRequest = await waitForRequest(transport, 'subscribe-1');
  abortController.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_aborted'
  );

  transport.emit(successResponse(subscribeRequest, emptySubscriptionResult('subscription-late')));
  const cleanup = await waitForRequest(transport, 'late-unsubscribe-1');
  assert.equal(cleanup.requestId, 'late-unsubscribe-1');
  assert.equal(cleanup.method, 'agent.unsubscribe');
  assert.deepEqual(cleanup.params, { subscriptionId: 'subscription-late', runId: 'run-1' });
  await assertCleanupResponsePreservesSession(transport, client, cleanup, 'get-after-late-cleanup');
});

test('an aborted subscribe late response for another run remains fail-closed', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'subscribe-1']);
  await nextTask();
  await emitTrustedHello(transport);

  const abortController = new AbortController();
  const pending = client.subscribe('run-1', () => {}, { signal: abortController.signal });
  const subscribeRequest = await waitForRequest(transport, 'subscribe-1');
  abortController.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_aborted'
  );

  transport.emit(
    successResponse(subscribeRequest, {
      ...emptySubscriptionResult('subscription-wrong-run'),
      snapshot: { ...snapshot(), runId: 'run-2' },
    })
  );
  await waitFor(() => transport.boundOrigin === null);
  client.close();
});

test('a malformed best-effort cleanup response invalidates the authenticated session', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'subscribe-1',
    'gap-unsubscribe-1',
  ]);
  await nextTask();
  await emitTrustedHello(transport);

  const errors: TakuAgentError[] = [];
  const pending = client.subscribe('run-1', () => {}, {
    onError: (error) => errors.push(error),
  });
  const subscribeRequest = await waitForRequest(transport, 'subscribe-1');
  transport.emit(successResponse(subscribeRequest, emptySubscriptionResult()));
  await pending;
  transport.emit({
    __taku: true,
    type: 'event',
    protocol: TAKU_AGENT_PROTOCOL,
    frameEpoch: 'frame-epoch-1',
    subscriptionId: 'subscription-1',
    runId: 'run-1',
    sequence: 2,
    occurredAt: '2026-09-09T00:00:02.000Z',
    event: { type: 'run.state', status: 'running' },
  });
  await waitFor(() => errors.length === 1);
  const cleanup = await waitForRequest(transport, 'gap-unsubscribe-1');
  transport.emit(successResponse(cleanup, { unsubscribed: false }));

  await waitFor(() => transport.boundOrigin === null);
  client.close();
});

test('close after subscribe response resolution cannot revive or replay the subscription', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'subscribe-1',
    'close-unsubscribe-1',
  ]);
  await nextTask();
  await emitTrustedHello(transport);

  const seen: number[] = [];
  const pending = client.subscribe('run-1', (event) => seen.push(event.sequence));
  const request = await waitForRequest(transport, 'subscribe-1');
  transport.emit(
    successResponse(request, {
      subscriptionId: 'subscription-1',
      snapshot: snapshot(),
      lastSequence: 1,
      oldestRetainedSequence: 1,
      replayedEvents: [
        {
          runId: 'run-1',
          sequence: 1,
          occurredAt: '2026-09-09T00:00:01.000Z',
          event: { type: 'run.state', status: 'running' },
        },
      ],
    })
  );
  client.close();

  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_closed'
  );
  assert.deepEqual(seen, []);
  const cleanup = await waitForRequest(transport, 'close-unsubscribe-1');
  assert.equal(cleanup.requestId, 'close-unsubscribe-1');
  assert.equal(cleanup.method, 'agent.unsubscribe');
  await waitFor(() => transport.boundOrigin === null);
  assert.equal(transport.boundOrigin, null);
});

test('close keeps a bounded cleanup listener for an in-flight subscribe late success', async () => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'subscribe-1',
    'late-unsubscribe-1',
  ]);
  await nextTask();
  await emitTrustedHello(transport);

  const pending = client.subscribe('run-1', () => {});
  const request = await waitForRequest(transport, 'subscribe-1');
  client.close();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_closed'
  );
  assert.equal(transport.boundOrigin, HOST_ORIGIN);

  transport.emit(successResponse(request, emptySubscriptionResult('subscription-late')));
  const cleanup = await waitForRequest(transport, 'late-unsubscribe-1');
  assert.equal(cleanup.requestId, 'late-unsubscribe-1');
  assert.equal(cleanup.method, 'agent.unsubscribe');
  assert.equal(transport.boundOrigin, null);
});

test('wrong origin, stale epoch, timeout, abort, and close all fail closed', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'get-1',
    'get-2',
    'hello-2',
    'get-3',
  ]);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const waiting = client.get('run-1', { timeoutMs: 30 });
  const request = await waitForRequest(transport, 'get-1');
  transport.emit(
    successResponse(request, { snapshot: snapshot(), lastSequence: 0 }),
    'https://wrong'
  );
  transport.emit({
    ...successResponse(request, { snapshot: snapshot(), lastSequence: 0 }),
    frameEpoch: 'stale-frame',
  });
  await assert.rejects(
    waiting,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_host_untrusted'
  );

  const abortController = new AbortController();
  const aborted = client.get('run-1', { signal: abortController.signal });
  abortController.abort();
  await assert.rejects(
    aborted,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_aborted'
  );

  const closed = client.get('run-1');
  client.close();
  await assert.rejects(
    closed,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_closed'
  );
});

test('result parsers ignore additive response fields but keep fixed report output', () => {
  const parsed = parseTakuAgentRunCursor({
    snapshot: { ...snapshot('succeeded'), futureMetadata: true },
    lastSequence: 4,
    futureCursor: 'ignored',
  });
  assert.deepEqual(parsed, { snapshot: snapshot('succeeded'), lastSequence: 4 });
});

test('unknown client features stay optional while accepted features are exposed explicitly', () => {
  const advertised = contentRefCapabilities();
  const withFutureFeature = {
    ...advertised,
    features: ['content-ref-v1', 'future-output-stream-v2'],
  };
  const parsed = parseTakuAgentCapabilities(withFutureFeature);
  if (!parsed) assert.fail('unknown optional feature must not fail the hello contract');
  assert.deepEqual(parsed.features, ['content-ref-v1']);
  assert.equal(parsed.methods.includes('content.read'), true);
  assert.notEqual(
    serializeTakuAgentCapabilitiesForDigest(parsed),
    serializeTakuAgentCapabilities(parsed)
  );
});

test('negotiated features remain visible when an empty grant omits feature-specific methods', () => {
  const base = parseTakuAgentCapabilities(GOLDEN.capabilities);
  if (!base) assert.fail('golden capabilities must parse');
  const parsed = parseTakuAgentCapabilities({
    ...base,
    methods: ['runtime.capabilities'],
    operations: [],
    features: ['content-ref-v1', 'operation-catalog-v1', 'asset-open-v1'],
    catalog: {
      catalogVersion: 'taku.agent.operation-catalog/v1',
      operations: [],
    },
  });
  assert.deepEqual(parsed?.methods, ['runtime.capabilities']);
  assert.deepEqual(parsed?.operations, []);
  assert.deepEqual(parsed?.features, ['content-ref-v1', 'operation-catalog-v1', 'asset-open-v1']);
  assert.equal(
    parseTakuAgentCapabilities({
      ...base,
      methods: [...base.methods, 'content.read'],
    }),
    null
  );
  assert.equal(
    parseTakuAgentCapabilities({
      ...base,
      methods: [...base.methods, 'asset.open'],
    }),
    null
  );
});

test('Desktop operation catalog fields, media defaults and fixed behavior parse without ABI drift', () => {
  const parsed = parseTakuAgentCapabilities(desktopCatalogCapabilities());
  if (!parsed?.catalog) assert.fail('Desktop-shaped operation catalog must parse');
  assert.deepEqual(parsed.features, [...TAKU_AGENT_CLIENT_FEATURES]);
  assert.deepEqual(parsed.methods, [...TAKU_AGENT_METHODS]);
  assert.deepEqual(
    parsed.operations.map(({ id, revision }) => [id, revision]),
    [
      [TAKU_AGENT_EXECUTE_OPERATION, 1],
      [TAKU_AGENT_IMAGE_OPERATION, 1],
      [TAKU_AGENT_VIDEO_OPERATION, 1],
      [TAKU_AGENT_OPERATION, 1],
    ]
  );

  const image = parsed.catalog.operations.find(
    (operation) => operation.id === TAKU_AGENT_IMAGE_OPERATION
  );
  const video = parsed.catalog.operations.find(
    (operation) => operation.id === TAKU_AGENT_VIDEO_OPERATION
  );
  assert.deepEqual(Object.keys(image?.inputSchema.properties ?? {}).sort(), [
    'aspectRatio',
    'prompt',
  ]);
  assert.deepEqual(image?.inputSchema.properties?.aspectRatio?.enum, [
    '16:9',
    '9:16',
    '4:3',
    '3:4',
    '1:1',
  ]);
  assert.equal(image?.inputSchema.properties?.aspectRatio?.default, '1:1');
  assert.deepEqual(image?.fixedBehavior, [
    'Routing and fallback are managed by Taku AI Proxy.',
    'One generated asset is requested per operation; start another operation for another variant.',
  ]);
  assert.equal(image ? 'profiles' in image : true, false);
  assert.deepEqual(Object.keys(video?.inputSchema.properties ?? {}).sort(), [
    'aspectRatio',
    'durationSeconds',
    'prompt',
  ]);
  assert.deepEqual(video?.inputSchema.properties?.aspectRatio?.enum, ['16:9', '9:16']);
  assert.equal(video?.inputSchema.properties?.aspectRatio?.default, '16:9');
  assert.deepEqual(video?.inputSchema.properties?.durationSeconds?.enum, [4, 6, 8]);
  assert.equal(video?.inputSchema.properties?.durationSeconds?.default, 4);
  assert.deepEqual(video?.fixedBehavior, ['Routing and fallback are managed by Taku AI Proxy.']);
  assert.equal(video ? 'profiles' in video : true, false);
});

test('operation catalog canonical tuple stays Desktop-compatible without a profiles slot', () => {
  const parsed = parseTakuAgentCapabilities(desktopCatalogCapabilities());
  if (!parsed) assert.fail('Desktop-shaped capabilities must parse');
  const transcript = JSON.parse(serializeTakuAgentCapabilities(parsed)) as unknown[];
  assert.equal(transcript[0], 'taku.agent.capabilities/v3');
  const catalog = transcript[5];
  if (!Array.isArray(catalog)) assert.fail('canonical catalog tuple must be present');
  assert.equal(catalog[0], TAKU_AGENT_OPERATION_CATALOG_VERSION);
  const operations = catalog[1];
  if (!Array.isArray(operations)) assert.fail('canonical operation tuples must be present');
  assert.deepEqual(
    operations.map((operation) => (Array.isArray(operation) ? operation[0] : null)),
    [
      TAKU_AGENT_EXECUTE_OPERATION,
      TAKU_AGENT_IMAGE_OPERATION,
      TAKU_AGENT_VIDEO_OPERATION,
      TAKU_AGENT_OPERATION,
    ]
  );
  for (const operation of operations) {
    assert.equal(Array.isArray(operation), true);
    assert.equal((operation as unknown[]).length, 7);
  }
});

test('current media catalog rejects profile lists and provider-specific input controls', () => {
  const withProfiles = desktopCatalogCapabilities();
  const profileCatalog = withProfiles.catalog;
  if (!isRecord(profileCatalog) || !Array.isArray(profileCatalog.operations)) {
    assert.fail('test catalog must be present');
  }
  const imageWithProfiles = profileCatalog.operations.find(
    (operation) => isRecord(operation) && operation.id === TAKU_AGENT_IMAGE_OPERATION
  );
  if (!isRecord(imageWithProfiles)) assert.fail('image catalog entry must be present');
  imageWithProfiles.profiles = [];
  assert.equal(parseTakuAgentCapabilities(withProfiles), null);

  for (const forbiddenField of ['provider', 'model', 'quality', 'profile', 'count']) {
    const candidate = desktopCatalogCapabilities();
    const catalog = candidate.catalog;
    if (!isRecord(catalog) || !Array.isArray(catalog.operations)) {
      assert.fail('test catalog must be present');
    }
    const image = catalog.operations.find(
      (operation) => isRecord(operation) && operation.id === TAKU_AGENT_IMAGE_OPERATION
    );
    if (!isRecord(image) || !isRecord(image.inputSchema)) {
      assert.fail('image catalog schema must be present');
    }
    const properties = image.inputSchema.properties;
    if (!isRecord(properties)) assert.fail('image catalog properties must be present');
    properties[forbiddenField] = { type: 'string' };
    assert.equal(parseTakuAgentCapabilities(candidate), null, forbiddenField);
  }
});

test('report contentRef and content pages are strict, bounded, and mutually exclusive with inline text', () => {
  const bytes = Buffer.from('paged report', 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const contentRef: TakuAgentContentRef = {
    contentId: 'content-report-1',
    field: 'markdown',
    mediaType: 'text/markdown',
    encoding: 'utf8',
    byteLength: bytes.byteLength,
    sha256,
    expiresAt: new Date(GOLDEN_TEST_NOW + 60_000).toISOString(),
  };
  assert.deepEqual(parseTakuAgentContentRef(contentRef), contentRef);
  assert.deepEqual(
    parseTakuAgentRunCursor({
      snapshot: {
        ...snapshot('succeeded'),
        result: { kind: 'report', title: 'Paged', contentRef },
      },
      lastSequence: 2,
    })?.snapshot.result,
    { kind: 'report', title: 'Paged', contentRef }
  );
  assert.equal(
    parseTakuAgentRunCursor({
      snapshot: {
        ...snapshot('succeeded'),
        result: { kind: 'report', title: 'Ambiguous', markdown: '# inline', contentRef },
      },
      lastSequence: 2,
    }),
    null
  );
  assert.equal(
    parseTakuAgentContentRef({ ...contentRef, mediaType: 'application/octet-stream' }),
    null
  );
  const firstPage = bytes.subarray(0, 4);
  assert.deepEqual(
    parseTakuAgentContentReadResult({
      contentId: contentRef.contentId,
      offset: 0,
      nextOffset: firstPage.byteLength,
      eof: false,
      encoding: 'base64url',
      chunk: firstPage.toString('base64url'),
      byteLength: firstPage.byteLength,
      sha256,
    }),
    {
      contentId: contentRef.contentId,
      offset: 0,
      nextOffset: firstPage.byteLength,
      eof: false,
      encoding: 'base64url',
      chunk: firstPage.toString('base64url'),
      byteLength: firstPage.byteLength,
      sha256,
    }
  );
});

test('content.read streams split UTF-8 pages after explicit feature negotiation', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'content-1', 'content-2']);
  t.after(() => client.close());
  await nextTask();
  const hello = {
    ...(structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage),
    capabilities: contentRefCapabilities(),
  };
  await emitTrustedHello(transport, hello);

  const bytes = Buffer.from('A€', 'utf8');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const contentRef: TakuAgentContentRef = {
    contentId: 'content-utf8-1',
    field: 'markdown',
    mediaType: 'text/markdown',
    encoding: 'utf8',
    byteLength: bytes.byteLength,
    sha256,
    expiresAt: new Date(GOLDEN_TEST_NOW + 60_000).toISOString(),
  };
  const received: string[] = [];
  const reading = (async () => {
    for await (const chunk of client.readContentText('run-1', contentRef, { pageSize: 2 })) {
      received.push(chunk);
    }
  })();

  const first = await waitForRequest(transport, 'content-1');
  assert.equal(first.method, 'content.read');
  assert.deepEqual(first.params, {
    runId: 'run-1',
    contentId: contentRef.contentId,
    offset: 0,
    length: 2,
  });
  transport.emit(
    successResponse(first, {
      contentId: contentRef.contentId,
      offset: 0,
      nextOffset: 2,
      eof: false,
      encoding: 'base64url',
      chunk: bytes.subarray(0, 2).toString('base64url'),
      byteLength: 2,
      sha256,
    })
  );
  const second = await waitForRequest(transport, 'content-2');
  transport.emit(
    successResponse(second, {
      contentId: contentRef.contentId,
      offset: 2,
      nextOffset: bytes.byteLength,
      eof: true,
      encoding: 'base64url',
      chunk: bytes.subarray(2).toString('base64url'),
      byteLength: bytes.byteLength - 2,
      sha256,
    })
  );
  await reading;
  assert.equal(received.join(''), 'A€');
});

test('content.read fails at the call site when an older Host did not accept the feature', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'capabilities-refresh-1']);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const contentRef: TakuAgentContentRef = {
    contentId: 'content-old-host',
    field: 'content',
    mediaType: 'text/plain',
    encoding: 'utf8',
    byteLength: 4,
    sha256: createHash('sha256').update('test').digest('hex'),
    expiresAt: new Date(GOLDEN_TEST_NOW + 60_000).toISOString(),
  };
  const reading = client.readContent('run-1', contentRef).next();
  const refresh = await waitForRequest(transport, 'capabilities-refresh-1');
  assert.equal(refresh.method, 'runtime.capabilities');
  transport.emit(
    successResponse(refresh, (GOLDEN.helloSuccess as TakuAgentHelloResultMessage).capabilities)
  );
  await assert.rejects(
    reading,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_unsupported'
  );
  assert.equal(
    transport.sent.some(
      (message) =>
        message.type === TAKU_AGENT_MESSAGE_TYPES.request && message.method === 'content.read'
    ),
    false
  );
});

test('media inputs and outputs expose product semantics without provider or URL fields', () => {
  assert.deepEqual(
    validateTakuAgentStartInput({
      operation: TAKU_AGENT_IMAGE_OPERATION,
      operationRevision: 1,
      expectedRecoveryScope: RECOVERY_SCOPE,
      idempotencyKey: 'image-defaults-1',
      input: { prompt: 'A square icon using the product default' },
    }),
    {
      operation: TAKU_AGENT_IMAGE_OPERATION,
      operationRevision: 1,
      expectedRecoveryScope: RECOVERY_SCOPE,
      idempotencyKey: 'image-defaults-1',
      input: { prompt: 'A square icon using the product default' },
    }
  );
  assert.deepEqual(
    validateTakuAgentStartInput({
      operation: TAKU_AGENT_VIDEO_OPERATION,
      operationRevision: 1,
      expectedRecoveryScope: RECOVERY_SCOPE,
      idempotencyKey: 'video-defaults-1',
      input: { prompt: 'A product-default launch clip' },
    }),
    {
      operation: TAKU_AGENT_VIDEO_OPERATION,
      operationRevision: 1,
      expectedRecoveryScope: RECOVERY_SCOPE,
      idempotencyKey: 'video-defaults-1',
      input: { prompt: 'A product-default launch clip' },
    }
  );
  assert.deepEqual(
    validateTakuAgentStartInput({
      operation: TAKU_AGENT_IMAGE_OPERATION,
      operationRevision: 1,
      expectedRecoveryScope: RECOVERY_SCOPE,
      idempotencyKey: 'image-start-1',
      input: {
        prompt: 'A tactile paper city',
        aspectRatio: '1:1',
      },
    }),
    {
      operation: TAKU_AGENT_IMAGE_OPERATION,
      operationRevision: 1,
      expectedRecoveryScope: RECOVERY_SCOPE,
      idempotencyKey: 'image-start-1',
      input: {
        prompt: 'A tactile paper city',
        aspectRatio: '1:1',
      },
    }
  );
  assert.throws(
    () =>
      validateTakuAgentStartInput({
        operation: TAKU_AGENT_VIDEO_OPERATION,
        operationRevision: 1,
        expectedRecoveryScope: RECOVERY_SCOPE,
        idempotencyKey: 'video-provider-leak',
        input: { prompt: 'Animate this', provider: 'private-provider' },
      } as never),
    /Invalid media\.video\.generate input/
  );
  for (const [operation, input] of [
    [TAKU_AGENT_IMAGE_OPERATION, { prompt: 'Icons', aspectRatio: 'auto' }],
    [TAKU_AGENT_IMAGE_OPERATION, { prompt: 'Icons', quality: 'high' }],
    [TAKU_AGENT_IMAGE_OPERATION, { prompt: 'Icons', profile: { profileId: 'quality' } }],
    [TAKU_AGENT_IMAGE_OPERATION, { prompt: 'Icons', count: 2 }],
    [TAKU_AGENT_VIDEO_OPERATION, { prompt: 'Waves', aspectRatio: 'auto' }],
    [TAKU_AGENT_VIDEO_OPERATION, { prompt: 'Waves', quality: 'high' }],
    [TAKU_AGENT_VIDEO_OPERATION, { prompt: 'Waves', profile: { profileId: 'quality' } }],
  ] as const) {
    assert.throws(
      () =>
        validateTakuAgentStartInput({
          operation,
          operationRevision: 1,
          expectedRecoveryScope: RECOVERY_SCOPE,
          idempotencyKey: `removed-${operation}`,
          input,
        } as never),
      new RegExp(`Invalid ${operation.replaceAll('.', '\\.')}`)
    );
  }

  const parsed = parseTakuAgentRunCursor({
    snapshot: {
      runId: 'run-image',
      operation: TAKU_AGENT_IMAGE_OPERATION,
      operationRevision: 1,
      state: 'succeeded',
      createdAt: '2026-09-09T00:00:00.000Z',
      updatedAt: '2026-09-09T00:00:01.000Z',
      result: {
        kind: 'images',
        assets: [
          {
            assetRef: 'asset_generated_1',
            kind: 'image',
            contentType: 'image/png',
            width: 1024,
            height: 1024,
          },
        ],
      },
    },
    lastSequence: 3,
  });
  assert.equal(parsed?.snapshot.result?.kind, 'images');
  assert.equal(
    parseTakuAgentRunCursor({
      snapshot: {
        runId: 'run-image',
        operation: TAKU_AGENT_IMAGE_OPERATION,
        operationRevision: 1,
        state: 'succeeded',
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:01.000Z',
        result: {
          kind: 'images',
          assets: [
            {
              assetRef: 'asset_generated_1',
              kind: 'image',
              url: 'https://provider.example/private.png',
            },
          ],
        },
      },
      lastSequence: 3,
    }),
    null
  );
});

test('media output fails closed when asset-open-v1 was not negotiated', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'get-1']);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport);

  const pending = client.get('run-image');
  const request = await waitForRequest(transport, 'get-1');
  transport.emit(
    successResponse(request, {
      snapshot: {
        runId: 'run-image',
        operation: TAKU_AGENT_IMAGE_OPERATION,
        operationRevision: 1,
        state: 'succeeded',
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:01.000Z',
        result: {
          kind: 'images',
          assets: [{ assetRef: 'asset_generated_1', kind: 'image' }],
        },
      },
      lastSequence: 3,
    })
  );

  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_unsupported'
  );
});

test('asset.open mints a fresh short-lived range-capable playback URL', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'asset-open-1']);
  t.after(() => client.close());
  await nextTask();
  const hello = {
    ...(structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage),
    capabilities: assetOpenCapabilities(),
  };
  await emitTrustedHello(transport, hello);

  const pending = client.openAsset('asset_generated_1');
  const request = await waitForRequest(transport, 'asset-open-1');
  assert.equal(request.method, 'asset.open');
  assert.deepEqual(request.params, { assetRef: 'asset_generated_1' });
  const playbackUrl = `taku://file/subapp-asset/${Buffer.alloc(32, 7).toString('base64url')}`;
  const opened = {
    playbackUrl,
    expiresAt: new Date(GOLDEN_TEST_NOW + 60_000).toISOString(),
    methods: ['GET', 'HEAD'],
    acceptRanges: 'bytes',
  } as const;
  transport.emit(successResponse(request, opened));
  assert.deepEqual(await pending, opened);
});

test('asset.open rejects provider URLs and already-expired playback grants', async (t) => {
  assert.equal(
    parseTakuAgentAssetOpenResult({
      playbackUrl: 'https://provider.example/private.png',
      expiresAt: new Date(GOLDEN_TEST_NOW + 60_000).toISOString(),
      methods: ['GET', 'HEAD'],
      acceptRanges: 'bytes',
    }),
    null
  );
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'asset-open-1']);
  t.after(() => client.close());
  await nextTask();
  const hello = {
    ...(structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage),
    capabilities: assetOpenCapabilities(),
  };
  await emitTrustedHello(transport, hello);

  const pending = client.openAsset('asset_generated_1');
  const request = await waitForRequest(transport, 'asset-open-1');
  const playbackUrl = `taku://file/subapp-asset/${Buffer.alloc(32, 8).toString('base64url')}`;
  transport.emit(
    successResponse(request, {
      playbackUrl,
      expiresAt: new Date(GOLDEN_TEST_NOW - 1).toISOString(),
      methods: ['GET', 'HEAD'],
      acceptRanges: 'bytes',
    })
  );
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'sdk_invalid_response'
  );
  await assert.rejects(client.openAsset('https://provider.example/private.png'), /assetRef/);
});

test('asset.open checks the original recovery scope after a fresh hello without sending extra wire fields', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'asset-open-1', 'confirm-1']);
  t.after(() => client.close());
  const pending = client.openAsset('asset_generated_1', { expectedRecoveryScope: RECOVERY_SCOPE });
  const assertion = assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'account_changed'
  );
  await nextTask();
  await emitTrustedHello(transport, {
    ...(structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage),
    capabilities: { ...assetOpenCapabilities(), recoveryScope: `scope_${'b'.repeat(43)}` },
  });
  assert.equal(
    transport.sent.some(
      (message) =>
        message.type === TAKU_AGENT_MESSAGE_TYPES.request && message.method === 'asset.open'
    ),
    false
  );
  client.close();
  await assertion;
});

test('asset.open after absolute session expiry re-hellos once and never replays agent.start', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'asset-open-1',
    'hello-2',
    'confirm-2',
  ]);
  t.after(() => client.close());
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  await nextTask();
  const hello = {
    ...(structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage),
    capabilities: assetOpenCapabilities(),
  };
  hello.attestation.proofExpiresAt = now + 50;
  hello.attestation.sessionExpiresAt = now + 100;
  await emitTrustedHello(transport, hello);
  now += 101;
  const pending = client.openAsset('asset_generated_1', { expectedRecoveryScope: RECOVERY_SCOPE });
  await waitForHello(transport, 'hello-2');
  hello.attestation.proofExpiresAt = now + 50;
  hello.attestation.sessionExpiresAt = now + 60_000;
  await emitTrustedHello(transport, hello);
  const request = await waitForRequest(transport, 'asset-open-1');
  assert.deepEqual(request.params, { assetRef: 'asset_generated_1' });
  transport.emit(
    successResponse(request, {
      playbackUrl: `taku://file/subapp-asset/${Buffer.alloc(32, 9).toString('base64url')}`,
      expiresAt: new Date(now + 30_000).toISOString(),
      methods: ['GET', 'HEAD'],
      acceptRanges: 'bytes',
    })
  );
  await pending;
  assert.deepEqual(
    transport.sent
      .filter((message) => message.type === TAKU_AGENT_MESSAGE_TYPES.request)
      .map((message) => message.method),
    ['asset.open']
  );
});

test('asset.open discards a grant if authenticated scope changes while the response is in flight', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'asset-open-1', 'capabilities-1']);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport, {
    ...(structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage),
    capabilities: assetOpenCapabilities(),
  });
  const pending = client.openAsset('asset_generated_1', { expectedRecoveryScope: RECOVERY_SCOPE });
  const request = await waitForRequest(transport, 'asset-open-1');
  const refreshing = client.capabilities();
  const capabilitiesRequest = await waitForRequest(transport, 'capabilities-1');
  transport.emit(
    successResponse(capabilitiesRequest, {
      ...assetOpenCapabilities(),
      recoveryScope: `scope_${'c'.repeat(43)}`,
    })
  );
  await refreshing;
  transport.emit(
    successResponse(request, {
      playbackUrl: `taku://file/subapp-asset/${Buffer.alloc(32, 10).toString('base64url')}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      methods: ['GET', 'HEAD'],
      acceptRanges: 'bytes',
    })
  );
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof TakuAgentError && error.code === 'account_changed'
  );
});

test('multiple assets past the session boundary share one authenticated re-hello', async (t) => {
  const transport = new FakeTransport();
  const client = makeClient(transport, [
    'hello-1',
    'confirm-1',
    'asset-open-1',
    'hello-2',
    'asset-open-2',
    'confirm-2',
  ]);
  t.after(() => client.close());
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  await nextTask();
  const hello = {
    ...(structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage),
    capabilities: assetOpenCapabilities(),
  };
  hello.attestation.proofExpiresAt = now + 50;
  hello.attestation.sessionExpiresAt = now + 100;
  await emitTrustedHello(transport, hello);
  now += 101;
  const first = client.openAsset('asset_image', { expectedRecoveryScope: RECOVERY_SCOPE });
  const second = client.openAsset('asset_video', { expectedRecoveryScope: RECOVERY_SCOPE });
  await waitForHello(transport, 'hello-2');
  hello.attestation.proofExpiresAt = now + 50;
  hello.attestation.sessionExpiresAt = now + 60_000;
  await emitTrustedHello(transport, hello);
  for (const id of ['asset-open-1', 'asset-open-2']) {
    const request = await waitForRequest(transport, id);
    transport.emit(
      successResponse(request, {
        playbackUrl: `taku://file/subapp-asset/${Buffer.alloc(32, 11).toString('base64url')}`,
        expiresAt: new Date(now + 30_000).toISOString(),
        methods: ['GET', 'HEAD'],
        acceptRanges: 'bytes',
      })
    );
  }
  await Promise.all([first, second]);
  assert.equal(
    transport.sent.filter((message) => message.type === TAKU_AGENT_MESSAGE_TYPES.hello).length,
    2
  );
  assert.equal(
    transport.sent.filter((message) => message.type === TAKU_AGENT_MESSAGE_TYPES.sessionConfirm)
      .length,
    2
  );
});

test('asset.open cannot cross a scope change during asynchronous signing', async (t) => {
  const transport = new FakeTransport();
  const originalVerifier = transport.verifyHostAttestation.bind(transport);
  let releaseSignature!: () => void;
  let signatureStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    signatureStarted = resolve;
  });
  transport.verifyHostAttestation = async (input, signal) => {
    const authenticator = await originalVerifier(input, signal);
    if (!authenticator) return null;
    return {
      ...authenticator,
      async signClientMessage(_lane, _sequence, body) {
        if ((JSON.parse(body) as { method?: string }).method === 'asset.open') {
          signatureStarted();
          await new Promise<void>((resolve) => {
            releaseSignature = resolve;
          });
        }
        return CLIENT_MAC;
      },
    };
  };
  const client = makeClient(transport, ['hello-1', 'confirm-1', 'capabilities-1', 'asset-open-1']);
  t.after(() => client.close());
  await nextTask();
  await emitTrustedHello(transport, {
    ...(structuredClone(GOLDEN.helloSuccess) as TakuAgentHelloResultMessage),
    capabilities: assetOpenCapabilities(),
  });
  const refreshing = client.capabilities();
  const capabilitiesRequest = await waitForRequest(transport, 'capabilities-1');
  const pending = client.openAsset('asset_generated_1', { expectedRecoveryScope: RECOVERY_SCOPE });
  const outcome = pending.then(
    () => 'success',
    (error: unknown) => (error instanceof TakuAgentError ? error.code : 'unexpected')
  );
  await started;
  transport.emit(
    successResponse(capabilitiesRequest, {
      ...assetOpenCapabilities(),
      recoveryScope: `scope_${'d'.repeat(43)}`,
    })
  );
  await refreshing;
  releaseSignature();
  await nextTask();
  const assetWasSent = transport.sent.some(
    (message) =>
      message.type === TAKU_AGENT_MESSAGE_TYPES.request && message.method === 'asset.open'
  );
  client.close();
  assert.equal(assetWasSent, false);
  assert.equal(await outcome, 'account_changed');
});
