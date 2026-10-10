import {
  isTakuAgentOperation,
  TAKU_AGENT_CLIENT_FEATURES,
  TAKU_AGENT_CONTENT_PAGE_MAX_BYTES,
  TAKU_AGENT_ERROR_CODES,
  TAKU_AGENT_EXECUTE_OPERATION,
  TAKU_AGENT_FIELD_LIMITS,
  TAKU_AGENT_IMAGE_OPERATION,
  TAKU_AGENT_MESSAGE_TYPES,
  TAKU_AGENT_METHODS,
  TAKU_AGENT_OPERATION,
  TAKU_AGENT_OPERATION_CATALOG_VERSION,
  TAKU_AGENT_PROTOCOL,
  TAKU_AGENT_SECURE_DIRECTIONS,
  TAKU_AGENT_SECURE_LANES,
  TAKU_AGENT_SUPPORTED_OPERATIONS,
  TAKU_AGENT_VIDEO_OPERATION,
  type TakuAgentAssetOpenResult,
  type TakuAgentCapabilities,
  type TakuAgentContentReadResult,
  type TakuAgentContentRef,
  type TakuAgentErrorCode,
  type TakuAgentErrorPayload,
  type TakuAgentEventMessage,
  type TakuAgentEventPayload,
  type TakuAgentHelloResultMessage,
  type TakuAgentHostAttestation,
  type TakuAgentHostAttestationPayload,
  type TakuAgentHostAttestationVerification,
  type TakuAgentHostMessage,
  type TakuAgentImageResult,
  type TakuAgentJsonSchema,
  type TakuAgentMediaAsset,
  type TakuAgentOperationCatalog,
  type TakuAgentOperationDescriptor,
  type TakuAgentOperationId,
  type TakuAgentOutputWarning,
  type TakuAgentReportResult,
  type TakuAgentRequestMessage,
  type TakuAgentResponseMessage,
  type TakuAgentResult,
  type TakuAgentRunCursor,
  type TakuAgentRunOutput,
  type TakuAgentRunSnapshot,
  type TakuAgentRunState,
  type TakuAgentSecureClientBody,
  type TakuAgentSecureDirection,
  type TakuAgentSecureEnvelope,
  type TakuAgentSecureHostBody,
  type TakuAgentSecureLane,
  type TakuAgentSessionConfirmMessage,
  type TakuAgentSessionReadyMessage,
  type TakuAgentStartInput,
  type TakuAgentStoredEvent,
  type TakuAgentSubscribeResult,
  type TakuAgentUnsubscribeResult,
  type TakuAgentVideoResult,
} from './types';

const ERROR_CODES = new Set<string>(TAKU_AGENT_ERROR_CODES);
const RUN_STATES = new Set<TakuAgentRunState>([
  'queued',
  'running',
  'waiting_approval',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
]);
const MAX_IDENTIFIER_LENGTH = TAKU_AGENT_FIELD_LIMITS.runId;
const MAX_ERROR_MESSAGE_LENGTH = 4_000;
const MAX_ERROR_DETAIL_LENGTH = 4_000;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BASE64URL_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SECURE_DIRECTIONS = new Set<string>(TAKU_AGENT_SECURE_DIRECTIONS);
const SECURE_LANES = new Set<string>(TAKU_AGENT_SECURE_LANES);
const METHOD_SET = new Set<string>(TAKU_AGENT_METHODS);
const CLIENT_FEATURE_SET = new Set<string>(TAKU_AGENT_CLIENT_FEATURES);
const MAX_CAPABILITY_ENTRIES = 64;
const MAX_CATALOG_OPERATIONS = 64;
const MAX_SCHEMA_NODES = 2_048;
const CAPABILITY_DIGEST_TRANSCRIPTS = new WeakMap<TakuAgentCapabilities, string>();
export const TAKU_AGENT_MAX_SECURE_ENVELOPE_BYTES = 64 * 1_024;
const CAPABILITY_LIMIT_KEYS = [
  'maxConcurrentRuns',
  'maxInputBytes',
  'maxBufferedEvents',
  'maxEventBytes',
  'eventRetention',
  'maxSubscribersPerRun',
] as const;
const CAPABILITY_LIMIT_CEILINGS = {
  maxConcurrentRuns: 1,
  maxInputBytes: 32_768,
  maxBufferedEvents: 256,
  maxEventBytes: 32_768,
  eventRetention: 256,
  maxSubscribersPerRun: 8,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonEmptyString(
  value: unknown,
  maxLength: number = MAX_IDENTIFIER_LENGTH
): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function readBoundedString(
  value: unknown,
  maxLength: number = MAX_IDENTIFIER_LENGTH
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function readExactBoundedString(
  value: unknown,
  maxLength: number = MAX_IDENTIFIER_LENGTH
): string | null {
  const normalized = readBoundedString(value, maxLength);
  return normalized !== null && normalized === value ? normalized : null;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return isNonEmptyString(value, 80) && Number.isFinite(Date.parse(value));
}

export function isTakuAgentClientNonce(value: unknown): value is string {
  return isCanonicalBase64Url(value, 32, BASE64URL_SHA256_PATTERN);
}

export function isTakuAgentSha256Base64Url(value: unknown): value is string {
  return isCanonicalBase64Url(value, 32, BASE64URL_SHA256_PATTERN);
}

export function isTakuAgentSessionId(value: unknown): value is string {
  return isCanonicalBase64Url(value, 16, BASE64URL_SESSION_ID_PATTERN);
}

function isCanonicalBase64Url(
  value: unknown,
  byteLength: number,
  pattern: RegExp
): value is string {
  if (typeof value !== 'string' || !pattern.test(value)) return false;
  const decoded = decodeBase64Url(value);
  return decoded.length === byteLength && encodeBase64Url(decoded) === value;
}

export function decodeTakuAgentBase64Url(value: string): Uint8Array {
  return decodeBase64Url(value);
}

function decodeBase64Url(value: string): Uint8Array {
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of value) {
    const sextet = BASE64URL_ALPHABET.indexOf(character);
    if (sextet < 0) return new Uint8Array();
    buffer = (buffer << 6) | sextet;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(bytes);
}

export function encodeTakuAgentBase64Url(bytes: Uint8Array): string {
  return encodeBase64Url(bytes);
}

function encodeBase64Url(bytes: Uint8Array): string {
  let buffer = 0;
  let bits = 0;
  let output = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      output += BASE64URL_ALPHABET[(buffer >> bits) & 63];
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0) output += BASE64URL_ALPHABET[(buffer << (6 - bits)) & 63];
  return output;
}

export function parseTakuAgentHostAttestation(value: unknown): TakuAgentHostAttestation | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'runtimeInstanceId',
      'sessionId',
      'proofExpiresAt',
      'sessionExpiresAt',
      'proof',
    ]) ||
    !isNonEmptyString(value.runtimeInstanceId, TAKU_AGENT_FIELD_LIMITS.runtimeInstanceId) ||
    !isTakuAgentSessionId(value.sessionId) ||
    !isPositiveSafeInteger(value.proofExpiresAt) ||
    !isPositiveSafeInteger(value.sessionExpiresAt) ||
    !isTakuAgentSha256Base64Url(value.proof)
  ) {
    return null;
  }
  return {
    runtimeInstanceId: value.runtimeInstanceId,
    sessionId: value.sessionId,
    proofExpiresAt: value.proofExpiresAt,
    sessionExpiresAt: value.sessionExpiresAt,
    proof: value.proof,
  };
}

