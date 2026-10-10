export const TAKU_AGENT_PROTOCOL = 'taku.agent.run/v2' as const;
export const TAKU_AGENT_SDK_VERSION = '2.1.0' as const;
export const TAKU_AGENT_CONTRACT_REVISION = 2 as const;
export const TAKU_AGENT_HOST_ATTESTATION_VERIFY_PATH = '/__taku/host-attestation/verify' as const;
export const TAKU_AGENT_HOST_ATTESTATION_MAX_TTL_MS = 15_000 as const;
export const TAKU_AGENT_SESSION_MAX_TTL_MS = 600_000 as const;
export const TAKU_AGENT_MAX_SECURE_ENVELOPE_BYTES = 65_536 as const;
export const TAKU_AGENT_CONTENT_PAGE_MAX_BYTES = 24_576 as const;

export const TAKU_AGENT_MESSAGE_TYPES = {
  hello: 'hello',
  helloResult: 'hello.result',
  sessionConfirm: 'session.confirm',
  sessionReady: 'session.ready',
  secure: 'secure',
  request: 'request',
  response: 'response',
  event: 'event',
} as const;

export const TAKU_AGENT_CLIENT_FEATURES = [
  'content-ref-v1',
  'operation-catalog-v1',
  'asset-open-v1',
] as const;

export type TakuAgentClientFeature = (typeof TAKU_AGENT_CLIENT_FEATURES)[number];

export const TAKU_AGENT_METHODS = [
  'runtime.capabilities',
  'agent.start',
  'agent.get',
  'agent.subscribe',
  'agent.unsubscribe',
  'agent.cancel',
  'agent.result',
  'content.read',
  'asset.open',
] as const;

export const TAKU_AGENT_SECURE_DIRECTIONS = ['c2h', 'h2c'] as const;
export const TAKU_AGENT_SECURE_LANES = ['rpc', 'event'] as const;

export type TakuAgentSecureDirection = (typeof TAKU_AGENT_SECURE_DIRECTIONS)[number];
export type TakuAgentSecureLane = (typeof TAKU_AGENT_SECURE_LANES)[number];
export type TakuAgentMethod = (typeof TAKU_AGENT_METHODS)[number];

/** @deprecated Use TAKU_AGENT_REPORT_OPERATION. */
export const TAKU_AGENT_OPERATION = 'research.generateReport' as const;
/** @deprecated Use TAKU_AGENT_REPORT_OPERATION_REVISION. */
export const TAKU_AGENT_OPERATION_REVISION = 1 as const;
export const TAKU_AGENT_REPORT_OPERATION = TAKU_AGENT_OPERATION;
export const TAKU_AGENT_REPORT_OPERATION_REVISION = TAKU_AGENT_OPERATION_REVISION;
export const TAKU_AGENT_EXECUTE_OPERATION = 'agent.execute' as const;
export const TAKU_AGENT_EXECUTE_OPERATION_REVISION = 1 as const;
export const TAKU_AGENT_IMAGE_OPERATION = 'media.image.generate' as const;
export const TAKU_AGENT_IMAGE_OPERATION_REVISION = 1 as const;
export const TAKU_AGENT_VIDEO_OPERATION = 'media.video.generate' as const;
export const TAKU_AGENT_VIDEO_OPERATION_REVISION = 1 as const;

export const TAKU_AGENT_SUPPORTED_OPERATIONS = [
  { id: TAKU_AGENT_EXECUTE_OPERATION, revision: TAKU_AGENT_EXECUTE_OPERATION_REVISION },
  { id: TAKU_AGENT_REPORT_OPERATION, revision: TAKU_AGENT_REPORT_OPERATION_REVISION },
  { id: TAKU_AGENT_IMAGE_OPERATION, revision: TAKU_AGENT_IMAGE_OPERATION_REVISION },
  { id: TAKU_AGENT_VIDEO_OPERATION, revision: TAKU_AGENT_VIDEO_OPERATION_REVISION },
] as const;

export type TakuAgentOperationId = (typeof TAKU_AGENT_SUPPORTED_OPERATIONS)[number]['id'];
/** Operation id accepted by the public SDK. */
export type TakuAgentOperation = TakuAgentOperationId;

