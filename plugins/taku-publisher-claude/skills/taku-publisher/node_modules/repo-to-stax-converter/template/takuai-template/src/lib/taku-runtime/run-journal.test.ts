import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTakuAgentRunJournal,
  TAKU_AGENT_RUN_JOURNAL_VERSION,
  type TakuAgentRunJournalStorage,
} from './run-journal';
import { TAKU_AGENT_IMAGE_OPERATION } from './types';

class FakeStorage implements TakuAgentRunJournalStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const RECOVERY_SCOPE = 'recovery-scope-account-a';

test('prepare writes a normalized request before returning it to start', () => {
  const storage = new FakeStorage();
  const journal = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey: 'report-a',
    ttlMs: 5_000,
    now: () => 1_000,
  });

  const entry = journal.prepare(
    { topic: 'Cache economics', language: 'en' },
    'same-logical-request'
  );

  assert.equal(entry.version, TAKU_AGENT_RUN_JOURNAL_VERSION);
  assert.equal(entry.recoveryScope, RECOVERY_SCOPE);
  assert.equal(entry.idempotencyKey, 'same-logical-request');
  assert.equal(entry.phase, 'prepared');
  assert.equal(entry.lastSequence, 0);
  assert.deepEqual(JSON.parse(storage.getItem('report-a') ?? ''), entry);
});

test('same-tab reload restores prepared and started branches with one request identity', () => {
  const storage = new FakeStorage();
  const options = {
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey: 'report-b',
    ttlMs: 5_000,
    now: () => 1_000,
  };
  const firstView = createTakuAgentRunJournal(options);
  const prepared = firstView.prepare({ topic: 'Weekly AI news' }, 'request-key');

  const reloadedBeforeResponse = createTakuAgentRunJournal(options).load();
  assert.deepEqual(reloadedBeforeResponse, prepared);
  assert.equal(reloadedBeforeResponse?.runId, undefined);

  firstView.markStarted(prepared.entryId, 'run-1', 2);
  const reloadedAfterResponse = createTakuAgentRunJournal(options).load();
  assert.equal(reloadedAfterResponse?.idempotencyKey, 'request-key');
  assert.equal(reloadedAfterResponse?.runId, 'run-1');
  assert.equal(reloadedAfterResponse?.lastSequence, 2);
  assert.equal(reloadedAfterResponse?.phase, 'started');
});

test('v3 report-only journals migrate in place without restarting an in-flight run', () => {
  const storage = new FakeStorage();
  const storageKey = 'legacy-report';
  storage.setItem(
    storageKey,
    JSON.stringify({
      version: 3,
      entryId: 'legacy-entry',
      recoveryScope: RECOVERY_SCOPE,
      operation: 'research.generateReport',
      operationRevision: 1,
      input: { topic: 'Already running report', language: 'en' },
      idempotencyKey: 'legacy-request',
      runId: 'legacy-run',
      lastSequence: 7,
      phase: 'running',
      createdAt: 1_000,
      expiresAt: 6_000,
    })
  );

  const journal = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey,
    ttlMs: 5_000,
    now: () => 2_000,
  });
  const loaded = journal.load();

  assert.equal(loaded?.version, TAKU_AGENT_RUN_JOURNAL_VERSION);
  assert.equal(loaded?.runId, 'legacy-run');
  assert.equal(loaded?.lastSequence, 7);
  assert.equal(JSON.parse(storage.getItem(storageKey) ?? '{}').version, 4);
});

test('v3 journals cannot be migrated into non-report operation scopes', () => {
  const storage = new FakeStorage();
  const storageKey = 'legacy-image';
  storage.setItem(
    storageKey,
    JSON.stringify({
      version: 3,
      entryId: 'legacy-entry',
      recoveryScope: RECOVERY_SCOPE,
      operation: 'media.image.generate',
      operationRevision: 1,
      input: { prompt: 'Legacy image' },
      idempotencyKey: 'legacy-request',
      lastSequence: 0,
      phase: 'prepared',
      createdAt: 1_000,
      expiresAt: 6_000,
    })
  );

  const journal = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    operation: TAKU_AGENT_IMAGE_OPERATION,
    storage,
    storageKey,
    ttlMs: 5_000,
    now: () => 2_000,
  });

  assert.deepEqual(journal.inspect(), { status: 'discarded', reason: 'invalid' });
  assert.equal(storage.getItem(storageKey), null);
});

test('progress is monotonic and terminal cleanup removes the temporary ledger', () => {
  const storage = new FakeStorage();
  const journal = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey: 'report-c',
    now: () => 10,
  });
  const entry = journal.prepare({ topic: 'Research' }, 'request-key');
  journal.markStarted(entry.entryId, 'run-1', 1);
  assert.equal(journal.update(entry.entryId, 4).lastSequence, 4);
  assert.equal(journal.update(entry.entryId, 4, 'cancelling').phase, 'cancelling');
  assert.throws(() => journal.update(entry.entryId, 3), /cannot move backwards/);
  assert.throws(
    () => journal.update(entry.entryId, 5, 'running'),
    /cannot move backwards from cancelling/
  );

  assert.equal(journal.clear(entry.entryId), 'cleared');
  assert.equal(journal.load(), null);
});

