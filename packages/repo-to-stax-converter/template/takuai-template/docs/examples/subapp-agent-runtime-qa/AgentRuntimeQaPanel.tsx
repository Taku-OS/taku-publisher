'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  closeTakuAgentClient,
  createTakuAgentAssetPlayback,
  createTakuAgentRunJournal,
  getTakuAgentClient,
  recoverOrStartTakuAgentRun,
  TAKU_AGENT_EXECUTE_OPERATION,
  TAKU_AGENT_IMAGE_OPERATION,
  TAKU_AGENT_REPORT_OPERATION,
  TAKU_AGENT_VIDEO_OPERATION,
  TakuAgentError,
  TakuAgentRunPersistenceError,
  TakuAgentRunRecoveryBlockedError,
  type TakuAgentCapabilities,
  type TakuAgentAssetPlayback,
  type TakuAgentClient,
  type TakuAgentClientErrorCode,
  type TakuAgentEventMessage,
  type TakuAgentOperationDescriptor,
  type TakuAgentOperationId,
  type TakuAgentOperationInputMap,
  type TakuAgentRunJournal,
  type TakuAgentRunOutput,
  type TakuAgentRunSnapshot,
} from '@/lib/taku-runtime';

const OPERATION_DEFINITIONS = [
  {
    id: TAKU_AGENT_EXECUTE_OPERATION,
    fallbackTitle: 'Agent task',
    sample: 'Summarize three practical ways a small team can review a weekly launch.',
  },
  {
    id: TAKU_AGENT_REPORT_OPERATION,
    fallbackTitle: 'Research report',
    sample: 'How local-first AI changes small-team workflows',
  },
  {
    id: TAKU_AGENT_IMAGE_OPERATION,
    fallbackTitle: 'Image generation',
    sample: 'A calm editorial illustration of a local-first creative workspace',
  },
  {
    id: TAKU_AGENT_VIDEO_OPERATION,
    fallbackTitle: 'Video generation',
    sample: 'A four-second cinematic orbit around a miniature creative workspace',
  },
] as const;

const SAMPLE_INPUTS = {
  [TAKU_AGENT_EXECUTE_OPERATION]: {
    instruction: OPERATION_DEFINITIONS[0].sample,
    language: 'en',
    output: { format: 'markdown' },
  },
  [TAKU_AGENT_REPORT_OPERATION]: {
    topic: OPERATION_DEFINITIONS[1].sample,
    instructions: 'Return a concise report with a short recommendation.',
    language: 'en',
  },
  [TAKU_AGENT_IMAGE_OPERATION]: {
    prompt: OPERATION_DEFINITIONS[2].sample,
  },
  [TAKU_AGENT_VIDEO_OPERATION]: {
    prompt: OPERATION_DEFINITIONS[3].sample,
  },
} satisfies { [K in TakuAgentOperationId]: TakuAgentOperationInputMap[K] };

type FixtureErrorCode =
  | TakuAgentClientErrorCode
  | 'catalog_unavailable'
  | 'operation_not_granted'
  | 'recovery_blocked'
  | 'recovery_persistence_failed'
  | 'run_cancelled'
  | 'unexpected_error';

type FixtureError = {
  code: FixtureErrorCode;
  message: string;
  detail?: string;
  retryable: boolean;
};

type CapabilityView =
  | { kind: 'loading' }
  | { kind: 'ready'; value: TakuAgentCapabilities }
  | { kind: 'unavailable'; error: FixtureError };

type MediaPreview = {
  kind: 'image' | 'video';
  assetRef: string;
  expectedRecoveryScope: string;
};

type OperationView =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'running'; runId: string; status: string; delta: string }
  | { kind: 'succeeded'; runId: string; text?: string; previews: MediaPreview[] }
  | { kind: 'failed'; error: FixtureError };

class FixtureCancelledError extends Error {
  constructor() {
    super('The Host cancelled this run');
    this.name = 'FixtureCancelledError';
  }
}

