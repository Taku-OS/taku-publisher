import { TakuAgentError, type TakuAgentRequestOptions } from './client';
import { validateRunId, validateTakuAgentRecoveryScope } from './contract';
import {
  type TakuAgentRunJournal,
  type TakuAgentRunJournalDiscardReason,
  type TakuAgentRunJournalEntryFor,
  TakuAgentRunJournalStaleEntryError,
} from './run-journal';
import type {
  TAKU_AGENT_REPORT_OPERATION,
  TakuAgentOperationId,
  TakuAgentOperationInputMap,
  TakuAgentRunCursor,
  TakuAgentStartInput,
} from './types';

const TERMINAL_STATES = new Set(['succeeded', 'failed', 'cancelled']);
const DEFINITIVE_START_ERROR_CODES = new Set([
  'protocol_unsupported',
  'invalid_request',
  'input_invalid',
  'capability_not_declared',
  'capability_not_granted',
  'operation_unsupported',
  'idempotency_conflict',
  'account_changed',
  'sdk_unsupported',
  'sdk_limit_exceeded',
]);
const ACTIVE_RECOVERIES = new Map<string, Promise<RecoverOrStartTakuAgentRunResult>>();

export interface TakuAgentRunRecoveryClient {
  start(input: TakuAgentStartInput, options?: TakuAgentRequestOptions): Promise<TakuAgentRunCursor>;
  get(runId: string, options?: TakuAgentRequestOptions): Promise<TakuAgentRunCursor>;
}

export type RecoverOrStartTakuAgentRunOptions<
  K extends TakuAgentOperationId = typeof TAKU_AGENT_REPORT_OPERATION,
> = {
  client: TakuAgentRunRecoveryClient;
  journal: TakuAgentRunJournal<K>;
  recoveryScope: string;
  input: TakuAgentOperationInputMap[K];
  idempotencyKey?: string;
  requestOptions?: TakuAgentRequestOptions;
};

export type RecoverOrStartTakuAgentRunResult = {
  source: 'started' | 'recovered';
  cursor: TakuAgentRunCursor;
  terminal: boolean;
  journalEntryId: string;
  cleanupError?: unknown;
};

export class TakuAgentRunRecoveryBlockedError extends Error {
  readonly reason: TakuAgentRunJournalDiscardReason;

  constructor(reason: TakuAgentRunJournalDiscardReason) {
    super(`Automatic Taku Agent recovery was blocked: ${reason}`);
    this.name = 'TakuAgentRunRecoveryBlockedError';
    this.reason = reason;
  }
}

export class TakuAgentRunPersistenceError extends Error {
  readonly cursor: TakuAgentRunCursor;

  constructor(cursor: TakuAgentRunCursor, cause: unknown) {
    super('The Agent run started, but its recovery journal could not be advanced', { cause });
    this.name = 'TakuAgentRunPersistenceError';
    this.cursor = cursor;
  }
}

/**
 * Restores the one in-flight request bound to this operation-specific journal,
 * or starts it once. Omitting journal.operation keeps the legacy report helper API.
 */
export function recoverOrStartTakuAgentRun<
  K extends TakuAgentOperationId = typeof TAKU_AGENT_REPORT_OPERATION,
>(options: RecoverOrStartTakuAgentRunOptions<K>): Promise<RecoverOrStartTakuAgentRunResult> {
  let recoveryScope: string;
  try {
    recoveryScope = validateTakuAgentRecoveryScope(options.recoveryScope);
    if (options.journal.recoveryScope !== recoveryScope) {
      throw new Error('Run journal recoveryScope does not match the authenticated Host');
    }
  } catch (error) {
    return Promise.reject(error);
  }

  const active = ACTIVE_RECOVERIES.get(options.journal.coordinationKey);
  if (active) return active;

  const operation = recoverOrStartOnce(options, recoveryScope).finally(() => {
    if (ACTIVE_RECOVERIES.get(options.journal.coordinationKey) === operation) {
      ACTIVE_RECOVERIES.delete(options.journal.coordinationKey);
    }
  });
  ACTIVE_RECOVERIES.set(options.journal.coordinationKey, operation);
  return operation;
}

