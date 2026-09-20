import {
  decodeTakuAgentBase64Url,
  isTakuAgentClientNonce,
  parseTakuAgentAssetOpenResult,
  parseTakuAgentCapabilities,
  parseTakuAgentContentReadResult,
  parseTakuAgentContentRef,
  parseTakuAgentHostMessage,
  parseTakuAgentResult,
  parseTakuAgentRunCursor,
  parseTakuAgentSecureEnvelope,
  parseTakuAgentSecureHostBody,
  parseTakuAgentSubscribeResult,
  parseTakuAgentUnsubscribeResult,
  validateRunId,
  validateTakuAgentRecoveryScope,
  validateTakuAgentStartInput,
} from './contract';
import {
  computeTakuAgentCapabilitiesDigest,
  createTakuAgentSecureClientEnvelope,
  type TakuAgentSessionAuthenticator,
} from './crypto';
import {
  TAKU_AGENT_CLIENT_FEATURES,
  TAKU_AGENT_CONTENT_PAGE_MAX_BYTES,
  TAKU_AGENT_FIELD_LIMITS,
  TAKU_AGENT_MESSAGE_TYPES,
  TAKU_AGENT_PROTOCOL,
  TAKU_AGENT_SDK_VERSION,
  type TakuAgentAssetOpenResult,
  type TakuAgentCapabilities,
  type TakuAgentClientErrorCode,
  type TakuAgentClientMessage,
  type TakuAgentContentReadResult,
  type TakuAgentContentRef,
  type TakuAgentErrorPayload,
  type TakuAgentEventMessage,
  type TakuAgentHelloMessage,
  type TakuAgentHelloResultMessage,
  type TakuAgentHostAttestationVerification,
  type TakuAgentMethod,
  type TakuAgentOperationId,
  type TakuAgentRequestMessage,
  type TakuAgentResponseMessage,
  type TakuAgentResult,
  type TakuAgentResultFor,
  type TakuAgentRunCursor,
  type TakuAgentSecureEnvelope,
  type TakuAgentSessionConfirmMessage,
  type TakuAgentStartInput,
  type TakuAgentSubscribeResult,
} from './types';

const DEFAULT_TIMEOUT_MS = 10_000;
// Starting a run can require a person to read and answer the Host consent dialog.
// This is a bounded RPC wait, not the run's execution or cancellation deadline.
const DEFAULT_START_TIMEOUT_MS = 120_000;
const DEFAULT_HOST_ATTESTATION_TIMEOUT_MS = 3_000;
const HELLO_RETRY_DELAYS_MS = [0, 100, 300, 700, 1_500] as const;
// A request may have reached Host even when its local caller times out or aborts.
// Keep a bounded response identity set for the lifetime of the authenticated
// session so a valid late response cannot be mistaken for a forged response.
const MAX_RESPONSE_TOMBSTONES = 32;
// These are hard SDK ceilings matching the frozen Host contract. A Host may
// advertise smaller limits, which the SDK also honors, but never larger ones.
const MAX_REPLAY_EVENTS = 256;
const MAX_EVENT_BYTES = 32_768;
const MAX_SECURE_REQUEST_OVERHEAD_BYTES = 4_096;
const TAKU_AGENT_ERROR_BRAND = Symbol.for('taku.agent.run/v2:client-error');

export type TakuAgentTransportEvent = {
  data: unknown;
  origin: string;
};

export interface TakuAgentMessageTransport {
  readonly available: boolean;
  post(message: TakuAgentClientMessage): void;
  listen(listener: (event: TakuAgentTransportEvent) => void): () => void;
  verifyHostAttestation(
    input: TakuAgentHostAttestationVerification,
    signal: AbortSignal
  ): Promise<TakuAgentSessionAuthenticator | null>;
  bindHostOrigin?(origin: string | null): void;
}

export type TakuAgentRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type TakuAgentAssetOpenOptions = TakuAgentRequestOptions & {
  /** Stop before sending if a re-handshake has changed the original asset's scope. */
  expectedRecoveryScope?: string;
};

export type TakuAgentClientOptions = {
  requestIdFactory?: () => string;
  clientNonceFactory?: () => string;
  helloRetryDelaysMs?: readonly number[];
  helloResponseGraceMs?: number;
  hostAttestationTimeoutMs?: number;
};

export type TakuAgentSubscribeOptions = TakuAgentRequestOptions & {
  afterSequence?: number;
  onError?: (error: TakuAgentError) => void;
};

export type TakuAgentContentReadOptions = TakuAgentRequestOptions & {
  /** Decoded bytes requested from Host per page. */
  pageSize?: number;
};

export type TakuAgentContentPage = TakuAgentContentReadResult & {
  bytes: Uint8Array;
};

export type TakuAgentSubscription = {
  snapshot: TakuAgentSubscribeResult['snapshot'];
  oldestRetainedSequence: number;
  getLastSequence: () => number;
  unsubscribe: (options?: TakuAgentRequestOptions) => Promise<void>;
};

type PendingRequest = {
  frameEpoch?: string;
  hostOrigin?: string;
  secureSequence?: string;
  method: TakuAgentMethod;
  params: Record<string, unknown>;
  parseResult: (value: unknown) => unknown | null;
  responseContext?: RequestResponseContext;
  expectedRecoveryScope?: string;
  resolve: (result: unknown) => void;
  reject: (error: TakuAgentError) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener: () => void;
};

type RequestResponseContext = {
  frameEpoch?: string;
  hostOrigin?: string;
};

type RequestDeadline = {
  expiresAt: number;
  signal?: AbortSignal;
};

type ActiveSubscription = {
  subscriptionId: string;
  runId: string;
  lastSequence: number;
  muted: boolean;
  listener: (event: TakuAgentEventMessage) => void;
  onError?: (error: TakuAgentError) => void;
};

type ResponseTombstone = {
  kind: 'pending' | 'cleanup';
  sessionId: string;
  handshakeGeneration: number;
  frameEpoch: string;
  hostOrigin: string;
  secureSequence: string;
  sessionExpiresAt: number;
  method: TakuAgentMethod;
  params: Record<string, unknown>;
  parseResult: (value: unknown) => unknown | null;
};

type PendingHostVerification = {
  generation: number;
  requestId: string;
  abortController: AbortController;
  timer: ReturnType<typeof setTimeout>;
};

type PendingSecureSession = {
  generation: number;
  authenticator: TakuAgentSessionAuthenticator;
  frameEpoch: string;
  hostOrigin: string;
  capabilities: TakuAgentCapabilities;
  confirmRequestId: string;
  confirmSent: boolean;
  ready: boolean;
  nextClientRpcSequence: number;
  expiryTimer: ReturnType<typeof setTimeout> | null;
};

export class TakuAgentError extends Error {
  readonly code: TakuAgentClientErrorCode;
  readonly detail?: string;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;

  constructor(input: {
    code: TakuAgentClientErrorCode;
    message: string;
    detail?: string;
    retryable?: boolean;
    retryAfterMs?: number;
  }) {
    super(input.message);
    this.name = 'TakuAgentError';
    this.code = input.code;
    this.detail = input.detail;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
    Object.defineProperty(this, TAKU_AGENT_ERROR_BRAND, { value: true });
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return value instanceof Error && Reflect.get(value, TAKU_AGENT_ERROR_BRAND) === true;
  }
}