export function parseTakuAgentHostAttestationVerification(
  value: unknown
): TakuAgentHostAttestationVerification | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'protocol',
      'requestId',
      'clientNonce',
      'frameEpoch',
      'runtimeInstanceId',
      'sessionId',
      'capabilitiesDigest',
      'proofExpiresAt',
      'sessionExpiresAt',
      'proof',
    ]) ||
    value.protocol !== TAKU_AGENT_PROTOCOL ||
    !isNonEmptyString(value.requestId, TAKU_AGENT_FIELD_LIMITS.requestId) ||
    !isTakuAgentClientNonce(value.clientNonce) ||
    !isNonEmptyString(value.frameEpoch, TAKU_AGENT_FIELD_LIMITS.frameEpoch) ||
    !isTakuAgentSha256Base64Url(value.capabilitiesDigest)
  ) {
    return null;
  }
  const attestation = parseTakuAgentHostAttestation({
    runtimeInstanceId: value.runtimeInstanceId,
    sessionId: value.sessionId,
    proofExpiresAt: value.proofExpiresAt,
    sessionExpiresAt: value.sessionExpiresAt,
    proof: value.proof,
  });
  if (!attestation) return null;
  return {
    protocol: TAKU_AGENT_PROTOCOL,
    requestId: value.requestId,
    clientNonce: value.clientNonce,
    frameEpoch: value.frameEpoch,
    capabilitiesDigest: value.capabilitiesDigest,
    ...attestation,
  };
}

export function serializeTakuAgentHostAttestationPayload(
  value: TakuAgentHostAttestationPayload
): string {
  return JSON.stringify([
    'taku.agent.attestation/v2',
    value.protocol,
    value.requestId,
    value.clientNonce,
    value.frameEpoch,
    value.runtimeInstanceId,
    value.sessionId,
    value.capabilitiesDigest,
    value.proofExpiresAt,
    value.sessionExpiresAt,
  ]);
}

export function serializeTakuAgentCapabilities(capabilities: TakuAgentCapabilities): string {
  const recoveryScope = validateTakuAgentRecoveryScope(capabilities.recoveryScope);
  const methodSet = new Set(capabilities.methods);
  const methods = TAKU_AGENT_METHODS.filter((method) => methodSet.has(method));
  const operations = capabilities.operations
    .map(({ id, revision }) => ({ id, revision }))
    .sort(
      (left, right) =>
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0) || left.revision - right.revision
    );
  const features = TAKU_AGENT_CLIENT_FEATURES.filter((feature) =>
    capabilities.features?.includes(feature)
  );
  const serializedOperations = operations.map(({ id, revision }) => [id, revision] as const);
  if (features.length === 0 && capabilities.catalog === undefined) {
    return JSON.stringify([
      'taku.agent.capabilities/v2',
      recoveryScope,
      serializedOperations,
      methods,
      CAPABILITY_LIMIT_KEYS.map((key) => capabilities.limits[key]),
    ]);
  }
  const catalog = features.includes('operation-catalog-v1')
    ? canonicalOperationCatalog(capabilities.catalog, serializedOperations)
    : null;
  return JSON.stringify([
    'taku.agent.capabilities/v3',
    recoveryScope,
    serializedOperations,
    methods,
    features,
    catalog,
    CAPABILITY_LIMIT_KEYS.map((key) => capabilities.limits[key]),
  ]);
}

/**
 * The handshake authenticates every well-formed operation and method advertised
 * by a newer Host, while the public parser exposes only the subset this SDK can
 * call. The full transcript is kept out of the returned object so unknown Host
 * capabilities cannot accidentally become callable.
 */
export function serializeTakuAgentCapabilitiesForDigest(
  capabilities: TakuAgentCapabilities
): string {
  return (
    CAPABILITY_DIGEST_TRANSCRIPTS.get(capabilities) ?? serializeTakuAgentCapabilities(capabilities)
  );
}

export function serializeTakuAgentSecureMessagePayload(value: {
  protocol: typeof TAKU_AGENT_PROTOCOL;
  sessionId: string;
  direction: TakuAgentSecureDirection;
  lane: TakuAgentSecureLane;
  sequence: string;
  body: string;
}): string {
  return JSON.stringify([
    'taku.agent.secure-message/v1',
    value.protocol,
    value.sessionId,
    value.direction,
    value.lane,
    value.sequence,
    value.body,
  ]);
}

export function parseTakuAgentError(value: unknown): TakuAgentErrorPayload | null {
  const code = isRecord(value)
    ? readExactBoundedString(value.code, TAKU_AGENT_FIELD_LIMITS.requestId)
    : null;
  if (
    !isRecord(value) ||
    !code ||
    !isNonEmptyString(value.message, MAX_ERROR_MESSAGE_LENGTH) ||
    (value.detail !== undefined && !isNonEmptyString(value.detail, MAX_ERROR_DETAIL_LENGTH)) ||
    (value.retryable !== undefined && typeof value.retryable !== 'boolean') ||
    (value.retryAfterMs !== undefined && !isNonNegativeSafeInteger(value.retryAfterMs))
  ) {
    return null;
  }
  const knownCode = ERROR_CODES.has(code);
  return {
    code: knownCode ? (code as TakuAgentErrorCode) : 'internal_error',
    message: value.message,
    ...(value.detail === undefined ? {} : { detail: value.detail }),
    ...(knownCode
      ? value.retryable === undefined
        ? {}
        : { retryable: value.retryable }
      : { retryable: true }),
    ...(value.retryAfterMs === undefined ? {} : { retryAfterMs: value.retryAfterMs }),
  };
}

export function parseTakuAgentCapabilities(value: unknown): TakuAgentCapabilities | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.methods) ||
    !Array.isArray(value.operations) ||
    value.methods.length > MAX_CAPABILITY_ENTRIES ||
    value.operations.length > MAX_CAPABILITY_ENTRIES
  ) {
    return null;
  }
  const recoveryScope = readBoundedString(
    value.recoveryScope,
    TAKU_AGENT_FIELD_LIMITS.recoveryScope
  );
  if (!recoveryScope) return null;
  const transcriptMethods: string[] = [];
  const transcriptMethodSet = new Set<string>();
  const knownMethodSet = new Set<string>();
  for (const rawMethod of value.methods) {
    const method = readExactBoundedString(rawMethod, TAKU_AGENT_FIELD_LIMITS.requestId);
    if (!method) return null;
    if (!transcriptMethodSet.has(method)) {
      transcriptMethodSet.add(method);
      transcriptMethods.push(method);
    }
    if (METHOD_SET.has(method)) knownMethodSet.add(method);
  }
  const methods = TAKU_AGENT_METHODS.filter((method) => knownMethodSet.has(method));
  const operations: TakuAgentCapabilities['operations'] = [];
  const transcriptOperations: Array<{ id: string; revision: number }> = [];
  const operationKeys = new Set<string>();
  for (const operation of value.operations) {
    if (!isRecord(operation)) return null;
    const id = readExactBoundedString(operation.id, TAKU_AGENT_FIELD_LIMITS.requestId);
    if (!id || !isPositiveSafeInteger(operation.revision)) return null;
    const key = `${id}\u0000${operation.revision}`;
    if (operationKeys.has(key)) return null;
    operationKeys.add(key);
    transcriptOperations.push({ id, revision: operation.revision });
    if (
      TAKU_AGENT_SUPPORTED_OPERATIONS.some(
        (supported) => supported.id === id && supported.revision === operation.revision
      )
    ) {
      operations.push({ id: id as TakuAgentOperationId, revision: 1 });
    }
  }
  operations.sort(
    (left, right) =>
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0) || left.revision - right.revision
  );
  if (!isRecord(value.limits)) return null;
  const {
    maxConcurrentRuns,
    maxInputBytes,
    maxBufferedEvents,
    maxEventBytes,
    eventRetention,
    maxSubscribersPerRun,
  } = value.limits;
  if (
    !isPositiveSafeInteger(maxConcurrentRuns) ||
    maxConcurrentRuns > CAPABILITY_LIMIT_CEILINGS.maxConcurrentRuns ||
    !isPositiveSafeInteger(maxInputBytes) ||
    maxInputBytes > CAPABILITY_LIMIT_CEILINGS.maxInputBytes ||
    !isPositiveSafeInteger(maxBufferedEvents) ||
    maxBufferedEvents > CAPABILITY_LIMIT_CEILINGS.maxBufferedEvents ||
    !isPositiveSafeInteger(maxEventBytes) ||
    maxEventBytes > CAPABILITY_LIMIT_CEILINGS.maxEventBytes ||
    !isPositiveSafeInteger(eventRetention) ||
    eventRetention > CAPABILITY_LIMIT_CEILINGS.eventRetention ||
    !isPositiveSafeInteger(maxSubscribersPerRun) ||
    maxSubscribersPerRun > CAPABILITY_LIMIT_CEILINGS.maxSubscribersPerRun
  ) {
    return null;
  }

  const transcriptFeatures = parseCapabilityFeatureTranscript(value.features);
  if (!transcriptFeatures) return null;
  const features = TAKU_AGENT_CLIENT_FEATURES.filter((feature) =>
    transcriptFeatures.includes(feature)
  );
  const hasCatalogFeature = transcriptFeatures.includes('operation-catalog-v1');
  if ((value.catalog !== undefined) !== hasCatalogFeature) return null;
  const parsedCatalog = hasCatalogFeature
    ? parseOperationCatalog(value.catalog, transcriptOperations)
    : null;
  if (hasCatalogFeature && !parsedCatalog) return null;
  const hasContentFeature = transcriptFeatures.includes('content-ref-v1');
  if (transcriptMethodSet.has('content.read') && !hasContentFeature) return null;
  const hasAssetOpenFeature = transcriptFeatures.includes('asset-open-v1');
  if (transcriptMethodSet.has('asset.open') && !hasAssetOpenFeature) return null;

  const capabilities: TakuAgentCapabilities = {
    recoveryScope,
    methods,
    operations,
    ...(features.length === 0 ? {} : { features }),
    ...(parsedCatalog ? { catalog: parsedCatalog.catalog } : {}),
    limits: {
      maxConcurrentRuns,
      maxInputBytes,
      maxBufferedEvents,
      maxEventBytes,
      eventRetention,
      maxSubscribersPerRun,
    },
  };
  const hasUnknownTranscriptEntry =
    transcriptMethods.some((method) => !METHOD_SET.has(method)) ||
    transcriptOperations.some((operation) => !isKnownOperation(operation.id, operation.revision)) ||
    transcriptFeatures.some((feature) => !CLIENT_FEATURE_SET.has(feature));
  if (hasUnknownTranscriptEntry) {
    CAPABILITY_DIGEST_TRANSCRIPTS.set(
      capabilities,
      serializeCapabilityTranscript({
        recoveryScope,
        methods: transcriptMethods,
        operations: transcriptOperations,
        features: transcriptFeatures,
        catalog: parsedCatalog?.canonical,
        limits: capabilities.limits,
      })
    );
  }
  return capabilities;
}