function toFixtureError(error: unknown): FixtureError {
  if (error instanceof TakuAgentError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.detail ? { detail: error.detail } : {}),
      retryable: error.retryable === true,
    };
  }
  if (error instanceof TakuAgentRunRecoveryBlockedError) {
    return {
      code: 'recovery_blocked',
      message: 'The saved run cannot be recovered safely. Discard it only after a user decision.',
      detail: error.reason,
      retryable: false,
    };
  }
  if (error instanceof TakuAgentRunPersistenceError) {
    return {
      code: 'recovery_persistence_failed',
      message: 'The Host accepted the run, but the local recovery journal could not be updated.',
      detail: `Accepted run: ${error.cursor.snapshot.runId}`,
      retryable: true,
    };
  }
  if (error instanceof FixtureCancelledError) {
    return {
      code: 'run_cancelled',
      message: error.message,
      retryable: false,
    };
  }
  return {
    code: 'unexpected_error',
    message: error instanceof Error ? error.message : 'Unexpected QA fixture error',
    retryable: false,
  };
}

function snapshotFailure(snapshot: TakuAgentRunSnapshot): TakuAgentError {
  return new TakuAgentError(
    snapshot.error ?? {
      code: 'internal_error',
      message: 'The Host returned a failed run without a typed error payload',
      retryable: false,
    }
  );
}

function isTerminal(snapshot: TakuAgentRunSnapshot): boolean {
  return ['succeeded', 'failed', 'cancelled'].includes(snapshot.state);
}

async function settleTerminalSnapshot(
  client: TakuAgentClient,
  snapshot: TakuAgentRunSnapshot
): Promise<void> {
  if (snapshot.state === 'succeeded') return;
  if (snapshot.state === 'cancelled') throw new FixtureCancelledError();
  if (snapshot.state === 'failed') {
    const latest = await client.get(snapshot.runId);
    throw snapshotFailure(latest.snapshot);
  }
  throw new Error(`Run ${snapshot.runId} is not terminal`);
}

function safelyAdvanceJournal(
  journal: TakuAgentRunJournal<TakuAgentOperationId>,
  entryId: string,
  message: TakuAgentEventMessage,
  onWarning: (message: string) => void
): void {
  try {
    if (
      message.event.type === 'run.result' ||
      message.event.type === 'run.error' ||
      (message.event.type === 'run.state' && message.event.status === 'cancelled')
    ) {
      journal.clear(entryId);
      return;
    }
    const phase =
      message.event.type === 'run.state' && message.event.status === 'cancelling'
        ? 'cancelling'
        : 'running';
    journal.update(entryId, message.sequence, phase);
  } catch (error) {
    onWarning(error instanceof Error ? error.message : 'Recovery journal update failed');
  }
}

