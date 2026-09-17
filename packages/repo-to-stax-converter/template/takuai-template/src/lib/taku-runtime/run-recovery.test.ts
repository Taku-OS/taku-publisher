import assert from 'node:assert/strict';
import test from 'node:test';
import { TakuAgentError } from './client';
import {
  createTakuAgentRunJournal,
  type TakuAgentRunJournal,
  TakuAgentRunJournalStaleEntryError,
  type TakuAgentRunJournalStorage,
} from './run-journal';
import {
  recoverOrStartTakuAgentRun,
  TakuAgentRunPersistenceError,
  TakuAgentRunRecoveryBlockedError,
  type TakuAgentRunRecoveryClient,
} from './run-recovery';
import {
  TAKU_AGENT_IMAGE_OPERATION,
  TAKU_AGENT_OPERATION,
  TAKU_AGENT_OPERATION_REVISION,
  type TakuAgentRunCursor,
  type TakuAgentStartInput,
} from './types';

const RECOVERY_SCOPE = 'recovery-scope-account-a';

class FakeStorage implements TakuAgentRunJournalStorage {
  readonly values = new Map<string, string>();
  setError: Error | null = null;
  removeError: Error | null = null;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.setError) throw this.setError;
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (this.removeError) throw this.removeError;
    this.values.delete(key);
  }
}

class FakeClient implements TakuAgentRunRecoveryClient {
  readonly starts: TakuAgentStartInput[] = [];
  readonly gets: string[] = [];
  startResult = cursor('run-started', 'running', 3);
  getResult = cursor('run-recovered', 'running', 7);
  startError: Error | null = null;
  getError: Error | null = null;
  startDeferred: Promise<TakuAgentRunCursor> | null = null;

  async start(input: TakuAgentStartInput): Promise<TakuAgentRunCursor> {
    this.starts.push(structuredClone(input));
    if (this.startError) throw this.startError;
    if (this.startDeferred) return structuredClone(await this.startDeferred);
    return structuredClone(this.startResult);
  }

  async get(runId: string): Promise<TakuAgentRunCursor> {
    this.gets.push(runId);
    if (this.getError) throw this.getError;
    return structuredClone(this.getResult);
  }
}

function cursor(
  runId: string,
  state: TakuAgentRunCursor['snapshot']['state'],
  lastSequence: number
): TakuAgentRunCursor {
  return {
    snapshot: {
      runId,
      operation: TAKU_AGENT_OPERATION,
      operationRevision: TAKU_AGENT_OPERATION_REVISION,
      state,
      createdAt: '2026-09-09T00:00:00.000Z',
      updatedAt: '2026-09-09T00:00:01.000Z',
      ...(state === 'failed'
        ? { error: { code: 'runner_crashed' as const, message: 'Runner crashed' } }
        : {}),
    },
    lastSequence,
  };
}

function fixture() {
  const storage = new FakeStorage();
  const journal = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey: 'report',
    now: () => 1_000,
  });
  const client = new FakeClient();
  return { storage, journal, client };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function separateRealm(journal: TakuAgentRunJournal, realm: string): TakuAgentRunJournal {
  return { ...journal, coordinationKey: `${journal.coordinationKey}:${realm}` };
}

test('prepared recovery retries start with the exact persisted input and idempotency key', async () => {
  const { journal, client } = fixture();
  journal.prepare({ topic: 'Persisted topic', language: 'en' }, 'persisted-key');

  const result = await recoverOrStartTakuAgentRun({
    client,
    journal,
    recoveryScope: RECOVERY_SCOPE,
    input: { topic: 'New render input must not replace the in-flight request' },
    idempotencyKey: 'new-key',
  });

  assert.equal(result.source, 'started');
  assert.equal(result.terminal, false);
  assert.deepEqual(client.gets, []);
  assert.deepEqual(client.starts, [
    {
      operation: TAKU_AGENT_OPERATION,
      operationRevision: TAKU_AGENT_OPERATION_REVISION,
      expectedRecoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Persisted topic', language: 'en' },
      idempotencyKey: 'persisted-key',
    },
  ]);
  assert.equal(journal.load()?.runId, 'run-started');
  assert.equal(journal.load()?.lastSequence, 3);
  assert.equal(journal.load()?.phase, 'running');
});