function serializeCapabilityTranscript(capabilities: {
  recoveryScope: string;
  methods: string[];
  operations: Array<{ id: string; revision: number }>;
  features: string[];
  catalog?: unknown;
  limits: TakuAgentCapabilities['limits'];
}): string {
  const operations = capabilities.operations
    .map(({ id, revision }) => [id, revision] as const)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] - right[1]));
  if (capabilities.features.length > 0) {
    return JSON.stringify([
      'taku.agent.capabilities/v3',
      capabilities.recoveryScope,
      operations,
      capabilities.methods,
      capabilities.features,
      capabilities.catalog ?? null,
      CAPABILITY_LIMIT_KEYS.map((key) => capabilities.limits[key]),
    ]);
  }
  return JSON.stringify([
    'taku.agent.capabilities/v2',
    capabilities.recoveryScope,
    operations,
    capabilities.methods,
    CAPABILITY_LIMIT_KEYS.map((key) => capabilities.limits[key]),
  ]);
}

function parseCapabilityFeatureTranscript(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CAPABILITY_ENTRIES) return null;
  const features: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const feature = readExactBoundedString(candidate, TAKU_AGENT_FIELD_LIMITS.requestId);
    if (!feature || seen.has(feature)) return null;
    seen.add(feature);
    features.push(feature);
  }
  return features;
}

type NormalizedOperationDescriptor = {
  id: string;
  revision: number;
  title: string;
  description: string;
  inputSchema: TakuAgentJsonSchema;
  outputSchema: TakuAgentJsonSchema;
  outputKinds: string[];
  fixedBehavior: string[];
};

function parseOperationCatalog(
  value: unknown,
  expectedOperations: Array<{ id: string; revision: number }>
): { catalog: TakuAgentOperationCatalog; canonical: unknown } | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['catalogVersion', 'operations']) ||
    value.catalogVersion !== TAKU_AGENT_OPERATION_CATALOG_VERSION ||
    !Array.isArray(value.operations) ||
    value.operations.length > MAX_CATALOG_OPERATIONS
  ) {
    return null;
  }
  const normalized: NormalizedOperationDescriptor[] = [];
  const operationKeys = new Set<string>();
  for (const rawOperation of value.operations) {
    const operation = parseOperationDescriptor(rawOperation);
    if (!operation) return null;
    const key = `${operation.id}\u0000${operation.revision}`;
    if (operationKeys.has(key)) return null;
    operationKeys.add(key);
    normalized.push(operation);
  }
  const expected = new Set(
    expectedOperations.map((operation) => `${operation.id}\u0000${operation.revision}`)
  );
  if (
    normalized.length !== expected.size ||
    normalized.some((operation) => !expected.has(`${operation.id}\u0000${operation.revision}`))
  ) {
    return null;
  }
  const knownOperations: TakuAgentOperationDescriptor[] = [];
  for (const operation of normalized) {
    if (!isKnownOperation(operation.id, operation.revision)) continue;
    if (
      operation.outputKinds.some(
        (kind) => !['report', 'text', 'markdown', 'json', 'images', 'videos'].includes(kind)
      ) ||
      !hasCompatibleKnownOperationInputSchema(operation)
    ) {
      return null;
    }
    knownOperations.push({
      id: operation.id,
      revision: 1,
      title: operation.title,
      description: operation.description,
      inputSchema: cloneJsonSchema(operation.inputSchema),
      outputSchema: cloneJsonSchema(operation.outputSchema),
      outputKinds: operation.outputKinds as TakuAgentOperationDescriptor['outputKinds'],
      ...(operation.fixedBehavior.length === 0
        ? {}
        : { fixedBehavior: [...operation.fixedBehavior] }),
    });
  }
  return {
    catalog: {
      catalogVersion: TAKU_AGENT_OPERATION_CATALOG_VERSION,
      operations: knownOperations,
    },
    canonical: canonicalNormalizedOperationCatalog(normalized),
  };
}

function hasCompatibleKnownOperationInputSchema(operation: NormalizedOperationDescriptor): boolean {
  if (operation.id !== TAKU_AGENT_IMAGE_OPERATION && operation.id !== TAKU_AGENT_VIDEO_OPERATION) {
    return true;
  }
  const schema = operation.inputSchema;
  const properties = schema.properties;
  if (
    schema.type !== 'object' ||
    schema.additionalProperties !== false ||
    !properties ||
    schema.required?.length !== 1 ||
    schema.required[0] !== 'prompt' ||
    properties.prompt?.type !== 'string'
  ) {
    return false;
  }
  const allowedFields =
    operation.id === TAKU_AGENT_IMAGE_OPERATION
      ? new Set(['prompt', 'aspectRatio'])
      : new Set(['prompt', 'aspectRatio', 'durationSeconds']);
  return Object.keys(properties).every((field) => allowedFields.has(field));
}