async function waitForTerminalRun(input: {
  client: TakuAgentClient;
  journal: TakuAgentRunJournal<TakuAgentOperationId>;
  entryId: string;
  cursor: { snapshot: TakuAgentRunSnapshot; lastSequence: number };
  onProgress: (status: string, delta?: string) => void;
  onWarning: (message: string) => void;
}): Promise<void> {
  if (isTerminal(input.cursor.snapshot)) {
    await settleTerminalSnapshot(input.client, input.cursor.snapshot);
    return;
  }

  let resolveTerminal!: () => void;
  let rejectTerminal!: (error: unknown) => void;
  const terminal = new Promise<void>((resolve, reject) => {
    resolveTerminal = resolve;
    rejectTerminal = reject;
  });
  // Replay events may settle before subscribe() returns. Attach a handler now
  // while still awaiting the same original promise below.
  void terminal.catch(() => undefined);

  const onEvent = (message: TakuAgentEventMessage): void => {
    if (message.event.type === 'output.delta') {
      input.onProgress('running', message.event.delta);
    }
    if (message.event.type === 'run.state') {
      input.onProgress(message.event.status);
    }

    // Settle the business result first. Journal cleanup remains best effort.
    if (message.event.type === 'run.result') {
      resolveTerminal();
      safelyAdvanceJournal(input.journal, input.entryId, message, input.onWarning);
      return;
    }
    if (message.event.type === 'run.error') {
      rejectTerminal(new TakuAgentError(message.event.error));
      safelyAdvanceJournal(input.journal, input.entryId, message, input.onWarning);
      return;
    }
    if (message.event.type === 'run.state' && message.event.status === 'cancelled') {
      rejectTerminal(new FixtureCancelledError());
      safelyAdvanceJournal(input.journal, input.entryId, message, input.onWarning);
      return;
    }
    if (message.event.type === 'run.state' && message.event.status === 'failed') {
      void input.client
        .get(input.cursor.snapshot.runId)
        .then(({ snapshot }) => {
          rejectTerminal(snapshotFailure(snapshot));
          try {
            input.journal.clear(input.entryId);
          } catch (error) {
            input.onWarning(
              error instanceof Error ? error.message : 'Recovery journal cleanup failed'
            );
          }
        })
        .catch(rejectTerminal);
    }
    safelyAdvanceJournal(input.journal, input.entryId, message, input.onWarning);
  };

  const subscription = await input.client.subscribe(input.cursor.snapshot.runId, onEvent, {
    afterSequence: input.cursor.lastSequence,
    onError: rejectTerminal,
  });

  try {
    if (isTerminal(subscription.snapshot)) {
      try {
        input.journal.clear(input.entryId);
      } catch (error) {
        input.onWarning(error instanceof Error ? error.message : 'Recovery journal cleanup failed');
      }
      await settleTerminalSnapshot(input.client, subscription.snapshot);
      return;
    }
    await terminal;
  } finally {
    await subscription.unsubscribe().catch((error: unknown) => {
      input.onWarning(error instanceof Error ? error.message : 'Subscription cleanup failed');
    });
  }
}

async function materializeText(
  client: TakuAgentClient,
  runId: string,
  result: TakuAgentRunOutput
): Promise<string | undefined> {
  if ('content' in result && result.content !== undefined) return result.content;
  if ('markdown' in result && result.markdown !== undefined) return result.markdown;
  if (!('contentRef' in result) || result.contentRef === undefined) return undefined;

  let text = '';
  for await (const chunk of client.readContentText(runId, result.contentRef, { pageSize: 4_096 })) {
    text += chunk;
  }
  return text;
}

function getMediaPreviews(
  result: TakuAgentRunOutput,
  capabilities: TakuAgentCapabilities
): MediaPreview[] {
  if (!('assets' in result)) return [];
  const supported = result.assets.filter(
    (asset): asset is typeof asset & { kind: 'image' | 'video' } =>
      asset.kind === 'image' || asset.kind === 'video'
  );
  return supported.map(asset => ({
    kind: asset.kind,
    assetRef: asset.assetRef,
    expectedRecoveryScope: capabilities.recoveryScope,
  }));
}

function RenewingMediaPreview({ preview, index }: { preview: MediaPreview; index: number }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const leaseRef = useRef<TakuAgentAssetPlayback | null>(null);
  const [error, setError] = useState<FixtureError | null>(null);

  useEffect(() => {
    const element = preview.kind === 'image' ? imageRef.current : videoRef.current;
    if (!element) return;
    const lease = createTakuAgentAssetPlayback({
      client: getTakuAgentClient(),
      assetRef: preview.assetRef,
      expectedRecoveryScope: preview.expectedRecoveryScope,
      element,
      onChange: () => setError(null),
      onError: failure => setError(toFixtureError(failure)),
    });
    leaseRef.current = lease;
    return () => {
      lease.dispose();
      leaseRef.current = null;
    };
  }, [preview.assetRef, preview.expectedRecoveryScope, preview.kind]);

  return (
    <div data-slot="agent-runtime-qa-renewing-preview" className="space-y-2">
      {preview.kind === 'image' ? (
        <img
          data-slot="image-agent-runtime-qa-preview"
          ref={imageRef}
          alt={`Generated QA preview ${index + 1}`}
          className="aspect-square w-full rounded-xl object-cover"
        />
      ) : (
        <video
          data-slot="video-agent-runtime-qa-preview"
          ref={videoRef}
          controls
          className="aspect-video w-full rounded-xl bg-black"
        />
      )}
      {error && (
        <div data-slot="agent-runtime-qa-playback-error" className="text-sm text-red-800">
          <p>Playback unavailable ({error.code}). The generated asset has not been regenerated.</p>
          <button
            data-slot="button-agent-runtime-qa-retry-playback"
            type="button"
            onClick={() => void leaseRef.current?.refresh()}
            className="mt-1 rounded-lg border border-red-200 px-3 py-1"
          >
            Retry playback only
          </button>
        </div>
      )}
    </div>
  );
}

