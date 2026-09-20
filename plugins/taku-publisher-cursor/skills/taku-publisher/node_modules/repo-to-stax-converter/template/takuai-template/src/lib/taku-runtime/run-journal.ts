import {
  createTakuAgentIdempotencyKey,
  validateRunId,
  validateTakuAgentRecoveryScope,
  validateTakuAgentStartInput,
} from './contract';
import {
  isTakuAgentOperation,
  TAKU_AGENT_REPORT_OPERATION,
  type TakuAgentOperationId,
  type TakuAgentOperationInputMap,
  type TakuAgentStartInput,
  type TakuAgentStartInputFor,
} from './types';

export const TAKU_AGENT_RUN_JOURNAL_VERSION = 4 as const;
const TAKU_AGENT_RUN_JOURNAL_LEGACY_REPORT_VERSION = 3 as const;
export const TAKU_AGENT_RUN_JOURNAL_DEFAULT_TTL_MS = 30 * 60 * 1_000;
export const TAKU_AGENT_RUN_JOURNAL_MAX_TTL_MS = 24 * 60 * 60 * 1_000;
/** Legacy/default report journal key. Other operations get operation-scoped defaults. */
export const TAKU_AGENT_RUN_JOURNAL_DEFAULT_KEY =
  'taku.agent.run/v2:research.generateReport@1:in-flight';
const TAKU_AGENT_RUN_JOURNAL_STALE_ENTRY_ERROR_BRAND = Symbol.for(
  'taku.agent.run/v2:journal-stale-entry-error'
);

export const TAKU_AGENT_RUN_JOURNAL_PHASES = [
  'prepared',
  'started',
  'running',
  'cancelling',
] as const;

export type TakuAgentRunJournalPhase = (typeof TAKU_AGENT_RUN_JOURNAL_PHASES)[number];

export const TAKU_AGENT_RUN_JOURNAL_DISCARD_REASONS = [
  'expired',
  'future_timestamp',
  'invalid',
  'recovery_scope_mismatch',
  'ttl_mismatch',
] as const;

export type TakuAgentRunJournalDiscardReason =
  (typeof TAKU_AGENT_RUN_JOURNAL_DISCARD_REASONS)[number];

export type TakuAgentRunJournalEntryFor<K extends TakuAgentOperationId> = {
  version: typeof TAKU_AGENT_RUN_JOURNAL_VERSION;
  entryId: string;
  recoveryScope: string;
  operation: K;
  operationRevision: 1;
  input: TakuAgentOperationInputMap[K];
  idempotencyKey: string;
  runId?: string;
  lastSequence: number;
  phase: TakuAgentRunJournalPhase;
  createdAt: number;
  expiresAt: number;
};

export type TakuAgentRunJournalEntry = {
  [K in TakuAgentOperationId]: TakuAgentRunJournalEntryFor<K>;
}[TakuAgentOperationId];

export type TakuAgentRunJournalInspectionFor<K extends TakuAgentOperationId> =
  | { status: 'empty' }
  | { status: 'active'; entry: TakuAgentRunJournalEntryFor<K> }
  | { status: 'discarded'; reason: TakuAgentRunJournalDiscardReason };

export type TakuAgentRunJournalInspection = {
  [K in TakuAgentOperationId]: TakuAgentRunJournalInspectionFor<K>;
}[TakuAgentOperationId];

export type TakuAgentRunJournalClearResult = 'cleared' | 'missing' | 'stale';

export class TakuAgentRunJournalStaleEntryError extends Error {
  constructor() {
    super('Run journal entry was replaced by a newer request');
    this.name = 'TakuAgentRunJournalStaleEntryError';
    Object.defineProperty(this, TAKU_AGENT_RUN_JOURNAL_STALE_ENTRY_ERROR_BRAND, { value: true });
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      value instanceof Error &&
      Reflect.get(value, TAKU_AGENT_RUN_JOURNAL_STALE_ENTRY_ERROR_BRAND) === true
    );
  }
}