export function isTakuAgentOperation(id: unknown, revision: unknown): id is TakuAgentOperationId {
  return (
    typeof id === 'string' &&
    revision === 1 &&
    TAKU_AGENT_SUPPORTED_OPERATIONS.some((operation) => operation.id === id)
  );
}

export type TakuAgentJsonValue =
  | null
  | boolean
  | number
  | string
  | TakuAgentJsonValue[]
  | { [key: string]: TakuAgentJsonValue };

export const TAKU_AGENT_OPERATION_CATALOG_VERSION = 'taku.agent.operation-catalog/v1' as const;

export type TakuAgentJsonSchema = {
  type?: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';
  $ref?: string;
  $defs?: Record<string, TakuAgentJsonSchema>;
  oneOf?: TakuAgentJsonSchema[];
  const?: string | number | boolean;
  description?: string;
  additionalProperties?: false;
  required?: string[];
  properties?: Record<string, TakuAgentJsonSchema>;
  items?: TakuAgentJsonSchema;
  enum?: Array<string | number | boolean>;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  default?: string | number | boolean;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  format?: 'date-time';
  deprecated?: boolean;
};

export type TakuAgentOperationDescriptor = {
  id: TakuAgentOperationId;
  revision: 1;
  title: string;
  description: string;
  inputSchema: TakuAgentJsonSchema;
  outputSchema: TakuAgentJsonSchema;
  outputKinds: Array<TakuAgentRunOutput['kind']>;
  /** Informational Host behavior applied without provider-specific controls. */
  fixedBehavior?: string[];
};

export type TakuAgentOperationCatalog = {
  catalogVersion: typeof TAKU_AGENT_OPERATION_CATALOG_VERSION;
  operations: TakuAgentOperationDescriptor[];
};

export const TAKU_AGENT_FIELD_LIMITS = {
  requestId: 128,
  clientNonce: 43,
  frameEpoch: 128,
  runtimeInstanceId: 128,
  sessionId: 22,
  capabilitiesDigest: 43,
  attestationProof: 43,
  sessionKey: 43,
  secureMac: 43,
  recoveryScope: 128,
  contentId: 128,
  assetRef: 134,
  mediaType: 128,
  runId: 128,
  subscriptionId: 128,
  idempotencyKey: 128,
  topic: 500,
  instruction: 8_000,
  context: 16_000,
  mediaPrompt: 4_000,
  instructions: 4_000,
  language: 64,
} as const;

export const TAKU_AGENT_ERROR_CODES = [
  'protocol_unsupported',
  'stale_frame',
  'invalid_request',
  'input_invalid',
  'capability_not_declared',
  'capability_not_granted',
  'operation_unsupported',
  'idempotency_conflict',
  'run_not_found',
  'run_not_complete',
  'event_gap',
  'concurrency_limited',
  'auth_required',
  'account_changed',
  'app_unavailable',
  'rate_limited',
  'credits_exhausted',
  'engine_unavailable',
  'host_unavailable',
  'run_timeout',
  'runner_crashed',
  'cancel_cleanup_unconfirmed',
  'output_delivery_unsupported',
  'content_not_found',
  'internal_error',
] as const;

export type TakuAgentErrorCode = (typeof TAKU_AGENT_ERROR_CODES)[number];

export const TAKU_AGENT_LOCAL_ERROR_CODES = [
  'sdk_unsupported',
  'sdk_timeout',
  'sdk_aborted',
  'sdk_closed',
  'sdk_frame_changed',
  'sdk_invalid_response',
  'sdk_limit_exceeded',
  'sdk_event_gap',
  'sdk_already_subscribed',
  'sdk_transport_failed',
  'sdk_host_untrusted',
] as const;

export type TakuAgentLocalErrorCode = (typeof TAKU_AGENT_LOCAL_ERROR_CODES)[number];
export type TakuAgentClientErrorCode = TakuAgentErrorCode | TakuAgentLocalErrorCode;