test('recovery with a run ID calls only get and advances the retained cursor', async () => {
  const { journal, client } = fixture();
  const entry = journal.prepare({ topic: 'Persisted topic' }, 'persisted-key');
  journal.markStarted(entry.entryId, 'run-recovered', 4);

  const result = await recoverOrStartTakuAgentRun({
    client,
    journal,
    recoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Unused' },
  });

  assert.equal(result.source, 'recovered');
  assert.deepEqual(client.starts, []);
  assert.deepEqual(client.gets, ['run-recovered']);
  assert.equal(journal.load()?.lastSequence, 7);
  assert.equal(journal.load()?.phase, 'running');
});

test('an immediate terminal snapshot clears the journal without reporting success itself', async () => {
  for (const state of ['succeeded', 'failed', 'cancelled'] as const) {
    const { journal, client } = fixture();
    client.startResult = cursor(`run-${state}`, state, 1);

    const result = await recoverOrStartTakuAgentRun({
      client,
      journal,
      recoveryScope: RECOVERY_SCOPE,
      input: { topic: state },
      idempotencyKey: `key-${state}`,
    });

    assert.equal(result.cursor.snapshot.state, state);
    assert.equal(result.terminal, true);
    assert.equal(journal.load(), null);
  }
});

test('a recovered terminal snapshot is fetched once and clears the journal', async () => {
  for (const state of ['succeeded', 'failed', 'cancelled'] as const) {
    const { journal, client } = fixture();
    const entry = journal.prepare({ topic: 'Persisted topic' }, 'persisted-key');
    journal.markStarted(entry.entryId, 'run-recovered', 4);
    client.getResult = cursor('run-recovered', state, 8);

    const result = await recoverOrStartTakuAgentRun({
      client,
      journal,
      recoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Unused' },
    });

    assert.equal(result.source, 'recovered');
    assert.equal(result.cursor.snapshot.state, state);
    assert.equal(result.terminal, true);
    assert.deepEqual(client.starts, []);
    assert.deepEqual(client.gets, ['run-recovered']);
    assert.equal(journal.load(), null);
  }
});

test('transport failures preserve the retry identity and never return a false terminal result', async () => {
  const { journal, client } = fixture();
  const error = new Error('Host unavailable');
  client.startError = error;

  await assert.rejects(
    recoverOrStartTakuAgentRun({
      client,
      journal,
      recoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Retry me' },
      idempotencyKey: 'retry-key',
    }),
    error
  );
  assert.equal(journal.load()?.idempotencyKey, 'retry-key');
  assert.equal(journal.load()?.phase, 'prepared');
});

test('start timeout and abort keep the journal and reuse the exact request on recovery', async () => {
  for (const code of ['sdk_timeout', 'sdk_aborted'] as const) {
    const { journal, client } = fixture();
    const error = new TakuAgentError({ code, message: 'Local wait ended', retryable: true });
    client.startError = error;

    await assert.rejects(
      recoverOrStartTakuAgentRun({
        client,
        journal,
        recoveryScope: RECOVERY_SCOPE,
        input: { topic: 'Waiting for consent' },
        idempotencyKey: `consent-${code}`,
      }),
      error
    );
    const entry = journal.load();
    assert.equal(entry?.phase, 'prepared');
    assert.equal(entry?.runId, undefined);
    assert.equal(entry?.idempotencyKey, `consent-${code}`);

    client.startError = null;
    const restored = await recoverOrStartTakuAgentRun({
      client,
      journal,
      recoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Do not replace the pending request' },
      idempotencyKey: 'do-not-use-new-key',
    });
    assert.equal(restored.cursor.snapshot.runId, 'run-started');
    assert.equal(client.starts.length, 2);
    assert.deepEqual(client.starts[1], client.starts[0]);
    assert.equal(journal.load()?.entryId, entry?.entryId);
  }
});

test('get failures preserve the bound run and never restart it', async () => {
  const { journal, client } = fixture();
  const entry = journal.prepare({ topic: 'Persisted topic' }, 'persisted-key');
  journal.markStarted(entry.entryId, 'run-recovered', 4);
  const error = new Error('Host unavailable');
  client.getError = error;

  await assert.rejects(
    recoverOrStartTakuAgentRun({
      client,
      journal,
      recoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Unused' },
    }),
    error
  );
  assert.deepEqual(client.starts, []);
  assert.deepEqual(client.gets, ['run-recovered']);
  assert.equal(journal.load()?.runId, 'run-recovered');
  assert.equal(journal.load()?.lastSequence, 4);
});