test('expired or malformed journals fail closed and are removed', () => {
  const storage = new FakeStorage();
  const currentTime = { value: 100 };
  const journal = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey: 'report-d',
    ttlMs: 10,
    now: () => currentTime.value,
  });
  journal.prepare({ topic: 'Research' }, 'request-key');
  currentTime.value = 111;
  assert.equal(journal.load(), null);
  assert.equal(storage.getItem('report-d'), null);

  storage.setItem('report-d', '{not-json');
  assert.equal(journal.load(), null);
  assert.equal(storage.getItem('report-d'), null);
});

test('state transitions cannot forge prepared entries, replace run IDs, or regress phases', () => {
  const storage = new FakeStorage();
  const journal = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey: 'report-state',
    now: () => 100,
  });

  const entry = journal.prepare({ topic: 'Research' }, 'request-key');
  assert.throws(() => journal.update(entry.entryId, 0), /has not been started/);
  assert.equal(journal.markStarted(entry.entryId, 'run-1', 2).phase, 'started');
  assert.equal(journal.markStarted(entry.entryId, 'run-1', 3).lastSequence, 3);
  assert.throws(() => journal.markStarted(entry.entryId, 'run-2', 3), /different run/);
  assert.throws(() => journal.update(entry.entryId, 3, 'started'), /must be running or cancelling/);
  assert.equal(journal.update(entry.entryId, 4, 'running').phase, 'running');

  const forged = JSON.parse(storage.getItem('report-state') ?? '{}') as Record<string, unknown>;
  forged.phase = 'prepared';
  storage.setItem('report-state', JSON.stringify(forged));
  assert.equal(journal.load(), null);
});

test('load requires the configured TTL, current recovery scope, and a non-future timestamp', () => {
  const storage = new FakeStorage();
  const clock = { value: 1_000 };
  const original = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey: 'report-boundary',
    ttlMs: 5_000,
    now: () => clock.value,
  });
  original.prepare({ topic: 'Research' }, 'request-key');

  assert.equal(
    createTakuAgentRunJournal({
      recoveryScope: 'recovery-scope-account-b',
      storage,
      storageKey: 'report-boundary',
      ttlMs: 5_000,
      now: () => clock.value,
    }).load(),
    null
  );
  assert.equal(storage.getItem('report-boundary'), null);

  original.prepare({ topic: 'Research' }, 'request-key');
  assert.equal(
    createTakuAgentRunJournal({
      recoveryScope: RECOVERY_SCOPE,
      storage,
      storageKey: 'report-boundary',
      ttlMs: 4_000,
      now: () => clock.value,
    }).load(),
    null
  );

  original.prepare({ topic: 'Research' }, 'request-key');
  clock.value = 999;
  assert.equal(original.load(), null);

  assert.throws(
    () =>
      createTakuAgentRunJournal({
        recoveryScope: RECOVERY_SCOPE,
        storage,
        storageKey: 'overflow',
        ttlMs: 10,
        now: () => Number.MAX_SAFE_INTEGER - 5,
      }).prepare({ topic: 'Research' }, 'request-key'),
    /safe integer range/
  );
});

test('journals are operation-scoped and preserve provider-neutral media inputs', () => {
  const storage = new FakeStorage();
  const journal = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    operation: TAKU_AGENT_IMAGE_OPERATION,
    storage,
    now: () => 1_000,
  });
  const entry = journal.prepare(
    {
      prompt: 'A calm lake at sunrise',
      aspectRatio: '16:9',
    },
    'image-request-key'
  );

  assert.equal(journal.operation, TAKU_AGENT_IMAGE_OPERATION);
  assert.equal(entry.operation, TAKU_AGENT_IMAGE_OPERATION);
  assert.deepEqual(entry.input, {
    prompt: 'A calm lake at sunrise',
    aspectRatio: '16:9',
  });
  assert.equal(storage.values.has('taku.agent.run/v2:media.image.generate@1:in-flight'), true);

  const reportJournal = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    storage,
    storageKey: 'shared-operation-key',
    now: () => 1_000,
  });
  const imageJournal = createTakuAgentRunJournal({
    recoveryScope: RECOVERY_SCOPE,
    operation: TAKU_AGENT_IMAGE_OPERATION,
    storage,
    storageKey: 'shared-operation-key',
    now: () => 1_000,
  });
  reportJournal.prepare({ topic: 'Wrong operation evidence' }, 'report-request');
  assert.deepEqual(imageJournal.inspect(), { status: 'discarded', reason: 'invalid' });
  assert.equal(storage.getItem('shared-operation-key'), null);
});