export interface TakuAgentRunJournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TakuAgentRunJournal<
  K extends TakuAgentOperationId = typeof TAKU_AGENT_REPORT_OPERATION,
> {
  readonly recoveryScope: string;
  readonly coordinationKey: string;
  readonly operation: K;
  readonly operationRevision: 1;
  prepare(
    input: TakuAgentOperationInputMap[K],
    idempotencyKey?: string
  ): TakuAgentRunJournalEntryFor<K>;
  inspect(): TakuAgentRunJournalInspectionFor<K>;
  load(): TakuAgentRunJournalEntryFor<K> | null;
  markStarted(entryId: string, runId: string, lastSequence: number): TakuAgentRunJournalEntryFor<K>;
  update(
    entryId: string,
    lastSequence: number,
    phase?: TakuAgentRunJournalPhase
  ): TakuAgentRunJournalEntryFor<K>;
  clear(entryId: string): TakuAgentRunJournalClearResult;
  discard(): void;
}

export type TakuAgentRunJournalOptions<
  K extends TakuAgentOperationId = typeof TAKU_AGENT_REPORT_OPERATION,
> = {
  recoveryScope: string;
  /** Defaults to research.generateReport for source compatibility with the v2 preview SDK. */
  operation?: K;
  operationRevision?: 1;
  storage?: TakuAgentRunJournalStorage;
  storageKey?: string;
  ttlMs?: number;
  now?: () => number;
};

export function createTakuAgentRunJournal<
  K extends TakuAgentOperationId = typeof TAKU_AGENT_REPORT_OPERATION,