function parseOperationDescriptor(value: unknown): NormalizedOperationDescriptor | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'revision',
      'title',
      'description',
      'inputSchema',
      'outputSchema',
      'outputKinds',
      'fixedBehavior',
    ])
  ) {
    return null;
  }
  const id = readExactBoundedString(value.id, TAKU_AGENT_FIELD_LIMITS.requestId);
  const title = readExactBoundedString(value.title, 256);
  const description = readExactBoundedString(value.description, 2_000);
  const inputSchema = parseJsonSchema(value.inputSchema);
  const outputSchema = parseJsonSchema(value.outputSchema);
  if (
    !id ||
    !isPositiveSafeInteger(value.revision) ||
    !title ||
    !description ||
    !inputSchema ||
    !outputSchema ||
    !Array.isArray(value.outputKinds) ||
    value.outputKinds.length === 0 ||
    value.outputKinds.length > 16
  ) {
    return null;
  }
  const outputKinds: string[] = [];
  const outputKindSet = new Set<string>();
  for (const rawKind of value.outputKinds) {
    const kind = readExactBoundedString(rawKind, 64);
    if (!kind || outputKindSet.has(kind)) return null;
    outputKindSet.add(kind);
    outputKinds.push(kind);
  }
  const fixedBehavior = parseUniqueStringArray(value.fixedBehavior, 32, 2_000);
  if (fixedBehavior === null) return null;
  return {
    id,
    revision: value.revision,
    title,
    description,
    inputSchema,
    outputSchema,
    outputKinds,
    fixedBehavior: fixedBehavior ?? [],
  };
}

function parseJsonSchema(
  value: unknown,
  depth = 0,
  budget: { nodes: number } = { nodes: 0 }
): TakuAgentJsonSchema | null {
  budget.nodes += 1;
  if (
    depth > 16 ||
    budget.nodes > MAX_SCHEMA_NODES ||
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'type',
      '$ref',
      '$defs',
      'oneOf',
      'const',
      'description',
      'additionalProperties',
      'required',
      'properties',
      'items',
      'enum',
      'minLength',
      'maxLength',
      'minimum',
      'maximum',
      'default',
      'minItems',
      'maxItems',
      'pattern',
      'format',
      'deprecated',
    ])
  ) {
    return null;
  }
  const types = ['object', 'array', 'string', 'integer', 'number', 'boolean'] as const;
  if (value.type !== undefined && !types.includes(value.type as (typeof types)[number]))
    return null;
  if (
    value.$ref !== undefined &&
    (typeof value.$ref !== 'string' || !/^#\/\$defs\/[A-Za-z0-9_-]{1,64}$/.test(value.$ref))
  ) {
    return null;
  }
  if (
    value.oneOf !== undefined &&
    (!Array.isArray(value.oneOf) || value.oneOf.length === 0 || value.oneOf.length > 64)
  ) {
    return null;
  }
  if (
    value.const !== undefined &&
    (!['string', 'number', 'boolean'].includes(typeof value.const) ||
      (typeof value.const === 'number' && !Number.isFinite(value.const)))
  ) {
    return null;
  }
  if (
    value.description !== undefined &&
    (typeof value.description !== 'string' || value.description.length > 2_000)
  ) {
    return null;
  }
  if (value.additionalProperties !== undefined && value.additionalProperties !== false) return null;
  if (
    value.pattern !== undefined &&
    (typeof value.pattern !== 'string' || value.pattern.length > 512)
  ) {
    return null;
  }
  if (value.format !== undefined && value.format !== 'date-time') return null;
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (value[key] !== undefined && !isNonNegativeSafeInteger(value[key])) return null;
  }
  for (const key of ['minimum', 'maximum'] as const) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'number' || !Number.isFinite(value[key]))
    ) {
      return null;
    }
  }
  if (value.deprecated !== undefined && typeof value.deprecated !== 'boolean') return null;
  if (
    value.default !== undefined &&
    (!['string', 'number', 'boolean'].includes(typeof value.default) ||
      (typeof value.default === 'number' && !Number.isFinite(value.default)))
  ) {
    return null;
  }
  const required = parseUniqueStringArray(value.required, 64, 64);
  const enumValues = parseSchemaEnum(value.enum);
  if (required === null || enumValues === null) return null;
  const properties = parseSchemaMap(value.properties, depth, budget);
  const definitions = parseSchemaMap(value.$defs, depth, budget);
  if (properties === null || definitions === null) return null;
  const items =
    value.items === undefined ? undefined : parseJsonSchema(value.items, depth + 1, budget);
  if (value.items !== undefined && !items) return null;
  const oneOf =
    value.oneOf === undefined
      ? undefined
      : value.oneOf.map((schema) => parseJsonSchema(schema, depth + 1, budget));
  if (oneOf?.some((schema) => !schema)) return null;
  const parsedItems = items ?? undefined;
  return {
    ...(value.type === undefined ? {} : { type: value.type as TakuAgentJsonSchema['type'] }),
    ...(value.$ref === undefined ? {} : { $ref: value.$ref }),
    ...(definitions === undefined ? {} : { $defs: definitions }),
    ...(oneOf === undefined ? {} : { oneOf: oneOf as TakuAgentJsonSchema[] }),
    ...(value.const === undefined ? {} : { const: value.const as string | number | boolean }),
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.additionalProperties === undefined ? {} : { additionalProperties: false }),
    ...(required === undefined ? {} : { required }),
    ...(properties === undefined ? {} : { properties }),
    ...(parsedItems === undefined ? {} : { items: parsedItems }),
    ...(enumValues === undefined ? {} : { enum: enumValues }),
    ...(value.minLength === undefined ? {} : { minLength: value.minLength as number }),
    ...(value.maxLength === undefined ? {} : { maxLength: value.maxLength as number }),
    ...(value.minimum === undefined ? {} : { minimum: value.minimum as number }),
    ...(value.maximum === undefined ? {} : { maximum: value.maximum as number }),
    ...(value.default === undefined ? {} : { default: value.default as string | number | boolean }),
    ...(value.minItems === undefined ? {} : { minItems: value.minItems as number }),
    ...(value.maxItems === undefined ? {} : { maxItems: value.maxItems as number }),
    ...(value.pattern === undefined ? {} : { pattern: value.pattern }),
    ...(value.format === undefined ? {} : { format: 'date-time' as const }),
    ...(value.deprecated === undefined ? {} : { deprecated: value.deprecated as boolean }),
  };
}

function parseSchemaMap(
  value: unknown,
  depth: number,
  budget: { nodes: number }
): Record<string, TakuAgentJsonSchema> | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.keys(value).length > 64) return null;
  const parsed: Record<string, TakuAgentJsonSchema> = {};
  for (const [key, schema] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) return null;
    const child = parseJsonSchema(schema, depth + 1, budget);
    if (!child) return null;
    parsed[key] = child;
  }
  return parsed;
}

function parseUniqueStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number
): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const parsed: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = readExactBoundedString(item, maxLength);
    if (!text || seen.has(text)) return null;
    seen.add(text);
    parsed.push(text);
  }
  return parsed;
}

function parseSchemaEnum(value: unknown): Array<string | number | boolean> | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return null;
  const parsed: Array<string | number | boolean> = [];
  for (const item of value) {
    if (
      !['string', 'number', 'boolean'].includes(typeof item) ||
      (typeof item === 'number' && !Number.isFinite(item)) ||
      (typeof item === 'string' && item.length > 256)
    ) {
      return null;
    }
    parsed.push(item as string | number | boolean);
  }
  return parsed;
}

function isKnownOperation(id: string, revision: number): id is TakuAgentOperationId {
  return TAKU_AGENT_SUPPORTED_OPERATIONS.some(
    (operation) => operation.id === id && operation.revision === revision
  );
}

function canonicalOperationCatalog(
  value: TakuAgentOperationCatalog | undefined,
  operations: ReadonlyArray<readonly [string, number]>
): unknown {
  if (!value || value.catalogVersion !== TAKU_AGENT_OPERATION_CATALOG_VERSION) {
    throw new Error('Runtime operation catalog is invalid.');
  }
  const expected = new Set(operations.map((operation) => `${operation[0]}@${operation[1]}`));
  const descriptors = value.operations.filter((operation) =>
    expected.has(`${operation.id}@${operation.revision}`)
  );
  if (descriptors.length !== expected.size) {
    throw new Error('Runtime operation catalog is incomplete.');
  }
  return canonicalNormalizedOperationCatalog(
    descriptors.map((operation) => ({
      ...operation,
      fixedBehavior: operation.fixedBehavior ?? [],
    }))
  );
}