export type TakuAgentErrorPayload = {
  code: TakuAgentErrorCode;
  message: string;
  detail?: string;
  retryable?: boolean;
  retryAfterMs?: number;
};

export type TakuAgentCapabilityOperation = {
  id: TakuAgentOperationId;
  revision: 1;
};

export type TakuAgentCapabilities = {
  recoveryScope: string;
  methods: TakuAgentMethod[];
  operations: TakuAgentCapabilityOperation[];
  /** Explicitly negotiated from hello.clientFeatures. */
  features?: TakuAgentClientFeature[];
  /** Present only when operation-catalog-v1 was negotiated. */
  catalog?: TakuAgentOperationCatalog;
  limits: {
    maxConcurrentRuns: number;
    maxInputBytes: number;
    maxBufferedEvents: number;
    maxEventBytes: number;
    eventRetention: number;
    maxSubscribersPerRun: number;
  };
};

export type TakuAgentRunState =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type TakuAgentContentRef = {
  contentId: string;
  field: 'content' | 'markdown';
  mediaType: 'text/plain' | 'text/markdown' | 'application/json';
  encoding: 'utf8';
  byteLength: number;
  sha256: string;
  expiresAt: string;
};

export type TakuAgentContentReadResult = {
  contentId: string;
  offset: number;
  nextOffset: number;
  eof: boolean;
  encoding: 'base64url';
  chunk: string;
  /** Decoded byte length of this page. */
  byteLength: number;
  /** SHA-256 hex digest of the complete referenced content. */
  sha256: string;
};

export type TakuAgentAssetOpenParams = {
  assetRef: string;
};

export type TakuAgentAssetOpenResult = {
  /** Short-lived Host playback grant. Never persist it; call openAsset again after expiry. */
  playbackUrl: string;
  expiresAt: string;
  methods: Array<'GET' | 'HEAD'>;
  acceptRanges: 'bytes';
};

export type TakuAgentGenerateReportInput = {
  topic: string;
  instructions?: string;
  language?: string;
};

/** @deprecated Use TakuAgentGenerateReportInput. */
export type ResearchGenerateReportInput = TakuAgentGenerateReportInput;

export type TakuAgentExecuteInput = {
  instruction: string;
  context?: string;
  language?: string;
  output?: { format: 'text' | 'markdown' | 'json' };
};

export type TakuAgentImageGenerateInput = {
  prompt: string;
  /** The Proxy applies the catalog default, currently 1:1, when this is omitted. */
  aspectRatio?: '16:9' | '9:16' | '4:3' | '3:4' | '1:1';
};

export type TakuAgentVideoGenerateInput = {
  prompt: string;
  /** The Proxy applies the catalog default, currently 16:9, when this is omitted. */
  aspectRatio?: '16:9' | '9:16';
  /** The Proxy applies the catalog default, currently 4 seconds, when this is omitted. */
  durationSeconds?: 4 | 6 | 8;
};

export type TakuAgentOperationInputMap = {
  [TAKU_AGENT_EXECUTE_OPERATION]: TakuAgentExecuteInput;
  [TAKU_AGENT_REPORT_OPERATION]: TakuAgentGenerateReportInput;
  [TAKU_AGENT_IMAGE_OPERATION]: TakuAgentImageGenerateInput;
  [TAKU_AGENT_VIDEO_OPERATION]: TakuAgentVideoGenerateInput;
};

export type TakuAgentStartInputFor<K extends TakuAgentOperationId> = {
  operation: K;
  operationRevision?: 1;
  expectedRecoveryScope: string;
  input: TakuAgentOperationInputMap[K];
  idempotencyKey: string;
};

export type TakuAgentStartInput = {
  [K in TakuAgentOperationId]: TakuAgentStartInputFor<K>;
}[TakuAgentOperationId];

export type TakuAgentReportResult = {
  kind: 'report';
  title: string;
} & (
  | { markdown: string; contentRef?: never }
  | { markdown?: never; contentRef: TakuAgentContentRef }
);

export type TakuAgentExecuteResult = {
  kind: 'text' | 'markdown' | 'json';
  warnings?: TakuAgentOutputWarning[];
} & (
  | { content: string; contentRef?: never }
  | { content?: never; contentRef: TakuAgentContentRef }
);