test('recovery refuses a different authenticated scope or mismatched Host run', async () => {
  const { journal, client } = fixture();
  await assert.rejects(
    recoverOrStartTakuAgentRun({
      client,
      journal,
      recoveryScope: 'recovery-scope-account-b',
      input: { topic: 'Wrong account' },
    }),
    /does not match/
  );

  const entry = journal.prepare({ topic: 'Persisted topic' }, 'persisted-key');
  journal.markStarted(entry.entryId, 'run-expected', 1);
  client.getResult = cursor('run-other', 'succeeded', 2);
  await assert.rejects(
    recoverOrStartTakuAgentRun({
      client,
      journal,
      recoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Unused' },
    }),
    /run ID does not match/i
  );
  assert.equal(journal.load()?.runId, 'run-expected');
});

test('one realm shares a single recovery request for the same storage key and scope', async () => {
  const storage = new FakeStorage();
  const options = {
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey: 'single-flight',
    now: () => 1_000,
  };
  const firstClient = new FakeClient();
  const secondClient = new FakeClient();
  const start = deferred<TakuAgentRunCursor>();
  firstClient.startDeferred = start.promise;

  const first = recoverOrStartTakuAgentRun({
    client: firstClient,
    journal: createTakuAgentRunJournal(options),
    recoveryScope: RECOVERY_SCOPE,
    input: { topic: 'One request' },
    idempotencyKey: 'single-flight-key',
  });
  const second = recoverOrStartTakuAgentRun({
    client: secondClient,
    journal: createTakuAgentRunJournal(options),
    recoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Ignored duplicate' },
  });

  assert.equal(firstClient.starts.length, 1);
  assert.equal(secondClient.starts.length, 0);
  start.resolve(cursor('run-shared', 'running', 1));
  assert.equal((await first).cursor.snapshot.runId, 'run-shared');
  assert.equal((await second).cursor.snapshot.runId, 'run-shared');
});

test('a stale terminal completion cannot clear a newer A/B/C request', async () => {
  const storage = new FakeStorage();
  const options = {
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey: 'stale-terminal',
    now: () => 1_000,
  };
  const baseA = createTakuAgentRunJournal(options);
  const clientA = new FakeClient();
  const clientB = new FakeClient();
  const lateB = deferred<TakuAgentRunCursor>();
  clientA.startResult = cursor('run-a', 'succeeded', 1);
  clientB.startDeferred = lateB.promise;

  const requestA = recoverOrStartTakuAgentRun({
    client: clientA,
    journal: separateRealm(baseA, 'A'),
    recoveryScope: RECOVERY_SCOPE,
    input: { topic: 'A' },
    idempotencyKey: 'shared-old-key',
  });
  const requestB = recoverOrStartTakuAgentRun({
    client: clientB,
    journal: separateRealm(createTakuAgentRunJournal(options), 'B'),
    recoveryScope: RECOVERY_SCOPE,
    input: { topic: 'B is deduplicated to A by the Host' },
  });
  await requestA;

  const journalC = createTakuAgentRunJournal(options);
  const entryC = journalC.prepare({ topic: 'C' }, 'new-key');
  lateB.resolve(cursor('run-a', 'succeeded', 1));
  await assert.rejects(requestB, TakuAgentRunJournalStaleEntryError);
  assert.equal(journalC.load()?.entryId, entryC.entryId);
  assert.equal(journalC.load()?.runId, undefined);
});

test('a stale non-terminal completion cannot bind an old run to a newer request', async () => {
  const storage = new FakeStorage();
  const options = {
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey: 'stale-running',
    now: () => 1_000,
  };
  const journalA = createTakuAgentRunJournal(options);
  const oldEntry = journalA.prepare({ topic: 'Old request' }, 'old-key');
  const journalC = createTakuAgentRunJournal(options);
  journalC.discard();
  const newEntry = journalC.prepare({ topic: 'New request' }, 'new-key');

  assert.throws(
    () => journalA.markStarted(oldEntry.entryId, 'run-old', 1),
    TakuAgentRunJournalStaleEntryError
  );
  assert.equal(journalC.load()?.entryId, newEntry.entryId);
  assert.equal(journalC.load()?.runId, undefined);
});