function canonicalNormalizedOperationCatalog(value: NormalizedOperationDescriptor[]): unknown {
  return [
    TAKU_AGENT_OPERATION_CATALOG_VERSION,
    value
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id, 'en'))
      .map((operation) => [
        operation.id,
        operation.revision,
        operation.title,
        operation.description,
        canonicalJsonSchema(operation.inputSchema),
        canonicalJsonSchema(operation.outputSchema),
        [...operation.outputKinds].sort(),
      ]),
  ];
}

function canonicalJsonSchema(value: TakuAgentJsonSchema): unknown {
  return [
    value.type ?? null,
    value.$ref ?? null,
    value.oneOf?.map(canonicalJsonSchema) ?? null,
    value.const ?? null,
    value.description ?? null,
    value.additionalProperties ?? null,
    [...(value.required ?? [])].sort(),
    Object.entries(value.properties ?? {})
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, property]) => [key, canonicalJsonSchema(property)]),
    value.items ? canonicalJsonSchema(value.items) : null,
    Object.entries(value.$defs ?? {})
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, schema]) => [key, canonicalJsonSchema(schema)]),
    value.enum ? [...value.enum] : null,
    value.minLength ?? null,
    value.maxLength ?? null,
    value.minimum ?? null,
    value.maximum ?? null,
    value.default ?? null,
    value.minItems ?? null,
    value.maxItems ?? null,
    value.pattern ?? null,
    value.format ?? null,
    value.deprecated ?? null,
  ];
}

function cloneJsonSchema(value: TakuAgentJsonSchema): TakuAgentJsonSchema {
  return structuredClone(value);
}

export function validateTakuAgentRecoveryScope(recoveryScope: string): string {
  const normalized = readBoundedString(recoveryScope, TAKU_AGENT_FIELD_LIMITS.recoveryScope);
  if (!normalized) {
    throw new TypeError('recoveryScope is required');
  }
  return normalized;
}

export function parseTakuAgentReportResult(value: unknown): TakuAgentReportResult | null {
  if (!isRecord(value) || value.kind !== 'report' || !isNonEmptyString(value.title, 1_000)) {
    return null;
  }
  const content = parseInlineOrContentRef(value, 'markdown', 'text/markdown', ['kind', 'title']);
  return content
    ? content.kind === 'inline'
      ? { kind: 'report', title: value.title, markdown: content.value }
      : { kind: 'report', title: value.title, contentRef: content.value }
    : null;
}

export function parseTakuAgentContentRef(value: unknown): TakuAgentContentRef | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'contentId',
      'field',
      'mediaType',
      'encoding',
      'byteLength',
      'sha256',
      'expiresAt',
    ])
  ) {
    return null;
  }
  const contentId = readExactBoundedString(value.contentId, TAKU_AGENT_FIELD_LIMITS.contentId);
  if (
    !contentId ||
    !['content', 'markdown'].includes(String(value.field)) ||
    !['text/plain', 'text/markdown', 'application/json'].includes(String(value.mediaType)) ||
    value.encoding !== 'utf8' ||
    !isNonNegativeSafeInteger(value.byteLength) ||
    typeof value.sha256 !== 'string' ||
    !HEX_SHA256_PATTERN.test(value.sha256) ||
    !isIsoTimestamp(value.expiresAt)
  ) {
    return null;
  }
  return {
    contentId,
    field: value.field as TakuAgentContentRef['field'],
    mediaType: value.mediaType as TakuAgentContentRef['mediaType'],
    encoding: 'utf8',
    byteLength: value.byteLength,
    sha256: value.sha256,
    expiresAt: value.expiresAt,
  };
}

export function parseTakuAgentContentReadResult(value: unknown): TakuAgentContentReadResult | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'contentId',
      'offset',
      'nextOffset',
      'eof',
      'encoding',
      'chunk',
      'byteLength',
      'sha256',
    ])
  ) {
    return null;
  }
  const contentId = readExactBoundedString(value.contentId, TAKU_AGENT_FIELD_LIMITS.contentId);
  const chunk = typeof value.chunk === 'string' ? decodeFlexibleBase64Url(value.chunk) : null;
  if (
    !contentId ||
    !isNonNegativeSafeInteger(value.offset) ||
    !isNonNegativeSafeInteger(value.nextOffset) ||
    typeof value.eof !== 'boolean' ||
    value.encoding !== 'base64url' ||
    chunk === null ||
    !isNonNegativeSafeInteger(value.byteLength) ||
    value.byteLength > TAKU_AGENT_CONTENT_PAGE_MAX_BYTES ||
    chunk.byteLength !== value.byteLength ||
    value.nextOffset !== value.offset + value.byteLength ||
    typeof value.sha256 !== 'string' ||
    !HEX_SHA256_PATTERN.test(value.sha256)
  ) {
    return null;
  }
  return {
    contentId,
    offset: value.offset,
    nextOffset: value.nextOffset,
    eof: value.eof,
    encoding: 'base64url',
    chunk: value.chunk as string,
    byteLength: value.byteLength,
    sha256: value.sha256,
  };
}

export function parseTakuAgentAssetOpenResult(value: unknown): TakuAgentAssetOpenResult | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['playbackUrl', 'expiresAt', 'methods', 'acceptRanges']) ||
    !isAssetPlaybackUrl(value.playbackUrl) ||
    !isIsoTimestamp(value.expiresAt) ||
    !Array.isArray(value.methods) ||
    value.methods.length !== 2 ||
    value.methods[0] !== 'GET' ||
    value.methods[1] !== 'HEAD' ||
    value.acceptRanges !== 'bytes'
  ) {
    return null;
  }
  return {
    playbackUrl: value.playbackUrl as string,
    expiresAt: value.expiresAt as string,
    methods: ['GET', 'HEAD'],
    acceptRanges: 'bytes',
  };
}

export function parseTakuAgentRunOutput(value: unknown): TakuAgentRunOutput | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'report') return parseTakuAgentReportResult(value);
  if (['text', 'markdown', 'json'].includes(value.kind)) {
    const expectedMediaType =
      value.kind === 'text'
        ? 'text/plain'
        : value.kind === 'markdown'
          ? 'text/markdown'
          : 'application/json';
    const content = parseInlineOrContentRef(value, 'content', expectedMediaType, [
      'kind',
      'warnings',
    ]);
    const warnings = parseOutputWarnings(value.warnings);
    if (!content || warnings === null) return null;
    return {
      kind: value.kind as 'text' | 'markdown' | 'json',
      ...(content.kind === 'inline' ? { content: content.value } : { contentRef: content.value }),
      ...(warnings === undefined ? {} : { warnings }),
    };
  }
  if (value.kind === 'images' || value.kind === 'videos') {
    return parseMediaOutput(value, value.kind);
  }
  return null;
}

function parseInlineOrContentRef(
  value: Record<string, unknown>,
  inlineField: 'content' | 'markdown',
  expectedMediaType: TakuAgentContentRef['mediaType'],
  baseKeys: string[]
): { kind: 'inline'; value: string } | { kind: 'ref'; value: TakuAgentContentRef } | null {
  if (!hasOnlyKeys(value, [...baseKeys, inlineField, 'contentRef'])) return null;
  const hasInline = Object.hasOwn(value, inlineField);
  const hasRef = Object.hasOwn(value, 'contentRef');
  if (hasInline === hasRef) return null;
  if (hasInline) {
    const inline = value[inlineField];
    return isNonEmptyString(inline, TAKU_AGENT_MAX_SECURE_ENVELOPE_BYTES)
      ? { kind: 'inline', value: inline }
      : null;
  }
  const contentRef = parseTakuAgentContentRef(value.contentRef);
  if (
    !contentRef ||
    contentRef.field !== inlineField ||
    contentRef.mediaType !== expectedMediaType
  ) {
    return null;
  }
  return { kind: 'ref', value: contentRef };
}