function getCatalogDescriptor(
  capabilities: TakuAgentCapabilities,
  operation: TakuAgentOperationId
): TakuAgentOperationDescriptor | undefined {
  return capabilities.catalog?.operations.find(
    descriptor => descriptor.id === operation && descriptor.revision === 1
  );
}

export default function AgentRuntimeQaPanel() {
  const clientRef = useRef<TakuAgentClient | null>(null);
  const inFlightRef = useRef(new Set<TakuAgentOperationId>());
  const [capabilityView, setCapabilityView] = useState<CapabilityView>({ kind: 'loading' });
  const [operationViews, setOperationViews] = useState<
    Partial<Record<TakuAgentOperationId, OperationView>>
  >({});
  const [warnings, setWarnings] = useState<string[]>([]);

  const refreshCapabilities = useCallback(async () => {
    setCapabilityView({ kind: 'loading' });
    try {
      const client = clientRef.current ?? getTakuAgentClient();
      clientRef.current = client;
      const value = await client.capabilities();
      setCapabilityView({ kind: 'ready', value });
    } catch (error) {
      setCapabilityView({ kind: 'unavailable', error: toFixtureError(error) });
    }
  }, []);

  useEffect(() => {
    void refreshCapabilities();
    return () => {
      closeTakuAgentClient();
      clientRef.current = null;
    };
  }, [refreshCapabilities]);

  const grantedDefinitions = useMemo(() => {
    if (capabilityView.kind !== 'ready') return [];
    return OPERATION_DEFINITIONS.filter(definition =>
      capabilityView.value.operations.some(
        granted => granted.id === definition.id && granted.revision === 1
      )
    );
  }, [capabilityView]);

  const runOperation = useCallback(
    async <K extends TakuAgentOperationId>(operation: K) => {
      if (inFlightRef.current.has(operation)) return;
      inFlightRef.current.add(operation);
      setOperationViews(current => ({ ...current, [operation]: { kind: 'starting' } }));

      try {
        const client = clientRef.current ?? getTakuAgentClient();
        clientRef.current = client;
        const capabilities = await client.capabilities();
        const granted = capabilities.operations.some(
          candidate => candidate.id === operation && candidate.revision === 1
        );
        if (!granted) {
          throw new TakuAgentError({
            code: 'capability_not_granted',
            message: 'This operation is not granted in the current authenticated Host session',
            retryable: false,
          });
        }

        const journal = createTakuAgentRunJournal<K>({
          recoveryScope: capabilities.recoveryScope,
          operation,
          operationRevision: 1,
          storageKey: `taku-agent-runtime-qa:${operation}:in-flight`,
        });
        const restored = await recoverOrStartTakuAgentRun<K>({
          client,
          journal,
          recoveryScope: capabilities.recoveryScope,
          input: SAMPLE_INPUTS[operation] as TakuAgentOperationInputMap[K],
        });
        const runId = restored.cursor.snapshot.runId;
        setOperationViews(current => ({
          ...current,
          [operation]: {
            kind: 'running',
            runId,
            status: restored.cursor.snapshot.state,
            delta: '',
          },
        }));
        if (restored.cleanupError) {
          setWarnings(current => [...current, 'The completed run journal could not be cleaned up.']);
        }

        await waitForTerminalRun({
          client,
          journal: journal as TakuAgentRunJournal<TakuAgentOperationId>,
          entryId: restored.journalEntryId,
          cursor: restored.cursor,
          onProgress(status, delta = '') {
            setOperationViews(current => {
              const previous = current[operation];
              return {
                ...current,
                [operation]: {
                  kind: 'running',
                  runId,
                  status,
                  delta:
                    previous?.kind === 'running'
                      ? `${previous.delta}${delta}`.slice(-2_000)
                      : delta.slice(-2_000),
                },
              };
            });
          },
          onWarning(message) {
            setWarnings(current => [...current, message]);
          },
        });

        const completed = await client.resultFor(runId, operation);
        const text = await materializeText(client, runId, completed.result);
        const previews = getMediaPreviews(completed.result, capabilities);
        setOperationViews(current => ({
          ...current,
          [operation]: { kind: 'succeeded', runId, ...(text ? { text } : {}), previews },
        }));
      } catch (error) {
        setOperationViews(current => ({
          ...current,
          [operation]: { kind: 'failed', error: toFixtureError(error) },
        }));
      } finally {
        inFlightRef.current.delete(operation);
      }
    },
    []
  );

  return (
    <main
      data-slot="agent-runtime-qa-panel"
      className="mx-auto min-h-screen max-w-6xl bg-white px-6 py-8 text-zinc-950"
    >
      <header
        data-slot="agent-runtime-qa-header"
        className="mb-6 flex flex-wrap items-start justify-between gap-4"
      >
        <div data-slot="agent-runtime-qa-heading-copy" className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600">
            Local Desktop QA
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Taku App Agent Runtime</h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            Shows only operations granted by the authenticated Host. Nothing runs until you press a
            sample button.
          </p>
        </div>
        <button
          data-slot="button-agent-runtime-qa-refresh"
          type="button"
          onClick={() => void refreshCapabilities()}
          className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-zinc-50 disabled:opacity-50"
          disabled={capabilityView.kind === 'loading'}
        >
          Refresh capabilities
        </button>
      </header>

      {capabilityView.kind === 'loading' && (
        <section
          data-slot="agent-runtime-qa-loading"
          className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600"
        >
          Establishing an authenticated Host session…
        </section>
      )}

      {capabilityView.kind === 'unavailable' && (
        <section
          data-slot="agent-runtime-qa-unavailable"
          className="rounded-2xl border border-amber-200 bg-amber-50 p-5"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            {capabilityView.error.code}
          </p>
          <p className="mt-1 text-sm text-amber-950">{capabilityView.error.message}</p>
        </section>
      )}

      {capabilityView.kind === 'ready' && (
        <section data-slot="agent-runtime-qa-ready" className="space-y-5">
          <div
            data-slot="agent-runtime-qa-capability-summary"
            className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-3"
          >
            <Metric label="Granted operations" value={String(grantedDefinitions.length)} />
            <Metric label="Negotiated features" value={String(capabilityView.value.features?.length ?? 0)} />
            <Metric
              label="Operation catalog"
              value={capabilityView.value.catalog ? 'Available' : 'Unavailable'}
            />
          </div>

          {!capabilityView.value.catalog && (
            <div
              data-slot="agent-runtime-qa-catalog-unavailable"
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            >
              <span className="mr-2 font-mono text-xs text-amber-700">catalog_unavailable</span>
              The Host granted operations but did not negotiate the typed operation catalog.
            </div>
          )}

          {grantedDefinitions.length === 0 ? (
            <div
              data-slot="agent-runtime-qa-no-grants"
              className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center"
            >
              <p className="font-mono text-xs text-zinc-500">operation_not_granted</p>
              <p className="mt-2 text-sm text-zinc-700">
                This app has no Agent Runtime operation grants in the current Host session.
              </p>
            </div>
          ) : (
            <div
              data-slot="agent-runtime-qa-operation-grid"
              className="grid gap-4 lg:grid-cols-2"
            >
              {grantedDefinitions.map(definition => (
                <OperationCard
                  key={definition.id}
                  operation={definition.id}
                  fallbackTitle={definition.fallbackTitle}
                  sample={definition.sample}
                  descriptor={getCatalogDescriptor(capabilityView.value, definition.id)}
                  view={operationViews[definition.id] ?? { kind: 'idle' }}
                  onRun={runOperation}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {warnings.length > 0 && (
        <aside
          data-slot="agent-runtime-qa-warnings"
          className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"
        >
          <p className="font-semibold">Secondary cleanup warnings</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {warnings.slice(-4).map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </aside>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div data-slot="agent-runtime-qa-metric" className="rounded-xl bg-white px-4 py-3 shadow-sm">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function OperationCard({
  operation,
  fallbackTitle,
  sample,
  descriptor,
  view,
  onRun,
}: {
  operation: TakuAgentOperationId;
  fallbackTitle: string;
  sample: string;
  descriptor?: TakuAgentOperationDescriptor;
  view: OperationView;
  onRun: <K extends TakuAgentOperationId>(operation: K) => Promise<void>;
}) {
  const busy = view.kind === 'starting' || view.kind === 'running';
  return (
    <article
      data-slot="card-agent-runtime-qa-operation"
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
    >
      <div data-slot="agent-runtime-qa-operation-copy" className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">{descriptor?.title ?? fallbackTitle}</h2>
            <p className="mt-1 font-mono text-xs text-violet-700">{operation}@1</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            Granted
          </span>
        </div>
        <p className="text-sm text-zinc-600">
          {descriptor?.description ?? 'The operation is granted, but no catalog descriptor is available.'}
        </p>
        <div className="rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-600">{sample}</div>

        {descriptor && (
          <details data-slot="agent-runtime-qa-catalog-details" className="text-xs text-zinc-600">
            <summary className="cursor-pointer font-medium text-zinc-800">Catalog details</summary>
            <div className="mt-2 space-y-1 rounded-lg border border-zinc-100 p-3">
              <p>Outputs: {descriptor.outputKinds.join(', ')}</p>
              <p>Routing: managed by Taku Proxy</p>
              {descriptor.fixedBehavior?.map(item => <p key={item}>{item}</p>)}
            </div>
          </details>
        )}

        <button
          data-slot="button-agent-runtime-qa-run"
          type="button"
          disabled={busy}
          onClick={() => void onRun(operation)}
          className="w-full rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:cursor-wait disabled:opacity-50"
        >
          {view.kind === 'starting'
            ? 'Starting…'
            : view.kind === 'running'
              ? `${view.status}…`
              : 'Run or resume sample'}
        </button>
      </div>

      {view.kind === 'running' && view.delta && (
        <pre className="max-h-32 overflow-auto border-t border-zinc-100 bg-zinc-50 p-4 text-xs text-zinc-700">
          {view.delta}
        </pre>
      )}

      {view.kind === 'failed' && (
        <div
          data-slot="agent-runtime-qa-operation-error"
          className="border-t border-red-100 bg-red-50 p-4"
        >
          <p className="font-mono text-xs font-semibold text-red-700">{view.error.code}</p>
          <p className="mt-1 text-sm text-red-950">{view.error.message}</p>
          {view.error.detail && <p className="mt-1 text-xs text-red-800">{view.error.detail}</p>}
        </div>
      )}

      {view.kind === 'succeeded' && (
        <div
          data-slot="agent-runtime-qa-operation-result"
          className="space-y-3 border-t border-emerald-100 bg-emerald-50/40 p-4"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Succeeded
          </p>
          {view.text && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-zinc-800">
              {view.text}
            </pre>
          )}
          {view.previews.map((preview, index) => (
            <RenewingMediaPreview key={preview.assetRef} preview={preview} index={index} />
          ))}
        </div>
      )}
    </article>
  );
}