>(options: TakuAgentRunJournalOptions<K>): TakuAgentRunJournal<K> {
  const recoveryScope = validateTakuAgentRecoveryScope(options.recoveryScope);
  const operation = (options.operation ?? TAKU_AGENT_REPORT_OPERATION) as K;
  if (!isTakuAgentOperation(operation, options.operationRevision ?? 1)) {
    throw new TypeError('Invalid run journal operation');
  }
  const storage = options.storage ?? getSessionStorage();
  const storageKey = validateStorageKey(
    options.storageKey ?? defaultStorageKeyForOperation(operation)
  );
  const ttlMs = validateTtl(options.ttlMs ?? TAKU_AGENT_RUN_JOURNAL_DEFAULT_TTL_MS);
  const now = options.now ?? Date.now;
  const coordinationKey = JSON.stringify([recoveryScope, storageKey, operation, 1]);

  const write = (entry: TakuAgentRunJournalEntryFor<K>): TakuAgentRunJournalEntryFor<K> => {
    storage.setItem(storageKey, JSON.stringify(entry));
    return cloneEntry(entry);
  };

  const discard = (): void => storage.removeItem(storageKey);

  const inspect = (): TakuAgentRunJournalInspectionFor<K> => {
    const raw = storage.getItem(storageKey);
    if (raw === null) return { status: 'empty' };
    try {
      const stored: unknown = JSON.parse(raw);
      const decoded = parseEntry(stored, validateNow(now()), ttlMs, recoveryScope, operation);
      if (decoded.status === 'active') {
        // v3 was the report-only preview journal. Its storage key and payload are still
        // valid, so upgrade it in place rather than losing an in-flight report on reload.
        if (isRecord(stored) && stored.version === TAKU_AGENT_RUN_JOURNAL_LEGACY_REPORT_VERSION) {
          storage.setItem(storageKey, JSON.stringify(decoded.entry));
        }
        return decoded;
      }
      discard();
      return decoded;
    } catch {
      discard();
      return { status: 'discarded', reason: 'invalid' };
    }
  };

  const load = (): TakuAgentRunJournalEntryFor<K> | null => {
    const inspected = inspect();
    return inspected.status === 'active' ? inspected.entry : null;
  };

  return {
    recoveryScope,
    coordinationKey,
    operation,
    operationRevision: 1,
    inspect,
    prepare(input, idempotencyKey = createTakuAgentIdempotencyKey()) {
      if (load()) throw new Error('A Taku Agent run journal is already active');
      const createdAt = validateNow(now());
      const expiresAt = createdAt + ttlMs;
      if (!Number.isSafeInteger(expiresAt)) {
        throw new TypeError('Run journal expiry is outside the safe integer range');
      }
      const normalized = validateTakuAgentStartInput({
        operation,
        operationRevision: 1,
        expectedRecoveryScope: recoveryScope,
        input,
        idempotencyKey,
      } as unknown as TakuAgentStartInput) as TakuAgentStartInputFor<K>;
      return write({
        version: TAKU_AGENT_RUN_JOURNAL_VERSION,
        entryId: createTakuAgentIdempotencyKey(),
        recoveryScope,
        operation,
        operationRevision: 1,
        input: normalized.input,
        idempotencyKey: normalized.idempotencyKey,
        lastSequence: 0,
        phase: 'prepared',
        createdAt,
        expiresAt,
      });
    },
    load,
    markStarted(entryId, runId, lastSequence) {
      const entry = requireEntry(load());
      requireEntryIdentity(entry, entryId);
      const nextRunId = validateRunId(runId);
      const nextSequence = validateSequence(lastSequence);
      if (nextSequence < entry.lastSequence) {
        throw new TypeError('lastSequence cannot move backwards');
      }
      if (entry.phase !== 'prepared') {
        if (entry.runId !== nextRunId) {
          throw new Error('Run journal is already bound to a different run');
        }
        return write({ ...entry, lastSequence: nextSequence });
      }
      return write({
        ...entry,
        runId: nextRunId,
        lastSequence: nextSequence,
        phase: 'started',
      });
    },
    update(entryId, lastSequence, phase = 'running') {
      const entry = requireEntry(load());
      requireEntryIdentity(entry, entryId);
      if (!entry.runId) throw new Error('Run journal has not been started');
      const nextSequence = validateSequence(lastSequence);
      if (nextSequence < entry.lastSequence) {
        throw new TypeError('lastSequence cannot move backwards');
      }
      if (phase !== 'running' && phase !== 'cancelling') {
        throw new TypeError('Run journal progress phase must be running or cancelling');
      }
      if (entry.phase === 'cancelling' && phase !== 'cancelling') {
        throw new Error('Run journal phase cannot move backwards from cancelling');
      }
      return write({ ...entry, lastSequence: nextSequence, phase });
    },
    clear(entryId) {
      const inspected = inspect();
      if (inspected.status !== 'active') return 'missing';
      if (inspected.entry.entryId !== validateEntryId(entryId)) return 'stale';
      discard();
      return 'cleared';
    },
    discard,
  };
}

function defaultStorageKeyForOperation(operation: TakuAgentOperationId): string {
  return operation === TAKU_AGENT_REPORT_OPERATION
    ? TAKU_AGENT_RUN_JOURNAL_DEFAULT_KEY
    : `taku.agent.run/v2:${operation}@1:in-flight`;
}

function getSessionStorage(): TakuAgentRunJournalStorage {
  if (typeof globalThis.sessionStorage === 'undefined') {
    throw new Error('Taku Agent run journal requires browser sessionStorage');
  }
  return globalThis.sessionStorage;
}

function validateStorageKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > 256) throw new TypeError('Invalid run journal storage key');
  return key;
}

function validateTtl(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > TAKU_AGENT_RUN_JOURNAL_MAX_TTL_MS) {
    throw new TypeError('Invalid run journal TTL');
  }
  return value;
}

function validateNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid run journal time');
  return value;
}

function validateSequence(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid run journal sequence');
  }
  return value;
}

function requireEntry<K extends TakuAgentOperationId>(
  entry: TakuAgentRunJournalEntryFor<K> | null
): TakuAgentRunJournalEntryFor<K> {
  if (!entry) throw new Error('No active Taku Agent run journal');
  return entry;
}