export type TakuAgentOutputWarning = {
  code: 'output_format_repaired' | 'partial_result';
  message: string;
};

export type TakuAgentMediaAsset = {
  /** Opaque application-owned identity; resolve only through asset.open. */
  assetRef: string;
  kind: 'image' | 'video' | 'audio' | 'document' | 'model' | 'other';
  sha256?: string;
  contentType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type TakuAgentImageResult = {
  kind: 'images';
  assets: TakuAgentMediaAsset[];
  warnings?: TakuAgentOutputWarning[];
};

export type TakuAgentVideoResult = {
  kind: 'videos';
  assets: TakuAgentMediaAsset[];
  warnings?: TakuAgentOutputWarning[];
};

export type TakuAgentRunOutput =
  | TakuAgentReportResult
  | TakuAgentExecuteResult
  | TakuAgentImageResult
  | TakuAgentVideoResult;

export type TakuAgentOperationOutputMap = {
  [TAKU_AGENT_EXECUTE_OPERATION]: TakuAgentExecuteResult;
  [TAKU_AGENT_REPORT_OPERATION]: TakuAgentReportResult;
  [TAKU_AGENT_IMAGE_OPERATION]: TakuAgentImageResult;
  [TAKU_AGENT_VIDEO_OPERATION]: TakuAgentVideoResult;
};

export type TakuAgentRunSnapshot = {
  runId: string;
  operation: TakuAgentOperationId;
  operationRevision: 1;
  state: TakuAgentRunState;
  createdAt: string;
  updatedAt: string;
  result?: TakuAgentRunOutput;
  error?: TakuAgentErrorPayload;
};

export type TakuAgentRunCursor = {
  snapshot: TakuAgentRunSnapshot;
  lastSequence: number;
};

export type TakuAgentResult = TakuAgentRunCursor & {
  result: TakuAgentRunOutput;
};

export type TakuAgentResultFor<K extends TakuAgentOperationId> = Omit<TakuAgentResult, 'result'> & {
  result: TakuAgentOperationOutputMap[K];
};

export type TakuAgentKnownEvent =
  | { type: 'run.state'; status: TakuAgentRunState }
  | { type: 'output.delta'; delta: string }
  | { type: 'run.result'; result: TakuAgentRunOutput }
  | { type: 'run.error'; error: TakuAgentErrorPayload };

export type TakuAgentUnknownEvent = {
  type: 'unknown';
  originalType: string;
};

export type TakuAgentEventPayload = TakuAgentKnownEvent | TakuAgentUnknownEvent;

export type TakuAgentHelloMessage = {
  __taku: true;
  type: typeof TAKU_AGENT_MESSAGE_TYPES.hello;
  protocol: typeof TAKU_AGENT_PROTOCOL;
  requestId: string;
  clientNonce: string;
  sdkVersion: typeof TAKU_AGENT_SDK_VERSION;
  clientFeatures?: TakuAgentClientFeature[];
};

export type TakuAgentHostAttestation = {
  runtimeInstanceId: string;
  sessionId: string;
  proofExpiresAt: number;
  sessionExpiresAt: number;
  proof: string;
};

export type TakuAgentHostAttestationPayload = {
  protocol: typeof TAKU_AGENT_PROTOCOL;
  requestId: string;
  clientNonce: string;
  frameEpoch: string;
  runtimeInstanceId: string;
  sessionId: string;
  capabilitiesDigest: string;
  proofExpiresAt: number;
  sessionExpiresAt: number;
};

export type TakuAgentHostAttestationVerification = TakuAgentHostAttestationPayload & {
  proof: string;
};

export type TakuAgentHostSessionMaterial = {
  verified: true;
  sessionId: string;
  sessionExpiresAt: number;
  c2hKey: string;
  h2cKey: string;
};

export type TakuAgentHelloResultMessage = {
  __taku: true;
  type: typeof TAKU_AGENT_MESSAGE_TYPES.helloResult;
  protocol: typeof TAKU_AGENT_PROTOCOL;
  requestId: string;
  frameEpoch: string;
  ok: true;
  capabilities: TakuAgentCapabilities;
  capabilitiesDigest: string;
  attestation: TakuAgentHostAttestation;
};

export type TakuAgentHelloFailureMessage = {
  __taku: true;
  type: typeof TAKU_AGENT_MESSAGE_TYPES.helloResult;
  protocol: typeof TAKU_AGENT_PROTOCOL;
  requestId: string;
  frameEpoch?: string;
  ok: false;
  error: TakuAgentErrorPayload;
};

export type TakuAgentRequestMessage = {
  __taku: true;
  type: typeof TAKU_AGENT_MESSAGE_TYPES.request;
  protocol: typeof TAKU_AGENT_PROTOCOL;
  frameEpoch: string;
  requestId: string;
  method: TakuAgentMethod;
  params: Record<string, unknown>;
};

export type TakuAgentSessionConfirmMessage = {
  __taku: true;
  protocol: typeof TAKU_AGENT_PROTOCOL;
  type: typeof TAKU_AGENT_MESSAGE_TYPES.sessionConfirm;
  requestId: string;
  frameEpoch: string;
};

export type TakuAgentSessionReadyMessage = {
  __taku: true;
  protocol: typeof TAKU_AGENT_PROTOCOL;
  type: typeof TAKU_AGENT_MESSAGE_TYPES.sessionReady;
  requestId: string;
  frameEpoch: string;
  sessionExpiresAt: number;
};

export type TakuAgentSecureEnvelope = {
  __taku: true;
  protocol: typeof TAKU_AGENT_PROTOCOL;
  type: typeof TAKU_AGENT_MESSAGE_TYPES.secure;
  sessionId: string;
  direction: TakuAgentSecureDirection;
  lane: TakuAgentSecureLane;
  sequence: string;
  body: string;
  mac: string;
};

export type TakuAgentSuccessResponseMessage = {
  __taku: true;
  type: typeof TAKU_AGENT_MESSAGE_TYPES.response;
  protocol: typeof TAKU_AGENT_PROTOCOL;
  frameEpoch: string;
  requestId: string;
  ok: true;
  result: unknown;
};

export type TakuAgentFailureResponseMessage = {
  __taku: true;
  type: typeof TAKU_AGENT_MESSAGE_TYPES.response;
  protocol: typeof TAKU_AGENT_PROTOCOL;
  frameEpoch: string;
  requestId: string;
  ok: false;
  error: TakuAgentErrorPayload;
};

export type TakuAgentResponseMessage =
  | TakuAgentSuccessResponseMessage
  | TakuAgentFailureResponseMessage;

export type TakuAgentStoredEvent = {
  runId: string;
  sequence: number;
  occurredAt: string;
  event: TakuAgentEventPayload;
};

export type TakuAgentEventMessage = TakuAgentStoredEvent & {
  __taku: true;
  type: typeof TAKU_AGENT_MESSAGE_TYPES.event;
  protocol: typeof TAKU_AGENT_PROTOCOL;
  frameEpoch: string;
  subscriptionId: string;
};

export type TakuAgentSubscribeResult = {
  subscriptionId: string;
  snapshot: TakuAgentRunSnapshot;
  lastSequence: number;
  oldestRetainedSequence: number;
  replayedEvents: TakuAgentStoredEvent[];
};

export type TakuAgentUnsubscribeResult = {
  unsubscribed: true;
};

export type TakuAgentContentReadParams = {
  runId: string;
  contentId: string;
  offset: number;
  length: number;
};

export type TakuAgentClientMessage = TakuAgentHelloMessage | TakuAgentSecureEnvelope;
export type TakuAgentHostMessage = TakuAgentHelloResultMessage | TakuAgentHelloFailureMessage;

export type TakuAgentSecureClientBody = TakuAgentSessionConfirmMessage | TakuAgentRequestMessage;
export type TakuAgentSecureHostBody =
  | TakuAgentSessionReadyMessage
  | TakuAgentResponseMessage
  | TakuAgentEventMessage;