export class TakuAgentClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscriptions = new Map<string, ActiveSubscription>();
  private readonly subscribedRuns = new Set<string>();
  private readonly pendingSubscriptionRuns = new Set<string>();
  private readonly pendingSubscriptionErrors = new Map<string, TakuAgentError>();
  private readonly preAckEvents: TakuAgentEventMessage[] = [];
  private readonly stopListening: () => void;
  private readonly responseTombstones = new Map<string, ResponseTombstone>();
  private listenerStopped = false;
  private frameEpoch: string | null = null;
  private capabilitiesValue: TakuAgentCapabilities | null = null;
  private hostOrigin: string | null = null;
  private helloRequestId: string | null = null;
  private helloClientNonce: string | null = null;
  private helloTimers: Array<ReturnType<typeof setTimeout>> = [];
  private hostVerification: PendingHostVerification | null = null;
  private secureSession: PendingSecureSession | null = null;
  private handshakeGeneration = 0;
  private outboundQueue: Promise<void> = Promise.resolve();
  private inboundQueue: Promise<void> = Promise.resolve();
  private bestEffortCleanupCount = 0;
  private closed = false;
  private readonly requestIdFactory: () => string;
  private readonly clientNonceFactory: () => string;
  private readonly helloRetryDelaysMs: readonly number[];
  private readonly helloResponseGraceMs: number;
  private readonly hostAttestationTimeoutMs: number;

  constructor(
    private readonly transport: TakuAgentMessageTransport,
    options: TakuAgentClientOptions = {}
  ) {
    this.requestIdFactory = options.requestIdFactory ?? createRequestId;
    this.clientNonceFactory = options.clientNonceFactory ?? createClientNonce;
    this.helloRetryDelaysMs = options.helloRetryDelaysMs ?? HELLO_RETRY_DELAYS_MS;
    this.helloResponseGraceMs = options.helloResponseGraceMs ?? 2_000;
    this.hostAttestationTimeoutMs =
      options.hostAttestationTimeoutMs ?? DEFAULT_HOST_ATTESTATION_TIMEOUT_MS;
    if (
      !Number.isFinite(this.hostAttestationTimeoutMs) ||
      this.hostAttestationTimeoutMs <= 0 ||
      this.hostAttestationTimeoutMs > 15_000
    ) {
      throw new TypeError('hostAttestationTimeoutMs must be between 1 and 15000');
    }
    this.stopListening = transport.listen((event) => this.handleHostEvent(event));
    this.beginHello();
  }

  async capabilities(options?: TakuAgentRequestOptions): Promise<TakuAgentCapabilities> {
    return this.refreshCapabilities(options);
  }

  async start(
    input: TakuAgentStartInput,
    options?: TakuAgentRequestOptions
  ): Promise<TakuAgentRunCursor> {
    const validated = validateTakuAgentStartInput(input);
    const cursor = await this.requestWithCapabilityRefresh(
      'agent.start',
      validated as unknown as Record<string, unknown>,
      parseTakuAgentRunCursor,
      { ...options, timeoutMs: options?.timeoutMs ?? DEFAULT_START_TIMEOUT_MS }
    );
    this.assertOutputDeliverySupported(cursor.snapshot.result);
    return cursor;
  }

  async get(runId: string, options?: TakuAgentRequestOptions): Promise<TakuAgentRunCursor> {
    const cursor = await this.requestWithCapabilityRefresh(
      'agent.get',
      { runId: validateRunId(runId) },
      parseTakuAgentRunCursor,
      options
    );
    this.assertOutputDeliverySupported(cursor.snapshot.result);
    return cursor;
  }

  async cancel(runId: string, options?: TakuAgentRequestOptions): Promise<TakuAgentRunCursor> {
    const cursor = await this.requestWithCapabilityRefresh(
      'agent.cancel',
      { runId: validateRunId(runId) },
      parseTakuAgentRunCursor,
      options
    );
    this.assertOutputDeliverySupported(cursor.snapshot.result);
    return cursor;
  }

  async result(runId: string, options?: TakuAgentRequestOptions): Promise<TakuAgentResult> {
    const result = await this.requestWithCapabilityRefresh(
      'agent.result',
      { runId: validateRunId(runId) },
      parseTakuAgentResult,
      options
    );
    this.assertOutputDeliverySupported(result.result);
    return result;
  }

  async resultFor<K extends TakuAgentOperationId>(
    runId: string,
    operation: K,
    options?: TakuAgentRequestOptions
  ): Promise<TakuAgentResultFor<K>> {
    const result = await this.result(runId, options);
    if (
      result.snapshot.operation !== operation ||
      !outputMatchesOperation(result.result, operation)
    ) {
      throw invalidResponse(`agent.result returned a different operation than ${operation}`);
    }
    return result as TakuAgentResultFor<K>;
  }

  /**
   * Mint a short-lived, frame-bound playback grant for one Host-managed asset.
   * The returned URL is intentionally not cached; call openAsset again after expiry.
   */
  async openAsset(
    assetRefInput: string,
    options?: TakuAgentAssetOpenOptions
  ): Promise<TakuAgentAssetOpenResult> {
    const assetRef =
      typeof assetRefInput === 'string' &&
      assetRefInput.length <= TAKU_AGENT_FIELD_LIMITS.assetRef &&
      /^asset_[A-Za-z0-9_-]{1,128}$/.test(assetRefInput)
        ? assetRefInput
        : null;
    if (!assetRef) throw new TypeError('assetRef is invalid');
    const expectedRecoveryScope =
      options?.expectedRecoveryScope === undefined
        ? undefined
        : validateTakuAgentRecoveryScope(options.expectedRecoveryScope);
    const opened = await this.requestWithCapabilityRefresh(
      'asset.open',
      { assetRef },
      parseTakuAgentAssetOpenResult,
      options,
      undefined,
      expectedRecoveryScope
    );
    if (
      expectedRecoveryScope !== undefined &&
      expectedRecoveryScope !== this.capabilitiesValue?.recoveryScope
    ) {
      throw localError('account_changed', 'The authenticated asset recovery scope changed', false);
    }
    if (Date.parse(opened.expiresAt) <= Date.now()) {
      throw invalidResponse('asset.open returned an expired playback grant');
    }
    return opened;
  }

  /**
   * Read one Host-owned text result without materializing the complete value in memory.
   * Every yielded page is authenticated and checked against the opaque contentRef.
   */
  async *readContent(
    runIdInput: string,
    contentRefInput: TakuAgentContentRef,
    options: TakuAgentContentReadOptions = {}
  ): AsyncGenerator<TakuAgentContentPage, void, void> {
    const runId = validateRunId(runIdInput);
    const contentRef = parseTakuAgentContentRef(contentRefInput);
    if (!contentRef) throw new TypeError('contentRef is invalid');
    const pageSize = options.pageSize ?? TAKU_AGENT_CONTENT_PAGE_MAX_BYTES;
    if (
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > TAKU_AGENT_CONTENT_PAGE_MAX_BYTES
    ) {
      throw new TypeError(`pageSize must be between 1 and ${TAKU_AGENT_CONTENT_PAGE_MAX_BYTES}`);
    }
    if (Date.parse(contentRef.expiresAt) <= Date.now()) {
      throw hostError({
        code: 'content_not_found',
        message: 'The requested Runtime content is missing or expired',
        retryable: false,
      });
    }
    let offset = 0;
    do {
      if (options.signal?.aborted) throw requestAborted();
      const page = await this.requestWithCapabilityRefresh(
        'content.read',
        {
          runId,
          contentId: contentRef.contentId,
          offset,
          length: pageSize,
        },
        parseTakuAgentContentReadResult,
        options
      );
      if (
        page.contentId !== contentRef.contentId ||
        page.offset !== offset ||
        page.sha256 !== contentRef.sha256 ||
        page.nextOffset > contentRef.byteLength ||
        page.eof !== (page.nextOffset === contentRef.byteLength) ||
        (!page.eof && page.nextOffset <= offset)
      ) {
        throw invalidResponse('content.read returned an inconsistent page');
      }
      const bytes = decodeTakuAgentBase64Url(page.chunk);
      yield { ...page, bytes };
      offset = page.nextOffset;
    } while (offset < contentRef.byteLength);
  }

  /** UTF-8 streaming view over readContent; safe when a page splits a code point. */
  async *readContentText(
    runId: string,
    contentRef: TakuAgentContentRef,
    options: TakuAgentContentReadOptions = {}
  ): AsyncGenerator<string, void, void> {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for await (const page of this.readContent(runId, contentRef, options)) {
      const text = decoder.decode(page.bytes, { stream: !page.eof });
      if (text) yield text;
    }
  }

  async subscribe(
    runIdInput: string,
    listener: (event: TakuAgentEventMessage) => void,
    options: TakuAgentSubscribeOptions = {}
  ): Promise<TakuAgentSubscription> {
    const runId = validateRunId(runIdInput);
    if (typeof listener !== 'function') throw new TypeError('subscribe listener is required');
    if (this.subscribedRuns.has(runId)) {
      throw localError(
        'sdk_already_subscribed',
        `A subscription already exists for run ${runId}`,
        false
      );
    }
    const afterSequence = options.afterSequence ?? 0;
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new TypeError('afterSequence must be a non-negative safe integer');
    }
    this.subscribedRuns.add(runId);
    this.pendingSubscriptionRuns.add(runId);

    let result: TakuAgentSubscribeResult | null = null;
    let state: ActiveSubscription | null = null;
    const responseContext: RequestResponseContext = {};
    try {
      result = await this.requestWithCapabilityRefresh(
        'agent.subscribe',
        { runId, afterSequence },
        parseTakuAgentSubscribeResult,
        options,
        responseContext
      );
      this.assertOutputDeliverySupported(result.snapshot.result);
      for (const event of result.replayedEvents) {
        if (event.event.type === 'run.result') {
          this.assertOutputDeliverySupported(event.event.result);
        }
      }
      const pendingSafetyError = this.pendingSubscriptionErrors.get(runId);
      if (pendingSafetyError) throw pendingSafetyError;
      const installError = this.getSubscriptionInstallError(runId, responseContext.frameEpoch);
      if (installError) throw installError;
      this.validateSubscriptionReplay(result, runId, afterSequence);
      const postValidationError = this.getSubscriptionInstallError(
        runId,
        responseContext.frameEpoch
      );
      if (postValidationError) throw postValidationError;

      state = {
        subscriptionId: result.subscriptionId,
        runId,
        lastSequence: afterSequence,
        muted: false,
        listener,
        onError: options.onError,
      };
      const installedResult = result;
      const installedState = state;
      this.subscriptions.set(installedResult.subscriptionId, installedState);
      this.pendingSubscriptionRuns.delete(runId);
      this.pendingSubscriptionErrors.delete(runId);
      const buffered = this.preAckEvents
        .filter((event) => event.subscriptionId === installedResult.subscriptionId)
        .sort((left, right) => left.sequence - right.sequence);
      this.dropPreAckEventsForRun(runId);

      for (const event of installedResult.replayedEvents) {
        const deliveryError = this.getSubscriptionDeliveryError(
          installedState,
          responseContext.frameEpoch
        );
        if (deliveryError) throw deliveryError;
        this.handleRuntimeEvent({
          ...event,
          __taku: true,
          type: TAKU_AGENT_MESSAGE_TYPES.event,
          protocol: TAKU_AGENT_PROTOCOL,
          frameEpoch: responseContext.frameEpoch as string,
          subscriptionId: installedResult.subscriptionId,
        });
      }
      for (const event of buffered) {
        const deliveryError = this.getSubscriptionDeliveryError(
          installedState,
          responseContext.frameEpoch
        );
        if (deliveryError) throw deliveryError;
        this.handleRuntimeEvent(event);
      }
      const deliveryError = this.getSubscriptionDeliveryError(
        installedState,
        responseContext.frameEpoch
      );
      if (deliveryError) throw deliveryError;

      let remotelyUnsubscribed = false;
      let unsubscribeInFlight: Promise<void> | null = null;
      return {
        snapshot: installedResult.snapshot,
        oldestRetainedSequence: installedResult.oldestRetainedSequence,
        getLastSequence: () => installedState.lastSequence,
        unsubscribe: (unsubscribeOptions) => {
          if (remotelyUnsubscribed) return Promise.resolve();
          // Mute immediately but reserve this run until Host confirms cleanup,
          // so retries cannot accumulate parallel Host subscriptions.
          installedState.muted = true;
          if (unsubscribeInFlight) return unsubscribeInFlight;
          if (this.closed) return Promise.resolve();

          let attempt: Promise<void>;
          attempt = this.request(
            'agent.unsubscribe',
            { subscriptionId: installedResult.subscriptionId, runId },
            parseTakuAgentUnsubscribeResult,
            unsubscribeOptions
          )
            .then(() => {
              remotelyUnsubscribed = true;
              this.subscribedRuns.delete(runId);
              if (this.subscriptions.get(installedResult.subscriptionId) === installedState) {
                this.subscriptions.delete(installedResult.subscriptionId);
              }
            })
            .finally(() => {
              if (unsubscribeInFlight === attempt) unsubscribeInFlight = null;
            });
          unsubscribeInFlight = attempt;
          return attempt;
        },
      };
    } catch (error) {
      if (state && result && this.subscriptions.get(result.subscriptionId) === state) {
        this.subscriptions.delete(result.subscriptionId);
      }
      this.subscribedRuns.delete(runId);
      this.pendingSubscriptionRuns.delete(runId);
      this.pendingSubscriptionErrors.delete(runId);
      this.dropPreAckEventsForRun(runId);
      if (result) {
        this.postUnsubscribeBestEffort(
          result.subscriptionId,
          runId,
          responseContext.frameEpoch,
          responseContext.hostOrigin
        );
      }
      throw error;
    } finally {
      this.finishClosedCleanupIfIdle();
    }
  }

  close(): void {
    if (this.closed) return;
    for (const subscription of this.subscriptions.values()) {
      this.postUnsubscribeBestEffort(subscription.subscriptionId, subscription.runId);
    }
    this.closed = true;
    this.handshakeGeneration += 1;
    this.clearHelloTimers();
    this.clearHostVerification();
    this.rejectAll(localError('sdk_closed', 'Taku Agent client is closed', false));
    this.notifyAndClearSubscriptions(
      localError('sdk_closed', 'Taku Agent client is closed', false)
    );
    this.capabilitiesValue = null;
    this.preAckEvents.length = 0;
    // Pending subscribe responses keep the listener/origin alive for the
    // authenticated session lifetime, allowing precise late-result cleanup.
    this.finishClosedCleanupIfIdle();
  }

  private request<T>(
    method: TakuAgentMethod,
    params: Record<string, unknown>,
    parseResult: (value: unknown) => T | null,
    options: TakuAgentRequestOptions = {},
    responseContext?: RequestResponseContext,
    expectedRecoveryScope?: string
  ): Promise<T> {
    const preflightError = this.requestPreflight(options);
    if (preflightError) return Promise.reject(preflightError);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
      return Promise.reject(new TypeError('timeoutMs must be between 1 and 120000'));
    }

    return new Promise<T>((resolve, reject) => {
      const requestId = this.nextRequestId();
      const onAbort = () => this.rejectPending(requestId, requestAborted());
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const pending: PendingRequest = {
        method,
        params,
        parseResult,
        responseContext,
        expectedRecoveryScope,
        resolve: (value) => {
          const parsed = parseResult(value);
          if (parsed === null) {
            reject(invalidResponse(`${method} returned an invalid result`));
            return;
          }
          resolve(parsed);
        },
        reject,
        timer: setTimeout(() => {
          this.rejectPending(
            requestId,
            localError('sdk_timeout', `Taku Agent request timed out: ${method}`, true)
          );
        }, timeoutMs),
        removeAbortListener: () => options.signal?.removeEventListener('abort', onAbort),
      };
      this.pending.set(requestId, pending);
      if (this.frameEpoch && this.secureSession?.ready) {
        this.postPending(requestId, pending, this.frameEpoch);
      } else {
        this.beginHello();
      }
    });
  }

  private requestPreflight(options: TakuAgentRequestOptions): TakuAgentError | null {
    if (this.closed) return localError('sdk_closed', 'Taku Agent client is closed', false);
    if (!this.transport.available) {
      return localError(
        'sdk_unsupported',
        `This app is not running inside a Taku Host with ${TAKU_AGENT_PROTOCOL} support`,
        false
      );
    }
    if (this.secureSession && Date.now() >= this.secureSession.authenticator.sessionExpiresAt) {
      this.failSecureSession(
        localError('sdk_host_untrusted', 'The authenticated Taku Host session expired', true)
      );
    }
    if (options.signal?.aborted) return requestAborted();
    return null;
  }

  private postPending(requestId: string, pending: PendingRequest, frameEpoch: string): void {
    if (pending.secureSequence) return;
    const session = this.secureSession;
    if (!session?.ready || session.frameEpoch !== frameEpoch) return;
    this.outboundQueue = this.outboundQueue
      .then(() => this.signAndPostPending(requestId, pending, session))
      .catch(() => {
        // signAndPostPending owns the fail-closed user-visible error path.
      });
  }

  private async signAndPostPending(
    requestId: string,
    pending: PendingRequest,
    session: PendingSecureSession
  ): Promise<void> {
    if (
      this.closed ||
      this.secureSession !== session ||
      !session.ready ||
      this.frameEpoch !== session.frameEpoch ||
      this.pending.get(requestId) !== pending ||
      pending.secureSequence
    ) {
      return;
    }
    if (Date.now() >= session.authenticator.sessionExpiresAt) {
      this.failSecureSession(
        localError('sdk_host_untrusted', 'The authenticated Taku Host session expired', true)
      );
      return;
    }
    const capabilityError = this.getCapabilityError(pending.method, pending.params);
    if (capabilityError) {
      this.rejectPending(requestId, capabilityError);
      return;
    }
    if (
      pending.expectedRecoveryScope !== undefined &&
      pending.expectedRecoveryScope !== this.capabilitiesValue?.recoveryScope
    ) {
      this.rejectPending(
        requestId,
        localError('account_changed', 'The authenticated asset recovery scope changed', false)
      );
      return;
    }
    const body = JSON.stringify({
      __taku: true,
      protocol: TAKU_AGENT_PROTOCOL,
      type: TAKU_AGENT_MESSAGE_TYPES.request,
      requestId,
      frameEpoch: session.frameEpoch,
      method: pending.method,
      params: pending.params,
    } satisfies TakuAgentRequestMessage);
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    const bodyLimit = Math.min(
      64 * 1_024,
      session.capabilities.limits.maxInputBytes + MAX_SECURE_REQUEST_OVERHEAD_BYTES
    );
    if (bodyBytes > bodyLimit) {
      this.rejectPending(
        requestId,
        localError(
          'sdk_limit_exceeded',
          `Taku Agent request is ${bodyBytes} UTF-8 JSON bytes; the SDK limit is ${bodyLimit}`,
          false
        )
      );
      return;
    }
    const sequence = String(session.nextClientRpcSequence);
    session.nextClientRpcSequence += 1;
    let envelope: TakuAgentSecureEnvelope;
    try {
      envelope = await createTakuAgentSecureClientEnvelope({
        authenticator: session.authenticator,
        lane: 'rpc',
        sequence,
        body,
      });
    } catch {
      this.failSecureSession(
        localError('sdk_host_untrusted', 'Taku Agent message authentication failed', true)
      );
      return;
    }
    if (
      this.secureSession !== session ||
      !session.ready ||
      this.pending.get(requestId) !== pending
    ) {
      if (this.secureSession === session) {
        this.failSecureSession(
          localError(
            'sdk_host_untrusted',
            'Taku Agent request ordering could not be preserved',
            true
          )
        );
      }
      return;
    }
    if (
      pending.expectedRecoveryScope !== undefined &&
      pending.expectedRecoveryScope !== this.capabilitiesValue?.recoveryScope
    ) {
      // Signing is asynchronous and already reserved a strict sequence. Invalidate
      // this changed-account session rather than leaving a hole in its RPC lane.
      this.failSecureSession(
        localError('account_changed', 'The authenticated asset recovery scope changed', false)
      );
      return;
    }
    pending.frameEpoch = session.frameEpoch;
    pending.hostOrigin = session.hostOrigin;
    pending.secureSequence = sequence;
    try {
      this.transport.post(envelope);
    } catch (error) {
      this.failSecureSession(
        localError(
          'sdk_transport_failed',
          error instanceof Error ? error.message : 'Taku Agent Host is unavailable',
          true
        )
      );
    }
  }

  private getCapabilityError(
    method: TakuAgentMethod,
    params: Record<string, unknown>
  ): TakuAgentError | null {
    const capabilities = this.capabilitiesValue;
    if (!capabilities || method === 'runtime.capabilities') return null;
    if (method === 'content.read' && !capabilities.features?.includes('content-ref-v1')) {
      return localError('sdk_unsupported', 'The Taku Host did not negotiate content-ref-v1', false);
    }
    if (method === 'asset.open' && !capabilities.features?.includes('asset-open-v1')) {
      return localError('sdk_unsupported', 'The Taku Host did not negotiate asset-open-v1', false);
    }
    if (!capabilities.methods.includes(method)) {
      return hostError({
        code: 'capability_not_granted',
        message: `The Taku Host did not grant ${method}`,
        retryable: false,
      });
    }
    if (method === 'agent.start') {
      if (params.expectedRecoveryScope !== capabilities.recoveryScope) {
        return hostError({
          code: 'account_changed',
          message: 'The authenticated Taku Host recovery scope changed',
          retryable: false,
        });
      }
      const granted = capabilities.operations.some(
        (operation) =>
          operation.id === params.operation && operation.revision === params.operationRevision
      );
      if (!granted) {
        return hostError({
          code: 'capability_not_granted',
          message: `${String(params.operation)} revision ${String(params.operationRevision)} is not granted`,
          retryable: false,
        });
      }
    }
    return null;
  }

  private async requestWithCapabilityRefresh<T>(
    method: TakuAgentMethod,
    params: Record<string, unknown>,
    parseResult: (value: unknown) => T | null,
    options: TakuAgentRequestOptions = {},
    responseContext?: RequestResponseContext,
    expectedRecoveryScope?: string
  ): Promise<T> {
    const deadline = createRequestDeadline(options);
    if (this.frameEpoch && this.getCapabilityError(method, params)) {
      await this.refreshCapabilities(requestOptionsWithinDeadline(deadline, method));
      const refreshedError = this.getCapabilityError(method, params);
      if (refreshedError) throw refreshedError;
    }
    return this.request(
      method,
      params,
      parseResult,
      requestOptionsWithinDeadline(deadline, method),
      responseContext,
      expectedRecoveryScope
    );
  }

  private async refreshCapabilities(
    options: TakuAgentRequestOptions = {}
  ): Promise<TakuAgentCapabilities> {
    const capabilities = await this.request(
      'runtime.capabilities',
      {},
      parseTakuAgentCapabilities,
      options
    );
    this.capabilitiesValue = cloneCapabilities(capabilities);
    return cloneCapabilities(capabilities);
  }

  private beginHello(): void {
    if (
      this.closed ||
      !this.transport.available ||
      this.frameEpoch ||
      this.secureSession ||
      this.helloRequestId
    ) {
      return;
    }
    const generation = ++this.handshakeGeneration;
    const requestId = this.nextRequestId();
    let clientNonce: string;
    try {
      clientNonce = this.clientNonceFactory();
    } catch {
      this.rejectUntrustedHost();
      return;
    }
    if (!isTakuAgentClientNonce(clientNonce)) {
      this.rejectUntrustedHost();
      return;
    }
    this.helloRequestId = requestId;
    this.helloClientNonce = clientNonce;
    this.clearHelloTimers();
    for (const delay of this.helloRetryDelaysMs) {
      this.helloTimers.push(
        setTimeout(() => {
          if (
            this.closed ||
            this.frameEpoch ||
            this.handshakeGeneration !== generation ||
            this.helloRequestId !== requestId
          ) {
            return;
          }
          try {
            this.transport.post({
              __taku: true,
              type: TAKU_AGENT_MESSAGE_TYPES.hello,
              protocol: TAKU_AGENT_PROTOCOL,
              requestId,
              clientNonce,
              sdkVersion: TAKU_AGENT_SDK_VERSION,
              clientFeatures: [...TAKU_AGENT_CLIENT_FEATURES],
            } satisfies TakuAgentHelloMessage);
          } catch {
            // A pending request owns the user-visible timeout/error boundary.
          }
        }, delay)
      );
    }
    const deadline = this.helloRetryDelaysMs.at(-1) ?? 0;
    this.helloTimers.push(
      setTimeout(() => {
        if (
          this.closed ||
          this.frameEpoch ||
          this.handshakeGeneration !== generation ||
          this.helloRequestId !== requestId
        ) {
          return;
        }
        this.helloRequestId = null;
        this.helloClientNonce = null;
        if (this.pending.size > 0) {
          this.rejectAll(
            hostError({
              code: 'host_unavailable',
              message: 'The Taku Host did not answer the Runtime handshake',
              retryable: true,
            })
          );
        }
      }, deadline + this.helloResponseGraceMs)
    );
  }

  private handleHostEvent({ data, origin }: TakuAgentTransportEvent): void {
    const message = parseTakuAgentHostMessage(data);
    if (message?.type === TAKU_AGENT_MESSAGE_TYPES.helloResult) {
      if (this.closed) return;
      if (!this.helloRequestId) return;
      if (message.requestId !== this.helloRequestId) {
        return;
      }
      if (this.hostOrigin !== null && origin !== this.hostOrigin) return;
      if (this.hostVerification) return;
      this.clearHelloTimers();
      if (!message.ok) {
        this.helloRequestId = null;
        this.helloClientNonce = null;
        const error = hostError(message.error);
        this.rejectAll(error);
        return;
      }
      this.verifyHelloResult(message, origin);
      return;
    }
    if (!message && this.isCurrentHelloSuccessCandidate(data, origin)) {
      this.rejectUntrustedHost();
      return;
    }
    const envelope = parseTakuAgentSecureEnvelope(data);
    if (!envelope) {
      if (this.isCurrentSecureCandidate(data, origin)) this.rejectUntrustedHost();
      return;
    }
    const session = this.secureSession;
    if (
      !session ||
      origin !== session.hostOrigin ||
      envelope.sessionId !== session.authenticator.sessionId
    ) {
      return;
    }
    if (envelope.direction !== 'h2c') {
      this.rejectUntrustedHost();
      return;
    }
    this.inboundQueue = this.inboundQueue
      .then(() => this.processSecureHostEnvelope(envelope, origin, session))
      .catch(() => {
        if (this.secureSession === session) this.rejectUntrustedHost();
      });
  }

  private isCurrentSecureCandidate(value: unknown, origin: string): boolean {
    const session = this.secureSession;
    return (
      session !== null &&
      origin === session.hostOrigin &&
      isRecord(value) &&
      value.__taku === true &&
      value.protocol === TAKU_AGENT_PROTOCOL &&
      value.type === TAKU_AGENT_MESSAGE_TYPES.secure &&
      value.sessionId === session.authenticator.sessionId
    );
  }

  private async processSecureHostEnvelope(
    envelope: TakuAgentSecureEnvelope,
    origin: string,
    session: PendingSecureSession
  ): Promise<void> {
    if (this.secureSession !== session || Date.now() >= session.authenticator.sessionExpiresAt) {
      if (this.secureSession === session) {
        this.failSecureSession(
          localError('sdk_host_untrusted', 'The authenticated Taku Host session expired', true)
        );
      }
      return;
    }
    let verified = false;
    try {
      verified = await session.authenticator.verifyHostMessage(envelope);
    } catch {
      verified = false;
    }
    if (this.secureSession !== session) return;
    if (!verified) {
      this.rejectUntrustedHost();
      return;
    }
    const secureBody = parseTakuAgentSecureHostBody(envelope.body);
    if (!secureBody || secureBody.frameEpoch !== session.frameEpoch) {
      this.rejectUntrustedHost();
      return;
    }
    if (secureBody.type === TAKU_AGENT_MESSAGE_TYPES.sessionReady) {
      if (
        session.ready ||
        !session.confirmSent ||
        envelope.lane !== 'rpc' ||
        envelope.sequence !== '1' ||
        secureBody.requestId !== session.confirmRequestId ||
        secureBody.sessionExpiresAt !== session.authenticator.sessionExpiresAt
      ) {
        this.rejectUntrustedHost();
        return;
      }
      this.bindSecureSession(session);
      return;
    }
    if (!session.ready || this.frameEpoch !== session.frameEpoch || this.hostOrigin !== origin) {
      this.rejectUntrustedHost();
      return;
    }
    if (secureBody.type === TAKU_AGENT_MESSAGE_TYPES.response) {
      if (envelope.lane !== 'rpc') {
        this.rejectUntrustedHost();
        return;
      }
      if (this.handleTombstonedResponse(secureBody, origin, envelope.sequence, session)) return;
      const pending = this.pending.get(secureBody.requestId);
      if (
        !pending ||
        pending.frameEpoch !== secureBody.frameEpoch ||
        pending.secureSequence !== envelope.sequence
      ) {
        this.rejectUntrustedHost();
        return;
      }
      this.pending.delete(secureBody.requestId);
      clearTimeout(pending.timer);
      pending.removeAbortListener();
      if (pending.responseContext) {
        pending.responseContext.frameEpoch = secureBody.frameEpoch;
        pending.responseContext.hostOrigin = origin;
      }
      if (secureBody.ok) {
        const replayLimitError =
          pending.method === 'agent.subscribe' ? this.getReplayLimitError(secureBody.result) : null;
        if (replayLimitError) {
          this.unsubscribeUnsafeSubscribeResult(
            secureBody.result,
            pending,
            secureBody.frameEpoch,
            origin
          );
          pending.reject(replayLimitError);
          return;
        }
        pending.resolve(secureBody.result);
      } else {
        const error = hostError(secureBody.error);
        pending.reject(error);
        if (
          secureBody.error.code === 'stale_frame' ||
          secureBody.error.code === 'account_changed'
        ) {
          this.invalidateHandshake(error);
        }
      }
      return;
    }
    if (envelope.lane !== 'event' || envelope.sequence !== String(secureBody.sequence)) {
      this.rejectUntrustedHost();
      return;
    }
    const rawEventLimitError = this.getRawEventLimitError(secureBody);
    if (rawEventLimitError) {
      this.handleRejectedRawEvent(secureBody, origin, rawEventLimitError);
      return;
    }
    this.handleRuntimeEvent(secureBody);
  }

  private isCurrentHelloSuccessCandidate(value: unknown, origin: string): boolean {
    return (
      this.helloRequestId !== null &&
      (this.hostOrigin === null || origin === this.hostOrigin) &&
      isRecord(value) &&
      value.__taku === true &&
      value.type === TAKU_AGENT_MESSAGE_TYPES.helloResult &&
      value.protocol === TAKU_AGENT_PROTOCOL &&
      value.requestId === this.helloRequestId &&
      value.ok === true
    );
  }

  private verifyHelloResult(message: TakuAgentHelloResultMessage, origin: string): void {
    const requestId = this.helloRequestId;
    const clientNonce = this.helloClientNonce;
    const generation = this.handshakeGeneration;
    if (!requestId || !clientNonce || message.requestId !== requestId) {
      this.rejectUntrustedHost();
      return;
    }

    const abortController = new AbortController();
    const verification = {
      generation,
      requestId,
      abortController,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
    } satisfies PendingHostVerification;
    verification.timer = setTimeout(() => {
      abortController.abort();
      this.finishHostVerification(verification, null, message, origin);
    }, this.hostAttestationTimeoutMs);
    unrefTimer(verification.timer);
    this.hostVerification = verification;

    void Promise.resolve()
      .then(() => computeTakuAgentCapabilitiesDigest(message.capabilities))
      .then((capabilitiesDigest) => {
        if (
          this.hostVerification !== verification ||
          capabilitiesDigest !== message.capabilitiesDigest
        ) {
          return null;
        }
        const input: TakuAgentHostAttestationVerification = {
          protocol: TAKU_AGENT_PROTOCOL,
          requestId,
          clientNonce,
          frameEpoch: message.frameEpoch,
          runtimeInstanceId: message.attestation.runtimeInstanceId,
          sessionId: message.attestation.sessionId,
          capabilitiesDigest,
          proofExpiresAt: message.attestation.proofExpiresAt,
          sessionExpiresAt: message.attestation.sessionExpiresAt,
          proof: message.attestation.proof,
        };
        return this.transport.verifyHostAttestation(input, abortController.signal);
      })
      .then((authenticator) => {
        this.finishHostVerification(verification, authenticator, message, origin);
      })
      .catch(() => {
        this.finishHostVerification(verification, null, message, origin);
      });
  }

  private finishHostVerification(
    verification: PendingHostVerification,
    authenticator: TakuAgentSessionAuthenticator | null,
    message: TakuAgentHelloResultMessage,
    origin: string
  ): void {
    if (this.hostVerification !== verification) return;
    if (
      this.closed ||
      this.handshakeGeneration !== verification.generation ||
      this.helloRequestId !== verification.requestId ||
      message.requestId !== verification.requestId
    ) {
      return;
    }
    if (
      !authenticator ||
      authenticator.sessionId !== message.attestation.sessionId ||
      authenticator.sessionExpiresAt !== message.attestation.sessionExpiresAt ||
      authenticator.sessionExpiresAt <= Date.now()
    ) {
      this.rejectUntrustedHost();
      return;
    }
    let confirmRequestId: string;
    try {
      confirmRequestId = this.nextRequestId();
    } catch {
      this.rejectUntrustedHost();
      return;
    }
    const session: PendingSecureSession = {
      generation: verification.generation,
      authenticator,
      frameEpoch: message.frameEpoch,
      hostOrigin: origin,
      capabilities: cloneCapabilities(message.capabilities),
      confirmRequestId,
      confirmSent: false,
      ready: false,
      nextClientRpcSequence: 2,
      expiryTimer: null,
    };
    this.secureSession = session;
    this.hostOrigin = origin;
    this.transport.bindHostOrigin?.(origin);
    this.outboundQueue = this.outboundQueue
      .then(() => this.postSessionConfirm(session))
      .catch(() => {
        if (this.secureSession === session) this.rejectUntrustedHost();
      });
  }

  private async postSessionConfirm(session: PendingSecureSession): Promise<void> {
    if (
      this.closed ||
      this.secureSession !== session ||
      this.hostVerification?.generation !== session.generation ||
      session.ready ||
      session.confirmSent
    ) {
      return;
    }
    const body = JSON.stringify({
      __taku: true,
      protocol: TAKU_AGENT_PROTOCOL,
      type: TAKU_AGENT_MESSAGE_TYPES.sessionConfirm,
      requestId: session.confirmRequestId,
      frameEpoch: session.frameEpoch,
    } satisfies TakuAgentSessionConfirmMessage);
    let envelope: TakuAgentSecureEnvelope;
    try {
      envelope = await createTakuAgentSecureClientEnvelope({
        authenticator: session.authenticator,
        lane: 'rpc',
        sequence: '1',
        body,
      });
    } catch {
      this.rejectUntrustedHost();
      return;
    }
    if (
      this.closed ||
      this.secureSession !== session ||
      this.hostVerification?.generation !== session.generation
    ) {
      return;
    }
    session.confirmSent = true;
    try {
      this.transport.post(envelope);
    } catch (error) {
      this.failSecureSession(
        localError(
          'sdk_transport_failed',
          error instanceof Error ? error.message : 'Taku Agent Host is unavailable',
          true
        )
      );
    }
  }

  private bindSecureSession(session: PendingSecureSession): void {
    if (this.secureSession !== session || session.ready) return;
    const verification = this.hostVerification;
    if (!verification || verification.generation !== session.generation) {
      this.rejectUntrustedHost();
      return;
    }
    clearTimeout(verification.timer);
    this.hostVerification = null;
    this.helloRequestId = null;
    this.helloClientNonce = null;
    session.ready = true;
    this.frameEpoch = session.frameEpoch;
    this.capabilitiesValue = cloneCapabilities(session.capabilities);
    this.hostOrigin = session.hostOrigin;
    const remainingMs = session.authenticator.sessionExpiresAt - Date.now();
    if (remainingMs <= 0) {
      this.failSecureSession(
        localError('sdk_host_untrusted', 'The authenticated Taku Host session expired', true)
      );
      return;
    }
    session.expiryTimer = setTimeout(() => {
      if (this.secureSession === session) {
        this.failSecureSession(
          localError('sdk_host_untrusted', 'The authenticated Taku Host session expired', true)
        );
      }
    }, remainingMs);
    unrefTimer(session.expiryTimer);
    for (const [requestId, pending] of this.pending) {
      this.postPending(requestId, pending, session.frameEpoch);
    }
  }

  private rejectUntrustedHost(): void {
    this.failSecureSession(
      localError('sdk_host_untrusted', 'The Taku Host could not be authenticated', true)
    );
  }

  private failSecureSession(error: TakuAgentError): void {
    this.handshakeGeneration += 1;
    this.clearHelloTimers();
    this.clearHostVerification();
    if (this.secureSession?.expiryTimer) clearTimeout(this.secureSession.expiryTimer);
    this.secureSession = null;
    this.helloRequestId = null;
    this.helloClientNonce = null;
    this.frameEpoch = null;
    this.capabilitiesValue = null;
    this.hostOrigin = null;
    this.transport.bindHostOrigin?.(null);
    this.responseTombstones.clear();
    this.rejectAll(error);
    this.notifyAndClearSubscriptions(error);
    this.pendingSubscriptionRuns.clear();
    this.pendingSubscriptionErrors.clear();
    this.preAckEvents.length = 0;
    this.finishClosedCleanupIfIdle();
  }

  private invalidateHandshake(error: TakuAgentError): void {
    this.failSecureSession(error);
  }

  private handleRuntimeEvent(message: TakuAgentEventMessage): void {
    const subscription = this.subscriptions.get(message.subscriptionId);
    if (!subscription) {
      if (this.pendingSubscriptionRuns.has(message.runId)) {
        const limit = Math.min(this.capabilitiesValue?.limits.maxBufferedEvents ?? 64, 512);
        if (this.preAckEvents.length >= limit) this.preAckEvents.shift();
        this.preAckEvents.push(message);
      }
      return;
    }
    if (subscription.runId !== message.runId) return;
    if (subscription.muted) return;
    if (message.event.type === 'run.result') {
      try {
        this.assertOutputDeliverySupported(message.event.result);
      } catch (error) {
        const deliveryError =
          error instanceof TakuAgentError
            ? error
            : invalidResponse('Host returned unsupported paged Runtime content');
        this.subscriptions.delete(subscription.subscriptionId);
        this.subscribedRuns.delete(subscription.runId);
        safelyCall(subscription.onError, deliveryError);
        this.postUnsubscribeBestEffort(subscription.subscriptionId, subscription.runId);
        return;
      }
    }
    if (message.sequence <= subscription.lastSequence) return;
    if (message.sequence !== subscription.lastSequence + 1) {
      const error = localError(
        'sdk_event_gap',
        `Expected event ${subscription.lastSequence + 1} but received ${message.sequence}`,
        true
      );
      this.subscriptions.delete(subscription.subscriptionId);
      this.subscribedRuns.delete(subscription.runId);
      safelyCall(subscription.onError, error);
      this.postUnsubscribeBestEffort(subscription.subscriptionId, subscription.runId);
      return;
    }
    subscription.lastSequence = message.sequence;
    if (message.event.type !== 'unknown') safelyCall(subscription.listener, message);
  }

  private assertOutputDeliverySupported(
    output: TakuAgentRunCursor['snapshot']['result'] | undefined
  ): void {
    if (!output) return;
    if (
      'contentRef' in output &&
      output.contentRef !== undefined &&
      !this.capabilitiesValue?.features?.includes('content-ref-v1')
    ) {
      throw localError(
        'sdk_unsupported',
        'The Taku Host returned paged content without negotiating content-ref-v1',
        false
      );
    }
    if (
      (output.kind === 'images' || output.kind === 'videos') &&
      !this.capabilitiesValue?.features?.includes('asset-open-v1')
    ) {
      throw localError(
        'sdk_unsupported',
        'The Taku Host returned opaque media without negotiating asset-open-v1',
        false
      );
    }
  }

  private getRawEventLimitError(value: unknown): TakuAgentError | null {
    if (
      !isRecord(value) ||
      value.__taku !== true ||
      value.type !== TAKU_AGENT_MESSAGE_TYPES.event ||
      value.protocol !== TAKU_AGENT_PROTOCOL
    ) {
      return null;
    }
    return getEventPayloadLimitError(value.event, this.maxEventBytes());
  }

  private handleRejectedRawEvent(value: unknown, origin: string, error: TakuAgentError): void {
    if (
      !isRecord(value) ||
      this.closed ||
      !this.frameEpoch ||
      value.frameEpoch !== this.frameEpoch ||
      this.hostOrigin === null ||
      origin !== this.hostOrigin ||
      !isBoundedIdentifier(value.subscriptionId, TAKU_AGENT_FIELD_LIMITS.subscriptionId) ||
      !isBoundedIdentifier(value.runId, TAKU_AGENT_FIELD_LIMITS.runId)
    ) {
      return;
    }
    const subscription = this.subscriptions.get(value.subscriptionId);
    if (subscription?.runId === value.runId) {
      this.subscriptions.delete(subscription.subscriptionId);
      this.subscribedRuns.delete(subscription.runId);
      if (!subscription.muted) safelyCall(subscription.onError, error);
      this.postUnsubscribeBestEffort(subscription.subscriptionId, subscription.runId);
      return;
    }
    if (this.pendingSubscriptionRuns.has(value.runId)) {
      this.pendingSubscriptionErrors.set(value.runId, error);
      this.dropPreAckEventsForRun(value.runId);
    }
  }

  private getReplayLimitError(value: unknown): TakuAgentError | null {
    if (!isRecord(value) || !Array.isArray(value.replayedEvents)) return null;
    const replayLimit = Math.min(
      MAX_REPLAY_EVENTS,
      this.capabilitiesValue?.limits.eventRetention ?? MAX_REPLAY_EVENTS
    );
    if (value.replayedEvents.length > replayLimit) {
      return localError(
        'sdk_limit_exceeded',
        `Host replay contains ${value.replayedEvents.length} events; the SDK limit is ${replayLimit}`,
        false
      );
    }
    const maxEventBytes = this.maxEventBytes();
    for (const storedEvent of value.replayedEvents) {
      if (!isRecord(storedEvent)) continue;
      const eventError = getEventPayloadLimitError(storedEvent.event, maxEventBytes);
      if (eventError) return eventError;
    }
    return null;
  }

  private maxEventBytes(): number {
    return Math.min(
      MAX_EVENT_BYTES,
      this.capabilitiesValue?.limits.maxEventBytes ?? MAX_EVENT_BYTES
    );
  }

  private unsubscribeUnsafeSubscribeResult(
    value: unknown,
    pending: PendingRequest,
    frameEpoch: string,
    hostOrigin: string
  ): void {
    if (
      !isRecord(value) ||
      !isBoundedIdentifier(value.subscriptionId, TAKU_AGENT_FIELD_LIMITS.subscriptionId) ||
      !isRecord(value.snapshot) ||
      !isBoundedIdentifier(value.snapshot.runId, TAKU_AGENT_FIELD_LIMITS.runId) ||
      value.snapshot.runId !== pending.params.runId
    ) {
      return;
    }
    this.postUnsubscribeBestEffort(
      value.subscriptionId,
      value.snapshot.runId,
      frameEpoch,
      hostOrigin
    );
  }

  private validateSubscriptionReplay(
    result: TakuAgentSubscribeResult,
    runId: string,
    afterSequence: number
  ): void {
    if (result.snapshot.runId !== runId) {
      throw invalidResponse('agent.subscribe returned a different runId');
    }
    if (afterSequence < result.oldestRetainedSequence - 1) {
      throw localError(
        'sdk_event_gap',
        'Host returned a replay outside its advertised retention window',
        true
      );
    }
    const normalizedEvents: TakuAgentSubscribeResult['replayedEvents'] = [];
    let sequence = afterSequence;
    for (const event of [...result.replayedEvents].sort(
      (left, right) => left.sequence - right.sequence
    )) {
      if (event.runId !== runId) {
        throw invalidResponse('agent.subscribe returned an event for another subscription');
      }
      if (event.sequence <= sequence) continue;
      if (event.sequence !== sequence + 1) {
        throw localError(
          'sdk_event_gap',
          `Expected replay event ${sequence + 1} but received ${event.sequence}`,
          true
        );
      }
      sequence = event.sequence;
      normalizedEvents.push(event);
    }
    if (sequence !== result.lastSequence) {
      throw invalidResponse('agent.subscribe returned an inconsistent lastSequence');
    }
    result.replayedEvents.splice(0, result.replayedEvents.length, ...normalizedEvents);
  }

  private postUnsubscribeBestEffort(
    subscriptionId: string,
    runId: string,
    frameEpoch = this.frameEpoch ?? undefined,
    hostOrigin = this.hostOrigin ?? undefined
  ): void {
    const session = this.secureSession;
    if (
      !frameEpoch ||
      !hostOrigin ||
      this.hostOrigin !== hostOrigin ||
      !session?.ready ||
      session.frameEpoch !== frameEpoch ||
      session.hostOrigin !== hostOrigin
    ) {
      return;
    }
    let requestId: string;
    try {
      requestId = this.nextRequestId();
    } catch {
      return;
    }
    const body = JSON.stringify({
      __taku: true,
      protocol: TAKU_AGENT_PROTOCOL,
      type: TAKU_AGENT_MESSAGE_TYPES.request,
      requestId,
      frameEpoch,
      method: 'agent.unsubscribe',
      params: { subscriptionId, runId },
    } satisfies TakuAgentRequestMessage);
    this.bestEffortCleanupCount += 1;
    this.outboundQueue = this.outboundQueue
      .then(async () => {
        if (this.secureSession !== session || !session.ready) return;
        const sequence = String(session.nextClientRpcSequence);
        session.nextClientRpcSequence += 1;
        const envelope = await createTakuAgentSecureClientEnvelope({
          authenticator: session.authenticator,
          lane: 'rpc',
          sequence,
          body,
        });
        if (this.secureSession !== session || !session.ready) return;
        if (
          !this.rememberResponseTombstone(requestId, {
            kind: 'cleanup',
            sessionId: session.authenticator.sessionId,
            handshakeGeneration: session.generation,
            frameEpoch,
            hostOrigin,
            secureSequence: sequence,
            sessionExpiresAt: session.authenticator.sessionExpiresAt,
            method: 'agent.unsubscribe',
            params: { subscriptionId, runId },
            parseResult: parseTakuAgentUnsubscribeResult,
          })
        ) {
          this.failResponseTrackingCapacity(session);
          return;
        }
        this.transport.post(envelope);
      })
      .catch(() => {
        if (this.secureSession === session) {
          this.failSecureSession(
            localError(
              'sdk_host_untrusted',
              'Taku Agent request ordering could not be preserved',
              true
            )
          );
        }
      })
      .finally(() => {
        this.bestEffortCleanupCount -= 1;
        this.finishClosedCleanupIfIdle();
      });
  }

  private dropPreAckEventsForRun(runId: string): void {
    for (let index = this.preAckEvents.length - 1; index >= 0; index -= 1) {
      if (this.preAckEvents[index]?.runId === runId) this.preAckEvents.splice(index, 1);
    }
  }

  private nextRequestId(): string {
    const candidate = this.requestIdFactory().trim();
    if (
      !candidate ||
      candidate.length > TAKU_AGENT_FIELD_LIMITS.requestId ||
      candidate === this.helloRequestId ||
      this.pending.has(candidate) ||
      this.responseTombstones.has(candidate)
    ) {
      throw new Error('requestIdFactory must return a unique non-empty identifier');
    }
    return candidate;
  }

  private rejectPending(requestId: string, error: TakuAgentError): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.removeAbortListener();
    const responseTrackingSafe = this.rememberPendingResponse(requestId, pending);
    pending.reject(error);
    if (!responseTrackingSafe) {
      const session = this.secureSession;
      if (session) this.failResponseTrackingCapacity(session);
    }
  }

  private rejectAll(error: TakuAgentError): void {
    for (const requestId of [...this.pending.keys()]) this.rejectPending(requestId, error);
  }

  private notifyAndClearSubscriptions(error: TakuAgentError): void {
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.muted) safelyCall(subscription.onError, error);
    }
    this.subscriptions.clear();
    this.subscribedRuns.clear();
  }

  private getSubscriptionInstallError(
    runId: string,
    responseFrameEpoch: string | undefined
  ): TakuAgentError | null {
    if (this.closed) return localError('sdk_closed', 'Taku Agent client is closed', false);
    if (
      !responseFrameEpoch ||
      !this.pendingSubscriptionRuns.has(runId) ||
      this.frameEpoch !== responseFrameEpoch
    ) {
      return localError(
        'sdk_frame_changed',
        'The Taku Host frame changed before the subscription became active',
        true
      );
    }
    return null;
  }

  private getSubscriptionDeliveryError(
    subscription: ActiveSubscription,
    responseFrameEpoch: string | undefined
  ): TakuAgentError | null {
    if (this.closed) return localError('sdk_closed', 'Taku Agent client is closed', false);
    if (this.frameEpoch !== responseFrameEpoch) {
      return localError(
        'sdk_frame_changed',
        'The Taku Host frame changed while replaying subscription events',
        true
      );
    }
    if (this.subscriptions.get(subscription.subscriptionId) !== subscription) {
      return localError('sdk_event_gap', 'The subscription stopped before replay completed', true);
    }
    return null;
  }

  private rememberPendingResponse(requestId: string, pending: PendingRequest): boolean {
    const session = this.secureSession;
    if (
      !session?.ready ||
      !pending.frameEpoch ||
      !pending.hostOrigin ||
      !pending.secureSequence ||
      pending.frameEpoch !== session.frameEpoch ||
      pending.hostOrigin !== session.hostOrigin
    ) {
      return true;
    }
    return this.rememberResponseTombstone(requestId, {
      kind: 'pending',
      sessionId: session.authenticator.sessionId,
      handshakeGeneration: session.generation,
      frameEpoch: pending.frameEpoch,
      hostOrigin: pending.hostOrigin,
      secureSequence: pending.secureSequence,
      sessionExpiresAt: session.authenticator.sessionExpiresAt,
      method: pending.method,
      params: pending.params,
      parseResult: pending.parseResult,
    });
  }

  private rememberResponseTombstone(requestId: string, tombstone: ResponseTombstone): boolean {
    if (
      this.responseTombstones.has(requestId) ||
      this.responseTombstones.size >= MAX_RESPONSE_TOMBSTONES
    ) {
      return false;
    }
    this.responseTombstones.set(requestId, tombstone);
    return true;
  }

  private handleTombstonedResponse(
    message: TakuAgentResponseMessage,
    origin: string,
    secureSequence: string,
    session: PendingSecureSession
  ): boolean {
    const tombstone = this.responseTombstones.get(message.requestId);
    if (!tombstone) return false;
    if (
      tombstone.sessionId !== session.authenticator.sessionId ||
      tombstone.handshakeGeneration !== session.generation ||
      tombstone.sessionExpiresAt !== session.authenticator.sessionExpiresAt ||
      message.frameEpoch !== tombstone.frameEpoch ||
      origin !== tombstone.hostOrigin ||
      secureSequence !== tombstone.secureSequence
    ) {
      this.rejectUntrustedHost();
      this.finishClosedCleanupIfIdle();
      return true;
    }

    let parsedResult: unknown = null;
    if (message.ok) {
      parsedResult = tombstone.parseResult(message.result);
      if (parsedResult === null) {
        this.rejectUntrustedHost();
        this.finishClosedCleanupIfIdle();
        return true;
      }
    }

    this.responseTombstones.delete(message.requestId);
    if (message.ok && tombstone.kind === 'pending' && tombstone.method === 'agent.subscribe') {
      const result = parsedResult as TakuAgentSubscribeResult;
      const runId = tombstone.params.runId;
      if (typeof runId !== 'string' || result.snapshot.runId !== runId) {
        this.rejectUntrustedHost();
        this.finishClosedCleanupIfIdle();
        return true;
      }
      this.postUnsubscribeBestEffort(
        result.subscriptionId,
        runId,
        tombstone.frameEpoch,
        tombstone.hostOrigin
      );
    } else if (
      !message.ok &&
      (message.error.code === 'stale_frame' || message.error.code === 'account_changed')
    ) {
      this.invalidateHandshake(hostError(message.error));
    }
    this.finishClosedCleanupIfIdle();
    return true;
  }

  private failResponseTrackingCapacity(session: PendingSecureSession): void {
    if (this.secureSession !== session) return;
    this.failSecureSession(
      localError('sdk_host_untrusted', 'Taku Agent response tracking capacity was exceeded', true)
    );
  }

  private hasPendingSubscribeResponse(): boolean {
    for (const tombstone of this.responseTombstones.values()) {
      if (tombstone.kind === 'pending' && tombstone.method === 'agent.subscribe') return true;
    }
    return false;
  }

  private finishClosedCleanupIfIdle(): void {
    if (
      !this.closed ||
      this.listenerStopped ||
      this.pendingSubscriptionRuns.size > 0 ||
      this.hasPendingSubscribeResponse() ||
      this.bestEffortCleanupCount > 0
    ) {
      return;
    }
    this.listenerStopped = true;
    this.stopListening();
    if (this.secureSession?.expiryTimer) clearTimeout(this.secureSession.expiryTimer);
    this.responseTombstones.clear();
    this.secureSession = null;
    this.frameEpoch = null;
    this.hostOrigin = null;
    this.transport.bindHostOrigin?.(null);
  }

  private clearHelloTimers(): void {
    for (const timer of this.helloTimers) clearTimeout(timer);
    this.helloTimers = [];
  }

  private clearHostVerification(): void {
    const verification = this.hostVerification;
    if (!verification) return;
    this.hostVerification = null;
    clearTimeout(verification.timer);
    verification.abortController.abort();
  }
}