test('discarded recovery evidence blocks automatic start instead of becoming an empty journal', async () => {
  const scenarios: Array<{
    name: string;
    makeJournal: (storage: FakeStorage) => TakuAgentRunJournal;
    expectedReason: TakuAgentRunRecoveryBlockedError['reason'];
  }> = [
    {
      name: 'malformed',
      expectedReason: 'invalid',
      makeJournal(storage) {
        storage.setItem('malformed', '{broken');
        return createTakuAgentRunJournal({
          recoveryScope: RECOVERY_SCOPE,
          storage,
          storageKey: 'malformed',
          now: () => 100,
        });
      },
    },
    {
      name: 'expired',
      expectedReason: 'expired',
      makeJournal(storage) {
        const clock = { value: 100 };
        const journal = createTakuAgentRunJournal({
          recoveryScope: RECOVERY_SCOPE,
          storage,
          storageKey: 'expired',
          ttlMs: 10,
          now: () => clock.value,
        });
        journal.prepare({ topic: 'Old' }, 'old-key');
        clock.value = 111;
        return journal;
      },
    },
    {
      name: 'future timestamp',
      expectedReason: 'future_timestamp',
      makeJournal(storage) {
        const clock = { value: 100 };
        const journal = createTakuAgentRunJournal({
          recoveryScope: RECOVERY_SCOPE,
          storage,
          storageKey: 'future',
          now: () => clock.value,
        });
        journal.prepare({ topic: 'Future' }, 'future-key');
        clock.value = 99;
        return journal;
      },
    },
    {
      name: 'wrong TTL',
      expectedReason: 'ttl_mismatch',
      makeJournal(storage) {
        createTakuAgentRunJournal({
          recoveryScope: RECOVERY_SCOPE,
          storage,
          storageKey: 'ttl',
          ttlMs: 10,
          now: () => 100,
        }).prepare({ topic: 'Wrong TTL' }, 'ttl-key');
        return createTakuAgentRunJournal({
          recoveryScope: RECOVERY_SCOPE,
          storage,
          storageKey: 'ttl',
          ttlMs: 20,
          now: () => 100,
        });
      },
    },
    {
      name: 'wrong scope',
      expectedReason: 'recovery_scope_mismatch',
      makeJournal(storage) {
        createTakuAgentRunJournal({
          recoveryScope: RECOVERY_SCOPE,
          storage,
          storageKey: 'scope',
          now: () => 100,
        }).prepare({ topic: 'Old account' }, 'scope-key');
        return createTakuAgentRunJournal({
          recoveryScope: 'recovery-scope-account-b',
          storage,
          storageKey: 'scope',
          now: () => 100,
        });
      },
    },
  ];

  for (const scenario of scenarios) {
    const storage = new FakeStorage();
    const client = new FakeClient();
    const journal = scenario.makeJournal(storage);
    await assert.rejects(
      recoverOrStartTakuAgentRun({
        client,
        journal,
        recoveryScope: journal.recoveryScope,
        input: { topic: `Do not auto-start ${scenario.name}` },
      }),
      (error: unknown) =>
        error instanceof TakuAgentRunRecoveryBlockedError &&
        error.reason === scenario.expectedReason
    );
    assert.equal(client.starts.length, 0, scenario.name);
    assert.equal(client.gets.length, 0, scenario.name);
  }
});

test('definitive start rejection and stale run errors clear only their captured journal', async () => {
  const { journal, client } = fixture();
  client.startError = new TakuAgentError({
    code: 'input_invalid',
    message: 'Fix the input',
    retryable: false,
  });
  await assert.rejects(
    recoverOrStartTakuAgentRun({
      client,
      journal,
      recoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Invalid request' },
      idempotencyKey: 'invalid-key',
    }),
    (error: unknown) => error instanceof TakuAgentError && error.code === 'input_invalid'
  );
  assert.equal(journal.load(), null);

  const recovered = journal.prepare({ topic: 'Missing run' }, 'missing-key');
  journal.markStarted(recovered.entryId, 'run-missing', 1);
  client.startError = null;
  client.getError = new TakuAgentError({
    code: 'run_not_found',
    message: 'Run is gone',
    retryable: false,
  });
  await assert.rejects(
    recoverOrStartTakuAgentRun({
      client,
      journal,
      recoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Unused' },
    }),
    (error: unknown) => error instanceof TakuAgentError && error.code === 'run_not_found'
  );
  assert.equal(journal.load(), null);
});