function parseOutputWarnings(
  value: unknown,
  allowed: ReadonlyArray<'output_format_repaired' | 'partial_result'> = [
    'output_format_repaired',
    'partial_result',
  ]
): TakuAgentOutputWarning[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 4) return null;
  const warnings: Array<{ code: 'output_format_repaired' | 'partial_result'; message: string }> =
    [];
  for (const warning of value) {
    if (
      !isRecord(warning) ||
      !hasOnlyKeys(warning, ['code', 'message']) ||
      !allowed.includes(warning.code as 'output_format_repaired' | 'partial_result') ||
      !isNonEmptyString(warning.message, 500)
    ) {
      return null;
    }
    warnings.push({
      code: warning.code as 'output_format_repaired' | 'partial_result',
      message: warning.message,
    });
  }
  return warnings;
}

function parseMediaOutput(
  value: Record<string, unknown>,
  kind: 'images' | 'videos'
): TakuAgentImageResult | TakuAgentVideoResult | null {
  if (
    !hasOnlyKeys(value, ['kind', 'assets', 'warnings']) ||
    !Array.isArray(value.assets) ||
    value.assets.length === 0 ||
    value.assets.length > 10
  ) {
    return null;
  }
  const expectedAssetKind = kind === 'images' ? 'image' : 'video';
  const assets = value.assets.map(parseMediaAsset);
  const warnings = parseOutputWarnings(value.warnings, ['partial_result']);
  if (
    assets.some((asset) => asset === null || asset.kind !== expectedAssetKind) ||
    warnings === null
  ) {
    return null;
  }
  return {
    kind,
    assets: assets as TakuAgentMediaAsset[],
    ...(warnings === undefined ? {} : { warnings }),
  } as TakuAgentImageResult | TakuAgentVideoResult;
}

function parseMediaAsset(value: unknown): TakuAgentMediaAsset | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'assetRef',
      'kind',
      'sha256',
      'contentType',
      'width',
      'height',
      'durationSeconds',
    ])
  ) {
    return null;
  }
  const assetRef = readExactBoundedString(value.assetRef, TAKU_AGENT_FIELD_LIMITS.assetRef);
  const assetKinds = ['image', 'video', 'audio', 'document', 'model', 'other'] as const;
  if (
    !assetRef ||
    !/^asset_[A-Za-z0-9_-]{1,128}$/.test(assetRef) ||
    !assetKinds.includes(value.kind as (typeof assetKinds)[number]) ||
    (value.sha256 !== undefined &&
      (typeof value.sha256 !== 'string' || !HEX_SHA256_PATTERN.test(value.sha256))) ||
    (value.contentType !== undefined && !isNonEmptyString(value.contentType, 128)) ||
    (value.width !== undefined && !isPositiveSafeInteger(value.width)) ||
    (value.height !== undefined && !isPositiveSafeInteger(value.height)) ||
    (value.durationSeconds !== undefined &&
      (typeof value.durationSeconds !== 'number' ||
        !Number.isFinite(value.durationSeconds) ||
        value.durationSeconds < 0))
  ) {
    return null;
  }
  return {
    assetRef,
    kind: value.kind as TakuAgentMediaAsset['kind'],
    ...(value.sha256 === undefined ? {} : { sha256: value.sha256 as string }),
    ...(value.contentType === undefined ? {} : { contentType: value.contentType as string }),
    ...(value.width === undefined ? {} : { width: value.width as number }),
    ...(value.height === undefined ? {} : { height: value.height as number }),
    ...(value.durationSeconds === undefined
      ? {}
      : { durationSeconds: value.durationSeconds as number }),
  };
}

function isAssetPlaybackUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 256) return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'taku:' ||
      url.hostname !== 'file' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return false;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    return (
      segments.length === 2 &&
      segments[0] === 'subapp-asset' &&
      isCanonicalBase64Url(segments[1], 32, BASE64URL_SHA256_PATTERN)
    );
  } catch {
    return false;
  }
}

function decodeFlexibleBase64Url(value: string): Uint8Array | null {
  if (value === '') return new Uint8Array();
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
  const decoded = decodeBase64Url(value);
  return encodeBase64Url(decoded) === value ? decoded : null;
}

export function parseTakuAgentRunSnapshot(value: unknown): TakuAgentRunSnapshot | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.runId) ||
    !isTakuAgentOperation(value.operation, value.operationRevision) ||
    typeof value.state !== 'string' ||
    !RUN_STATES.has(value.state as TakuAgentRunState) ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt)
  ) {
    return null;
  }
  const result = value.result === undefined ? undefined : parseTakuAgentRunOutput(value.result);
  const error = value.error === undefined ? undefined : parseTakuAgentError(value.error);
  if ((value.result !== undefined && !result) || (value.error !== undefined && !error)) return null;
  return {
    runId: value.runId,
    operation: value.operation,
    operationRevision: 1,
    state: value.state as TakuAgentRunState,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(result ? { result } : {}),
    ...(error ? { error } : {}),
  };
}

function parseEventPayload(value: unknown): TakuAgentEventPayload | null {
  if (!isRecord(value) || !isNonEmptyString(value.type)) return null;
  if (value.type === 'run.state') {
    if (typeof value.status !== 'string' || !RUN_STATES.has(value.status as TakuAgentRunState)) {
      return null;
    }
    return { type: 'run.state', status: value.status as TakuAgentRunState };
  }
  if (value.type === 'output.delta') {
    return isNonEmptyString(value.delta, 64_000)
      ? { type: 'output.delta', delta: value.delta }
      : null;
  }
  if (value.type === 'run.result') {
    const result = parseTakuAgentRunOutput(value.result);
    return result ? { type: 'run.result', result } : null;
  }
  if (value.type === 'run.error') {
    const error = parseTakuAgentError(value.error);
    return error ? { type: 'run.error', error } : null;
  }
  return { type: 'unknown', originalType: value.type };
}

export function parseTakuAgentStoredEvent(value: unknown): TakuAgentStoredEvent | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.runId) ||
    !isPositiveSafeInteger(value.sequence) ||
    !isIsoTimestamp(value.occurredAt)
  ) {
    return null;
  }
  const event = parseEventPayload(value.event);
  if (!event) return null;
  return {
    runId: value.runId,
    sequence: value.sequence,
    occurredAt: value.occurredAt,
    event,
  };
}

export function parseTakuAgentEvent(value: unknown): TakuAgentEventMessage | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      '__taku',
      'type',
      'protocol',
      'frameEpoch',
      'subscriptionId',
      'runId',
      'sequence',
      'occurredAt',
      'event',
    ]) ||
    value.__taku !== true ||
    value.type !== TAKU_AGENT_MESSAGE_TYPES.event ||
    value.protocol !== TAKU_AGENT_PROTOCOL ||
    !isNonEmptyString(value.frameEpoch) ||
    !isNonEmptyString(value.subscriptionId) ||
    !isNonEmptyString(value.runId)
  ) {
    return null;
  }
  const stored = parseTakuAgentStoredEvent(value);
  if (!stored) return null;
  return {
    ...stored,
    __taku: true,
    type: TAKU_AGENT_MESSAGE_TYPES.event,
    protocol: TAKU_AGENT_PROTOCOL,
    frameEpoch: value.frameEpoch,
    subscriptionId: value.subscriptionId,
  };
}

export function parseTakuAgentHostMessage(value: unknown): TakuAgentHostMessage | null {
  if (!isRecord(value) || value.__taku !== true || value.protocol !== TAKU_AGENT_PROTOCOL) {
    return null;
  }
  if (value.type === TAKU_AGENT_MESSAGE_TYPES.helloResult) {
    if (value.ok === false && isNonEmptyString(value.requestId)) {
      if (value.frameEpoch !== undefined && !isNonEmptyString(value.frameEpoch)) return null;
      const error = parseTakuAgentError(value.error);
      if (!error) return null;
      return {
        __taku: true,
        type: TAKU_AGENT_MESSAGE_TYPES.helloResult,
        protocol: TAKU_AGENT_PROTOCOL,
        requestId: value.requestId,
        ...(value.frameEpoch === undefined ? {} : { frameEpoch: value.frameEpoch }),
        ok: false,
        error,
      };
    }
    if (
      value.ok !== true ||
      !isNonEmptyString(value.requestId) ||
      !isNonEmptyString(value.frameEpoch)
    ) {
      return null;
    }
    const capabilities = parseTakuAgentCapabilities(value.capabilities);
    const attestation = parseTakuAgentHostAttestation(value.attestation);
    if (!capabilities || !isTakuAgentSha256Base64Url(value.capabilitiesDigest) || !attestation) {
      return null;
    }
    return {
      __taku: true,
      type: TAKU_AGENT_MESSAGE_TYPES.helloResult,
      protocol: TAKU_AGENT_PROTOCOL,
      requestId: value.requestId,
      frameEpoch: value.frameEpoch,
      ok: true,
      capabilities,
      capabilitiesDigest: value.capabilitiesDigest,
      attestation,
    } satisfies TakuAgentHelloResultMessage;
  }
  return null;
}