function requireEntryIdentity(entry: { entryId: string }, entryId: string): void {
  if (entry.entryId !== validateEntryId(entryId)) {
    throw new TakuAgentRunJournalStaleEntryError();
  }
}

function validateEntryId(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() === ''
  ) {
    throw new TypeError('Invalid run journal entry ID');
  }
  return value;
}

function parseEntry<K extends TakuAgentOperationId>(
  value: unknown,
  currentTime: number,
  ttlMs: number,
  recoveryScope: string,
  operation: K
): Exclude<TakuAgentRunJournalInspectionFor<K>, { status: 'empty' }> {
  if (!isRecord(value)) return { status: 'discarded', reason: 'invalid' };
  const isLegacyReportEntry =
    value.version === TAKU_AGENT_RUN_JOURNAL_LEGACY_REPORT_VERSION &&
    operation === TAKU_AGENT_REPORT_OPERATION;
  if (
    (value.version !== TAKU_AGENT_RUN_JOURNAL_VERSION && !isLegacyReportEntry) ||
    typeof value.entryId !== 'string' ||
    value.operation !== operation ||
    value.operationRevision !== 1 ||
    !TAKU_AGENT_RUN_JOURNAL_PHASES.includes(value.phase as TakuAgentRunJournalPhase) ||
    !Number.isSafeInteger(value.lastSequence) ||
    (value.lastSequence as number) < 0 ||
    !Number.isSafeInteger(value.createdAt) ||
    (value.createdAt as number) < 0 ||
    !Number.isSafeInteger(value.expiresAt) ||
    (value.expiresAt as number) <= (value.createdAt as number)
  ) {
    return { status: 'discarded', reason: 'invalid' };
  }

  if (value.recoveryScope !== recoveryScope) {
    return { status: 'discarded', reason: 'recovery_scope_mismatch' };
  }
  if ((value.createdAt as number) > currentTime) {
    return { status: 'discarded', reason: 'future_timestamp' };
  }
  if ((value.expiresAt as number) - (value.createdAt as number) !== ttlMs) {
    return { status: 'discarded', reason: 'ttl_mismatch' };
  }
  if ((value.expiresAt as number) <= validateNow(currentTime)) {
    return { status: 'discarded', reason: 'expired' };
  }

  const normalized = validateTakuAgentStartInput({
    operation,
    operationRevision: 1,
    expectedRecoveryScope: recoveryScope,
    input: value.input as TakuAgentOperationInputMap[K],
    idempotencyKey: value.idempotencyKey as string,
  } as unknown as TakuAgentStartInput) as TakuAgentStartInputFor<K>;
  const runId = value.runId === undefined ? undefined : validateRunId(value.runId as string);
  const entryId = validateEntryId(value.entryId);
  if (value.phase === 'prepared') {
    if (runId !== undefined || value.lastSequence !== 0) {
      return { status: 'discarded', reason: 'invalid' };
    }
  } else if (runId === undefined) {
    return { status: 'discarded', reason: 'invalid' };
  }

  return {
    status: 'active',
    entry: {
      version: TAKU_AGENT_RUN_JOURNAL_VERSION,
      entryId,
      recoveryScope,
      operation,
      operationRevision: 1,
      input: normalized.input,
      idempotencyKey: normalized.idempotencyKey,
      ...(runId === undefined ? {} : { runId }),
      lastSequence: value.lastSequence as number,
      phase: value.phase as TakuAgentRunJournalPhase,
      createdAt: value.createdAt as number,
      expiresAt: value.expiresAt as number,
    },
  };
}

function cloneEntry<K extends TakuAgentOperationId>(
  entry: TakuAgentRunJournalEntryFor<K>
): TakuAgentRunJournalEntryFor<K> {
  return {
    ...entry,
    input: JSON.parse(JSON.stringify(entry.input)) as TakuAgentOperationInputMap[K],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