function safelyCall<T>(callback: ((value: T) => void) | undefined, value: T): void {
  if (!callback) return;
  try {
    callback(value);
  } catch {
    // Consumer callbacks are isolated from the shared Host message listener.
  }
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}

function hostError(error: TakuAgentErrorPayload): TakuAgentError {
  return new TakuAgentError(error);
}

function localError(
  code: TakuAgentClientErrorCode,
  message: string,
  retryable: boolean
): TakuAgentError {
  return new TakuAgentError({ code, message, retryable });
}

function requestAborted(): TakuAgentError {
  return localError('sdk_aborted', 'Taku Agent request was aborted', true);
}

function invalidResponse(message: string): TakuAgentError {
  return localError('sdk_invalid_response', message, false);
}

function createRequestDeadline(options: TakuAgentRequestOptions): RequestDeadline {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new TypeError('timeoutMs must be between 1 and 120000');
  }
  return { expiresAt: Date.now() + timeoutMs, signal: options.signal };
}

function requestOptionsWithinDeadline(
  deadline: RequestDeadline,
  method: TakuAgentMethod
): TakuAgentRequestOptions {
  if (deadline.signal?.aborted) return { signal: deadline.signal, timeoutMs: 1 };
  const remainingMs = deadline.expiresAt - Date.now();
  if (remainingMs <= 0) {
    throw localError('sdk_timeout', `Taku Agent call timed out before ${method}`, true);
  }
  return {
    ...(deadline.signal ? { signal: deadline.signal } : {}),
    timeoutMs: Math.max(1, Math.ceil(remainingMs)),
  };
}