async function recoverOrStartOnce<K extends TakuAgentOperationId>(
  options: RecoverOrStartTakuAgentRunOptions<K>,
  recoveryScope: string
): Promise<RecoverOrStartTakuAgentRunResult> {
  const inspected = options.journal.inspect();
  if (inspected.status === 'discarded') {
    throw new TakuAgentRunRecoveryBlockedError(inspected.reason);
  }
  const entry =
    inspected.status === 'active'
      ? inspected.entry
      : options.journal.prepare(options.input, options.idempotencyKey);
  const source = entry.runId ? 'recovered' : 'started';
  let cursor: TakuAgentRunCursor;
  try {
    cursor = entry.runId
      ? await options.client.get(entry.runId, options.requestOptions)
      : await options.client.start(
          {
            operation: entry.operation,
            operationRevision: entry.operationRevision,
            expectedRecoveryScope: recoveryScope,
            input: entry.input,
            idempotencyKey: entry.idempotencyKey,
          } as TakuAgentStartInput,
          options.requestOptions
        );
  } catch (error) {
    if (shouldDiscardAfterError(error, entry)) {
      try {
        options.journal.clear(entry.entryId);
      } catch {
        // The original Host/business error remains authoritative over cleanup.
      }
    }
    throw error;
  }

  validateCursor(cursor, entry);
  const terminal = TERMINAL_STATES.has(cursor.snapshot.state);
  if (terminal) {
    let cleanupError: unknown;
    try {
      const clearResult = options.journal.clear(entry.entryId);
      if (clearResult === 'stale') throw new TakuAgentRunJournalStaleEntryError();
    } catch (error) {
      if (error instanceof TakuAgentRunJournalStaleEntryError) throw error;
      cleanupError = error;
    }
    return {
      source,
      cursor,
      terminal: true,
      journalEntryId: entry.entryId,
      ...(cleanupError === undefined ? {} : { cleanupError }),
    };
  }

  try {
    if (!entry.runId) {
      options.journal.markStarted(entry.entryId, cursor.snapshot.runId, cursor.lastSequence);
    }
    options.journal.update(
      entry.entryId,
      cursor.lastSequence,
      cursor.snapshot.state === 'cancelling' ? 'cancelling' : 'running'
    );
  } catch (error) {
    if (error instanceof TakuAgentRunJournalStaleEntryError) throw error;
    throw new TakuAgentRunPersistenceError(cursor, error);
  }
  return { source, cursor, terminal: false, journalEntryId: entry.entryId };
}

function validateCursor<K extends TakuAgentOperationId>(
  cursor: TakuAgentRunCursor,
  entry: TakuAgentRunJournalEntryFor<K>
): void {
  const runId = validateRunId(cursor.snapshot.runId);
  if (entry.runId !== undefined && runId !== entry.runId) {
    throw new Error('Recovered run ID does not match the journal');
  }
  if (cursor.lastSequence < entry.lastSequence) {
    throw new Error('Host returned a run cursor older than the journal');
  }
  if (
    cursor.snapshot.operation !== entry.operation ||
    cursor.snapshot.operationRevision !== entry.operationRevision
  ) {
    throw new Error('Host returned a run for a different operation');
  }
  if (cursor.snapshot.state === 'failed' && !cursor.snapshot.error) {
    throw new Error('Host returned a failed run without an error');
  }
  if (cursor.snapshot.state === 'succeeded' && cursor.snapshot.error) {
    throw new Error('Host returned a succeeded run with an error');
  }
  if (cursor.snapshot.state !== 'succeeded' && cursor.snapshot.result) {
    throw new Error('Host returned a result for a run that did not succeed');
  }
}

function shouldDiscardAfterError<K extends TakuAgentOperationId>(
  error: unknown,
  entry: TakuAgentRunJournalEntryFor<K>
): boolean {
  if (!(error instanceof TakuAgentError)) return false;
  if (entry.runId && error.code === 'run_not_found') return true;
  return !entry.runId && DEFINITIVE_START_ERROR_CODES.has(error.code);
}