function parseTakuAgentResponse(value: unknown): TakuAgentResponseMessage | null {
  if (
    !isRecord(value) ||
    value.__taku !== true ||
    value.protocol !== TAKU_AGENT_PROTOCOL ||
    value.type !== TAKU_AGENT_MESSAGE_TYPES.response ||
    !isNonEmptyString(value.requestId) ||
    !isNonEmptyString(value.frameEpoch)
  ) {
    return null;
  }
  if (value.ok === true && 'result' in value) {
    if (
      !hasOnlyKeys(value, ['__taku', 'type', 'protocol', 'requestId', 'frameEpoch', 'ok', 'result'])
    ) {
      return null;
    }
    return {
      __taku: true,
      type: TAKU_AGENT_MESSAGE_TYPES.response,
      protocol: TAKU_AGENT_PROTOCOL,
      requestId: value.requestId,
      frameEpoch: value.frameEpoch,
      ok: true,
      result: value.result,
    } satisfies TakuAgentResponseMessage;
  }
  if (value.ok === false) {
    if (
      !hasOnlyKeys(value, ['__taku', 'type', 'protocol', 'requestId', 'frameEpoch', 'ok', 'error'])
    ) {
      return null;
    }
    const error = parseTakuAgentError(value.error);
    if (!error) return null;
    return {
      __taku: true,
      type: TAKU_AGENT_MESSAGE_TYPES.response,
      protocol: TAKU_AGENT_PROTOCOL,
      requestId: value.requestId,
      frameEpoch: value.frameEpoch,
      ok: false,
      error,
    } satisfies TakuAgentResponseMessage;
  }
  return null;
}

function parseTakuAgentRequest(value: unknown): TakuAgentRequestMessage | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      '__taku',
      'type',
      'protocol',
      'requestId',
      'frameEpoch',
      'method',
      'params',
    ]) ||
    value.__taku !== true ||
    value.protocol !== TAKU_AGENT_PROTOCOL ||
    value.type !== TAKU_AGENT_MESSAGE_TYPES.request ||
    !isNonEmptyString(value.requestId, TAKU_AGENT_FIELD_LIMITS.requestId) ||
    !isNonEmptyString(value.frameEpoch, TAKU_AGENT_FIELD_LIMITS.frameEpoch) ||
    typeof value.method !== 'string' ||
    !METHOD_SET.has(value.method) ||
    !isRecord(value.params)
  ) {
    return null;
  }
  return {
    __taku: true,
    protocol: TAKU_AGENT_PROTOCOL,
    type: TAKU_AGENT_MESSAGE_TYPES.request,
    requestId: value.requestId,
    frameEpoch: value.frameEpoch,
    method: value.method as TakuAgentRequestMessage['method'],
    params: value.params,
  };
}

function parseTakuAgentSessionConfirm(value: unknown): TakuAgentSessionConfirmMessage | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['__taku', 'protocol', 'type', 'requestId', 'frameEpoch']) ||
    value.__taku !== true ||
    value.protocol !== TAKU_AGENT_PROTOCOL ||
    value.type !== TAKU_AGENT_MESSAGE_TYPES.sessionConfirm ||
    !isNonEmptyString(value.requestId, TAKU_AGENT_FIELD_LIMITS.requestId) ||
    !isNonEmptyString(value.frameEpoch, TAKU_AGENT_FIELD_LIMITS.frameEpoch)
  ) {
    return null;
  }
  return {
    __taku: true,
    protocol: TAKU_AGENT_PROTOCOL,
    type: TAKU_AGENT_MESSAGE_TYPES.sessionConfirm,
    requestId: value.requestId,
    frameEpoch: value.frameEpoch,
  };
}

function parseTakuAgentSessionReady(value: unknown): TakuAgentSessionReadyMessage | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      '__taku',
      'protocol',
      'type',
      'requestId',
      'frameEpoch',
      'sessionExpiresAt',
    ]) ||
    value.__taku !== true ||
    value.protocol !== TAKU_AGENT_PROTOCOL ||
    value.type !== TAKU_AGENT_MESSAGE_TYPES.sessionReady ||
    !isNonEmptyString(value.requestId, TAKU_AGENT_FIELD_LIMITS.requestId) ||
    !isNonEmptyString(value.frameEpoch, TAKU_AGENT_FIELD_LIMITS.frameEpoch) ||
    !isPositiveSafeInteger(value.sessionExpiresAt)
  ) {
    return null;
  }
  return {
    __taku: true,
    protocol: TAKU_AGENT_PROTOCOL,
    type: TAKU_AGENT_MESSAGE_TYPES.sessionReady,
    requestId: value.requestId,
    frameEpoch: value.frameEpoch,
    sessionExpiresAt: value.sessionExpiresAt,
  };
}

export function parseTakuAgentSecureEnvelope(value: unknown): TakuAgentSecureEnvelope | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      '__taku',
      'protocol',
      'type',
      'sessionId',
      'direction',
      'lane',
      'sequence',
      'body',
      'mac',
    ]) ||
    value.__taku !== true ||
    value.protocol !== TAKU_AGENT_PROTOCOL ||
    value.type !== TAKU_AGENT_MESSAGE_TYPES.secure ||
    !isTakuAgentSessionId(value.sessionId) ||
    typeof value.direction !== 'string' ||
    !SECURE_DIRECTIONS.has(value.direction) ||
    typeof value.lane !== 'string' ||
    !SECURE_LANES.has(value.lane) ||
    !isCanonicalSecureSequence(value.sequence) ||
    typeof value.body !== 'string' ||
    value.body.length === 0 ||
    !isTakuAgentSha256Base64Url(value.mac) ||
    getTakuAgentUtf8ByteLength(JSON.stringify(value)) > TAKU_AGENT_MAX_SECURE_ENVELOPE_BYTES
  ) {
    return null;
  }
  return {
    __taku: true,
    protocol: TAKU_AGENT_PROTOCOL,
    type: TAKU_AGENT_MESSAGE_TYPES.secure,
    sessionId: value.sessionId,
    direction: value.direction as TakuAgentSecureDirection,
    lane: value.lane as TakuAgentSecureLane,
    sequence: value.sequence,
    body: value.body,
    mac: value.mac,
  };
}

export function getTakuAgentUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function assertTakuAgentSecureEnvelopeSize(
  value: TakuAgentSecureEnvelope
): TakuAgentSecureEnvelope {
  if (
    value.body.length === 0 ||
    getTakuAgentUtf8ByteLength(JSON.stringify(value)) > TAKU_AGENT_MAX_SECURE_ENVELOPE_BYTES
  ) {
    throw new TypeError('Taku Agent secure envelope exceeds the protocol limit');
  }
  return value;
}

export function parseTakuAgentSecureClientBody(body: string): TakuAgentSecureClientBody | null {
  const value = parseJsonObject(body);
  if (!value) return null;
  if (value.type === TAKU_AGENT_MESSAGE_TYPES.sessionConfirm) {
    return parseTakuAgentSessionConfirm(value);
  }
  return parseTakuAgentRequest(value);
}