test('a regressed terminal cursor is rejected without clearing the journal', async () => {
  const { journal, client } = fixture();
  const entry = journal.prepare({ topic: 'Persisted topic' }, 'persisted-key');
  journal.markStarted(entry.entryId, 'run-recovered', 10);
  client.getResult = cursor('run-recovered', 'succeeded', 2);

  await assert.rejects(
    recoverOrStartTakuAgentRun({
      client,
      journal,
      recoveryScope: RECOVERY_SCOPE,
      input: { topic: 'Unused' },
    }),
    /older than the journal/
  );
  assert.equal(journal.load()?.lastSequence, 10);
});

test('terminal cleanup failure is secondary to every real business outcome', async () => {
  for (const state of ['succeeded', 'failed', 'cancelled'] as const) {
    const { storage, journal, client } = fixture();
    client.startResult = cursor(`run-${state}`, state, 1);
    storage.removeError = new Error('Storage cleanup failed');

    const result = await recoverOrStartTakuAgentRun({
      client,
      journal,
      recoveryScope: RECOVERY_SCOPE,
      input: { topic: state },
      idempotencyKey: `cleanup-${state}`,
    });

    assert.equal(result.cursor.snapshot.state, state);
    assert.equal(result.terminal, true);
    assert.match(String(result.cleanupError), /Storage cleanup failed/);
  }
});

test('non-terminal persistence failure reports the accepted run separately', async () => {
  const { storage, journal, client } = fixture();
  const start = deferred<TakuAgentRunCursor>();
  client.startDeferred = start.promise;
  const pending = recoverOrStartTakuAgentRun({
    client,
    journal,
    recoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Accepted but not persisted' },
    idempotencyKey: 'persistence-key',
  });
  storage.setError = new Error('Storage write failed');
  start.resolve(cursor('run-accepted', 'running', 1));

  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof TakuAgentRunPersistenceError &&
      error.cursor.snapshot.runId === 'run-accepted'
  );
});

test('TTL expiry while start is in flight never converts the accepted run into success', async () => {
  const storage = new FakeStorage();
  const clock = { value: 100 };
  const journal = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey: 'expires-in-flight',
    ttlMs: 10,
    now: () => clock.value,
  });
  const client = new FakeClient();
  const start = deferred<TakuAgentRunCursor>();
  client.startDeferred = start.promise;
  const pending = recoverOrStartTakuAgentRun({
    client,
    journal,
    recoveryScope: RECOVERY_SCOPE,
    input: { topic: 'Slow start' },
    idempotencyKey: 'slow-key',
  });

  clock.value = 111;
  start.resolve(cursor('run-accepted', 'running', 1));
  await assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof TakuAgentRunPersistenceError &&
      error.cursor.snapshot.runId === 'run-accepted'
  );
  assert.equal(journal.load(), null);
});

test('operation-scoped recovery starts media runs with the exact persisted contract', async () => {
  const storage = new FakeStorage();
  const journal = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    operation: TAKU_AGENT_IMAGE_OPERATION,
    storage,
    storageKey: 'image-recovery',
    now: () => 1_000,
  });
  const client = new FakeClient();
  client.startResult = {
    snapshot: {
      runId: 'run-image',
      operation: TAKU_AGENT_IMAGE_OPERATION,
      operationRevision: 1,
      state: 'running',
      createdAt: '2026-09-09T00:00:00.000Z',
      updatedAt: '2026-09-09T00:00:01.000Z',
    },
    lastSequence: 1,
  };

  const result = await recoverOrStartTakuAgentRun({
    client,
    journal,
    recoveryScope: RECOVERY_SCOPE,
    input: { prompt: 'A paper-cut city', aspectRatio: '1:1' },
    idempotencyKey: 'image-recovery-key',
  });

  assert.equal(result.source, 'started');
  assert.equal(result.cursor.snapshot.operation, TAKU_AGENT_IMAGE_OPERATION);
  assert.deepEqual(client.starts, [
    {
      operation: TAKU_AGENT_IMAGE_OPERATION,
      operationRevision: 1,
      expectedRecoveryScope: RECOVERY_SCOPE,
      input: { prompt: 'A paper-cut city', aspectRatio: '1:1' },
      idempotencyKey: 'image-recovery-key',
    },
  ]);
});