function getEventPayloadLimitError(value: unknown, maxEventBytes: number): TakuAgentError | null {
  const eventBytes = utf8JsonByteLength(value);
  if (eventBytes === null) {
    return invalidResponse('Host returned an event payload that is not JSON serializable');
  }
  if (eventBytes <= maxEventBytes) return null;
  return localError(
    'sdk_limit_exceeded',
    `Host event payload is ${eventBytes} UTF-8 JSON bytes; the SDK limit is ${maxEventBytes}`,
    false
  );
}

function utf8JsonByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') return null;
    return new TextEncoder().encode(serialized).byteLength;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isBoundedIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createClientNonce(): string {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure random number generation is unavailable');
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      output += alphabet[(buffer >> bits) & 63];
    }
  }
  if (bits > 0) output += alphabet[(buffer << (6 - bits)) & 63];
  return output;
}

function cloneCapabilities(capabilities: TakuAgentCapabilities): TakuAgentCapabilities {
  return {
    recoveryScope: capabilities.recoveryScope,
    methods: [...capabilities.methods],
    operations: capabilities.operations.map((operation) => ({ ...operation })),
    ...(capabilities.features ? { features: [...capabilities.features] } : {}),
    ...(capabilities.catalog ? { catalog: structuredClone(capabilities.catalog) } : {}),
    limits: { ...capabilities.limits },
  };
}

function outputMatchesOperation(
  output: TakuAgentResult['result'],
  operation: TakuAgentOperationId
): boolean {
  if (operation === 'research.generateReport') return output.kind === 'report';
  if (operation === 'agent.execute') {
    return output.kind === 'text' || output.kind === 'markdown' || output.kind === 'json';
  }
  if (operation === 'media.image.generate') return output.kind === 'images';
  return output.kind === 'videos';
}