export function parseTakuAgentSecureHostBody(body: string): TakuAgentSecureHostBody | null {
  const value = parseJsonObject(body);
  if (!value) return null;
  if (value.type === TAKU_AGENT_MESSAGE_TYPES.sessionReady) {
    return parseTakuAgentSessionReady(value);
  }
  if (value.type === TAKU_AGENT_MESSAGE_TYPES.response) return parseTakuAgentResponse(value);
  if (value.type === TAKU_AGENT_MESSAGE_TYPES.event) return parseTakuAgentEvent(value);
  return null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isCanonicalSecureSequence(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || value.length > 16) return false;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence > 0 && String(sequence) === value;
}

export function parseTakuAgentRunCursor(value: unknown): TakuAgentRunCursor | null {
  if (!isRecord(value) || !isNonNegativeSafeInteger(value.lastSequence)) return null;
  const snapshot = parseTakuAgentRunSnapshot(value.snapshot);
  return snapshot ? { snapshot, lastSequence: value.lastSequence } : null;
}

export function parseTakuAgentResult(value: unknown): TakuAgentResult | null {
  const cursor = parseTakuAgentRunCursor(value);
  if (!cursor || !isRecord(value)) return null;
  const result = parseTakuAgentRunOutput(value.result);
  return result ? { ...cursor, result } : null;
}

export function parseTakuAgentSubscribeResult(value: unknown): TakuAgentSubscribeResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.subscriptionId) ||
    !isNonNegativeSafeInteger(value.lastSequence) ||
    !isPositiveSafeInteger(value.oldestRetainedSequence) ||
    !Array.isArray(value.replayedEvents)
  ) {
    return null;
  }
  const snapshot = parseTakuAgentRunSnapshot(value.snapshot);
  const replayedEvents = value.replayedEvents.map(parseTakuAgentStoredEvent);
  if (!snapshot || replayedEvents.some((event) => event === null)) return null;
  return {
    subscriptionId: value.subscriptionId,
    snapshot,
    lastSequence: value.lastSequence,
    oldestRetainedSequence: value.oldestRetainedSequence,
    replayedEvents: replayedEvents as TakuAgentStoredEvent[],
  };
}

export function parseTakuAgentUnsubscribeResult(value: unknown): TakuAgentUnsubscribeResult | null {
  return isRecord(value) && value.unsubscribed === true ? { unsubscribed: true } : null;
}

export function validateTakuAgentStartInput(value: TakuAgentStartInput): {
  operation: TakuAgentOperationId;
  operationRevision: 1;
  expectedRecoveryScope: string;
  input: TakuAgentStartInput['input'];
  idempotencyKey: string;
} {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'operation',
      'operationRevision',
      'expectedRecoveryScope',
      'input',
      'idempotencyKey',
    ]) ||
    !isTakuAgentOperation(value.operation, value.operationRevision ?? 1) ||
    !isRecord(value.input) ||
    containsForbiddenIdentity(value.input)
  ) {
    throw new TypeError(`Invalid ${String(value.operation)} input`);
  }
  const expectedRecoveryScope = readBoundedString(
    value.expectedRecoveryScope,
    TAKU_AGENT_FIELD_LIMITS.recoveryScope
  );
  const idempotencyKey = readBoundedString(
    value.idempotencyKey,
    TAKU_AGENT_FIELD_LIMITS.idempotencyKey
  );
  const input = normalizeOperationInput(value.operation, value.input);
  if (!expectedRecoveryScope || !idempotencyKey || !input) {
    throw new TypeError(`Invalid ${value.operation} input`);
  }
  return {
    operation: value.operation,
    operationRevision: 1,
    expectedRecoveryScope,
    input,
    idempotencyKey,
  };
}

function normalizeOperationInput(
  operation: TakuAgentOperationId,
  input: Record<string, unknown>
): TakuAgentStartInput['input'] | null {
  if (operation === TAKU_AGENT_OPERATION) {
    if (!hasOnlyKeys(input, ['topic', 'instructions', 'language'])) return null;
    const topic = readBoundedString(input.topic, TAKU_AGENT_FIELD_LIMITS.topic);
    const instructions = readOptionalBoundedString(
      input.instructions,
      TAKU_AGENT_FIELD_LIMITS.instructions
    );
    const language = readOptionalBoundedString(input.language, TAKU_AGENT_FIELD_LIMITS.language);
    return topic && instructions !== null && language !== null
      ? {
          topic,
          ...(instructions === undefined ? {} : { instructions }),
          ...(language === undefined ? {} : { language }),
        }
      : null;
  }
  if (operation === TAKU_AGENT_EXECUTE_OPERATION) {
    if (!hasOnlyKeys(input, ['instruction', 'context', 'language', 'output'])) return null;
    const instruction = readBoundedString(input.instruction, TAKU_AGENT_FIELD_LIMITS.instruction);
    const context = readOptionalBoundedString(input.context, TAKU_AGENT_FIELD_LIMITS.context);
    const language = readOptionalBoundedString(input.language, TAKU_AGENT_FIELD_LIMITS.language);
    if (!instruction || context === null || language === null) return null;
    let output: { format: 'text' | 'markdown' | 'json' } | undefined;
    if (input.output !== undefined) {
      if (
        !isRecord(input.output) ||
        !hasOnlyKeys(input.output, ['format']) ||
        !['text', 'markdown', 'json'].includes(String(input.output.format))
      ) {
        return null;
      }
      output = { format: input.output.format as 'text' | 'markdown' | 'json' };
    }
    return {
      instruction,
      ...(context === undefined ? {} : { context }),
      ...(language === undefined ? {} : { language }),
      ...(output === undefined ? {} : { output }),
    };
  }
  if (operation === TAKU_AGENT_IMAGE_OPERATION) {
    if (!hasOnlyKeys(input, ['prompt', 'aspectRatio'])) return null;
    const prompt = readBoundedString(input.prompt, TAKU_AGENT_FIELD_LIMITS.mediaPrompt);
    const aspectRatio = readOptionalEnum(input.aspectRatio, [
      '16:9',
      '9:16',
      '4:3',
      '3:4',
      '1:1',
    ] as const);
    if (!prompt || aspectRatio === null) {
      return null;
    }
    return {
      prompt,
      ...(aspectRatio === undefined ? {} : { aspectRatio }),
    };
  }
  if (!hasOnlyKeys(input, ['prompt', 'aspectRatio', 'durationSeconds'])) {
    return null;
  }
  const prompt = readBoundedString(input.prompt, TAKU_AGENT_FIELD_LIMITS.mediaPrompt);
  const aspectRatio = readOptionalEnum(input.aspectRatio, ['16:9', '9:16'] as const);
  const durationSeconds = input.durationSeconds;
  if (
    !prompt ||
    aspectRatio === null ||
    (durationSeconds !== undefined && ![4, 6, 8].includes(Number(durationSeconds))) ||
    (durationSeconds !== undefined && typeof durationSeconds !== 'number')
  ) {
    return null;
  }
  return {
    prompt,
    ...(aspectRatio === undefined ? {} : { aspectRatio }),
    ...(durationSeconds === undefined ? {} : { durationSeconds: durationSeconds as 4 | 6 | 8 }),
  };
}

function readOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : null;
}

function readOptionalBoundedString(value: unknown, maxLength: number): string | null | undefined {
  return value === undefined ? undefined : readBoundedString(value, maxLength);
}

const FORBIDDEN_IDENTITY_KEYS = new Set([
  'applicationId',
  'runtimeKind',
  'surface',
  'surfaceId',
  'userId',
  'accountId',
  'releaseDigest',
  'ownerUserId',
  'accessToken',
  'refreshToken',
  'apiKey',
  'token',
  'workingDir',
  'model',
  'tools',
  'mcpServers',
  'proxyUrl',
]);

function containsForbiddenIdentity(value: unknown, depth = 0): boolean {
  if (depth > 16 || !isRecord(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_IDENTITY_KEYS.has(key) || containsForbiddenIdentity(child, depth + 1)) {
      return true;
    }
  }
  return false;
}

export function validateRunId(runId: string): string {
  if (!isNonEmptyString(runId)) throw new TypeError('runId is required');
  return runId;
}

export function createTakuAgentIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `subapp-${globalThis.crypto.randomUUID()}`;
  }
  return `subapp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
